import sqlite3
from pathlib import Path

#数据库文件路径，与本模块同目录；对话历史与知识库 memory.db 完全分开
DB_PATH = Path(__file__).parent / "sessions.db"

#sessions 表只存结构化会话状态；turns 表只存轮次元数据，轮次正文存 Chroma（turns_store）
_SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    context_tokens INTEGER NOT NULL DEFAULT 0,
    active_toolsets TEXT NOT NULL DEFAULT '["terminal"]',
    summary TEXT,
    compacted_until_seq INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(session_id, seq)
);
CREATE TABLE IF NOT EXISTS profile_facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
"""


def get_connection() -> sqlite3.Connection:
    #获取一个数据库连接，Row 工厂让查询结果可以按列名访问
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    #初始化数据库，建表（已存在则跳过）
    with get_connection() as conn:
        conn.executescript(_SCHEMA)
