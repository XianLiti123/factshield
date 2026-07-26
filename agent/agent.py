from langchain_core.messages import HumanMessage,SystemMessage,BaseMessage
from .core.loop import graph

#Agent的对外接口
#agent类
class Agent:
    def __init__(self):
        self.graph = graph
        self.messages:list[BaseMessage] = [SystemMessage(content="你是一个有用的助手，可以用终端命令帮用户解决问题。")]#初始化系统提示词

    def run(self,user_input:str)->str:
        self.messages.append(HumanMessage(content=user_input))
        result = self.graph.invoke({
            "messages":self.messages
        })#type:ignore
        self.messages = result["messages"]
        return result["messages"][-1].content


# 测试代码
if __name__ == "__main__":
    agent = Agent()
    while True:
        input_message = input()
        if input_message == "exit":
            break
        print(agent.run(input_message))
