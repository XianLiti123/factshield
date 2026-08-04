"""技能执行器：可执行型技能以子进程隔离运行 run.py，纯指令型技能直接返回 SKILL.md 说明。"""

from __future__ import annotations

import json
import logging
import subprocess
import sys

from .loader import Skill

logger = logging.getLogger(__name__)


def execute_skill(skill: Skill, task: str) -> str:
    """执行技能：run.py 存在时运行它，否则返回 SKILL.md 操作说明让 Agent 按步骤继续。"""
    run_py = skill.path / "run.py"
    if not run_py.is_file():
        return skill.instructions

    payload = json.dumps({"task": task or ""}, ensure_ascii=False)
    try:
        result = subprocess.run(
            [sys.executable, str(run_py)],
            cwd=str(skill.path),
            input=payload,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=skill.timeout,
        )
    except subprocess.TimeoutExpired:
        return f"技能 {skill.name} 执行超时（{skill.timeout} 秒），请简化任务或检查 run.py 是否有死循环。"
    except OSError as e:
        return f"技能 {skill.name} 无法启动：{e}"

    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()[-500:]
        logger.warning("技能 %s 执行失败: %s", skill.name, detail)
        return f"技能 {skill.name} 执行失败（exit={result.returncode}）：{detail or '无错误信息'}"

    output = result.stdout.strip()
    return output or f"技能 {skill.name} 执行完成，无输出。"
