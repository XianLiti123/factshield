import logging

from openai import BadRequestError, UnprocessableEntityError
from langchain_core.messages import HumanMessage
from .providers import ReasoningChatOpenAI
from ..config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL

logger = logging.getLogger(__name__)


# llm调用类
class ChatClient:
    def __init__(self,model = DEEPSEEK_MODEL,base_url = DEEPSEEK_BASE_URL,api_key = DEEPSEEK_API_KEY,thinking = True):
        #thinking=True 开启思考模式（DeepSeek 私有参数），思考内容在消息的 additional_kwargs["reasoning_content"] 中
        self.model, self.base_url, self.api_key = model, base_url, api_key
        self._thinking = thinking
        self.llm = self._build(thinking)

    def _build(self, thinking: bool):
        #按思考模式重新装配 OpenAI 兼容客户端；thinking 是请求体层面的私有参数，换模式需重建
        kwargs = {}
        if thinking:
            kwargs["extra_body"] = {"thinking":{"type":"enabled"}}
        return ReasoningChatOpenAI(
            model=self.model,
            base_url=self.base_url,
            api_key=self.api_key, # type:ignore
            **kwargs
        )

    def invoke(self, messages: list, tools: list | None = None):
        #统一调用入口：thinking 参数是 DeepSeek 私有扩展，部分第三方兼容端点会拒绝未知参数
        #（400/422），此时自动降级为无思考模式重试一次，保证前端配置的任意兼容模型可用
        try:
            return self._invoke(messages, tools=tools, thinking=self._thinking)
        except (BadRequestError, UnprocessableEntityError) as e:
            if not self._thinking:
                raise
            logger.warning("模型端点拒绝 thinking 参数（%s），降级为无思考模式重试", e)
            return self._invoke(messages, tools=tools, thinking=False)

    def _invoke(self, messages: list, tools: list | None = None, thinking: bool = True):
        llm = self._build(thinking)
        bound = llm.bind_tools(tools) if tools else llm
        return bound.invoke(messages)

    def chat(self,message:list):
        response = self.invoke(message)
        return response.content


if __name__ == "__main__":
    testllm = ChatClient()
    result = testllm.chat([HumanMessage(content = "你好，介绍一下你自己")]) #使用humanmessage对象以区分用户发的消息
    print(result)
