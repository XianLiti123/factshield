import logging

from langchain_core.messages import HumanMessage
from .providers import ReasoningChatOpenAI
from .text import content_to_text
from ..config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL

logger = logging.getLogger(__name__)

#Responses API 的"输出专用"内容块：服务端搜索/文件搜索等调用项只能出现在响应里，
#不能回传进 input 历史（没有对应的 tool result，服务端会挂起或报错）。
#LangChain 的 _construct_responses_api_input 会把这类块原样塞回，这里发送前统一剔除。
_OUTPUT_ONLY_BLOCK_TYPES = {
    "web_search_call", "file_search_call", "computer_call", "code_interpreter_call",
    "mcp_call", "mcp_list_tools", "mcp_approval_request", "tool_search_call",
    "tool_search_output", "apply_patch_call", "apply_patch_call_output",
    "compaction", "image_generation_call",
}

#单次 LLM 请求的读超时（秒）：研究流水线/对话都受此约束，挂起时快速失败并走节点重试/报错，
#不再无限等待（DeepSeek responses 模式 + 思考 + 服务端搜索的单轮耗时可达 1-2 分钟）
_LLM_TIMEOUT_SECONDS = 240


def _native_web_search_tools(tools: list) -> list:
    #Responses API 模式：把本地 web_search 函数工具替换为 DeepSeek 原生服务端 web_search 工具。
    #langchain-openai 对 {"type": "web_search"} 原样透传（_WellKnownOpenAITools），
    #服务端在对话内执行搜索，响应里以 web_search_call 输出块返回，无需本地搜索 key；
    #langchain 尚未原生实现该内置工具，这里在工具绑定层 override。
    if any(isinstance(t, dict) and t.get("type") == "web_search" for t in tools):
        return tools
    replaced = False
    out: list = []
    for tool in tools:
        if getattr(tool, "name", None) == "web_search":
            out.append({"type": "web_search"})
            replaced = True
        else:
            out.append(tool)
    if replaced:
        logger.info("Responses API 模式：web_search 切换为 DeepSeek 原生服务端搜索")
    return out


def _sanitize_messages(messages: list) -> list:
    #剔除历史消息里的"输出专用"内容块（web_search_call 等），避免回传后服务端挂起；
    #文本块与函数调用块保留。函数调用块有对应的 ToolMessage 结果，可正常回传。
    cleaned: list = []
    for msg in messages:
        content = getattr(msg, "content", None)
        if not (isinstance(content, list)
                and any(isinstance(b, dict) and b.get("type") in _OUTPUT_ONLY_BLOCK_TYPES
                       for b in content)):
            cleaned.append(msg)
            continue
        msg = msg.model_copy(deep=True)
        msg.content = [b for b in content
                       if not (isinstance(b, dict) and b.get("type") in _OUTPUT_ONLY_BLOCK_TYPES)]
        cleaned.append(msg)
    return cleaned


# llm调用类
class ChatClient:
    """LLM 调用客户端封装。

    统一入口：按用户配置的协议（chat completions / Responses API）与思考模式装配
    langchain 客户端并调用模型，不做任何自动降级；端点拒绝参数时直接抛错由上层处理。
    """

    def __init__(self,model = DEEPSEEK_MODEL,base_url = DEEPSEEK_BASE_URL,api_key = DEEPSEEK_API_KEY,
                 thinking = True,use_response_api = False,max_output_tokens: int | None = None):
        #thinking=True 开启思考模式（chat completions 用 DeepSeek 私有参数 thinking，
        #responses 模式用 reasoning.effort），思考内容统一在 additional_kwargs["reasoning_content"] 中；
        #use_response_api=True 时走 DeepSeek Responses API（/responses），否则走 OpenAI chat completions
        #max_output_tokens：单次 LLM 调用的输出 token 上限，用于把工具循环里超长输出（几万字）截断，
        #避免单轮 30~100 秒的长生成；None 表示不限制
        self.model, self.base_url, self.api_key = model, base_url, api_key
        self._thinking = thinking
        self._use_response_api = use_response_api
        self._max_output_tokens = max_output_tokens
        self.llm = self._build(thinking)

    def _build(self, thinking: bool, max_output_tokens: int | None = None,
               reasoning: str | None = None):
        #按模式重新装配客户端；thinking/response-api/max_output_tokens 都是请求体层面参数，切换需重建。
        #reasoning 显式传 "low"/"none" 时覆盖 thinking（机械取数轮用低思考提速，质量关键节点保持 high）
        kwargs = {}
        effort = reasoning or ("high" if thinking else "none")
        if self._use_response_api:
            #Responses API：reasoning.effort 控制思考强度（none=关闭，high=开启）
            kwargs["use_responses_api"] = True
            kwargs["reasoning"] = {"effort": effort}
            if max_output_tokens:
                kwargs["model_kwargs"] = {"max_output_tokens": max_output_tokens}
        elif thinking:
            extra_body = {"thinking": {"type": "enabled"}}
            if max_output_tokens:
                extra_body["max_tokens"] = max_output_tokens
            kwargs["extra_body"] = extra_body
        elif max_output_tokens:
            kwargs["extra_body"] = {"max_tokens": max_output_tokens}
        return ReasoningChatOpenAI(
            model=self.model,
            base_url=self.base_url,
            api_key=self.api_key, # type:ignore
            timeout=_LLM_TIMEOUT_SECONDS,
            thinking=thinking,
            **kwargs
        )

    def invoke(self, messages: list, tools: list | None = None,
               *, max_output_tokens: int | None = None,
               reasoning: str | None = None):
        #统一调用入口：严格按用户配置的协议与思考模式调用，不做任何自动降级；
        #端点拒绝参数时直接抛错，由上层记录错误并提示用户调整配置
        return self._invoke(messages, tools=tools, thinking=self._thinking,
                            max_output_tokens=max_output_tokens or self._max_output_tokens,
                            reasoning=reasoning)

    def _invoke(self, messages: list, tools: list | None = None, thinking: bool = True,
                max_output_tokens: int | None = None, reasoning: str | None = None):
        llm = self._build(thinking, max_output_tokens=max_output_tokens, reasoning=reasoning)
        messages = _sanitize_messages(messages)
        if not tools:
            return llm.invoke(messages)
        if self._use_response_api:
            #Responses API 模式：web_search 固定走 DeepSeek 原生服务端搜索，
            #服务端不支持时直接报错，不回退本地搜索工具
            return llm.bind_tools(_native_web_search_tools(tools)).invoke(messages)
        return llm.bind_tools(tools).invoke(messages)

    def chat(self,message:list, *, max_output_tokens: int | None = None,
             reasoning: str | None = None):
        response = self.invoke(message, max_output_tokens=max_output_tokens, reasoning=reasoning)
        #Responses API 模式下 content 是输出块列表，归一为纯文本（chat completions 原样返回）
        return content_to_text(response.content)


if __name__ == "__main__":
    testllm = ChatClient()
    result = testllm.chat([HumanMessage(content = "你好，介绍一下你自己")]) #使用humanmessage对象以区分用户发的消息
    print(result)
