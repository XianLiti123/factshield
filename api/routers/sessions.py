from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from agent.session import store as session_store

from ..core.security import get_current_user
from ..core.session import delete_session, get_or_create_session, list_sessions

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
