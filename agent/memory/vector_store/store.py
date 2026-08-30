"""向量知识库（Chroma）封装。

- 文本切分（固定长度 + 重叠）后写入向量库，同一文档所有块共享 group_id。
- 支持语义检索与按组前缀删除（供任务重启时清理失败产生的半成品）。
- embedding 未配置时明确报错，不静默降级。
"""

import logging
import uuid
from pathlib import Path
from langchain_openai import OpenAIEmbeddings
from langchain_chroma import Chroma
from langchain_text_splitters import RecursiveCharacterTextSplitter
from ...config import EMBEDDING_API_KEY,EMBEDDING_BASE_URL,EMBEDDING_MODEL

logger = logging.getLogger(__name__)

#向量库持久化目录，与本模块同目录
PERSIST_DIR = str(Path(__file__).parent / "chroma_db")

#embedding 客户端，未配置时为 None
#check_embedding_ctx_length=False：直接发送原文，不做 tiktoken 预分词
#（部分云端兼容接口不支持 token 数组格式的 input）
#chunk_size=20：部分云端兼容接口单批最多 20 条文本，按服务商上限分批
_embeddings = OpenAIEmbeddings(
    model=EMBEDDING_MODEL,
    base_url=EMBEDDING_BASE_URL,
    api_key=EMBEDDING_API_KEY, #type:ignore
    check_embedding_ctx_length=False,
    chunk_size=20
) if EMBEDDING_API_KEY and EMBEDDING_BASE_URL and EMBEDDING_MODEL else None

#Chroma 单例：_get_store 每次新建实例会反复打开持久化目录，且并发检索时多个实例
#指向同一 sqlite 会互相锁；改为进程内复用同一个客户端（内部自带读写锁，线程安全）
_store_singleton: Chroma | None = None

#文本切分器，按固定长度+重叠切分
_splitter = RecursiveCharacterTextSplitter(chunk_size=1000,chunk_overlap=200)


def _get_store() -> Chroma:
    #获取向量库实例（进程内单例），未配置 embedding 时给出指引
    global _store_singleton
    if _embeddings is None:
        raise RuntimeError("未配置 Embedding 模型，请在 .env 中设置 EMBEDDING_API_KEY、EMBEDDING_BASE_URL、EMBEDDING_MODEL")
    if _store_singleton is None:
        _store_singleton = Chroma(
            collection_name="documents",
            embedding_function=_embeddings,
            persist_directory=PERSIST_DIR
        )
    return _store_singleton


def add_document(content:str,group_id:str|None=None)->tuple[str,int]:
    #把一篇 Markdown 文档切分后写入向量库，返回 (组ID, 块数)
    #同一篇文档的所有块共享 group_id，用于和 SQLite 中的元数据对应；
    #可传入自定义 group_id（如 task:xxx:1 标记任务采集的素材），缺省自动生成
    store = _get_store()
    group_id = group_id or uuid.uuid4().hex
    chunks = _splitter.split_text(content)
    store.add_texts(
        texts=chunks,
        metadatas=[{"group_id":group_id,"chunk_index":i} for i in range(len(chunks))],
        ids=[f"{group_id}-{i}" for i in range(len(chunks))]
    )
    return group_id,len(chunks)


def search(query:str,k:int=5)->list[str]:
    #按语义检索向量库，返回最相关的 k 个文本块
    store = _get_store()
    docs = store.similarity_search(query,k=k)
    return [doc.page_content for doc in docs]


def delete_documents(group_id_prefix:str|None=None)->None:
    #按组前缀删除向量块（如 task:FS-2026-001: 清理某任务的全部素材），
    #供任务重启（自动修复）时清空失败产生的半成品；embedding 未配置或删除失败时静默跳过
    if _embeddings is None or not group_id_prefix:
        return
    try:
        collection = _get_store()._chroma_collection  #type:ignore #直接操作底层集合，支持 where 过滤
        hits = collection.get(where={"group_id": {"$contains": group_id_prefix}}, include=[])  #type:ignore
        ids = hits.get("ids", []) if hits else []
        if ids:
            collection.delete(ids=ids)
    except Exception as e:  # noqa: BLE001
        logger.warning("向量库删除 %s 失败: %s", group_id_prefix, e)


if __name__ == "__main__":
    gid,count = add_document("事实核查（fact-checking）是指对公开言论或报道中的事实性主张进行核实的过程。常见流程包括提取主张、检索证据、比对来源并给出结论。")
    print(f"已写入向量库: group_id={gid}, 块数={count}")
    for text in search("什么是事实核查"):
        print("---")
        print(text)
