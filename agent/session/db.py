import sqlite3
from pathlib import Path

#数据库文件路径，与本模块同目录；对话历史与知识库 memory.db 完全分开
DB_PATH = Path(__file__).parent / "sessions.db"

#sessions 表只存结构化会话状态；turns 表只存轮次元数据，轮次正文存 Chroma（turns_store）；
#users/tokens 为账号与登录态；profile_facts 为用户画像（按 user_id 隔离）
_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS tokens (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    user_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    context_tokens INTEGER NOT NULL DEFAULT 0,
    active_toolsets TEXT NOT NULL DEFAULT '["terminal"]',
    summary TEXT,
    compacted_until_seq INTEGER NOT NULL DEFAULT 0,
    paused_thread_id TEXT,
    paused_input TEXT
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
    user_id INTEGER,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS user_model_configs (
    user_id INTEGER NOT NULL,
    slot TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key_enc TEXT NOT NULL,
    model_name TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (user_id, slot)
);
-- 以下为事实核查流水线（agent/research）的结构化存储
CREATE TABLE IF NOT EXISTS research_tasks (
    task_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    topic TEXT NOT NULL,
    company TEXT NOT NULL DEFAULT '',
    research_type TEXT NOT NULL DEFAULT 'policy',
    preferred_sources TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'running',
    progress REAL NOT NULL DEFAULT 0,
    report_md TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS task_materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    publisher TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    source_type TEXT NOT NULL DEFAULT '',
    credibility REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS claims (
    id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    statement TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'review',
    confidence REAL NOT NULL DEFAULT 0,
    supervisor_verdict TEXT NOT NULL DEFAULT '',
    reviewer_verdict TEXT NOT NULL DEFAULT '',
    conflict_reason TEXT,
    issue_type TEXT,
    human_action TEXT,
    human_note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (task_id, id)
);
CREATE TABLE IF NOT EXISTS evidence (
    id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    publisher TEXT NOT NULL DEFAULT '',
    published_at TEXT NOT NULL DEFAULT '',
    locator TEXT NOT NULL DEFAULT '',
    quote TEXT NOT NULL DEFAULT '',
    source_type TEXT NOT NULL DEFAULT '',
    relation TEXT NOT NULL DEFAULT 'support',
    credibility REAL NOT NULL DEFAULT 0,
    url TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (task_id, id)
);
CREATE TABLE IF NOT EXISTS claim_evidence (
    task_id TEXT NOT NULL,
    claim_id TEXT NOT NULL,
    evidence_id TEXT NOT NULL,
    PRIMARY KEY (task_id, claim_id, evidence_id)
);
CREATE TABLE IF NOT EXISTS task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    actor TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    ts TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS task_guidance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    content TEXT NOT NULL,
    consumed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS history_analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    metric TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT '',
    payload TEXT NOT NULL,
    attached INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
"""


def get_connection() -> sqlite3.Connection:
    #获取一个数据库连接，Row 工厂让查询结果可以按列名访问
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _add_column_if_missing(conn: sqlite3.Connection, table: str, column: str, ddl: str) -> None:
    #老库迁移：列不存在时 ALTER TABLE 加列（存量行该列为 NULL，由 users.ensure_admin 回填）
    columns = [row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()]
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")


def init_db() -> None:
    #初始化数据库：建表（已存在则跳过）+ 老库加列迁移
    with get_connection() as conn:
        conn.executescript(_SCHEMA)
        _add_column_if_missing(conn, "sessions", "user_id", "user_id INTEGER")
        _add_column_if_missing(conn, "sessions", "paused_thread_id", "paused_thread_id TEXT")
        _add_column_if_missing(conn, "sessions", "paused_input", "paused_input TEXT")
        _add_column_if_missing(conn, "profile_facts", "user_id", "user_id INTEGER")
        _add_column_if_missing(conn, "evidence", "url", "url TEXT NOT NULL DEFAULT ''")
