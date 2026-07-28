from ..vector_store.store import add_document
from .db import get_connection


def save_markdown(content: str) -> None:
    """将转换出的完整 Markdown 内容保存：
    非结构化的文档正文写入 Chroma 向量库，结构化元数据登记到 SQLite"""
    group_id,chunk_count = add_document(content)#正文切分后写入向量库
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO documents (group_id,chunk_count) VALUES (?,?)",
            (group_id,chunk_count)
        )
