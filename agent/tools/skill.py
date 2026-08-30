"""技能调用工具：Agent 自主判断并调用技能，用户无需手动触发。"""

from langchain_core.tools import tool

from ..skills.loader import get_skill, list_skills
from ..skills.runner import execute_skill


@tool
def use_skill(skill_name: str, task: str) -> str:
    """自主调用技能完成指定任务。skill_name 为系统提示词“可用技能”清单中的技能名称，task 为要完成的具体任务描述。
    纯指令型技能会返回操作说明，请严格按说明继续执行；可执行型技能直接返回执行结果。
    当任务匹配某个技能的能力范围时，应当主动调用它，而不是跳过或让用户手动触发。"""
    skill = get_skill(skill_name)
    if skill is None:
        names = "、".join(s.name for s in list_skills()) or "（暂无可用技能）"
        return f"未知技能：{skill_name}。可用技能：{names}"
    return execute_skill(skill, task)
