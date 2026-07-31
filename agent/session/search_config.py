from ..searchengine import ENGINES
from .db import get_connection, init_db

init_db()  #确保 user_search_settings 表存在

DEFAULT_ENGINE = "tavily"  #未选择时保持存量行为


def get_engine(user_id: int) -> str:
    #读取用户选择的搜索引擎，缺省 tavily
    with get_connection() as conn:
        row = conn.execute(
            "SELECT engine FROM user_search_settings WHERE user_id=?", (user_id,)
        ).fetchone()
    return row["engine"] if row else DEFAULT_ENGINE


def set_engine(user_id: int, engine: str) -> None:
    #保存用户选择的搜索引擎
    if engine not in ENGINES:
        raise ValueError(f"无效的搜索引擎: {engine}，可选: {ENGINES}")
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO user_search_settings (user_id, engine, updated_at)"
            " VALUES (?,?,datetime('now','localtime'))"
            " ON CONFLICT(user_id) DO UPDATE SET engine=excluded.engine, updated_at=excluded.updated_at",
            (user_id, engine)
        )
