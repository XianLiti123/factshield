import base64

from fastapi import APIRouter, Depends, HTTPException, Request, Response, UploadFile
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr

from agent.session.users import (
    avatar_data_url, get_avatar, get_user, issue_token, register,
    resolve_token, revoke_token, update_avatar, verify_login,
)

router = APIRouter(prefix="/auth", tags=["auth"])

_bearer = HTTPBearer(auto_error=False)


class CredentialsRequest(BaseModel):
    email: EmailStr
    password: str


class RegisterRequest(CredentialsRequest):
    username: str | None = None  #可选显示名；缺省时后端取邮箱前缀


class UserInfo(BaseModel):
    id: int
    email: str
    display_name: str = ""
    avatar: str | None = None          # 头像 data URL（前端 <img> 直接渲染，无需鉴权请求）
    avatar_url: str | None = None      # 预留：未来可返回公开访问的头像 URL
    avatar_data_url: str | None = None


class TokenResponse(BaseModel):
    token: str
    user: UserInfo


def _issue(user_id: int) -> TokenResponse:
    return TokenResponse(token=issue_token(user_id), user=_user_info(user_id))


def _user_info(user_id: int) -> UserInfo:
    #统一的用户 DTO：头像以 data URL 同时写入 avatar/avatar_data_url（与前端字段对齐），
    #avatar_url 暂留空，等未来提供无需鉴权的公开地址时再填充
    user = get_user(user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="登录已失效，请重新登录")
    data_url = user.get("avatar_data_url")
    user["avatar"] = data_url
    user["avatar_url"] = None
    return UserInfo(**user)  # type: ignore[arg-type]


#头像上传校验：只接受真实图片字节（魔数嗅探），≤2MB；图片以 BLOB 入库
_AVATAR_MAX_BYTES = 2 * 1024 * 1024


def _sniff_image_mime(data: bytes) -> str | None:
    #按文件头识别 png/jpeg/webp，不信任客户端声明的 Content-Type
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(data) > 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _decode_data_url(value: str) -> tuple[bytes, str]:
    #解析 data:image/png;base64,xxxx 形式的头像数据，返回 (图片字节, 声明 mime)
    if not value.startswith("data:"):
        raise HTTPException(status_code=400, detail="头像数据格式无效")
    header, _, b64 = value.partition(",")
    if not b64:
        raise HTTPException(status_code=400, detail="头像数据为空")
    if len(b64) > (_AVATAR_MAX_BYTES * 4 // 3) + 8:
        raise HTTPException(status_code=400, detail="头像文件不能超过 2MB")
    try:
        data = base64.b64decode(b64)
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="头像数据解码失败")
    return data, (header[5:].split(";", 1)[0] or "")


def _require_user(credentials: HTTPAuthorizationCredentials | None) -> int:
    #统一鉴权：未登录/凭证失效一律 401
    if credentials is None:
        raise HTTPException(status_code=401, detail="未登录")
    user_id = resolve_token(credentials.credentials)
    if user_id is None:
        raise HTTPException(status_code=401, detail="登录已失效，请重新登录")
    return user_id


@router.post("/register")
def register_user(request: RegisterRequest) -> TokenResponse:
    #注册（开放注册），成功即视为登录，直接返回 token
    try:
        user_id = register(request.email, request.password, request.username or "")
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
    user_id = _require_user(credentials)
    return _user_info(user_id)


@router.put("/avatar")
async def put_avatar(raw: Request,
                     credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict:
    #上传/替换头像：兼容前端 JSON（{"avatar": data_url}）与标准 multipart（file 字段）两种提交；
    #图片字节以 BLOB 入库，响应携带完整用户信息（前端据此更新全局用户状态）
    user_id = _require_user(credentials)
    content_type = (raw.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
    if content_type == "application/json":
        payload = await raw.json()
        data, _mime = _decode_data_url(str(payload.get("avatar") or ""))
    elif content_type.startswith("multipart/form-data"):
        form = await raw.form()
        file = form.get("file")
        if file is None:
            raise HTTPException(status_code=400, detail="缺少头像文件")
        data = await file.read()
    else:
        raise HTTPException(status_code=400, detail="不支持的提交格式，请使用 JSON 或 multipart")
    if not data:
        raise HTTPException(status_code=400, detail="头像文件为空")
    if len(data) > _AVATAR_MAX_BYTES:
        raise HTTPException(status_code=400, detail="头像文件不能超过 2MB")
    mime = _sniff_image_mime(data)
    if mime is None:
        raise HTTPException(status_code=400, detail="仅支持 PNG/JPEG/WebP 图片")
    update_avatar(user_id, data, mime)
    user = _user_info(user_id).model_dump()
    return {"status": "saved", "user": user, **user}


@router.get("/avatar")
def get_my_avatar(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> Response:
    #返回当前用户头像图片字节（带缓存头；未设置返回 404）
    user_id = _require_user(credentials)
    avatar = get_avatar(user_id)
    if avatar is None:
        raise HTTPException(status_code=404, detail="未设置头像")
    data, mime = avatar
    return Response(content=data, media_type=mime,
                    headers={"Cache-Control": "private, max-age=86400"})


@router.delete("/avatar")
def delete_my_avatar(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict[str, str]:
    #清空头像
    user_id = _require_user(credentials)
    update_avatar(user_id, None)
    return {"status": "deleted"}
