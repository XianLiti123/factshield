"""Compatibility entry point for the pulled FastAPI application."""

from __future__ import annotations

import os

from dotenv import load_dotenv


_DEEPSEEK_KEY = "DEEPSEEK-API-KEY"
_TAVILY_KEY = "TAVILY_API_KEY"
_PLACEHOLDER = "factshield-import-only-placeholder"


def _restore_env(name: str, value: str | None) -> None:
    if value is None:
        os.environ.pop(name, None)
    else:
        os.environ[name] = value


load_dotenv()
_real_deepseek = os.environ.get(_DEEPSEEK_KEY)
_real_tavily = os.environ.get(_TAVILY_KEY)
os.environ.setdefault(_DEEPSEEK_KEY, _PLACEHOLDER)
os.environ.setdefault(_TAVILY_KEY, _PLACEHOLDER)

from agent import config as agent_config  # noqa: E402

# Do not expose import-only placeholders as configured capabilities or migrate
# them into a user's model settings.
_restore_env(_DEEPSEEK_KEY, _real_deepseek)
agent_config.DEEPSEEK_API_KEY = _real_deepseek
agent_config.TAVILY_API_KEY = _real_tavily

try:
    # The pulled pipeline constructs Tavily at import time. The UI blocks task
    # creation when the real key is absent, while basic API routes stay usable.
    from api.main import app  # noqa: E402,F401
finally:
    _restore_env(_TAVILY_KEY, _real_tavily)
