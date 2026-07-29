import json
import uuid

from ..memory.reranker.rerank import rerank
from . import turns_store
from .db import get_connection, init_db

init_db()  #确保 sessions/turns 表存在


def create_session(session_id: str | None = None) -> str:
    #建会话行（已存在则复用），不传 id 时生成 uuid
    sid = session_id or uuid.uuid4().hex
    with get_connection() as conn:
        conn.execute("INSERT OR IGNORE INTO sessions (session_id) VALUES (?)", (sid,))
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


def max_seq(session_id: str) -> int:
    #会话当前最大轮次序号，没有轮次时为 0
    with get_connection() as conn:
        row = conn.execute("SELECT COALESCE(MAX(seq),0) AS m FROM turns WHERE session_id=?", (session_id,)).fetchone()
    return row["m"]


def precise_search_turns(query: str, k: int = 3) -> list[str]:
    #精确召回历史对话：先向量粗筛 top 2k，再 reranker 精排取 top k（镜像知识库 precise_search）
    chunks = turns_store.vector_search_turns(query, k=2 * k)
    if not chunks:
        return []
    if len(chunks) <= k:
        return chunks
    return [text for text, _ in rerank(query, chunks, top_n=k)]


def list_sessions() -> list[dict]:
    #列出全部会话，按最近更新倒序
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT session_id, created_at, updated_at FROM sessions ORDER BY updated_at DESC"
        ).fetchall()
    return [dict(row) for row in rows]


def delete_session(session_id: str) -> bool:
    #删除会话：Chroma 轮次切片 + SQLite 两表级联删除，不存在时返回 False
    existed = load_session(session_id) is not None
    if not existed:
        return False
    turns_store.delete_turns(session_id)
    with get_connection() as conn:
        conn.execute("DELETE FROM turns WHERE session_id=?", (session_id,))
        conn.execute("DELETE FROM sessions WHERE session_id=?", (session_id,))
    return True


# ---- 用户画像（全局一份，跨会话共享，不带 session_id）----

#画像条目软上限，超限时工具层提示 LLM 先合并/删除旧条目
MAX_PROFILE_FACTS = 50


def add_fact(content: str) -> int:
    #新增一条画像事实，返回条目 id
    with get_connection() as conn:
        cursor = conn.execute("INSERT INTO profile_facts (content) VALUES (?)", (content,))
        return cursor.lastrowid  # type: ignore


def update_fact(fact_id: int, content: str) -> bool:
    #更新一条画像事实，条目不存在时返回 False
    with get_connection() as conn:
        cursor = conn.execute(
            "UPDATE profile_facts SET content=?, updated_at=datetime('now','localtime') WHERE id=?",
            (content, fact_id)
        )
        return cursor.rowcount > 0


def delete_fact(fact_id: int) -> bool:
    #删除一条画像事实，条目不存在时返回 False
    with get_connection() as conn:
        cursor = conn.execute("DELETE FROM profile_facts WHERE id=?", (fact_id,))
        return cursor.rowcount > 0


def list_facts() -> list[dict]:
    #列出全部画像事实，按 id 升序
    with get_connection() as conn:
        rows = conn.execute("SELECT id, content, created_at, updated_at FROM profile_facts ORDER BY id").fetchall()
    return [dict(row) for row in rows]


def profile_text() -> str:
    #把画像事实拼成注入系统提示词的文本（"1. ...\n2. ..."），无事实时返回空串
    facts = list_facts()
    return "\n".join(f"{i}. {row['content']}" for i, row in enumerate(facts, 1))
