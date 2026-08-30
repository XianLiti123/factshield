from langchain_core.tools import tool

from ..session.store import precise_search_turns


@tool
def recall_conversation(query: str, k: int = 3) -> str:
    """回忆历史对话：先用向量库语义检索出候选历史轮次，再经 reranker 模型精排，
    返回与问题最相关的 k 段历史对话（含用户提问和助手回复）。当需要回忆之前聊过的内容、
    用户提过的偏好或历史结论时使用。query 为要回忆的内容；k 为最多返回的段数，默认 3，最大 20。"""
    k = max(1, min(k, 20))#钳制到 [1,20]
    try:
        results = precise_search_turns(query, k=k)
    except Exception as e:
        return f"回忆历史对话失败: {e}"#未配置、接口报错等情况，把原因返回给 LLM，不中断对话
    if not results:
        return "历史对话中没有找到相关内容"
    return "\n\n---\n\n".join(results)
