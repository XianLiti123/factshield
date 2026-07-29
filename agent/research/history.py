import json
from typing import Callable

from langchain_core.messages import HumanMessage

from ..core.loop import get_llm_client
from . import prompts, store
from .pipeline import _llm_json, _search

#历史情景时序统计单元（方案 SubAgent 6）：
#只做公开时序数据的查询与客观统计，禁止总结规律、预判趋势、给出解读结论。
#产物是结构化数据点（前端绘图用）+ 可选加入底稿附件 A

MAX_EVENTS = 3        #历史事件样本上限
MAX_POINTS = 8        #单事件数据点上限


def run_history_analysis(task_id: str, user_id: int, emit: Callable) -> None:
    #执行一次历史情景时序统计（后台线程调用，事件经 emit 落 task_events 表）
    task = store.get_task(task_id, user_id)
    if task is None:
        raise ValueError(f"任务不存在: {task_id}")
    llm = get_llm_client(user_id)

    emit("history", "progress", title="启动历史情景统计",
         speech="正在挑选与研究主题同类型的历史事件样本。", details=[], metrics=[], progress=None)

    #1. 选事件：LLM 按主题挑选同类历史事件与统计指标
    claims_text = "\n".join(f"- {c['statement']}" for c in store.list_claims(task_id))[:2000]
    plan = _llm_json(llm, prompts.HISTORY_PLAN_PROMPT.format(
        topic=task["topic"], claims=claims_text or "（暂无）"))
    metric = str(plan.get("metric") or task["topic"])
    unit = str(plan.get("unit") or "")
    planned = [e for e in plan.get("events", []) if e.get("search_query")][:MAX_EVENTS]
    if not planned:
        raise RuntimeError("未能挑选出可用于统计的历史事件样本")

    emit("history", "progress", title="事件样本已确定",
         speech=f"将对 {len(planned)} 个历史事件统计指标「{metric}」。",
         details=[{"label": e.get("name", ""), "text": e.get("period", "")} for e in planned],
         metrics=[], progress=None)

    #2. 取数据：逐事件检索 + LLM 抽取时序数据点（只抽检索文本中明确出现的数值）
    events = []
    total_points = 0
    for e in planned:
        name = str(e.get("name", ""))
        try:
            result = _search.invoke({"query": str(e["search_query"])})
            items = result.get("results", []) if isinstance(result, dict) else []
        except Exception:
            items = []
        search_text = "\n\n".join(
            f"{it.get('title', '')}: {it.get('content', '')}" for it in items)[:4000]
        if not search_text.strip():
            continue
        try:
            data = _llm_json(llm, prompts.HISTORY_EXTRACT_PROMPT.format(
                event_name=name, metric=metric, unit=unit or "数值", search_results=search_text))
        except RuntimeError:
            continue
        points = []
        for p in data.get("points", [])[:MAX_POINTS]:
            try:
                points.append({"t": str(p["t"]), "value": float(p["value"])})
            except (KeyError, TypeError, ValueError):
                continue  #丢弃无法解析为数值的数据点
        if not points:
            continue
        total_points += len(points)
        events.append({"name": name, "period": str(e.get("period", "")),
                       "description": str(data.get("description", "")),
                       "points": points})
    if not events:
        raise RuntimeError("未能从公开信源抽取到任何时序数据点")

    #3. 完整度 = 实际取得数据点 / 期望数据点
    payload = {"metric": metric, "unit": unit, "events": events,
               "completeness": round(total_points / (len(planned) * MAX_POINTS), 2)}
    store.save_analysis(task_id, metric, unit, payload)
    emit("history", "done", title="历史情景统计完成",
         speech=f"已完成 {len(events)} 个事件样本、共 {total_points} 个数据点的客观统计，可加入研究底稿附件。",
         details=[{"label": e["name"], "text": f"{e['period']}，{len(e['points'])} 个数据点"} for e in events],
         metrics=[{"label": "数据完整度", "value": f"{payload['completeness'] * 100:.0f}%"}],
         progress=None)
