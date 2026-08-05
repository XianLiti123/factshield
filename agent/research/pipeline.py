"""事实核查流水线：固定骨架 + 多子智能体（互相隔离，无通信边）。

流程：plan(主控拆解) -> collect(信源采集) -> parse(主张提取) -> retrieve(证据检索)
      -> score(信源打分) -> verify(主控一级核验，冲突时回 collect 二次取证)
      -> review(独立幻觉审查) -> assemble(底稿组装)

机制：
- 单节点失败按固定退避重启，耗尽抛 NodeFailedError 交由 runner 自动修复。
- 采集员/审查员均为受限工具集子智能体，各自只拿到本环节输入。
- 全程支持研究员介入（guidance）与手动终止（stop_event），进度只增不减。
"""

import json
import re
import threading
import time
from typing import Any, Callable, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, StateGraph

from ..llm.client import ChatClient
from ..llm.responses import extract_web_search_calls
from ..llm.text import content_to_text
from ..memory.vector_store.store import add_document
from ..memory.SQLite.db import get_connection as memory_conn
from ..searchengine import extract, search
from ..session.search_config import get_engine
from .. import prompts
from ..prompts import COLLECTOR_PROMPT, DEEPEN_PROMPT, REVIEW_AGENT_PROMPT
from ..questions import QuestionCancelled
from ..tools.ask_user import make_task_ask_tool
from ..tools.skill import use_skill
from . import store

#事实核查流水线（固定骨架 + LLM 判定）：
#plan(主控拆解) -> collect(信源采集) -> parse(主张提取) -> retrieve(证据检索)
#-> score(信源打分) -> verify(主控一级核验，冲突时回 collect 二次取证)
#-> review(独立幻觉审查) -> assemble(底稿组装)
#所有"子智能体"互相隔离：各自只拿到本环节的输入，产出结构化结果交回主控，彼此无通信边

MAX_CLAIMS = 8          #单任务主张上限，控制 LLM 调用规模
MAX_KEYWORDS = 4        #每次采集的关键词上限
MAX_MATERIALS = 8       #单轮采集素材上限
MAX_MATERIALS_TOTAL = 20  #含二次取证轮次的素材总量上限
ASK_MAX_ROUNDS = 3      #主控 JSON 节点最多 LLM 轮次（可提问 1~2 次后必须输出 JSON）

#金融研究框架：用于选择企业/政策分析框架并组织底稿模块
_COMPANY_HINTS = ("company", "enterprise", "经营质量", "企业", "公司", "基本面", "尽调", "财务")
_POLICY_HINTS = ("policy", "政策", "监管", "规定", "制度", "规则", "法规")
_COMPANY_MODULES = ["行业与产业链", "政策环境", "公司治理与团队", "技术核心能力",
                    "产品与市场", "财务表现", "风险与不确定性"]
_POLICY_MODULES = ["政策定位与主管部门", "核心条款与规则变化", "影响传导", "各方解读", "不确定性"]
_CATEGORY_TITLES = {
    "行业与产业链": "行业与产业链",
    "政策环境": "政策环境",
    "公司治理与团队": "公司治理与团队",
    "技术核心能力": "技术核心能力",
    "产品与市场": "产品与市场",
    "财务表现": "财务表现",
    "风险与不确定性": "风险与不确定性",
}

#来源可信度三档 -> 兼容数值（数值仅供排序与旧字段兼容，展示一律以等级为准）
_LEVEL_SCORE = {"高": 0.9, "中": 0.6, "低": 0.25}


def _parse_level(value: object) -> str:
    #把模型输出归一到 高/中/低 三档；无法识别时按"中"兜底
    text = str(value or "").strip().lower()
    if "高" in text or "high" in text:
        return "高"
    if "低" in text or "low" in text:
        return "低"
    return "中"
MAX_RETRY = 2           #冲突二次取证上限（重试纪律由 VERIFY_PROMPT 约束，仅数据矛盾/证据缺失时触发）
MAX_DEEPEN_CLAIMS = 4   #单次定向深挖的主张上限（按证据薄弱程度取前 N，每条补采 1 篇信源）


def _web_search(query: str, user_id: int, max_results: int = 3) -> list[dict]:
    #按用户选择的搜索引擎联网检索，返回 [{"title","url","content"}]；失败抛异常由调用方降级
    return search(query, get_engine(user_id), max_results=max_results, user_id=user_id)


def _web_extract(url: str, user_id: int) -> str:
    #按用户选择的搜索引擎提取网页正文；失败抛异常由调用方退化为搜索摘要
    return extract(url, get_engine(user_id), user_id=user_id)


class TaskStopped(Exception):
    #研究员终止任务：节点边界检查 stop_event 时抛出，由 runner 捕获收尾
    pass


class ResearchState(TypedDict, total=False):
    task_id: str
    user_id: int
    topic: str
    company: str
    research_type: str
    preferred_sources: list[str]
    title: str
    keywords: list[str]
    checkpoints: list[str]
    materials: list[dict]      #[{group_id,title,publisher,url,content}]
    claims: list[dict]         #[{id,statement,category}]
    retry_count: int
    need_retry: bool
    guidance: list[str]       #研究员中途介入指令（各节点边界消费并累计，verify 统一拼入提示词）


#节点（子智能体）重试机制：单节点失败按固定退避重启该节点（子智能体），重试耗尽后抛出
#NodeFailedError，由 runner 记录错误并触发流程级自动修复（重启整条流水线）
NODE_MAX_ATTEMPTS = 3              #单节点最大执行次数（1 次首次 + 2 次重试）
NODE_RETRY_DELAYS = (1.0, 2.0)     #逐次退避间隔（秒）


class NodeFailedError(Exception):
    #携带失败节点名与总尝试次数的包装异常，供 runner 记录错误与自动修复
    def __init__(self, node: str, cause: Exception, attempts: int):
        super().__init__(f"节点 {node} 执行失败: {cause}")
        self.node = node
        self.cause = cause
        self.attempts = attempts


def _node_with_retry(node: str, fn: Callable[[ResearchState, RunnableConfig], dict]) -> Callable:
    #给节点包一层重试：失败即重启该节点，重试耗尽抛 NodeFailedError；手动终止不重试。
    #每次实际执行都记录真实起止时间（task_node_runs），前端展示的 Agent 运行时间以此为准，
    #不再用"事件时间片"估算（多节点 Actor / 深挖等场景会算错）
    def wrapped(state: ResearchState, config: RunnableConfig) -> dict:
        last: Exception | None = None
        for attempt in range(NODE_MAX_ATTEMPTS):
            _check_stop(config)
            run_id = store.start_node_run(state["task_id"], node)
            t0 = time.monotonic()
            try:
                result = fn(state, config)
                store.finish_node_run(run_id, time.monotonic() - t0)
                return result
            except TaskStopped:
                store.finish_node_run(run_id, time.monotonic() - t0)
                raise
            except Exception as e:  # noqa: BLE001
                last = e
                store.finish_node_run(run_id, time.monotonic() - t0)
                if attempt < NODE_MAX_ATTEMPTS - 1:
                    time.sleep(NODE_RETRY_DELAYS[min(attempt, len(NODE_RETRY_DELAYS) - 1)])
        raise NodeFailedError(node, last, NODE_MAX_ATTEMPTS) from last  # type: ignore[arg-type]
    return wrapped


def _emit(config: RunnableConfig, actor: str, kind: str, **payload) -> None:
    #节点产事件：经 runner 注入的回调写库 + 推 SSE 队列
    #进度只增不减：二次取证等回退环节不会把进度条拉回去（地板值记录在运行配置里）
    p = payload.get("progress")
    if p is not None:
        floor = max(config["configurable"].get("progress_floor", 0), p)
        config["configurable"]["progress_floor"] = floor
        payload["progress"] = floor
    cb: Callable = config["configurable"]["emit"]
    cb(actor, kind, payload)


def _check_stop(config: RunnableConfig) -> None:
    stop: threading.Event = config["configurable"]["stop_event"]
    if stop.is_set():
        raise TaskStopped()


def _consume_guidance(config: RunnableConfig, task_id: str, progress: float) -> list[str]:
    #在节点边界消费研究员介入指令并立即播报（指令若攒到一级核验才消费，用户会以为"打断"没生效）
    guidance = store.consume_guidance(task_id)
    for g in guidance:
        _emit(config, "researcher", "progress", title="研究员介入", speech=g,
              details=[], metrics=[], tone="warning", progress=progress)
    return guidance


def _llm_json(llm: ChatClient, prompt: str, retries: int = 1) -> dict:
    #调 LLM 并解析 JSON 输出；容忍 markdown 代码块包裹与首尾多余文字，失败重试
    last_err: Exception | None = None
    for _ in range(retries + 1):
        try:
            text = str(llm.chat([HumanMessage(content=prompt)]))
            return _parse_json_loose(text)
        except Exception as e:
            last_err = e
    raise RuntimeError(f"LLM JSON 解析失败: {last_err}")


def _parse_json_loose(text: str) -> dict:
    #优先整体解析；其次去掉 markdown 代码块围栏；最后按首尾花括号截取
    text = text.strip()
    if text.startswith("```"):
        body = text.split("\n", 1)
        text = body[1].strip() if len(body) > 1 else text[len("```"):].strip()
        if text.endswith("```"):
            text = text[:-3].strip()
    try:
        return json.loads(text)
    except Exception:
        pass
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise ValueError(f"LLM 未输出 JSON: {text[:200]}")
    return json.loads(text[start:end + 1])


def _qa_context(task_id: str) -> str:
    #已答问题 -> 提示词片段，保证 Q&A 对后续节点全局可见且不重复提问
    from ..questions import list_questions
    qas = list_questions(task_id=task_id, status="answered")
    if not qas:
        return ""
    lines = ["【研究员已提供的补充信息】"]
    for q in qas:
        lines.append(f"- 问：{q['question']}")
        lines.append(f"  答：{q['answer']}")
    return "\n".join(lines)


def _framework_kind_of(*, research_type: str, topic: str, company: str) -> str | None:
    #按研究类型与主题关键词选择金融研究框架（企业/政策/通用）
    rt = str(research_type or "").lower()
    text = f"{topic} {company}".lower()
    if rt in ("company", "enterprise") or any(k in text for k in _COMPANY_HINTS):
        return "company"
    if rt in ("policy",) or any(k in text for k in _POLICY_HINTS):
        return "policy"
    return None


def _research_framework_guide(state: ResearchState) -> str:
    #把框架说明注入主控拆解提示词；不匹配时返回空串
    kind = _framework_kind_of(research_type=state.get("research_type", ""),
                              topic=state.get("topic", ""),
                              company=state.get("company", ""))
    if kind == "company":
        return prompts.COMPANY_ANALYSIS_FRAMEWORK
    if kind == "policy":
        return prompts.POLICY_ANALYSIS_FRAMEWORK
    return ""


def _ask_capable_json(state: ResearchState, config: RunnableConfig, prompt: str,
                      actor: str, node: str, retries: int = 1) -> dict:
    #主控 JSON 节点带 ask_user 的 LLM 调用：LLM 可先向研究员提问（阻塞等待答案），
    #得到回答后再输出 JSON；最多 ASK_MAX_ROUNDS 轮，防失控
    llm = _llm(config)
    ask_tool = make_task_ask_tool(
        state["task_id"], state["user_id"], actor, node,
        stop_event=config["configurable"]["stop_event"],
    )
    messages: list = [HumanMessage(content=prompt)]
    last_text = ""
    last_err: Exception | None = None
    for _ in range(retries + 1):
        for _round in range(ASK_MAX_ROUNDS):
            _check_stop(config)
            response = llm.invoke(messages, tools=[ask_tool, use_skill])
            calls = getattr(response, "tool_calls", None) or []
            text = content_to_text(response.content) if response.content else ""
            if text:
                last_text = text
            if not calls:
                try:
                    return _parse_json_loose(last_text)
                except Exception as e:  # noqa: BLE001
                    last_err = e
                    messages.append(HumanMessage(
                        content="上次输出不是合法 JSON，请只输出一个 JSON 对象，不要输出任何其他文字。"))
                    continue
            messages.append(response)
            for tc in calls:
                _check_stop(config)
                name, args = tc["name"], tc.get("args") or {}
                if name == "ask_user":
                    try:
                        result = str(ask_tool.invoke(args))
                    except QuestionCancelled as e:
                        raise TaskStopped() from e
                    #工具轨迹已由 make_task_ask_tool 内部写入，这里不重复记录
                elif name == "use_skill":
                    result = str(use_skill.invoke(args))
                    store.append_tool_trace(state["task_id"], actor, node, name, args, result)
                else:
                    result = f"未知工具: {name}"
                messages.append(ToolMessage(content=result, tool_call_id=tc["id"], name=name))
    raise RuntimeError(f"LLM JSON 解析失败: {last_err}")


def _llm(config: RunnableConfig) -> ChatClient:
    from ..core.loop import get_llm_client  #延迟导入，避免循环依赖
    return get_llm_client(config["configurable"]["user_id"])


# ---------------- 节点实现 ----------------

def plan_node(state: ResearchState, config: RunnableConfig) -> dict:
    #Supervisor 任务拆解：主题 -> 原子核查点 + 检索关键词
    _check_stop(config)
    guidance = state.get("guidance", []) + _consume_guidance(config, state["task_id"], 12)
    data = _ask_capable_json(state, config, prompts.PLAN_PROMPT.format(
        topic=state["topic"], company=state["company"] or "未指定",
        research_type=state["research_type"],
        sources="、".join(state["preferred_sources"]) or "无偏好",
        qa_context=_qa_context(state["task_id"]),
        framework=_research_framework_guide(state),
    ), actor="supervisor", node="plan")
    title = data.get("title") or state["topic"]
    keywords = [str(k) for k in data.get("keywords", [])][:MAX_KEYWORDS] or [state["topic"]]
    checkpoints = [str(c) for c in data.get("checkpoints", [])][:5]
    store.update_task(state["task_id"], title=title, progress=12)
    _emit(config, "supervisor", "progress",
          title="任务拆解完成", speech=f"已拆解为 {len(checkpoints)} 个核查点，准备定向采集公开信源。",
          details=[{"label": "核查点", "text": c} for c in checkpoints],
          metrics=[{"label": "检索关键词", "value": "、".join(keywords)}], progress=12)
    return {"title": title, "keywords": keywords, "checkpoints": checkpoints, "guidance": guidance}


def _ingest_material(task_id: str, seq: int, title: str, publisher: str, url: str, content: str) -> dict:
    #一份素材入库：正文切块进知识库（group_id 标任务归属）+ 登记元数据 + 落 task_materials
    group_id = f"task:{task_id}:{seq}"
    _, chunk_count = add_document(content, group_id=group_id)
    with memory_conn() as conn:  #登记知识库元数据，/knowledge/documents 可按任务回溯
        conn.execute("INSERT INTO documents (group_id, chunk_count) VALUES (?,?)",
                     (group_id, chunk_count))
    store.add_material(task_id, group_id, title, publisher, url, content=content)
    return {"group_id": group_id, "title": title, "publisher": publisher,
            "url": url, "content": content}


# ---------------- 采集员子智能体（受限工具集自主采集） ----------------
#采集节点不再由代码硬编码调搜索引擎，而是让"采集员"像对话 Agent 一样带工具自主取数：
#只给数据获取能力（联网检索/读网页/efinance 财报/TickFlow 行情/自定义数据源/入库），
#不给 terminal、subagent 等系统执行能力，保障后台无人监督下的安全与成本边界；
#轮次/素材数量均有硬上限，控制流仍由固定骨架保证（stop/进度/审计不受影响）

COLLECTOR_MAX_ROUNDS = 10  #采集员单任务最大工具调用轮次（成本上限）


def _make_collector_tools(task_id: str, user_id: int, new_count: dict,
                          stop_event, actor: str = "collector", node: str = "collect") -> list:
    #采集员工具集：全部以闭包绑定 task_id/user_id，避免 InjectedState 依赖
    from langchain_core.tools import tool as _mk_tool

    @_mk_tool
    def archive_material(title: str, publisher: str, url: str, content: str) -> str:
        """把一份采集到的材料（网页文章/财报数据/行情序列等）存入任务素材库，
        供后续主张提取与证据检索引用。采集到有价值内容时必须调用本工具入库。"""
        if len(store.list_materials(task_id)) >= MAX_MATERIALS_TOTAL:
            return f"素材已达总量上限 {MAX_MATERIALS_TOTAL} 份，无法继续入库"
        if new_count["n"] >= MAX_MATERIALS:
            return f"本轮新增已达上限 {MAX_MATERIALS} 份，停止入库（可下一轮任务再补）"
        if any(m["url"] and m["url"] == url for m in store.list_materials(task_id)):
            return f"该链接已入库（{url}），跳过重复"
        seq = len(store.list_materials(task_id)) + 1
        _ingest_material(task_id, seq, (title or url or "未命名材料")[:200],
                         publisher or "", url or "", (content or "")[:5000])
        new_count["n"] += 1
        return f"已入库，材料编号 {seq}（素材库现有 {len(store.list_materials(task_id))} 份）"

    @_mk_tool
    def web_search(query: str, max_results: int = 3) -> str:
        """联网搜索，返回结果列表（标题/链接/摘要）。query 为搜索词。"""
        max_results = max(1, min(int(max_results), 5))
        items = _web_search(query, user_id, max_results=max_results)
        return "\n\n".join(
            f"[{i}] {it.get('title', '')}\n链接: {it.get('url', '')}\n摘要: {str(it.get('content', ''))[:300]}"
            for i, it in enumerate(items, 1)
        ) or "没有找到相关结果"

    @_mk_tool
    def web_extract(url: str) -> str:
        """读取指定网页的正文内容（前 5000 字）。当搜索结果摘要不够详细时使用。"""
        try:
            return _web_extract(url, user_id)[:5000]
        except Exception as e:  # noqa: BLE001
            return f"网页读取失败: {e}"

    @_mk_tool
    def query_financials(stock_code: str, report_date: str = "") -> str:
        """查询 A 股上市公司财务数据（来源：东方财富 efinance），
        用于核验营业收入/净利润/ROE/毛利率等财务主张。stock_code 为 6 位 A 股代码。"""
        from ..tools.finance import query_stock_financials  #延迟导入，保持加载顺序
        return query_stock_financials.func(stock_code, report_date)

    @_mk_tool
    def query_kline(symbol: str, period: str = "1d", count: int = 30) -> str:
        """查询股票/指数/ETF 的历史 K 线行情（来源：TickFlow），
        用于核验股价/涨跌幅/历史走势类内容。symbol 如 600519.SH、AAPL.US。"""
        from ..tools.finance import query_stock_kline  #延迟导入，保持加载顺序
        return query_stock_kline.func(symbol, period, count)

    @_mk_tool
    def list_data_sources() -> str:
        """查看当前用户已启用并配置的自定义数据源（HTTP/Python SDK 接入规范），
        之后按规范取数；没有启用则返回空提示。"""
        from ..tools.datasource import list_data_sources as _lds  #延迟导入，保持加载顺序
        return _lds.func(user_id=user_id)

    return [archive_material, web_search, web_extract, query_financials,
            query_kline, list_data_sources,
            make_task_ask_tool(task_id, user_id, actor, node, stop_event=stop_event),
            use_skill]


def _run_collector_agent(state: ResearchState, config: RunnableConfig, tools: list, prompt: str,
                         *, actor: str = "collector", node: str = "collect") -> str:
    #受限工具集 agent 循环：LLM 自主选工具取数并入库；无工具调用视为完成；
    #每轮检查 stop_event，轮次硬上限 COLLECTOR_MAX_ROUNDS 防失控；
    #每次工具调用写入 agent_tool_traces，供 /tasks/{id}/agents/{agent} 还原完整执行过程
    llm = _llm(config)
    by_name = {t.name: t for t in tools}
    messages: list = [SystemMessage(content=prompt)]
    summary = ""
    task_id = state["task_id"]
    for _round in range(COLLECTOR_MAX_ROUNDS):
        _check_stop(config)
        response = llm.invoke(messages, tools=tools)
        calls = getattr(response, "tool_calls", None) or []
        #Responses API 原生服务端搜索：web_search_call 输出块 -> 研究动态里的搜索卡片
        for card in extract_web_search_calls(response.content):
            query = card["query"] or "服务端联网检索"
            urls = card["urls"]
            _emit(config, "collector", "progress",
                  title=f"服务端联网检索：{query[:40]}",
                  speech=f"DeepSeek 服务端已完成搜索，打开 {len(urls)} 个来源页面，模型将据此采集材料。",
                  details=[{"label": f"来源 {i + 1}", "text": u} for i, u in enumerate(urls[:5])],
                  metrics=[{"label": "来源数", "value": str(len(urls))}])
        if not calls:
            summary = content_to_text(response.content) if response.content else summary
            break
        messages.append(response)
        for tc in calls:
            _check_stop(config)
            name, args = tc["name"], tc.get("args") or {}
            tool = by_name.get(name)
            try:
                result = str(tool.invoke(args)) if tool else f"未知工具: {name}"
            except Exception as e:  # noqa: BLE001
                result = f"工具执行失败: {e}"
            store.append_tool_trace(task_id, actor, node, name, args, result)
            messages.append(ToolMessage(content=result, tool_call_id=tc["id"], name=name))
    else:
        summary = summary or content_to_text(messages[-1].content or "")
    return summary


def collect_node(state: ResearchState, config: RunnableConfig) -> dict:
    #信源采集：采集员子智能体带受限工具集自主取数（联网/财报/行情/自定义数据源），
    #有价值材料经 archive_material 入库为素材（证据链底座），产出仍交回主控
    _check_stop(config)
    task_id = state["task_id"]
    guidance = state.get("guidance", []) + _consume_guidance(config, task_id, 25)
    #首轮取图状态；建任务时绑定的用户附件已在库中，从库里带出来（含正文，供主张提取）
    materials: list[dict] = list(state.get("materials") or store.list_materials(task_id))
    new_count = {"n": 0}
    prompt = COLLECTOR_PROMPT.format(
        topic=state["topic"], company=state["company"] or "未指定",
        checkpoints="、".join(state.get("checkpoints") or []) or "（未拆解）",
        keywords="、".join(state["keywords"]),
        material_count=len(materials),
        max_materials_total=MAX_MATERIALS_TOTAL, max_materials=MAX_MATERIALS,
        qa_context=_qa_context(task_id),
    )
    _run_collector_agent(state, config, _make_collector_tools(
        task_id, state["user_id"], new_count,
        config["configurable"]["stop_event"], actor="collector", node="collect"),
                         prompt, actor="collector", node="collect")
    materials = store.list_materials(task_id)  #重拉全量（采集员入库后，含首轮附件）
    store.bump_progress(task_id, 25)
    _emit(config, "collector", "progress",
          title="公开信源与金融数据采集完成",
          speech=f"已采集 {new_count['n']} 份新材料（累计 {len(materials)} 份）并存档至知识库。",
          details=[{"label": m["title"] or m["url"], "text": m["url"]}
                   for m in materials[len(materials) - min(new_count["n"], 5):]],
          metrics=[{"label": "累计素材", "value": str(len(materials))}], progress=25)
    return {"materials": materials, "guidance": guidance}


def parse_node(state: ResearchState, config: RunnableConfig) -> dict:
    #主张提取：从素材中提取事实性主张（只提取原文存在的内容）
    _check_stop(config)
    task_id = state["task_id"]
    guidance = state.get("guidance", []) + _consume_guidance(config, task_id, 40)
    materials_text = "\n\n".join(
        f"【材料{i}】{m['title']}（{m['publisher']}）\n{m['content'][:1500]}"
        for i, m in enumerate(state["materials"], 1)
    )
    data = _llm_json(_llm(config), prompts.EXTRACT_CLAIMS_PROMPT.format(
        materials=materials_text[:12000], max_claims=MAX_CLAIMS))
    claims = [{"statement": str(c["statement"]), "category": str(c.get("category", ""))}
              for c in data.get("claims", []) if c.get("statement")][:MAX_CLAIMS]
    if not claims:
        raise RuntimeError("未能从采集材料中提取到任何事实性主张")
    if store.list_claims(task_id):
        store.clear_claims(task_id)  #二次取证后的重新提取：清掉旧主张与证据，按全量素材重建
    store.save_claims(task_id, claims)
    for i, c in enumerate(claims, 1):
        c["id"] = f"c{i}"
    store.bump_progress(task_id, 40)
    _emit(config, "parser", "progress",
          title="主张提取完成", speech=f"从材料中提取出 {len(claims)} 条待核查主张。",
          details=[{"label": c["id"], "text": c["statement"]} for c in claims],
          metrics=[], progress=40)
    return {"claims": claims, "guidance": guidance}


def _search_with_meta(query: str, num: int = 2) -> list[dict]:
    #混合检索：向量召回（全库）+ 关键词召回（SQLite FTS5 + Chroma 子串）+ RRF 融合
    #+ reranker 精排（可降级），返回 [{content, group_id, chunk_index, score}]
    from ..memory.hybrid import hybrid_search  #延迟导入，避免加载顺序问题
    return hybrid_search(query, num=num)


_SENT_SPLIT_RE = re.compile(r"(?<=[。！？；;!?])\s*|\n+")


def _norm_no_ws(text: str) -> str:
    #去掉全部空白用于匹配（中文比对不需要空格，规避换行/缩进差异）
    return "".join(text.split())


def _norm_span_map(text: str) -> tuple[str, list[int]]:
    #返回 (去空白文本, 每个字符对应的原文下标)，用于把匹配区间映射回原文
    chars: list[str] = []
    idxs: list[int] = []
    for i, ch in enumerate(text):
        if not ch.isspace():
            chars.append(ch)
            idxs.append(i)
    return "".join(chars), idxs


def _lcs_span(source: str, target: str) -> tuple[int, int] | None:
    #source/target 均为去空白文本；返回 target 在 source 中的最长公共子串 (start, length)
    n, m = len(source), len(target)
    if n == 0 or m == 0:
        return None
    dp = [0] * (m + 1)
    best_len = 0
    best_end = 0
    for i in range(1, n + 1):
        prev = 0
        for j in range(1, m + 1):
            cur = dp[j]
            if source[i - 1] == target[j - 1]:
                dp[j] = prev + 1
                if dp[j] > best_len:
                    best_len = dp[j]
                    best_end = i
            else:
                dp[j] = 0
            prev = cur
    if best_len == 0:
        return None
    return (best_end - best_len, best_len)


def _split_sentences(text: str) -> list[tuple[int, int]]:
    #按句末标点/换行切分，返回 [start, end) 区间
    spans: list[tuple[int, int]] = []
    start = 0
    for m in _SENT_SPLIT_RE.finditer(text):
        end = m.start()
        if end > start:
            spans.append((start, end))
        start = m.end()
    if start < len(text):
        spans.append((start, len(text)))
    return spans


def _verbatim_quote(quote: str, source_text: str) -> str | None:
    """只接受能在原文中逐字命中的引用。

    优先整句命中，其次原文最长公共子串；命中不足或无法定位时返回 None
    （宁可丢弃这条证据，也不把 LLM 概括/改写后的文本当作原文入库）。
    """
    quote = (quote or "").strip()
    source_text = (source_text or "").strip()
    if not quote or not source_text:
        return None
    if quote in source_text:
        return quote[:300]
    qn = _norm_no_ws(quote)
    if len(qn) < 4:
        return None
    need = max(4, int(len(qn) * 0.5))
    #1) 整句级：找与 quote 重叠最多的原文句子，命中达标则返回该句原文
    best_sentence: str | None = None
    best_lcs = 0
    for start, end in _split_sentences(source_text):
        seg = source_text[start:end].strip()
        seg_n = _norm_no_ws(seg)
        if len(seg_n) < 4:
            continue
        span = _lcs_span(seg_n, qn)
        if span is not None and span[1] > best_lcs:
            best_lcs = span[1]
            best_sentence = seg
    if best_sentence is not None and best_lcs >= need:
        return best_sentence[:300]
    #2) 全局最长公共子串：把匹配区间映射回原文
    sn, idxs = _norm_span_map(source_text)
    span = _lcs_span(sn, qn)
    if span is not None and span[1] >= need:
        s0 = idxs[span[0]]
        s1 = idxs[span[0] + span[1] - 1] + 1
        return source_text[s0:s1][:300]
    return None


def _match_evidence(task_id: str, claim: dict, llm: ChatClient, num: int = 2) -> int:
    #对单条主张做 向量粗筛+精排+LLM 判定，摘录证据入库，返回新增证据条数
    candidates = _search_with_meta(claim["statement"], num=num)
    if not candidates:
        return 0
    cand_text = "\n\n".join(f"[{i}] {c['content'][:800]}" for i, c in enumerate(candidates))
    try:
        data = _llm_json(llm, prompts.JUDGE_EVIDENCE_PROMPT.format(
            statement=claim["statement"], candidates=cand_text))
    except RuntimeError:
        return 0  #单条判定失败不中断流水线，该主张留待审查单元标黄
    materials_by_group = {m["group_id"]: m for m in store.list_materials(task_id)}
    items = []
    for e in data.get("evidence", []):
        idx = e.get("chunk_index")
        if not isinstance(idx, int) or not (0 <= idx < len(candidates)):
            continue
        cand = candidates[idx]
        src = materials_by_group.get(cand["group_id"], {})
        quote = _verbatim_quote(e.get("quote", ""),
                                (src.get("content") or "") or (cand.get("content") or ""))
        if not quote:
            continue
        items.append({
            "title": src.get("title", ""), "publisher": src.get("publisher", ""),
            "url": src.get("url", ""),
            "locator": f"{src.get('title') or cand['group_id']} 第{cand['chunk_index'] + 1}段",
            "quote": quote, "source_type": src.get("source_type", ""),
            "credibility": src.get("credibility", 0.0),
            "credibility_level": src.get("credibility_level", ""),
            "relevance": float(cand.get("score") or 0.0),  #检索相关性分（reranker/RRF）
            "relation": "challenge" if e.get("relation") == "challenge" else "support",
        })
    if items:
        store.save_evidence(task_id, claim["id"], items)
    return len(items)


def retrieve_node(state: ResearchState, config: RunnableConfig) -> dict:
    #证据检索：逐条主张检索原文段落，LLM 判定支持/质疑关系并摘录原文
    _check_stop(config)
    task_id = state["task_id"]
    guidance = state.get("guidance", []) + _consume_guidance(config, task_id, 55)
    llm = _llm(config)
    total = 0
    for claim in state["claims"]:
        _check_stop(config)
        total += _match_evidence(task_id, claim, llm)
    store.bump_progress(task_id, 55)
    _emit(config, "retriever", "progress",
          title="证据检索完成", speech=f"已为各主张匹配到 {total} 条原文证据。",
          details=[], metrics=[{"label": "证据总数", "value": str(total)}], progress=55)
    return {"guidance": guidance}


def deepen_node(state: ResearchState, config: RunnableConfig) -> dict:
    #逐条定向深挖：对证据不足 2 条的薄弱主张，由定向深挖员带受限工具集逐条补采
    #（财务主张查财报、行情主张查K线、事实主张搜网页），新素材入库后重新匹配证据
    _check_stop(config)
    task_id = state["task_id"]
    guidance = state.get("guidance", []) + _consume_guidance(config, task_id, 62)
    llm = _llm(config)
    ce_map = store.claim_evidence_ids(task_id)
    weak = [c for c in state["claims"] if len(ce_map.get(c["id"], [])) < 2][:MAX_DEEPEN_CLAIMS]
    materials_count = len(store.list_materials(task_id))
    if not weak or materials_count >= MAX_MATERIALS_TOTAL:
        _emit(config, "retriever", "progress", title="定向深挖跳过",
              speech="各主张证据均已达标，无需定向深挖。" if not weak
                    else f"素材已达 {MAX_MATERIALS_TOTAL} 篇上限，不再补采。",
              details=[], metrics=[], progress=62)
        return {"guidance": guidance}
    new_count = {"n": 0}
    for claim in weak:
        _check_stop(config)
        if len(store.list_materials(task_id)) >= MAX_MATERIALS_TOTAL:
            break
        prompt = DEEPEN_PROMPT.format(
            claim=claim["statement"][:300], topic=state["topic"],
            company=state["company"] or "未指定",
            material_count=len(store.list_materials(task_id)),
            max_total=MAX_MATERIALS_TOTAL,
            max_new=max(1, MAX_MATERIALS - new_count["n"]),
            qa_context=_qa_context(task_id),
        )
        _run_collector_agent(state, config, _make_collector_tools(
            task_id, state["user_id"], new_count,
            config["configurable"]["stop_event"], actor="deepener", node="deepen"),
                             prompt, actor="deepener", node="deepen")
        _match_evidence(task_id, claim, llm, num=3)  #新素材入库后立即重新匹配证据
    new_sources = new_count["n"]
    store.bump_progress(task_id, 62)
    _emit(config, "retriever", "progress", title="定向深挖完成",
          speech=f"对 {len(weak)} 条证据薄弱的主张做了定向深挖，补采 {new_sources} 篇信源，新增证据已重新匹配。",
          details=[{"label": c["id"], "text": c["statement"][:60]} for c in weak],
          metrics=[{"label": "新信源", "value": str(new_sources)}], progress=62)
    return {"guidance": guidance}


def score_node(state: ResearchState, config: RunnableConfig) -> dict:
    #信源可信度打分：按来源类型打标签（官方高/媒体中/自媒体低）
    _check_stop(config)
    task_id = state["task_id"]
    guidance = state.get("guidance", []) + _consume_guidance(config, task_id, 70)
    materials = store.list_materials(task_id)
    src_text = "\n".join(f"[{i}] {m['title']} | {m['publisher']} | {m['url']}"
                         for i, m in enumerate(materials))
    try:
        data = _llm_json(_llm(config), prompts.SCORE_SOURCES_PROMPT.format(sources=src_text))
        scores = {s.get("id"): s for s in data.get("scores", [])}
    except RuntimeError:
        scores = {}  #打分失败时全部按"其他/0.5"兜底
    for i, m in enumerate(materials):
        s = scores.get(i, {})
        source_type = str(s.get("source_type") or "其他")
        level = _parse_level(s.get("credibility_level", s.get("credibility")))
        credibility = _LEVEL_SCORE[level]
        store.update_material_score(task_id, m["group_id"], source_type, credibility, level)
        #证据的来源可信度跟随其来源素材
        with store.get_connection() as conn:
            conn.execute(
                "UPDATE evidence SET source_type=?, credibility=?, credibility_level=?"
                " WHERE task_id=? AND title=? AND publisher=?",
                (source_type, credibility, level, task_id, m["title"], m["publisher"]))
    store.bump_progress(task_id, 70)
    _emit(config, "scorer", "progress",
          title="信源打分完成", speech="已按来源类型输出来源可信度等级（高/中/低）。",
          details=[{"label": m["publisher"], "text": f"{m['source_type']} 来源可信度：{m['credibility_level'] or '中'}"}
                   for m in store.list_materials(task_id)],
          metrics=[], progress=70)
    return {"guidance": guidance}


def _claims_snapshot(task_id: str) -> list[dict]:
    #主张 + 证据的紧凑快照，供核验/审查提示词使用
    claims = store.list_claims(task_id)
    evidence = {e["id"]: e for e in store.list_evidence(task_id)}
    ce_map = store.claim_evidence_ids(task_id)
    snapshot = []
    for c in claims:
        evs = [{"id": eid, "quote": evidence[eid]["quote"], "relation": evidence[eid]["relation"],
                "publisher": evidence[eid]["publisher"], "credibility": evidence[eid]["credibility"]}
               for eid in ce_map.get(c["id"], []) if eid in evidence]
        snapshot.append({"claim_id": c["id"], "statement": c["statement"], "category": c["category"],
                         "supervisor_verdict": c["supervisor_verdict"], "evidence": evs})
    return snapshot


# ---------------- 幻觉审查员子智能体（只读工具交叉核验） ----------------
#独立幻觉审查：除主张/证据/主控意见外，还给审查员前序子智能体的处理轨迹（拆解/采集/提取/检索），
#并配两个只读工具用于核对"引文是否真实存在于原文"——这是防整条流水线自说自话的关键：
#read_material 按编号读素材原文，search_materials 在任务素材库内按语义定位引文段落；
#只读、无入库/无执行能力，审查结论仍以结构化 JSON 交回主控

REVIEW_MAX_ROUNDS = 6  #审查员工具查阅轮次上限（引文核对完即可输出结论）


def _processing_trace(state: ResearchState) -> str:
    #前序子智能体处理轨迹：拆解/采集清单/提取/检索匹配/主控一级核验意见，
    #全部显式列出，供幻觉审查员逐项交叉核对
    task_id = state["task_id"]
    lines = [
        f"1. 主控拆解：核查点 {len(state.get('checkpoints') or [])} 个；"
        f"检索关键词：{'、'.join(state.get('keywords') or [])}",
    ]
    materials = store.list_materials(task_id)
    lines.append(f"2. 采集员：共入库 {len(materials)} 份材料")
    for i, m in enumerate(materials, 1):
        lines.append(f"   材料{i} [{m.get('source_type') or '网页'}] "
                     f"{m.get('title') or m.get('url')}（{m.get('publisher') or '未知来源'}）")
    claims = store.list_claims(task_id)
    lines.append(f"3. 解析员：提取 {len(claims)} 条主张")
    ce_map = store.claim_evidence_ids(task_id)
    evidence = {e["id"]: e for e in store.list_evidence(task_id)}
    for c in claims:
        eids = ce_map.get(c["id"], [])
        lines.append(
            f"4. 检索匹配：主张 {c['id']} 匹配到 {len(eids)} 条证据"
            f"（来源：{', '.join(evidence[e]['publisher'] for e in eids if e in evidence) or '无'}）")
        lines.append(
            f"5. 主控一级核验：主张 {c['id']} 裁决「{c['supervisor_verdict'] or '无意见'}」"
            f"（置信度 {c['confidence']:.2f}，问题类型 {c.get('issue_type') or '无'}）")
    return "\n".join(lines)[:4000]


def _make_review_tools(task_id: str, user_id: int, stop_event) -> list:
    #审查员只读工具：读素材原文 / 素材库内语义检索（均不落库、不执行外部动作）
    from langchain_core.tools import tool as _mk_tool

    @_mk_tool
    def read_material(material_no: int) -> str:
        """读取任务素材库中第 material_no 份材料的原文（用于核对证据引文是否真实存在）。"""
        mats = store.list_materials(task_id)
        if not (1 <= material_no <= len(mats)):
            return f"材料编号越界（现有 {len(mats)} 份，编号从 1 开始）"
        m = mats[material_no - 1]
        return f"【材料{material_no}】{m.get('title') or ''}（{m.get('publisher') or ''}）\n{m.get('content') or ''}"[:4000]

    @_mk_tool
    def search_materials(query: str, num: int = 3) -> str:
        """在知识库（含本任务素材）内按语义检索与 query 相关的段落，
        返回段落归属（task 组为材料编号）与原文，用于定位证据引文是否存在。"""
        num = max(1, min(int(num), 5))
        hits = _search_with_meta(query, num=num)
        if not hits:
            return "知识库内未检索到相关段落"
        blocks = []
        for h in hits:
            gid = str(h["group_id"])
            blocks.append(f"【{gid} 第{h['chunk_index'] + 1}段】{h['content'][:600]}")
        return "\n\n".join(blocks)

    return [read_material, search_materials,
            make_task_ask_tool(task_id, user_id, "reviewer", "review",
                               stop_event=stop_event)]


def _run_review_agent(state: ResearchState, config: RunnableConfig, tools: list, prompt: str,
                      *, actor: str = "reviewer", node: str = "review") -> dict:
    #审查员 agent 循环：先用只读工具核对引文，输出结论后解析 JSON 审查结果；
    #工具轮次达上限时以最后一次输出兜底解析；每次工具调用写入 agent_tool_traces
    llm = _llm(config)
    by_name = {t.name: t for t in tools}
    messages: list = [SystemMessage(content=prompt)]
    last_text = ""
    task_id = state["task_id"]
    for _round in range(REVIEW_MAX_ROUNDS):
        _check_stop(config)
        response = llm.invoke(messages, tools=tools)
        calls = getattr(response, "tool_calls", None) or []
        last_text = content_to_text(response.content) if response.content else last_text
        if not calls:
            break
        messages.append(response)
        for tc in calls:
            _check_stop(config)
            name, args = tc["name"], tc.get("args") or {}
            tool = by_name.get(name)
            try:
                result = str(tool.invoke(args)) if tool else f"未知工具: {name}"
            except Exception as e:  # noqa: BLE001
                result = f"工具执行失败: {e}"
            store.append_tool_trace(task_id, actor, node, name, args, result)
            messages.append(ToolMessage(content=result, tool_call_id=tc["id"], name=name))
    start, end = last_text.find("{"), last_text.rfind("}")
    if start == -1 or end <= start:
        raise RuntimeError(f"幻觉审查未输出 JSON 结论: {last_text[:200]}")
    return json.loads(last_text[start:end + 1])


def verify_node(state: ResearchState, config: RunnableConfig) -> dict:
    #Supervisor 一级核验：判冲突/证据缺失，必要时决策二次取证；研究员介入指令在此统一生效
    _check_stop(config)
    task_id = state["task_id"]
    guidance = state.get("guidance", []) + _consume_guidance(config, task_id, 80)
    guidance_text = ("研究员中途介入指令：\n" + "\n".join(f"- {g}" for g in guidance)) if guidance else ""
    data = _ask_capable_json(state, config, prompts.VERIFY_PROMPT.format(
        topic=state["topic"], guidance=guidance_text,
        claims_with_evidence=json.dumps(_claims_snapshot(task_id), ensure_ascii=False)[:8000],
        qa_context=_qa_context(task_id),
    ), actor="supervisor", node="verify")
    for v in data.get("verdicts", []):
        cid = str(v.get("claim_id", ""))
        if store.get_claim(task_id, cid) is None:
            continue
        try:
            confidence = min(1.0, max(0.0, float(v.get("confidence", 0.5))))
        except (TypeError, ValueError):
            confidence = 0.5
        store.update_claim(task_id, cid, supervisor_verdict=str(v.get("verdict", "")),
                           issue_type=str(v.get("issue_type") or "无"), confidence=confidence)
    retry_count = state.get("retry_count", 0)
    need_retry = bool(data.get("need_retry")) and retry_count < MAX_RETRY
    retry_keywords = [str(k) for k in data.get("retry_keywords", [])][:MAX_KEYWORDS]
    store.bump_progress(task_id, 85)
    if need_retry and retry_keywords:
        _emit(config, "supervisor", "warning",
              title="发现疑点，启动二次取证", speech="一级核验发现证据不足或数据冲突，重新调度采集子智能体复核。",
              details=[{"label": "新关键词", "text": "、".join(retry_keywords)}],
              metrics=[{"label": "重试轮次", "value": f"{retry_count + 1}/{MAX_RETRY}"}],
              tone="warning", progress=80)
        return {"need_retry": True, "keywords": retry_keywords, "retry_count": retry_count + 1,
                "guidance": guidance}
    _emit(config, "supervisor", "progress",
          title="一级核验完成", speech="已完成冲突识别与证据充分性检查，移送独立幻觉审查单元复核。",
          details=[], metrics=[], progress=85)
    return {"need_retry": False, "retry_count": retry_count, "guidance": guidance}


def route_after_verify(state: ResearchState) -> str:
    #一级核验后的条件边：需二次取证回 collect，否则进独立审查
    return "collect" if state.get("need_retry") else "review"


def review_node(state: ResearchState, config: RunnableConfig) -> dict:
    #独立幻觉审查：审查员带只读工具（读原文核对引文/库内定位）复核二级闸门，
    #并拿到前序子智能体的处理轨迹做交叉核对，输出绿/黄/红可信度分级
    _check_stop(config)
    task_id = state["task_id"]
    guidance = state.get("guidance", []) + _consume_guidance(config, task_id, 95)
    data = _run_review_agent(
        state, config,
        _make_review_tools(task_id, state["user_id"],
                           config["configurable"]["stop_event"]),
        REVIEW_AGENT_PROMPT.format(
            topic=state["topic"], company=state["company"] or "未指定",
            trace=_processing_trace(state),
            claims_with_verdicts=json.dumps(_claims_snapshot(task_id), ensure_ascii=False)[:8000],
            material_count=len(store.list_materials(task_id)),
            qa_context=_qa_context(task_id),
        ),
    )
    level_map = {"green": "verified", "yellow": "review", "red": "conflict"}
    red = 0
    for r in data.get("reviews", []):
        cid = str(r.get("claim_id", ""))
        if store.get_claim(task_id, cid) is None:
            continue
        level = str(r.get("level", "yellow"))
        status = level_map.get(level, "review")
        if status == "conflict":
            red += 1
        store.update_claim(task_id, cid, status=status,
                           reviewer_verdict=str(r.get("verdict", "")),
                           conflict_reason=str(r.get("conflict_reason") or "") or None)
    kind = "warning" if red else "progress"
    _emit(config, "reviewer", kind,
          title="幻觉审查完成",
          speech=f"复核完毕：{red} 条高度存疑。" if red else "复核完毕：未发现疑似幻觉内容。",
          details=[], metrics=[{"label": "高度存疑", "value": str(red)}],
          tone="danger" if red else None, progress=95)
    store.bump_progress(task_id, 95)
    return {"guidance": guidance}


def _generate_abstract(llm: ChatClient, task: dict, claims: list[dict]) -> str:
    #调一次 LLM 基于核查结果撰写底稿摘要；失败返回空串，底稿退化为统计行
    from .models import STATUS_LABEL
    lines = []
    for c in claims:
        verdict = c["reviewer_verdict"] or c["supervisor_verdict"] or ""
        extra = f"；存疑原因：{c['conflict_reason']}" if c["conflict_reason"] else ""
        lines.append(f"- [{STATUS_LABEL.get(c['status'], c['status'])}] {c['statement']}（{verdict or '无结论'}{extra}）")
    try:
        text = str(llm.chat([HumanMessage(content=prompts.REPORT_ABSTRACT_PROMPT.format(
            topic=task["topic"], claims="\n".join(lines)[:3000]))]))
        return _strip_abstract(text)
    except Exception:
        return ""


def _strip_abstract(text: str) -> str:
    #模型习惯性把摘要包进 JSON/代码块（{"summary": "..."}），这里剥壳取纯文本
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    if text.startswith("{"):
        try:
            obj = json.loads(text[text.find("{"):text.rfind("}") + 1])
            if isinstance(obj, dict):
                for key in ("summary", "摘要", "abstract"):
                    if isinstance(obj.get(key), str):
                        return obj[key].strip()
                for v in obj.values():  #无惯用键时取第一个字符串值
                    if isinstance(v, str):
                        return v.strip()
        except Exception:
            pass
    return text


def assemble_node(state: ResearchState, config: RunnableConfig) -> dict:
    #底稿组装：先由 LLM 撰写摘要落库，再按模板拼装已核验素材（摘要之外不新增任何分析文字）
    _check_stop(config)
    task_id = state["task_id"]
    guidance = state.get("guidance", []) + _consume_guidance(config, task_id, 100)
    task = store.get_task(task_id, state["user_id"]) or {}
    summary = _generate_abstract(_llm(config), task, store.list_claims(task_id))
    if summary:
        store.update_task(task_id, summary_md=summary)
        task["summary_md"] = summary
    store.update_task(task_id, report_md=_build_report(task), status="review", progress=100)
    _emit(config, "assembler", "progress",
          title="研究底稿已生成", speech="带完整证据索引的研究底稿已组装完成，请研究员审阅并做最终研判。",
          details=[], metrics=[], progress=100)
    _emit(config, "system", "done", title="任务完成", speech="", details=[], metrics=[], progress=100)
    return {"guidance": guidance}


def _clean(text: object) -> str:
    #LLM 产出的文本可能含换行/竖线，会破坏 Markdown 行结构与表格；压成单行并转义竖线
    return str(text).replace("\r", " ").replace("\n", " ").replace("|", "\\|").strip()


def _build_report(task: dict) -> str:
    #组装 Markdown 研究底稿（幂等：完全由库中结构化数据重建，可在流水线外重新生成）
    from datetime import datetime
    from .models import STATUS_LABEL
    task_id = task["task_id"]
    claims = store.list_claims(task_id)
    evidence = {e["id"]: e for e in store.list_evidence(task_id)}
    ce_map = store.claim_evidence_ids(task_id)
    counts = {"verified": 0, "review": 0, "conflict": 0}
    for c in claims:
        counts[c["status"]] = counts.get(c["status"], 0) + 1

    #主张按框架模块分组：保持框架顺序，未知/旧类别归入“其他主张”
    by_title: dict[str, list[dict]] = {}
    for c in claims:
        title = _CATEGORY_TITLES.get(str(c.get("category") or "").strip(), "其他主张")
        by_title.setdefault(title, []).append(c)
    kind = _framework_kind_of(research_type=task.get("research_type", ""),
                              topic=task.get("topic", ""),
                              company=task.get("company", ""))
    if kind == "company":
        order = list(_COMPANY_MODULES)
    elif kind == "policy":
        order = ["政策环境", "行业与产业链", "风险与不确定性"]
    else:
        order = []
    order = order + [t for t in _CATEGORY_TITLES.values() if t not in order]
    order.append("其他主张")
    grouped = [(t, by_title[t]) for t in order if by_title.get(t)]

    lines = [
        f"# 研究底稿：{task.get('title', task['topic'])}",
        "",
        f"- 任务编号：{task_id}",
        f"- 研究主题：{task['topic']}",
        f"- 研究类型：{task['research_type']}",
        f"- 生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M')}",
        "",
        "## 摘要",
        "",
    ]
    if (task.get("summary_md") or "").strip():
        lines += [task["summary_md"].strip(), ""]
    lines += [
        f"共核查主张 {len(claims)} 条：核验通过 {counts['verified']} 条，"
        f"待复核 {counts['review']} 条，高度存疑 {counts['conflict']} 条。",
        "",
    ]

    #研究框架与覆盖范围：让底稿按模块呈现，不再一条条平铺
    covered = {_CATEGORY_TITLES.get(str(c.get("category") or "").strip(), "其他主张") for c in claims}
    lines += ["", "## 研究框架与覆盖范围"]
    if kind == "company":
        lines.append(f"- 研究框架：企业研究框架（{' → '.join(_COMPANY_MODULES)}）")
        covered_modules = [m for m in _COMPANY_MODULES if _CATEGORY_TITLES.get(m) in covered]
        missed_modules = [m for m in _COMPANY_MODULES if _CATEGORY_TITLES.get(m) not in covered]
    elif kind == "policy":
        lines.append(f"- 研究框架：政策影响分析框架（{' → '.join(_POLICY_MODULES)}）")
        policy_cats = ["政策环境", "行业与产业链", "风险与不确定性"]
        covered_modules = [m for m in policy_cats if m in covered]
        missed_modules = [m for m in policy_cats if m not in covered]
    else:
        lines.append("- 研究框架：通用事实核查框架（按主张类别分模块呈现）")
        covered_modules = [m for m in _CATEGORY_TITLES.values() if m in covered]
        missed_modules = []
    lines.append(f"- 本次覆盖模块：{('、'.join(covered_modules)) if covered_modules else '（暂无分类主张）'}")
    if missed_modules:
        lines.append(f"- 未覆盖模块：{'、'.join(missed_modules)}")
    lines.append("- 数据颗粒度提示：主张中的数值应自带口径、时间范围与单位，请结合证据核对。")

    lines += ["", "## 主张与证据链"]
    for title, group in grouped:
        lines += ["", f"### {title}"]
        for c in group:
            lines += [
                "",
                f"#### [{c['id']}] {_clean(c['statement'])}",
                "",
                f"- 可信度标签：**{STATUS_LABEL.get(c['status'], c['status'])}**（置信度 {c['confidence']:.2f}）",
                f"- 类别：{_clean(c['category'])}",
                f"- 主控一级核验：{_clean(c['supervisor_verdict']) or '（无）'}",
                f"- 幻觉审查复核：{_clean(c['reviewer_verdict']) or '（无）'}",
            ]
            if c["conflict_reason"]:
                lines.append(f"- 存疑原因：{_clean(c['conflict_reason'])}")
            eids = ce_map.get(c["id"], [])
            if eids:
                lines.append("- 证据：")
                for eid in eids:
                    e = evidence[eid]
                    relation = "支持" if e["relation"] == "support" else "质疑"
                    lines.append(
                        f"  - [{eid}]（{relation}，来源可信度：{e['credibility_level'] or '中'}）「{_clean(e['quote'])}」"
                        f" —— {_clean(e['publisher'])}，{_clean(e['locator'])}"
                        + (f"，{e['url']}" if e["url"] else ""))
            else:
                lines.append("- 证据：（未检索到，需人工补充取证）")
    materials = store.list_materials(task_id)
    if materials:
        lines += ["", "## 参考信源", ""]
        for m in materials:
            lines.append(f"- {_clean(m['title'])}（{_clean(m['publisher'])}，{_clean(m['source_type'])}，"
                         f"可信度 {m['credibility']:.2f}）：{m['url']}")
    attachment = _attachment_section(task_id)
    if attachment:
        lines += ["", attachment]
    lines += ["", "---",
              "",
              f"> 免责声明：{prompts.RESEARCH_DISCLAIMER}"]
    return "\n".join(lines)


def _attachment_section(task_id: str) -> str:
    #附件 A：已标记加入底稿的最新一次历史情景时序统计（纯客观数据，无趋势判断）
    analysis = store.get_latest_analysis(task_id)
    if analysis is None or not analysis["attached"]:
        return ""
    payload = analysis["payload"]
    lines = [f"## 附件 A：历史情景时序统计（指标：{payload['metric']}"
             + (f"，单位：{payload['unit']}" if payload.get("unit") else "") + "）",
             "",
             "> 本附件仅为公开数据的客观时序统计，不构成任何趋势判断或研究结论。",
             "",
             "| 事件 | 时段 | 数据点数 | 客观描述 |",
             "| --- | --- | --- | --- |"]
    for e in payload["events"]:
        lines.append(f"| {_clean(e['name'])} | {_clean(e['period'])} | {len(e['points'])} | {_clean(e['description'])} |")
    for e in payload["events"]:
        lines += ["", f"### {_clean(e['name'])}（{_clean(e['period'])}）", ""]
        lines.append("、".join(f"{p['t']}：{p['value']}{payload.get('unit', '')}" for p in e["points"]))
        if e.get("sources"):
            lines.append("")
            lines.append("数据来源：" + "；".join(
                f"[{_clean(s['title']) or s['url']}]({s['url']})" for s in e["sources"]))
    lines += ["", f"数据完整度：{payload['completeness'] * 100:.0f}%"]
    return "\n".join(lines)


# ---------------- 单条主张重新取证 ----------------

def retry_single_claim(task_id: str, claim_id: str, emit: Callable, llm: ChatClient, user_id: int) -> None:
    #对单条主张重跑 联网补采->检索->复核 子流程（后台线程执行，事件照常产出）
    claim = store.get_claim(task_id, claim_id)
    if claim is None:
        raise ValueError(f"主张不存在: {claim_id}")
    emit("supervisor", "progress", title="启动重新取证",
         speech=f"主控已受理对主张 [{claim_id}] 的重新取证请求，调度采集子智能体联网寻找新的公开信源。",
         details=[{"label": claim_id, "text": claim["statement"]}], metrics=[], progress=None)

    #1. 联网二次采集：按主张原文搜索新网页，正文切块入知识库（只翻旧素材不可能带来新证据）
    existing = store.list_materials(task_id)
    new_materials = 0
    new_mats: list[dict] = []  #新采集的素材，待打分
    if len(existing) >= MAX_MATERIALS_TOTAL:
        emit("collector", "warning", title="素材已达上限",
             speech=f"本任务素材已达 {MAX_MATERIALS_TOTAL} 篇上限，本次仅在现有素材中重新匹配证据。",
             details=[], metrics=[], progress=None)
    else:
        try:
            search_items = _web_search(claim["statement"][:200], user_id)
        except Exception as e:
            search_items = []
            emit("collector", "warning", title="联网检索失败", speech=f"二次取证联网检索失败：{e}",
                 details=[], metrics=[], progress=None)
        for item in search_items[:3]:  #重取证定向补采：取搜索结果前 3 篇抓全文
            if len(existing) + new_materials >= MAX_MATERIALS_TOTAL:
                break
            url, title = item.get("url", ""), item.get("title", "")
            try:
                content = _web_extract(url, user_id)[:6000]
            except Exception:
                content = str(item.get("content", ""))[:6000]  #正文抓取失败时退化为搜索摘要
            if not content.strip():
                continue
            publisher = url.split("/")[2] if "://" in url else url
            _ingest_material(task_id, len(existing) + new_materials + 1, title, publisher, url, content)
            new_mats.append({"group_id": f"task:{task_id}:{len(existing) + new_materials + 1}",
                             "title": title, "publisher": publisher, "url": url})
            new_materials += 1

    #1.5 新素材来源可信度评级：与流水线 score 节点同口径，否则证据等级会落空
    if new_mats:
        src_text = "\n".join(f"[{i}] {m['title']} | {m['publisher']} | {m['url']}"
                             for i, m in enumerate(new_mats))
        try:
            data = _llm_json(llm, prompts.SCORE_SOURCES_PROMPT.format(sources=src_text))
            scores = {s.get("id"): s for s in data.get("scores", [])}
        except RuntimeError:
            scores = {}  #评级失败时按"其他/中"兜底
        for i, m in enumerate(new_mats):
            s = scores.get(i, {})
            source_type = str(s.get("source_type") or "其他")
            level = _parse_level(s.get("credibility_level", s.get("credibility")))
            store.update_material_score(task_id, m["group_id"], source_type,
                                        _LEVEL_SCORE[level], level)

    #2. 精确匹配证据：向量粗筛 + reranker 精排（候选池含刚入库的新素材，全库召回）
    candidates = _search_with_meta(claim["statement"], num=3)
    materials_by_group = {m["group_id"]: m for m in store.list_materials(task_id)}
    saved = 0
    if candidates:
        cand_text = "\n\n".join(f"[{i}] {c['content'][:800]}" for i, c in enumerate(candidates))
        try:
            data = _llm_json(llm, prompts.JUDGE_EVIDENCE_PROMPT.format(
                statement=claim["statement"], candidates=cand_text))
        except RuntimeError:
            data = {"evidence": []}
        items = []
        for e in data.get("evidence", []):
            idx = e.get("chunk_index")
            if not isinstance(idx, int) or not (0 <= idx < len(candidates)):
                continue
            cand = candidates[idx]
            src = materials_by_group.get(cand["group_id"], {})
            quote = _verbatim_quote(e.get("quote", ""),
                                    (src.get("content") or "") or (cand.get("content") or ""))
            if not quote:
                continue
            items.append({"title": src.get("title", ""), "publisher": src.get("publisher", ""),
                          "url": src.get("url", ""),
                          "locator": f"{src.get('title') or cand['group_id']} 第{cand['chunk_index'] + 1}段",
                          "quote": quote, "source_type": src.get("source_type", ""),
                          "credibility": src.get("credibility", 0.0),
                          "credibility_level": src.get("credibility_level", ""),
                          "relevance": float(cand.get("score") or 0.0),
                          "relation": "challenge" if e.get("relation") == "challenge" else "support"})
        if items:
            store.save_evidence(task_id, claim_id, items)
            saved = len(items)
    emit("retriever", "progress", title="二次取证完成",
         speech=f"已为 [{claim_id}] 新采集 {new_materials} 篇信源，补充 {saved} 条证据。" if saved
                else f"已为 [{claim_id}] 新采集 {new_materials} 篇信源，但未能从中摘录出可用证据。",
         details=[], metrics=[{"label": "新信源", "value": str(new_materials)},
                              {"label": "新证据", "value": str(saved)}], progress=None)
    #单条复核：复用审查提示词，只看这一条主张的最新快照
    snapshot = [c for c in _claims_snapshot(task_id) if c["claim_id"] == claim_id]
    data = _llm_json(llm, prompts.REVIEW_PROMPT.format(
        claims_with_verdicts=json.dumps(snapshot, ensure_ascii=False)))
    level_map = {"green": "verified", "yellow": "review", "red": "conflict"}
    human_decided = bool(store.get_claim(task_id, claim_id)["human_action"])  # type: ignore[index]
    for r in data.get("reviews", []):
        if str(r.get("claim_id")) != claim_id:
            continue
        fields = {"reviewer_verdict": str(r.get("verdict", "")),
                  "conflict_reason": str(r.get("conflict_reason") or "") or None}
        if not human_decided:
            #人工裁决具有最高优先级：已裁决的主张只更新复核意见，不得推翻人工设定的状态
            fields["status"] = level_map.get(str(r.get("level", "yellow")), "review")
        store.update_claim(task_id, claim_id, **fields)
    emit("reviewer", "progress", title="重新复核完成",
         speech=f"主张 [{claim_id}] 已完成二级复核。", details=[], metrics=[], progress=None)


# ---------------- 图编译 ----------------

def build_research_graph():
    g = StateGraph(ResearchState)
    g.add_node("plan", _node_with_retry("plan", plan_node))
    g.add_node("collect", _node_with_retry("collect", collect_node))
    g.add_node("parse", _node_with_retry("parse", parse_node))
    g.add_node("retrieve", _node_with_retry("retrieve", retrieve_node))
    g.add_node("deepen", _node_with_retry("deepen", deepen_node))
    g.add_node("score", _node_with_retry("score", score_node))
    g.add_node("verify", _node_with_retry("verify", verify_node))
    g.add_node("review", _node_with_retry("review", review_node))
    g.add_node("assemble", _node_with_retry("assemble", assemble_node))
    g.set_entry_point("plan")
    g.add_edge("plan", "collect")
    g.add_edge("collect", "parse")
    g.add_edge("parse", "retrieve")
    g.add_edge("retrieve", "deepen")
    g.add_edge("deepen", "score")
    g.add_edge("score", "verify")
    g.add_conditional_edges("verify", route_after_verify, {"collect": "collect", "review": "review"})
    g.add_edge("review", "assemble")
    g.add_edge("assemble", END)
    return g.compile()  #不挂 checkpointer：任务级 stop 用标志位在节点边界终止


research_graph = build_research_graph()
