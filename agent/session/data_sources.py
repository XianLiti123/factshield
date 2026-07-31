from .crypto import decrypt, encrypt
from .db import get_connection, init_db

init_db()  #确保 user_data_sources 表存在

#自定义数据源连接方式：http（按接口规范发请求）/ python（按 SDK 示例写脚本调用）
MODES = ("http", "python")
MAX_SOURCES = 50


def _row_to_dict(row) -> dict:
    return {
        "id": row["source_id"],
        "name": row["name"],
        "description": row["description"],
        "category": row["category"],
        "mode": row["mode"],
        "specification": decrypt(row["specification_enc"]) if row["specification_enc"] else "",
        "enabled": bool(row["enabled"]),
        "updated_at": row["updated_at"],
    }


def list_sources(user_id: int) -> list[dict]:
    #读取用户全部自定义数据源（specification 解密返回，供前端编辑；属用户本人数据，同 base_url 一样明文回传）
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM user_data_sources WHERE user_id=? ORDER BY updated_at, source_id",
            (user_id,)
        ).fetchall()
    return [_row_to_dict(row) for row in rows]


def get_enabled_sources(user_id: int) -> list[dict]:
    #仅取已启用的数据源，供 agent 工具使用
    return [s for s in list_sources(user_id) if s["enabled"]]


def replace_sources(user_id: int, sources: list[dict]) -> None:
    #整体替换用户的数据源列表（与前端整列表保存的模型一致）；specification 可能含 token 等凭据，加密入库
    if len(sources) > MAX_SOURCES:
        raise ValueError(f"数据源数量超过上限 {MAX_SOURCES}")
    seen = set()
    for s in sources:
        source_id = (s.get("id") or "").strip()
        name = (s.get("name") or "").strip()
        mode = s.get("mode") or "http"
        if not source_id or not name:
            raise ValueError("数据源的 id 和 name 不能为空")
        if source_id in seen:
            raise ValueError(f"数据源 id 重复: {source_id}")
        if mode not in MODES:
            raise ValueError(f"无效的连接方式: {mode}，可选: {MODES}")
        seen.add(source_id)
    with get_connection() as conn:
        conn.execute("DELETE FROM user_data_sources WHERE user_id=?", (user_id,))
        conn.executemany(
            "INSERT INTO user_data_sources"
            " (user_id, source_id, name, description, category, mode, specification_enc, enabled, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?,datetime('now','localtime'))",
            [
                (
                    user_id,
                    s["id"].strip(),
                    s["name"].strip(),
                    s.get("description") or "",
                    s.get("category") or "",
                    s.get("mode") or "http",
                    encrypt(s["specification"]) if s.get("specification") else "",
                    1 if s.get("enabled") else 0,
                )
                for s in sources
            ]
        )
