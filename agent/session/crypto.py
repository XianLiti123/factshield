import logging
import os
from pathlib import Path

from cryptography.fernet import Fernet

logger = logging.getLogger(__name__)

#master key 本地文件（缺省自动生成时用），绝不入库、绝不入 git（.gitignore 已排除）
_KEY_FILE = Path(__file__).parent / ".master_key"


def _load_master_key() -> bytes:
    #获取 master key：FS_MASTER_KEY 环境变量优先（生产部署用 systemd/docker 注入）；
    #缺省时从本地文件读取，文件不存在则生成一把新 key 存入（权限 0o600，Windows 上 chmod 无效则忽略）
    env_key = os.getenv("FS_MASTER_KEY")
    if env_key:
        logger.info("master key 来自环境变量 FS_MASTER_KEY")
        return env_key.encode()
    if _KEY_FILE.exists():
        logger.info("master key 来自本地文件 %s", _KEY_FILE)
        return _KEY_FILE.read_bytes().strip()
    key = Fernet.generate_key()
    _KEY_FILE.write_bytes(key)
    try:
        os.chmod(_KEY_FILE, 0o600)
    except OSError:
        pass
    logger.warning("已自动生成 master key 存于 %s；生产环境请改用 FS_MASTER_KEY 环境变量注入，"
                   "并确保该文件随数据卷持久化（丢失后已保存的 api_key 将无法解密）", _KEY_FILE)
    return key


try:
    _fernet = Fernet(_load_master_key())
except (ValueError, TypeError) as e:
    raise RuntimeError(
        f"FS_MASTER_KEY 非法，无法初始化加密器（需 32 字节 urlsafe-base64 编码的 Fernet key，"
        f"可用 `python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\"` 生成）: {e}"
    ) from e


def encrypt(plain: str) -> str:
    #加密明文（如 API key），返回可入库的密文字符串
    return _fernet.encrypt(plain.encode()).decode()


def decrypt(cipher: str) -> str:
    #解密密文字符串；密文被篡改或 master key 不匹配时抛异常
    return _fernet.decrypt(cipher.encode()).decode()
