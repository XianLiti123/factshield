"""研究流水线修复自测（不联网、不调 LLM）。

运行方式（conda 环境 suanfa_learning）：
    conda run -n suanfa_learning python -m agent.research.selftest

覆盖：
- _parse_json_loose：空串/围栏/首尾杂文/非法 JSON
- extract_web_search_calls：0 来源 search、open_page 分组、空 query、去重
- VERIFY_PROMPT：不再输出 need_retry/retry_keywords（单轮核验契约）
- REVIEW_AGENT_PROMPT：强制 JSON、禁止空输出
- 研究图：不存在 verify -> collect 回环（二次取证循环已删除）
- research_step_logs / agent_tool_traces 新列可写
"""

from __future__ import annotations


def _test_parse_json_loose() -> list[str]:
    from .pipeline import _parse_json_loose
    failures: list[str] = []

    def ok(text: str, expect_key: str) -> None:
        try:
            data = _parse_json_loose(text)
            if expect_key not in data:
                failures.append(f"parse({text[:30]!r}) 缺少 {expect_key}: {data}")
        except Exception as e:  # noqa: BLE001
            failures.append(f"parse({text[:30]!r}) 抛异常: {e}")

    def bad(text: str) -> None:
        try:
            _parse_json_loose(text)
            failures.append(f"parse({text[:30]!r}) 应当失败但没有")
        except Exception:  # noqa: BLE001
            pass

    ok('{"a": 1}', "a")
    ok('```json\n{"a": 1}\n```', "a")
    ok('说明文字 {"a": 1} 结尾文字', "a")
    ok('{"reviews": [{"claim_id": "c1"}]}', "reviews")
    bad("")
    bad("没有 JSON")
    bad("{broken")
    bad("```json\n{broken}\n```")
    return failures


def _test_extract_web_search_calls() -> list[str]:
    from ..llm.responses import extract_web_search_calls
    failures: list[str] = []

    def check(blocks: list[dict], expect: list[dict]) -> None:
        got = extract_web_search_calls(blocks)
        if got != expect:
            failures.append(f"extract 结果不符\ngot={got}\nexpect={expect}")

    #1) 只有 search 动作、无 open_page：保留 0 来源记录（调用方负责补搜）
    check(
        [{"type": "web_search_call", "action": {"type": "search", "queries": ["NVIDIA H20"]}}],
        [{"query": "NVIDIA H20", "urls": [], "status": "completed"}],
    )
    #2) search + open_page 归入同一卡片，且去掉 #ws_call_id 后缀、URL 去重
    check(
        [
            {"type": "web_search_call",
             "action": {"type": "search", "queries": ["NVIDIA", "ws_call_id=1"]}},
            {"type": "web_search_call",
             "action": {"type": "open_page", "url": "https://a.com#ws_call_id=1"}},
            {"type": "web_search_call",
             "action": {"type": "open_page", "url": "https://a.com#ws_call_id=2"}},
            {"type": "web_search_call",
             "action": {"type": "open_page", "url": "https://b.com"}},
        ],
        [{"query": "NVIDIA", "urls": ["https://a.com", "https://b.com"],
          "status": "completed"}],
    )
    #3) 空 query 的 search：query 为空串，来源照常记录
    check(
        [{"type": "web_search_call", "action": {"type": "search", "queries": ["ws_call_id=1"]}},
         {"type": "web_search_call", "action": {"type": "open_page", "url": "https://x.com"}}],
        [{"query": "", "urls": ["https://x.com"], "status": "completed"}],
    )
    return failures


def _test_prompt_contracts() -> list[str]:
    from .. import prompts
    failures: list[str] = []
    if "need_retry" in prompts.VERIFY_PROMPT or "retry_keywords" in prompts.VERIFY_PROMPT:
        failures.append("VERIFY_PROMPT 仍包含 need_retry/retry_keywords，单轮核验契约被破坏")
    if "不要输出任何多余文字" not in prompts.REVIEW_AGENT_PROMPT:
        failures.append("REVIEW_AGENT_PROMPT 缺少强制 JSON 约束")
    if "禁止" not in prompts.REVIEW_AGENT_PROMPT or "空" not in prompts.REVIEW_AGENT_PROMPT:
        failures.append("REVIEW_AGENT_PROMPT 缺少禁止空输出约束")
    if "覆盖" not in prompts.COVERAGE_CHECK_PROMPT:
        failures.append("COVERAGE_CHECK_PROMPT 缺失")
    return failures


def _test_graph_contracts() -> list[str]:
    from .pipeline import build_research_graph
    failures: list[str] = []
    graph = build_research_graph()
    try:
        edges = graph.get_graph().edges
    except Exception as e:  # noqa: BLE001
        failures.append(f"无法读取图边: {e}")
        return failures
    edge_pairs = [(str(e.source), str(e.target)) for e in edges]
    if ("verify", "collect") in edge_pairs:
        failures.append("图中仍存在 verify -> collect 二次取证回环")
    required = ["plan", "collect", "parse", "retrieve", "deepen", "score", "verify", "review", "assemble"]
    nodes = {str(n) for n in graph.get_graph().nodes}
    for n in required:
        if n not in nodes:
            failures.append(f"图中缺少节点 {n}")
    return failures


def _test_step_logs_table() -> list[str]:
    from ..session.db import init_db
    from . import store
    init_db()
    failures: list[str] = []
    with store.get_connection() as conn:
        try:
            cols = [r["name"] for r in conn.execute("PRAGMA table_info(research_step_logs)").fetchall()]
        except Exception as e:  # noqa: BLE001
            failures.append(f"research_step_logs 表不可用: {e}")
            return failures
        for need in ("task_id", "node", "attempt", "status", "llm_calls",
                     "prompt_tokens", "completion_tokens", "error"):
            if need not in cols:
                failures.append(f"research_step_logs 缺少列 {need}")
        try:
            cols = [r["name"] for r in conn.execute("PRAGMA table_info(agent_tool_traces)").fetchall()]
        except Exception as e:  # noqa: BLE001
            failures.append(f"agent_tool_traces 表不可用: {e}")
            return failures
        for need in ("duration_ms", "status"):
            if need not in cols:
                failures.append(f"agent_tool_traces 缺少列 {need}")
    #写入/回读一次，验证新列可写
    log_id = store.start_step_log("__selftest__", "plan", "node", 1, {"k": "v"})
    store.finish_step_log(log_id, status="ok", duration_ms=1, llm_calls=2,
                          prompt_tokens=10, completion_tokens=5, result_summary="ok")
    rows = store.list_step_logs("__selftest__")
    if not rows or rows[-1]["llm_calls"] != 2:
        failures.append("research_step_logs 写入/回读失败")
    with store.get_connection() as conn:
        conn.execute("DELETE FROM research_step_logs WHERE task_id='__selftest__'")
    return failures


def main() -> int:
    tests = [
        ("parse_json_loose", _test_parse_json_loose),
        ("extract_web_search_calls", _test_extract_web_search_calls),
        ("prompt_contracts", _test_prompt_contracts),
        ("graph_contracts", _test_graph_contracts),
        ("step_logs_table", _test_step_logs_table),
    ]
    failed = 0
    for name, fn in tests:
        try:
            failures = fn()
        except Exception as e:  # noqa: BLE001
            failures = [f"测试执行异常: {type(e).__name__}: {e}"]
        if failures:
            failed += 1
            print(f"[FAIL] {name}")
            for f in failures:
                print("   -", f)
        else:
            print(f"[PASS] {name}")
    print("SELFTEST", "FAILED" if failed else "OK", f"({len(tests) - failed}/{len(tests)} passed)")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
