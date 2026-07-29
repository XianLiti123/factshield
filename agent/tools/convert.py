from langchain_core.tools import tool
from markitdown import MarkItDown
from openai import OpenAI
from typing import Annotated
import base64
import logging
import os
from langgraph.prebuilt import InjectedState
from ..memory.SQLite.save import save_markdown
from ..session.model_config import get_config

#压住 pdfminer 对不规范 PDF 字体信息的刷屏警告（如 FontBBox 缺失），不影响解析结果
logging.getLogger("pdfminer").setLevel(logging.ERROR)

_md = MarkItDown()

_IMAGE_EXTS = {".jpg",".jpeg",".png",".gif",".bmp",".webp",".tiff"}

#每用户视觉模型客户端缓存：按 user_id 装配（随图状态注入，线程安全）
_vision_clients:dict[int,tuple[OpenAI,str]] = {}


def _get_vision_client(user_id:int)->tuple[OpenAI,str]|None:
    #取当前用户的视觉模型客户端和模型名；未配置时返回 None
    if user_id not in _vision_clients:
        cfg = get_config(user_id,"vision")
        if cfg is None:
            return None
        _vision_clients[user_id] = (OpenAI(api_key=cfg["api_key"],base_url=cfg["base_url"]),cfg["model_name"])
    return _vision_clients[user_id]


def _image_to_markdown(client:OpenAI,model:str,image_bytes:bytes,image_type:str)->str:
    #把一张图片交给视觉模型识别，返回 Markdown
    b64 = base64.b64encode(image_bytes).decode()
    response = client.chat.completions.create(
        model=model,
        messages=[{"role":"user","content":[
            {"type":"text","text":"请完整识别这张图片中的所有内容，包括文字、表格和图表，以 Markdown 格式输出。"},
            {"type":"image_url","image_url":{"url":f"data:image/{image_type};base64,{b64}"}}
        ]}]
    )
    return response.choices[0].message.content

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
    save_error = None
    if safe:
        try:
            save_markdown(content)#保存完整内容，不受截断影响
        except Exception as e:
            save_error = e#保存失败不影响转换结果返回
    if max_length > 0:
        content = content[:max_length]
    if save_error:
        content += f"\n\n[提示] 完整内容保存到知识库失败: {save_error}"
    return content or "文档内容为空"


@tool
def ai_recognize_document(file_path: str, max_length: int = 5000, safe: bool = True,
                          user_id: Annotated[int, InjectedState("user_id")] = None) -> str:
    """AI 高精度识别：调用视觉大模型识别图片或 PDF（含扫描件）的内容，输出 Markdown。
    仅支持图片（jpg/png 等）和 PDF 文件；Word、Excel、HTML 等其他格式请使用 convert_document。
    file_path 为文件路径；max_length 为返回内容的最大字符数，默认 5000，
    传 0 表示不截断返回全文；safe 默认为 True，会将完整未截断的 Markdown 保存到本地。"""
    vision = _get_vision_client(user_id)
    if vision is None:
        return "未配置视觉模型，请先在设置中配置视觉模型的 base_url、api_key 和模型名"
    client, model = vision
    ext = os.path.splitext(file_path)[1].lower()
    try:
        if ext in _IMAGE_EXTS:
            with open(file_path,"rb") as f:
                content = _image_to_markdown(client,model,f.read(),ext.lstrip(".").replace("jpg","jpeg"))
        elif ext == ".pdf":
            import fitz#即 pymupdf，把每页渲染成图片再识别
            pages = []
            with fitz.open(file_path) as doc:
                for i,page in enumerate(doc,1):
                    png = page.get_pixmap(dpi=150).tobytes("png")
                    pages.append(f"## 第 {i} 页\n\n" + _image_to_markdown(client,model,png,"png"))
            content = "\n\n".join(pages)
        else:
            return f"该工具仅支持图片和 PDF 文件（收到 {ext or '未知类型'}），其他格式请使用 convert_document"
    except Exception as e:
        return f"AI 识别失败: {e}"
    save_error = None
    if safe:
        try:
            save_markdown(content)#保存完整内容，不受截断影响
        except Exception as e:
            save_error = e#保存失败不影响转换结果返回
    if max_length > 0:
        content = content[:max_length]
    if save_error:
        content += f"\n\n[提示] 完整内容保存到知识库失败: {save_error}"
    return content or "识别结果为空"
