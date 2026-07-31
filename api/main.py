import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers.auth import router as auth_router
from .routers.capabilities import router as capabilities_router
from .routers.chat import router as chat_router
from .routers.datasources import router as datasources_router
from .routers.documents import router as documents_router
from .routers.knowledge import router as knowledge_router
from .routers.sessions import router as sessions_router
from .routers.settings import router as settings_router
from .routers.tasks import router as tasks_router

app = FastAPI(title="FactShield Agent API")

#开发阶段放开跨域，方便前端联调
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Session-Id"],
)

for router in (
    chat_router,
    sessions_router,
    capabilities_router,
    knowledge_router,
    documents_router,
    tasks_router,
    settings_router,
    datasources_router,
    auth_router,
):
    app.include_router(router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run("api.main:app", host="0.0.0.0", port=8000)
