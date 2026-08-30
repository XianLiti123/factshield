from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from agent.session.users import resolve_token

_bearer = HTTPBearer(auto_error=False)


def get_current_user(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> int:
    #从 Authorization: Bearer <token> 解析当前用户，缺失/无效/过期一律 401
    if credentials is None:
        raise HTTPException(status_code=401, detail="未登录")
    user_id = resolve_token(credentials.credentials)
    if user_id is None:
        raise HTTPException(status_code=401, detail="登录已失效，请重新登录")
    return user_id
