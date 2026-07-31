from .. import config as env_config
from ..searchengine import ENGINES
from .crypto import decrypt, encrypt
from .db import get_connection, init_db

init_db()  #确保 user_search_settings 表存在

#缺省引擎：未配置 TAVILY_API_KEY 时默认免 key 的 python 引擎，保证零 .env 部署开箱可用；
#用户在设置页保存过选择（含 Tavily key）后以用户配置为准
DEFAULT_ENGINE = "tavily" if env_config.TAVILY_API_KEY else "python"


def get_engine(user_id: int) -> str:
    #读取用户选择的搜索引擎，未选择时返回缺省引擎
    return get_search_config(user_id)["engine"]


def get_search_config(user_id: int) -> dict:
    #用户搜索引擎配置：{engine, api_key}
    #api_key 优先用户在前端保存的 Tavily key（解密），未保存时回退 .env 的 TAVILY_API_KEY；
    #engine 未选择时按服务端是否配置 key 决定缺省（tavily / python）
    api_key = ""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT engine, api_key_enc FROM user_search_settings WHERE user_id=?", (user_id,)
        ).fetchone()
    engine = row["engine"] if row else DEFAULT_ENGINE
    if row and row["api_key_enc"]:
        try:
            api_key = decrypt(row["api_key_enc"])
        except Exception:  # noqa: BLE001 master key 变更等：按未配置处理，由调用方提示重新填写
            api_key = ""
    return {"engine": engine, "api_key": api_key or (env_config.TAVILY_API_KEY or "")}


def tavily_configured(user_id: int) -> bool:
    #当前用户的 Tavily 是否可用（用户 key 或服务端 .env key 任一存在）
    return bool(get_search_config(user_id)["api_key"])


def _mask(api_key: str) -> str:
    #key 掩码：前3...+尾4，过短则全掩（与模型配置的掩码口径一致）
    return f"{api_key[:3]}...{api_key[-4:]}" if len(api_key) > 7 else "***"


def save_search_config(user_id: int, engine: str, api_key: str | None = None) -> dict:
    #保存用户搜索引擎配置：engine 必填；api_key 传空/掩码（前端回传）时保留库中原 key，
    #传真实 key 时加密入库（支持在前端直接配置 Tavily API）
    if engine not in ENGINES:
        raise ValueError(f"无效的搜索引擎: {engine}，可选: {ENGINES}")
    with get_connection() as conn:
        row = conn.execute(
            "SELECT api_key_enc FROM user_search_settings WHERE user_id=?", (user_id,)
        ).fetchone()
    key_enc = row["api_key_enc"] if row else ""  #缺省保留原 key
    key = (api_key or "").strip()
    if key:
        stored_key = ""
        if row and row["api_key_enc"]:
            try:
                stored_key = decrypt(row["api_key_enc"])
            except Exception:  # noqa: BLE001 master key 变更：按未配置处理
                stored_key = ""
        if key != "***" and key != _mask(stored_key):
            key_enc = encrypt(key)  #真实新 key：加密入库
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO user_search_settings (user_id, engine, api_key_enc, updated_at)"
            " VALUES (?,?,?,datetime('now','localtime'))"
            " ON CONFLICT(user_id) DO UPDATE SET"
            " engine=excluded.engine, api_key_enc=excluded.api_key_enc,"
            " updated_at=excluded.updated_at",
            (user_id, engine, key_enc)
        )
    return get_search_config(user_id)


def set_engine(user_id: int, engine: str) -> None:
    #兼容旧调用：仅切换引擎，保留原 key（存在则原样）
    save_search_config(user_id, engine)
