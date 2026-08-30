import json


def sse_event(event_type: str, content: str = "") -> str:
    #把 (事件类型, 文本) 格式化为一条 SSE 消息，事件体为 JSON
    return f"data: {json.dumps({'type': event_type, 'content': content}, ensure_ascii=False)}\n\n"


def sse_event_payload(event_type: str, content: str = "", payload: dict | None = None) -> str:
    #带结构化 payload 的 SSE 消息（提问/回答等新事件类型；payload 字段对旧前端无影响）
    obj: dict = {"type": event_type, "content": content}
    if payload:
        obj["payload"] = payload
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"
