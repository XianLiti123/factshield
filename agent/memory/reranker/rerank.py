import requests
from ...config import RERANKER_API_KEY,RERANKER_BASE_URL,RERANKER_MODEL
from ..vector_store.store import search,add_document,_get_store


def _check_config() -> None:
    #未配置 reranker 时给出指引
    if not (RERANKER_API_KEY and RERANKER_BASE_URL and RERANKER_MODEL):
        raise RuntimeError("未配置 Reranker 模型，请在 .env 中设置 RERANKER_API_KEY、RERANKER_BASE_URL、RERANKER_MODEL")


def rerank(query:str,documents:list[str],top_n:int=3)->list[tuple[str,float]]:
    #把 query 和候选片段一次发给 reranker 模型打分，返回 [(片段, 相关性分数), ...] 按分数降序
    _check_config()
    response = requests.post(
        RERANKER_BASE_URL, #type:ignore
        headers={"Authorization":f"Bearer {RERANKER_API_KEY}","Content-Type":"application/json"},
        json={
            "model":RERANKER_MODEL,
            "input":{"query":query,"documents":documents},
            "parameters":{"return_documents":True,"top_n":top_n}
        },
        timeout=30
    )
    if response.status_code != 200:
        raise RuntimeError(f"reranker 调用失败: HTTP {response.status_code}: {response.text[:200]}")
    try:
        data = response.json()
    except ValueError:
        raise RuntimeError(f"reranker 返回了非 JSON 响应，请检查 RERANKER_BASE_URL 是否指向 rerank 端点: {response.text[:200]}")
    if data.get("code"):
        raise RuntimeError(f"reranker 调用失败: {data.get('message')} (request_id={data.get('request_id','无')})")
    results = data["output"]["results"]#已按分数降序
    return [(documents[r["index"]],r["relevance_score"]) for r in results]


def precise_search(query:str,num:int=3)->list[str]:
    #精确检索：先向量库语义检索 top 2*num，再 reranker 精排取 top num
    #候选片段不足 num 个时直接返回，无需精排
    chunks = search(query,k=2*num)
    if not chunks:
        return []
    if len(chunks) <= num:
        return chunks
    return [text for text,_ in rerank(query,chunks,top_n=num)]


if __name__ == "__main__":
    sample = """事实核查（fact-checking）是指对公开言论或报道中的事实性主张进行核实的过程。常见流程包括提取主张、检索证据、比对来源并给出结论。

向量数据库通过 embedding 把文本映射为高维向量，再用余弦相似度做语义检索，是 RAG 系统的核心组件。

红烧肉的做法：五花肉切块焯水，加冰糖炒糖色，放生抽老抽和料酒，小火炖一个小时即可。"""
    group_id,count = add_document(sample)
    print(f"已写入示例文档: group_id={group_id}, 块数={count}")
    try:
        print("精确检索结果:")
        for text in precise_search("如何对网络言论进行事实核查？"):
            print("---")
            print(text)
    finally:
        _get_store()._collection.delete(where={"group_id":group_id})#清理测试数据
        print("测试数据已清理")
