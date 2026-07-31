from typing import Annotated

from langchain_core.tools import tool
from langgraph.prebuilt import InjectedState

from ..searchengine import extract, search
from ..session.search_config import get_engine

#联网检索工具：按当前用户在设置中选择的搜索引擎路由（tavily / python 必应中国爬虫）
#选 tavily 但未配置 TAVILY_API_KEY 时返回明确错误，不静默降级


@tool
def web_search(query: str, user_id: Annotated[int, InjectedState("user_id")] = None) -> str:
    """当需要查询最新资讯、实时信息或不确定的事实时，联网搜索并返回相关结果"""
    engine = get_engine(user_id)
    try:
        items = search(query, engine, max_results=5, user_id=user_id)
    except Exception as e:
        return f"搜索失败（引擎：{engine}）: {e}"

    lines = []
    for i, item in enumerate(items, 1):
        content = str(item.get("content", ""))[:300]  #每条摘要限300字，防止上下文过长
        lines.append(f"[{i}] {item.get('title', '')}\n链接: {item.get('url', '')}\n摘要: {content}")
    return "\n\n".join(lines) or "没有找到相关结果"


@tool
def web_extract(url: str, user_id: Annotated[int, InjectedState("user_id")] = None) -> str:
    """打开指定网址，提取网页正文内容。当搜索结果摘要不够详细、需要阅读网页全文时使用"""
    engine = get_engine(user_id)
    try:
        content = extract(url, engine, user_id=user_id)
    except Exception as e:
        return f"网页读取失败（引擎：{engine}）: {e}"
    return content[:3000] or "网页内容为空"  #正文限3000字，防止上下文过长
