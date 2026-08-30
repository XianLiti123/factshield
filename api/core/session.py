import threading
import uuid

from agent.agent import Agent
from agent.session import store as session_store

#会话注册表：session_id -> (Agent实例, 会话锁)，进程内缓存；
#会话状态本身持久化在 sessions.db，重启后按 session_id 重建 Agent 即可恢复
_sessions: dict[str, tuple[Agent, threading.Lock]] = {}
_registry_lock = threading.Lock()


def get_or_create_session(session_id: str | None, user_id: int) -> tuple[str, Agent, threading.Lock]:
    #按session_id取会话，不存在则新建（Agent 会从 sessions.db 恢复历史）；不传id时生成uuid。
    #user_id 为当前登录用户，新建会话归其所有
    if session_id is None:
        session_id = uuid.uuid4().hex
    with _registry_lock:
        if session_id not in _sessions:
            _sessions[session_id] = (Agent(session_id, user_id), threading.Lock())
        agent, lock = _sessions[session_id]
    return session_id, agent, lock


def get_session(session_id: str) -> tuple[Agent, threading.Lock] | None:
    #只取不建，会话不存在时返回 None
    with _registry_lock:
        return _sessions.get(session_id)


def list_sessions(user_id: int) -> list[str]:
    #列出当前用户的全部持久化会话 id（按最近更新倒序）
    return [row["session_id"] for row in session_store.list_sessions(user_id)]


def delete_session(session_id: str) -> bool:
    #删除会话：进程内缓存 + sessions.db 与 Chroma 轮次切片级联删除，不存在时返回 False
    with _registry_lock:
        _sessions.pop(session_id, None)
    return session_store.delete_session(session_id)


#正在流式运行的会话集合（pause 接口据此判断是否有活跃运行）
_running: set[str] = set()


def mark_running(session_id: str) -> None:
    with _registry_lock:
        _running.add(session_id)


def unmark_running(session_id: str) -> None:
    with _registry_lock:
        _running.discard(session_id)


def is_running(session_id: str) -> bool:
    with _registry_lock:
        return session_id in _running
