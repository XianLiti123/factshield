#智能体名册与 DTO 序列化：字段名与前端 ui/src/types.ts 一一对应

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
        "url": row["url"],
    }


def _fmt_duration(seconds: float) -> str:
    #耗时格式化：60 秒内显秒，否则显分秒
    s = max(1, int(seconds))
    if s < 60:
        return f"{s}秒"
    return f"{s // 60}分{s % 60}秒"


def agents_status(task: dict, events: list[dict]) -> list[dict]:
    #由事件流推导各智能体状态：出现过→done；最新一条进度事件的 actor→running；未出现→waiting
    #耗时按"时间片归属"累加：相邻两条事件之间的时间记在后者 actor 头上（多数节点只在完成时发一条事件，
    #首末事件相减会是 0，故不能用 actor 自己的首末事件差）
    from datetime import datetime

    def _parse_ts(ts: object):
        try:
            return datetime.strptime(str(ts), "%Y-%m-%d %H:%M:%S")
        except (ValueError, TypeError):
            return None

    seen = {e["actor"] for e in events}
    current = None
    if task["status"] == "running" and events:
        current = events[-1]["actor"]
    has_conflict = any(e["actor"] == "reviewer" and e["kind"] == "warning" for e in events)

    durations: dict[str, float] = {}
    prev = _parse_ts(task.get("created_at"))
    for e in events:
        ts = _parse_ts(e["ts"])
        if ts is None:
            continue
        if prev is not None:
            gap = (ts - prev).total_seconds()
            #间隙超 5 分钟视为等待人工的空档（隔夜重取证等），不计入任何智能体的工时
            if 0 < gap <= 300:
                durations[e["actor"]] = durations.get(e["actor"], 0.0) + gap
        prev = ts
    if current is not None and prev is not None:  #正在运行的节点：末条事件到现在的时间也记给它
        gap = (datetime.now() - prev).total_seconds()
        if 0 < gap <= 300:
            durations[current] = durations.get(current, 0.0) + gap

    def duration_of(aid: str) -> str | None:
        if aid not in seen:
            return None
        return _fmt_duration(durations.get(aid, 0.0))

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
               ce_map: dict[str, list[str]], events: list[dict]) -> dict:
    #聚合 ResearchRun：任务 + 主张 + 证据 + 智能体状态
    return {
        "id": task["task_id"],
        "title": task["title"],
        "company": task["company"],
        "status": task["status"],
        "progress": task["progress"],
        "createdAt": task["created_at"],
        "claims": [claim_to_dto(c, ce_map.get(c["id"], [])) for c in claims],
        "evidence": [evidence_to_dto(e) for e in evidence],
        "agents": agents_status(task, events),
    }
