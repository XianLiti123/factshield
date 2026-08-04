"""流程错误登记与重试/自动修复机制。

所有 Agent 流程（对话/子代理/研究流水线/重取证/历史统计）执行失败时经
record_error 落库，可自动重启对应流程（自动修复），也可经 API 手动触发修复
（repair_error）。错误记录按 user_id 隔离，通过 /errors 系列接口查询。
状态机：failed(可修复) -> repairing(修复中) -> repaired / repair_failed。
"""

import logging
init_db()

logger = logging.getLogger(__name__)

#错误记录状态机：failed(可修复) -> repairing(修复中) -> repaired/repair_failed
STATUS_FAILED = "failed"
STATUS_REPAIRING = "repairing"
STATUS_REPAIRED = "repaired"
STATUS_REPAIR_FAILED = "repair_failed"

MAX_TRACEBACK_LEN = 4000  #堆栈列长度上限，防日志撑爆


def _cut(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit] + "...(截断)"


def record_error(user_id: int, flow_type: str, flow_id: str, error: str, *,
                 node: str = "", prompt: str = "", traceback: str = "",
                 attempts: int = 1, auto_repair: bool = False) -> int:
    #登记一次流程失败，返回错误记录 id；同一失败的重试尝试不重复登记（见 update_attempts）
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO flow_errors (user_id, flow_type, flow_id, node, prompt, error,"
            " traceback, attempts, auto_repair) VALUES (?,?,?,?,?,?,?,?,?)",
            (user_id, flow_type, flow_id, node, prompt, _cut(error, 2000),
             _cut(traceback, MAX_TRACEBACK_LEN), attempts, 1 if auto_repair else 0)
        )
        return cur.lastrowid  # type: ignore[return-value]


def get_error(error_id: int, user_id: int) -> dict | None:
    #按 id+归属人查错误记录，非本人返回 None（API 层转 404）
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM flow_errors WHERE id=? AND user_id=?", (error_id, user_id)
        ).fetchone()
    return dict(row) if row else None


def list_errors(user_id: int, flow_type: str | None = None, flow_id: str | None = None,
                status: str | None = None, limit: int = 50, offset: int = 0) -> dict:
    #列出错误记录（倒序），返回 {total, errors}；total 为满足过滤条件的全量条数
    where, args = ["user_id=?"], [user_id]
    if flow_type:
        where.append("flow_type=?")
        args.append(flow_type)
    if flow_id:
        where.append("flow_id=?")
        args.append(flow_id)
    if status:
        where.append("status=?")
        args.append(status)
    clause = " AND ".join(where)
    with get_connection() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) AS n FROM flow_errors WHERE {clause}", args
        ).fetchone()["n"]
        rows = conn.execute(
            f"SELECT * FROM flow_errors WHERE {clause} ORDER BY id DESC LIMIT ? OFFSET ?",
            (*args, limit, offset)
        ).fetchall()
    return {"total": total, "errors": [dict(r) for r in rows]}


def _update(error_id: int, user_id: int, **fields) -> None:
    if not fields:
        return
    assignments = ", ".join(f"{k}=?" for k in fields)
    with get_connection() as conn:
        conn.execute(
            f"UPDATE flow_errors SET {assignments}, updated_at=datetime('now','localtime')"
            " WHERE id=? AND user_id=?",
            (*fields.values(), error_id, user_id)
        )


def update_attempts(error_id: int, user_id: int, attempts: int) -> None:
    #更新尝试次数（同一失败记录的每次重试都累计进去）
    _update(error_id, user_id, attempts=attempts)


def mark_repairing(error_id: int, user_id: int) -> None:
    _update(error_id, user_id, status=STATUS_REPAIRING)


def mark_repaired(error_id: int, user_id: int, note: str = "") -> None:
    #修复成功：状态置 repaired，repair_count 累计，记录修复说明
    with get_connection() as conn:
        conn.execute(
            "UPDATE flow_errors SET status=?, repair_count=repair_count+1, error=?,"
            " updated_at=datetime('now','localtime'), repaired_at=datetime('now','localtime')"
            " WHERE id=? AND user_id=?",
            (STATUS_REPAIRED, _cut(note or "已修复", 2000), error_id, user_id)
        )


def mark_repair_failed(error_id: int, user_id: int, error: str = "") -> None:
    with get_connection() as conn:
        conn.execute(
            "UPDATE flow_errors SET status=?, repair_count=repair_count+1, error=?,"
            " updated_at=datetime('now','localtime') WHERE id=? AND user_id=?",
            (STATUS_REPAIR_FAILED, _cut(error or "修复失败", 2000), error_id, user_id)
        )


# ---------------- 重试机制 ----------------

def retry_call(fn: Callable[[], Any], attempts: int = 3, base_delay: float = 1.0) -> Any:
    #通用重试：失败后按 base_delay * 2^n 退避重试 attempts 次，全部失败抛出最后一次异常
    delay = base_delay
    last: Exception | None = None
    for i in range(attempts):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001
            last = e
            if i < attempts - 1:
                time.sleep(delay)
                delay *= 2
    raise last  # type: ignore[misc]


# ---------------- 自动修复机制（重启对应的流程） ----------------

def _invoke_subagent(prompt: str, user_id: int, session_id: str | None) -> str:
    #手动修复子代理：用原提示词原样重启子代理图（与工具内自动修复同路径）
    from langchain_core.messages import SystemMessage
    from .core.loop import subagent_graph
    from .llm.text import content_to_text
    from .tools.toolslist import toolsets
    state = {
        "messages": [SystemMessage(content=prompt)],
        "active_toolsets": list(toolsets),
        "user_id": user_id,
        "session_id": session_id,
    }
    result = subagent_graph.invoke(state)  # type: ignore[arg-type]
    return content_to_text(result["messages"][-1].content)


def _repair_worker(error_id: int, user_id: int) -> None:
    #后台线程执行修复：按 flow_type 重启对应的流程，完成后回写状态
    error = get_error(error_id, user_id)
    if error is None or error["status"] not in (STATUS_FAILED, STATUS_REPAIR_FAILED):
        return  # 已修复/修复中，忽略重复触发
    flow_type = error["flow_type"]
    try:
        mark_repairing(error_id, user_id)
        if flow_type == "research":
            from .research.runner import restart_task
            restart_task(error["flow_id"], user_id, repair_error_id=error_id)
        elif flow_type == "research_retry":
            from .research.runner import start_retry
            start_retry(error["flow_id"], error["node"], user_id, repair_error_id=error_id)
        elif flow_type == "history_analysis":
            from .research.runner import start_history_analysis
            start_history_analysis(error["flow_id"], user_id, repair_error_id=error_id)
        elif flow_type == "subagent":
            _invoke_subagent(error["prompt"], user_id, error["flow_id"] or None)
            mark_repaired(error_id, user_id, "子代理已重启并成功执行")
        elif flow_type == "chat":
            from .agent import Agent
            agent = Agent(error["flow_id"], user_id)
            agent.run(error["prompt"])
            mark_repaired(error_id, user_id, "对话轮次已重启并成功执行")
        else:
            raise RuntimeError(f"不支持的流程类型: {flow_type}")
        #research 系为后台异步流程，成功/失败由其 runner 线程回写状态
    except Exception as e:  # noqa: BLE001
        logger.exception("错误 %s 修复失败", error_id)
        mark_repair_failed(error_id, user_id, str(e))


def repair_error(error_id: int, user_id: int) -> dict:
    #对外修复入口（API 层/自动修复共用）：校验记录归属与可修复状态后起后台线程重启流程
    error = get_error(error_id, user_id)
    if error is None:
        raise KeyError(error_id)
    if error["status"] == STATUS_REPAIRING:
        raise RuntimeError("该错误正在修复中")
    if error["status"] == STATUS_REPAIRED:
        raise RuntimeError("该错误已修复，无需重复修复")
    threading.Thread(target=_repair_worker, args=(error_id, user_id),
                     daemon=True, name=f"repair-{error_id}").start()
    return error


def trigger_auto_repair(error_id: int, user_id: int) -> bool:
    #自动修复：记录落库后立即重启对应流程；重启失败时返回 False（已回写 repair_failed）
    try:
        repair_error(error_id, user_id)
        return True
    except Exception as e:  # noqa: BLE001
        logger.warning("错误 %s 自动修复失败: %s", error_id, e)
        try:
            mark_repair_failed(error_id, user_id, str(e))
        except Exception:  # noqa: BLE001
            pass
        return False


def format_traceback() -> str:
    #当前异常栈文本（调用点处于 except 块时）
    return _traceback.format_exc()
