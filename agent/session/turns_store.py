from pathlib import Path

from langchain_chroma import Chroma
from langchain_openai import OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter

from ..config import EMBEDDING_API_KEY, EMBEDDING_BASE_URL, EMBEDDING_MODEL

#向量库持久化目录，与本模块同目录；与知识库的 chroma_db 完全分开
PERSIST_DIR = str(Path(__file__).parent / "chroma_db")

#embedding 客户端，未配置时为 None（与知识库向量库同一套配置）
_embeddings = OpenAIEmbeddings(
    model=EMBEDDING_MODEL,
    base_url=EMBEDDING_BASE_URL,
    api_key=EMBEDDING_API_KEY, #type:ignore
    check_embedding_ctx_length=False,
    chunk_size=20
) if EMBEDDING_API_KEY and EMBEDDING_BASE_URL and EMBEDDING_MODEL else None

#单轮过大时的切块器：2000 字符/块（按字符≈token 保守估算约 2000 token，
#绝大多数轮次不会触发；overlap=0 保证多块拼接能精确还原原文）
_splitter = RecursiveCharacterTextSplitter(chunk_size=2000, chunk_overlap=0)

#轮次正文的拼接模板，解析时按模板标记拆分
#注意：切块的边界恰好在 "\n" 处时，该换行会被 splitter 当作分隔符吃掉，
#所以解析标记用不含分隔符的 "助手："（切块可能把标记拦腰切断，但拼接后标记必然完整）
_USER_PREFIX = "用户："
_ASSISTANT_MARK = "助手："


def _get_store() -> Chroma:
    #获取向量库实例，未配置 embedding 时给出指引
    if _embeddings is None:
        raise RuntimeError("未配置 Embedding 模型，会话历史无法持久化，请在 .env 中设置 EMBEDDING_API_KEY、EMBEDDING_BASE_URL、EMBEDDING_MODEL")
    return Chroma(
        collection_name="conversation_turns",
        embedding_function=_embeddings,
        persist_directory=PERSIST_DIR
    )


def add_turn(session_id: str, seq: int, user_text: str, assistant_text: str) -> None:
    #把一轮对话（用户输入+助手回复）写入向量库；超过块大小时同轮切块，part 从 0 递增
    store = _get_store()
    text = f"{_USER_PREFIX}{user_text}\n{_ASSISTANT_MARK}{assistant_text}"
    parts = _splitter.split_text(text)
    store.add_texts(
        texts=parts,
        metadatas=[{"session_id": session_id, "seq": seq, "part": i} for i in range(len(parts))],
        ids=[f"{session_id}-{seq}-{i}" for i in range(len(parts))]
    )


def get_turns(session_id: str, after_seq: int = 0) -> list[tuple[int, str, str]]:
    #按 seq 升序返回 [(seq, 用户文本, 助手文本)]，只取 seq > after_seq 的轮次（重建上下文视图用）；
    #同轮多块按 part 排序拼回完整轮次（overlap=0，拼接即原文）
    store = _get_store()
    result = store._collection.get(
        where={"$and": [{"session_id": session_id}, {"seq": {"$gt": after_seq}}]},
        include=["documents", "metadatas"]
    )
    grouped: dict[int, list[tuple[int, str]]] = {}
    for doc, meta in zip(result["documents"], result["metadatas"]):
        grouped.setdefault(meta["seq"], []).append((meta["part"], doc or ""))
    turns = []
    for seq in sorted(grouped):
        text = "".join(part for _, part in sorted(grouped[seq]))
        #按模板标记拆分回用户/助手两段（只在首次出现的标记处切），用户段尾部可能残留被吃掉前的换行
        body = text[len(_USER_PREFIX):] if text.startswith(_USER_PREFIX) else text
        user_text, _, assistant_text = body.partition(_ASSISTANT_MARK)
        turns.append((seq, user_text.rstrip("\n"), assistant_text))
    return turns


def vector_search_turns(query: str, k: int = 6) -> list[str]:
    #按语义检索历史对话轮次，返回最相关的 k 个轮次片段（粗筛，精排在 store 层做）
    store = _get_store()
    docs = store.similarity_search(query, k=k)
    return [doc.page_content for doc in docs]


def delete_turns(session_id: str) -> None:
    #删除一个会话的全部轮次切片（级联删除用）
    store = _get_store()
    store._collection.delete(where={"session_id": session_id})
