import sqlite3
from pathlib import Path

#数据库文件路径，与本模块同目录
DB_PATH = Path(__file__).parent / "memory.db"

#建表语句：documents 表只存结构化元数据，文档正文（非结构化数据）存 Chroma 向量库
_SCHEMA = """
CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id TEXT NOT NULL,
    chunk_count INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
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


if __name__ == "__main__":
    init_db()
    print(f"数据库已初始化: {DB_PATH}")
