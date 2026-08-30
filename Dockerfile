# FactShield 整体镜像（前端构建 + FastAPI 后端 + Agent 引擎）
# 构建：docker build -t factshield-api .
# 运行见 README.md「Docker 部署」一节

# ---- 阶段一：构建前端静态产物（pnpm 11 依赖 node:sqlite，需 Node 22+） ----
FROM node:22-alpine AS ui-build
WORKDIR /ui
# 国内构建：corepack 下载 pnpm 本体与 pnpm 拉依赖都走阿里 npmmirror（corepack 默认硬编码 npmjs.org）
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
ENV npm_config_registry=https://registry.npmmirror.com
COPY ui/package.json ui/pnpm-lock.yaml ui/pnpm-workspace.yaml ./
# NPM_REGISTRY 构建参数可指定 npm 镜像（默认阿里 npmmirror，国内构建开箱可用）
ARG NPM_REGISTRY="https://registry.npmmirror.com"
RUN corepack enable && pnpm install --frozen-lockfile ${NPM_REGISTRY:+--registry=$NPM_REGISTRY}
COPY ui ./
RUN pnpm build

# ---- 阶段二：后端运行环境（FastAPI + Agent，托管前端产物） ----
FROM python:3.13-slim

WORKDIR /app

# 先装依赖，利用镜像层缓存；PIP_INDEX_URL 构建参数可指定 PyPI 镜像（默认阿里云）
ARG PIP_INDEX_URL="https://mirrors.aliyun.com/pypi/simple/"
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt ${PIP_INDEX_URL:+--index-url $PIP_INDEX_URL}

COPY agent ./agent
COPY api ./api
COPY --from=ui-build /ui/dist ./ui/dist

# 本地数据种子：把本机 agent/session、agent/memory、agent/workspace 的一致性快照
# 打进镜像，首次启动（或挂空卷）时由 entrypoint.sh 灌入运行目录，实现“云端与本地完全一样”；
# 之后云上产生的数据独立持久化，不会被种子覆盖。生成快照：python deploy/snapshot_seed.py
COPY deploy/seed ./seed
COPY deploy/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# 运行期数据（会话库/检查点/向量库/master key）落在以下目录，容器外应挂卷持久化：
#   /app/agent/session   /app/agent/memory   /app/agent/workspace
EXPOSE 8000

# 全局密钥一律经环境变量注入（见 README），不要使用 .env 文件打入镜像
# 单容器同时提供：前端页面 /、API /api/*（根路径 /* 同样可用）、Agent 能力内嵌于后端进程
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
