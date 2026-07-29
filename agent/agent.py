import logging
from typing import Iterator

from langchain_core.messages import HumanMessage,SystemMessage,BaseMessage,ToolMessage,AIMessage

from .core.loop import graph
from .core.context import estimate_tokens,needs_compaction,compact_messages
from .core.prompt import build_system_prompt
from .session import store as session_store
from .session.store import current_user_id
from .session.users import ensure_admin

logger = logging.getLogger(__name__)

#无画像时的系统提示词，作为向后兼容的入口；实际使用走 build_system_prompt 动态组装
SYSTEM_PROMPT = build_system_prompt()


#Agent的对外接口
#agent类
class Agent:
    def __init__(self,session_id:str|None=None,user_id:int|None=None):
        self.graph = graph
        self.user_id = user_id if user_id is not None else ensure_admin()#缺省归 admin（CLI 直用免登录）
        self.session_id = session_store.create_session(session_id,self.user_id)#建行或复用
        #画像只在会话建立时加载一次，会话生命周期内固定不变：
        #中途重建系统提示会打飞整段前缀缓存，因此本会话存入的画像要到下次新建对话才生效
        self.messages:list[BaseMessage] = [SystemMessage(content=build_system_prompt(session_store.profile_text(self.user_id) or None))]#初始化系统提示词
        self.active_toolsets = ["terminal"]#已激活的工具集，跨轮持久化
        self.context_tokens = 0#当前上下文token数的运行值，随轮次增量维护，不再全量遍历历史；随会话持久化到 sessions.db
        self._turn_seq = 0#当前轮次序号，与 turns 表的 seq 对应
        self._persist = True#embedding 不可用时降级为内存态

        #尝试从 sessions.db 恢复会话状态（跨进程/重启续聊）
        try:
            state = session_store.load_session(self.session_id)
            if state:
                self.context_tokens = state["context_tokens"]
                self.active_toolsets = state["active_toolsets"]
                self._turn_seq = session_store.max_seq(self.session_id)
                if state["summary"]:
                    self.messages.append(SystemMessage(content=f"以下是此前对话的摘要：\n{state['summary']}"))
                for seq,user_text,assistant_text in session_store.get_turns(self.session_id,after_seq=state["compacted_until_seq"]):
                    self.messages.append(HumanMessage(content=user_text))
                    if assistant_text:
                        self.messages.append(AIMessage(content=assistant_text))
        except RuntimeError as e:
            #未配置 Embedding 模型：会话降级为内存态，不静默丢失
            logger.warning("会话历史持久化不可用，本次会话仅内存态: %s",e)
            self._persist = False

    #上下文压缩：达到窗口阈值时（或force手动触发）调一次LLM把历史压成摘要
    #只在每轮开始时检查，不每轮压缩，保证提示缓存命中率
    def _maybe_compact(self,force:bool=False)->bool:
        if not force and not needs_compaction(self.context_tokens):
            return False
        summary = compact_messages(self.messages[1:],self.user_id)#系统提示不参与压缩
        self.messages = [self.messages[0],SystemMessage(content=f"以下是此前对话的摘要：\n{summary}")]
        self.context_tokens = estimate_tokens(self.messages)#压缩后只剩2条消息，重算开销可忽略
        if self._persist:
            #摘要和覆盖位置落盘，原始轮次历史不动
            session_store.save_summary(self.session_id,summary,self._turn_seq,self.context_tokens)
        return True

    #手动压缩上下文的公开入口（供CLI/api层调用）
    def compact(self)->None:
        self._maybe_compact(force=True)

    #预检：用户未配置 LLM 时拒绝服务（不回退系统默认 key）
    def _llm_missing(self)->bool:
        from .session.model_config import get_config
        return get_config(self.user_id,"llm") is None

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

    #每轮结束后持久化这一轮（用户输入+助手最终回复），工具中间消息不入库
    def _save_turn(self,user_input:str,assistant_text:str)->None:
        if not self._persist:
            return
        self._turn_seq += 1
        try:
            session_store.save_turn(self.session_id,self._turn_seq,user_input,assistant_text,
                                    self.context_tokens,self.active_toolsets)
        except RuntimeError as e:
            logger.warning("会话历史写入失败，后续转为内存态: %s",e)
            self._persist = False

    #调用LLM的函数
    def run(self,user_input:str)->str:
        if self._llm_missing():
            raise RuntimeError("未配置 LLM 模型，请先在设置中配置 base_url、api_key 和模型名")
        ctx = current_user_id.set(self.user_id)#注入用户上下文，图内的画像工具靠它感知归属
        try:
            self._maybe_compact()
            self.messages.append(HumanMessage(content=user_input))
            result = self.graph.invoke({
                "messages":self.messages,"active_toolsets":self.active_toolsets
            })#type:ignore
            self.messages = result["messages"]
            self.active_toolsets = result.get("active_toolsets",self.active_toolsets)
            self._update_context_tokens(result["messages"])
            answer = result["messages"][-1].content
            self._save_turn(user_input,answer if isinstance(answer,str) else str(answer))
            return answer
        finally:
            current_user_id.reset(ctx)

    #带流式调用LLM的函数
    def run_stream(self,user_input:str)->Iterator[tuple[str,str]]:
        #流式运行，yield (事件类型, 文本)
        #事件类型: "token" 为LLM输出的文本片段, "think" 为思考内容, "tool" 为工具执行状态,
        #"context" 为上下文压缩提示, "error" 为前置拒绝（如未配置模型）
        if self._llm_missing():
            yield "error","未配置 LLM 模型，请先在设置中配置 base_url、api_key 和模型名"
            return
        ctx = current_user_id.set(self.user_id)#注入用户上下文，图内的画像工具靠它感知归属
        try:
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
            #取本轮最后一条有内容的AI消息作为最终回复入库
            answer = ""
            for msg_id in reversed(order):
                msg = collected[msg_id]
                if isinstance(msg,AIMessage) and isinstance(msg.content,str) and msg.content:
                    answer = msg.content
                    break
            self._save_turn(user_input,answer)
        finally:
            current_user_id.reset(ctx)

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
    print(f"会话ID: {agent.session_id}（下次可用 Agent('{agent.session_id}') 恢复）")
    print("输入 exit 退出，输入 compact 手动压缩上下文，输入 profile 查看用户画像")
    while True:
        input_message = input("你: ")
        if input_message == "exit":
            break
        if input_message == "compact":
            agent.compact()
            print("[上下文已手动压缩]")
            continue
        if input_message == "profile":
            text = session_store.profile_text()
            print(f"[用户画像]\n{text}" if text else "[用户画像为空]")
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
