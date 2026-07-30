import json
import time
from agent.research import store

TID = "FS-2026-008"
start = time.time()
last = ""
while time.time() - start < 600:
    task = store.get_task(TID, 1)
    if task["status"] != last:
        print(f"[{time.time()-start:6.1f}s] -> {task['status']}, 进度 {task['progress']}")
        last = task["status"]
    if last in ("review", "ready", "stopped", "failed"):
        break
    time.sleep(5)
print(f"\n总耗时 {time.time()-start:.0f}s，终态 {last}")

claims = store.list_claims(TID)
mats = store.list_materials(TID)
evs = store.list_evidence(TID)
print(f"主张 {len(claims)} 条 | 素材 {len(mats)} 篇 | 证据 {len(evs)} 条")
from collections import Counter
print("主张状态分布:", dict(Counter(c["status"] for c in claims)))
print("事件:")
for e in store.list_events(TID):
    p = e["payload"] if isinstance(e["payload"], dict) else json.loads(e["payload"])
    print(" ", e["ts"], f"{e['actor']:<11}", p.get("title"))
