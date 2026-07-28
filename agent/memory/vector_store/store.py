import uuid
from pathlib import Path
from langchain_openai import OpenAIEmbeddings
from langchain_chroma import Chroma
from langchain_text_splitters import RecursiveCharacterTextSplitter
from ...config import EMBEDDING_API_KEY,EMBEDDING_BASE_URL,EMBEDDING_MODEL

#向量库持久化目录，与本模块同目录
PERSIST_DIR = str(Path(__file__).parent / "chroma_db")

#embedding 客户端，未配置时为 None
#check_embedding_ctx_length=False：直接发送原文，不做 tiktoken 预分词
#（部分云端兼容接口不支持 token 数组格式的 input）
_embeddings = OpenAIEmbeddings(
    model=EMBEDDING_MODEL,
    base_url=EMBEDDING_BASE_URL,
    api_key=EMBEDDING_API_KEY, #type:ignore
    check_embedding_ctx_length=False
) if EMBEDDING_API_KEY and EMBEDDING_BASE_URL and EMBEDDING_MODEL else None

#文本切分器，按固定长度+重叠切分
_splitter = RecursiveCharacterTextSplitter(chunk_size=1000,chunk_overlap=200)


def _get_store() -> Chroma:
    #获取向量库实例，未配置 embedding 时给出指引
    if _embeddings is None:
        raise RuntimeError("未配置 Embedding 模型，请在 .env 中设置 EMBEDDING_API_KEY、EMBEDDING_BASE_URL、EMBEDDING_MODEL")
    return Chroma(
        collection_name="documents",
        embedding_function=_embeddings,
        persist_directory=PERSIST_DIR
    )


def add_document(content:str)->tuple[str,int]:
    #把一篇 Markdown 文档切分后写入向量库，返回 (组ID, 块数)
    #同一篇文档的所有块共享 group_id，用于和 SQLite 中的元数据对应
    store = _get_store()
    group_id = uuid.uuid4().hex
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


if __name__ == "__main__":
    gid,count = add_document("事实核查（fact-checking）是指对公开言论或报道中的事实性主张进行核实的过程。常见流程包括提取主张、检索证据、比对来源并给出结论。")
    print(f"已写入向量库: group_id={gid}, 块数={count}")
    for text in search("什么是事实核查"):
        print("---")
        print(text)
