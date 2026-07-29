from typing import Literal

from pydantic import BaseModel

#与前端 ui/src/types.ts 一一对应的 DTO，字段名和枚举值保持一致，前端替换 mockApi 时零改动

ClaimStatus = Literal["verified", "review", "conflict"]
AgentStatus = Literal["done", "running", "waiting", "warning"]


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
    createdAt: str
    progress: float
    claims: list[Claim]
    evidence: list[Evidence]
    agents: list[AgentInfo]
