# 技能系统

Agent 会自主扫描 `agent/skills/` 下的技能目录并决定何时调用，用户无需手动触发。

## 新建一个技能

```text
agent/skills/<skill_id>/
  SKILL.md   # 必填：frontmatter（name/description/version）+ 操作说明
  run.py     # 可选：可执行型技能实现
  assets/    # 可选：技能附带资源
```

`SKILL.md` 示例：

```markdown
---
name: my-skill
description: 一句话说明技能用途（Agent 靠它判断何时调用）
version: 1.0.0
timeout: 60
---

# 技能说明

详细的操作步骤……
```

## 两种技能形态

- **纯指令型**：只有 `SKILL.md`。`use_skill` 会返回操作说明，Agent 按步骤使用已有工具完成。
- **可执行型**：带 `run.py`。`run.py` 从 stdin 读取 `{"task": "<任务>"}`，把结果以字符串打印到 stdout；执行器用子进程隔离运行并带超时。

## 自检

```bash
conda run -n suanfa_learning python -m agent.skills.check
```
