import asyncio
import logging
import threading

from ..core.loop import get_llm_client
from ..failures import (format_traceback, mark_repair_failed, mark_repaired,
                        record_error, retry_call, trigger_auto_repair)
from . import store
from .pipeline import NodeFailedError, TaskStopped, research_graph, retry_single_claim

logger = logging.getLogger(__name__)

#运行中任务注册表：task_id -> {stop(终止标志), thread}
_running: dict[str, dict] = {}
_registry_lock = threading.Lock()

#事件订阅：task_id -> {订阅队列: 所属事件循环}。主流水线/重新取证/历史统计三路事件统一经
#publish_event 落库（task_events 表，审计/回放）并广播给全部订阅者（SSE 实时推送）；
#订阅方为 SSE 协程里的 asyncio.Queue，发布方多为研究守护线程，经 call_soon_threadsafe 跨循环投递
_subscribers: dict[str, dict["asyncio.Queue", asyncio.AbstractEventLoop]] = {}

#流程级重试次数（重新取证/历史统计整段重试；研究流水线节点的重试见 pipeline.NODE_MAX_ATTEMPTS）
RETRY_MAX_ATTEMPTS = 3


def publish_event(task_id: str, actor: str, kind: str, payload: dict) -> dict:
    event = store.append_event(task_id, actor, kind, payload)
    with _registry_lock:
        subs = list(_subscribers.get(task_id, {}).items())
    dead: list["asyncio.Queue"] = []
    for q, loop in subs:
        try:
            loop.call_soon_threadsafe(q.put_nowait, event)
        except RuntimeError:
            dead.append(q)  #订阅方事件循环已关闭：摘除，避免反复投递失败
    if dead:
        with _registry_lock:
            for q in dead:
                _subscribers.get(task_id, {}).pop(q, None)
            if not _subscribers.get(task_id):
                _subscribers.pop(task_id, None)
    return event


def subscribe(task_id: str) -> "asyncio.Queue":
    #注册一个事件订阅队列并绑定当前事件循环（须在协程里调用）；调用方负责在结束时
    #unsubscribe（先订阅再回放可无缺口衔接）
    q: "asyncio.Queue" = asyncio.Queue()
    with _registry_lock:
        _subscribers.setdefault(task_id, {})[q] = asyncio.get_running_loop()
    return q


def unsubscribe(task_id: str, q: "asyncio.Queue") -> None:
    with _registry_lock:
        subs = _subscribers.get(task_id)
        if subs is not None:
            subs.pop(q, None)
            if not subs:
                _subscribers.pop(task_id, None)


def is_running(task_id: str) -> bool:
    with _registry_lock:
        return task_id in _running


def _split_node_error(e: Exception) -> tuple[str, str, int]:
    #从包装异常中还原失败节点名/原始错误/尝试次数；非节点错误时给出通用信息
    if isinstance(e, NodeFailedError):
        return e.node, str(e.cause), e.attempts
    return "", str(e), 1


def start_task(task_id: str, user_id: int, *,
               repair_error_id: int | None = None, allow_auto_repair: bool = False) -> None:
    #后台线程启动研究流水线；重复启动直接忽略。
    #repair_error_id：本次运行为修复某条错误记录，结束时回写该记录状态；
    #allow_auto_repair：研究流水线默认 False——失败只保留现场，绝不整条清空重启
    #（清空式重启会删掉已采集的素材/主张/证据，是 FS-2026-022 反复空转的根因之一）
    with _registry_lock:
        if task_id in _running:
            return
        entry = {"stop": threading.Event()}
        _running[task_id] = entry

    def emit(actor: str, kind: str, payload: dict) -> None:
        publish_event(task_id, actor, kind, payload)

    def run() -> None:
        error_id: int | None = None
        message = ""
        try:
            _run_pipeline(task_id, user_id, entry["stop"], emit,
                          repair_error_id=repair_error_id)
            if repair_error_id:
                mark_repaired(repair_error_id, user_id, "研究流水线重启后已成功完成")
        except TaskStopped:
            store.update_task(task_id, status="stopped")
            emit("system", "stopped", {"title": "任务已终止", "speech": "研究员终止了本次研究任务。"})
            if repair_error_id:
                mark_repair_failed(repair_error_id, user_id, "修复运行被研究员终止")
        except Exception as e:  # noqa: BLE001
            node, message, attempts = _split_node_error(e)
            logger.exception("研究任务 %s 运行失败", task_id)
            task = store.get_task(task_id, user_id) or {}
            error_id = record_error(
                user_id, "research", task_id, error=message, node=node,
                prompt=task.get("topic", ""), traceback=format_traceback(),
                attempts=attempts, auto_repair=allow_auto_repair,
            )
            if repair_error_id:
                mark_repair_failed(repair_error_id, user_id, f"重启后仍失败: {message}")
            if allow_auto_repair:
                #自动修复在 finally 释放注册后触发（此时可重新登记运行）
                emit("system", "warning",
                     {"title": "检测到流程失败，自动重启", "speech": f"{message}。正在自动重启研究流水线…",
                      "details": [{"label": "失败环节", "text": node or "整条流水线"}],
                      "metrics": [{"label": "尝试次数", "value": str(attempts)}]})
            else:
                store.update_task(task_id, status="failed")
                emit("system", "error",
                     {"title": "任务失败",
                      "speech": f"{message}。已保留全部素材、主张与证据，可在错误记录中人工修复续跑。",
                      "details": [{"label": "失败环节", "text": node or "整条流水线"}],
                      "metrics": []})
        finally:
            with _registry_lock:
                _running.pop(task_id, None)
        if error_id is not None and allow_auto_repair:
            #自动修复：重启整条流水线（清空半成品后从头跑）
            if not trigger_auto_repair(error_id, user_id):
                store.update_task(task_id, status="failed")
                publish_event(task_id, "system", "error",
                              {"title": "自动修复失败", "speech": "研究流水线重启失败，任务已终止",
                               "details": [], "metrics": []})

    entry["thread"] = threading.Thread(target=run, daemon=True, name=f"research-{task_id}")
    entry["thread"].start()


def _run_pipeline(task_id: str, user_id: int, stop: threading.Event,
                  emit, *, repair_error_id: int | None = None) -> None:
    #执行整条研究流水线；节点级重试已在图内（_node_with_retry），失败异常上抛由 run() 收尾。
    #人工修复（repair_error_id 非空）时保留已有素材/主张/证据，在此基础上重跑；
    #采集节点内部已改为“确定性并行采集 + LLM 覆盖检查”，不再有备用方案分支
    task = store.get_task(task_id, user_id)
    initial = {
        "task_id": task_id, "user_id": user_id,
        "topic": task["topic"], "company": task["company"],
        "research_type": task["research_type"],
        "preferred_sources": task["preferred_sources"],
        "materials": store.list_materials(task_id),  #续跑时保留已入库素材（入库按 URL 幂等）
    }
    config = {"configurable": {"emit": emit, "stop_event": stop, "user_id": user_id}}
    research_graph.invoke(initial, config=config)


def reset_task(task_id: str) -> None:
    #清空任务半成品数据（素材/主张/证据/向量块），附件素材按原样重新入库；重启前调用
    from ..memory.SQLite.db import get_connection as memory_conn
    from ..memory.vector_store.store import delete_documents
    from .pipeline import _ingest_material
    store.reset_task_data(task_id)
    delete_documents(f"task:{task_id}:")
    with memory_conn() as conn:
        conn.execute("DELETE FROM documents WHERE group_id LIKE ?", (f"task:{task_id}:%",))
    for seq, upload in enumerate(store.list_uploads(task_id), 1):
        _ingest_material(task_id, seq, upload["filename"], "用户上传附件", "", upload["content"])


def restart_task(task_id: str, user_id: int, *, repair_error_id: int | None = None) -> None:
    #重启任务（人工修复）：保留失败时已产生的素材/主张/证据/事件/节点记录，
    #在此基础上重新启动流水线（不再 reset_task_data，不再删除可回查痕迹）；
    #任务正在运行时不重启，抛异常由调用方在错误记录上回写修复失败
    if store.get_task(task_id, user_id) is None:
        raise ValueError(f"任务不存在: {task_id}")
    if is_running(task_id):
        raise RuntimeError(f"任务 {task_id} 正在运行中，无法重启")
    store.update_task(task_id, status="running", progress=0)
    publish_event(task_id, "system", "progress",
                  {"title": "流水线重新执行",
                   "speech": "已保留现有素材、主张与证据，在此基础上从头重新执行研究流水线。",
                   "details": [], "metrics": [], "progress": 0})
    start_task(task_id, user_id, repair_error_id=repair_error_id, allow_auto_repair=False)


def stop_task(task_id: str) -> bool:
    #终止任务：置位标志，流水线在下一个节点边界停止；返回是否有活跃运行
    with _registry_lock:
        entry = _running.get(task_id)
    if entry is None:
        return False
    entry["stop"].set()
    from .. import questions  #延迟导入，避免模块加载顺序问题
    questions.wake_all_for_task(task_id, reason="任务已终止")
    return True


def start_retry(task_id: str, claim_id: str, user_id: int, *,
                repair_error_id: int | None = None, allow_auto_repair: bool = True) -> None:
    #后台线程对单条主张重新取证（与主流水线共用事件通道，任务结束后也可调用）。
    #失败自动重试 RETRY_MAX_ATTEMPTS 次，仍失败则登记错误并自动重启该主张的重新取证流程
    def emit(actor: str, kind: str, **payload) -> None:
        publish_event(task_id, actor, kind, payload)

    def run() -> None:
        error_id: int | None = None
        message = ""
        try:
            retry_call(
                lambda: retry_single_claim(task_id, claim_id, emit,
                                           get_llm_client(user_id), user_id),
                attempts=RETRY_MAX_ATTEMPTS, base_delay=1.0,
            )
            if repair_error_id:
                mark_repaired(repair_error_id, user_id, "重新取证重启后已成功完成")
        except Exception as e:  # noqa: BLE001
            message = str(e)
            logger.exception("主张 %s/%s 重新取证失败", task_id, claim_id)
            error_id = record_error(
                user_id, "research_retry", task_id, error=message, node=claim_id,
                prompt=claim_id, traceback=format_traceback(),
                attempts=RETRY_MAX_ATTEMPTS, auto_repair=allow_auto_repair,
            )
            if repair_error_id:
                mark_repair_failed(repair_error_id, user_id, f"重启后仍失败: {message}")
            emit("system", "error", title="重新取证失败", speech=message)
        if error_id is not None and allow_auto_repair:
            trigger_auto_repair(error_id, user_id)  #自动修复：重启该条主张的重新取证流程

    threading.Thread(target=run, daemon=True, name=f"retry-{task_id}-{claim_id}").start()


#正在运行的历史情景统计（task_id 去重，防并发重复触发）
_running_analysis: set[str] = set()


def is_analysis_running(task_id: str) -> bool:
    with _registry_lock:
        return task_id in _running_analysis


def start_history_analysis(task_id: str, user_id: int, config: dict | None = None, *,
                           repair_error_id: int | None = None,
                           allow_auto_repair: bool = True) -> None:
    #后台线程执行历史情景时序统计，事件经 publish_event 落库并广播；config 为用户自定义比较口径。
    #失败自动重试，仍失败则登记错误并自动重启该统计流程
    from .history import run_history_analysis  #延迟导入，避免模块加载顺序问题
    with _registry_lock:
        if task_id in _running_analysis:
            raise RuntimeError("该任务已有正在运行的历史情景统计")
        _running_analysis.add(task_id)

    def emit(actor: str, kind: str, **payload) -> None:
        publish_event(task_id, actor, kind, payload)

    def run() -> None:
        error_id: int | None = None
        message = ""
        try:
            retry_call(lambda: run_history_analysis(task_id, user_id, emit, config),
                       attempts=RETRY_MAX_ATTEMPTS, base_delay=1.0)
            if repair_error_id:
                mark_repaired(repair_error_id, user_id, "历史情景统计重启后已成功完成")
        except Exception as e:  # noqa: BLE001
            message = str(e)
            logger.exception("任务 %s 历史情景统计失败", task_id)
            error_id = record_error(
                user_id, "history_analysis", task_id, error=message, node="history",
                traceback=format_traceback(), attempts=RETRY_MAX_ATTEMPTS,
                auto_repair=allow_auto_repair,
            )
            if repair_error_id:
                mark_repair_failed(repair_error_id, user_id, f"重启后仍失败: {message}")
            emit("system", "error", title="历史情景统计失败", speech=message)
        finally:
            with _registry_lock:
                _running_analysis.discard(task_id)
        if error_id is not None and allow_auto_repair:
            #在 finally 之后触发（此时占用标志已释放，可重新登记运行）
            trigger_auto_repair(error_id, user_id)  #自动修复：重启该历史统计流程

    threading.Thread(target=run, daemon=True, name=f"history-{task_id}").start()
