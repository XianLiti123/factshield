import json
import uuid
from contextvars import ContextVar

from ..memory.reranker.rerank import safe_rerank
from . import turns_store
from .checkpoint_db import delete_threads
from .db import get_connection, init_db
from .users import ensure_admin

init_db()  #确保各表存在

#当前请求/会话的用户上下文：LLM 工具在图内执行时拿不到 user_id，靠它在 Agent 调图前注入
current_user_id: ContextVar[int] = ContextVar("current_user_id", default=ensure_admin())


def create_session(session_id: str | None = None, user_id: int | None = None) -> str:
    #建会话行（已存在则复用），不传 id 时生成 uuid；user_id 为归属用户
    sid = session_id or uuid.uuid4().hex
    with get_connection() as conn:
        conn.execute("INSERT OR IGNORE INTO sessions (session_id, user_id) VALUES (?,?)", (sid, user_id))
    return sid


def load_session(session_id: str) -> dict | None:
    #读取会话状态，不存在时返回 None；active_toolsets 已从 JSON 还原为列表
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM sessions WHERE session_id = ?", (session_id,)).fetchone()
    if row is None:
        return None
    state = dict(row)
    state["active_toolsets"] = json.loads(state["active_toolsets"])
    return state


def session_belongs_to(session_id: str, user_id: int) -> bool:
    #校验会话是否属于指定用户（api 层归属校验用）
    with get_connection() as conn:
        row = conn.execute(
            "SELECT 1 FROM sessions WHERE session_id=? AND user_id=?", (session_id, user_id)
        ).fetchone()
    return row is not None


def save_turn(session_id: str, seq: int, user_text: str, assistant_text: str,
              context_tokens: int, active_toolsets: list[str]) -> None:
    #写入一轮对话：正文进 Chroma，元数据进 turns 表，并更新会话状态
    turns_store.add_turn(session_id, seq, user_text, assistant_text)
    with get_connection() as conn:
        conn.execute("INSERT INTO turns (session_id, seq) VALUES (?,?)", (session_id, seq))
        conn.execute(
            "UPDATE sessions SET context_tokens=?, active_toolsets=?, updated_at=datetime('now','localtime') WHERE session_id=?",
            (context_tokens, json.dumps(active_toolsets, ensure_ascii=False), session_id)
        )


def save_summary(session_id: str, summary: str, compacted_until_seq: int, context_tokens: int) -> None:
    #compact 后落盘：摘要文本、覆盖位置、压缩后的 token 计数；原始轮次历史不动
    with get_connection() as conn:
        conn.execute(
            "UPDATE sessions SET summary=?, compacted_until_seq=?, context_tokens=?, updated_at=datetime('now','localtime') WHERE session_id=?",
            (summary, compacted_until_seq, context_tokens, session_id)
        )


def get_turns(session_id: str, after_seq: int = 0) -> list[tuple[int, str, str]]:
    #读取会话轮次（after_seq=0 即完整日志；after_seq=compacted_until_seq 即上下文视图的轮次部分）
    return turns_store.get_turns(session_id, after_seq)


# ---- 暂停状态（手动叫停式暂停/恢复）----

def set_paused(session_id: str, thread_id: str, user_input: str) -> None:
    #记录暂停：挂起那轮的 graph thread_id 和用户输入（供恢复/重启后补入库）
    with get_connection() as conn:
        conn.execute(
            "UPDATE sessions SET paused_thread_id=?, paused_input=?, updated_at=datetime('now','localtime') WHERE session_id=?",
            (thread_id, user_input, session_id)
        )


def get_paused(session_id: str) -> tuple[str, str] | None:
    #取暂停状态，返回 (thread_id, user_input)；无暂停返回 None
    with get_connection() as conn:
        row = conn.execute(
            "SELECT paused_thread_id, paused_input FROM sessions WHERE session_id=?", (session_id,)
        ).fetchone()
    if row and row["paused_thread_id"]:
        return row["paused_thread_id"], row["paused_input"]
    return None


def clear_paused(session_id: str) -> None:
    #清除暂停状态（恢复完成或 abort 后）
    with get_connection() as conn:
        conn.execute(
            "UPDATE sessions SET paused_thread_id=NULL, paused_input=NULL WHERE session_id=?",
            (session_id,)
        )


def max_seq(session_id: str) -> int:
    #会话当前最大轮次序号，没有轮次时为 0
    with get_connection() as conn:
        row = conn.execute("SELECT COALESCE(MAX(seq),0) AS m FROM turns WHERE session_id=?", (session_id,)).fetchone()
    return row["m"]


def precise_search_turns(query: str, k: int = 3) -> list[str]:
    #精确召回历史对话：先向量粗筛 top 2k，再 reranker 精排取 top k（未配置/失败时按原序兜底）
    chunks = turns_store.vector_search_turns(query, k=2 * k)
    if not chunks:
        return []
    if len(chunks) <= k:
        return chunks
    return [text for text, _ in safe_rerank(query, chunks, top_n=k)]


def list_sessions(user_id: int) -> list[dict]:
    #列出指定用户的全部会话，按最近更新倒序
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT session_id, created_at, updated_at FROM sessions WHERE user_id=? ORDER BY updated_at DESC",
            (user_id,)
        ).fetchall()
    return [dict(row) for row in rows]


def delete_session(session_id: str) -> bool:
    #删除会话：Chroma 轮次切片 + checkpoint 线程 + SQLite 两表级联删除，不存在时返回 False（归属校验由调用方负责）
    existed = load_session(session_id) is not None
    if not existed:
        return False
    turns_store.delete_turns(session_id)
    delete_threads(session_id)
    with get_connection() as conn:
        conn.execute("DELETE FROM turns WHERE session_id=?", (session_id,))
        conn.execute("DELETE FROM sessions WHERE session_id=?", (session_id,))
    return True


# ---- 用户画像（按 user_id 隔离；user_id 缺省取当前用户上下文）----

#画像条目软上限（单用户），超限时工具层提示 LLM 先合并/删除旧条目
MAX_PROFILE_FACTS = 50


def _uid(user_id: int | None) -> int:
    return user_id if user_id is not None else current_user_id.get()


def add_fact(content: str, user_id: int | None = None) -> int:
    #新增一条画像事实，返回条目 id
    with get_connection() as conn:
        cursor = conn.execute("INSERT INTO profile_facts (user_id, content) VALUES (?,?)", (_uid(user_id), content))
        return cursor.lastrowid  # type: ignore


def update_fact(fact_id: int, content: str, user_id: int | None = None) -> bool:
    #更新一条画像事实（仅限本人条目），条目不存在时返回 False
    with get_connection() as conn:
        cursor = conn.execute(
            "UPDATE profile_facts SET content=?, updated_at=datetime('now','localtime') WHERE id=? AND user_id=?",
            (content, fact_id, _uid(user_id))
        )
        return cursor.rowcount > 0


def delete_fact(fact_id: int, user_id: int | None = None) -> bool:
    #删除一条画像事实（仅限本人条目），条目不存在时返回 False
    with get_connection() as conn:
        cursor = conn.execute("DELETE FROM profile_facts WHERE id=? AND user_id=?", (fact_id, _uid(user_id)))
        return cursor.rowcount > 0


def list_facts(user_id: int | None = None) -> list[dict]:
    #列出指定用户的全部画像事实，按 id 升序
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, content, created_at, updated_at FROM profile_facts WHERE user_id=? ORDER BY id",
            (_uid(user_id),)
        ).fetchall()
    return [dict(row) for row in rows]


def profile_text(user_id: int | None = None) -> str:
    #把画像事实拼成注入系统提示词的文本（"1. ...\n2. ..."），无事实时返回空串
    facts = list_facts(user_id)
    return "\n".join(f"{i}. {row['content']}" for i, row in enumerate(facts, 1))
