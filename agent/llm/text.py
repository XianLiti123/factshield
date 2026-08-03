"""LangChain 消息 content 归一化工具。"""

from __future__ import annotations


def content_to_text(content: object) -> str:
    """把 LangChain 消息 content 归一为纯文本。

    - chat completions：content 是 str，原样返回；
    - Responses API：content 是输出块列表（text / reasoning / web_search_call /
      function_call 等），这里只取文本块（text / output_text / refusal），
      保证下游 str() 不会得到 repr(list)。

    背景：langchain-openai 的 _construct_lc_result_from_responses_api 把 Responses
    API 的 content 组装成 dict 列表，例如 [{'type': 'text', 'text': '{"plan": ...}'}]，
    直接 str() 后按花括号截取会取到 {'type': 'text', ...} 而解析失败。
    """
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, (list, tuple)):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                btype = block.get("type")
                if btype in ("text", "output_text"):
                    text = block.get("text")
                    if text:
                        parts.append(str(text))
                elif btype == "refusal":
                    refusal = block.get("refusal")
                    if refusal:
                        parts.append(str(refusal))
        return "\n".join(part for part in parts if part)
    return str(content)
