"""Agent 运行图的状态定义。

AgentState 继承 MessagesState（消息累积语义），并补充：
- active_toolsets：已激活工具集，跨节点累积（并集去重）。
- user_id：当前用户，供图内节点/工具按用户装配（LLM client、画像等）。
- session_id：当前会话 id，供子代理等工具定位归属。
"""

from typing import Annotated
from langgraph.graph import MessagesState

def _merge_toolsets(a:list[str],b:list[str])->list[str]:
    return list(dict.fromkeys((a or [])+(b or [])))#并集去重，保持顺序

class AgentState(MessagesState):
    active_toolsets: Annotated[list[str],_merge_toolsets]#已激活的工具集，累积语义
    user_id: int#当前用户，供图内节点/工具按用户装配（LLM client、画像、视觉模型）
    session_id: str|None = None#当前会话 id，供子代理等工具定位归属（错误登记/修复用）
