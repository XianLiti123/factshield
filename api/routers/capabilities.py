from fastapi import APIRouter
from pydantic import BaseModel

from agent import config

router = APIRouter(tags=["capabilities"])


class CapabilitiesResponse(BaseModel):
    #各可选能力是否已配置就绪（只报布尔值，不泄露 key）
    llm: bool
    web_search: bool
    vision: bool
    embedding: bool
    reranker: bool


@router.get("/capabilities")
def capabilities() -> CapabilitiesResponse:
    return CapabilitiesResponse(
        llm=bool(config.DEEPSEEK_API_KEY),
        web_search=bool(config.TAVILY_API_KEY),
        vision=bool(config.VISION_API_KEY and config.VISION_BASE_URL and config.VISION_MODEL),
        embedding=bool(config.EMBEDDING_API_KEY and config.EMBEDDING_BASE_URL and config.EMBEDDING_MODEL),
        reranker=bool(config.RERANKER_API_KEY and config.RERANKER_BASE_URL and config.RERANKER_MODEL),
    )
