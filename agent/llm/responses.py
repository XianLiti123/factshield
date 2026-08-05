"""DeepSeek Responses API 服务端搜索支持。

- web_search：直接调用 Responses API 的 web_search 工具（服务端执行搜索），
  无需 Tavily key，依赖用户在设置页配置的 LLM。
- extract_web_search_calls / search_call_parts：解析响应输出块，把服务端搜索
  记录归一为「查询词 + 来源 URL 列表」，供搜索卡片渲染与结果提取使用。
"""

import json
import logging
import time

from .client import _emit_llm_call

logger = logging.getLogger(__name__)

#DeepSeek Responses API 服务端联网搜索工具；文档同时支持 web_search_2025_08_26 版本
WEB_SEARCH_TOOL_TYPE = "web_search"


def web_search(query: str, max_results: int = 5, user_id: int | None = None) -> list[dict]:
    #Response API 搜索选项：直接调 DeepSeek Responses API 的 web_search 工具（服务端执行），
    #无需 Tavily key。依赖用户在设置页配置的 LLM（base_url/api_key/model，建议 deepseek-v4-flash）。
    #返回 [{"title","url","content"}]；失败抛异常由调用方降级。
    from ..session.model_config import get_config  #延迟导入，避免循环依赖
    cfg = get_config(user_id, "llm") if user_id is not None else None
    if cfg is None:
        raise RuntimeError(
            "未配置 LLM 模型，无法使用 Response API 服务端搜索；"
            "请先在设置页配置模型（建议 deepseek-v4-flash）"
        )
    from openai import OpenAI
    #max_retries=0：SDK 隐藏重试会掩盖真实耗时与失败，重试语义统一交给上层节点级重试
    client = OpenAI(base_url=cfg["base_url"], api_key=cfg["api_key"], timeout=60, max_retries=0)
    payload = {
        "model": cfg["model_name"],
        "input": [{"role": "user", "content": query}],
        "tools": [{"type": WEB_SEARCH_TOOL_TYPE}],
        "tool_choice": {"type": WEB_SEARCH_TOOL_TYPE},
        "reasoning": {"effort": "none"},  #搜索只取结果，不消耗思考 token
        "max_output_tokens": 4000,
    }
    #严格按配置调用：端点拒绝 reasoning 等参数时直接抛错，不降级重试
    t0 = time.monotonic()
    base_info = {
        "model": cfg["model_name"], "base_url": cfg["base_url"],
        "use_response_api": True, "thinking": False, "reasoning": "none",
        "max_output_tokens": 4000, "timeout": 60,
        "prompt_chars": len(query), "tool_count": 1, "tool": "response_api_web_search",
    }
    logger.info("response_api web_search start query=%r model=%s", query, cfg["model_name"])
    try:
        response = client.responses.create(**payload)
        results = _extract_search_results(response)
    except Exception as e:  # noqa: BLE001
        logger.warning("response_api web_search FAIL query=%r 耗时%.2fs err=%s",
                       query, time.monotonic() - t0, e)
        _emit_llm_call({**base_info, "duration_ms": round((time.monotonic() - t0) * 1000),
                        "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0,
                        "status": "error", "error": str(e)[:500]})
        raise
    logger.info("response_api web_search done query=%r n=%d 耗时%.2fs",
                query, len(results), time.monotonic() - t0)
    _emit_llm_call({**base_info, "duration_ms": round((time.monotonic() - t0) * 1000),
                    "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0,
                    "status": "ok", "error": "", "result_count": len(results)})
    if not results:
        logger.warning("Response API 服务端搜索未返回任何 open_page 结果：query=%r", query)
        raise RuntimeError(
            "Response API 服务端搜索未返回结果：请确认当前模型支持 web_search 工具"
            "（Responses API 目前仅 deepseek-v4-flash 支持）"
        )
    return results[:max_results]


def _extract_search_results(response) -> list[dict]:
    #从 responses 响应中提取搜索结果：DeepSeek 的 web_search_call 项不直接返回结果数组，
    #而是通过 action 描述服务端动作——search（查询词）/ open_page（服务端已打开的搜索结果页）。
    #这里取全部 open_page 的 URL 作为结果（标题留空，正文由 extract() 本地抓取填充），按 url 去重
    data = response.model_dump(exclude_none=True, mode="json") if hasattr(response, "model_dump") else response
    seen: set[str] = set()
    results: list[dict] = []
    for record in extract_web_search_calls(data.get("output") or []):
        for url in record["urls"]:
            if url in seen:
                continue
            seen.add(url)
            results.append({"title": "", "url": url, "content": ""})
    return results


def extract_web_search_calls(content: object) -> list[dict]:
    """从 Responses API 输出块中提取服务端搜索记录（搜索卡片数据）。

    输入可以是 AIMessage.content（输出块列表）或原始响应的 output 列表；
    返回 [{"query": str, "urls": [str], "status": str}]。

    DeepSeek 的 web_search_call 项不直接返回结果数组，而是通过 action 描述服务端动作：
    search（查询词）与 open_page（服务端已打开的搜索结果页）。这里按 search 开组、
    open_page 并入最近一组，方便渲染成"一次搜索 -> 若干来源"的搜索卡片。
    """
    blocks = content if isinstance(content, (list, tuple)) else []
    if logger.isEnabledFor(logging.DEBUG):
        raw = [b for b in blocks if isinstance(b, dict) and b.get("type") == "web_search_call"]
        if raw:
            #诊断用：核对 DeepSeek 实际返回的 search/open_page 动作结构（0 来源排查）
            logger.debug("web_search_call 原始块: %s", json.dumps(raw, ensure_ascii=False)[:4000])
    records: list[dict] = []
    current: dict | None = None
    for block in blocks:
        if not isinstance(block, dict) or block.get("type") != "web_search_call":
            continue
        action = block.get("action") or {}
        action_type = str(action.get("type") or block.get("action_type") or "")
        query, url = search_call_parts(block)
        status = str(block.get("status") or "completed")
        if action_type == "search" or query:
            current = {"query": query, "urls": [url] if url else [], "status": status}
            records.append(current)
        elif url:
            if current is not None:
                current["urls"].append(url)
            else:
                records.append({"query": "", "urls": [url], "status": status})
    for record in records:
        seen: set[str] = set()
        record["urls"] = [u for u in record["urls"] if not (u in seen or seen.add(u))]
    if records and not any(r["urls"] for r in records):
        #整个响应确实没有任何来源时才打 WARN（单条 search 无来源但同响应有 open_page 属正常分组）
        raw = [b for b in blocks if isinstance(b, dict) and b.get("type") == "web_search_call"]
        logger.warning(
            "服务端搜索整响应无来源（queries=%r）。原始块: %s",
            [r.get("query") for r in records],
            json.dumps(raw, ensure_ascii=False)[:4000],
        )
    return records


def search_call_parts(block: dict) -> tuple[str, str]:
    """返回单个 web_search_call 输出块的 (查询词, 打开URL)。

    DeepSeek 的 search 动作把查询词放在 action.queries 列表（末尾混入
    "ws_call_id=..." 伪条目，需剔除）；open_page 动作的 URL 带 "#ws_call_id=..." 后缀，
    一并去掉。
    """
    action = block.get("action") or {}
    query = str(action.get("query") or block.get("search_query") or block.get("query") or "").strip()
    if not query:
        queries = action.get("queries")
        if isinstance(queries, str):
            queries = [queries]
        for item in queries or []:
            item = str(item).strip()
            if item and not item.startswith("ws_call_id="):
                query = item
                break
    url = str(action.get("url") or block.get("url") or "").split("#")[0]  #去掉 ws_call_id 等后缀参数
    return query, url
