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

_FREQUENCY_LABELS = {"monthly": "月度", "quarterly": "季度", "yearly": "年度"}


def _normalize_config(config: dict | None) -> dict | None:
    #清洗用户比较口径：去空白、裁剪空项；全部为空则视为 None（完全由系统推荐）
    if not config:
        return None
    cleaned = {
        "metric": (config.get("metric") or "").strip() or None,
        "scenarios": [s.strip() for s in config.get("scenarios") or [] if s and s.strip()][:MAX_EVENTS],
        "start": (config.get("start") or "").strip() or None,
        "end": (config.get("end") or "").strip() or None,
        "frequency": config.get("frequency") if config.get("frequency") in _FREQUENCY_LABELS else "auto",
    }
    if not any([cleaned["metric"], cleaned["scenarios"], cleaned["start"],
                cleaned["end"], cleaned["frequency"] != "auto"]):
        return None
    return cleaned


def _constraints_text(config: dict) -> str:
    #把用户口径渲染成 plan 提示词里的约束段（优先级高于模型自主判断）
    lines = []
    if config["metric"]:
        lines.append(f"- 比较指标固定为「{config['metric']}」，输出中的 metric 字段必须原样使用它，只需给出匹配的单位")
    if config["scenarios"]:
        lines.append(f"- 事件样本必须围绕用户指定的场景：{'、'.join(config['scenarios'])}；每个场景各选一个最具代表性的真实历史事件")
    if config["start"] or config["end"]:
        lines.append(f"- 观察时间范围限定在 {config['start'] or '不限'} 至 {config['end'] or '不限'}，事件 period 与数据须落在该范围内")
    if config["frequency"] != "auto":
        lines.append(f"- 统计频率按{_FREQUENCY_LABELS[config['frequency']]}口径，search_query 中体现对应频率的公开数据来源")
    return "用户指定的比较口径（优先级高于你的自主判断，必须遵守）：\n" + "\n".join(lines) + "\n"


def _parse_year_month(t: str) -> tuple[int, int] | None:
    #解析 "2018-01"/"2018" 形式的时间点，无法解析返回 None
    import re
    m = re.match(r"\s*(\d{4})(?:\D(\d{1,2}))?", t)
    if not m:
        return None
    return (int(m.group(1)), int(m.group(2) or 1))


def run_history_analysis(task_id: str, user_id: int, emit: Callable, config: dict | None = None) -> None:
    #执行一次历史情景时序统计（后台线程调用，事件经 emit 落 task_events 表）
    #config 为用户自定义比较口径（指标/场景/时间范围/频率），None 表示完全由系统推荐
    config = _normalize_config(config)
    task = store.get_task(task_id, user_id)
    if task is None:
        raise ValueError(f"任务不存在: {task_id}")
    llm = get_llm_client(user_id)

    emit("history", "progress", title="启动历史情景统计",
         speech="正在挑选与研究主题同类型的历史事件样本。" if not config else "正在按你指定的比较口径挑选历史事件样本。",
         details=[], metrics=[], progress=None)

    #1. 选事件：LLM 按主题（及用户口径）挑选同类历史事件与统计指标
    claims_text = "\n".join(f"- {c['statement']}" for c in store.list_claims(task_id))[:2000]
    plan = _llm_json(llm, prompts.HISTORY_PLAN_PROMPT.format(
        topic=task["topic"], claims=claims_text or "（暂无）",
        user_constraints=_constraints_text(config) if config else ""))
    #用户指定指标时以用户为准（提示词约束之外再兜底），单位取 LLM 给的
    metric = (config["metric"] if config and config["metric"]
              else str(plan.get("metric") or task["topic"]))
    unit = str(plan.get("unit") or "")
    planned = [e for e in plan.get("events", []) if e.get("search_query")][:MAX_EVENTS]
    if not planned:
        raise RuntimeError("未能挑选出可用于统计的历史事件样本")

    emit("history", "progress", title="事件样本已确定",
         speech=f"将对 {len(planned)} 个历史事件统计指标「{metric}」。",
         details=[{"label": e.get("name", ""), "text": e.get("period", "")} for e in planned],
         metrics=[], progress=None)

    #2. 取数据：逐事件检索 + LLM 抽取时序数据点（只抽检索文本中明确出现的数值）
    time_scope = (f"{config['start'] or '不限'} 至 {config['end'] or '不限'}，只抽取落在该范围内的数据点"
                  if config and (config["start"] or config["end"]) else "不限")
    frequency = (f"按{_FREQUENCY_LABELS[config['frequency']]}口径取值"
                 if config and config["frequency"] != "auto" else "不限，按检索文本中出现的时点取值")
    start_ym = _parse_year_month(config["start"]) if config and config["start"] else None
    end_ym = _parse_year_month(config["end"]) if config and config["end"] else None

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
                event_name=name, metric=metric, unit=unit or "数值",
                time_scope=time_scope, frequency=frequency, search_results=search_text))
        except RuntimeError:
            continue
        points = []
        for p in data.get("points", [])[:MAX_POINTS]:
            try:
                point = {"t": str(p["t"]), "value": float(p["value"])}
            except (KeyError, TypeError, ValueError):
                continue  #丢弃无法解析为数值的数据点
            ym = _parse_year_month(point["t"])
            if ym is not None:  #用户限定了时间范围时，丢弃落在范围外且可解析的数据点
                if start_ym and ym < start_ym:
                    continue
                if end_ym and ym > end_ym:
                    continue
            points.append(point)
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
    if config:
        payload["requested_config"] = config  #回显用户口径，供前端展示"本次采用的比较要求"
    store.save_analysis(task_id, metric, unit, payload)
    emit("history", "done", title="历史情景统计完成",
         speech=f"已完成 {len(events)} 个事件样本、共 {total_points} 个数据点的客观统计，可加入研究底稿附件。",
         details=[{"label": e["name"], "text": f"{e['period']}，{len(e['points'])} 个数据点"} for e in events],
         metrics=[{"label": "数据完整度", "value": f"{payload['completeness'] * 100:.0f}%"}],
         progress=None)
