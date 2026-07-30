import json

from ..session.db import get_connection, init_db

#研究任务/主张/证据/事件的结构化存储，全部落在 sessions.db（与账号、会话同库，按 user_id 隔离）
init_db()


def _next_task_id(conn) -> str:
    #任务编号 FS-年份-序号（年内递增，3 位起步）
    from datetime import datetime
    year = datetime.now().year
    row = conn.execute(
        "SELECT COUNT(*) AS n FROM research_tasks WHERE task_id LIKE ?", (f"FS-{year}-%",)
    ).fetchone()
    return f"FS-{year}-{row['n'] + 1:03d}"


def create_task(user_id: int, title: str, topic: str, company: str = "",
                research_type: str = "policy", preferred_sources: list[str] | None = None) -> dict:
    with get_connection() as conn:
        task_id = _next_task_id(conn)
        conn.execute(
            "INSERT INTO research_tasks (task_id, user_id, title, topic, company, research_type, preferred_sources)"
            " VALUES (?,?,?,?,?,?,?)",
            (task_id, user_id, title, topic, company, research_type,
             json.dumps(preferred_sources or [], ensure_ascii=False))
        )
    return get_task(task_id, user_id)  # type: ignore[return-value]


def get_task(task_id: str, user_id: int) -> dict | None:
    #按 id+归属人查询，非本人返回 None（API 层转 404，不暴露存在性）
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM research_tasks WHERE task_id=? AND user_id=?", (task_id, user_id)
        ).fetchone()
    if row is None:
        return None
    task = dict(row)
    task["preferred_sources"] = json.loads(task["preferred_sources"])
    return task


def list_tasks(user_id: int) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM research_tasks WHERE user_id=? ORDER BY created_at DESC", (user_id,)
        ).fetchall()
    tasks = []
    for row in rows:
        task = dict(row)
        task["preferred_sources"] = json.loads(task["preferred_sources"])
        tasks.append(task)
    return tasks


def search(user_id: int, keyword: str, limit: int = 10) -> dict:
    #全局搜索：任务（标题/主题/公司）、主张（表述）、证据（标题/出处/引文），限本人数据
    like = f"%{keyword}%"
    with get_connection() as conn:
        task_rows = conn.execute(
            "SELECT task_id, title, company, status, updated_at FROM research_tasks"
            " WHERE user_id=? AND (title LIKE ? OR topic LIKE ? OR company LIKE ?)"
            " ORDER BY updated_at DESC LIMIT ?",
            (user_id, like, like, like, limit)
        ).fetchall()
        claim_rows = conn.execute(
            "SELECT c.id, c.task_id, c.statement, c.status, t.title AS task_title"
            " FROM claims c JOIN research_tasks t ON t.task_id=c.task_id"
            " WHERE t.user_id=? AND c.statement LIKE ?"
            " ORDER BY c.task_id, c.idx LIMIT ?",
            (user_id, like, limit)
        ).fetchall()
        evidence_rows = conn.execute(
            "SELECT e.id, e.task_id, e.title, e.publisher, e.url, t.title AS task_title"
            " FROM evidence e JOIN research_tasks t ON t.task_id=e.task_id"
            " WHERE t.user_id=? AND (e.title LIKE ? OR e.publisher LIKE ? OR e.quote LIKE ?)"
            " LIMIT ?",
            (user_id, like, like, like, limit)
        ).fetchall()
    return {
        "tasks": [dict(r) for r in task_rows],
        "claims": [dict(r) for r in claim_rows],
        "evidence": [dict(r) for r in evidence_rows],
    }


def update_task(task_id: str, **fields) -> None:
    #通用字段更新（status/progress/report_md 等），自动刷新 updated_at
    if not fields:
        return
    assignments = ", ".join(f"{k}=?" for k in fields)
    with get_connection() as conn:
        conn.execute(
            f"UPDATE research_tasks SET {assignments}, updated_at=datetime('now','localtime') WHERE task_id=?",
            (*fields.values(), task_id)
        )


def bump_progress(task_id: str, progress: float) -> None:
    #进度只增不减：二次取证回退环节不会拉低进度条，避免前端显示倒退
    with get_connection() as conn:
        conn.execute(
            "UPDATE research_tasks SET progress=MAX(progress, ?),"
            " updated_at=datetime('now','localtime') WHERE task_id=?",
            (progress, task_id)
        )


def delete_task(task_id: str, user_id: int) -> bool:
    #删除任务并级联清理全部从属数据
    if get_task(task_id, user_id) is None:
        return False
    with get_connection() as conn:
        for table in ("task_materials", "claims", "evidence", "claim_evidence",
                      "task_events", "task_guidance", "history_analyses"):
            conn.execute(f"DELETE FROM {table} WHERE task_id=?", (task_id,))
        conn.execute("DELETE FROM research_tasks WHERE task_id=?", (task_id,))
    return True


# ---------------- 素材（采集到的原始资料，group_id 对应知识库向量块） ----------------

def add_material(task_id: str, group_id: str, title: str, publisher: str, url: str,
                 source_type: str = "", credibility: float = 0.0) -> int:
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO task_materials (task_id, group_id, title, publisher, url, source_type, credibility)"
            " VALUES (?,?,?,?,?,?,?)",
            (task_id, group_id, title, publisher, url, source_type, credibility)
        )
        return cur.lastrowid  # type: ignore[return-value]


def update_material_score(task_id: str, group_id: str, source_type: str, credibility: float,
                          credibility_level: str = "") -> None:
    with get_connection() as conn:
        conn.execute(
            "UPDATE task_materials SET source_type=?, credibility=?, credibility_level=?"
            " WHERE task_id=? AND group_id=?",
            (source_type, credibility, credibility_level, task_id, group_id)
        )


def list_materials(task_id: str) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM task_materials WHERE task_id=? ORDER BY id", (task_id,)
        ).fetchall()
    return [dict(r) for r in rows]


# ---------------- 主张 / 证据 ----------------

def save_claims(task_id: str, claims: list[dict]) -> None:
    #流水线初次写入主张清单，id 为 c1..cN（任务内序号）
    with get_connection() as conn:
        for i, c in enumerate(claims, 1):
            conn.execute(
                "INSERT INTO claims (id, task_id, idx, statement, category) VALUES (?,?,?,?,?)",
                (f"c{i}", task_id, i, c["statement"], c.get("category", ""))
            )


def save_evidence(task_id: str, claim_id: str, items: list[dict]) -> None:
    #为某条主张追加证据，id 全任务递增 e1..eN，并登记主张-证据关联
    with get_connection() as conn:
        row = conn.execute("SELECT COUNT(*) AS n FROM evidence WHERE task_id=?", (task_id,)).fetchone()
        n = row["n"]
        for item in items:
            n += 1
            eid = f"e{n}"
            conn.execute(
                "INSERT INTO evidence (id, task_id, title, publisher, published_at, locator, quote,"
                " source_type, relation, credibility, credibility_level, url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (eid, task_id, item.get("title", ""), item.get("publisher", ""),
                 item.get("published_at", ""), item.get("locator", ""), item.get("quote", ""),
                 item.get("source_type", ""), item.get("relation", "support"),
                 item.get("credibility", 0.0), item.get("credibility_level", ""), item.get("url", ""))
            )
            conn.execute(
                "INSERT OR IGNORE INTO claim_evidence (task_id, claim_id, evidence_id) VALUES (?,?,?)",
                (task_id, claim_id, eid)
            )


def clear_claims(task_id: str) -> None:
    #清空任务的主张、证据及关联（二次取证后重新提取时用）
    with get_connection() as conn:
        conn.execute("DELETE FROM claim_evidence WHERE task_id=?", (task_id,))
        conn.execute("DELETE FROM evidence WHERE task_id=?", (task_id,))
        conn.execute("DELETE FROM claims WHERE task_id=?", (task_id,))


def update_claim(task_id: str, claim_id: str, **fields) -> None:
    if not fields:
        return
    assignments = ", ".join(f"{k}=?" for k in fields)
    with get_connection() as conn:
        conn.execute(
            f"UPDATE claims SET {assignments}, updated_at=datetime('now','localtime')"
            " WHERE task_id=? AND id=?",
            (*fields.values(), task_id, claim_id)
        )


def get_claim(task_id: str, claim_id: str) -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM claims WHERE task_id=? AND id=?", (task_id, claim_id)
        ).fetchone()
    return dict(row) if row else None


def list_claims(task_id: str) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM claims WHERE task_id=? ORDER BY idx", (task_id,)
        ).fetchall()
    return [dict(r) for r in rows]


def list_evidence(task_id: str) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM evidence WHERE task_id=? ORDER BY CAST(SUBSTR(id,2) AS INTEGER)", (task_id,)
        ).fetchall()
    return [dict(r) for r in rows]


def claim_evidence_ids(task_id: str) -> dict[str, list[str]]:
    #主张 id -> 证据 id 列表
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT claim_id, evidence_id FROM claim_evidence WHERE task_id=?", (task_id,)
        ).fetchall()
    mapping: dict[str, list[str]] = {}
    for r in rows:
        mapping.setdefault(r["claim_id"], []).append(r["evidence_id"])
    return mapping


def resolve_claim(task_id: str, claim_id: str, action: str, note: str | None,
                  status_map: dict[str, str]) -> dict | None:
    #人工裁决：覆盖主张状态并记录裁决动作（保留自动判定原文，便于审计对比）
    claim = get_claim(task_id, claim_id)
    if claim is None:
        return None
    update_claim(task_id, claim_id, human_action=action, human_note=note or "",
                 status=status_map.get(action, claim["status"]))
    return get_claim(task_id, claim_id)


# ---------------- 事件（审计链 + SSE 回放） ----------------

def append_event(task_id: str, actor: str, kind: str, payload: dict) -> dict:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT COALESCE(MAX(seq),0) AS m FROM task_events WHERE task_id=?", (task_id,)
        ).fetchone()
        seq = row["m"] + 1
        conn.execute(
            "INSERT INTO task_events (task_id, seq, actor, kind, payload) VALUES (?,?,?,?,?)",
            (task_id, seq, actor, kind, json.dumps(payload, ensure_ascii=False))
        )
        row = conn.execute(
            "SELECT * FROM task_events WHERE task_id=? AND seq=?", (task_id, seq)
        ).fetchone()
    event = dict(row)
    event["payload"] = json.loads(event["payload"])
    return event


def list_events(task_id: str, after_seq: int = 0) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM task_events WHERE task_id=? AND seq>? ORDER BY seq", (task_id, after_seq)
        ).fetchall()
    events = []
    for r in rows:
        e = dict(r)
        e["payload"] = json.loads(e["payload"])
        events.append(e)
    return events


# ---------------- 研究员中途介入 ----------------

def add_guidance(task_id: str, content: str) -> None:
    with get_connection() as conn:
        conn.execute("INSERT INTO task_guidance (task_id, content) VALUES (?,?)", (task_id, content))


def consume_guidance(task_id: str) -> list[str]:
    #取出并标记全部未消费的介入指令（verify 节点一次性消费）
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, content FROM task_guidance WHERE task_id=? AND consumed=0 ORDER BY id", (task_id,)
        ).fetchall()
        if rows:
            ids = ",".join(str(r["id"]) for r in rows)
            conn.execute(f"UPDATE task_guidance SET consumed=1 WHERE id IN ({ids})")
    return [r["content"] for r in rows]


# ---------------- 历史情景时序统计 ----------------

def save_analysis(task_id: str, metric: str, unit: str, payload: dict) -> int:
    #保存一次历史情景时序统计结果；新结果保存时把旧结果的附件标记清除（附件始终指向最新一次）
    with get_connection() as conn:
        conn.execute("UPDATE history_analyses SET attached=0 WHERE task_id=?", (task_id,))
        cur = conn.execute(
            "INSERT INTO history_analyses (task_id, metric, unit, payload) VALUES (?,?,?,?)",
            (task_id, metric, unit, json.dumps(payload, ensure_ascii=False))
        )
        return cur.lastrowid  # type: ignore[return-value]


def get_latest_analysis(task_id: str) -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM history_analyses WHERE task_id=? ORDER BY id DESC LIMIT 1", (task_id,)
        ).fetchone()
    if row is None:
        return None
    result = dict(row)
    result["payload"] = json.loads(result["payload"])
    return result


def set_analysis_attached(analysis_id: int, attached: bool) -> None:
    with get_connection() as conn:
        conn.execute("UPDATE history_analyses SET attached=? WHERE id=?",
                     (1 if attached else 0, analysis_id))
