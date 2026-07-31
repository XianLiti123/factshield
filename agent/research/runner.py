import logging
import queue
import threading

from ..core.loop import get_llm_client
from . import store
from .pipeline import TaskStopped, research_graph, retry_single_claim

logger = logging.getLogger(__name__)

#运行中任务注册表：task_id -> {stop(终止标志), thread}
_running: dict[str, dict] = {}
_registry_lock = threading.Lock()

#事件订阅：task_id -> 订阅队列集合。主流水线/重新取证/历史统计三路事件统一经
#publish_event 落库（task_events 表，审计/回放）并广播给全部订阅者（SSE 实时推送）
_subscribers: dict[str, set["queue.Queue"]] = {}


def publish_event(task_id: str, actor: str, kind: str, payload: dict) -> dict:
    event = store.append_event(task_id, actor, kind, payload)
    with _registry_lock:
        subs = list(_subscribers.get(task_id, ()))
    for q in subs:
        q.put(event)
    return event


def subscribe(task_id: str) -> "queue.Queue":
    #注册一个事件订阅队列；调用方负责在结束时 unsubscribe（先订阅再回放可无缺口衔接）
    q: "queue.Queue" = queue.Queue()
    with _registry_lock:
        _subscribers.setdefault(task_id, set()).add(q)
    return q


def unsubscribe(task_id: str, q: "queue.Queue") -> None:
    with _registry_lock:
        subs = _subscribers.get(task_id)
        if subs is not None:
            subs.discard(q)
            if not subs:
                _subscribers.pop(task_id, None)


def is_running(task_id: str) -> bool:
    with _registry_lock:
        return task_id in _running


def start_task(task_id: str, user_id: int) -> None:
    #后台线程启动研究流水线；重复启动直接忽略
    with _registry_lock:
        if task_id in _running:
            return
        entry = {"stop": threading.Event()}
        _running[task_id] = entry

    def emit(actor: str, kind: str, payload: dict) -> None:
        publish_event(task_id, actor, kind, payload)

    def run() -> None:
        task = store.get_task(task_id, user_id)
        try:
            initial = {
                "task_id": task_id, "user_id": user_id,
                "topic": task["topic"], "company": task["company"],
                "research_type": task["research_type"],
                "preferred_sources": task["preferred_sources"],
                "materials": [], "retry_count": 0, "need_retry": False,
            }
            config = {"configurable": {"emit": emit, "stop_event": entry["stop"], "user_id": user_id}}
            research_graph.invoke(initial, config=config)
        except TaskStopped:
            store.update_task(task_id, status="stopped")
            emit("system", "stopped", {"title": "任务已终止", "speech": "研究员终止了本次研究任务。"})
        except Exception as e:
            logger.exception("研究任务 %s 运行失败", task_id)
            store.update_task(task_id, status="failed")
            emit("system", "error", {"title": "任务失败", "speech": str(e)})
        finally:
            with _registry_lock:
                _running.pop(task_id, None)

    entry["thread"] = threading.Thread(target=run, daemon=True, name=f"research-{task_id}")
    entry["thread"].start()


def stop_task(task_id: str) -> bool:
    #终止任务：置位标志，流水线在下一个节点边界停止；返回是否有活跃运行
    with _registry_lock:
        entry = _running.get(task_id)
    if entry is None:
        return False
    entry["stop"].set()
    return True


def start_retry(task_id: str, claim_id: str, user_id: int) -> None:
    #后台线程对单条主张重新取证（与主流水线共用事件通道，任务结束后也可调用）
    def emit(actor: str, kind: str, **payload) -> None:
        publish_event(task_id, actor, kind, payload)

    def run() -> None:
        try:
            retry_single_claim(task_id, claim_id, emit, get_llm_client(user_id), user_id)
        except Exception as e:
            logger.exception("主张 %s/%s 重新取证失败", task_id, claim_id)
            emit("system", "error", {"title": "重新取证失败", "speech": str(e)})

    threading.Thread(target=run, daemon=True, name=f"retry-{task_id}-{claim_id}").start()


#正在运行的历史情景统计（task_id 去重，防并发重复触发）
_running_analysis: set[str] = set()


def is_analysis_running(task_id: str) -> bool:
    with _registry_lock:
        return task_id in _running_analysis


def start_history_analysis(task_id: str, user_id: int, config: dict | None = None) -> None:
    #后台线程执行历史情景时序统计，事件经 publish_event 落库并广播；config 为用户自定义比较口径
    from .history import run_history_analysis  #延迟导入，避免模块加载顺序问题
    with _registry_lock:
        if task_id in _running_analysis:
            raise RuntimeError("该任务已有正在运行的历史情景统计")
        _running_analysis.add(task_id)

    def emit(actor: str, kind: str, **payload) -> None:
        publish_event(task_id, actor, kind, payload)

    def run() -> None:
        try:
            run_history_analysis(task_id, user_id, emit, config)
        except Exception as e:
            logger.exception("任务 %s 历史情景统计失败", task_id)
            emit("system", "error", {"title": "历史情景统计失败", "speech": str(e)})
        finally:
            with _registry_lock:
                _running_analysis.discard(task_id)

    threading.Thread(target=run, daemon=True, name=f"history-{task_id}").start()
