from fastapi import HTTPException


def not_implemented(feature: str) -> HTTPException:
    #Agent 端尚未支撑的功能，统一返回 501；路由和 schema 已预留，待 Agent 端补齐后实现
    return HTTPException(
        status_code=501,
        detail={
            "detail": "not_implemented",
            "message": f"{feature} 尚未实现，接口已预留，待 Agent 端支持后开放",
            "planned": True,
        },
    )
