"""搜索引擎统一入口。

支持三种引擎：
- tavily       - API 服务，需 TAVILY_API_KEY（用户 key 或服务端 .env key）。
- python       - 必应中国版网页爬虫，无需 key。
- response_api - DeepSeek Responses API 服务端 web_search（无需搜索 key）。

search 按用户选择的引擎路由；extract 优先使用 Tavily 正文提取（配置了 key 时），
失败或未配置 key 时自动降级为本地 Python 爬虫。
"""

import logging
import time

import requests

from . import config

logger = logging.getLogger(__name__)
se_logger = logging.getLogger("research.searchengine")

ENGINES = ("tavily", "python", "response_api")

_HEADERS = {
    #模拟常见桌面浏览器，降低必应拒绝概率
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept-Language": "zh-CN,zh;q=0.9",
}

_tavily_clients: dict[str, tuple] = {}


def _get_tavily(api_key: str):
    #Tavily 客户端按 key 惰性装配并缓存：key 为空时明确报错（用户选择了 tavily 就必须有 key）
    global _tavily_clients
    if not api_key:
        raise RuntimeError("当前搜索引擎为 Tavily，但未配置 Tavily API Key；"
                           "请在设置中填写 API Key，或改用 Python 搜索引擎")
    if api_key not in _tavily_clients:
        from langchain_tavily import TavilyExtract, TavilySearch
        _tavily_clients[api_key] = (
            TavilySearch(max_results=5, api_key=api_key),
            TavilyExtract(api_key=api_key),
        )
    return _tavily_clients[api_key]


def _resolve_api_key(user_id: int | None) -> str:
    #搜索引擎 key 解析：用户级 Tavily key 优先，缺省回退 .env（search_config 内部已回退）
    if user_id is None:
        return config.TAVILY_API_KEY or ""
    from .session.search_config import get_search_config  #延迟导入，避免循环依赖
    return get_search_config(user_id)["api_key"] or ""


def _bing_search(query: str, max_results: int) -> list[dict]:
    #必应中国版网页搜索爬虫：解析 li.b_algo 结果块（页面结构变更可能失效，仅作免 key 方案）
    from bs4 import BeautifulSoup
    resp = requests.get("https://cn.bing.com/search", params={"q": query},
                        headers=_HEADERS, timeout=10)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    items = []
    for li in soup.select("li.b_algo"):
        a = li.select_one("h2 a")
        if a is None or not a.get("href"):
            continue
        snippet_tag = li.select_one(".b_caption p") or li.select_one("p")
        items.append({
            "title": a.get_text(strip=True),
            "url": a["href"],
            "content": snippet_tag.get_text(strip=True) if snippet_tag else "",
        })
        if len(items) >= max_results:
            break
    if not items:
        raise RuntimeError("必应中国版未返回可解析的搜索结果（页面结构可能已变更）")
    return items


def _response_api_search(query: str, max_results: int, user_id: int | None) -> list[dict]:
    #Response API 服务端搜索：不消耗本地搜索 key，服务端执行 web_search 并返回结构化结果
    from .llm.responses import web_search as responses_web_search  #延迟导入，避免循环依赖
    return responses_web_search(query, max_results=max_results, user_id=user_id)


def _html_text(html: str) -> str:
    #网页 HTML 转纯文本：去脚本/样式后按标签取文本
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    return soup.get_text(separator="\n", strip=True)


def search(query: str, engine: str, max_results: int = 5, user_id: int | None = None) -> list[dict]:
    #统一搜索入口，返回 [{"title","url","content"}]；失败抛异常由调用方处理
    t0 = time.monotonic()
    se_logger.info("search start engine=%s query=%r max_results=%d user=%s",
                   engine, query, max_results, user_id)
    try:
        if engine == "tavily":
            tavily, _ = _get_tavily(_resolve_api_key(user_id))
            result = tavily.invoke({"query": query})
            items = result.get("results", []) if isinstance(result, dict) else []
            out = [{"title": i.get("title", ""), "url": i.get("url", ""),
                    "content": str(i.get("content", ""))} for i in items[:max_results]]
        elif engine == "python":
            out = _bing_search(query, max_results)
        elif engine == "response_api":
            out = _response_api_search(query, max_results, user_id)
        else:
            raise ValueError(f"无效的搜索引擎: {engine}，可选: {', '.join(ENGINES)}")
    except Exception as e:  # noqa: BLE001 失败同样留痕
        se_logger.warning("search FAIL engine=%s query=%r 耗时%.2fs err=%s",
                          engine, query, time.monotonic() - t0, e)
        raise
    se_logger.info("search done engine=%s query=%r n=%d 耗时%.2fs",
                   engine, query, len(out), time.monotonic() - t0)
    return out


def extract(url: str, engine: str, user_id: int | None = None) -> str:
    """统一网页正文提取入口。

    优先级：配置了 Tavily API key 时先走 TavilyExtract，失败/返回空则降级
    本地 Python 爬虫（python/response_api 引擎也走本地爬虫）；未配置 key 时
    直接本地爬虫。失败抛异常由调用方处理（调用方一般退化为搜索摘要）。
    """
    t0 = time.monotonic()
    se_logger.info("extract start url=%s engine=%s", url, engine)
    api_key = _resolve_api_key(user_id)
    if api_key:
        try:
            _, tavily_ext = _get_tavily(api_key)
            result = tavily_ext.invoke({"urls": [url]})
            pages = result.get("results", []) if isinstance(result, dict) else []
            content = str(pages[0].get("raw_content", "")) if pages else ""
            if content.strip():
                se_logger.info("extract done via=tavily url=%s chars=%d 耗时%.2fs",
                               url, len(content), time.monotonic() - t0)
                return content
            logger.warning("Tavily 正文提取返回空内容，降级本地抓取: %s", url)
        except Exception as e:  # noqa: BLE001
            logger.warning("Tavily 正文提取失败，降级本地抓取: %s", e)
    try:
        resp = requests.get(url, headers=_HEADERS, timeout=15)
        resp.raise_for_status()
        if "charset" not in resp.headers.get("Content-Type", "").lower():
            resp.encoding = resp.apparent_encoding  #响应头未声明编码时按内容探测，避免中文乱码
        text = _html_text(resp.text)
    except Exception as e:  # noqa: BLE001
        se_logger.warning("extract FAIL url=%s via=local 耗时%.2fs err=%s",
                          url, time.monotonic() - t0, e)
        raise
    se_logger.info("extract done via=local url=%s chars=%d 耗时%.2fs",
                   url, len(text), time.monotonic() - t0)
    return text
