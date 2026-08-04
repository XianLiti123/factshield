# FactShield · 事实核查研究平台

> AI 驱动的多智能体事实核查研究系统：给定一个研究主题，自动完成联网采集、事实主张提取、证据检索、双重核验、独立审查与底稿生成，每一步都有原文依据、可回查、可审计、可人工介入。

## 核心特性

- **多智能体研究流水线**：主控拆解 → 信源采集 → 主张提取 → 证据检索 → 信源打分 → 一级核验 → 独立幻觉审查 → 底稿组装；各子智能体相互隔离，只消费本环节的输入、产出结构化结果交回主控
- **双重核验 + 自动二次取证**：主控对每条主张做第一轮判断，独立幻觉审查员再做交叉复核；遇到数据矛盾或证据缺失时自动发起二次取证，重检索、再比对、再复核
- **人工复核工作台**：疑点逐条处理（保留注明 / 改写 / 排除 / 不采纳），每条主张都绑定可回查的原文证据、来源可信度与双层核验记录
- **研究动态实时播报**：后端以 SSE 推送执行进展（检索了什么、打开了哪些来源、判断依据是什么），事件持久化落库；退出页面再进入时自动回放，不丢历史记录
- **子智能体执行监控**：查看每个智能体的执行过程、工具调用轨迹与真实耗时，定位问题环节
- **历史情景时序统计**：对关注的指标做客观时序统计（月度 / 季度 / 年度），产出结构化数据点供前端绘图，可选并入底稿
- **底稿导出**：研究底稿一键导出 Markdown / PDF / Word
- **全链路审计**：事件时间线、工具调用轨迹、人工裁决记录全程留痕
- **任务专属对话与中途指导**：随时向 Supervisor 提问，或在任务执行中提交调整指令，流水线在下一个核验点读取并执行
- **通用 Agent 对话**：联网搜索、终端、金融数据、文档转换、记忆检索等工具集，会话持久化、上下文自动压缩、支持暂停 / 恢复 / 中止
- **Agent 技能系统**：技能以 `agent/skills/<skill_id>/SKILL.md`（可附 `run.py`）形式存放，Agent 自主判断并调用 `use_skill` 工具，用户无需手动触发；技能文件改动自动热重载
- **知识库**：Markdown 文档入库（Chroma 向量库 + SQLite 元数据），BM25 + 向量 + Reranker 混合检索
- **数据源与金融数据**：用户自定义数据源列表；TickFlow 行情（未配置时退化为免费档：历史日 K 与标的信息），efinance 爬虫库内置可用
- **多用户与安全**：注册 / 登录 / Token、头像、显示名、密码管理；模型密钥经 Fernet 加密后入库；任务与数据按用户隔离

## 技术栈

| 层 | 技术 |
| --- | --- |
| 后端 | Python 3.13 · FastAPI · Uvicorn · LangGraph · LangChain · ChromaDB · SQLite |
| 前端 | React 19 · TypeScript · Vite 7 · pnpm · Ant Design 5 · ECharts · TanStack Query · Zustand |
| 部署 | Docker 多阶段构建（node:22-alpine 编译前端 + python:3.13-slim 运行后端），单容器同时托管页面与 API |

## 系统架构

```
浏览器 UI (React, ui/)
   │  /api/* （开发时由 Vite 代理转发；生产环境由后端同容器托管）
   ▼
FastAPI (api/) —— 鉴权 / 研究任务 / SSE 播报 / 设置 / 知识库 / 数据源 / 会话 / 错误修复
   ▼
Agent 引擎 (agent/)
   ├── research/   事实核查流水线（pipeline · runner · store · history · export · trace）
  ├── core/       通用 Agent 循环 / 上下文压缩 / 提示词组装
  ├── llm/        OpenAI 兼容客户端 / Responses API（含原生服务端搜索）
  ├── memory/     知识库（SQLite 元数据 + Chroma 向量库 + Reranker 精排）
  ├── prompts.py  # 全部 Agent 提示词的唯一存放文件（开发修改提示词只改这里）
  ├── session/    账号 / 会话 / 模型配置 / 数据源（sessions.db，按用户隔离）
  ├── skills/     技能系统：SKILL.md（+ 可选 run.py），Agent 自主调用
  └── tools/      联网搜索 / 终端 / 金融数据 / 文档转换 / 记忆 / 子智能体调用
```

### 技能系统

Agent 常驻 `use_skill` 工具，启动时扫描 `agent/skills/` 下的技能目录并把“名称 + 描述”注入系统提示词，由 Agent 自主决定何时调用哪个技能（用户不需要手动触发）。

每个技能目录包含：

```text
agent/skills/<skill_id>/
  SKILL.md   # 必填：frontmatter（name/description/version/timeout）+ 操作说明
  run.py     # 可选：可执行型技能，从 stdin 读取 {"task": "..."} 并打印结果
  assets/    # 可选：技能附带资源
```

纯指令型技能由 `use_skill` 返回操作说明，Agent 再使用已有工具按步骤执行；可执行型技能由 `use_skill` 子进程隔离运行并带超时。自检/冒烟脚本：

```bash
conda run -n suanfa_learning python -m agent.skills.check
conda run -n suanfa_learning python -m agent.skills.smoke
conda run -n suanfa_learning python -m agent.skills.e2e   # 需已配置模型，验证 Agent 自主调用技能
```

技能列表只读接口：`GET /api/skills`（需登录）。

### 事实核查流水线

```
plan(任务拆解) → collect(信源采集) → parse(主张提取) → retrieve(证据检索)
→ score(信源打分) → verify(一级核验，冲突时回 collect 二次取证)
→ review(独立幻觉审查) → assemble(底稿组装)
```

对应子智能体：主控（Supervisor）、采集员、定向深挖员、解析员、检索员、信源打分员、独立幻觉审查员、底稿拼装员，另有研究员（人工介入）与历史情景统计员。

## 目录结构

```
agent/               # Agent 引擎
  core/              #   通用 Agent 循环、上下文压缩、提示词
  llm/               #   LLM 客户端（OpenAI 兼容 / Responses API）
  research/          #   事实核查流水线：pipeline / runner / store / history / export / trace
  memory/            #   知识库：SQLite + Chroma + Reranker 混合检索
  session/           #   账号、会话、模型配置、数据源（sessions.db）
  tools/             #   工具集：联网搜索、终端、金融、文档转换、记忆等
api/                 # FastAPI 后端
  routers/           #   auth / tasks / chat / settings / knowledge / datasources / sessions / errors ...
  schemas/           #   Pydantic 模型
  utils/             #   SSE 等公共工具
ui/                  # React 前端（Vite + Ant Design + ECharts）
  src/components/    #   任务中心 / 工作台 / 执行监控 / 分析 / 报告 / 设置 ...
deploy/              # Docker 相关：entrypoint.sh、snapshot_seed.py、seed（本地数据快照）
Dockerfile           # 多阶段构建单镜像
docker-compose.yml   # 单服务编排，含三个持久化卷
```

## 快速开始（本地开发）

### 环境要求

- Python 3.10+（推荐 3.13）
- Node.js 20.19+（推荐 22）、pnpm 9+（项目锁定 pnpm@11.9.0）

### 1. 安装后端依赖

```bash
pip install -r requirements.txt
```

### 2. 配置环境变量

在根目录创建 `.env`，至少配置 LLM 与联网搜索密钥，否则无法创建研究任务：

```env
DEEPSEEK_API_KEY=sk-xxx        # DeepSeek 大模型密钥（历史写法 DEEPSEEK-API-KEY 同样兼容）
TAVILY_API_KEY=tvly-xxx        # Tavily 联网搜索密钥（也可在前端设置页按用户配置）
```

所有密钥均为可选：未配置时服务照常启动，用户可在前端设置页逐账号配置模型；不配置 Tavily 时内置 Python 搜索引擎仍可用。

### 3. 启动后端

```bash
python -m api.main
```

后端监听 `http://127.0.0.1:8000`，接口文档见 `http://127.0.0.1:8000/docs`。

### 4. 启动前端

```bash
cd ui
pnpm install
pnpm dev
```

前端开发服务器监听 `http://127.0.0.1:5173`，已配置 `/api` 代理转发到 8000 端口。

### 一键启动（Windows）

直接双击 `start-ui.bat`：自动检测 Python 环境（`FS_PYTHON` → conda → 虚拟环境 → PATH）、安装前端依赖、启动 API 并等待健康检查通过后打开前端页面。

### CLI 聊天模式

不想开网页时，可用命令行直接和 Agent 对话：

```bash
python -m agent.agent
```

### 默认管理员账号

首次启动自动创建管理员：`admin@factshield.dev` / `admin123`，可通过环境变量 `FS_ADMIN_EMAIL`、`FS_ADMIN_PASSWORD` 覆盖。

## 环境变量

以下变量统一在根目录 `.env` 管理（Docker 部署时经环境变量注入，不写入镜像）：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY`（或 `DEEPSEEK-API-KEY`） | 推荐 | 默认 LLM 供应商密钥 |
| `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` | 否 | 默认分别为 `https://api.deepseek.com` 与 `deepseek-v4-flash` |
| `TAVILY_API_KEY` | 否 | Tavily 联网搜索；未配置时退化为 Python 内置搜索 |
| `VISION_API_KEY` / `VISION_BASE_URL` / `VISION_MODEL` | 否 | 视觉模型（OpenAI 兼容），配置后支持图片 / 扫描版 PDF 的 AI 识别 |
| `EMBEDDING_API_KEY` / `EMBEDDING_BASE_URL` / `EMBEDDING_MODEL` | 否 | Embedding 模型，配置后文档写入向量库 |
| `RERANKER_API_KEY` / `RERANKER_BASE_URL` / `RERANKER_MODEL` | 否 | Reranker 模型，配置后向量检索结果精排 |
| `TICKFLOW_API_KEY` | 否 | TickFlow 行情数据；未配置时用免费档 |
| `FS_MASTER_KEY` | 否 | Fernet master key（32 字节 urlsafe-base64），用于加密模型密钥；不配置则自动生成并随数据卷持久化 |
| `FS_ADMIN_EMAIL` / `FS_ADMIN_PASSWORD` | 否 | 覆盖默认管理员账号 |

## Docker 部署（Linux x86_64）

根目录 `Dockerfile` 为多阶段构建的单容器镜像：前端（`ui/`）编译进镜像，由 FastAPI 一并托管（`/` 为前端页面，`/api/*` 为后端接口），无需额外部署 nginx。构建默认使用国内镜像源（npm 走 npmmirror、pip 走阿里云），国内网络开箱可用。

### 构建

```bash
docker build -t factshield-api .
# 可覆盖镜像源：
# docker build -t factshield-api --build-arg NPM_REGISTRY=https://registry.npmmirror.com --build-arg PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/ .
```

### 运行

```bash
docker run -d --name factshield-api -p 8000:8000 \
  -e "DEEPSEEK_API_KEY=sk-xxx" \
  -e "TAVILY_API_KEY=tvly-xxx" \
  -e "FS_MASTER_KEY=<Fernet key>" \
  -v factshield-session:/app/agent/session \
  -v factshield-memory:/app/agent/memory \
  -v factshield-workspace:/app/agent/workspace \
  factshield-api
```

或使用 compose（自动读取根目录 `.env` 注入密钥，`.env` 不会打进镜像）：

```bash
docker compose up -d --build
```

### 导出 / 导入镜像（迁移到另一台 Linux x86 机器）

```bash
# 源机导出
docker save -o factshield-api.tar factshield-api
# 目标机导入
docker load < factshield-api.tar
docker compose up -d   # 或按上面的 docker run 命令启动
```

### 数据与持久化（重点）

- `agent/session`：账号、会话、加密的模型配置、master key
- `agent/memory`：知识库、向量库（Chroma）
- `agent/workspace`：上传附件、工具下载的文件

这三个目录都必须挂卷持久化，否则重建容器后账号、知识库与附件会丢失。

镜像内置一份“本地数据快照”（`deploy/seed`）：首次启动（或挂空卷）时由 `entrypoint.sh` 灌入运行目录，实现云端与本机完全一致；之后云端数据独立持久化，不会被种子覆盖。本机数据有更新后，可在源码目录重新生成快照并重建镜像：

```bash
python deploy/snapshot_seed.py
docker build -t factshield-api .
```

### 密钥说明

用户在前端设置页保存的模型配置（api_key）用 Fernet 加密后存 SQLite，解密依赖 master key：

- 生产环境建议显式注入 `FS_MASTER_KEY`：`python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
- 不注入时系统自动生成一把写入 `agent/session/.master_key`，只要挂了 `factshield-session` 卷，重建容器后仍可解开存量密文
- **不要手写非法值**：非 32 字节 urlsafe-base64 的 Fernet key 会导致服务启动时报错

## API 概览

所有接口前缀为 `/api`（根路径下同时挂有 `/api` 别名）。详见 `http://127.0.0.1:8000/docs`。

| 模块 | 主要接口 | 说明 |
| --- | --- | --- |
| Auth | `/auth/register` `/auth/login` `/auth/me` `/auth/password` ... | 注册登录、Token、头像、显示名、改密 |
| Tasks | `/tasks` `/tasks/{id}/events` `/tasks/{id}/stop` `/tasks/{id}/claims/{cid}/resolve` `/tasks/{id}/claims/{cid}/retry` `/tasks/{id}/report` `/tasks/{id}/audit-log` `/tasks/{id}/agents` `/tasks/{id}/history-analysis` ... | 研究任务全生命周期：创建即后台运行、SSE 播报、人工裁决、重新取证、底稿导出、审计、执行监控、历史统计 |
| Chat | `/chat/stream` | 通用 Agent 对话（SSE 流式） |
| Sessions | `/sessions` `/sessions/{id}/history` `/sessions/{id}/compact` ... | 会话历史、上下文压缩、暂停 / 恢复 / 中止 |
| Settings | `/settings` `/settings/{slot}` `/settings/search-engine` `/settings/llm-mode` ... | 模型配置（llm / vision / embedding / reranker）、搜索引擎、LLM 调用模式 |
| Knowledge | `/knowledge/documents` | 知识库文档入库、列表、删除 |
| Data sources | `/data-sources` | 用户自定义数据源列表 |
| Capabilities | `/capabilities` | 各能力是否已配置就绪（只返回布尔值，不泄露密钥） |
| Errors | `/errors` `/errors/{id}/repair` | 流程错误记录与一键修复 |

## 使用说明

1. 注册并登录（或使用默认管理员账号），在 **设置** 页配置模型密钥（DeepSeek 等）；也可由运维在 `.env` 中配置全局能力
2. 在 **研究任务** 页新建研究：填写主题、公司、研究类型与偏好信源，可先上传附件作为材料
3. 任务创建后立即后台运行，打开任务即可看到 **研究动态** 实时播报：拆解、采集、检索、打分、核验、审查、组装每一步都有播报与依据
4. 任务进入复核阶段后，在 **工作台** 逐条处理疑点：对照原文证据，选择保留 / 改写 / 排除 / 不采纳；对证据不足的主张可发起“重新取证”
5. 完成后在 **报告** 页查看研究底稿并导出 Markdown / PDF / Word；在 **审计** 中回看完整事件链；在 **执行监控** 中查看各智能体的执行过程
6. 需要复盘时可发起 **历史情景时序统计**，对指定指标生成图表数据

## 常见问题

- **构建卡在 corepack / pnpm 下载**：镜像已内置 `COREPACK_NPM_REGISTRY=https://registry.npmmirror.com`，走国内镜像；仍卡住先看构建日志是 corepack 还是包下载
- **pydub 报找不到 ffmpeg**：Linux slim 上的已知无害警告，应用不使用音频转换，可忽略
- **`FS_MASTER_KEY 非法`**：必须使用 `Fernet.generate_key()` 生成的合法 32 字节 urlsafe-base64 密钥
- **容器重建后数据丢失**：确认三个目录（session / memory / workspace）都已挂卷
- **任务显示“等待后端写入第一条执行播报”**：事件在任务开始后才会写入，若长时间无播报请检查 LLM / 搜索密钥是否配置，并查看容器日志

## License

[MIT](LICENSE)
