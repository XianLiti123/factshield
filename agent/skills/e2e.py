"""真实 LLM 端到端验证：确认 Agent 会自主调用 use_skill（需已配置模型）。

运行方式（conda 环境 suanfa_learning）：
    conda run -n suanfa_learning python -m agent.skills.e2e
"""

from __future__ import annotations

import time

from agent.agent import Agent


def main() -> None:
    agent = Agent()
    deadline = time.time() + 150
    got_skill = False
    event_types: list[str] = []
    try:
        for kind, text in agent.run_stream(
            "请使用 text-analyzer 技能，统计下面这段话的字符数："
            "FactShield 技能系统端到端测试"
        ):
            event_types.append(kind)
            if kind == "tool":
                print("[TOOL]", text)
                if "use_skill" in text:
                    got_skill = True
            elif kind == "token" and text.strip():
                print("[TOKEN]", text.strip()[:120].replace("\n", " "))
            elif kind == "error":
                print("[ERROR]", text)
            if time.time() > deadline:
                print("[TIMEOUT] 超过 150 秒未完成")
                break
    except Exception as exc:  # noqa: BLE001
        print("[EXC]", type(exc).__name__, str(exc)[:300])
    print("got_skill_call:", got_skill)
    print("event_types:", event_types)


if __name__ == "__main__":
    main()
