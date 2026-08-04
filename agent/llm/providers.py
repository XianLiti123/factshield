"""LLM 客户端扩展实现。

ReasoningChatOpenAI 在 ChatOpenAI 基础上补齐思考内容（reasoning_content）的解析：
- chat completions 模式：从 choices/delta 中提取 reasoning_content。
- Responses API 模式：从 response.reasoning_text.delta 流块中提取并映射为
  additional_kwargs["reasoning_content"]，与 chat completions 展示逻辑保持一致。
兼容 DeepSeek、通义千问、GLM 等使用 reasoning_content 字段的第三方接口。
"""

import logging

from langchain_openai import ChatOpenAI
from langchain_openai.chat_models.base import (
    _construct_lc_result_from_responses_api,
    _convert_responses_chunk_to_generation_chunk,
)
from langchain_core.messages import AIMessageChunk
from langchain_core.outputs import ChatGenerationChunk

logger = logging.getLogger(__name__)


class ReasoningChatOpenAI(ChatOpenAI):
    """通用 ChatOpenAI 子类：额外提取思考内容（reasoning_content）。

    langchain-openai 只解析官方 OpenAI 字段，第三方兼容接口的 reasoning_content
    会被丢弃，这里补上。DeepSeek、通义千问、GLM 等兼容接口都使用
    reasoning_content 字段，换模型时无需改动本类。
    """

    thinking: bool = True  #思考模式：chat completions -> extra_body.thinking；responses -> reasoning.effort

    def _create_chat_result(self,response,generation_info=None):
        #非流式 chat completions：从 choices[0].message.reasoning_content 提取
        result = super()._create_chat_result(response,generation_info)
        choices = getattr(response,"choices",None)
        if choices and hasattr(choices[0].message,"reasoning_content"):
            reasoning = choices[0].message.reasoning_content
            if reasoning:
                result.generations[0].message.additional_kwargs["reasoning_content"] = reasoning
        return result

    def _convert_chunk_to_generation_chunk(self,chunk,default_chunk_class,base_generation_info):
        #流式 chat completions：从 delta.reasoning_content 提取
        generation_chunk = super()._convert_chunk_to_generation_chunk(chunk,default_chunk_class,base_generation_info)
        if generation_chunk and (choices := chunk.get("choices")):
            reasoning = choices[0].get("delta",{}).get("reasoning_content")
            if reasoning is not None and isinstance(generation_chunk.message,AIMessageChunk):
                generation_chunk.message.additional_kwargs["reasoning_content"] = reasoning
        return generation_chunk

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        #非流式：responses 模式走库内转换（含 tool_calls/usage）；
        #严格按配置调用，端点拒绝 reasoning 等参数时直接抛错，不降级重试
        self._ensure_sync_client_available()
        payload = self._get_request_payload(messages, stop=stop, **kwargs)
        if not self._use_responses_api(payload):
            return super()._generate(messages, stop, run_manager, **kwargs)
        response = self.root_client.responses.with_raw_response.create(**payload).parse()
        return _construct_lc_result_from_responses_api(
            response, output_version=self.output_version
        )

    def _stream(self, messages, stop=None, run_manager=None, **kwargs):
        #流式：responses 模式下补上 reasoning_text.delta（库内 1.4.x 不吐思考内容），
        #统一映射为 additional_kwargs["reasoning_content"]，与 chat completions 模式的展示逻辑一致；
        #严格按配置调用，端点拒绝 reasoning 等参数时直接抛错，不降级重试
        kwargs["stream"] = True
        payload = self._get_request_payload(messages, stop=stop, **kwargs)
        if not self._use_responses_api(payload):
            yield from super()._stream(messages, stop, run_manager, **kwargs)
            return
        with self.root_client.responses.create(**payload) as response:
            current_index = -1
            current_output_index = -1
            current_sub_index = -1
            has_reasoning = False
            for chunk in response:
                chunk_type = getattr(chunk, "type", "")
                if chunk_type == "response.reasoning_text.delta":
                    delta = chunk.delta or ""
                    if delta:
                        gen = ChatGenerationChunk(
                            message=AIMessageChunk(
                                content="",
                                additional_kwargs={"reasoning_content": delta},
                            )
                        )
                        if run_manager:
                            run_manager.on_llm_new_token(delta, chunk=gen)
                        yield gen
                    continue
                (current_index, current_output_index, current_sub_index, gen) = (
                    _convert_responses_chunk_to_generation_chunk(
                        chunk,
                        current_index,
                        current_output_index,
                        current_sub_index,
                        has_reasoning=has_reasoning,
                        output_version=self.output_version,
                    )
                )
                if gen:
                    if run_manager:
                        run_manager.on_llm_new_token(gen.text, chunk=gen)
                    if "reasoning" in gen.message.additional_kwargs:
                        has_reasoning = True
                    yield gen
            return
