"""混合检索（Hybrid Search）：让 SQLite 与向量库协同参与召回。

- 向量召回：Chroma 语义检索（全库：知识库/任务素材/会话切片同库召回）。
- 关键词召回 A：SQLite FTS5（trigram，中文子串）素材全文索引。
- 关键词召回 B：Chroma where_document $contains 子串匹配。
- RRF（Reciprocal Rank Fusion）融合三路召回，再经 reranker 精排（未配置时按融合分兜底）。
返回 [{content, group_id, chunk_index, score}]。
"""

import logging
import re
import sqlite3

from .reranker.rerank import safe_rerank
from .vector_store.store import _get_store

logger = logging.getLogger(__name__)

#混合检索（Hybrid Search）：让 SQLite 与向量库协同参与召回——
# 1) 向量召回：Chroma 语义检索（全库：知识库/任务素材/会话切片同库召回）
# 2) 关键词召回 A：SQLite FTS5（trigram，中文子串）素材全文索引
# 3) 关键词召回 B：Chroma where_document $contains 子串匹配（覆盖无 SQLite 全文的文档）
# 4) RRF（Reciprocal Rank Fusion）融合三路召回，再经 reranker 精排（未配置时按融合分兜底）
#返回 [{content, group_id, chunk_index, score}]，score 为精排分数（降级时为 RRF 分数）

_RRF_K = 60        #RRF 常数
_FUSE_LIMIT = 12   #参与精排的融合候选上限
_KEYWORD_K = 8     #单路关键词召回数量
_MAX_TERMS = 6     #关键词提取上限


def _chunk_id(group_id: str, chunk_index: int) -> str:
    return f"{group_id}#{chunk_index}"


def _split_terms(query: str) -> list[str]:
    #从查询中提取关键词：按分隔符切词 + 中文连续串 4 字滑窗（子串召回需要短词）
    text = (query or "").strip()
    if not text:
        return []
    terms: list[str] = []
    for t in re.split(r"[\s，。；、,.!?！？:：()（）\[\]\"'\-_/\\]+", text):
        t = t.strip()
        if t and t not in terms:
            terms.append(t)
    windows: list[str] = []
    for t in terms:
        if len(t) > 12 and all("\u4e00" <= ch <= "\u9fff" for ch in t):
            for i in range(0, len(t) - 3, 2):
                w = t[i:i + 4]
                if w not in windows:
                    windows.append(w)
    result = (terms + windows)[:_MAX_TERMS]
    if not result and text:
        result = [text[:8]]
    return result


def _vector_hits(query: str, k: int) -> list[dict]:
    #向量召回：语义检索 top k（全库）
    docs = _get_store().similarity_search(query, k=k)
    return [{"content": d.page_content, "group_id": d.metadata.get("group_id", ""),
             "chunk_index": d.metadata.get("chunk_index", 0), "source": "vector"}
            for d in docs]


def _keyword_hits_chroma(query: str, k: int) -> list[dict]:
    #关键词召回 B：Chroma where_document $contains 子串匹配（知识库文档等无 SQLite 全文的文本）
    hits: dict[str, dict] = {}
    try:
        collection = _get_store()._chroma_collection  #type:ignore
    except Exception as e:  # noqa: BLE001
        logger.warning("Chroma 关键词召回不可用: %s", e)
        return []
    for term in _split_terms(query):
        if len(term) < 2:
            continue
        try:
            res = collection.get(where_document={"$contains": term},
                                 limit=k, include=["metadatas", "documents"])  #type:ignore
        except Exception as e:  # noqa: BLE001
            logger.warning("Chroma 关键词召回失败（%s）: %s", term, e)
            continue
        for doc, meta in zip(res.get("documents") or [], res.get("metadatas") or []):
            if doc is None:
                continue
            meta = meta or {}
            hits[doc] = {"content": doc, "group_id": meta.get("group_id", ""),
                         "chunk_index": meta.get("chunk_index", 0), "source": "keyword"}
    return list(hits.values())[:k]


def _keyword_hits_sqlite(query: str, k: int) -> list[dict]:
    #关键词召回 A：SQLite FTS5（trigram）素材全文索引；FTS5 不可用或全库无素材时返回空
    from ..session.db import get_connection  #延迟导入，避免加载顺序问题
    terms = [t for t in _split_terms(query) if len(t) >= 3]  #trigram 要求 ≥3 字符
    if not terms:
        return []
    try:
        conn = get_connection()
        try:
            clauses = " OR ".join("task_materials_fts MATCH ?" for _ in terms)
            quoted = ['"' + t.replace('"', '""') + '"' for t in terms]  #短语引号包裹，规避 FTS 语法字符
            rows = conn.execute(
                f"SELECT group_id, content FROM task_materials_fts"
                f" WHERE {clauses} ORDER BY rank LIMIT ?",
                (*quoted, k)
            ).fetchall()
        finally:
            conn.close()
    except sqlite3.OperationalError:
        return []  #FTS5 未启用：降级（由 Chroma 关键词召回路兜底）
    return [{"content": r["content"], "group_id": r["group_id"], "chunk_index": 0,
             "source": "fts"} for r in rows]


def _rrf_fuse(hit_lists: list[list[dict]], limit: int) -> list[tuple[dict, float]]:
    #Reciprocal Rank Fusion：score = Σ 1/(RRF_K + rank)；同 chunk 跨路去重取最高分
    scores: dict[str, float] = {}
    items: dict[str, dict] = {}
    for hits in hit_lists:
        for rank, h in enumerate(hits):
            cid = _chunk_id(h["group_id"], h.get("chunk_index", 0))
            scores[cid] = scores.get(cid, 0.0) + 1.0 / (_RRF_K + rank + 1)
            if cid not in items:
                items[cid] = h
    ranked = sorted(items.items(), key=lambda kv: -scores[kv[0]])[:limit]
    return [(h, scores[cid]) for cid, h in ranked]


def hybrid_search(query: str, num: int = 5, vector_k: int | None = None,
                  keyword_k: int = _KEYWORD_K) -> list[dict]:
    #混合检索主入口：三路召回 + RRF 融合 + reranker 精排（可降级）
    num = max(1, int(num))
    vector_k = vector_k or max(8, num * 2)
    try:
        vector = _vector_hits(query, vector_k)
    except RuntimeError:
        raise  #embedding 未配置：上游按原语义报错（如研究任务节点失败重试）
    keyword = _keyword_hits_chroma(query, keyword_k) + _keyword_hits_sqlite(query, keyword_k)
    fused = _rrf_fuse([vector, keyword], _FUSE_LIMIT)
    if not fused:
        return []
    #reranker 精排（可降级：未配置/调用失败时 safe_rerank 按融合序截断，分数记 0）
    texts = [h["content"] for h, _ in fused]
    ranked = safe_rerank(query, texts, top_n=num)
    if all(score == 0.0 for _, score in ranked) and len(texts) > 1:
        #降级路径：无精排分，保留 RRF 融合分（仍按融合序输出）
        return [{**h, "score": round(rrf_score, 6)} for h, rrf_score in fused[:num]]
    ranked_map = {t: s for t, s in ranked}
    return [{**h, "score": float(ranked_map[h["content"]])} for h, _ in fused
            if h["content"] in ranked_map][:num]


if __name__ == "__main__":
    for hit in hybrid_search("贵州茅台2025年营业收入", num=3):
        print(hit["score"], "|", hit["group_id"], "|", hit["content"][:40])
