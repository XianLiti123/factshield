from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .routers.auth import router as auth_router
from .routers.capabilities import router as capabilities_router
from .routers.chat import router as chat_router
from .routers.datasources import router as datasources_router
from .routers.documents import router as documents_router
from .routers.knowledge import router as knowledge_router
from .routers.sessions import router as sessions_router
from .routers.settings import router as settings_router
from .routers.tasks import router as tasks_router

_routers = (
    chat_router,
    sessions_router,
    capabilities_router,
    knowledge_router,
    documents_router,
    tasks_router,
    settings_router,
    datasources_router,
    auth_router,
)

app = FastAPI(title="FactShield Agent API")

#开发阶段放开跨域，方便前端联调
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Session-Id"],
)

for router in _routers:
    app.include_router(router)  #根路径直连（开发时 vite 代理会把 /api 剥掉后打到这里）


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


#前端编译产物固定请求 /api/*：把同一套路由挂到 /api 前缀下，生产单容器部署时无需反向代理
_api_alias = FastAPI(title="FactShield Agent API (/api alias)")
for router in _routers:
    _api_alias.include_router(router)


@_api_alias.get("/health")
def health_alias() -> dict[str, str]:
    return {"status": "ok"}


app.mount("/api", _api_alias)

#整体打包：镜像内带前端构建产物时直接由本服务托管（无前端路由，html=True 即可）
_ui_dist = Path(__file__).resolve().parent.parent / "ui" / "dist"
if _ui_dist.is_dir():
    app.mount("/", StaticFiles(directory=_ui_dist, html=True), name="ui")

if __name__ == "__main__":
    uvicorn.run("api.main:app", host="0.0.0.0", port=8000)
