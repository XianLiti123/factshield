---
name: text-analyzer
description: 对一段文本做基础统计（字符数、行数、词数、句数），适合快速检查稿件长度或摘要规模。
version: 1.0.0
---

# 文本统计分析技能

可执行型技能：通过 run.py 计算输入文本的基础统计量。

## 使用方式

调用 use_skill 工具，skill_name 填 `text-analyzer`，task 填待统计的文本内容。

## run.py 约定

run.py 从 stdin 读取 JSON：`{"task": "<文本>"}`，把统计结果以字符串打印到 stdout。
