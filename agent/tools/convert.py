from langchain_core.tools import tool
from markitdown import MarkItDown
from ..memory.SQLite.save import save_markdown

_md = MarkItDown()

@tool
def convert_document(file_path: str, max_length: int = 5000, safe: bool = True) -> str:
    """将本地文档（如 PDF、Word、PPT、Excel、HTML、图片等）转换为 Markdown 文本。
    当需要读取或分析本地文档内容时使用。
    file_path 为文件路径；max_length 为返回内容的最大字符数，默认 5000，
    传 0 表示不截断返回全文；safe 默认为 True，会将完整未截断的 Markdown 保存到本地。"""
    try:
        result = _md.convert(file_path)
    except Exception as e:
        return f"文档转换失败: {e}"
    content = result.text_content
    if safe:
        save_markdown(content)#保存完整内容，不受截断影响
    if max_length > 0:
        content = content[:max_length]
    return content or "文档内容为空"
