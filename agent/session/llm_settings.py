import logging

from .db import get_connection, init_db

logger = logging.getLogger(__name__)

init_db()  #确保 user_llm_settings 表存在


def get_use_response_api(user_id: int) -> bool:
    #当前用户是否启用 DeepSeek Responses API（/responses）模式；
    #关闭时走 OpenAI chat completions（即现在的默认链路），两种模式均可随时切换
    with get_connection() as conn:
        row = conn.execute(
            "SELECT use_response_api FROM user_llm_settings WHERE user_id=?", (user_id,)
        ).fetchone()
    return bool(row and row["use_response_api"])


def set_use_response_api(user_id: int, enabled: bool) -> bool:
    #保存当前用户的 LLM 调用模式并立即生效：切换后失效该用户的 LLM client 缓存，
    #下一轮对话/研究流程自动走新模式
    value = 1 if enabled else 0
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO user_llm_settings (user_id, use_response_api, updated_at)"
            " VALUES (?,?,datetime('now','localtime'))"
            " ON CONFLICT(user_id) DO UPDATE SET"
            " use_response_api=excluded.use_response_api, updated_at=excluded.updated_at",
            (user_id, value),
        )
    try:
        from ..core.loop import invalidate_llm_cache  #延迟导入，避免循环依赖
        invalidate_llm_cache(user_id)
    except ImportError:
        pass  #loop 模块尚在加载中（如迁移阶段），此时缓存必然为空，跳过即可
    return bool(value)
