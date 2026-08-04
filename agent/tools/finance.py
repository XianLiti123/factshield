import contextlib
import io
import logging

import requests
from langchain_core.tools import tool

from .. import config

#金融数据源工具（东方财富财报 + TickFlow 行情K线），供 finance 工具集按需激活
#财报查询优先 HTTPS 直连东方财富接口（efinance 库内部硬编码 http:// 80 端口，
#在部分网络下会被远端拒绝连接，故仅作兜底）；TickFlow 免费档仅历史日K；
#所有异常都降级为文本错误返回，不中断对话

logger = logging.getLogger(__name__)

_tickflow_client = None


def _get_tickflow():
    #TickFlow 客户端：配置了 TICKFLOW_API_KEY 用完整服务，否则免费档（仅历史日K/标的信息）
    #免费档初始化会打印横幅，这里吞掉避免污染日志
    global _tickflow_client
    if _tickflow_client is None:
        from tickflow import TickFlow
        with contextlib.redirect_stdout(io.StringIO()):
            _tickflow_client = TickFlow(api_key=config.TICKFLOW_API_KEY) if config.TICKFLOW_API_KEY else TickFlow.free()
    return _tickflow_client


def _yi(value: object) -> str:
    #数值转"亿元"字符串，无法解析原样返回
    try:
        return f"{float(value) / 1e8:.2f}亿元"
    except (TypeError, ValueError):
        return str(value)


_EASTMONEY_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"),
    "Referer": "https://quote.eastmoney.com/",
}
_EASTMONEY_TIMEOUT = 15


def _market_secid(code: str) -> str:
    #东方财富行情 secid：沪市(6/9 开头)为 1.代码，深市/北交所为 0.代码
    return f"1.{code}" if code.startswith(("6", "9")) else f"0.{code}"


def _eastmoney_get(url: str, params: dict) -> dict:
    resp = requests.get(url, params=params, headers=_EASTMONEY_HEADERS, timeout=_EASTMONEY_TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def _fmt_pct(value: object, signed: bool = False) -> str:
    #百分比格式化；空值/非法值返回 —，不打断整行输出
    try:
        num = float(value)
    except (TypeError, ValueError):
        return "—"
    return f"{num:+.2f}%" if signed else f"{num:.2f}%"


def _fetch_base_info_https(code: str) -> dict:
    #股票基础信息（名称/行业/总市值/ROE/毛利率），HTTPS 直连 push2 行情接口
    data = _eastmoney_get("https://push2.eastmoney.com/api/qt/stock/get", {
        "ut": "fa5fd1943c7b386f172d6893dbfba10b",
        "invt": "2",
        "fltt": "2",
        "fields": "f57,f58,f127,f116,f173,f186",
        "secid": _market_secid(code),
    }).get("data") or {}
    if not data:
        return {}
    return {
        "股票名称": data.get("f58"),
        "所处行业": data.get("f127"),
        "总市值": data.get("f116"),
        "ROE": data.get("f173"),
        "毛利率": data.get("f186"),
    }


def _fetch_performance_https(code: str) -> list[dict]:
    #业绩报表（RPT_LICO_FN_CPD）：只按股票代码取数，按报告期倒序返回最近若干期
    payload = _eastmoney_get("https://datacenter-web.eastmoney.com/api/data/v1/get", {
        "reportName": "RPT_LICO_FN_CPD",
        "columns": "ALL",
        "filter": f'(SECURITY_CODE="{code}")',
        "sortColumns": "REPORTDATE",
        "sortTypes": "-1",
        "pageSize": "12",
        "pageNumber": "1",
        "source": "WEB",
        "client": "WEB",
    })
    rows = ((payload.get("result") or {}).get("data")) or []
    records = []
    for row in rows:
        records.append({
            "报告期": str(row.get("REPORTDATE") or "")[:10],
            "公告日期": str(row.get("NOTICE_DATE") or "")[:10],
            "营业收入": row.get("TOTAL_OPERATE_INCOME"),
            "营收同比": row.get("YSTZ"),
            "净利润": row.get("PARENT_NETPROFIT"),
            "净利同比": row.get("SJLTZ"),
            "ROE": row.get("WEIGHTAVG_ROE") if row.get("WEIGHTAVG_ROE") is not None else row.get("ROEJQ"),
            "毛利率": row.get("XSMLL"),
        })
    return records


def _format_performance_record(record: dict) -> str:
    return (f"报告期 {record['报告期']}（公告 {record['公告日期']}）："
            f"营业收入 {_yi(record['营业收入'])}（同比 {_fmt_pct(record['营收同比'], signed=True)}），"
            f"净利润 {_yi(record['净利润'])}（同比 {_fmt_pct(record['净利同比'], signed=True)}），"
            f"净资产收益率 {_fmt_pct(record['ROE'])}，销售毛利率 {_fmt_pct(record['毛利率'])}")


def _query_financials_https(code: str, report_date: str) -> str:
    lines: list[str] = []
    try:
        base = _fetch_base_info_https(code)
    except Exception as exc:  #基础信息失败不阻塞财报查询
        logger.warning("东方财富基础信息 HTTPS 请求失败: %s", exc)
        base = {}
    if base.get("股票名称"):
        lines.append(
            f"【{base['股票名称']}（{code}）】行业：{base.get('所处行业') or '—'}；"
            f"总市值：{_yi(base.get('总市值'))}；ROE：{_fmt_pct(base.get('ROE'))}；"
            f"毛利率：{_fmt_pct(base.get('毛利率'))}")

    records = _fetch_performance_https(code)
    if not records:
        lines.append(f"未获取到 {code} 的业绩报表（可能尚未披露或接口无数据）。")
        return "\n".join(lines)

    if report_date:
        target = report_date.strip()
        hit = next((r for r in records if r["报告期"].startswith(target[:10])), None)
        if hit is None:
            recent = "、".join(r["报告期"] for r in records[:4])
            lines.append(f"未找到 {code} 在报告期 {target} 的业绩报表（接口最近返回：{recent}）。")
            return "\n".join(lines)
        lines.append(_format_performance_record(hit))
        return "\n".join(lines)

    #未指定报告期时取最新一期（接口已按报告期倒序）
    lines.append(_format_performance_record(records[0]))
    return "\n".join(lines)


def _query_financials_efinance(code: str, report_date: str) -> str:
    #efinance 兜底：仅在 HTTPS 直连失败时使用（其内部部分接口硬编码 http:// 80 端口）
    import efinance as ef
    lines = [f"【{ef.stock.get_base_info(code)['股票名称']}（{code}）】"]
    dates = [report_date] if report_date else ef.stock.get_all_report_dates()["报告日期"].tolist()[:4]
    for date in dates:
        df = ef.stock.get_all_company_performance(date=date)
        hit = df[df["股票代码"].astype(str) == code]
        if hit.empty:
            continue
        r = hit.iloc[0]
        lines.append(
            f"报告期 {date}（公告 {str(r['公告日期'])[:10]}）："
            f"营业收入 {_yi(r['营业收入'])}（同比 {r['营业收入同比增长']:+.2f}%），"
            f"净利润 {_yi(r['净利润'])}（同比 {r['净利润同比增长']:+.2f}%），"
            f"净资产收益率 {r['净资产收益率']}%，销售毛利率 {r['销售毛利率']:.1f}%")
        return "\n".join(lines)
    return "\n".join(lines) + f"\n未找到 {code} 在报告期 {report_date or '最近四期'} 的业绩报表（可能尚未披露）。"


@tool
def query_stock_financials(stock_code: str, report_date: str = "") -> str:
    """查询 A 股上市公司的财务数据（来源：东方财富）。当需要核验某家 A 股公司的营业收入、
    净利润、同比增长等财务主张时使用，数据本质来自公司定期报告。
    stock_code 为 6 位 A 股代码（如 600519、300750）；
    report_date 为报告期（如 2026-03-31），缺省自动取该公司已披露的最新一期。"""
    code = stock_code.strip().split(".")[0]
    try:
        return _query_financials_https(code, report_date)
    except Exception as e:
        logger.warning("东方财富 HTTPS 直连失败，回退 efinance: %s", e)
        try:
            return _query_financials_efinance(code, report_date)
        except Exception as fallback_error:
            return f"财务数据查询失败（efinance 源可能受限）: {fallback_error}"


@tool
def query_stock_kline(symbol: str, period: str = "1d", count: int = 30) -> str:
    """查询股票/指数/ETF 的历史 K 线行情（来源：TickFlow），支持 A 股/美股/港股。
    当需要核验股价、涨跌幅、历史走势类主张，或需要某个时间段的行情序列时使用。
    symbol 为统一标的代码：A股如 600519.SH、000001.SZ、920662.BJ；美股如 AAPL.US；港股如 00700.HK。
    period 为周期：1d（日）/1w（周）/1M（月）；count 为返回根数（最多 120，返回最近的 count 根）。"""
    if period not in ("1d", "1w", "1M"):
        return "period 仅支持 1d（日K）/1w（周K）/1M（月K）；分钟级 K 线需要配置 TickFlow API key 的完整服务"
    count = max(1, min(int(count), 120))
    try:
        tf = _get_tickflow()
        k = tf.klines.get(symbol.strip().upper(), period=period, count=count)
        from datetime import datetime
        rows = []
        for i in range(len(k["timestamp"])):
            day = datetime.fromtimestamp(k["timestamp"][i] / 1000).strftime("%Y-%m-%d")
            rows.append(f"{day} | 开 {k['open'][i]} 高 {k['high'][i]} 低 {k['low'][i]} "
                        f"收 {k['close'][i]} 量 {k['volume'][i]}")
        if not rows:
            return f"未获取到 {symbol} 的 K 线数据（标的代码可能有误）"
        return f"{symbol} {period} K线（最近 {len(rows)} 根）：\n" + "\n".join(rows)
    except Exception as e:
        return f"K线查询失败（TickFlow 源可能受限）: {e}"


@tool
def query_realtime_quotes(symbols: list[str]) -> str:
    """查询股票实时行情快照（来源：TickFlow，需在服务端配置 TICKFLOW_API_KEY）。
    当需要当前最新价、涨跌幅等盘中数据时使用；symbols 为统一标的代码列表，如 ["600519.SH", "AAPL.US"]。
    只需要历史收盘价时请改用 query_stock_kline（免费且稳定）。"""
    if not config.TICKFLOW_API_KEY:
        return "实时行情需要完整服务：请在 .env 配置 TICKFLOW_API_KEY 后重试；历史日K可用 query_stock_kline 免费查询"
    try:
        tf = _get_tickflow()
        quotes = tf.quotes.get(symbols=[s.strip().upper() for s in symbols])
        return "\n".join(str(q) for q in quotes) or "未获取到行情数据"
    except Exception as e:
        return f"实时行情查询失败: {e}"
