from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from agent import config as env_config
from agent.session.model_config import SLOTS, get_masked_configs, save_config
from agent.session.search_config import get_engine, set_engine

from ..core.security import get_current_user

router = APIRouter(prefix="/settings", tags=["settings"])


class ModelConfigRequest(BaseModel):
    base_url: str
    api_key: str
    model_name: str


class SettingsResponse(BaseModel):
    #当前用户各槽位配置（api_key 已掩码）+ 搜索引擎选择 + 全局共享能力状态（只读）
    configs: dict[str, dict]
    search_engine: str
    global_capabilities: dict[str, bool]


class SearchEngineRequest(BaseModel):
    engine: str


def _efinance_available() -> bool:
    #efinance 为爬虫库无需 key，装上即可用
    try:
        import efinance  # noqa: F401
        return True
    except ImportError:
        return False


@router.get("")
def get_settings(user_id: int = Depends(get_current_user)) -> SettingsResponse:
    return SettingsResponse(
        configs=get_masked_configs(user_id),
        search_engine=get_engine(user_id),
        global_capabilities={
            #以下均为全局共享能力（.env 由运维配置），只报告就绪状态，不含 key
            "embedding": bool(env_config.EMBEDDING_API_KEY and env_config.EMBEDDING_BASE_URL and env_config.EMBEDDING_MODEL),
            "reranker": bool(env_config.RERANKER_API_KEY and env_config.RERANKER_BASE_URL and env_config.RERANKER_MODEL),
            "tavily": bool(env_config.TAVILY_API_KEY),
            "tickflow": bool(env_config.TICKFLOW_API_KEY),
            "efinance": _efinance_available(),
        },
    )


@router.put("/search-engine")
def update_search_engine(request: SearchEngineRequest, user_id: int = Depends(get_current_user)) -> dict:
    #切换当前用户的搜索引擎；选 tavily 但服务端未配置 key 时直接报错（不静默降级）
    #注意：必须声明在 PUT /{slot} 之前，否则 "search-engine" 会被当成槽位名匹配
    try:
        set_engine(user_id, request.engine)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if request.engine == "tavily" and not env_config.TAVILY_API_KEY:
        raise HTTPException(status_code=400,
                            detail="服务端未配置 TAVILY_API_KEY，无法切换到 Tavily；请运维配置后重启服务")
    return {"status": "saved", "search_engine": request.engine}


@router.put("/{slot}")
def update_settings(slot: str, request: ModelConfigRequest, user_id: int = Depends(get_current_user)) -> dict:
    #保存某槽位的模型配置：api_key 加密入库，响应只回掩码配置
    if slot not in SLOTS:
        raise HTTPException(status_code=400, detail=f"无效的槽位: {slot}，可选: {list(SLOTS)}")
    save_config(user_id, slot, request.base_url, request.api_key, request.model_name)
    return {"status": "saved", "slot": slot, "config": get_masked_configs(user_id)[slot]}
