import os

from langchain_core.messages import BaseMessage, HumanMessage

from ..llm.client import ChatClient

#上下文窗口与压缩阈值，可用环境变量覆盖
CONTEXT_WINDOW_TOKENS = int(os.getenv("FS_CONTEXT_WINDOW", "65536"))#模型总上下文窗口
COMPACT_TRIGGER_RATIO = 0.8#上下文达到窗口的 80% 时触发压缩
COMPACT_TARGET_RATIO = 0.05#压缩目标：总窗口的 5%（约为原上下文的 1/10 量级）

_SUMMARY_PROMPT = """请将以下对话历史压缩成一段摘要，控制在 {target_chars} 字以内。
保留：用户的真实需求与结论、关键事实与数据、未完成的任务与约定、影响后续对话的重要上下文。
丢弃：寒暄、客套、中间过程性的表述。
对话历史：
{history}"""


def estimate_tokens(messages: list[BaseMessage]) -> int:
    #兜底估算：按字符数≈token 数保守估计（中文偏准，英文偏高，宁保守不溢出）
    total = 0
    for msg in messages:
        if isinstance(msg.content, str):
            total += len(msg.content)
        for tc in getattr(msg, "tool_calls", None) or []:
            total += len(str(tc.get("args", "")))
    return total


def needs_compaction(input_tokens: int) -> bool:
    #根据最近一次 LLM 调用的真实输入 token 数判断是否达到压缩阈值
    return input_tokens >= CONTEXT_WINDOW_TOKENS * COMPACT_TRIGGER_RATIO


def _format_history(messages: list[BaseMessage]) -> str:
    #把消息列表格式化成纯文本，供压缩 prompt 使用
    lines = []
    for msg in messages:
        role = getattr(msg, "type", "unknown")
        content = msg.content if isinstance(msg.content, str) else str(msg.content)
        lines.append(f"[{role}] {content}")
    return "\n".join(lines)


def compact_messages(messages: list[BaseMessage]) -> str:
    #调用一次 LLM 把整段对话历史压缩成摘要文本（思考模式关闭，省开销）
    target_chars = int(CONTEXT_WINDOW_TOKENS * COMPACT_TARGET_RATIO)
    prompt = _SUMMARY_PROMPT.format(target_chars=target_chars, history=_format_history(messages))
    summarizer = ChatClient(thinking=False)
    return summarizer.chat([HumanMessage(content=prompt)])
