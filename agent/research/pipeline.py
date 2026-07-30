import json
import threading
from typing import Any, Callable, TypedDict

from langchain_core.messages import HumanMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, StateGraph
from langchain_tavily import TavilyExtract, TavilySearch

from ..llm.client import ChatClient
from ..memory.reranker.rerank import rerank
from ..memory.vector_store.store import _get_store, add_document
from ..memory.SQLite.db import get_connection as memory_conn
from . import prompts, store

#事实核查流水线（固定骨架 + LLM 判定）：
#plan(主控拆解) -> collect(信源采集) -> parse(主张提取) -> retrieve(证据检索)
#-> score(信源打分) -> verify(主控一级核验，冲突时回 collect 二次取证)
#-> review(独立幻觉审查) -> assemble(底稿组装)
#所有"子智能体"互相隔离：各自只拿到本环节的输入，产出结构化结果交回主控，彼此无通信边

MAX_CLAIMS = 6          #单任务主张上限，控制 LLM 调用规模
MAX_KEYWORDS = 4        #每次采集的关键词上限
MAX_MATERIALS = 6       #单轮采集素材上限
MAX_MATERIALS_TOTAL = 12  #含二次取证轮次的素材总量上限
MAX_RETRY = 1           #冲突二次取证上限（控制运行时长与进度回退次数）

_search = TavilySearch(max_results=3)
_extract = TavilyExtract()


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


def _llm_json(llm: ChatClient, prompt: str, retries: int = 1) -> dict:
    #调 LLM 并解析 JSON 输出；容忍 markdown 代码块包裹，失败重试
    last_err: Exception | None = None
    for _ in range(retries + 1):
        try:
            text = str(llm.chat([HumanMessage(content=prompt)]))
            start, end = text.find("{"), text.rfind("}")
            if start == -1 or end <= start:
                raise ValueError(f"LLM 未输出 JSON: {text[:200]}")
            return json.loads(text[start:end + 1])
        except Exception as e:
            last_err = e
    raise RuntimeError(f"LLM JSON 解析失败: {last_err}")


def _llm(config: RunnableConfig) -> ChatClient:
    from ..core.loop import get_llm_client  #延迟导入，避免循环依赖
    return get_llm_client(config["configurable"]["user_id"])


# ---------------- 节点实现 ----------------

def plan_node(state: ResearchState, config: RunnableConfig) -> dict:
    #Supervisor 任务拆解：主题 -> 原子核查点 + 检索关键词
    _check_stop(config)
    data = _llm_json(_llm(config), prompts.PLAN_PROMPT.format(
        topic=state["topic"], company=state["company"] or "未指定",
        research_type=state["research_type"],
        sources="、".join(state["preferred_sources"]) or "无偏好",
    ))
    title = data.get("title") or state["topic"]
    keywords = [str(k) for k in data.get("keywords", [])][:MAX_KEYWORDS] or [state["topic"]]
    checkpoints = [str(c) for c in data.get("checkpoints", [])][:5]
    store.update_task(state["task_id"], title=title, progress=12)
    _emit(config, "supervisor", "progress",
          title="任务拆解完成", speech=f"已拆解为 {len(checkpoints)} 个核查点，准备定向采集公开信源。",
          details=[{"label": "核查点", "text": c} for c in checkpoints],
          metrics=[{"label": "检索关键词", "value": "、".join(keywords)}], progress=12)
    return {"title": title, "keywords": keywords, "checkpoints": checkpoints}


def collect_node(state: ResearchState, config: RunnableConfig) -> dict:
    #信源采集：按关键词抓取公开网页正文，原文切块入知识库（group_id 标任务归属）
    _check_stop(config)
    task_id = state["task_id"]
    materials: list[dict] = list(state.get("materials") or [])
    collected = 0  #本轮新增素材数（二次取证轮次不受首轮上限影响，总量以 MAX_MATERIALS_TOTAL 封顶）
    for kw in state["keywords"]:
        _check_stop(config)
        if collected >= MAX_MATERIALS or len(materials) >= MAX_MATERIALS_TOTAL:
            break
        try:
            result = _search.invoke({"query": kw})
            items = result.get("results", []) if isinstance(result, dict) else []
        except Exception as e:
            _emit(config, "collector", "warning", title="检索失败", speech=f"关键词「{kw}」检索失败：{e}",
                  details=[], metrics=[], progress=state.get("progress", 25))
            continue
        for item in items[:2]:
            _check_stop(config)
            if collected >= MAX_MATERIALS or len(materials) >= MAX_MATERIALS_TOTAL:
                break
            url, title = item.get("url", ""), item.get("title", "")
            try:
                ext = _extract.invoke({"urls": [url]})
                pages = ext.get("results", []) if isinstance(ext, dict) else []
                content = str(pages[0].get("raw_content", ""))[:6000] if pages else ""
            except Exception:
                content = str(item.get("content", ""))[:6000]  #正文抓取失败时退化为搜索摘要
            if not content.strip():
                continue
            group_id = f"task:{task_id}:{len(materials) + 1}"
            _, chunk_count = add_document(content, group_id=group_id)
            with memory_conn() as conn:  #登记知识库元数据，/knowledge/documents 可按任务回溯
                conn.execute("INSERT INTO documents (group_id, chunk_count) VALUES (?,?)",
                             (group_id, chunk_count))
            publisher = url.split("/")[2] if "://" in url else url
            material = {"group_id": group_id, "title": title, "publisher": publisher,
                        "url": url, "content": content}
            store.add_material(task_id, group_id, title, publisher, url)
            materials.append(material)
            collected += 1
    store.bump_progress(task_id, 25)
    _emit(config, "collector", "progress",
          title="公开信源采集完成", speech=f"已采集 {collected} 份原始材料并存档至知识库。",
          details=[{"label": m["title"] or m["url"], "text": m["url"]}
                   for m in (materials[len(materials) - collected:] if collected else [])],
          metrics=[{"label": "累计素材", "value": str(len(materials))}], progress=25)
    return {"materials": materials}


def parse_node(state: ResearchState, config: RunnableConfig) -> dict:
    #主张提取：从素材中提取事实性主张（只提取原文存在的内容）
    _check_stop(config)
    task_id = state["task_id"]
    materials_text = "\n\n".join(
        f"【材料{i}】{m['title']}（{m['publisher']}）\n{m['content'][:1200]}"
        for i, m in enumerate(state["materials"], 1)
    )
    data = _llm_json(_llm(config), prompts.EXTRACT_CLAIMS_PROMPT.format(
        materials=materials_text[:9000], max_claims=MAX_CLAIMS))
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
    return {"claims": claims}


def _search_with_meta(query: str, num: int = 2) -> list[dict]:
    #带元数据的精确检索：向量粗筛 + reranker 精排，返回 [{content, group_id, chunk_index}]
    docs = _get_store().similarity_search(query, k=2 * num)
    if not docs:
        return []
    if len(docs) <= num:
        picked = docs
    else:
        by_content = {d.page_content: d for d in docs}
        ranked = rerank(query, [d.page_content for d in docs], top_n=num)
        picked = [by_content[text] for text, _ in ranked]
    return [{"content": d.page_content, "group_id": d.metadata.get("group_id", ""),
             "chunk_index": d.metadata.get("chunk_index", 0)} for d in picked]


def retrieve_node(state: ResearchState, config: RunnableConfig) -> dict:
    #证据检索：逐条主张检索原文段落，LLM 判定支持/质疑关系并摘录原文
    _check_stop(config)
    task_id = state["task_id"]
    llm = _llm(config)
    materials_by_group = {m["group_id"]: m for m in state["materials"]}
    total = 0
    for claim in state["claims"]:
        _check_stop(config)
        candidates = _search_with_meta(claim["statement"], num=2)
        if not candidates:
            continue
        cand_text = "\n\n".join(f"[{i}] {c['content'][:800]}" for i, c in enumerate(candidates))
        try:
            data = _llm_json(llm, prompts.JUDGE_EVIDENCE_PROMPT.format(
                statement=claim["statement"], candidates=cand_text))
        except RuntimeError:
            continue  #单条判定失败不中断流水线，该主张留待审查单元标黄
        items = []
        for e in data.get("evidence", []):
            idx = e.get("chunk_index")
            if not isinstance(idx, int) or not (0 <= idx < len(candidates)):
                continue
            cand = candidates[idx]
            src = materials_by_group.get(cand["group_id"], {})
            quote = str(e.get("quote", ""))[:300]
            if not quote:
                continue
            items.append({
                "title": src.get("title", ""), "publisher": src.get("publisher", ""),
                "url": src.get("url", ""),
                "locator": f"{src.get('title') or cand['group_id']} 第{cand['chunk_index'] + 1}段",
                "quote": quote,
                "relation": "challenge" if e.get("relation") == "challenge" else "support",
            })
        if items:
            store.save_evidence(task_id, claim["id"], items)
            total += len(items)
    store.bump_progress(task_id, 55)
    _emit(config, "retriever", "progress",
          title="证据检索完成", speech=f"已为各主张匹配到 {total} 条原文证据。",
          details=[], metrics=[{"label": "证据总数", "value": str(total)}], progress=55)
    return {}


def score_node(state: ResearchState, config: RunnableConfig) -> dict:
    #信源可信度打分：按来源类型打标签（官方高/媒体中/自媒体低）
    _check_stop(config)
    task_id = state["task_id"]
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
        try:
            credibility = min(1.0, max(0.0, float(s.get("credibility", 0.5))))
        except (TypeError, ValueError):
            credibility = 0.5
        store.update_material_score(task_id, m["group_id"], source_type, credibility)
        #证据的可信度跟随其来源素材
        with store.get_connection() as conn:
            conn.execute(
                "UPDATE evidence SET source_type=?, credibility=? WHERE task_id=? AND title=? AND publisher=?",
                (source_type, credibility, task_id, m["title"], m["publisher"]))
    store.bump_progress(task_id, 70)
    _emit(config, "scorer", "progress",
          title="信源打分完成", speech="已按来源类型输出标准化可信度标签。",
          details=[{"label": m["publisher"], "text": f"{m['source_type']} {m['credibility']:.2f}"}
                   for m in store.list_materials(task_id)],
          metrics=[], progress=70)
    return {}


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


def verify_node(state: ResearchState, config: RunnableConfig) -> dict:
    #Supervisor 一级核验：判冲突/证据缺失，必要时决策二次取证；研究员介入在此消费
    _check_stop(config)
    task_id = state["task_id"]
    guidance = store.consume_guidance(task_id)
    for g in guidance:
        _emit(config, "researcher", "progress",
              title="研究员介入", speech=g, details=[], metrics=[], tone="warning",
              progress=state.get("progress", 80))
    guidance_text = ("研究员中途介入指令：\n" + "\n".join(f"- {g}" for g in guidance)) if guidance else ""
    data = _llm_json(_llm(config), prompts.VERIFY_PROMPT.format(
        topic=state["topic"], guidance=guidance_text,
        claims_with_evidence=json.dumps(_claims_snapshot(task_id), ensure_ascii=False)[:8000]))
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
        return {"need_retry": True, "keywords": retry_keywords, "retry_count": retry_count + 1}
    _emit(config, "supervisor", "progress",
          title="一级核验完成", speech="已完成冲突识别与证据充分性检查，移送独立幻觉审查单元复核。",
          details=[], metrics=[], progress=85)
    return {"need_retry": False, "retry_count": retry_count}


def route_after_verify(state: ResearchState) -> str:
    #一级核验后的条件边：需二次取证回 collect，否则进独立审查
    return "collect" if state.get("need_retry") else "review"


def review_node(state: ResearchState, config: RunnableConfig) -> dict:
    #独立幻觉审查：二级复核闸门，输出绿/黄/红可信度分级
    _check_stop(config)
    task_id = state["task_id"]
    data = _llm_json(_llm(config), prompts.REVIEW_PROMPT.format(
        claims_with_verdicts=json.dumps(_claims_snapshot(task_id), ensure_ascii=False)[:8000]))
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
    return {}


def assemble_node(state: ResearchState, config: RunnableConfig) -> dict:
    #底稿组装：按模板拼装已核验素材（纯代码组装，不新增任何分析文字）
    _check_stop(config)
    task_id = state["task_id"]
    task = store.get_task(task_id, state["user_id"]) or {}
    store.update_task(task_id, report_md=_build_report(task), status="review", progress=100)
    _emit(config, "assembler", "progress",
          title="研究底稿已生成", speech="带完整证据索引的研究底稿已组装完成，请研究员审阅并做最终研判。",
          details=[], metrics=[], progress=100)
    _emit(config, "system", "done", title="任务完成", speech="", details=[], metrics=[], progress=100)
    return {}


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
        f"共核查主张 {len(claims)} 条：核验通过 {counts['verified']} 条，"
        f"待复核 {counts['review']} 条，高度存疑 {counts['conflict']} 条。",
        "",
        "## 主张与证据链",
    ]
    for c in claims:
        lines += [
            "",
            f"### [{c['id']}] {_clean(c['statement'])}",
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
                    f"  - [{eid}]（{relation}，可信度 {e['credibility']:.2f}）「{_clean(e['quote'])}」"
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
              "> 免责声明：本底稿仅为金融研究辅助素材，不构成任何投资建议，最终结论由研究员人工研判。"]
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
    lines += ["", f"数据完整度：{payload['completeness'] * 100:.0f}%"]
    return "\n".join(lines)


# ---------------- 单条主张重新取证 ----------------

def retry_single_claim(task_id: str, claim_id: str, emit: Callable, llm: ChatClient) -> None:
    #对单条主张重跑 检索->打分->核验->审查 子流程（后台线程执行，事件照常产出）
    claim = store.get_claim(task_id, claim_id)
    if claim is None:
        raise ValueError(f"主张不存在: {claim_id}")
    emit("supervisor", "progress", title="启动重新取证",
         speech=f"主控已受理对主张 [{claim_id}] 的重新取证请求，调度检索子智能体二次匹配证据。",
         details=[{"label": claim_id, "text": claim["statement"]}], metrics=[], progress=None)
    candidates = _search_with_meta(claim["statement"], num=3)
    materials_by_group = {m["group_id"]: m for m in store.list_materials(task_id)}
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
            quote = str(e.get("quote", ""))[:300]
            if not quote:
                continue
            items.append({"title": src.get("title", ""), "publisher": src.get("publisher", ""),
                          "url": src.get("url", ""),
                          "locator": f"{src.get('title') or cand['group_id']} 第{cand['chunk_index'] + 1}段",
                          "quote": quote, "source_type": src.get("source_type", ""),
                          "credibility": src.get("credibility", 0.0),
                          "relation": "challenge" if e.get("relation") == "challenge" else "support"})
        if items:
            store.save_evidence(task_id, claim_id, items)
    emit("retriever", "progress", title="二次取证完成",
         speech=f"已为 [{claim_id}] 补充检索证据。", details=[], metrics=[], progress=None)
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
    g.add_node("plan", plan_node)
    g.add_node("collect", collect_node)
    g.add_node("parse", parse_node)
    g.add_node("retrieve", retrieve_node)
    g.add_node("score", score_node)
    g.add_node("verify", verify_node)
    g.add_node("review", review_node)
    g.add_node("assemble", assemble_node)
    g.set_entry_point("plan")
    g.add_edge("plan", "collect")
    g.add_edge("collect", "parse")
    g.add_edge("parse", "retrieve")
    g.add_edge("retrieve", "score")
    g.add_edge("score", "verify")
    g.add_conditional_edges("verify", route_after_verify, {"collect": "collect", "review": "review"})
    g.add_edge("review", "assemble")
    g.add_edge("assemble", END)
    return g.compile()  #不挂 checkpointer：任务级 stop 用标志位在节点边界终止


research_graph = build_research_graph()
