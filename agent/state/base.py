from typing import Annotated
from langgraph.graph import MessagesState

def _merge_toolsets(a:list[str],b:list[str])->list[str]:
    return list(dict.fromkeys((a or [])+(b or [])))#并集去重，保持顺序

class AgentState(MessagesState):
    active_toolsets: Annotated[list[str],_merge_toolsets]#已激活的工具集，累积语义
