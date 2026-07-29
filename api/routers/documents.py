import uuid
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Query, UploadFile

from agent.tools.convert import ai_recognize_document, convert_document

router = APIRouter(prefix="/documents", tags=["documents"])

#上传文件落盘目录（agent 工作区内，运行时自动创建）
UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent / "agent" / "workspace" / "uploads"


@router.post("/convert")
async def convert(
    file: UploadFile,
    mode: Literal["normal", "ai"] = Query(default="normal", description="normal=markitdown 转换，ai=视觉模型识别（仅图片/PDF）"),
    max_length: int = Query(default=5000, description="返回内容最大字符数，0 为不截断"),
    save: bool = Query(default=True, description="是否将完整内容写入知识库"),
) -> dict[str, str]:
    #上传文档并转换为 Markdown；save=true 时完整内容自动入知识库
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    suffix = Path(file.filename or "").suffix
    file_path = UPLOAD_DIR / f"{uuid.uuid4().hex}{suffix}"
    file_path.write_bytes(await file.read())

    tool = ai_recognize_document if mode == "ai" else convert_document
    content = tool.invoke({"file_path": str(file_path), "max_length": max_length, "safe": save})
    return {"filename": file.filename or "", "mode": mode, "content": content}
