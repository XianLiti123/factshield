# -*- coding: utf-8 -*-
"""文本统计技能实现：从 stdin 读取 {"task": "<文本>"}，把统计结果打印到 stdout。"""

import json
import sys


def run(task: str) -> str:
    text = task.strip()
    if not text:
        return "输入为空，请提供需要统计的文本。"
    chars = len(text)
    lines = text.count("\n") + 1
    words = len(text.split())
    sentences = sum(text.count(p) for p in ("。", "！", "？", ".", "!", "?"))
    return f"字符数：{chars}；行数：{lines}；词数：{words}；句数：{max(1, sentences)}"


if __name__ == "__main__":
    data = json.load(sys.stdin)
    print(run(data.get("task", "")))
