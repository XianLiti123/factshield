"""会话级事件总线（对话小盾 SSE 用）。

与 agent/research/runner.py 的任务事件通道对应：会话的 chat SSE 流先注册一个
asyncio.Queue，后台线程里的 ask_user 工具（或答案接口）经本总线把结构化事件
（question/answer）跨线程投递到 SSE 生成器；SSE 断开或结束后注销。
"""

import asyncio
import threading

_bus: dict[str, dict["asyncio.Queue", asyncio.AbstractEventLoop]] = {}
_lock = threading.Lock()


def register(session_id: str, q: "asyncio.Queue") -> None:
    #注册一个订阅队列并绑定当前事件循环（须在协程/异步生成器里调用）
    with _lock:
        _bus.setdefault(session_id, {})[q] = asyncio.get_running_loop()


def unregister(session_id: str, q: "asyncio.Queue") -> None:
    with _lock:
        subs = _bus.get(session_id)
        if subs is not None:
            subs.pop(q, None)
            if not subs:
                _bus.pop(session_id, None)


def publish(session_id: str, event: dict) -> None:
    #向该会话的全部订阅队列投递一条事件；无订阅者时静默丢弃
    with _lock:
        subs = list(_bus.get(session_id, {}).items())
    dead: list["asyncio.Queue"] = []
    for q, loop in subs:
        try:
            loop.call_soon_threadsafe(q.put_nowait, event)
        except RuntimeError:
            dead.append(q)  #订阅方事件循环已关闭：摘除，避免反复投递失败
    if dead:
        with _lock:
            for q in dead:
                _bus.get(session_id, {}).pop(q, None)


def has_subscribers(session_id: str) -> bool:
    with _lock:
        return bool(_bus.get(session_id))
