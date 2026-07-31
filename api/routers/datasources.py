from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from agent.session.data_sources import list_sources, replace_sources

from ..core.security import get_current_user

router = APIRouter(prefix="/data-sources", tags=["data-sources"])


class DataSourceItem(BaseModel):
    #与前端 DataSourceConfig 结构一致
    id: str
    name: str
    description: str = ""
    category: str = ""
    mode: str = "http"
    specification: str = ""
    enabled: bool = False


class DataSourcesRequest(BaseModel):
    data_sources: list[DataSourceItem]


@router.get("")
def get_data_sources(user_id: int = Depends(get_current_user)) -> dict:
    #返回当前用户全部自定义数据源
    return {"data_sources": list_sources(user_id)}


@router.put("")
def put_data_sources(request: DataSourcesRequest, user_id: int = Depends(get_current_user)) -> dict:
    #整体保存用户的数据源列表（前端以整列表为单位编辑）
    try:
        replace_sources(user_id, [item.model_dump() for item in request.data_sources])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"status": "saved", "data_sources": list_sources(user_id)}
