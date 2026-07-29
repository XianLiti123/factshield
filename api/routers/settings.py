from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from agent import config as env_config
from agent.session.model_config import SLOTS, get_masked_configs, save_config

from ..core.security import get_current_user

router = APIRouter(prefix="/settings", tags=["settings"])


class ModelConfigRequest(BaseModel):
    base_url: str
    api_key: str
    model_name: str


class SettingsResponse(BaseModel):
    #当前用户各槽位配置（api_key 已掩码）+ 全局共享能力状态（只读）
    configs: dict[str, dict]
    global_capabilities: dict[str, bool]


@router.get("")
def get_settings(user_id: int = Depends(get_current_user)) -> SettingsResponse:
    return SettingsResponse(
        configs=get_masked_configs(user_id),
        global_capabilities={
            #embedding/reranker 为全局共享能力，只报告就绪状态，不含 key
            "embedding": bool(env_config.EMBEDDING_API_KEY and env_config.EMBEDDING_BASE_URL and env_config.EMBEDDING_MODEL),
            "reranker": bool(env_config.RERANKER_API_KEY and env_config.RERANKER_BASE_URL and env_config.RERANKER_MODEL),
        },
    )


@router.put("/{slot}")
def update_settings(slot: str, request: ModelConfigRequest, user_id: int = Depends(get_current_user)) -> dict:
    #保存某槽位的模型配置：api_key 加密入库，响应只回掩码配置
    if slot not in SLOTS:
        raise HTTPException(status_code=400, detail=f"无效的槽位: {slot}，可选: {list(SLOTS)}")
    save_config(user_id, slot, request.base_url, request.api_key, request.model_name)
    return {"status": "saved", "slot": slot, "config": get_masked_configs(user_id)[slot]}
