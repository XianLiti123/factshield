from fastapi import APIRouter
from pydantic import BaseModel

from ..utils.reserved import not_implemented

router = APIRouter(prefix="/auth", tags=["auth"])

#认证接口预留：当前后端无用户体系


class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    email: str
    password: str


@router.post("/login")
def login(request: LoginRequest) -> None:
    raise not_implemented("登录")


@router.post("/register")
def register(request: RegisterRequest) -> None:
    raise not_implemented("注册")
