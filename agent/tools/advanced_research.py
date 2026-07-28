from langchain_core.tools import tool
from ..memory.reranker.rerank import precise_search


@tool
def advanced_research(query: str) -> str:
    """精确检索本地文档知识库：先用向量库语义检索出候选片段，再经 reranker 模型精排，
    返回与问题最相关的 3 个文档片段。当需要查阅之前转换或识别过的本地文档内容时使用。
    query 为要检索的问题。"""
    try:
        results = precise_search(query)
    except RuntimeError as e:
        return str(e)#未配置 embedding/reranker 等情况，把指引返回给 LLM
    if not results:
        return "知识库中没有找到相关内容"
    return "\n\n---\n\n".join(results)
