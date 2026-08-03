import logging
import time
from typing import Annotated

from langchain_core.tools import tool
from langchain_core.messages import SystemMessage
from langgraph.prebuilt import InjectedState
from ..failures import (format_traceback, mark_repair_failed, mark_repaired,
                        mark_repairing, record_error)
from ..llm.text import content_to_text
from .toolslist import toolsets

logger = logging.getLogger(__name__)

#子代理最大执行次数（1 次首次 + 重试 + 自动修复重启），退避间隔逐次翻倍
SUBAGENT_MAX_ATTEMPTS = 3
SUBAGENT_RETRY_DELAYS = (1.0, 2.0)


@tool
def subagent(prompt:str,user_id:Annotated[int,InjectedState("user_id")]=None,
             session_id:Annotated[str|None,InjectedState("session_id")]=None)->str:
    """调用一个子代理来完成一项独立的工作。子代理拥有终端、联网、文档处理、知识库检索等全部能力（但不能继续调用子代理），
    与当前对话完全隔离，看不到对话历史。适合把可以独立完成的子任务交出去，避免主干对话被中间过程污染。
    prompt 为子代理的提示词，由你完整编写（角色、背景、目标、期望的输出等都写清楚，子代理只看得到这一段话）。
    返回子代理的执行结果。"""
    from ..core.loop import subagent_graph#延迟导入，避免循环依赖
    #子代理的提示词完全由主代理通过参数提供
    state = {
        "messages": [SystemMessage(content=prompt)],
        "active_toolsets": list(toolsets),  #子代理直接使用全部工具集，省去逐组激活
        "user_id": user_id,                 #子代理与主代理同属一个用户，LLM/画像等按同一用户装配
        "session_id": session_id,           #归属会话透传，供错误登记/修复定位
    }
    error_id: int | None = None
    last: Exception | None = None
    #重试 + 自动修复：同一子代理失败即用原提示词重启（重试次数含首次与修复重启），
    #全部失败时登记错误并抛出，主代理可在错误登记接口中手动再次触发修复
    for attempt in range(SUBAGENT_MAX_ATTEMPTS):
        if error_id is not None:
            mark_repairing(error_id, user_id)
        try:
            result = subagent_graph.invoke(state)#type:ignore
            if error_id is not None:
                mark_repaired(error_id, user_id, f"子代理第 {attempt + 1} 次重启后执行成功")
                logger.info("子代理失败后自动修复成功 (error_id=%s)", error_id)
            return content_to_text(result["messages"][-1].content)
        except Exception as e:  # noqa: BLE001
            last = e
            logger.warning("子代理执行失败（第 %d/%d 次）: %s", attempt + 1, SUBAGENT_MAX_ATTEMPTS, e)
            if error_id is None:
                error_id = record_error(
                    user_id, "subagent", session_id or f"subagent:{user_id}",
                    error=str(e), node="subagent", prompt=prompt,
                    traceback=format_traceback(), attempts=SUBAGENT_MAX_ATTEMPTS,
                    auto_repair=True,
                )
            if attempt < SUBAGENT_MAX_ATTEMPTS - 1:
                time.sleep(SUBAGENT_RETRY_DELAYS[min(attempt, len(SUBAGENT_RETRY_DELAYS) - 1)])
    if error_id is not None:
        mark_repair_failed(error_id, user_id, f"子代理自动修复失败: {last}")
    raise RuntimeError(f"子代理执行失败（已自动重试 {SUBAGENT_MAX_ATTEMPTS} 次）: {last}") from last
