from .db import get_connection, init_db

init_db()  #确保 user_context_settings 表存在

#上下文自动整理的触发比例（占窗口的百分比），默认 80%，用户可在设置页自定义
DEFAULT_COMPACT_TRIGGER_PERCENT = 80
MIN_COMPACT_TRIGGER_PERCENT = 10
MAX_COMPACT_TRIGGER_PERCENT = 100


def get_compact_trigger_percent(user_id: int) -> int:
    #读取用户自定义的自动整理触发比例，未设置或值非法时返回默认 80
    with get_connection() as conn:
        row = conn.execute(
            "SELECT compact_trigger_percent FROM user_context_settings WHERE user_id=?",
            (user_id,)
        ).fetchone()
    if row is None:
        return DEFAULT_COMPACT_TRIGGER_PERCENT
    percent = int(row["compact_trigger_percent"])
    if MIN_COMPACT_TRIGGER_PERCENT <= percent <= MAX_COMPACT_TRIGGER_PERCENT:
        return percent
    return DEFAULT_COMPACT_TRIGGER_PERCENT


def save_compact_trigger_percent(user_id: int, percent: int) -> int:
    #保存用户自定义触发比例（10-100%），写库后立即生效；非法范围抛 ValueError
    percent = int(percent)
    if not (MIN_COMPACT_TRIGGER_PERCENT <= percent <= MAX_COMPACT_TRIGGER_PERCENT):
        raise ValueError(f"触发比例需在 {MIN_COMPACT_TRIGGER_PERCENT}-{MAX_COMPACT_TRIGGER_PERCENT}% 之间")
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO user_context_settings (user_id, compact_trigger_percent)"
            " VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET"
            " compact_trigger_percent=excluded.compact_trigger_percent,"
            " updated_at=datetime('now','localtime')",
            (user_id, percent)
        )
    return percent
