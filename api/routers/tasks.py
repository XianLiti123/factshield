from fastapi import APIRouter
from pydantic import BaseModel

from ..schemas.research import ResearchRun
from ..utils.reserved import not_implemented

router = APIRouter(prefix="/tasks", tags=["tasks"])

#研究任务接口全部预留：需要 Agent 端先实现事实核查流水线（主张提取/证据检索/裁决的结构化输出）


class CreateTaskRequest(BaseModel):
    topic: str
    research_type: str | None = None
    preferred_sources: list[str] = []
    attachment_ids: list[str] = []


class GuidanceRequest(BaseModel):
    instruction: str
    attachment_ids: list[str] = []


class ResolveClaimRequest(BaseModel):
    action: str  #不采纳/保留注明/删除表述/改写
    comment: str | None = None


class SupervisorChatRequest(BaseModel):
    message: str
    attachment_ids: list[str] = []


@router.post("", response_model=ResearchRun)
def create_task(request: CreateTaskRequest) -> None:
    raise not_implemented("创建研究任务")


@router.get("")
def list_tasks() -> None:
    raise not_implemented("研究任务列表")


@router.get("/{task_id}", response_model=ResearchRun)
def get_task(task_id: str) -> None:
    raise not_implemented("研究任务详情")


@router.get("/{task_id}/events")
def task_events(task_id: str) -> None:
    raise not_implemented("研究过程播报流（SSE）")


@router.post("/{task_id}/stop")
def stop_task(task_id: str) -> None:
    raise not_implemented("终止研究任务")


@router.post("/{task_id}/guidance")
def guide_task(task_id: str, request: GuidanceRequest) -> None:
    raise not_implemented("研究员中途介入")


@router.post("/{task_id}/claims/{claim_id}/resolve")
def resolve_claim(task_id: str, claim_id: str, request: ResolveClaimRequest) -> None:
    raise not_implemented("人工裁决")


@router.post("/{task_id}/claims/{claim_id}/retry")
def retry_claim(task_id: str, claim_id: str) -> None:
    raise not_implemented("重新取证")


@router.get("/{task_id}/report")
def export_report(task_id: str, format: str = "pdf") -> None:
    raise not_implemented("研究底稿导出")


@router.get("/{task_id}/audit-log")
def audit_log(task_id: str) -> None:
    raise not_implemented("审计日志下载")


@router.post("/{task_id}/history-analysis")
def history_analysis(task_id: str) -> None:
    raise not_implemented("历史情景复盘")


@router.post("/{task_id}/chat")
def supervisor_chat(task_id: str, request: SupervisorChatRequest) -> None:
    raise not_implemented("Supervisor 对话（带任务上下文）")
