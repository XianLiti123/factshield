import json


def sse_event(event_type: str, content: str = "") -> str:
    #把 (事件类型, 文本) 格式化为一条 SSE 消息，事件体为 JSON
    return f"data: {json.dumps({'type': event_type, 'content': content}, ensure_ascii=False)}\n\n"
