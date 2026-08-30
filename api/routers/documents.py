import uuid
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, Query, UploadFile

from agent.tools.convert import ai_recognize_document, convert_document

from ..core.security import get_current_user

router = APIRouter(prefix="/documents", tags=["documents"], dependencies=[Depends(get_current_user)])

#上传文件落盘目录（agent 工作区内，运行时自动创建）
UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent / "agent" / "workspace" / "uploads"


@router.post("/convert")
async def convert(
    file: UploadFile,
    mode: Literal["normal", "ai"] = Query(default="normal", description="normal=markitdown 转换，ai=视觉模型识别（仅图片/PDF）"),
    max_length: int = Query(default=5000, description="返回内容最大字符数，0 为不截断"),
    save: bool = Query(default=True, description="是否将完整内容写入知识库"),
    user_id: int = Depends(get_current_user),
) -> dict[str, str]:
    #上传文档并转换为 Markdown；save=true 时完整内容自动入知识库
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    suffix = Path(file.filename or "").suffix
    file_path = UPLOAD_DIR / f"{uuid.uuid4().hex}{suffix}"
    file_path.write_bytes(await file.read())

    tool = ai_recognize_document if mode == "ai" else convert_document
    args: dict = {"file_path": str(file_path), "max_length": max_length, "safe": save}
    if mode == "ai":
        #ai_recognize_document 的 user_id 走 InjectedState；直接调用时若不显式传入会按"未配置视觉模型"处理
        args["user_id"] = user_id
    content = tool.invoke(args)
    return {"filename": file.filename or "", "mode": mode, "content": content}


@router.post("/upload")
async def upload_attachment(file: UploadFile) -> dict:
    #纯上传接口：附件落盘后返回本地路径，供 Agent 按路径调用读取工具（convert_document /
    #ai_recognize_document），避免发送前无条件转换、也避免图片内容被塞进消息上下文
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    suffix = Path(file.filename or "").suffix.lower() or ".bin"
    file_path = UPLOAD_DIR / f"{uuid.uuid4().hex}{suffix}"
    file_path.write_bytes(await file.read())
    return {
        "file_path": str(file_path),
        "filename": file.filename or "",
        "size": file_path.stat().st_size,
    }
