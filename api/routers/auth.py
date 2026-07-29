from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr

from agent.session.users import get_user, issue_token, register, resolve_token, revoke_token, verify_login

router = APIRouter(prefix="/auth", tags=["auth"])

_bearer = HTTPBearer(auto_error=False)


class CredentialsRequest(BaseModel):
    email: EmailStr
    password: str


class UserInfo(BaseModel):
    id: int
    email: str


class TokenResponse(BaseModel):
    token: str
    user: UserInfo


def _issue(user_id: int) -> TokenResponse:
    user = get_user(user_id)
    return TokenResponse(token=issue_token(user_id), user=UserInfo(**user))  # type: ignore


@router.post("/register")
def register_user(request: CredentialsRequest) -> TokenResponse:
    #注册（开放注册），成功即视为登录，直接返回 token
    try:
        user_id = register(request.email, request.password)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return _issue(user_id)


@router.post("/login")
def login(request: CredentialsRequest) -> TokenResponse:
    #登录，成功返回 token（30 天有效）
    user_id = verify_login(request.email, request.password)
    if user_id is None:
        raise HTTPException(status_code=401, detail="邮箱或密码错误")
    return _issue(user_id)


@router.post("/logout")
def logout(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict[str, str]:
    #登出，撤销当前 token
    if credentials is not None:
        revoke_token(credentials.credentials)
    return {"status": "logged_out"}


@router.get("/me")
def me(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> UserInfo:
    #返回当前登录用户信息
    if credentials is None:
        raise HTTPException(status_code=401, detail="未登录")
    user_id = resolve_token(credentials.credentials)
    user = get_user(user_id) if user_id else None
    if user is None:
        raise HTTPException(status_code=401, detail="登录已失效，请重新登录")
    return UserInfo(**user)
