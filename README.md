# FactShield

#### 介绍
{**以下是 Gitee 平台说明，您可以替换此简介**
Gitee 是 OSCHINA 推出的基于 Git 的代码托管平台（同时支持 SVN）。专为开发者提供稳定、高效、安全的云端软件开发协作平台
无论是个人、团队、或是企业，都能够用 Gitee 实现代码托管、项目管理、协作开发。企业项目请看 [https://gitee.com/enterprises](https://gitee.com/enterprises)}

#### 软件架构
##### agent层
agent/
├── core/           ← 引擎层（Agent 循环 / 图执行引擎）
│   ├── loop.py     ← 主循环
│   └── runner.py   ← 任务执行器
├── state/          ← 状态管理
│   ├── base.py     ← 状态基类
│   └── reducer.py  ← 合并策略
├── tools/          ← 工具层（扁平，每个文件一个工具）
│   ├── web_search.py
│   └── terminal.py
├── llm/            ← LLM 调用层
│   └── client.py   ← 封装 OpenAI / Anthropic 等
├── memory/         ← 记忆层
│   └── store.py
├── agent.py        ← 对外入口（用户只 import 这个）
└── config.py       ← 配置

##### UI层
UI/

#### 安装教程

1.  安装 Python 依赖：`pip install -r requirements.txt`
2.  在项目根目录创建 `.env` 文件，配置以下环境变量：

    **必填：**
    ```
    DEEPSEEK-API-KEY=sk-xxx        # DeepSeek 大模型的 API key（注意变量名中是连字符）
    TAVILY_API_KEY=tvly-xxx        # Tavily 联网搜索的 API key
    ```

    **可选（配置后启用 AI 高精度识别图片/扫描版 PDF 功能）：**
    ```
    VISION_API_KEY=sk-xxx          # 视觉模型的 API key
    VISION_BASE_URL=https://...    # 视觉模型的 OpenAI 兼容接口地址
    VISION_MODEL=qwen-vl-max       # 视觉模型名称
    ```
    视觉模型可使用任意 OpenAI 兼容的多模态服务（如通义千问 qwen-vl、智谱 glm-4v、OpenAI gpt-4o 等）；不配置时其他功能不受影响。

    **可选（全局数据源与检索增强，均由运维在 .env 统一管理，前端页面只显示是否已配置）：**
    ```
    TICKFLOW_API_KEY=tf-xxx        # TickFlow 行情数据 key；不配置时退化为免费档（仅历史日K/标的信息）
    EMBEDDING_API_KEY=sk-xxx       # Embedding 模型（配置后文档写入向量库）
    EMBEDDING_BASE_URL=https://...
    EMBEDDING_MODEL=text-embedding-v3
    RERANKER_API_KEY=sk-xxx        # Reranker 模型（配置后向量检索结果精排）
    RERANKER_BASE_URL=https://...
    RERANKER_MODEL=bge-reranker-v2-m3
    FS_MASTER_KEY=xxxx             # 加密 master key（见下方 Docker 部署说明）
    ```
    efinance 为爬虫库无需 key；搜索引擎中 Python 检索无需 key，Tavily 用上面的 TAVILY_API_KEY。

#### Docker 部署（Linux 服务器）

后端提供根目录 `Dockerfile`（前端 ui/ 另行构建部署，不在镜像内）：

1.  构建镜像：`docker build -t factshield-api .`
2.  运行（密钥一律经环境变量注入，不要把 `.env` 打入镜像）：
    ```
    docker run -d --name factshield-api -p 8000:8000 \
      -e "DEEPSEEK-API-KEY=sk-xxx" \
      -e "TAVILY_API_KEY=tvly-xxx" \
      -e "TICKFLOW_API_KEY=tf-xxx" \
      -e "FS_MASTER_KEY=< Fernet key >" \
      -v factshield-session:/app/agent/session \
      -v factshield-memory:/app/agent/memory \
      factshield-api
    ```
    也可 `docker compose up -d`（compose 会读取根目录 `.env`，仅存在于服务器上，不进镜像）。

3.  **密钥与数据持久化（重点）：**
    - 用户在设置页保存的模型配置（api_key）用 Fernet 加密后存 SQLite，解密依赖 master key。
    - 生产环境建议显式注入 `FS_MASTER_KEY`（可用 `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` 生成）；
      不注入时系统会自动生成一把写入 `agent/session/.master_key`，只要按上面挂了 `factshield-session` 卷，重建容器后仍可解开存量密文。
    - `agent/session`（账号、会话、加密的模型配置、master key）与 `agent/memory`（知识库、向量库）必须挂卷持久化，否则重建容器后数据丢失。
    - 上述 `.env` 中的全局 key（TickFlow/Tavily/Embedding/Reranker 等）改完后重启容器即生效；前端设置页只展示这些能力的就绪状态，不提供编辑入口。

#### 使用说明

1.  xxxx
2.  xxxx
3.  xxxx

#### 参与贡献

1.  Fork 本仓库
2.  新建 Feat_xxx 分支
3.  提交代码
4.  新建 Pull Request


#### 特技

1.  使用 Readme\_XXX.md 来支持不同的语言，例如 Readme\_en.md, Readme\_zh.md
2.  Gitee 官方博客 [blog.gitee.com](https://blog.gitee.com)
3.  你可以 [https://gitee.com/explore](https://gitee.com/explore) 这个地址来了解 Gitee 上的优秀开源项目
4.  [GVP](https://gitee.com/gvp) 全称是 Gitee 最有价值开源项目，是综合评定出的优秀开源项目
5.  Gitee 官方提供的使用手册 [https://gitee.com/help](https://gitee.com/help)
6.  Gitee 封面人物是一档用来展示 Gitee 会员风采的栏目 [https://gitee.com/gitee-stars/](https://gitee.com/gitee-stars/)
