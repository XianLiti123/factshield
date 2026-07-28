from langchain_core.tools import tool
from langchain_core.messages import SystemMessage
from .toolslist import toolsets


@tool
def subagent(prompt:str)->str:
    """调用一个子代理来完成一项独立的工作。子代理拥有终端、联网、文档处理、知识库检索等全部能力（但不能继续调用子代理），
    与当前对话完全隔离，看不到对话历史。适合把可以独立完成的子任务交出去，避免主干对话被中间过程污染。
    prompt 为子代理的提示词，由你完整编写（角色、背景、目标、期望的输出等都写清楚，子代理只看得到这一段话）。
    返回子代理的执行结果。"""
    from ..core.loop import subagent_graph#延迟导入，避免循环依赖
    result = subagent_graph.invoke({
        "messages":[SystemMessage(content=prompt)],#子代理的提示词完全由主代理通过参数提供
        "active_toolsets":list(toolsets)#子代理直接使用全部工具集，省去逐组激活
    })#type:ignore
    return str(result["messages"][-1].content)
