from langgraph.graph import StateGraph,END
from ..state.base import AgentState
from ..llm.client import ChatClient
from ..tools.terminal import execute_command
from ..tools.webresearch import web_search,web_extract
from ..tools.convert import convert_document,ai_recognize_document
from ..tools.download import download_file
from langgraph.prebuilt import ToolNode

# 创建LLM
LLMclient = ChatClient()


#为LLM绑定上工具
LLM_with_tools = LLMclient.llm.bind_tools([execute_command,web_search,web_extract,convert_document,ai_recognize_document,download_file])


#创建调用LLM的函数
def call_LLM(state:AgentState):
    response = LLM_with_tools.invoke(state["messages"])
    return {"messages":[response]}


#判断LLM有没有调工具
def if_LLM_call_tools(state:AgentState):
    last_msg = state["messages"][-1]
    if last_msg.tool_calls: #type:ignore
        return "tools"
    return "__end__"


#loopgraph
agentloop = StateGraph(AgentState)#绑定state状态

agentloop.add_node("call_LLM",call_LLM)#添加节点，此为调用LLM的节点

agentloop.add_node("tools",ToolNode([execute_command,web_search,web_extract,convert_document,ai_recognize_document,download_file]))#设置工具节点

agentloop.set_entry_point("call_LLM") #从call_LLM节点开始

agentloop.add_conditional_edges("call_LLM",if_LLM_call_tools,{"tools":"tools","__end__":END})#添加可选边，从LLM调用到工具，如if_LLM_call_tools为真，就跳转至tool节点，否则就结束

agentloop.add_edge("tools","call_LLM")#添加从tools到LLM调用的边，调用tools之后总是会回到LLM调用

graph = agentloop.compile()#编译整个图



if __name__ == "__main__":
    from langchain_core.messages import HumanMessage

    # 跑一次
    result = graph.invoke({
        "messages": [HumanMessage(content="用 dir 命令看看当前目录有什么")]
    })

    # 看最终回复
    print(result["messages"][-1].content)