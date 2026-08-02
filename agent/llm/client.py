import logging

from openai import BadRequestError, UnprocessableEntityError
from langchain_core.messages import HumanMessage
from .providers import ReasoningChatOpenAI
from ..config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL

logger = logging.getLogger(__name__)


# llm调用类
class ChatClient:
    def __init__(self,model = DEEPSEEK_MODEL,base_url = DEEPSEEK_BASE_URL,api_key = DEEPSEEK_API_KEY,
                 thinking = True,use_response_api = False):
        #thinking=True 开启思考模式（chat completions 用 DeepSeek 私有参数 thinking，
        #responses 模式用 reasoning.effort），思考内容统一在 additional_kwargs["reasoning_content"] 中；
        #use_response_api=True 时走 DeepSeek Responses API（/responses），否则走 OpenAI chat completions
        self.model, self.base_url, self.api_key = model, base_url, api_key
        self._thinking = thinking
        self._use_response_api = use_response_api
        self.llm = self._build(thinking)

    def _build(self, thinking: bool):
        #按模式重新装配客户端；thinking/response-api 都是请求体层面参数，切换需重建
        kwargs = {}
        if self._use_response_api:
            #Responses API：reasoning.effort 控制思考强度（none=关闭，high=开启）
            kwargs["use_responses_api"] = True
            kwargs["reasoning"] = {"effort": "high" if thinking else "none"}
        elif thinking:
            kwargs["extra_body"] = {"thinking":{"type":"enabled"}}
        return ReasoningChatOpenAI(
            model=self.model,
            base_url=self.base_url,
            api_key=self.api_key, # type:ignore
            thinking=thinking,
            **kwargs
        )

    def invoke(self, messages: list, tools: list | None = None):
        #统一调用入口：思考参数是部分端点的私有扩展（chat completions 的 thinking / responses 的 reasoning），
        #部分第三方兼容端点会拒绝未知参数（400/422），此时自动降级为无思考模式重试一次
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
