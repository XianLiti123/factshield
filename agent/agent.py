from typing import Iterator
from langchain_core.messages import HumanMessage,SystemMessage,BaseMessage,ToolMessage
from .core.loop import graph
from .core.context import estimate_tokens,needs_compaction,compact_messages

#Agent的对外接口
#agent类
class Agent:
    def __init__(self):
        self.graph = graph
        self.messages:list[BaseMessage] = [SystemMessage(content="你是一个有用的助手。你的工具按组提供，默认只有终端命令（execute_command）和工具集激活工具（activate_toolset）。需要联网搜索/读网页/下载文件时激活 web 工具集，需要转换本地文档或 AI 识别图片/PDF 时激活 document 工具集，需要检索本地文档知识库时激活 memory 工具集；激活后本次对话内一直有效，无需重复激活。此外你还可以通过 subagent 工具把可以独立完成的子任务交给子代理处理，子代理拥有全部工具能力但看不到对话历史，任务描述要写完整。")]#初始化系统提示词
        self.active_toolsets = ["terminal"]#已激活的工具集，跨轮持久化
        self.context_tokens = 0#当前上下文token数的运行值，随轮次增量维护，不再全量遍历历史；将来随会话持久化到SQLite

    #上下文压缩：达到窗口阈值时（或force手动触发）调一次LLM把历史压成摘要
    #只在每轮开始时检查，不每轮压缩，保证提示缓存命中率
    def _maybe_compact(self,force:bool=False)->bool:
        if not force and not needs_compaction(self.context_tokens):
            return False
        summary = compact_messages(self.messages[1:])#系统提示不参与压缩
        self.messages = [self.messages[0],SystemMessage(content=f"以下是此前对话的摘要：\n{summary}")]
        self.context_tokens = estimate_tokens(self.messages)#压缩后只剩2条消息，重算开销可忽略
        return True

    #手动压缩上下文的公开入口（供CLI/api层调用）
    def compact(self)->None:
        self._maybe_compact(force=True)

    #每轮结束后增量维护context_tokens：
    #拿到真实usage时直接采用（最后一次LLM调用的输入token数就是当时的上下文大小），
    #拿不到时只估算本轮新增的消息往上加，不遍历全量历史
    def _update_context_tokens(self,new_messages:list[BaseMessage])->None:
        real = 0
        for msg in new_messages:
            usage = getattr(msg,"usage_metadata",None)
            if usage and usage.get("input_tokens"):
                real = max(real,usage["input_tokens"])
        if real:
            self.context_tokens = real
        else:
            self.context_tokens += estimate_tokens(new_messages)

    #调用LLM的函数
    def run(self,user_input:str)->str:
        self._maybe_compact()
        self.messages.append(HumanMessage(content=user_input))
        result = self.graph.invoke({
            "messages":self.messages,"active_toolsets":self.active_toolsets
        })#type:ignore
        self.messages = result["messages"]
        self.active_toolsets = result.get("active_toolsets",self.active_toolsets)
        self._update_context_tokens(result["messages"])
        return result["messages"][-1].content

    #带流式调用LLM的函数
    def run_stream(self,user_input:str)->Iterator[tuple[str,str]]:
        #流式运行，yield (事件类型, 文本)
        #事件类型: "token" 为LLM输出的文本片段, "think" 为思考内容, "tool" 为工具执行状态, "context" 为上下文压缩提示
        if self._maybe_compact():
            yield "context","上下文已压缩"
        self.messages.append(HumanMessage(content=user_input))
        collected:dict[str,BaseMessage] = {}#本轮产生的消息，按id累加
        order:list[str] = []#消息出现顺序

        for mode,payload in self.graph.stream(
            {"messages":self.messages,"active_toolsets":self.active_toolsets},
            stream_mode=["messages","updates"]
        ):#type:ignore
            if mode == "updates":
                toolsets_update = payload.get("tools",{}).get("active_toolsets")#工具节点可能更新了激活的工具集
                if toolsets_update:
                    self.active_toolsets = list(dict.fromkeys(self.active_toolsets+toolsets_update))#updates 里是本次新增，做并集
                continue
            chunk,metadata = payload
            msg_id = chunk.id
            if msg_id in collected:
                collected[msg_id] = collected[msg_id] + chunk#type:ignore #同一条消息的分片累加
            else:
                collected[msg_id] = chunk
                order.append(msg_id)

            node = metadata.get("langgraph_node")
            if node == "call_LLM":
                reasoning = chunk.additional_kwargs.get("reasoning_content")
                if reasoning:
                    yield "think",reasoning
                if chunk.content:
                    yield "token",chunk.content
            elif node == "tools" and isinstance(chunk,ToolMessage):
                args_text = self._find_tool_args(collected,chunk.tool_call_id)
                yield ("tool",f"{chunk.name}: {args_text}" if args_text else str(chunk.name))

        self.messages.extend(collected[i] for i in order)
        self._update_context_tokens([collected[i] for i in order])

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
    print("输入 exit 退出，输入 compact 手动压缩上下文")
    while True:
        input_message = input("你: ")
        if input_message == "exit":
            break
        if input_message == "compact":
            agent.compact()
            print("[上下文已手动压缩]")
            continue
        print("AI: ",end="",flush=True)
        thinking = False#是否正在输出思考内容
        for kind,text in agent.run_stream(input_message):
            if kind == "tool":
                thinking = False
                print(f"\n[执行工具] {text}\nAI: ",end="",flush=True)
                continue
            if kind == "context":
                thinking = False
                print(f"[{text}]")
                continue
            if kind == "think" and not thinking:
                print("[思考] ",end="",flush=True)
                thinking = True
            elif kind == "token" and thinking:
                print("\n[回答] ",end="",flush=True)
                thinking = False
            for char in text:
                print(char,end="",flush=True)#逐字打印，打字机效果
                time.sleep(CHAR_DELAY)
        print()
