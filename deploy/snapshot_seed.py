"""Build a consistent snapshot of local FactShield runtime data into deploy/seed/.

Used by the Dockerfile as the "cloud == local" data seed. SQLite files are copied
via the sqlite3 backup API so a live local backend (WAL mode) still yields a
consistent snapshot; Chroma auxiliary files and workspace uploads are copied as-is.
Run from the repo root:  python deploy/snapshot_seed.py
"""

from __future__ import annotations

import shutil
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / "deploy" / "seed"

# (source sqlite file, destination under deploy/seed/)
SQLITE_FILES = [
    (ROOT / "agent" / "session" / "sessions.db", SEED / "session" / "sessions.db"),
    (ROOT / "agent" / "session" / "checkpoints.db", SEED / "session" / "checkpoints.db"),
    (
        ROOT / "agent" / "session" / "chroma_db" / "chroma.sqlite3",
        SEED / "session" / "chroma_db" / "chroma.sqlite3",
    ),
    (ROOT / "agent" / "memory" / "SQLite" / "memory.db", SEED / "memory" / "SQLite" / "memory.db"),
    (
        ROOT / "agent" / "memory" / "vector_store" / "chroma_db" / "chroma.sqlite3",
        SEED / "memory" / "vector_store" / "chroma_db" / "chroma.sqlite3",
    ),
]

# (source dir, destination dir) copied recursively, excluding __pycache__
DIR_COPIES = [
    (ROOT / "agent" / "session" / "chroma_db", SEED / "session" / "chroma_db"),
    (ROOT / "agent" / "memory" / "vector_store" / "chroma_db", SEED / "memory" / "vector_store" / "chroma_db"),
    (ROOT / "agent" / "workspace", SEED / "workspace"),
]

# (single source file, destination file)
FILE_COPIES = [
    (ROOT / "agent" / "session" / ".master_key", SEED / "session" / ".master_key"),
]


def _ignore_pycache(_dir: str, names: list[str]) -> set[str]:
    # Skip bytecode caches and SQLite files (those come from the consistent backup above).
    return ({name for name in names if name == "__pycache__" or name.endswith(".sqlite3")}) & set(names)


def backup_sqlite(src: Path, dst: Path) -> int:
    dst.parent.mkdir(parents=True, exist_ok=True)
    src_conn = sqlite3.connect(f"file:{src.as_posix()}?mode=ro", uri=True)
    dst_conn = sqlite3.connect(dst)
    try:
        src_conn.backup(dst_conn)
        dst_conn.commit()
    finally:
        dst_conn.close()
        src_conn.close()
    return dst.stat().st_size


def main() -> None:
    if SEED.exists():
        shutil.rmtree(SEED)
    SEED.mkdir(parents=True)

    for src, dst in SQLITE_FILES:
        size = backup_sqlite(src, dst)
        print(f"sqlite  {str(dst.relative_to(SEED)):55s} {size:>10,} B")

    for src, dst in DIR_COPIES:
        if not src.exists():
            print(f"skip    {src} (missing)")
            continue
        shutil.copytree(src, dst, ignore=_ignore_pycache, dirs_exist_ok=True)
        total = sum(p.stat().st_size for p in dst.rglob("*") if p.is_file())
        print(f"dir     {str(dst.relative_to(SEED)):55s} {total:>10,} B")

    for src, dst in FILE_COPIES:
        if not src.exists():
            print(f"skip    {src} (missing)")
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        print(f"file    {str(dst.relative_to(SEED)):55s} {dst.stat().st_size:>10,} B")

    total = sum(p.stat().st_size for p in SEED.rglob("*") if p.is_file())
    print(f"\nseed snapshot ready: {SEED} ({total:,} B total)")


if __name__ == "__main__":
    main()
