"""Agent 提问工具的后端存储与等待注册表。

支持两种 scope：
- task：研究流水线提问，事件走 agent.research.runner 的任务事件通道（SSE 研究动态）；
- session：对话小盾提问，事件走 agent.session.events 会话总线（chat SSE）。

等待机制：ask_user 工具写一条 pending 问题并发布提问事件后，在
wait_for_answer 里阻塞；用户经答案接口作答（或任务/会话被终止）后，
写入答案/取消状态并唤醒等待线程，工具结果回到 LLM 上下文。
"""

import json
import threading
import uuid

from .session.db import get_connection


class QuestionCancelled(Exception):
    """提问被终止（任务停止/会话删除等）时抛出，由调用方决定如何收尾。"""

    def __init__(self, question_id: str, reason: str):
        super().__init__(f"提问 {question_id} 已取消: {reason}")
        self.question_id = question_id
        self.reason = reason


MAX_OPTIONS = 6
MAX_ANSWER_LEN = 2000
MAX_QUESTION_LEN = 500

_waiters: dict[str, threading.Event] = {}
_cancelled: dict[str, str] = {}
_lock = threading.Lock()


def _row_to_dict(row) -> dict:
    d = dict(row)
    d["options"] = json.loads(d["options"] or "[]")
    d["allow_custom"] = bool(d["allow_custom"])
    return d


def create_question(*, scope: str, user_id: int, question: str,
                    options: list[str] | None = None, allow_custom: bool = True,
                    task_id: str | None = None, session_id: str | None = None,
                    actor: str = "agent", node: str = "") -> dict:
    """创建一条 pending 问题并落库，返回完整行（options 已还原为列表）。"""
    question = str(question).strip()[:MAX_QUESTION_LEN]
    if not question:
        raise ValueError("question 不能为空")
    opts = [str(o).strip() for o in (options or []) if str(o).strip()][:MAX_OPTIONS]
    qid = uuid.uuid4().hex
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO agent_questions"
            " (id, scope, task_id, session_id, user_id, actor, node, question, options, allow_custom)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            (qid, scope, task_id, session_id, user_id, actor, node, question,
             json.dumps(opts, ensure_ascii=False), 1 if allow_custom else 0)
        )
    return get_question(qid, user_id)


def get_question(question_id: str, user_id: int | None = None) -> dict | None:
    """按 id 查问题；user_id 非 None 时校验归属（他人问题返回 None）。"""
    with get_connection() as conn:
        if user_id is None:
            row = conn.execute(
                "SELECT * FROM agent_questions WHERE id=?", (question_id,)
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM agent_questions WHERE id=? AND user_id=?",
                (question_id, user_id)
            ).fetchone()
    return _row_to_dict(row) if row else None


def list_questions(*, task_id: str | None = None, session_id: str | None = None,
                   user_id: int | None = None, status: str | None = None) -> list[dict]:
    """按 scope 条件列出问题；status 可选 pending/answered/cancelled。"""
    clauses, params = [], []
    if task_id is not None:
        clauses.append("task_id=?")
        params.append(task_id)
    if session_id is not None:
        clauses.append("session_id=?")
        params.append(session_id)
    if user_id is not None:
        clauses.append("user_id=?")
        params.append(user_id)
    if status is not None:
        clauses.append("status=?")
        params.append(status)
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    with get_connection() as conn:
        rows = conn.execute(
            f"SELECT * FROM agent_questions{where} ORDER BY created_at, rowid", params
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def pending_question(*, task_id: str | None = None, session_id: str | None = None,
                     user_id: int | None = None) -> dict | None:
    """取最早一条未回答的问题，供前端刷新后恢复提问卡片。"""
    rows = list_questions(task_id=task_id, session_id=session_id,
                          user_id=user_id, status="pending")
    return rows[0] if rows else None


def register_waiter(question_id: str) -> threading.Event:
    #工具提问前登记等待事件；answer/cancel 时置位唤醒
    ev = threading.Event()
    with _lock:
        _waiters[question_id] = ev
        _cancelled.pop(question_id, None)
    return ev


def wait_for_answer(question_id: str, stop_event: threading.Event | None = None) -> str:
    """阻塞等待用户回答；返回答案文本。

    - 任务 stop_event 置位或问题被取消时抛 QuestionCancelled；
    - 答案已写入（含唤醒前已答）时直接返回。
    """
    register_waiter(question_id)
    while True:
        if stop_event is not None and stop_event.is_set():
            _mark_cancelled(question_id, "任务已终止")
            raise QuestionCancelled(question_id, "任务已终止")
        with _lock:
            cancelled = _cancelled.get(question_id)
        if cancelled is not None:
            raise QuestionCancelled(question_id, cancelled)
        row = get_question(question_id)
        if row is None:
            raise QuestionCancelled(question_id, "问题不存在")
        if row["status"] == "answered":
            return row["answer"] or ""
        if row["status"] == "cancelled":
            raise QuestionCancelled(question_id, row["answer"] or "提问已取消")
        with _lock:
            ev = _waiters.get(question_id)
        if ev is not None:
            ev.wait(0.5)


def answer_question(question_id: str, user_id: int, answer: str) -> dict:
    """把 pending 问题写入答案（不唤醒，由调用方在发布 answer 事件后 wake）。"""
    answer = str(answer).strip()[:MAX_ANSWER_LEN]
    if not answer:
        raise ValueError("答案不能为空")
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM agent_questions WHERE id=? AND user_id=?",
            (question_id, user_id)
        ).fetchone()
        if row is None:
            raise KeyError("问题不存在")
        if row["status"] != "pending":
            raise RuntimeError("该问题已作答或已取消")
        conn.execute(
            "UPDATE agent_questions SET status='answered', answer=?,"
            " answered_at=datetime('now','localtime') WHERE id=?",
            (answer, question_id)
        )
    return get_question(question_id, user_id)


def wake(question_id: str) -> None:
    #唤醒等待线程（答案接口在发布 answer 事件后调用）
    with _lock:
        ev = _waiters.get(question_id)
    if ev is not None:
        ev.set()


def is_waiting(question_id: str) -> bool:
    #是否有线程正在等待该问题（进程内才可作答；重启后等待线程不存在）
    with _lock:
        return question_id in _waiters


def _mark_cancelled(question_id: str, reason: str) -> None:
    with _lock:
        _cancelled[question_id] = reason
        ev = _waiters.get(question_id)
    with get_connection() as conn:
        conn.execute(
            "UPDATE agent_questions SET status='cancelled', answer=?,"
            " answered_at=datetime('now','localtime')"
            " WHERE id=? AND status='pending'",
            (reason[:MAX_ANSWER_LEN], question_id)
        )
    if ev is not None:
        ev.set()


def wake_all_for_task(task_id: str, reason: str = "任务已终止") -> None:
    #终止任务时取消其全部 pending 提问并唤醒等待线程
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id FROM agent_questions WHERE task_id=? AND status='pending'",
            (task_id,)
        ).fetchall()
    for r in rows:
        _mark_cancelled(r["id"], reason)


def wake_all_for_session(session_id: str, reason: str = "会话已删除") -> None:
    #删除会话时取消其全部 pending 提问并唤醒等待线程
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id FROM agent_questions WHERE session_id=? AND status='pending'",
            (session_id,)
        ).fetchall()
    for r in rows:
        _mark_cancelled(r["id"], reason)


def question_to_dto(row: dict) -> dict:
    """行 -> 前端 DTO（camelCase，与 api/schemas/research.py 的 QuestionDTO 对应）。"""
    return {
        "id": row["id"],
        "question": row["question"],
        "options": row["options"],
        "allowCustom": bool(row["allow_custom"]),
        "answer": row.get("answer"),
        "actor": row.get("actor"),
        "node": row.get("node"),
        "status": row.get("status"),
        "createdAt": row.get("created_at"),
        "answeredAt": row.get("answered_at"),
    }
