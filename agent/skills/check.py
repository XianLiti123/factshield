"""技能系统自检脚本。

运行方式（conda 环境 suanfa_learning）：
    conda run -n suanfa_learning python -m agent.skills.check
"""

from __future__ import annotations

from .loader import list_skills, reload_skills
from .runner import execute_skill


def main() -> None:
    print("扫描技能目录...")
    skills = reload_skills()
    print(f"发现 {len(skills)} 个技能")
    for skill in skills.values():
        print(f"  - {skill.name}（{skill.kind}）：{skill.description}")
    assert skills, "未发现任何技能，请检查 agent/skills/ 目录"

    executable = next((s for s in skills.values() if s.kind == "executable"), None)
    if executable:
        output = execute_skill(executable, "你好世界，FactShield 技能系统 2026")
        print(f"[可执行型示例] {executable.name} -> {output}")

    instruction = next((s for s in skills.values() if s.kind == "instruction"), None)
    if instruction:
        output = execute_skill(instruction, "测试任务")
        print(f"[指令型示例] {instruction.name} -> 返回说明 {len(output)} 字符")

    print("自检通过")


if __name__ == "__main__":
    main()
