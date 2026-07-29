from fastapi import APIRouter
from pydantic import BaseModel

from ..utils.reserved import not_implemented

router = APIRouter(prefix="/settings", tags=["settings"])

#设置接口预留：Agent 端 config.py 是启动时静态读 .env，需先支持运行时配置与持久化


class ModelSlot(BaseModel):
    slot: str  # llm / vision / embedding / reranker
    base_url: str
    api_key: str
    model_name: str


class Settings(BaseModel):
    models: list[ModelSlot]
    search_provider: str
    search_api_key: str | None = None
    deep_thinking: bool = True


@router.get("", response_model=Settings)
def get_settings() -> None:
    raise not_implemented("读取系统设置")


@router.put("")
def update_settings(settings: Settings) -> None:
    raise not_implemented("保存系统设置")
