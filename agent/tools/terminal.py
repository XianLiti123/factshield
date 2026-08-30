from langchain_core.tools import tool
import subprocess

@tool
def execute_command(command: str) -> str:
    """在终端执行命令，返回执行结果"""
    result = subprocess.run(command, shell=True, capture_output=True, text=True)
    return result.stdout or result.stderr