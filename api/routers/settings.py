from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from agent import config as env_config
from agent.core.context import CONTEXT_WINDOW_TOKENS
from agent.session.context_config import (
    DEFAULT_COMPACT_TRIGGER_PERCENT, MAX_COMPACT_TRIGGER_PERCENT,
    MIN_COMPACT_TRIGGER_PERCENT, get_compact_trigger_percent,
    save_compact_trigger_percent,
)
from agent.session.model_config import SLOTS, _mask, get_config, get_masked_configs, save_config
from agent.session.search_config import (DEFAULT_ENGINE, get_search_config,
                                         save_search_config, tavily_configured)

from ..core.security import get_current_user

router = APIRouter(prefix="/settings", tags=["settings"])


class ModelConfigRequest(BaseModel):
    base_url: str
    api_key: str
    model_name: str


class SettingsResponse(BaseModel):
    #当前用户各槽位配置（api_key 已掩码）+ 搜索引擎状态 + 全局共享能力状态（只读）
    configs: dict[str, dict]
    search_engine: str
    search: dict
    global_capabilities: dict[str, bool]
    context: dict  #上下文自动整理：用户自定义触发比例 + 服务端默认/边界/窗口大小


class SearchEngineRequest(BaseModel):
    engine: str
    api_key: str | None = None  #可选：Tavily API key；空/掩码表示保留原 key


class ContextCompactRequest(BaseModel):
    trigger_percent: int


def _efinance_available() -> bool:
    #efinance 为爬虫库无需 key，装上即可用
    try:
        import efinance  # noqa: F401
        return True
    except ImportError:
        return False


def _search_status(user_id: int) -> dict:
    #搜索引擎状态块：当前选择、tavily 是否可用、是否需要补 key、缺省引擎及原因，
    #供前端展示提示（如"服务端未配置 TAVILY_API_KEY，已默认使用免 key 的 Python 引擎"）
    cfg = get_search_config(user_id)
    configured = tavily_configured(user_id)
    return {
        "engine": cfg["engine"],
        "tavily_configured": configured,
        "needs_key": cfg["engine"] == "tavily" and not configured,
        "default_engine": DEFAULT_ENGINE,
        "default_reason": "no_tavily_key" if DEFAULT_ENGINE == "python" else "default",
        "engines": [
            {"id": "tavily", "label": "Tavily", "needs_key": True, "configured": configured},
            {"id": "python", "label": "Python 内置（免 key）", "needs_key": False, "configured": True},
        ],
    }


@router.get("")
def get_settings(user_id: int = Depends(get_current_user)) -> SettingsResponse:
    return SettingsResponse(
        configs=get_masked_configs(user_id),
        search_engine=get_search_config(user_id)["engine"],
        search=_search_status(user_id),
        context={
            "trigger_percent": get_compact_trigger_percent(user_id),
            "default_percent": DEFAULT_COMPACT_TRIGGER_PERCENT,
            "min_percent": MIN_COMPACT_TRIGGER_PERCENT,
            "max_percent": MAX_COMPACT_TRIGGER_PERCENT,
            "window_tokens": CONTEXT_WINDOW_TOKENS,
        },
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
    #切换当前用户的搜索引擎，可同时保存 Tavily API key（前端直接配置，无需 .env）；
    #切到 tavily 但未配置任何 key 时允许保存，由响应 needs_key 提示前端补 key（搜索时再明确报错）
    try:
        cfg = save_search_config(user_id, request.engine, request.api_key)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    configured = tavily_configured(user_id)
    return {
        "status": "saved",
        "search_engine": cfg["engine"],
        "tavily_configured": configured,
        "needs_key": cfg["engine"] == "tavily" and not configured,
    }


@router.put("/context-compact")
def update_context_compact(request: ContextCompactRequest,
                           user_id: int = Depends(get_current_user)) -> dict:
    #保存当前用户的上下文自动整理触发比例（窗口百分比），自动压缩立即按新阈值生效
    try:
        percent = save_compact_trigger_percent(user_id, request.trigger_percent)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "saved", "trigger_percent": percent,
            "default_percent": DEFAULT_COMPACT_TRIGGER_PERCENT}


def _resolve_api_key(user_id: int, slot: str, incoming: str) -> str | None:
    #前端编辑配置时可能回传掩码 key（如 "sk-xxx...yyyy"）或留空，此时不得覆盖库中真实 key；
    #返回 None 表示既无真实 key 可保留、新 key 也为空（首次配置必须给完整 key）
    stored = get_config(user_id, slot)
    key = (incoming or "").strip()
    if stored is not None and (not key or key == "***" or key == _mask(stored["api_key"])):
        return stored["api_key"]  #保留原 key，仅更新 base_url/model_name
    return key or None


@router.put("/{slot}")
def update_settings(slot: str, request: ModelConfigRequest, user_id: int = Depends(get_current_user)) -> dict:
    #保存某槽位的模型配置：api_key 加密入库，响应只回掩码配置
    if slot not in SLOTS:
        raise HTTPException(status_code=400, detail=f"无效的槽位: {slot}，可选: {list(SLOTS)}")
    api_key = _resolve_api_key(user_id, slot, request.api_key)
    if api_key is None:
        raise HTTPException(status_code=400, detail="api_key 不能为空（首次配置请填写完整 key）")
    save_config(user_id, slot, request.base_url, api_key, request.model_name)
    return {"status": "saved", "slot": slot, "config": get_masked_configs(user_id)[slot]}
