from fastapi import APIRouter, Depends
from pydantic import BaseModel

from agent.skills.loader import list_skills

from ..core.security import get_current_user

router = APIRouter(tags=["skills"])


class SkillInfo(BaseModel):
    id: str
    name: str
    description: str
    version: str
    kind: str  # instruction=纯指令型；executable=可执行型（带 run.py）


@router.get("/skills")
def list_skill_infos(user_id: int = Depends(get_current_user)) -> list[SkillInfo]:
    """只读列出当前可用的技能（不含技能正文，仅供前端展示/调试）。"""
    return [
        SkillInfo(
            id=skill.id,
            name=skill.name,
            description=skill.description,
            version=skill.version,
            kind=skill.kind,
        )
        for skill in list_skills()
    ]
