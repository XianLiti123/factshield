"""研究流水线文件日志：logs/research-YYYYMMDD.log（每日一个文件，保留 30 天）。

所有研究流水线节点/LLM 调用/工具调用的关键事件统一走本模块的 logger，
数据库侧另有 research_step_logs 结构化记录，文件日志用于离线排查与崩溃现场。
"""

from __future__ import annotations

import logging
import os
from datetime import datetime
from pathlib import Path

_LOG_DIR = Path(__file__).resolve().parents[2] / "logs"
_RETENTION_DAYS = 30


class _DailyFileHandler(logging.Handler):
    """按日期切换日志文件：logs/research-YYYYMMDD.log。"""

    def __init__(self) -> None:
        super().__init__()
        self._file: object = None
        self._date = ""

    def _open_today(self):
        today = datetime.now().strftime("%Y%m%d")
        if self._date != today:
            if self._file is not None:
                try:
                    self._file.close()  # type: ignore[union-attr]
                except Exception:  # noqa: BLE001
                    pass
            _LOG_DIR.mkdir(parents=True, exist_ok=True)
            self._file = open(_LOG_DIR / f"research-{today}.log", "a", encoding="utf-8")
            self._date = today
            self._cleanup()
        return self._file

    def _cleanup(self) -> None:
        #删除超过保留期的研究日志文件（仅限本目录 research-*.log）
        try:
            cutoff = datetime.now().timestamp() - _RETENTION_DAYS * 86400
            for p in _LOG_DIR.glob("research-*.log"):
                try:
                    if p.stat().st_mtime < cutoff:
                        p.unlink(missing_ok=True)
                except OSError:
                    pass
        except OSError:
            pass

    def emit(self, record: logging.LogRecord) -> None:
        try:
            f = self._open_today()
            if f is None:
                return
            msg = self.format(record)
            f.write(msg + "\n")  # type: ignore[union-attr]
            f.flush()  # type: ignore[union-attr]
        except Exception:  # noqa: BLE001 日志失败不能影响主流程
            pass


_logger: logging.Logger | None = None


def get_research_logger() -> logging.Logger:
    """获取研究流水线专用 logger（进程内单例，幂等装配文件 handler）。"""
    global _logger
    if _logger is not None:
        return _logger
    logger = logging.getLogger("research")
    logger.setLevel(logging.INFO)
    logger.propagate = False
    if not any(isinstance(h, _DailyFileHandler) for h in logger.handlers):
        handler = _DailyFileHandler()
        handler.setFormatter(logging.Formatter(
            "%(asctime)s %(levelname)s [%(name)s] %(message)s"
        ))
        logger.addHandler(handler)
    _logger = logger
    return logger


def ensure_log_dir() -> Path:
    """确保日志目录存在（供调用方显式初始化，幂等）。"""
    _LOG_DIR.mkdir(parents=True, exist_ok=True)
    return _LOG_DIR


os.environ.setdefault("RESEARCH_LOG_READY", "1")
