from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from agent import questions as question_store
from agent.session import store as session_store

from ..core.security import get_current_user
from ..core.session import (
    delete_session, get_or_create_session, get_session, is_running,
    list_sessions,
)
from ..utils.agent_stream import agent_event_stream

router = APIRouter(prefix="/sessions", tags=["sessions"])


class SessionListResponse(BaseModel):
    session_ids: list[str]


class HistoryMessage(BaseModel):
    role: str  # "user" 或 "assistant"
    content: str


class SessionHistoryResponse(BaseModel):
    session_id: str
    messages: list[HistoryMessage]


class CompactResponse(BaseModel):
    status: str
    session_id: str
    tokens_before: int
    tokens_after: int


def _check_ownership(session_id: str, user_id: int) -> None:
    #会话不存在或不属于当前用户时一律 404（不暴露存在性）
    if not session_store.session_belongs_to(session_id, user_id):
        raise HTTPException(status_code=404, detail="会话不存在")


@router.get("")
def list_all(user_id: int = Depends(get_current_user)) -> SessionListResponse:
    #列出当前用户的全部持久化会话（按最近更新倒序）
    return SessionListResponse(session_ids=list_sessions(user_id))


@router.get("/{session_id}/history")
def history(session_id: str, user_id: int = Depends(get_current_user)) -> SessionHistoryResponse:
    #返回会话的完整对话日志（按轮次存于 Chroma，compact 不影响完整历史）
    _check_ownership(session_id, user_id)
    messages = []
    for _, user_text, assistant_text in session_store.get_turns(session_id):
        messages.append(HistoryMessage(role="user", content=user_text))
        if assistant_text:
            messages.append(HistoryMessage(role="assistant", content=assistant_text))
    return SessionHistoryResponse(session_id=session_id, messages=messages)


@router.post("/{session_id}/compact")
def compact(session_id: str, user_id: int = Depends(get_current_user)) -> CompactResponse:
    #手动压缩会话上下文：调一次LLM把历史压成摘要，返回压缩前后的token数
    _check_ownership(session_id, user_id)
    _, agent, lock = get_or_create_session(session_id, user_id)
    with lock:  #与对话请求互斥，防止压缩到一半混入新消息
        tokens_before = agent.context_tokens
        agent.compact()
        tokens_after = agent.context_tokens
    return CompactResponse(
        status="compacted",
        session_id=session_id,
        tokens_before=tokens_before,
        tokens_after=tokens_after,
    )


@router.delete("/{session_id}")
def delete(session_id: str, user_id: int = Depends(get_current_user)) -> dict[str, str]:
    #删除会话：进程缓存 + sessions.db + Chroma 轮次切片级联删除
    _check_ownership(session_id, user_id)
    delete_session(session_id)
    return {"status": "deleted", "session_id": session_id}


# ---- 手动叫停式暂停/恢复 ----

class StatusResponse(BaseModel):
    session_id: str
    running: bool
    paused: bool
    thread_id: str | None
    pending_question: dict | None = None  #提问工具等待中的问题（供前端刷新后恢复卡片）


class AnswerQuestionRequest(BaseModel):
    answer: str


@router.get("/{session_id}/status")
def status(session_id: str, user_id: int = Depends(get_current_user)) -> StatusResponse:
    #查询会话运行/暂停状态（重启后也可查出哪些会话挂着暂停）
    _check_ownership(session_id, user_id)
    paused = session_store.get_paused(session_id)
    pending = question_store.pending_question(session_id=session_id, user_id=user_id)
    return StatusResponse(
        session_id=session_id,
        running=is_running(session_id),
        paused=paused is not None,
        thread_id=paused[0] if paused else None,
        pending_question=question_store.question_to_dto(pending) if pending else None,
    )


@router.post("/{session_id}/pause")
def pause(session_id: str, user_id: int = Depends(get_current_user)) -> dict[str, str]:
    #手动叫停：置位暂停标志，当前节点跑完后在节点边界挂起（SSE 中会收到 paused 事件）
    _check_ownership(session_id, user_id)
    if not is_running(session_id):
        raise HTTPException(status_code=409, detail="当前没有正在运行的轮次")
    session = get_session(session_id)
    if session is None:
        raise HTTPException(status_code=409, detail="会话不在本进程活跃，无法叫停")
    session[0].pause()
    return {"status": "pausing", "session_id": session_id}


@router.post("/{session_id}/resume")
def resume(session_id: str, user_id: int = Depends(get_current_user)) -> StreamingResponse:
    #流式恢复暂停的轮次（thread 状态在 checkpointer 中，支持重启后恢复）
    _check_ownership(session_id, user_id)
    if session_store.get_paused(session_id) is None:
        raise HTTPException(status_code=409, detail="没有暂停中的轮次")
    _, agent, lock = get_or_create_session(session_id, user_id)

    return StreamingResponse(agent_event_stream(
        lambda: agent.resume_stream(),
        session_id=session_id, user_id=user_id, lock=lock,
        error_node="resume", prompt="",
    ), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/{session_id}/abort")
def abort(session_id: str, user_id: int = Depends(get_current_user)) -> dict[str, str]:
    #丢弃暂停中的轮次
    _check_ownership(session_id, user_id)
    if session_store.get_paused(session_id) is None:
        raise HTTPException(status_code=409, detail="没有暂停中的轮次")
    _, agent, _ = get_or_create_session(session_id, user_id)
    agent.abort()
    return {"status": "aborted", "session_id": session_id}


# ---- 提问工具：问题查询与回答 ----

@router.get("/{session_id}/questions")
def list_session_questions(session_id: str, user_id: int = Depends(get_current_user)) -> dict:
    #列出该会话的提问记录，供前端刷新后恢复提问卡片
    _check_ownership(session_id, user_id)
    rows = question_store.list_questions(session_id=session_id, user_id=user_id)
    return {"session_id": session_id,
            "questions": [question_store.question_to_dto(q) for q in rows]}


@router.post("/{session_id}/questions/{question_id}/answer")
def answer_session_question(session_id: str, question_id: str,
                            request: AnswerQuestionRequest,
                            user_id: int = Depends(get_current_user)) -> dict[str, str]:
    #用户回答对话小盾的提问：写入答案 -> 发布 answer 事件 -> 唤醒等待线程
    _check_ownership(session_id, user_id)
    q = question_store.get_question(question_id, user_id)
    if q is None or q.get("session_id") != session_id:
        raise HTTPException(status_code=404, detail="问题不存在")
    if q["status"] != "pending":
        raise HTTPException(status_code=409, detail="该问题已作答或已取消")
    if not question_store.is_waiting(question_id):
        raise HTTPException(status_code=409, detail="会话已不在等待中，无法作答")
    answer = request.answer.strip()
    if not answer:
        raise HTTPException(status_code=400, detail="答案不能为空")
    question_store.answer_question(question_id, user_id, answer)
    from agent.session import events as session_events
    session_events.publish(session_id, {
        "kind": "answer",
        "type": "answer",
        "content": answer,
        "payload": {
            "question_id": question_id,
            "question": q["question"],
            "answer": answer,
        },
    })
    question_store.wake(question_id)
    return {"status": "answered", "question_id": question_id, "answer": answer}
