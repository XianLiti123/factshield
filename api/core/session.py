import threading
import uuid

from agent.agent import Agent

#会话注册表：session_id -> (Agent实例, 会话锁)，内存态，重启即清空
_sessions: dict[str, tuple[Agent, threading.Lock]] = {}
_registry_lock = threading.Lock()


def get_or_create_session(session_id: str | None) -> tuple[str, Agent, threading.Lock]:
    #按session_id取会话，不存在则新建；不传id时生成uuid
    if session_id is None:
        session_id = uuid.uuid4().hex
    with _registry_lock:
        if session_id not in _sessions:
            _sessions[session_id] = (Agent(), threading.Lock())
        agent, lock = _sessions[session_id]
    return session_id, agent, lock


def get_session(session_id: str) -> tuple[Agent, threading.Lock] | None:
    #只取不建，会话不存在时返回 None
    with _registry_lock:
        return _sessions.get(session_id)


def list_sessions() -> list[str]:
    #列出全部活跃会话 id
    with _registry_lock:
        return list(_sessions.keys())


def delete_session(session_id: str) -> bool:
    #删除会话（连同对话记忆），不存在时返回 False
    with _registry_lock:
        return _sessions.pop(session_id, None) is not None
