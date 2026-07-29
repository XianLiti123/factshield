from typing import Iterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from agent.session.model_config import get_config
from agent.session.store import load_session

from ..core.security import get_current_user
from ..core.session import get_or_create_session
from ..utils.sse import sse_event

router = APIRouter()


class ChatRequest(BaseModel):
    message: str
    session_id: str | None = None  #不传则服务端生成，通过响应头 X-Session-Id 返回


@router.post("/chat/stream")
def chat_stream(request: ChatRequest, user_id: int = Depends(get_current_user)) -> StreamingResponse:
    #流式对话接口，SSE 返回 JSON 事件：token(正文)/think(思考)/tool(工具状态)/done/error
    if get_config(user_id, "llm") is None:
        raise HTTPException(status_code=400, detail="未配置 LLM 模型，请先在 /settings 配置")  #未配置 key 拒绝服务
    existing = load_session(request.session_id) if request.session_id else None
    if existing and existing["user_id"] != user_id:
        raise HTTPException(status_code=404, detail="会话不存在")  #他人会话不暴露存在性
    session_id, agent, lock = get_or_create_session(request.session_id, user_id)

    def event_stream() -> Iterator[str]:
        with lock:  #同一会话串行执行，防止并发写乱消息历史
            try:
                for kind, text in agent.run_stream(request.message):
                    yield sse_event(kind, text)
                yield sse_event("done")
            except Exception as e:
                yield sse_event("error", str(e))

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "X-Session-Id": session_id,
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  #禁用反向代理缓冲，保证事件实时到达
        },
    )
