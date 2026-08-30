"""研究流水线端到端验证（真实 LLM + 真实检索，经 HTTP API 跑完整条流水线）。

运行前提：API 已在 127.0.0.1:8000 用修复后代码启动。
运行方式（conda 环境 suanfa_learning）：
    conda run -n suanfa_learning python -m agent.research.e2e_test

默认注册一个一次性测试账号并新建 FS-2026-022 同主题任务，断言：
- 总时长 <= 300 秒（争取 <= 180 秒）
- 事件中无“启动二次取证/检测到流程失败/自动重启/启用备用采集方案”
- 无超过 60 秒且无心跳事件的空窗
- 素材 >= 8、主张 >= 1、底稿已生成
- 每个节点都有 research_step_logs 与 task_node_runs 记录
- 幻觉审查有结论或明确降级说明
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import time
from datetime import datetime

import requests

BASE = os.environ.get("E2E_BASE", "http://127.0.0.1:8000")
DB_PATH = os.environ.get(
    "FACTSHIELD_DB",
    os.path.join(os.path.dirname(__file__), "..", "session", "sessions.db"),
)
TIMEOUT_S = int(os.environ.get("E2E_TIMEOUT_S", "360"))

TOPIC = ("在生成式AI驱动的新质生产力爆发与地缘政治碎片化并行背景下，"
         "全球系统性金融风险的跨资产、跨市场传染路径发生了怎样的结构性演变？"
         "传统基于流动性短缺和共同风险暴露的传染模型，是否被‘预期自我实现’"
         "与‘AI算法趋同交易’所主导的新型非线性传染机制所替代？")
TITLE = "NVIDIA（英伟达）在AI算力产业链中的位置、政策环境、核心技术、财务表现与风险的事实核查（修复验证）"
COMPANY = "NVIDIA（英伟达）"
RESEARCH_TYPE = "company"
PREFERRED_SOURCES = ["official", "company"]

FAILURES: list[str] = []


def _fail(msg: str) -> None:
    FAILURES.append(msg)
    print("  [FAIL]", msg)


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _register(sess: requests.Session) -> str:
    #测试账号隔离：新注册用户按 admin 同口径配置 LLM/Responses API/搜索引擎
    from agent import config as env_config
    email = f"e2e_{int(time.time())}@factshield.dev"
    r = sess.post(f"{BASE}/auth/register",
                  json={"email": email, "password": "E2Epass123!"}, timeout=20)
    if r.status_code != 200:
        raise RuntimeError(f"注册测试账号失败: {r.status_code} {r.text[:300]}")
    token = r.json()["token"]
    sess.headers.update({"Authorization": f"Bearer {token}"})
    r = sess.put(f"{BASE}/settings/llm", json={
        "base_url": env_config.DEEPSEEK_BASE_URL,
        "api_key": env_config.DEEPSEEK_API_KEY,
        "model_name": env_config.DEEPSEEK_MODEL,
        "use_response_api": True,
    }, timeout=20)
    if r.status_code != 200:
        raise RuntimeError(f"配置测试账号 LLM 失败: {r.status_code} {r.text[:300]}")
    r = sess.put(f"{BASE}/settings/search-engine",
                 json={"engine": "response_api"}, timeout=20)
    if r.status_code != 200:
        raise RuntimeError(f"配置测试账号搜索引擎失败: {r.status_code} {r.text[:300]}")
    return token


def _create_task(sess: requests.Session) -> str:
    r = sess.post(f"{BASE}/tasks", json={
        "topic": TOPIC, "title": TITLE, "company": COMPANY,
        "research_type": RESEARCH_TYPE, "preferred_sources": PREFERRED_SOURCES,
    }, timeout=20)
    if r.status_code != 200:
        raise RuntimeError(f"创建任务失败: {r.status_code} {r.text[:500]}")
    task_id = r.json()["id"]
    print("task_id:", task_id)
    return task_id


def _answer_pending_questions(sess: requests.Session, task_id: str) -> None:
    #流水线可能通过 ask_user 向研究员提问（plan 节点）；自动化测试自动回答，
    #避免无限阻塞。答案只用于划定核查边界，不预设任何事实结论。
    try:
        r = sess.get(f"{BASE}/tasks/{task_id}/questions", timeout=15)
        if r.status_code != 200:
            return
        for q in r.json().get("questions", []):
            if q.get("status") != "pending":
                continue
            qid = q.get("id")
            if not qid:
                continue
            answer = ("研究对象为 NVIDIA（英伟达）；核查边界以公司事实为主"
                      "（AI算力产业链位置、政策环境、核心技术、财务表现与风险），"
                      "系统性金融风险内容仅作为研究背景，不展开。")
            rr = sess.post(f"{BASE}/tasks/{task_id}/questions/{qid}/answer",
                           json={"answer": answer}, timeout=15)
            print(f"  [Q&A] answered {qid}: {rr.status_code}")
    except requests.ConnectionError:
        pass


def _wait_done(sess: requests.Session, task_id: str) -> tuple[str, float]:
    t0 = time.monotonic()
    while time.monotonic() - t0 < TIMEOUT_S:
        time.sleep(5)
        _answer_pending_questions(sess, task_id)
        d = None
        for _ in range(3):  #瞬时连接抖动自动重试
            try:
                r = sess.get(f"{BASE}/tasks/{task_id}", timeout=20)
                d = r.json()
                break
            except requests.ConnectionError:
                time.sleep(2)
        if d is None:
            continue
        status = d.get("status", "running")
        print(f"  t={time.monotonic() - t0:6.1f}s status={status} progress={d.get('progress')}",
              flush=True)
        if status in ("review", "ready", "failed", "stopped"):
            return status, time.monotonic() - t0
    return "timeout", time.monotonic() - t0


def _verify(task_id: str, final_status: str, duration: float) -> None:
    conn = _db()
    cur = conn.cursor()
    row = cur.execute(
        "SELECT status,progress,report_md FROM research_tasks WHERE task_id=?",
        (task_id,)).fetchone()
    if row is None:
        _fail("任务不存在于数据库")
        conn.close()
        return
    print("task:", dict(row))
    if final_status == "timeout":
        _fail("流水线超过超时上限仍未结束")
    if duration > 300:
        _fail(f"总时长 {duration:.1f}s 超过 300s 目标")
    elif duration > 180:
        print(f"  [WARN] 总时长 {duration:.1f}s 超过 180s 争取值，但满足 300s 硬性目标")
    if not row["report_md"]:
        _fail("report_md 未生成")
    mats = cur.execute("SELECT COUNT(*) n FROM task_materials WHERE task_id=?",
                       (task_id,)).fetchone()["n"]
    claims = cur.execute("SELECT COUNT(*) n FROM claims WHERE task_id=?",
                         (task_id,)).fetchone()["n"]
    evs = cur.execute("SELECT COUNT(*) n FROM evidence WHERE task_id=?",
                      (task_id,)).fetchone()["n"]
    print(f"materials={mats} claims={claims} evidence={evs}")
    if mats < 8:
        _fail(f"素材 {mats} < 8")
    if claims < 1:
        _fail("无主张")

    rows = cur.execute(
        "SELECT seq,actor,kind,payload,ts FROM task_events WHERE task_id=? ORDER BY seq",
        (task_id,)).fetchall()
    events = [dict(r) for r in rows]
    for e in events:
        e["payload"] = json.loads(e["payload"])
    bad_phrases = ["启动二次取证", "检测到流程失败", "自动重启", "启用备用采集方案",
                   "定向深挖跳过"]
    for e in events:
        text = f"{e['payload'].get('title', '')} {e['payload'].get('speech', '')}"
        for p in bad_phrases:
            if p in text:
                _fail(f"事件 seq={e['seq']} 出现禁用文案「{p}」: {text[:80]}")

    gaps: list[tuple[str, str, float]] = []
    prev: datetime | None = None
    for e in events:
        ts = datetime.strptime(e["ts"], "%Y-%m-%d %H:%M:%S")
        if prev is not None:
            gap = (ts - prev).total_seconds()
            if gap > 60:
                gaps.append((str(prev), str(ts), round(gap, 1)))
        prev = ts
    if gaps:
        _fail(f"存在超过 60s 的空窗: {gaps}")
    else:
        print("gaps>60s: NONE")

    steps = cur.execute(
        "SELECT node,status,duration_ms,llm_calls,prompt_tokens,completion_tokens"
        " FROM research_step_logs WHERE task_id=? ORDER BY id", (task_id,)).fetchall()
    node_runs = cur.execute(
        "SELECT node,status,duration,llm_calls,prompt_tokens,completion_tokens"
        " FROM task_node_runs WHERE task_id=? ORDER BY id", (task_id,)).fetchall()
    print(f"step_logs={len(steps)} node_runs={len(node_runs)}")
    expected_nodes = ["plan", "collect", "parse", "retrieve", "deepen", "score",
                      "verify", "review", "assemble"]
    step_nodes = {s["node"] for s in steps}
    run_nodes = {r["node"] for r in node_runs}
    for n in expected_nodes:
        if n not in step_nodes:
            _fail(f"research_step_logs 缺少节点 {n}")
        if n not in run_nodes:
            _fail(f"task_node_runs 缺少节点 {n}")
    for s in steps:
        print("  step:", dict(s))
    conn.close()

    #幻觉审查必须有结论（JSON 或降级说明）
    review_ok = any(
        e["actor"] == "reviewer" and ("幻觉审查完成" in e["payload"].get("title", "")
                                      or "幻觉审查降级完成" in e["payload"].get("title", ""))
        for e in events
    )
    if not review_ok:
        _fail("未找到幻觉审查完成/降级事件")


def main() -> int:
    sess = requests.Session()
    task_id = os.environ.get("E2E_TASK_ID", "")
    if task_id:
        #仅验证已有任务（本机直读数据库等待，无需鉴权）
        print("verify existing task:", task_id)
        t0 = time.monotonic()
        final_status = "running"
        while time.monotonic() - t0 < TIMEOUT_S:
            time.sleep(5)
            conn = _db()
            row = conn.execute("SELECT status,progress FROM research_tasks WHERE task_id=?",
                               (task_id,)).fetchone()
            conn.close()
            if row is None:
                _fail("任务不存在"); break
            final_status = row["status"]
            print(f"  t={time.monotonic() - t0:6.1f}s status={final_status} progress={row['progress']}",
                  flush=True)
            if final_status in ("review", "ready", "failed", "stopped"):
                break
        else:
            final_status = "timeout"
        duration = time.monotonic() - t0
    else:
        print("BASE:", BASE)
        _register(sess)
        task_id = _create_task(sess)
        final_status, duration = _wait_done(sess, task_id)
    print("DURATION:", round(duration, 1), "s; final status:", final_status)
    _verify(task_id, final_status, duration)
    if FAILURES:
        print(f"E2E FAILED ({len(FAILURES)} issues)")
        return 1
    print("E2E OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
