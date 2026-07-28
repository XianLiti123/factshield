from .terminal import execute_command
from .webresearch import web_search,web_extract
from .convert import convert_document,ai_recognize_document
from .download import download_file
from .advanced_research import advanced_research

#全部工具，新增工具时在此登记；以后给 subagent 配不同工具集时可另建列表
full_tools = [execute_command,web_search,web_extract,convert_document,ai_recognize_document,download_file,advanced_research]
