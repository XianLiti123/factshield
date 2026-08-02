import logging

from openai import BadRequestError, UnprocessableEntityError

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
    client = OpenAI(base_url=cfg["base_url"], api_key=cfg["api_key"], timeout=60, max_retries=1)
    payload = {
        "model": cfg["model_name"],
        "input": [{"role": "user", "content": query}],
        "tools": [{"type": WEB_SEARCH_TOOL_TYPE}],
        "tool_choice": {"type": WEB_SEARCH_TOOL_TYPE},
        "reasoning": {"effort": "none"},  #搜索只取结果，不消耗思考 token
        "max_output_tokens": 4000,
    }
    for attempt in range(2):
        try:
            response = client.responses.create(**payload)
            break
        except (BadRequestError, UnprocessableEntityError) as e:
            if attempt == 0 and payload.get("reasoning"):
                logger.warning("Response API 搜索拒绝 reasoning 参数，降级重试: %s", e)
                payload = dict(payload)
                payload.pop("reasoning", None)
                continue
            raise
    results = _extract_search_results(response)
    if not results:
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
    results: list[dict] = []
    for item in data.get("output") or []:
        if item.get("type") != "web_search_call":
            continue
        if item.get("status") != "completed":
            continue
        action = item.get("action") or {}
        if action.get("type") != "open_page":
            continue
        url = str(action.get("url") or "").split("#")[0]  #去掉 ws_call_id 等后缀参数
        if url:
            results.append({"title": "", "url": url, "content": ""})
    seen: set[str] = set()
    deduped: list[dict] = []
    for r in results:
        if r["url"] in seen:
            continue
        seen.add(r["url"])
        deduped.append(r)
    return deduped
