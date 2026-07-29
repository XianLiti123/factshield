from fastapi import APIRouter, HTTPException
from langchain_core.messages import AIMessage, HumanMessage
from pydantic import BaseModel

from ..core.session import delete_session, get_session, list_sessions

router = APIRouter(prefix="/sessions", tags=["sessions"])


class SessionListResponse(BaseModel):
    session_ids: list[str]


class HistoryMessage(BaseModel):
    role: str  # "user" 或 "assistant"
    content: str


class SessionHistoryResponse(BaseModel):
    session_id: str
    messages: list[HistoryMessage]


@router.get("")
def list_all() -> SessionListResponse:
    #列出内存中全部活跃会话（重启即清空）
    return SessionListResponse(session_ids=list_sessions())


@router.get("/{session_id}/history")
def history(session_id: str) -> SessionHistoryResponse:
    #返回会话的对话历史，只含用户提问和助手回答，跳过系统提示和工具中间消息
    session = get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    agent, _ = session
    messages = [
        HistoryMessage(role="user" if isinstance(m, HumanMessage) else "assistant", content=m.content)
        for m in agent.messages
        if isinstance(m, (HumanMessage, AIMessage)) and isinstance(m.content, str) and m.content
    ]
    return SessionHistoryResponse(session_id=session_id, messages=messages)


@router.delete("/{session_id}")
def delete(session_id: str) -> dict[str, str]:
    #删除会话，清空对话记忆
    if not delete_session(session_id):
        raise HTTPException(status_code=404, detail="会话不存在")
    return {"status": "deleted", "session_id": session_id}
