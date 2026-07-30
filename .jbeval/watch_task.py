import json
import time
from agent.research import store

TID = "FS-2026-007"
start = time.time()
last_status = ""
while time.time() - start < 420:
    task = store.get_task(TID, 1)
    status = task["status"]
    if status != last_status:
        print(f"[{time.time()-start:6.1f}s] 状态 -> {status}, 进度 {task['progress']}")
        last_status = status
    if status in ("review", "ready", "stopped", "failed"):
        break
    time.sleep(4)
else:
    print("超时未完成")

print(f"\n总耗时: {time.time()-start:.0f}s, 终态: {last_status}")
print("--- 事件时间线 ---")
for e in store.list_events(TID):
    p = e["payload"] if isinstance(e["payload"], dict) else json.loads(e["payload"])
    print(e["ts"], f"{e['actor']:<11}", e["kind"], "|", p.get("title"))
