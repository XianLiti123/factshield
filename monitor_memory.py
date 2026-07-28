"""开发用监测脚本：持续查看 SQLite 元数据库和 Chroma 向量库中的数据。
独立于 Agent 运行，直接读取存储文件，不需要任何 API key。

用法:
    python monitor_memory.py          # 每 3 秒刷新一次
    python monitor_memory.py 5        # 每 5 秒刷新一次
    python monitor_memory.py --once   # 只打印一次
Ctrl+C 退出
"""
import os
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path

import chromadb
from chromadb.config import Settings

BASE = Path(__file__).parent
DB_PATH = BASE / "agent" / "memory" / "SQLite" / "memory.db"
CHROMA_DIR = BASE / "agent" / "memory" / "vector_store" / "chroma_db"

PREVIEW_LEN = 60#片段内容预览长度


def fetch_sqlite() -> list[sqlite3.Row] | None:
    #读取 documents 表全部元数据，库文件不存在时返回 None
    if not DB_PATH.exists():
        return None
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT * FROM documents ORDER BY id DESC").fetchall()
    conn.close()
    return rows


def fetch_chroma() -> dict | None:
    #读取向量库 documents 集合的全部片段，目录或集合不存在时返回 None
    if not CHROMA_DIR.exists():
        return None
    client = chromadb.PersistentClient(
        path=str(CHROMA_DIR),
        settings=Settings(anonymized_telemetry=False)
    )
    try:
        collection = client.get_collection("documents")
    except Exception:
        return None
    return collection.get()#包含 ids、documents、metadatas


def render() -> None:
    #清屏并打印当前两个库的数据
    os.system("cls" if os.name == "nt" else "clear")
    print(f"记忆库监测  ({datetime.now().strftime('%Y-%m-%d %H:%M:%S')})  Ctrl+C 退出")
    print("=" * 70)

    rows = fetch_sqlite()
    if rows is None:
        print(f"\n[SQLite] 库文件不存在: {DB_PATH}")
    else:
        print(f"\n[SQLite] documents 表  共 {len(rows)} 条  ({DB_PATH})")
        if not rows:
            print("  (空)")
        for r in rows:
            print(f"  id={r['id']:<4} group_id={r['group_id'][:12]}...  "
                  f"chunk数={r['chunk_count']:<3} 入库时间={r['created_at']}")

    data = fetch_chroma()
    if data is None:
        print(f"\n[Chroma] 向量库或 documents 集合不存在  ({CHROMA_DIR})")
    else:
        total = len(data["ids"])
        print(f"\n[Chroma] documents 集合  共 {total} 个片段  ({CHROMA_DIR})")
        if total == 0:
            print("  (空)")
        for cid, doc, meta in zip(data["ids"], data["documents"], data["metadatas"]):
            preview = (doc or "").replace("\n", " ")[:PREVIEW_LEN]
            print(f"  {cid}  [组 {(meta or {}).get('group_id', '?')[:12]}... "
                  f"第 {(meta or {}).get('chunk_index', '?')} 块]")
            print(f"    {preview}...")
    print()


if __name__ == "__main__":
    if "--once" in sys.argv:
        render()
    else:
        interval = float(sys.argv[1]) if len(sys.argv) > 1 else 3.0
        try:
            while True:
                render()
                time.sleep(interval)
        except KeyboardInterrupt:
            print("已退出监测")
