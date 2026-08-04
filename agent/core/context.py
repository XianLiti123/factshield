"""上下文管理与压缩模块。

- 维护模型上下文窗口与压缩触发/目标阈值（支持环境变量 FS_CONTEXT_WINDOW 覆盖）。
- 提供 token 估算（兜底方案，保守不溢出）与压缩判定。
- 调用 LLM 把对话历史压缩为摘要，压缩使用用户自己的模型配置、关闭思考模式。
"""

import os

from langchain_core.messages import BaseMessage, HumanMessage

from ..llm.client import ChatClient
from ..llm.text import content_to_text

#上下文窗口与压缩阈值，可用环境变量覆盖
CONTEXT_WINDOW_TOKENS = int(os.getenv("FS_CONTEXT_WINDOW", "65536"))  #模型总上下文窗口
COMPACT_TRIGGER_RATIO = 0.8  #默认触发比例（窗口的 80%）；用户可经设置页按用户覆盖
COMPACT_TARGET_RATIO = 0.05  #压缩目标：总窗口的 5%（约为原上下文的 1/10 量级）

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


def needs_compaction(input_tokens: int, trigger_percent: int = 80) -> bool:
    #根据最近一次 LLM 调用的真实输入 token 数判断是否达到压缩阈值；
    #trigger_percent 为占窗口的百分比（用户可自定义，缺省 80）
    return input_tokens >= CONTEXT_WINDOW_TOKENS * (trigger_percent / 100)


def _format_history(messages: list[BaseMessage]) -> str:
    #把消息列表格式化成纯文本，供压缩 prompt 使用
    lines = []
    for msg in messages:
        role = getattr(msg, "type", "unknown")
        lines.append(f"[{role}] {content_to_text(msg.content)}")
    return "\n".join(lines)


def compact_messages(messages: list[BaseMessage], user_id: int) -> str:
    #调用一次 LLM 把整段对话历史压缩成摘要文本（思考模式关闭，省开销），用该用户自己的模型配置
    from ..session.model_config import get_config  #延迟导入，避免循环依赖
    from ..session.llm_settings import get_use_response_api  #压缩与主对话同协议（chat / responses）
    cfg = get_config(user_id, "llm")
    if cfg is None:
        raise RuntimeError("未配置 LLM 模型，请先在设置中配置 base_url、api_key 和模型名")
    target_chars = int(CONTEXT_WINDOW_TOKENS * COMPACT_TARGET_RATIO)
    prompt = _SUMMARY_PROMPT.format(target_chars=target_chars, history=_format_history(messages))
    summarizer = ChatClient(model=cfg["model_name"], base_url=cfg["base_url"], api_key=cfg["api_key"],
                            thinking=False, use_response_api=get_use_response_api(user_id))
    return summarizer.chat([HumanMessage(content=prompt)])
