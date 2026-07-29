from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from agent.memory.SQLite.db import get_connection, init_db
from agent.memory.SQLite.save import save_markdown

from ..core.security import get_current_user

router = APIRouter(prefix="/knowledge", tags=["knowledge"], dependencies=[Depends(get_current_user)])

init_db()  #确保 documents 表存在


class SaveDocumentRequest(BaseModel):
    content: str


class SaveDocumentResponse(BaseModel):
    status: str


class DocumentMeta(BaseModel):
    id: int
    group_id: str
    chunk_count: int
    created_at: str


class DocumentListResponse(BaseModel):
    documents: list[DocumentMeta]


@router.post("/documents")
def save_document(request: SaveDocumentRequest) -> SaveDocumentResponse:
    #把一篇 Markdown 文本写入知识库（Chroma 向量库 + SQLite 元数据）
    try:
        save_markdown(request.content)
    except RuntimeError as e:
        #未配置 Embedding 模型
        raise HTTPException(status_code=503, detail=str(e))
    return SaveDocumentResponse(status="saved")


@router.get("/documents")
def list_documents(group_id: str | None = None) -> DocumentListResponse:
    #列出知识库中文档的元数据；可按 group_id 前缀过滤（如 task:FS-2026-001 回溯某任务采集的素材）
    with get_connection() as conn:
        if group_id:
            rows = conn.execute(
                "SELECT id, group_id, chunk_count, created_at FROM documents"
                " WHERE group_id LIKE ? ORDER BY id DESC", (f"{group_id}%",)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, group_id, chunk_count, created_at FROM documents ORDER BY id DESC"
            ).fetchall()
    return DocumentListResponse(documents=[DocumentMeta(**dict(row)) for row in rows])
