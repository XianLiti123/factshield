"""对话 Agent 的后台线程流桥接。

把 agent.run_stream / resume_stream 放到后台线程执行，SSE 生成器只负责从
会话事件总线取事件：ask_user 阻塞等待用户回答时，提问事件仍能实时送达前端；
答案到达后同一 SSE 连接继续输出 token，直到 done。
"""

import asyncio
import threading
from collections.abc import AsyncIterator, Callable, Iterator

from agent.failures import format_traceback, record_error
from agent.session import events as session_events
from agent.session import store as session_store

from ..core.session import mark_running, unmark_running
from .sse import sse_event, sse_event_payload


async def agent_event_stream(
    generator_factory: Callable[[], Iterator[tuple[str, str]]],
    *,
    session_id: str,
    user_id: int,
    lock: threading.Lock,
    error_node: str = "chat",
    prompt: str = "",
    ask_user_enabled: bool = True,
) -> AsyncIterator[str]:
    """启动后台线程消费 agent 事件流，并把事件桥接为 SSE 文本。

    - generator_factory: 返回 (kind, text) 事件迭代器的可调用对象；
    - 会话锁在 worker 内持有（与旧实现一致：同一会话串行）；
    - 客户端断开只注销事件总线，不终止 worker（正在等待回答的轮次继续有效）。
    """
    q: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()
    session_events.register(session_id, q)

    def put(item: dict) -> None:
        loop.call_soon_threadsafe(q.put_nowait, item)

    def worker() -> None:
        with lock:
            mark_running(session_id)
            ask_token = session_store.current_ask_user_enabled.set(ask_user_enabled)
            try:
                for kind, text in generator_factory():
                    put({"kind": "sse", "type": kind, "content": text})
                put({"kind": "sse", "type": "done", "content": ""})
            except Exception as e:  # noqa: BLE001
                record_error(user_id, "chat", session_id, error=str(e),
                             node=error_node, prompt=prompt,
                             traceback=format_traceback(), auto_repair=False)
                put({"kind": "sse", "type": "error", "content": str(e)})
                put({"kind": "sse", "type": "done", "content": ""})
            finally:
                session_store.current_ask_user_enabled.reset(ask_token)
                unmark_running(session_id)

    threading.Thread(target=worker, daemon=True,
                     name=f"chat-{session_id}").start()
    try:
        while True:
            item = await q.get()
            kind = item.get("kind")
            if kind == "sse":
                yield sse_event(item["type"], item.get("content", ""))
                if item["type"] == "done":
                    return
            elif kind == "question":
                yield sse_event_payload("question", item.get("content", ""),
                                        item.get("payload"))
            elif kind == "answer":
                yield sse_event_payload("answer", item.get("content", ""),
                                        item.get("payload"))
    finally:
        session_events.unregister(session_id, q)
