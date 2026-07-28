from langchain_openai import ChatOpenAI
from langchain_core.messages import AIMessageChunk


class ReasoningChatOpenAI(ChatOpenAI):
    #通用 ChatOpenAI 子类：额外提取思考内容（reasoning_content）
    #langchain-openai 只解析官方 OpenAI 字段，第三方兼容接口的 reasoning_content 会被丢弃，这里补上
    #DeepSeek、通义千问、GLM 等兼容接口都使用 reasoning_content 字段，换模型时无需改动本类
    def _create_chat_result(self,response,generation_info=None):
        #非流式：从 choices[0].message.reasoning_content 提取
        result = super()._create_chat_result(response,generation_info)
        choices = getattr(response,"choices",None)
        if choices and hasattr(choices[0].message,"reasoning_content"):
            reasoning = choices[0].message.reasoning_content
            if reasoning:
                result.generations[0].message.additional_kwargs["reasoning_content"] = reasoning
        return result

    def _convert_chunk_to_generation_chunk(self,chunk,default_chunk_class,base_generation_info):
        #流式：从 delta.reasoning_content 提取
        generation_chunk = super()._convert_chunk_to_generation_chunk(chunk,default_chunk_class,base_generation_info)
        if generation_chunk and (choices := chunk.get("choices")):
            reasoning = choices[0].get("delta",{}).get("reasoning_content")
            if reasoning is not None and isinstance(generation_chunk.message,AIMessageChunk):
                generation_chunk.message.additional_kwargs["reasoning_content"] = reasoning
        return generation_chunk
