from langgraph.graph import StateGraph,END
from ..state.base import AgentState
from ..llm.client import ChatClient
from ..session.store import current_user_id
from ..session.model_config import get_config
from ..tools.toolslist import full_tools,toolsets
from ..tools.activate import activate_toolset
from ..tools.subagent import subagent
from langgraph.prebuilt import ToolNode

#每用户 LLM client 缓存：按 current_user_id 装配，配置变更时经 invalidate_llm_cache 失效
_clients:dict[int,ChatClient] = {}


def invalidate_llm_cache(user_id:int)->None:
    #用户更新模型配置后调用，丢弃其缓存的 client
    _clients.pop(user_id,None)


def get_llm_client(user_id:int)->ChatClient:
    #按用户取 LLM client（思考模式开启）；未配置时拒绝服务并提示
    if user_id not in _clients:
        cfg = get_config(user_id,"llm")
        if cfg is None:
            raise RuntimeError("未配置 LLM 模型，请先在设置中配置 base_url、api_key 和模型名")
        _clients[user_id] = ChatClient(model=cfg["model_name"],base_url=cfg["base_url"],api_key=cfg["api_key"])
    return _clients[user_id]


#判断LLM有没有调工具
def if_LLM_call_tools(state:AgentState):
    last_msg = state["messages"][-1]
    if last_msg.tool_calls: #type:ignore
        return "tools"
    return "__end__"


#构建一个 agent 循环图；with_subagent 控制是否提供 subagent 工具（子代理的图不提供，防止嵌套调用）
def build_graph(with_subagent:bool):
    resident = [activate_toolset]+([subagent] if with_subagent else [])#常驻工具

    #创建调用LLM的函数
    def call_LLM(state:AgentState):
        names = state.get("active_toolsets") or ["terminal"]#type:ignore #当前激活的工具集，默认终端
        tools = resident+[t for n in names for t in toolsets.get(n,[])]#元工具常驻，其余按激活状态动态绑定
        client = get_llm_client(current_user_id.get())#按当前用户装配，用户上下文由 Agent 调图前注入
        response = client.llm.bind_tools(tools).invoke(state["messages"])
        return {"messages":[response]}

    agentloop = StateGraph(AgentState)#绑定state状态

    agentloop.add_node("call_LLM",call_LLM)#添加节点，此为调用LLM的节点

    agentloop.add_node("tools",ToolNode(full_tools+resident))#设置工具节点，执行端持全量工具（不耗上下文）

    agentloop.set_entry_point("call_LLM") #从call_LLM节点开始

    agentloop.add_conditional_edges("call_LLM",if_LLM_call_tools,{"tools":"tools","__end__":END})#添加可选边，从LLM调用到工具，如if_LLM_call_tools为真，就跳转至tool节点，否则就结束

    agentloop.add_edge("tools","call_LLM")#添加从tools到LLM调用的边，调用tools之后总是会回到LLM调用

    return agentloop.compile()#编译整个图


graph = build_graph(True)#主代理图，含 subagent 工具
subagent_graph = build_graph(False)#子代理图，含其余全部工具，但不含 subagent，防止子代理继续套娃



if __name__ == "__main__":
    from langchain_core.messages import HumanMessage

    # 跑一次
    result = graph.invoke({
        "messages": [HumanMessage(content="用 dir 命令看看当前目录有什么")]
    })

    # 看最终回复
    print(result["messages"][-1].content)
