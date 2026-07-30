import json
from agent.research import store
from agent.research.models import agents_status

TID = "FS-2026-007"
task = store.get_task(TID, 1)
claims = store.list_claims(TID)
evidence = store.list_evidence(TID)
ce_map = store.claim_evidence_ids(TID)

print("=== 任务 ===")
print("状态:", task["status"], "| 进度:", task["progress"], "| 摘要:", (task["summary_md"] or "")[:100])
print()
print("=== 主张与判定 ===")
for c in claims:
    evs = ce_map.get(c["id"], [])
    print(f"[{c['id']}] {c['statement']}")
    print(f"   状态={c['status']} 置信度={c['confidence']:.2f} 问题类型={c['issue_type']}")
    print(f"   一级核验: {c['supervisor_verdict'][:80]}")
    print(f"   二级复核: {c['reviewer_verdict'][:80]}")
    if c["conflict_reason"]:
        print(f"   存疑原因: {c['conflict_reason'][:80]}")
    print(f"   证据 {len(evs)} 条: {evs}")
print()
print("=== 证据明细 ===")
for e in evidence:
    print(f"[{e['id']}] {e['relation']} | {e['publisher']} | 来源可信度:{e['credibility_level'] or '?'}")
    print(f"   引文: {e['quote'][:120]}")
    print(f"   链接: {e['url']}")
print()
print("=== 各单元耗时 ===")
for ag in agents_status(task, store.list_events(TID)):
    print(f"   {ag['id']:<11} {ag['status']:<8} {ag['duration']}")
print()
report = task["report_md"] or ""
i = report.find("## 摘要")
print("=== 底稿摘要段 ===")
print(report[i:i + 700] if i >= 0 else "(无)")
