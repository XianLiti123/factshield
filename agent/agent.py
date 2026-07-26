from langchain_core.messages import HumanMessage
from .core.loop import graph

#Agent的对外接口
class Agent:
    def run(self,user_input:str)->str:
        result = graph.invoke({
            "messages":[HumanMessage(content=user_input)]
        })
        return result["messages"][-1].content


if __name__ == "__main__":
    agent = Agent()
    while True:
        input_message = input()
        if input_message == "exit":
            break
        print(agent.run(input_message))
