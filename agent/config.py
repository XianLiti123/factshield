import os
from dotenv import load_dotenv

load_dotenv()

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK-API-KEY")
DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEEPSEEK_MODEL = "deepseek-v4-flash"

TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")


if not DEEPSEEK_API_KEY:
    raise ValueError("API key为空，请配置API key")

if not TAVILY_API_KEY:
    raise ValueError("Tavily API key为空，请在.env中配置TAVILY_API_KEY")

# TavilySearch 从环境变量 TAVILY_API_KEY 读取key，这里显式连接
os.environ["TAVILY_API_KEY"] = TAVILY_API_KEY