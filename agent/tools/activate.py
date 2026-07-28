from typing import Annotated
from langchain_core.tools import tool,InjectedToolCallId
from langchain_core.messages import ToolMessage
from langgraph.types import Command
from .toolslist import toolsets


@tool
def activate_toolset(toolset_names:list[str],tool_call_id:Annotated[str,InjectedToolCallId])->Command:
    """激活指定的工具集，激活后本次对话内一直可用，无需重复激活。可选工具集：
    web（联网搜索/读取网页/下载文件）、document（转换本地文档为Markdown/AI高精度识别图片或PDF）、
    memory（精确检索本地文档知识库）。需要哪类能力就先激活对应工具集，可一次激活多个。
    toolset_names 为要激活的工具集名称列表。"""
    valid = [n for n in toolset_names if n in toolsets]
    invalid = [n for n in toolset_names if n not in toolsets]
    if "terminal" not in valid:
        valid.append("terminal")#终端常驻，防止失去执行能力
    new_tools = [t.name for n in valid for t in toolsets[n]]#type:ignore
    content = f"已激活工具集 {valid}，可用工具: {', '.join(new_tools)}"
    if invalid:
        content += f"；以下名称无效已忽略: {', '.join(invalid)}，可选: {', '.join(toolsets)}"
    return Command(update={"active_toolsets":valid,"messages":[ToolMessage(content=content,tool_call_id=tool_call_id)]})
