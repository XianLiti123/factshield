from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage
from ..config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL


# llm调用类
class ChatClient:
    def __init__(self):
        self.llm = ChatOpenAI(
            model=DEEPSEEK_MODEL,
            base_url=DEEPSEEK_BASE_URL,
            api_key=DEEPSEEK_API_KEY # type:ignore
        )

    def chat(self,message:list):
        response = self.llm.invoke(message)
        return response.content


if __name__ == "__main__":
    testllm = ChatClient()
    result = testllm.chat(["你好，介绍一下你自己"])
    print(result)