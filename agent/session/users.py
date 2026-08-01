import hashlib
import base64
import logging
import os
import secrets

from .db import get_connection, init_db

logger = logging.getLogger(__name__)

init_db()  #确保 users/tokens 表存在

_TOKEN_TTL_DAYS = 30#token 有效期（天）
_PBKDF2_ROUNDS = 100_000#密码哈希迭代次数


def _hash_password(password: str, salt: str | None = None) -> str:
    #pbkdf2 哈希密码，返回 "salt$hash"；不传 salt 时随机生成
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), _PBKDF2_ROUNDS)
    return f"{salt}${digest.hex()}"


def register(email: str, password: str, display_name: str = "") -> int:
    #注册新用户，返回 user_id；邮箱已注册时抛 ValueError；display_name 为空时取邮箱前缀
    display_name = display_name.strip() or email.split("@", 1)[0]
    with get_connection() as conn:
        if conn.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
            raise ValueError("该邮箱已注册")
        cursor = conn.execute(
            "INSERT INTO users (email, display_name, password_hash) VALUES (?,?,?)",
            (email, display_name, _hash_password(password))
        )
        return cursor.lastrowid  # type: ignore


def verify_login(email: str, password: str) -> int | None:
    #校验邮箱密码，成功返回 user_id，失败返回 None
    with get_connection() as conn:
        row = conn.execute("SELECT id, password_hash FROM users WHERE email=?", (email,)).fetchone()
    if row is None:
        return None
    salt = row["password_hash"].split("$", 1)[0]
    if secrets.compare_digest(_hash_password(password, salt), row["password_hash"]):
        return row["id"]
    return None


def get_user(user_id: int) -> dict | None:
    #按 id 取用户信息（不含密码哈希），附带头像 data URL 供前端直接渲染
    with get_connection() as conn:
        row = conn.execute("SELECT id, email, display_name, created_at FROM users WHERE id=?", (user_id,)).fetchone()
    if row is None:
        return None
    user = dict(row)
    user["avatar_data_url"] = avatar_data_url(user_id)
    return user


#头像存储：图片字节直接以 BLOB 形式入库（随 sessions.db 一起持久化/备份，
#Docker 部署时该库已挂卷，容器重建不丢；头像为 320x320 PNG，体积很小）
_AVATAR_MAX_BYTES = 2 * 1024 * 1024


def update_avatar(user_id: int, data: bytes | None, mime: str = "image/png") -> None:
    #保存/替换头像（data 为 None 时清空头像）
    with get_connection() as conn:
        conn.execute(
            "UPDATE users SET avatar=?, avatar_mime=? WHERE id=?",
            (data, mime if data else "", user_id)
        )


def get_avatar(user_id: int) -> tuple[bytes, str] | None:
    #返回 (图片字节, mime)，未设置头像返回 None
    with get_connection() as conn:
        row = conn.execute(
            "SELECT avatar, avatar_mime FROM users WHERE id=?", (user_id,)
        ).fetchone()
    if row is None or row["avatar"] is None:
        return None
    return row["avatar"], row["avatar_mime"] or "image/png"


def avatar_data_url(user_id: int) -> str | None:
    #头像的 base64 data URL（供 /auth/me 与上传响应直接返回）
    avatar = get_avatar(user_id)
    if avatar is None:
        return None
    data, mime = avatar
    return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"


def issue_token(user_id: int) -> str:
    #签发一个登录 token，有效期 30 天
    token = secrets.token_hex(32)
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO tokens (token, user_id, expires_at) VALUES (?,?,datetime('now','localtime',?))",
            (token, user_id, f"+{_TOKEN_TTL_DAYS} days")
        )
    return token


def resolve_token(token: str) -> int | None:
    #解析 token 返回 user_id，不存在或已过期返回 None
    with get_connection() as conn:
        row = conn.execute(
            "SELECT user_id FROM tokens WHERE token=? AND expires_at > datetime('now','localtime')",
            (token,)
        ).fetchone()
    return row["user_id"] if row else None


def revoke_token(token: str) -> None:
    #撤销 token（登出）
    with get_connection() as conn:
        conn.execute("DELETE FROM tokens WHERE token=?", (token,))


def ensure_admin() -> int:
    #确保预置 admin 用户存在并返回其 id；同时把存量无归属数据（user_id 为 NULL）回填给 admin。
    #邮箱/密码可用环境变量 FS_ADMIN_EMAIL、FS_ADMIN_PASSWORD 配置；
    #历史默认邮箱 admin@local、admin@factshield.local 均被邮箱校验拒绝（无点号/保留域名），自动升级
    email = os.getenv("FS_ADMIN_EMAIL", "admin@factshield.dev")
    with get_connection() as conn:
        row = conn.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()
        if row:
            admin_id = row["id"]
        else:
            legacy = conn.execute(
                "SELECT id FROM users WHERE email IN ('admin@local','admin@factshield.local')"
            ).fetchone()
            if legacy:
                conn.execute("UPDATE users SET email=? WHERE id=?", (email, legacy["id"]))
                admin_id = legacy["id"]
                logger.info("已将旧默认 admin 邮箱升级为 %s", email)
            else:
                password = os.getenv("FS_ADMIN_PASSWORD", "admin123")
                cursor = conn.execute(
                    "INSERT INTO users (email, password_hash) VALUES (?,?)",
                    (email, _hash_password(password))
                )
                admin_id = cursor.lastrowid
                logger.warning("已创建默认 admin 用户 %s（密码来自 FS_ADMIN_PASSWORD 或缺省值），请尽快修改", email)
        conn.execute("UPDATE sessions SET user_id=? WHERE user_id IS NULL", (admin_id,))
        conn.execute("UPDATE profile_facts SET user_id=? WHERE user_id IS NULL", (admin_id,))
    return admin_id  # type: ignore
