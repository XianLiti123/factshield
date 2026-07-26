from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage
from ..config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL


# llm调用类
class ChatClient:
    def __init__(self,model = DEEPSEEK_MODEL,base_url = DEEPSEEK_BASE_URL,api_key = DEEPSEEK_API_KEY):
        self.llm = ChatOpenAI(
            model=model,
            base_url=base_url,
            api_key=api_key # type:ignore
        )

    def chat(self,message:list):
        response = self.llm.invoke(message)
        return response.content


if __name__ == "__main__":
    testllm = ChatClient()
    result = testllm.chat([HumanMessage(content = "你好，介绍一下你自己")]) #使用humanmessage对象以区分用户发的消息
    print(result)