import sqlite3
from pathlib import Path

from langgraph.checkpoint.sqlite import SqliteSaver

#暂停/恢复用的 checkpointer：存独立文件 checkpoints.db，由 SqliteSaver 自建表；
#check_same_thread=False 适配 api 线程池中迭代
DB_PATH = Path(__file__).parent / "checkpoints.db"
_conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)

checkpointer = SqliteSaver(_conn)


def delete_threads(session_id: str) -> None:
    #删除一个会话的全部 graph thread 检查点（thread_id 形如 {session_id}-{seq}），
    #防止会话删除重建后撞上同名旧 thread 复活陈旧状态
    tables = [row[0] for row in _conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    for table in tables:
        cols = [row[1] for row in _conn.execute(f"PRAGMA table_info({table})").fetchall()]
        if "thread_id" in cols:
            _conn.execute(f"DELETE FROM {table} WHERE thread_id LIKE ?", (f"{session_id}-%",))
    _conn.commit()
