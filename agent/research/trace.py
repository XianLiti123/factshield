"""研究流水线子智能体执行过程查询。

把任务级已持久化的数据（事件时间线 / 子智能体工具调用轨迹 / 主张 / 证据 /
素材 / 底稿 / 错误记录）按"某个 Agent"归并成一份完整执行过程，
供 GET /tasks/{task_id}/agents/{agent} 使用。
"""
from __future__ import annotations

import json

from . import store

#子智能体注册表（查询白名单）
#event_actors: 该智能体在 task_events 中产出事件使用的 actor（可多个）
#title_contains: 事件 payload.title 必须包含的片段（用于区分同 actor 的不同智能体，如 deepen）
#nodes: 对应流水线节点名（flow_errors.node 过滤用）
AGENT_REGISTRY: dict[str, dict] = {
    "supervisor": {"label": "主控（Supervisor）", "event_actors": ("supervisor",),
                   "title_contains": (), "nodes": ("plan", "verify", "assemble")},
    "collector": {"label": "采集员", "event_actors": ("collector",),
                  "title_contains": (), "nodes": ("collect",)},
    "deepener": {"label": "定向深挖员", "event_actors": ("retriever",),
                 "title_contains": ("深挖",), "nodes": ("deepen",)},
    "parser": {"label": "解析员（主张提取）", "event_actors": ("parser",),
               "title_contains": (), "nodes": ("parse",)},
    "retriever": {"label": "检索员（证据匹配）", "event_actors": ("retriever",),
                  "title_contains": (), "nodes": ("retrieve",)},
    "scorer": {"label": "信源打分员", "event_actors": ("scorer",),
               "title_contains": (), "nodes": ("score",)},
    "reviewer": {"label": "独立幻觉审查员", "event_actors": ("reviewer",),
                 "title_contains": (), "nodes": ("review",)},
    "assembler": {"label": "底稿拼装员", "event_actors": ("assembler",),
                  "title_contains": (), "nodes": ("assemble",)},
    "researcher": {"label": "研究员（人工介入）", "event_actors": ("researcher",),
                   "title_contains": (), "nodes": ()},
    "history": {"label": "历史情景统计员", "event_actors": ("history",),
                "title_contains": (), "nodes": ("history",)},
}


def _event_matches(meta: dict, event: dict) -> bool:
    #事件归属判断：actor 命中，且（如配置了）payload.title 包含指定片段
    if event["actor"] not in meta["event_actors"]:
        return False
    contains = meta.get("title_contains")
    if not contains:
        return True
    title = str((event.get("payload") or {}).get("title", ""))
    return any(k in title for k in contains)


def list_agent_summaries(task_id: str) -> list[dict]:
    #列出任务里全部子智能体的执行量（事件数/工具调用数），供列表接口使用
    events = store.list_events(task_id)
    traces = store.list_tool_traces(task_id)
    trace_counts: dict[str, int] = {}
    for t in traces:
        trace_counts[t["actor"]] = trace_counts.get(t["actor"], 0) + 1
    result = []
    for agent_id, meta in AGENT_REGISTRY.items():
        event_count = sum(1 for e in events if _event_matches(meta, e))
        result.append({
            "id": agent_id,
            "label": meta["label"],
            "event_count": event_count,
            "tool_call_count": trace_counts.get(agent_id, 0),
        })
    return result


def _claim_light(c: dict) -> dict:
    return {k: c.get(k) for k in (
        "id", "statement", "category", "status", "confidence", "supervisor_verdict",
        "issue_type", "reviewer_verdict", "conflict_reason", "human_action", "updated_at")}


def _material_light(m: dict, max_content: int = 400) -> dict:
    #素材正文截断返回，避免一次查询把整库原文带出去
    return {k: m.get(k) for k in (
        "id", "group_id", "title", "publisher", "url", "source_type",
        "credibility", "credibility_level", "created_at")} | {
        "content": str(m.get("content") or "")[:max_content]}


def _agent_errors(user_id: int, task_id: str, nodes: tuple[str, ...]) -> list[dict]:
    #该智能体相关的错误与修复记录（按节点名过滤；节点名缺失视为不属于任何节点）
    try:
        from ..failures import list_errors
        rows = list_errors(user_id, flow_id=task_id).get("errors", [])
    except Exception:  # noqa: BLE001
        return []
    if not nodes:
        return [e for e in rows if not e.get("node")]
    return [e for e in rows if e.get("node") in nodes]


def _agent_artifacts(agent: str, task: dict, events: list[dict], claims: list[dict],
                     evidence: list[dict], ce_map: dict[str, list[str]],
                     materials: list[dict]) -> dict:
    #按智能体职责归并其"产出物"（事件之外的落库结果）
    if agent == "supervisor":
        plan = {}
        for e in events:
            if e["actor"] == "supervisor" and str(e["payload"].get("title", "")).startswith("任务拆解"):
                p = e["payload"]
                plan = {
                    "title": task.get("title", ""),
                    "checkpoints": [d.get("text", "") for d in p.get("details") or []],
                    "keywords": next((m.get("value", "") for m in (p.get("metrics") or [])
                                      if m.get("label") == "检索关键词"), ""),
                }
                break
        return {
            "plan": plan,
            "claims": [_claim_light(c) for c in claims],
            "guidance": [e["payload"] for e in events if e["actor"] == "researcher"],
        }
    if agent in ("collector", "deepener"):
        return {"materials": [_material_light(m) for m in materials]}
    if agent == "parser":
        return {"claims": [_claim_light(c) for c in claims]}
    if agent == "retriever":
        by_id = {e["id"]: e for e in evidence}
        return {"claims_with_evidence": [{
            "claim_id": c["id"], "statement": c["statement"],
            "evidence": [{
                "id": eid, "quote": by_id[eid]["quote"], "relation": by_id[eid]["relation"],
                "publisher": by_id[eid]["publisher"], "url": by_id[eid]["url"],
                "credibility_level": by_id[eid]["credibility_level"],
            } for eid in ce_map.get(c["id"], []) if eid in by_id],
        } for c in claims]}
    if agent == "scorer":
        return {"materials": [_material_light(m) for m in materials]}
    if agent == "reviewer":
        return {"reviews": [{
            "claim_id": c["id"], "statement": c["statement"], "status": c["status"],
            "reviewer_verdict": c["reviewer_verdict"], "conflict_reason": c["conflict_reason"],
        } for c in claims]}
    if agent == "assembler":
        return {"summary_md": task.get("summary_md", ""),
                "report_md": task.get("report_md") or "",
                "report_status": task.get("status", "")}
    if agent == "researcher":
        return {"guidance": [e["payload"] for e in events if e["actor"] == "researcher"]}
    if agent == "history":
        return {"latest_analysis": store.get_latest_analysis(task["task_id"])}
    return {}


def _agent_inputs(task: dict, agent: str) -> dict:
    #该智能体启动时拿到的输入（来自任务快照，供审计时还原上下文）
    base = {
        "topic": task.get("topic", ""),
        "company": task.get("company", ""),
        "research_type": task.get("research_type", ""),
        "preferred_sources": task.get("preferred_sources", []),
    }
    if agent == "supervisor":
        base["attachments"] = [
            {"filename": u["filename"]} for u in store.list_uploads(task["task_id"])
        ]
    return base


def get_agent_execution(task_id: str, user_id: int, agent: str) -> dict | None:
    #归并某个子智能体的完整执行过程；agent 不在注册表或任务不存在时返回 None
    meta = AGENT_REGISTRY.get(agent)
    if meta is None:
        return None
    task = store.get_task(task_id, user_id)
    if task is None:
        return None
    events = store.list_events(task_id)
    claims = store.list_claims(task_id)
    evidence = store.list_evidence(task_id)
    ce_map = store.claim_evidence_ids(task_id)
    materials = store.list_materials(task_id)
    timeline = [e for e in events if _event_matches(meta, e)]
    tool_calls = store.list_tool_traces(task_id, actor=agent)
    for t in tool_calls:
        try:
            t["args"] = json.loads(t["args"])
        except (TypeError, ValueError):
            t["args"] = {}
    return {
        "task_id": task_id,
        "agent": agent,
        "agent_label": meta["label"],
        "task_status": task.get("status", ""),
        "progress": task.get("progress", 0),
        "inputs": _agent_inputs(task, agent),
        "timeline": timeline,
        "tool_calls": tool_calls,
        "artifacts": _agent_artifacts(agent, task, events, claims, evidence, ce_map, materials),
        "errors": _agent_errors(user_id, task_id, meta["nodes"]),
    }
