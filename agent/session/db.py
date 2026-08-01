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
    display_name TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    avatar BLOB,
    avatar_mime TEXT NOT NULL DEFAULT '',
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
CREATE TABLE IF NOT EXISTS user_data_sources (
    user_id INTEGER NOT NULL,
    source_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    mode TEXT NOT NULL DEFAULT 'http',
    specification_enc TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (user_id, source_id)
);
CREATE TABLE IF NOT EXISTS user_search_settings (
    user_id INTEGER PRIMARY KEY,
    engine TEXT NOT NULL DEFAULT 'tavily',
    api_key_enc TEXT NOT NULL DEFAULT '',  -- 用户级 Tavily API key（加密入库，可空：回退 .env）
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
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
    summary_md TEXT NOT NULL DEFAULT '',
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
    credibility_level TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS task_uploads (
    upload_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    task_id TEXT,
    filename TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
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
    credibility_level TEXT NOT NULL DEFAULT '',
    relevance REAL NOT NULL DEFAULT 0,  -- 检索相关性分数（reranker 或 RRF 融合分），证据排序依据
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
CREATE TABLE IF NOT EXISTS agent_tool_traces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    actor TEXT NOT NULL,             -- collector | deepener | reviewer（子智能体工具调用）
    node TEXT NOT NULL DEFAULT '',   -- collect | deepen | review
    seq INTEGER NOT NULL,            -- 该子智能体本次任务内的调用序号（1 起，跨节点递增）
    tool TEXT NOT NULL,
    args TEXT NOT NULL DEFAULT '{}',
    result TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_agent_tool_traces_task ON agent_tool_traces(task_id, actor);
-- 流程执行错误登记（重试/自动修复/人工修复共用，供 /errors 接口查询）
CREATE TABLE IF NOT EXISTS flow_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    flow_type TEXT NOT NULL,             -- chat | subagent | research | research_retry | history_analysis
    flow_id TEXT NOT NULL,               -- 会话 session_id / 任务 task_id
    node TEXT NOT NULL DEFAULT '',       -- 失败的节点/子智能体名（如 plan、subagent），重取证时为主张 id
    prompt TEXT NOT NULL DEFAULT '',     -- 触发输入（重启时复用：子代理提示词/用户消息/研究主题）
    error TEXT NOT NULL,                 -- 错误信息
    traceback TEXT NOT NULL DEFAULT '',  -- 完整堆栈
    attempts INTEGER NOT NULL DEFAULT 1, -- 已尝试次数（重试次数 + 1）
    auto_repair INTEGER NOT NULL DEFAULT 0,  -- 是否带自动修复（失败后自动重启对应流程）
    repair_count INTEGER NOT NULL DEFAULT 0, -- 已修复次数
    status TEXT NOT NULL DEFAULT 'failed',   -- failed | repairing | repaired | repair_failed
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    repaired_at TEXT
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
        _add_column_if_missing(conn, "users", "display_name", "display_name TEXT NOT NULL DEFAULT ''")
        _add_column_if_missing(conn, "users", "avatar", "avatar BLOB")
        _add_column_if_missing(conn, "users", "avatar_mime", "avatar_mime TEXT NOT NULL DEFAULT ''")
        _add_column_if_missing(conn, "evidence", "url", "url TEXT NOT NULL DEFAULT ''")
        _add_column_if_missing(conn, "research_tasks", "summary_md", "summary_md TEXT NOT NULL DEFAULT ''")
        _add_column_if_missing(conn, "task_materials", "credibility_level", "credibility_level TEXT NOT NULL DEFAULT ''")
        _add_column_if_missing(conn, "task_materials", "content", "content TEXT NOT NULL DEFAULT ''")
        _add_column_if_missing(conn, "evidence", "credibility_level", "credibility_level TEXT NOT NULL DEFAULT ''")
        _add_column_if_missing(conn, "user_search_settings", "api_key_enc", "api_key_enc TEXT NOT NULL DEFAULT ''")
        _add_column_if_missing(conn, "evidence", "relevance", "relevance REAL NOT NULL DEFAULT 0")
        #存量用户显示名为空时回填邮箱前缀
        conn.execute("UPDATE users SET display_name=substr(email,1,instr(email,'@')-1) WHERE display_name=''")
        _init_fts(conn)


def _init_fts(conn: sqlite3.Connection) -> None:
    #素材全文索引（FTS5 trigram tokenizer，支持中文子串匹配），混合检索的关键词召回路之一；
    #SQLite 编译缺 FTS5 时静默跳过，关键词召回自动退化为 Chroma where_document
    try:
        #先删后建：老库已存在旧定义触发器时强制替换（FTS5 触发器定义不可 ALTER）
        conn.executescript("""
        DROP TRIGGER IF EXISTS task_materials_fts_ai;
        DROP TRIGGER IF EXISTS task_materials_fts_ad;
        DROP TRIGGER IF EXISTS task_materials_fts_au;
        CREATE VIRTUAL TABLE IF NOT EXISTS task_materials_fts USING fts5(
            task_id UNINDEXED, group_id UNINDEXED, title, publisher, content,
            tokenize='trigram'
        );
        CREATE TRIGGER task_materials_fts_ai AFTER INSERT ON task_materials BEGIN
            INSERT INTO task_materials_fts (rowid, task_id, group_id, title, publisher, content)
            VALUES (new.id, new.task_id, new.group_id, new.title, new.publisher, new.content);
        END;
        CREATE TRIGGER task_materials_fts_ad AFTER DELETE ON task_materials BEGIN
            DELETE FROM task_materials_fts WHERE rowid = old.id;
        END;
        CREATE TRIGGER task_materials_fts_au AFTER UPDATE ON task_materials BEGIN
            DELETE FROM task_materials_fts WHERE rowid = old.id;
            INSERT INTO task_materials_fts (rowid, task_id, group_id, title, publisher, content)
            VALUES (new.id, new.task_id, new.group_id, new.title, new.publisher, new.content);
        END;
        CREATE TABLE IF NOT EXISTS fts_sync (
            table_name TEXT PRIMARY KEY,
            last_id INTEGER NOT NULL DEFAULT 0
        );
        """)
        #存量素材增量回填（上次同步的最大 id 之后的行；触发器只接管新写入）
        row = conn.execute("SELECT last_id FROM fts_sync WHERE table_name='task_materials'").fetchone()
        last = row["last_id"] if row else 0
        cur = conn.execute("SELECT COALESCE(MAX(id),0) AS m FROM task_materials").fetchone()["m"]
        if cur > last:
            #OR REPLACE：幂等回填（覆盖已存在行，兼容崩溃中断/手工重置同步位）
            conn.execute(
                "INSERT OR REPLACE INTO task_materials_fts (rowid, task_id, group_id, title, publisher, content)"
                " SELECT id, task_id, group_id, title, publisher, content FROM task_materials WHERE id > ?",
                (last,))
            conn.execute(
                "INSERT INTO fts_sync (table_name, last_id) VALUES ('task_materials', ?)"
                " ON CONFLICT(table_name) DO UPDATE SET last_id=excluded.last_id", (cur,))
    except sqlite3.OperationalError:
        pass  #FTS5 不可用：跳过，由调用方降级
