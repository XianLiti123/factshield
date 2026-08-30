from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from agent.failures import get_error, list_errors, mark_repaired, repair_error

from ..core.security import get_current_user

router = APIRouter(prefix="/errors", tags=["errors"])

#流程错误查看与修复接口：
#GET /errors        错误列表（按流程类型/流程id/状态过滤，分页）
#GET /errors/{id}   错误详情（含堆栈）
#POST /errors/{id}/repair   触发修复：重启对应的流程（与自动修复同路径）


class FlowError(BaseModel):
    #错误记录 DTO（/errors 列表与详情共用）
    id: int
    flowType: str        #chat | subagent | research | research_retry | history_analysis
    flowId: str          #会话 session_id / 任务 task_id
    node: str            #失败的节点/子智能体名
    error: str           #错误信息
    attempts: int        #已尝试次数
    autoRepair: bool     #是否自动修复过
    repairCount: int     #修复次数
    status: str          #failed | repairing | repaired | repair_failed
    createdAt: str
    updatedAt: str
    repairedAt: str | None = None


class FlowErrorDetail(FlowError):
    prompt: str      #触发输入（修复时复用）
    traceback: str   #完整堆栈


@router.get("")
def list_flow_errors(flow_type: str | None = None, flow_id: str | None = None,
                     status: str | None = None, limit: int = 50, offset: int = 0,
                     user_id: int = Depends(get_current_user)) -> dict:
    #错误列表（倒序，limit 上限 200 防拖库）
    result = list_errors(user_id, flow_type=flow_type, flow_id=flow_id,
                         status=status, limit=min(limit, 200), offset=max(0, offset))
    return {
        "total": result["total"],
        "errors": [FlowError(
            id=r["id"], flowType=r["flow_type"], flowId=r["flow_id"], node=r["node"],
            error=r["error"], attempts=r["attempts"], autoRepair=bool(r["auto_repair"]),
            repairCount=r["repair_count"], status=r["status"],
            createdAt=r["created_at"], updatedAt=r["updated_at"],
            repairedAt=r["repaired_at"],
        ) for r in result["errors"]],
    }


@router.get("/{error_id}")
def get_flow_error(error_id: int, user_id: int = Depends(get_current_user)) -> FlowErrorDetail:
    #错误详情：含触发输入与完整堆栈（供排查与修复）
    err = get_error(error_id, user_id)
    if err is None:
        raise HTTPException(status_code=404, detail="错误记录不存在")  #他人记录不暴露存在性
    return FlowErrorDetail(
        id=err["id"], flowType=err["flow_type"], flowId=err["flow_id"], node=err["node"],
        prompt=err["prompt"], error=err["error"], traceback=err["traceback"],
        attempts=err["attempts"], autoRepair=bool(err["auto_repair"]),
        repairCount=err["repair_count"], status=err["status"],
        createdAt=err["created_at"], updatedAt=err["updated_at"],
        repairedAt=err["repaired_at"],
    )


@router.post("/{error_id}/repair")
def repair_flow_error(error_id: int, user_id: int = Depends(get_current_user)) -> dict:
    #触发修复：后台重启对应的流程（研究任务整条重启/重取证重启/历史统计重启/
    #子代理重启/对话轮次重跑），修复进度经错误记录状态反映，完成/失败自动回写
    err = get_error(error_id, user_id)
    if err is None:
        raise HTTPException(status_code=404, detail="错误记录不存在")
    try:
        repair_error(error_id, user_id)
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))  #已修复/修复中
    return {"status": "repairing", "error_id": error_id,
            "flow_type": err["flow_type"], "flow_id": err["flow_id"]}


#手动标记已修复（用户自查后确认无需重启时使用；不影响错误记录的内容）
class MarkRepairedRequest(BaseModel):
    note: str = ""


@router.post("/{error_id}/mark-repaired")
def mark_flow_error_repaired(error_id: int, request: MarkRepairedRequest,
                             user_id: int = Depends(get_current_user)) -> dict:
    if get_error(error_id, user_id) is None:
        raise HTTPException(status_code=404, detail="错误记录不存在")
    mark_repaired(error_id, user_id, request.note or "已人工确认")
    return {"status": "repaired", "error_id": error_id}
