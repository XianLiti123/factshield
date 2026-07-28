from langchain_core.tools import tool
from ..memory.reranker.rerank import precise_search


@tool
def advanced_research(query: str, num: int = 3) -> str:
    """精确检索本地文档知识库：先用向量库语义检索出候选片段，再经 reranker 模型精排，
    返回与问题最相关的 num 个文档片段。当需要查阅之前转换或识别过的本地文档内容时使用。
    query 为要检索的问题；num 为最多返回的片段数，默认 3，最大 20。"""
    num = max(1,min(num,20))#钳制到 [1,20]
    try:
        results = precise_search(query,num=num)
    except Exception as e:
        return f"精确检索失败: {e}"#未配置、接口报错等情况，把原因返回给 LLM，不中断对话
    if not results:
        return "知识库中没有找到相关内容"
    return "\n\n---\n\n".join(results)
