from typing import Annotated

from langchain_core.tools import tool
from langgraph.prebuilt import InjectedState

from ..session import store as session_store


def _format_profile(user_id: int) -> str:
    #把当前画像格式化成带条目编号的文本，供工具返回（编号用于 update/delete 引用）
    facts = session_store.list_facts(user_id)
    if not facts:
        return "（画像为空）"
    return "\n".join(f"[{row['id']}] {row['content']}" for row in facts)


@tool
def update_user_profile(action: str, content: str = "", fact_id: int | None = None,
                        user_id: Annotated[int, InjectedState("user_id")] = None) -> str:
    """更新用户画像（关于用户的长期记忆）。当用户透露关于自身的稳定信息（称呼、偏好、背景、习惯等）时使用；
    一次性的临时信息不要保存。回复用户时应参考画像做个性化回应。
    action 为操作类型：
    - add：新增一条画像，content 为事实内容（一句话，如"用户喜欢简洁直接的回答"）；
    - update：更新已有条目，fact_id 为条目编号，content 为新内容；
    - delete：删除条目，fact_id 为条目编号；
    - list：查看当前全部画像。"""
    try:
        if action == "add":
            if not content:
                return "add 操作需要提供 content"
            count = len(session_store.list_facts(user_id))
            if count >= session_store.MAX_PROFILE_FACTS:
                return (f"画像已达 {session_store.MAX_PROFILE_FACTS} 条上限，请先用 update 合并相近条目或用 delete 清理过时条目。"
                        f"\n当前画像：\n{_format_profile(user_id)}")
            fact_id = session_store.add_fact(content, user_id)
            result = f"已保存画像条目 [{fact_id}]"
        elif action == "update":
            if fact_id is None or not content:
                return "update 操作需要提供 fact_id 和 content"
            result = f"已更新画像条目 [{fact_id}]" if session_store.update_fact(fact_id, content, user_id) else f"条目 [{fact_id}] 不存在"
        elif action == "delete":
            if fact_id is None:
                return "delete 操作需要提供 fact_id"
            result = f"已删除画像条目 [{fact_id}]" if session_store.delete_fact(fact_id, user_id) else f"条目 [{fact_id}] 不存在"
        elif action == "list":
            result = "当前画像："
        else:
            return f"无效的 action: {action}，可选: add / update / delete / list"
    except Exception as e:
        return f"画像操作失败: {e}"
    return f"{result}\n当前画像：\n{_format_profile(user_id)}"
