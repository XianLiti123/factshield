import logging

from .. import config as env_config
from .crypto import decrypt, encrypt
from .db import get_connection, init_db
from .users import ensure_admin

logger = logging.getLogger(__name__)

init_db()  #确保 user_model_configs 表存在

#支持每用户独立配置的模型槽位（embedding/reranker 全局共享，不在此列）
SLOTS = ("llm", "vision")


def save_config(user_id: int, slot: str, base_url: str, api_key: str, model_name: str) -> None:
    #保存用户的模型配置：api_key 加密入库，并失效该用户的 LLM client 缓存
    if slot not in SLOTS:
        raise ValueError(f"无效的模型槽位: {slot}，可选: {SLOTS}")
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO user_model_configs (user_id, slot, base_url, api_key_enc, model_name, updated_at)"
            " VALUES (?,?,?,?,?,datetime('now','localtime'))"
            " ON CONFLICT(user_id, slot) DO UPDATE SET"
            " base_url=excluded.base_url, api_key_enc=excluded.api_key_enc,"
            " model_name=excluded.model_name, updated_at=excluded.updated_at",
            (user_id, slot, base_url, encrypt(api_key), model_name)
        )
    try:
        from ..core.loop import invalidate_llm_cache  #延迟导入，避免循环依赖
        invalidate_llm_cache(user_id)
    except ImportError:
        pass  #loop 模块尚在加载中（如迁移阶段），此时缓存必然为空，跳过即可
    try:
        from ..tools.convert import invalidate_vision_cache  #延迟导入，避免循环依赖
        invalidate_vision_cache(user_id)
    except ImportError:
        pass  #convert 模块尚在加载中，视觉缓存必然为空，跳过即可


def _safe_decrypt(cipher: str) -> str | None:
    #解密密文字符串；master key 变更或密文损坏时返回 None 并给出可诊断日志（不抛异常打死调用链）
    try:
        return decrypt(cipher)
    except Exception as e:  # noqa: BLE001
        logger.error(
            "api_key 解密失败（FS_MASTER_KEY 变更或密文损坏？），该配置按未配置处理，"
            "请在设置页重新填写模型配置: %s", e
        )
        return None


def get_config(user_id: int, slot: str) -> dict | None:
    #读取用户某槽位的配置并解密 api_key，仅供服务端内部装配使用，严禁经接口外发；
    #解密失败（master key 不匹配）时返回 None，由调用方按"未配置"给出提示
    with get_connection() as conn:
        row = conn.execute(
            "SELECT base_url, api_key_enc, model_name FROM user_model_configs WHERE user_id=? AND slot=?",
            (user_id, slot)
        ).fetchone()
    if row is None:
        return None
    api_key = _safe_decrypt(row["api_key_enc"])
    if api_key is None:
        return None
    return {"base_url": row["base_url"], "api_key": api_key, "model_name": row["model_name"]}


def _mask(api_key: str) -> str:
    #key 掩码：前3...+尾4，过短则全掩
    return f"{api_key[:3]}...{api_key[-4:]}" if len(api_key) > 7 else "***"


def get_masked_configs(user_id: int) -> dict[str, dict]:
    #api 用：返回当前用户各槽位配置，api_key 一律掩码
    result = {}
    for slot in SLOTS:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT base_url, api_key_enc, model_name, updated_at FROM user_model_configs WHERE user_id=? AND slot=?",
                (user_id, slot)
            ).fetchone()
        if row:
            result[slot] = {
                "base_url": row["base_url"],
                "api_key": _mask(_safe_decrypt(row["api_key_enc"]) or ""),  #解密失败显示 ***
                "model_name": row["model_name"],
                "updated_at": row["updated_at"],
            }
    return result


def _migrate_env_configs() -> None:
    #迁移：admin 无配置且 .env 有对应模型配置时，自动灌给 admin（保证 CLI 与存量行为不破）
    admin_id = ensure_admin()
    if env_config.DEEPSEEK_API_KEY and get_config(admin_id, "llm") is None:
        save_config(admin_id, "llm", env_config.DEEPSEEK_BASE_URL,
                    env_config.DEEPSEEK_API_KEY, env_config.DEEPSEEK_MODEL)
        logger.info("已将 .env 的 LLM 配置迁移给 admin 用户")
    if (env_config.VISION_API_KEY and env_config.VISION_BASE_URL and env_config.VISION_MODEL
            and get_config(admin_id, "vision") is None):
        save_config(admin_id, "vision", env_config.VISION_BASE_URL,
                    env_config.VISION_API_KEY, env_config.VISION_MODEL)
        logger.info("已将 .env 的视觉模型配置迁移给 admin 用户")


_migrate_env_configs()
