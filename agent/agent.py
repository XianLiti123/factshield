from typing import Iterator
from langchain_core.messages import HumanMessage,SystemMessage,BaseMessage,ToolMessage
from .core.loop import graph

#Agent的对外接口
#agent类
class Agent:
    def __init__(self):
        self.graph = graph
        self.messages:list[BaseMessage] = [SystemMessage(content="你是一个有用的助手，可以用终端命令、联网搜索、读取网页、下载网络文件、转换本地文档（PDF/Word/PPT/Excel 等转 Markdown）和 AI 高精度识别图片或 PDF（含扫描件）帮用户解决问题。")]#初始化系统提示词

    #调用LLM的函数
    def run(self,user_input:str)->str:
        self.messages.append(HumanMessage(content=user_input))
        result = self.graph.invoke({
            "messages":self.messages
        })#type:ignore
        self.messages = result["messages"]
        return result["messages"][-1].content

    #带流式调用LLM的函数
    def run_stream(self,user_input:str)->Iterator[tuple[str,str]]:
        #流式运行，yield (事件类型, 文本)
        #事件类型: "token" 为LLM输出的文本片段, "tool" 为工具执行状态
        self.messages.append(HumanMessage(content=user_input))
        collected:dict[str,BaseMessage] = {}#本轮产生的消息，按id累加
        order:list[str] = []#消息出现顺序

        for chunk,metadata in self.graph.stream(
            {"messages":self.messages},stream_mode="messages"
        ):#type:ignore
            msg_id = chunk.id
            if msg_id in collected:
                collected[msg_id] = collected[msg_id] + chunk#type:ignore #同一条消息的分片累加
            else:
                collected[msg_id] = chunk
                order.append(msg_id)

            node = metadata.get("langgraph_node")
            if node == "call_LLM" and chunk.content:
                yield "token",chunk.content
            elif node == "tools" and isinstance(chunk,ToolMessage):
                args_text = self._find_tool_args(collected,chunk.tool_call_id)
                yield ("tool",f"{chunk.name}: {args_text}" if args_text else str(chunk.name))

        self.messages.extend(collected[i] for i in order)

    @staticmethod
    def _find_tool_args(collected:dict[str,BaseMessage],tool_call_id:str)->str:
        #根据tool_call_id从已收集的AI消息中找回对应的工具调用参数，用于展示状态
        for msg in collected.values():
            for tc in getattr(msg,"tool_calls",None) or []:
                if tc.get("id") == tool_call_id:
                    return ", ".join(f"{k}={v}" for k,v in tc.get("args",{}).items())
        return ""


# 测试代码
if __name__ == "__main__":
    import time

    CHAR_DELAY = 0.02#每个字之间的延时(秒)，调大打字更慢，调小更快

    agent = Agent()
    print("输入 exit 退出")
    while True:
        input_message = input("你: ")
        if input_message == "exit":
            break
        print("AI: ",end="",flush=True)
        for kind,text in agent.run_stream(input_message):
            if kind == "token":
                for char in text:
                    print(char,end="",flush=True)#逐字打印，打字机效果
                    time.sleep(CHAR_DELAY)
            else:
                print(f"\n[执行工具] {text}\nAI: ",end="",flush=True)
        print()
