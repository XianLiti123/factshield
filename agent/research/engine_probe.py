"""搜索引擎对照探测（诊断用）：对比 tavily/python/response_api 的返回速度与结果数。

运行：conda run -n suanfa_learning python -m agent.research.engine_probe
"""

from __future__ import annotations

import time

from agent import config
from agent.searchengine import search
from agent.session.search_config import get_engine


def main() -> None:
    print("TAVILY set:", bool(config.TAVILY_API_KEY))
    print("engine(user=1):", get_engine(1))
    for engine in ("tavily", "python", "response_api"):
        t0 = time.monotonic()
        try:
            items = search("NVIDIA 2024 annual report revenue data center",
                           engine, max_results=3, user_id=1)
            print(f"{engine:>13}: {time.monotonic() - t0:6.2f}s n={len(items)} "
                  f"first_url={items[0]['url'] if items else None}")
        except Exception as e:  # noqa: BLE001
            print(f"{engine:>13}: {time.monotonic() - t0:6.2f}s ERROR "
                  f"{type(e).__name__}: {str(e)[:180]}")


if __name__ == "__main__":
    main()
