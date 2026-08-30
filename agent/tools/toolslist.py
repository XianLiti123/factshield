from .terminal import execute_command
from .webresearch import web_search,web_extract
from .convert import convert_document,ai_recognize_document
from .download import download_file
from .advanced_research import advanced_research
from .recall import recall_conversation
from .profile import update_user_profile
from .finance import query_stock_financials,query_stock_kline,query_realtime_quotes
from .datasource import list_data_sources
from .skill import use_skill

#工具集划分，新增工具时登记到对应组；LLM 默认只绑 terminal 组，其余靠 activate_toolset 激活
toolsets = {
    "terminal":[execute_command,update_user_profile],#终端命令+用户画像，常驻
    "web":[web_search,web_extract,download_file],#联网搜索/读网页/下载文件
    "document":[convert_document,ai_recognize_document],#本地文档转换/AI识别
    "memory":[advanced_research,recall_conversation],#本地知识库精确检索/历史对话回忆
    "finance":[query_stock_financials,query_stock_kline,query_realtime_quotes,list_data_sources],#金融数据源：A股财报/行情K线/实时行情/自定义数据源
}

#全部工具，供 ToolNode 执行端使用（执行端持全量不耗上下文，上下文开销只在 bind_tools 一侧）
#use_skill 是常驻技能工具：LLM 侧由 loop.py 常驻绑定，这里登记执行端供 ToolNode 解析
full_tools = [t for tools in toolsets.values() for t in tools] + [use_skill]
