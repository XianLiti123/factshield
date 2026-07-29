from fastapi import APIRouter, Depends
from pydantic import BaseModel

from agent import config
from agent.session.model_config import get_config

from ..core.security import get_current_user

router = APIRouter(tags=["capabilities"])


class CapabilitiesResponse(BaseModel):
    #各可选能力是否已配置就绪（只报布尔值，不泄露 key）
    llm: bool
    web_search: bool
    vision: bool
    embedding: bool
    reranker: bool


@router.get("/capabilities")
def capabilities(user_id: int = Depends(get_current_user)) -> CapabilitiesResponse:
    #llm/vision 为每用户配置（未配置即不可用）；web/embedding/reranker 为全局共享配置
    return CapabilitiesResponse(
        llm=get_config(user_id, "llm") is not None,
        web_search=bool(config.TAVILY_API_KEY),
        vision=get_config(user_id, "vision") is not None,
        embedding=bool(config.EMBEDDING_API_KEY and config.EMBEDDING_BASE_URL and config.EMBEDDING_MODEL),
        reranker=bool(config.RERANKER_API_KEY and config.RERANKER_BASE_URL and config.RERANKER_MODEL),
    )
