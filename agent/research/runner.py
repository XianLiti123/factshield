import logging
import queue
import threading

from ..core.loop import get_llm_client
from . import store
from .pipeline import TaskStopped, research_graph, retry_single_claim

logger = logging.getLogger(__name__)

#运行中任务注册表：task_id -> {queue(事件队列), stop(终止标志), thread}
#事件先写 task_events 表（审计/回放）再推队列（SSE 实时），队列末尾以 None 作结束哨兵
_running: dict[str, dict] = {}
_registry_lock = threading.Lock()


def is_running(task_id: str) -> bool:
    with _registry_lock:
        return task_id in _running


def get_queue(task_id: str) -> "queue.Queue | None":
    with _registry_lock:
        entry = _running.get(task_id)
        return entry["queue"] if entry else None


def start_task(task_id: str, user_id: int) -> None:
    #后台线程启动研究流水线；重复启动直接忽略
    with _registry_lock:
        if task_id in _running:
            return
        entry = {"queue": queue.Queue(), "stop": threading.Event()}
        _running[task_id] = entry

    def emit(actor: str, kind: str, payload: dict) -> None:
        event = store.append_event(task_id, actor, kind, payload)
        entry["queue"].put(event)

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
            entry["queue"].put(None)  #结束哨兵，SSE 消费端据此关闭流

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
    q = queue.Queue()

    def emit(actor: str, kind: str, **payload) -> None:
        event = store.append_event(task_id, actor, kind, payload)
        q.put(event)

    def run() -> None:
        try:
            retry_single_claim(task_id, claim_id, emit, get_llm_client(user_id))
        except Exception as e:
            logger.exception("主张 %s/%s 重新取证失败", task_id, claim_id)
            emit("system", "error", {"title": "重新取证失败", "speech": str(e)})
        finally:
            q.put(None)

    threading.Thread(target=run, daemon=True, name=f"retry-{task_id}-{claim_id}").start()
