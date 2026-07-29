from typing import Any, Literal

from pydantic import BaseModel

#与前端 ui/src/types.ts 一一对应的 DTO，字段名和枚举值保持一致，前端替换 mockApi 时零改动

ClaimStatus = Literal["verified", "review", "conflict"]
AgentStatus = Literal["done", "running", "waiting", "warning"]
TaskStatus = Literal["running", "review", "ready", "stopped", "failed"]


class Evidence(BaseModel):
    id: str
    title: str
    publisher: str
    publishedAt: str
    locator: str
    quote: str
    sourceType: str
    relation: Literal["support", "challenge"]
    credibility: float


class Claim(BaseModel):
    id: str
    index: int
    statement: str
    status: ClaimStatus
    confidence: float
    category: str
    supervisorVerdict: str
    reviewerVerdict: str
    conflictReason: str | None = None
    issueType: str | None = None
    humanAction: str | None = None  #人工裁决动作（reject/keep/remove/rewrite）
    humanNote: str | None = None
    evidenceIds: list[str]


class AgentInfo(BaseModel):
    id: str
    name: str
    role: str
    status: AgentStatus
    detail: str
    duration: str | None = None
    restriction: str | None = None


class ResearchRun(BaseModel):
    id: str
    title: str
    company: str
    status: TaskStatus
    createdAt: str
    progress: float
    claims: list[Claim]
    evidence: list[Evidence]
    agents: list[AgentInfo]


class TaskSummary(BaseModel):
    #任务列表/创建返回的概要（不含主张与证据明细）
    id: str
    title: str
    company: str
    status: TaskStatus
    researchType: str
    progress: float
    createdAt: str
    updatedAt: str
    claimCount: int = 0


class TaskEvent(BaseModel):
    #研究过程播报事件（SSE 与审计日志共用）
    seq: int
    ts: str
    actor: str
    kind: str
    payload: dict[str, Any]
