from langchain_core.tools import tool
import os
import requests

_DOWNLOAD_DIR = "workspace/downloads"

@tool
def download_file(url: str, save_path: str = "") -> str:
    """从指定 URL 下载网络文件（PDF、Word、图片、压缩包、网页数据等）到本地。
    当需要把网上的文档或数据保存下来再处理（如下载后用 convert_document 或 ai_recognize_document 读取）时使用。
    url 为文件地址；save_path 为保存路径（含文件名），留空则保存到 downloads/ 目录并自动从 URL 推断文件名。"""
    try:
        response = requests.get(url, stream=True, timeout=30)
        response.raise_for_status()
    except Exception as e:
        return f"下载失败: {e}"

    if not save_path:
        filename = url.split("?")[0].rstrip("/").split("/")[-1] or "downloaded_file"
        save_path = os.path.join(_DOWNLOAD_DIR, filename)

    parent = os.path.dirname(save_path)
    if parent:
        os.makedirs(parent, exist_ok=True)

    try:
        with open(save_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
    except Exception as e:
        return f"文件保存失败: {e}"

    size = os.path.getsize(save_path)
    return f"下载完成: {save_path}（{size} 字节），可用 convert_document 或 ai_recognize_document 读取其内容"
