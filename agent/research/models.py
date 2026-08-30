"""智能体名册与 DTO 序列化。

- AGENT_ROSTER：拓扑固定的子智能体名册（字段名与前端 ui/src/types.ts 一一对应）。
- STATUS_LABEL：主张可信度状态标签（verified/review/conflict）。
- claim_to_dto / evidence_to_dto：主张与证据记录的 API 传输对象（DTO）序列化。
"""

#拓扑固定的智能体名册（历史情景复盘单元本期未启用）
AGENT_ROSTER = [
    {"id": "supervisor", "name": "小盾", "role": "Supervisor 主控",
     "restriction": "只负责调度与核验判断，不亲自采集、解析"},
    {"id": "collector", "name": "采集员", "role": "公开信源采集",
     "restriction": "只抓取公开披露信息并保存原始快照，禁止解读"},
    {"id": "parser", "name": "解析员", "role": "文档解析与主张提取",
     "restriction": "只提取原文主张与指标，禁止延伸推理"},
    {"id": "retriever", "name": "检索员", "role": "向量证据检索",
     "restriction": "只做检索匹配，禁止判断观点真伪"},
    {"id": "scorer", "name": "评分员", "role": "信源可信度打分",
     "restriction": "只输出可信度标签，禁止据此判定真假"},
    {"id": "history", "name": "统计员", "role": "历史情景时序统计",
     "restriction": "只做客观时序数据查询与统计，禁止解读与预判"},
    {"id": "reviewer", "name": "审查员", "role": "独立幻觉审查",
     "restriction": "独立于采集链路，只做二级复核与可信度分级"},
    {"id": "assembler", "name": "组装员", "role": "底稿组装",
     "restriction": "只按模板组装已核验素材，禁止增删内容"},
]

#节点 actor -> 名册 id 一致；researcher/system 为虚拟角色（人工介入、系统提示），不在名册中

STATUS_LABEL = {"verified": "核验通过", "review": "待复核", "conflict": "高度存疑"}


def claim_to_dto(row: dict, evidence_ids: list[str]) -> dict:
    return {
        "id": row["id"],
        "index": row["idx"],
        "statement": row["statement"],
        "status": row["status"],
        "confidence": row["confidence"],
        "category": row["category"],
        "supervisorVerdict": row["supervisor_verdict"],
        "reviewerVerdict": row["reviewer_verdict"],
        "conflictReason": row["conflict_reason"],
        "issueType": row["issue_type"],
        "humanAction": row["human_action"],
        "humanNote": row["human_note"],
        "evidenceIds": evidence_ids,
    }


def evidence_to_dto(row: dict) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "publisher": row["publisher"],
        "publishedAt": row["published_at"],
        "locator": row["locator"],
        "quote": row["quote"],
        "sourceType": row["source_type"],
        "relation": row["relation"],
        "credibility": row["credibility"],
        "credibilityLevel": row["credibility_level"],  #来源可信度三档：高/中/低
        "relevance": row["relevance"],  #检索相关性分数（reranker/RRF），证据排序依据
        "url": row["url"],
    }


def _fmt_duration(seconds: float) -> str:
    #耗时格式化：60 秒内显秒，否则显分秒
    s = max(1, int(seconds))
    if s < 60:
        return f"{s}秒"
    return f"{s // 60}分{s % 60}秒"


def agents_status(task: dict, events: list[dict],
                  node_runs: list[dict] | None = None) -> list[dict]:
    #由事件流推导各智能体状态：出现过→done；正在执行→running；未出现→waiting
    #运行时间优先取 task_node_runs 的真实节点耗时（按注册表 node->智能体 聚合，重试累加）；
    #节点未记录（历史任务/非图节点）时回退到"事件时间片"估算：相邻两条事件之间的间隙
    #记到后一条事件所属的智能体头上（事件归属与 trace 同口径，深挖等事件能正确归位）
    from datetime import datetime

    from .trace import AGENT_REGISTRY

    def _parse_ts(ts: object):
        try:
            return datetime.strptime(str(ts), "%Y-%m-%d %H:%M:%S")
        except (ValueError, TypeError):
            return None

    def _agent_of_event(event: dict) -> str | None:
        #事件 -> 智能体（注册表顺序保证 title_contains 更具体的先命中）
        for aid, meta in AGENT_REGISTRY.items():
            if event["actor"] not in meta["event_actors"]:
                continue
            contains = meta.get("title_contains")
            if not contains:
                return aid
            title = str((event.get("payload") or {}).get("title", ""))
            if any(k in title for k in contains):
                return aid
        return None

    seen = {aid for e in events if (aid := _agent_of_event(e))}
    has_conflict = any(e["actor"] == "reviewer" and e["kind"] == "warning" for e in events)

    #真实节点耗时聚合（优先）
    node_agent = {node: aid for aid, meta in AGENT_REGISTRY.items() for node in meta["nodes"]}
    recorded: dict[str, float] = {}
    running_start: dict[str, datetime] = {}
    for r in node_runs or []:
        aid = node_agent.get(r.get("node"))
        if aid is None:
            continue
        duration = r.get("duration")
        if duration is not None:
            recorded[aid] = recorded.get(aid, 0.0) + float(duration)
        else:
            started = _parse_ts(r.get("started_at"))
            if started is not None:
                running_start[aid] = started  #同节点重试多次时保留最近一次未完成的开始时刻

    current = None
    if task["status"] == "running":
        if running_start:
            current = next(iter(running_start))  #有未完成的节点执行 → 该智能体正在运行
        elif events:
            current = _agent_of_event(events[-1]) or events[-1]["actor"]

    def _heuristic_duration() -> dict[str, float]:
        #回退估算：间隙归属到后一条事件对应的智能体；>5 分钟视为人工空档不计入
        durations: dict[str, float] = {}
        prev = _parse_ts(task.get("created_at"))
        for e in events:
            ts = _parse_ts(e["ts"])
            if ts is None:
                continue
            aid = _agent_of_event(e)
            if prev is not None and aid is not None:
                gap = (ts - prev).total_seconds()
                if 0 < gap <= 300:
                    durations[aid] = durations.get(aid, 0.0) + gap
            prev = ts
        if current is not None and prev is not None:
            gap = (datetime.now() - prev).total_seconds()
            if 0 < gap <= 300:
                durations[current] = durations.get(current, 0.0) + gap
        return durations

    heuristic = None

    def duration_of(aid: str) -> str | None:
        nonlocal heuristic
        if aid not in seen:
            return None
        if aid in recorded or aid in running_start:
            total = recorded.get(aid, 0.0)
            if aid == current and aid in running_start:
                total += (datetime.now() - running_start[aid]).total_seconds()
            return _fmt_duration(max(0.0, total))
        if heuristic is None:
            heuristic = _heuristic_duration()
        return _fmt_duration(heuristic.get(aid, 0.0))

    agents = []
    for spec in AGENT_ROSTER:
        aid = spec["id"]
        if aid == current:
            status = "running"
        elif aid == "reviewer" and has_conflict:
            status = "warning"
        elif aid in seen:
            status = "done"
        else:
            status = "waiting"
        agents.append({**spec, "status": status, "detail": "", "duration": duration_of(aid)})
    return agents


def run_to_dto(task: dict, claims: list[dict], evidence: list[dict],
               ce_map: dict[str, list[str]], events: list[dict],
               node_runs: list[dict] | None = None) -> dict:
    #聚合 ResearchRun：任务 + 主张 + 证据 + 智能体状态
    from ..questions import list_questions, question_to_dto  #延迟导入，避免加载顺序问题
    pending = list_questions(task_id=task["task_id"], status="pending")
    return {
        "id": task["task_id"],
        "title": task["title"],
        "company": task["company"],
        "status": task["status"],
        "progress": task["progress"],
        "createdAt": task["created_at"],
        "claims": [claim_to_dto(c, ce_map.get(c["id"], [])) for c in claims],
        "evidence": [evidence_to_dto(e) for e in evidence],
        "agents": agents_status(task, events, node_runs),
        "waitingQuestion": question_to_dto(pending[0]) if pending else None,
    }
