import threading
import uuid

from agent.agent import Agent
from agent.session import store as session_store

#会话注册表：session_id -> (Agent实例, 会话锁)，进程内缓存；
#会话状态本身持久化在 sessions.db，重启后按 session_id 重建 Agent 即可恢复
_sessions: dict[str, tuple[Agent, threading.Lock]] = {}
_registry_lock = threading.Lock()


def get_or_create_session(session_id: str | None) -> tuple[str, Agent, threading.Lock]:
    #按session_id取会话，不存在则新建（Agent 会从 sessions.db 恢复历史）；不传id时生成uuid
    if session_id is None:
        session_id = uuid.uuid4().hex
    with _registry_lock:
        if session_id not in _sessions:
            _sessions[session_id] = (Agent(session_id), threading.Lock())
        agent, lock = _sessions[session_id]
    return session_id, agent, lock


def get_session(session_id: str) -> tuple[Agent, threading.Lock] | None:
    #只取不建，会话不存在时返回 None
    with _registry_lock:
        return _sessions.get(session_id)


def list_sessions() -> list[str]:
    #列出全部持久化会话 id（按最近更新倒序），不只是本进程内存中活跃的
    return [row["session_id"] for row in session_store.list_sessions()]


def delete_session(session_id: str) -> bool:
    #删除会话：进程内缓存 + sessions.db 与 Chroma 轮次切片级联删除，不存在时返回 False
    with _registry_lock:
        _sessions.pop(session_id, None)
    return session_store.delete_session(session_id)
