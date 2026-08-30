"""技能系统 + Agent 图 + API 路由的冒烟脚本。

运行方式（conda 环境 suanfa_learning）：
    conda run -n suanfa_learning python -m agent.skills.smoke
"""

from __future__ import annotations


def main() -> None:
    from agent.core.loop import graph, subagent_graph
    from agent.core.prompt import build_system_prompt
    from agent.tools.skill import use_skill
    from api.main import app

    print("graph:", type(graph).__name__)
    print("subagent_graph:", type(subagent_graph).__name__)
    print("use_skill:", use_skill.name, "| args:", list(use_skill.args.keys()))

    executable = use_skill.invoke(
        {"skill_name": "text-analyzer", "task": "FactShield skill test 2026"}
    )
    print("executable result:", executable)

    instruction = use_skill.invoke({"skill_name": "evidence-review", "task": "核验示例"})
    print("instruction result head:", instruction[:40].replace("\n", " "))

    unknown = use_skill.invoke({"skill_name": "nope", "task": "x"})
    print("unknown skill:", unknown[:50])

    prompt = build_system_prompt()
    print(
        "prompt has skill section:",
        "可用技能" in prompt,
        "| text-analyzer listed:",
        "text-analyzer" in prompt,
    )

    root_paths = [r.path for r in app.routes]
    alias = next(m for m in app.routes if getattr(m, "path", None) == "/api")
    alias_paths = [r.path for r in alias.routes]
    print(
        "/api/skills in alias:",
        "/skills" in alias_paths,
        "| /skills on root:",
        "/skills" in root_paths,
    )
    print("SMOKE OK")


if __name__ == "__main__":
    main()
