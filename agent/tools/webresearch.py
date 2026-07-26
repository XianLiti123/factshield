from langchain_core.tools import tool
from langchain_tavily import TavilySearch,TavilyExtract
from ..config import TAVILY_API_KEY#导入即完成.env加载和key校验

#底层搜索服务，key由config.py写入环境变量后自动读取
_search = TavilySearch(max_results=5)
_extract = TavilyExtract()

@tool
def web_search(query: str) -> str:
    """当需要查询最新资讯、实时信息或不确定的事实时，联网搜索并返回相关结果"""
    try:
        result = _search.invoke({"query":query})
    except Exception as e:
        return f"搜索失败: {e}"

    #result可能是dict或JSON字符串，统一格式化为纯文本，并截断防止内容过长
    if isinstance(result,dict) and "results" in result:
        items = result["results"]
    else:
        return str(result)[:2000]

    lines = []
    for i,item in enumerate(items,1):
        title = item.get("title","")
        url = item.get("url","")
        content = str(item.get("content",""))[:300]#每条摘要限300字，防止上下文过长
        lines.append(f"[{i}] {title}\n链接: {url}\n摘要: {content}")
    return "\n\n".join(lines) or "没有找到相关结果"

@tool
def web_extract(url: str) -> str:
    """打开指定网址，提取网页正文内容。当搜索结果摘要不够详细、需要阅读网页全文时使用"""
    try:
        result = _extract.invoke({"urls":[url]})#TavilyExtract要求urls为列表
    except Exception as e:
        return f"网页读取失败: {e}"

    if isinstance(result,dict) and "results" in result:
        items = result["results"]
    else:
        return str(result)[:3000]

    if not items:
        return "网页内容提取失败"
    content = str(items[0].get("raw_content",""))[:3000]#正文限3000字，防止上下文过长
    return content or "网页内容为空"
