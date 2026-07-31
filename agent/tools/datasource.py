from typing import Annotated

from langchain_core.tools import tool
from langgraph.prebuilt import InjectedState

from ..session.data_sources import get_enabled_sources


@tool
def list_data_sources(user_id: Annotated[int, InjectedState("user_id")] = None) -> str:
    """查看当前用户在系统设置中启用并配置的自定义数据源（如 Wind、Tushare、AKShare 或自建 HTTP 接口）。
    当内置的 efinance/TickFlow 数据无法满足需求，或用户提到自己配置的数据源时使用。
    返回每个数据源的名称、用途说明、连接方式与接入规范，之后据此用 execute_command 实际取数：
    - http 模式：规范描述了请求方法、URL、鉴权头、参数与响应数据路径，按规范用 curl 发请求并解析响应；
    - python 模式：规范给出了 SDK 调用示例，据此编写 python 脚本运行获取数据。"""
    sources = get_enabled_sources(user_id)
    if not sources:
        return "当前没有已启用的自定义数据源（可在系统设置的数据源管理中配置并启用）。"
    blocks = []
    for s in sources:
        header = f"【{s['name']}】（{s['mode']} 模式）{s['description']}"
        spec = s["specification"] or "（未填写接入规范）"
        blocks.append(f"{header}\n接入规范：\n{spec}")
    return "\n\n".join(blocks)
