import asyncio
import json
import uuid
from pathlib import Path
from typing import AsyncIterator, Literal

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from agent import questions as question_store
from agent.research import runner, store
from agent.research.export import report_to_docx, report_to_pdf
from agent.research.models import run_to_dto
from agent.research.pipeline import MAX_MATERIALS_TOTAL, _build_report, _ingest_material
from agent.research.trace import AGENT_REGISTRY, get_agent_execution, list_agent_summaries
from agent.session.model_config import get_config
from agent.tools.convert import convert_document

from ..core.security import get_current_user
from ..core.session import get_or_create_session
from ..schemas.research import ResearchRun, TaskSummary
from ..utils.agent_stream import agent_event_stream

router = APIRouter(prefix="/tasks", tags=["tasks"])

#事实核查研究任务接口：创建/运行（SSE）/裁决/重新取证/底稿（markdown/pdf/docx）/审计/Supervisor 对话/历史情景统计


class CreateTaskRequest(BaseModel):
    topic: str
    title: str | None = None
    company: str | None = None
    research_type: str = "policy"
    preferred_sources: list[str] = []
    attachment_ids: list[str] = []  #任务附件：/tasks/uploads 返回的 upload_id，建任务时绑定为素材


class GuidanceRequest(BaseModel):
    instruction: str


class ResolveClaimRequest(BaseModel):
    action: str  #reject(不采纳)/keep(保留注明)/remove(删除表述)/rewrite(改写)
    comment: str | None = None


class SupervisorChatRequest(BaseModel):
    message: str
    claim_id: str | None = None  #可选：针对某条主张提问


class AnswerQuestionRequest(BaseModel):
    answer: str


class HistoryAnalysisRequest(BaseModel):
    #历史复盘用户自定义比较口径；全部留空则完全由系统推荐
    metric: str | None = None          #比较指标（如 股价涨幅、营业收入）
    scenarios: list[str] = []          #关注的历史事件或场景
    start: str | None = None           #观察时间范围起（YYYY-MM）
    end: str | None = None             #观察时间范围止（YYYY-MM）
    frequency: Literal["auto", "monthly", "quarterly", "yearly"] = "auto"


#人工裁决动作 -> 主张最终状态
_RESOLVE_STATUS = {"keep": "verified", "rewrite": "verified", "reject": "conflict", "remove": "conflict"}


def _get_task_or_404(task_id: str, user_id: int) -> dict:
    task = store.get_task(task_id, user_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")  #他人任务不暴露存在性
    return task


def _summary(task: dict, claim_count: int = 0) -> TaskSummary:
    return TaskSummary(
        id=task["task_id"], title=task["title"], company=task["company"],
        status=task["status"], researchType=task["research_type"],
        progress=task["progress"], createdAt=task["created_at"], updatedAt=task["updated_at"],
        claimCount=claim_count,
    )


def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


@router.post("", response_model=TaskSummary)
def create_task(request: CreateTaskRequest, user_id: int = Depends(get_current_user)) -> TaskSummary:
    #创建研究任务并后台启动流水线（未配置 LLM 拒绝服务）；附件先于流水线绑定，随首轮参与主张提取
    if get_config(user_id, "llm") is None:
        raise HTTPException(status_code=400, detail="未配置 LLM 模型，请先在 /settings 配置")
    if request.attachment_ids:
        if len(request.attachment_ids) > MAX_MATERIALS_TOTAL:
            raise HTTPException(status_code=400, detail=f"附件数量超过素材总量上限 {MAX_MATERIALS_TOTAL}")
        for upload_id in request.attachment_ids:
            upload = store.get_upload(upload_id, user_id)
            if upload is None or upload["task_id"]:
                raise HTTPException(status_code=400, detail=f"附件 {upload_id} 不存在或已绑定其他任务")
    task = store.create_task(
        user_id=user_id, title=request.title or request.topic, topic=request.topic,
        company=request.company or "", research_type=request.research_type,
        preferred_sources=request.preferred_sources,
    )
    for seq, upload_id in enumerate(request.attachment_ids, 1):
        try:
            upload = store.get_upload(upload_id, user_id)
            _ingest_material(task["task_id"], seq, upload["filename"], "用户上传附件", "", upload["content"])  # type: ignore[index]
            store.bind_upload(upload_id, task["task_id"])
        except Exception as e:
            store.delete_task(task["task_id"], user_id)  #附件入库失败不留半成品任务
            raise HTTPException(status_code=503, detail=f"附件入库失败（可能未配置 Embedding 模型）: {e}")
    runner.start_task(task["task_id"], user_id, allow_auto_repair=False)
    return _summary(task)


# ---------------- 任务附件上传（先传后绑：上传暂存 -> 建任务时 attachment_ids 绑定） ----------------

_ALLOWED_UPLOAD_EXT = {".pdf", ".xlsx", ".xls", ".docx", ".txt"}
_MAX_UPLOAD_SIZE = 10 * 1024 * 1024  #单附件 10MB
_MAX_UPLOAD_FILES = 5                #单次最多 5 个
_UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent / "agent" / "workspace" / "uploads"


@router.post("/uploads")
async def upload_attachments(files: list[UploadFile] = File(...),
                             user_id: int = Depends(get_current_user)) -> dict:
    #上传任务附件：转 Markdown 暂存并返回 upload_id；建任务时以 attachment_ids 绑定为任务素材
    if len(files) > _MAX_UPLOAD_FILES:
        raise HTTPException(status_code=400, detail=f"一次最多上传 {_MAX_UPLOAD_FILES} 个附件")
    _UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    uploads = []
    for f in files:
        name = f.filename or "未命名"
        ext = Path(name).suffix.lower()
        if ext not in _ALLOWED_UPLOAD_EXT:
            raise HTTPException(status_code=400,
                                detail=f"不支持的附件类型 {ext}，支持: {'/'.join(sorted(_ALLOWED_UPLOAD_EXT))}")
        data = await f.read()
        if len(data) > _MAX_UPLOAD_SIZE:
            raise HTTPException(status_code=400, detail=f"附件 {name} 超过 10MB 限制")
        if ext == ".txt":
            content = data.decode("utf-8", errors="ignore")[:6000]
        else:
            tmp = _UPLOAD_DIR / f"{uuid.uuid4().hex}{ext}"
            tmp.write_bytes(data)
            try:
                content = convert_document.invoke({"file_path": str(tmp), "max_length": 6000, "safe": False})
            finally:
                tmp.unlink(missing_ok=True)
            if str(content).startswith("文档转换失败"):
                raise HTTPException(status_code=422, detail=f"附件 {name} 解析失败: {content}")
        if not str(content).strip():
            raise HTTPException(status_code=422, detail=f"附件 {name} 未解析出文本内容")
        uploads.append({"upload_id": store.save_upload(user_id, name, str(content)),
                        "filename": name, "chars": len(str(content))})
    return {"uploads": uploads}


@router.get("", response_model=list[TaskSummary])
def list_tasks(user_id: int = Depends(get_current_user)) -> list[TaskSummary]:
    return [_summary(t, len(store.list_claims(t["task_id"]))) for t in store.list_tasks(user_id)]


@router.get("/search")
def search_tasks(q: str = "", user_id: int = Depends(get_current_user)) -> dict:
    #全局搜索：任务/主张/证据，限当前用户数据（须在 /{task_id} 之前注册，避免 search 被当成 task_id）
    q = q.strip()
    if not q:
        return {"query": q, "tasks": [], "claims": [], "evidence": []}
    return {"query": q, **store.search(user_id, q)}


@router.get("/{task_id}", response_model=ResearchRun)
def get_task(task_id: str, user_id: int = Depends(get_current_user)) -> ResearchRun:
    task = _get_task_or_404(task_id, user_id)
    dto = run_to_dto(task, store.list_claims(task_id), store.list_evidence(task_id),
                     store.claim_evidence_ids(task_id), store.list_events(task_id),
                     store.list_node_runs(task_id))
    return ResearchRun(**dto)


@router.delete("/{task_id}")
def delete_task(task_id: str, user_id: int = Depends(get_current_user)) -> dict[str, str]:
    _get_task_or_404(task_id, user_id)
    runner.stop_task(task_id)  #运行中的先叫停，再级联删除
    store.delete_task(task_id, user_id)
    return {"status": "deleted", "task_id": task_id}


@router.get("/{task_id}/events")
def task_events(task_id: str, user_id: int = Depends(get_current_user)) -> StreamingResponse:
    #研究过程播报流（异步生成器，不占 anyio 线程池，yield 即写 socket）：先回放已持久化事件，
    #再经订阅队列实时推送（含重取证/历史统计事件）。
    #连接时任务在运行中：收到主流水线终态事件后关闭；已结束的任务：回放后保持连接，
    #客户端可继续收到后续的重新取证/统计事件，自行决定何时断开
    _get_task_or_404(task_id, user_id)

    async def stream() -> AsyncIterator[str]:
        q = runner.subscribe(task_id)  #先订阅再回放，衔接处事件经 seq 去重，无缺口
        try:
            was_running = runner.is_running(task_id)
            last_seq = 0
            for event in store.list_events(task_id):
                last_seq = event["seq"]
                yield _sse(event)
            while True:
                try:
                    event = await asyncio.wait_for(q.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"  #保活注释行，防止代理断连
                    continue
                if event["seq"] <= last_seq:
                    continue  #回放阶段已发过，去重
                last_seq = event["seq"]
                yield _sse(event)
                if (was_running and event["actor"] == "system"
                        and event["kind"] in ("done", "stopped", "error")):
                    return  #主流水线终态事件送达后关闭
        finally:
            runner.unsubscribe(task_id, q)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache, no-transform",
                                      "X-Accel-Buffering": "no"})


@router.get("/{task_id}/step-logs")
def task_step_logs(task_id: str, user_id: int = Depends(get_current_user)) -> dict:
    #全步骤日志：每个节点的每次尝试都记录起止时间/耗时/状态/LLM 调用次数/token 用量/错误，
    #供前端“执行详情”与运维排查使用（research_step_logs 表）
    _get_task_or_404(task_id, user_id)
    return {"task_id": task_id, "steps": store.list_step_logs(task_id)}


@router.post("/{task_id}/stop")
def stop_task(task_id: str, user_id: int = Depends(get_current_user)) -> dict[str, str]:
    #终止任务：流水线在下一个节点边界停止（stop 即终态，不可恢复）
    task = _get_task_or_404(task_id, user_id)
    if task["status"] != "running":
        raise HTTPException(status_code=409, detail="任务不在运行中")
    if not runner.stop_task(task_id):
        #进程重启等导致运行态丢失：直接落终态
        store.update_task(task_id, status="stopped")
        return {"status": "stopped", "task_id": task_id}
    return {"status": "stopping", "task_id": task_id}


@router.post("/{task_id}/guidance")
def guide_task(task_id: str, request: GuidanceRequest,
               user_id: int = Depends(get_current_user)) -> dict[str, str]:
    #研究员中途介入：指令入库，流水线在一级核验节点消费
    task = _get_task_or_404(task_id, user_id)
    if task["status"] != "running":
        raise HTTPException(status_code=409, detail="任务不在运行中，介入指令不会被消费")
    store.add_guidance(task_id, request.instruction)
    return {"status": "queued", "task_id": task_id}


# ---------------- 提问工具：问题查询与回答 ----------------

@router.get("/{task_id}/questions")
def list_task_questions(task_id: str, user_id: int = Depends(get_current_user)) -> dict:
    #列出该任务的提问记录（pending 在前，按创建时间升序），供前端刷新后恢复卡片
    _get_task_or_404(task_id, user_id)
    rows = question_store.list_questions(task_id=task_id, user_id=user_id)
    return {"task_id": task_id,
            "questions": [question_store.question_to_dto(q) for q in rows]}


@router.post("/{task_id}/questions/{question_id}/answer")
def answer_task_question(task_id: str, question_id: str, request: AnswerQuestionRequest,
                         user_id: int = Depends(get_current_user)) -> dict[str, str]:
    #研究员回答提问：写入答案 -> 发布 answer 事件 -> 唤醒等待中的流水线线程
    _get_task_or_404(task_id, user_id)
    q = question_store.get_question(question_id, user_id)
    if q is None or q.get("task_id") != task_id:
        raise HTTPException(status_code=404, detail="问题不存在")
    if q["status"] != "pending":
        raise HTTPException(status_code=409, detail="该问题已作答或已取消")
    if not runner.is_running(task_id) or not question_store.is_waiting(question_id):
        raise HTTPException(status_code=409, detail="任务已不在等待中，无法作答")
    answer = request.answer.strip()
    if not answer:
        raise HTTPException(status_code=400, detail="答案不能为空")
    question_store.answer_question(question_id, user_id, answer)
    runner.publish_event(task_id, "researcher", "answer", {
        "title": "研究员已回答",
        "speech": answer,
        "question_id": question_id,
        "question": q["question"],
        "answer": answer,
        "details": [],
        "metrics": [],
        "progress": None,
    })
    question_store.wake(question_id)
    return {"status": "answered", "question_id": question_id, "answer": answer}


@router.post("/{task_id}/claims/{claim_id}/resolve")
def resolve_claim(task_id: str, claim_id: str, request: ResolveClaimRequest,
                  user_id: int = Depends(get_current_user)) -> dict:
    #人工裁决：研究员对存疑主张做最终研判，覆盖状态并写入审计链
    _get_task_or_404(task_id, user_id)
    if request.action not in _RESOLVE_STATUS:
        raise HTTPException(status_code=400, detail=f"无效的裁决动作，可选: {list(_RESOLVE_STATUS)}")
    claim = store.resolve_claim(task_id, claim_id, request.action, request.comment, _RESOLVE_STATUS)
    if claim is None:
        raise HTTPException(status_code=404, detail="主张不存在")
    store.append_event(task_id, "researcher", "progress", {
        "title": "人工裁决",
        "speech": f"研究员对主张 [{claim_id}] 做出裁决：{request.action}"
                  + (f"（{request.comment}）" if request.comment else ""),
        "details": [{"label": claim_id, "text": claim["statement"]}],
        "metrics": [], "tone": None, "progress": None,
    })
    task = store.get_task(task_id, user_id)
    if task["report_md"]:
        #裁决改变了主张状态与结论，底稿按最新数据重建（纯代码组装，幂等）
        store.update_task(task_id, report_md=_build_report(task))
    if all(c["human_action"] for c in store.list_claims(task_id)):
        store.update_task(task_id, status="ready")  #全部主张均有终判，任务进入完成态
        task = store.get_task(task_id, user_id)
    return {"status": "resolved", "claim_id": claim_id, "new_status": claim["status"],
            "task_status": task["status"]}


@router.post("/{task_id}/claims/{claim_id}/retry")
def retry_claim(task_id: str, claim_id: str, user_id: int = Depends(get_current_user)) -> dict[str, str]:
    #重新取证：后台对单条主张重跑 检索->复核 子流程，事件追加到播报流
    _get_task_or_404(task_id, user_id)
    if store.get_claim(task_id, claim_id) is None:
        raise HTTPException(status_code=404, detail="主张不存在")
    if get_config(user_id, "llm") is None:
        raise HTTPException(status_code=400, detail="未配置 LLM 模型，请先在 /settings 配置")
    runner.start_retry(task_id, claim_id, user_id)
    return {"status": "retrying", "task_id": task_id, "claim_id": claim_id}


@router.get("/{task_id}/report")
def export_report(task_id: str, format: str = "markdown",
                  user_id: int = Depends(get_current_user)):
    #研究底稿导出：markdown 返回 JSON；pdf/docx 返回文件字节流
    task = _get_task_or_404(task_id, user_id)
    if not task["report_md"]:
        raise HTTPException(status_code=409, detail="底稿尚未生成（任务未完成）")
    if format == "markdown":
        return {"format": "markdown", "content": task["report_md"]}
    if format == "pdf":
        return Response(content=report_to_pdf(task["report_md"]), media_type="application/pdf",
                        headers={"Content-Disposition": f'attachment; filename="{task_id}.pdf"'})
    if format == "docx":
        return Response(content=report_to_docx(task["report_md"]),
                        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                        headers={"Content-Disposition": f'attachment; filename="{task_id}.docx"'})
    raise HTTPException(status_code=400, detail="不支持的导出格式，可选: markdown/pdf/docx")


@router.get("/{task_id}/audit-log")
def audit_log(task_id: str, user_id: int = Depends(get_current_user)) -> dict:
    #全链路审计日志：事件流 + 人工裁决记录，JSON 返回由前端自渲染
    _get_task_or_404(task_id, user_id)
    claims = store.list_claims(task_id)
    resolutions = [
        {"claim_id": c["id"], "statement": c["statement"], "action": c["human_action"],
         "note": c["human_note"], "decided_at": c["updated_at"]}
        for c in claims if c["human_action"]
    ]
    return {"task_id": task_id, "events": store.list_events(task_id), "resolutions": resolutions}


@router.post("/{task_id}/history-analysis")
def history_analysis(task_id: str, request: HistoryAnalysisRequest | None = None,
                     user_id: int = Depends(get_current_user)) -> dict[str, str]:
    #历史情景时序统计：后台执行（检索+数据抽取需数十秒），进度经 events 端点推送；
    #可选请求体为用户自定义比较口径（指标/场景/时间范围/频率），缺省完全由系统推荐
    _get_task_or_404(task_id, user_id)
    if get_config(user_id, "llm") is None:
        raise HTTPException(status_code=400, detail="未配置 LLM 模型，请先在 /settings 配置")
    if runner.is_analysis_running(task_id):
        raise HTTPException(status_code=409, detail="该任务已有正在运行的历史情景统计")
    try:
        runner.start_history_analysis(task_id, user_id,
                                      request.model_dump() if request else None)
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return {"status": "running", "task_id": task_id}


@router.get("/{task_id}/history-analysis")
def get_history_analysis(task_id: str, user_id: int = Depends(get_current_user)) -> dict:
    #取最新一次历史情景统计结果（前端据此绘制时序曲线与样本表）
    _get_task_or_404(task_id, user_id)
    analysis = store.get_latest_analysis(task_id)
    if not runner.is_analysis_running(task_id):
        #最近一次统计尝试失败且没有更新的成功结果时，把失败原因暴露给前端轮询，
        #避免“复盘生成中”无限等待（前端轮询收到非 404 错误会结束生成状态）
        latest_error = _latest_history_error(user_id, task_id)
        if latest_error and (analysis is None or latest_error["created_at"] > analysis["created_at"]):
            raise HTTPException(status_code=409,
                                detail=f"历史情景统计失败：{latest_error['error']}")
    if analysis is None:
        raise HTTPException(status_code=404, detail="尚无历史情景统计结果")
    return {"id": analysis["id"], "task_id": task_id, "attached": bool(analysis["attached"]),
            "created_at": analysis["created_at"], **analysis["payload"]}


def _latest_history_error(user_id: int, task_id: str) -> dict | None:
    #最近一次历史情景统计失败记录（按 id 倒序取最新），供 GET 接口把失败原因暴露给前端
    from agent.failures import list_errors
    errors = list_errors(user_id, flow_type="history_analysis",
                         flow_id=task_id, limit=1).get("errors") or []
    return errors[0] if errors else None


@router.post("/{task_id}/history-analysis/attach")
def attach_history_analysis(task_id: str, user_id: int = Depends(get_current_user)) -> dict[str, str]:
    #把最新一次统计结果加入研究底稿附件 A（幂等：重复调用内容不重复）
    task = _get_task_or_404(task_id, user_id)
    analysis = store.get_latest_analysis(task_id)
    if analysis is None:
        raise HTTPException(status_code=404, detail="尚无历史情景统计结果")
    if not task["report_md"]:
        raise HTTPException(status_code=409, detail="底稿尚未生成（任务未完成）")
    store.set_analysis_attached(analysis["id"], True)
    store.update_task(task_id, report_md=_build_report(store.get_task(task_id, user_id)))
    return {"status": "attached", "task_id": task_id}


# ---------------- 子智能体执行过程查询 ----------------

@router.get("/{task_id}/agents")
def list_task_agents(task_id: str, user_id: int = Depends(get_current_user)) -> dict:
    #列出研究流水线里的全部子智能体及各自的执行量（事件数/工具调用数）
    _get_task_or_404(task_id, user_id)
    return {"task_id": task_id, "agents": list_agent_summaries(task_id)}


@router.get("/{task_id}/agents/{agent}")
def get_task_agent_execution(task_id: str, agent: str,
                             user_id: int = Depends(get_current_user)) -> dict:
    #查询某个子智能体的完整执行过程：输入/事件时间线/工具调用轨迹/产出/错误
    _get_task_or_404(task_id, user_id)
    result = get_agent_execution(task_id, user_id, agent)
    if result is None:
        raise HTTPException(status_code=404,
                            detail=f"未知的智能体: {agent}，可选: {list(AGENT_REGISTRY)}")
    return result


@router.post("/{task_id}/chat")
def supervisor_chat(task_id: str, request: SupervisorChatRequest,
                    user_id: int = Depends(get_current_user)) -> StreamingResponse:
    #小盾对话：复用对话 Agent，注入任务上下文（主张清单+判定结论），SSE 流式
    task = _get_task_or_404(task_id, user_id)
    if get_config(user_id, "llm") is None:
        raise HTTPException(status_code=400, detail="未配置 LLM 模型，请先在 /settings 配置")
    context = _build_chat_context(task, request.claim_id)
    session_id, agent, lock = get_or_create_session(f"task-{task_id}", user_id)  #任务专属会话，独立持久化

    return StreamingResponse(agent_event_stream(
        lambda: agent.run_stream(f"{context}\n\n研究员的问题：{request.message}"),
        session_id=session_id, user_id=user_id, lock=lock,
        error_node="task_chat", prompt=request.message,
    ), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def _build_chat_context(task: dict, claim_id: str | None) -> str:
    #拼装给小盾的任务上下文：任务信息 + 主张与判定摘要（控制长度，只取关键字段）
    claims = store.list_claims(task["task_id"])
    lines = [f"【当前研究任务】{task['title']}（{task['task_id']}，状态 {task['status']}）",
             f"研究主题：{task['topic']}", "主张清单："]
    for c in claims:
        marker = "👉 " if claim_id and c["id"] == claim_id else ""
        lines.append(f"- {marker}[{c['id']}]（{c['status']}）{c['statement']}"
                     f"｜复核：{c['reviewer_verdict'] or '暂无'}")
    if claim_id:
        lines.append(f"研究员当前聚焦主张 [{claim_id}]。")
    return "\n".join(lines)[:4000]
