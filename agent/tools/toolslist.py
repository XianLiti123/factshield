from .terminal import execute_command
from .webresearch import web_search,web_extract
from .convert import convert_document,ai_recognize_document
from .download import download_file
from .advanced_research import advanced_research

#工具集划分，新增工具时登记到对应组；LLM 默认只绑 terminal 组，其余靠 activate_toolset 激活
toolsets = {
    "terminal":[execute_command],#终端命令，常驻
    "web":[web_search,web_extract,download_file],#联网搜索/读网页/下载文件
    "document":[convert_document,ai_recognize_document],#本地文档转换/AI识别
    "memory":[advanced_research],#本地知识库精确检索
}

#全部工具，供 ToolNode 执行端使用（执行端持全量不耗上下文，上下文开销只在 bind_tools 一侧）
full_tools = [t for tools in toolsets.values() for t in tools]
