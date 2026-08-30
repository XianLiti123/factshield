"""系统提示词的模块化组装。

按「角色设定 → 规定约束 → 能力指南 → 画像指引 → 当前日期 → 用户称呼 → 画像」顺序
拼接各段样板文本，输出最终系统提示词。提示词文本统一存放在 agent/prompts.py
（唯一 Prompt 文件），本文件只负责动态组装，不直接存储提示词。
"""

from ..prompts import (
    SYSTEM_BASE_PROMPT,
    SYSTEM_DATE_LINE,
    SYSTEM_PROFILE_GUIDE,
    SYSTEM_ROLE_PROMPT,
    SYSTEM_RULES_PROMPT,
    SYSTEM_SKILLS_SECTION,
)
from ..skills.loader import skill_catalog


def build_system_prompt(profile_text: str | None = None, user_name: str | None = None) -> str:
    #组装系统提示词：角色设定 + 规定约束 + 能力指南 + 画像指引 + 当前日期 +（有用户名时）用户称呼 +（有画像时）画像段
    from datetime import datetime
    _weekdays = "一二三四五六日"
    now = datetime.now()
    date_line = SYSTEM_DATE_LINE.format(
        date=now.strftime("%Y-%m-%d"), weekday=_weekdays[now.weekday()])
    parts = [SYSTEM_ROLE_PROMPT, SYSTEM_RULES_PROMPT, SYSTEM_BASE_PROMPT,
             SYSTEM_PROFILE_GUIDE, date_line]
    skills_text = skill_catalog()
    if skills_text:
        parts.append(SYSTEM_SKILLS_SECTION.format(catalog=skills_text))
    if user_name:
        parts.append(f"当前用户的称呼：{user_name}。回复时以此称呼用户，语气自然，不要每句都带称呼。")
    if profile_text:
        parts.append(f"当前用户画像：\n{profile_text}")
    return "\n\n".join(parts)
