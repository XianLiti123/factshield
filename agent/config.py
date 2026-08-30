import os
from dotenv import load_dotenv

#所有配置均为可选：用户未配置 .env 时服务照常启动，模型/密钥可在前端设置页逐用户配置。
#.env 文件不存在（如 Docker 容器内仅经环境变量注入）也完全兼容。

load_dotenv()

# DeepSeek（默认 LLM 供应商）：
# 兼容两种环境变量拼写——标准下划线 DEEPSEEK_API_KEY，以及历史遗留的连字符 DEEPSEEK-API-KEY
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY") or os.getenv("DEEPSEEK-API-KEY")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL") or "https://api.deepseek.com"
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL") or "deepseek-v4-flash"

TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")

# 视觉模型（可选）：配置后 markitdown 转换时会用 AI 描述图片内容
VISION_API_KEY = os.getenv("VISION_API_KEY")
VISION_BASE_URL = os.getenv("VISION_BASE_URL")
VISION_MODEL = os.getenv("VISION_MODEL")

# Embedding 模型（可选）：配置后文档会写入 Chroma 向量库
EMBEDDING_API_KEY = os.getenv("EMBEDDING_API_KEY")
EMBEDDING_BASE_URL = os.getenv("EMBEDDING_BASE_URL")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL")

# Reranker 模型（可选）：配置后向量检索结果会经 reranker 精排
RERANKER_API_KEY = os.getenv("RERANKER_API_KEY")
RERANKER_BASE_URL = os.getenv("RERANKER_BASE_URL")
RERANKER_MODEL = os.getenv("RERANKER_MODEL")

# TickFlow 行情数据 API（可选）：不配置时用免费服务（仅历史日K与标的信息）
TICKFLOW_API_KEY = os.getenv("TICKFLOW_API_KEY")


if TAVILY_API_KEY:
    # TavilySearch 从环境变量 TAVILY_API_KEY 读取key，这里显式连接
    os.environ["TAVILY_API_KEY"] = TAVILY_API_KEY
