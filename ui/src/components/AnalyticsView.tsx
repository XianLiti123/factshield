import { useEffect, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import dayjs from 'dayjs'
import advancedFormat from 'dayjs/plugin/advancedFormat'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import localeData from 'dayjs/plugin/localeData'
import weekOfYear from 'dayjs/plugin/weekOfYear'
import weekYear from 'dayjs/plugin/weekYear'
import weekday from 'dayjs/plugin/weekday'
import {
  AimOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  DatabaseOutlined,
  HistoryOutlined,
  LinkOutlined,
  LineChartOutlined,
  PaperClipOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import { Button, DatePicker, Empty, Input, Segmented, Select, Table, message } from 'antd'
import type { ResearchRun } from '../types'
import {
  EMPTY_HISTORY_ANALYSIS_CONFIG,
  getActiveTask,
  useWorkspaceStore,
  type HistoryAnalysisConfig,
} from '../store'
import {
  attachHistoryAnalysis,
  getHistoryAnalysis,
  startHistoryAnalysis,
  type HistoryAnalysis,
  type HistoryAnalysisEvent,
  type HistoryAnalysisPoint,
  type HistoryAnalysisRequest,
} from '../services/api'

// Ant Design's date panel calls weekday/localeData on the Dayjs instance it receives.
// The app and rc-picker can resolve separate Dayjs copies under pnpm, so extend this
// instance explicitly before passing values to DatePicker.
dayjs.extend(customParseFormat)
dayjs.extend(advancedFormat)
dayjs.extend(weekday)
dayjs.extend(localeData)
dayjs.extend(weekOfYear)
dayjs.extend(weekYear)

const POLL_INTERVAL = 2500
const POLL_LIMIT = 72

type DisplayMode = 'relative' | 'raw'
type TimeGranularity = 'month' | 'quarter' | 'year' | 'unknown'

type PreparedPoint = HistoryAnalysisPoint & {
  month: number | null
  offset: number | null
  sourceIndex: number
  granularity: TimeGranularity
}

type EventPath = {
  event: HistoryAnalysisEvent
  eventMonth: number | null
  points: PreparedPoint[]
  baseline: PreparedPoint | null
  baselineIndex: number
  exactT0: boolean
  canAlign: boolean
  granularity: TimeGranularity
  excludedPointCount: number
  alignmentReason: string
}

function parseObservationTime(value: string): { month: number | null; granularity: TimeGranularity } {
  const matched = value.match(/(\d{4})\s*(?:[-/.]|年)\s*(\d{1,2})(?:\s*月|(?=\D|$))/)
  if (matched) {
    const year = Number(matched[1])
    const month = Number(matched[2])
    if (Number.isInteger(year) && month >= 1 && month <= 12) {
      return { month: year * 12 + month - 1, granularity: 'month' }
    }
  }

  const quarterMatched = value.match(/(\d{4})\s*(?:[-/.年]?\s*(?:Q|q|第)\s*([1-4])\s*(?:季度|季)?)/)
  if (quarterMatched) {
    const year = Number(quarterMatched[1])
    const quarter = Number(quarterMatched[2])
    return { month: year * 12 + (quarter - 1) * 3, granularity: 'quarter' }
  }

  const yearMatched = value.trim().match(/^(\d{4})\s*年?$/)
  if (yearMatched) return { month: Number(yearMatched[1]) * 12, granularity: 'year' }
  return { month: null, granularity: 'unknown' }
}

function granularityLabel(granularity: TimeGranularity) {
  if (granularity === 'month') return '月度'
  if (granularity === 'quarter') return '季度'
  if (granularity === 'year') return '年度'
  return '日期不明'
}

function observedAfterBaseline(path: EventPath) {
  if (!path.baseline || path.baselineIndex < 0) return []
  return path.points.slice(path.baselineIndex + 1)
}

function observedAfterEvent(path: EventPath) {
  if (!path.baseline) return []
  return observedAfterBaseline(path).filter((point) => !path.canAlign || point.offset! >= 0)
}

function formatNumber(value: number, maximumFractionDigits = 2) {
  return value.toLocaleString('zh-CN', { maximumFractionDigits })
}

function withUnit(value: number, unit: string) {
  return `${formatNumber(value)}${unit ? ` ${unit}` : ''}`
}

function signedValue(value: number, suffix: string) {
  const sign = value > 0 ? '+' : ''
  return `${sign}${formatNumber(value)}${suffix}`
}

function prepareEventPath(event: HistoryAnalysisEvent): EventPath {
  const eventTime = parseObservationTime(event.period)
  const eventMonth = eventTime.granularity === 'month' ? eventTime.month : null
  const prepared = event.points
    .filter((point) => Number.isFinite(point.value))
    .map((point, sourceIndex) => {
      const parsedTime = parseObservationTime(point.t)
      return {
        ...point,
        month: parsedTime.month,
        offset: eventMonth !== null && parsedTime.granularity === 'month' && parsedTime.month !== null
          ? parsedTime.month - eventMonth
          : null,
        sourceIndex,
        granularity: parsedTime.granularity,
      }
    })

  const granularityCounts = prepared.reduce<Record<TimeGranularity, number>>((counts, point) => {
    counts[point.granularity] += 1
    return counts
  }, { month: 0, quarter: 0, year: 0, unknown: 0 })
  const comparableGranularities: TimeGranularity[] = ['month', 'quarter', 'year']
  const granularity = comparableGranularities.reduce<TimeGranularity>((selected, candidate) => (
    granularityCounts[candidate] > granularityCounts[selected] ? candidate : selected
  ), granularityCounts.month > 0 ? 'month' : granularityCounts.quarter > 0 ? 'quarter' : granularityCounts.year > 0 ? 'year' : 'unknown')
  const selectedPoints = granularity === 'unknown'
    ? prepared
    : prepared.filter((point) => point.granularity === granularity)
  const points = [...selectedPoints].sort((left, right) => {
    if (left.month !== null && right.month !== null) return left.month - right.month
    if (left.month !== null) return -1
    if (right.month !== null) return 1
    return left.sourceIndex - right.sourceIndex
  })
  const canAlign = eventMonth !== null
    && granularity === 'month'
    && points.length > 0
    && points.every((point) => point.offset !== null)
  const baseline = points.length === 0
    ? null
    : canAlign
      ? points.reduce((nearest, point) => Math.abs(point.offset!) < Math.abs(nearest.offset!) ? point : nearest, points[0])
      : null
  const baselineIndex = baseline ? points.indexOf(baseline) : -1
  const excludedPointCount = prepared.length - points.length
  const alignmentReason = eventTime.granularity !== 'month'
    ? `事件时点“${event.period}”没有精确到月，不能确定 T0`
    : granularity !== 'month'
      ? `可用数据以${granularityLabel(granularity)}口径为主，不能与月度 T0 对齐`
      : points.length === 0
        ? '没有可用于对齐的数据点'
        : ''

  return {
    event,
    eventMonth,
    points,
    baseline,
    baselineIndex,
    exactT0: baseline?.offset === 0,
    canAlign,
    granularity,
    excludedPointCount,
    alignmentReason,
  }
}

function coverageText(path: EventPath) {
  if (path.points.length === 0) return '没有取得数据点'
  if (!path.canAlign) return `${granularityLabel(path.granularity)}数据 · ${path.points.length} 期（已按时间升序）`
  const offsets = path.points.map((point) => point.offset!)
  const formatOffset = (value: number) => value === 0 ? 'T0' : `T${value > 0 ? '+' : ''}${value}`
  return `${formatOffset(Math.min(...offsets))} 至 ${formatOffset(Math.max(...offsets))}`
}

function rangeText(path: EventPath) {
  if (path.points.length === 0) return '没有取得数据点'
  const first = path.points[0]?.t
  const last = path.points.at(-1)?.t
  return first === last ? first : `${first} 至 ${last}`
}

function getHistorySourceUrl(value: string) {
  const rawUrl = value.trim()
  if (!rawUrl) return null
  try {
    const normalizedUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : rawUrl.startsWith('//') ? `https:${rawUrl}` : `https://${rawUrl}`
    const parsedUrl = new URL(normalizedUrl)
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:' ? parsedUrl.href : null
  } catch {
    return null
  }
}

function openHistorySource(value: string) {
  const sourceUrl = getHistorySourceUrl(value)
  if (!sourceUrl) {
    message.warning('该来源地址无效，无法打开')
    return
  }
  const sourceWindow = window.open(sourceUrl, '_blank', 'noopener,noreferrer')
  if (sourceWindow) sourceWindow.opener = null
  else message.warning('浏览器阻止了新窗口，请允许本站打开新标签页后重试')
}

function parseHistoryDate(value: string) {
  const normalized = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null
  const parsed = dayjs(normalized)
  return parsed.isValid() && parsed.format('YYYY-MM-DD') === normalized ? parsed : null
}

function normalizeHistoryDate(value: string) {
  return parseHistoryDate(value) ? value.trim() : ''
}

function normalizeHistoryAnalysisConfig(config: HistoryAnalysisConfig): HistoryAnalysisConfig {
  return {
    metric: config.metric.trim(),
    scenarios: config.scenarios.trim(),
    start: normalizeHistoryDate(config.start),
    end: normalizeHistoryDate(config.end),
    frequency: config.frequency,
  }
}

function isCustomHistoryAnalysis(config: HistoryAnalysisConfig) {
  return Boolean(config.metric || config.scenarios || config.start || config.end || config.frequency !== 'auto')
}

function toHistoryAnalysisRequest(config: HistoryAnalysisConfig): HistoryAnalysisRequest {
  return {
    metric: config.metric || null,
    scenarios: config.scenarios.split(/[\n,，;；]+/).map((item) => item.trim()).filter(Boolean),
    start: config.start || null,
    end: config.end || null,
    frequency: config.frequency,
  }
}

const frequencyLabels = {
  auto: '系统判断',
  monthly: '月度',
  quarterly: '季度',
  yearly: '年度',
} as const

export function AnalyticsView({ run }: { run: ResearchRun }) {
  const activeTask = useWorkspaceStore(getActiveTask)
  const historyAnalysisJob = useWorkspaceStore((state) => state.historyAnalysisJobs[run.id])
  const historyAnalysisConfig = useWorkspaceStore((state) => (
    state.historyAnalysisConfigs[run.id] ?? EMPTY_HISTORY_ANALYSIS_CONFIG
  ))
  const setHistoryAnalysisConfig = useWorkspaceStore((state) => state.setHistoryAnalysisConfig)
  const resetHistoryAnalysisConfig = useWorkspaceStore((state) => state.resetHistoryAnalysisConfig)
  const startHistoryAnalysisJob = useWorkspaceStore((state) => state.startHistoryAnalysisJob)
  const finishHistoryAnalysisJob = useWorkspaceStore((state) => state.finishHistoryAnalysisJob)
  const persisted = Boolean(activeTask.persisted && !activeTask.isDemo)
  const [analysis, setAnalysis] = useState<HistoryAnalysis | null>(null)
  const [displayMode, setDisplayMode] = useState<DisplayMode>('relative')
  const [loading, setLoading] = useState(false)
  const [attaching, setAttaching] = useState(false)
  const running = Boolean(historyAnalysisJob)
  const normalizedConfig = normalizeHistoryAnalysisConfig(historyAnalysisConfig)
  const customMode = isCustomHistoryAnalysis(normalizedConfig)

  const updateConfig = <K extends keyof HistoryAnalysisConfig>(key: K, value: HistoryAnalysisConfig[K]) => {
    setHistoryAnalysisConfig(run.id, { ...historyAnalysisConfig, [key]: value })
  }

  useEffect(() => {
    let cancelled = false
    setDisplayMode('relative')
    if (!persisted) {
      setAnalysis(null)
      setLoading(false)
      return () => { cancelled = true }
    }
    setLoading(true)
    getHistoryAnalysis(run.id)
      .then((result) => { if (!cancelled) setAnalysis(result) })
      .catch((error) => { if (!cancelled) message.error(error instanceof Error ? error.message : '历史情景结果读取失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [persisted, run.id])

  useEffect(() => {
    if (!running || !persisted) return
    let cancelled = false
    let attempts = 0
    const poll = async () => {
      attempts += 1
      try {
        const result = await getHistoryAnalysis(run.id)
        if (cancelled) return
        if (result && result.id !== historyAnalysisJob.baselineAnalysisId) {
          setAnalysis(result)
          setDisplayMode('relative')
          finishHistoryAnalysisJob(run.id)
          message.success('历史情景复盘已生成')
          return
        }
        if (attempts >= POLL_LIMIT) {
          finishHistoryAnalysisJob(run.id)
          message.warning('暂未取得新结果，可稍后重新进入本页查看')
        }
      } catch (error) {
        if (!cancelled) {
          finishHistoryAnalysisJob(run.id)
          message.error(error instanceof Error ? error.message : '历史情景结果读取失败')
        }
      }
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, POLL_INTERVAL)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [finishHistoryAnalysisJob, historyAnalysisJob, persisted, run.id, running])

  const startAnalysis = async () => {
    if (!persisted) {
      message.info('演示任务不会生成虚构历史情景，请选择真实任务后运行')
      return
    }
    if (normalizedConfig.start && normalizedConfig.end && normalizedConfig.start > normalizedConfig.end) {
      message.warning('开始时间不能晚于结束时间')
      return
    }
    const baselineAnalysisId = analysis?.id ?? null
    startHistoryAnalysisJob(run.id, baselineAnalysisId, normalizedConfig)
    try {
      await startHistoryAnalysis(run.id, customMode ? toHistoryAnalysisRequest(normalizedConfig) : undefined)
      message.success(customMode ? '已按你填写的比较要求提交，结果生成后会自动显示在本页' : '已按系统推荐提交，结果生成后会自动显示在本页')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '历史情景复盘启动失败'
      if (errorMessage.includes('已有正在运行')) {
        message.info('已重新接入正在运行的历史情景复盘')
        return
      }
      finishHistoryAnalysisJob(run.id)
      message.error(errorMessage)
    }
  }

  const attachAnalysis = async () => {
    if (!analysis || analysis.attached) return
    setAttaching(true)
    try {
      await attachHistoryAnalysis(run.id)
      setAnalysis({ ...analysis, attached: true })
      message.success('历史情景复盘已加入研究底稿附件')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加入底稿失败')
    } finally {
      setAttaching(false)
    }
  }

  const eventPaths = useMemo(() => analysis?.events.map(prepareEventPath) ?? [], [analysis])
  const totalPoints = eventPaths.reduce((sum, path) => sum + path.points.length, 0)
  const canAlignAll = eventPaths.length > 0 && eventPaths.every((path) => path.canAlign)
  const excludedPointCount = eventPaths.reduce((sum, path) => sum + path.excludedPointCount, 0)
  const relativeAsPercent = canAlignAll && eventPaths.every((path) => path.baseline && path.baseline.value !== 0)
  const completeness = analysis
    ? Math.max(0, Math.min(100, analysis.completeness <= 1 ? analysis.completeness * 100 : analysis.completeness))
    : 0

  const relativeValue = (value: number, baseline: number) => (
    relativeAsPercent ? ((value - baseline) / Math.abs(baseline)) * 100 : value - baseline
  )
  const relativeSuffix = relativeAsPercent ? '%' : analysis?.unit ? ` ${analysis.unit}` : ''

  useEffect(() => {
    if (!canAlignAll && displayMode === 'relative') setDisplayMode('raw')
  }, [canAlignAll, displayMode])

  const chartModel = useMemo(() => {
    if (!analysis || eventPaths.length === 0) return null
    const series = eventPaths.map((path, seriesIndex) => ({
      name: path.event.name,
      type: 'line',
      smooth: false,
      connectNulls: false,
      symbol: 'circle',
      symbolSize: 7,
      data: path.points.map((point, index) => ({
        value: [canAlignAll ? point.offset! : index + 1, displayMode === 'relative' && canAlignAll && path.baseline
          ? relativeValue(point.value, path.baseline.value)
          : point.value],
        observedAt: point.t,
        rawValue: point.value,
        baselineAt: path.baseline?.t ?? '',
        baselineValue: path.baseline?.value ?? null,
      })),
      lineStyle: { width: 2.4 },
      emphasis: { focus: 'series' },
      markLine: seriesIndex === 0 && canAlignAll ? {
        silent: true,
        symbol: 'none',
        label: { formatter: 'T0', color: '#64756f', fontFamily: 'MiSans', fontSize: 10 },
        lineStyle: { color: '#aab8b4', type: 'dashed', width: 1 },
        data: [{ xAxis: 0 }],
      } : undefined,
    }))

    return {
      option: {
        color: ['#0d6575', '#d39a43', '#3f86a2', '#7f6bb0'],
        textStyle: { fontFamily: 'MiSans', color: '#405651', fontSize: 12 },
        tooltip: {
          trigger: 'axis',
          confine: true,
          textStyle: { fontFamily: 'MiSans', fontSize: 12, color: '#263f39' },
          formatter: (items: Array<{
            marker: string
            seriesName: string
            data: { value: [number, number]; observedAt: string; rawValue: number; baselineAt: string; baselineValue: number | null }
          }>) => items.map((item) => {
            const shown = displayMode === 'relative' && canAlignAll
              ? signedValue(item.data.value[1], relativeSuffix)
              : withUnit(item.data.rawValue, analysis.unit)
            const baseline = item.data.baselineValue === null
              ? ''
              : `<br/><span style="color:#84928e">基准：${item.data.baselineAt} · ${withUnit(item.data.baselineValue, analysis.unit)}</span>`
            return `${item.marker}<strong>${item.seriesName}</strong><br/>观测：${item.data.observedAt}<br/>${displayMode === 'relative' && canAlignAll ? '相对基准' : '原始数值'}：${shown}${baseline}`
          }).join('<br/><br/>'),
        },
        legend: { type: 'scroll', top: 0, right: 8, left: 8, icon: 'circle', textStyle: { fontFamily: 'MiSans', color: '#405751', fontSize: 11 } },
        grid: { left: 66, right: 24, top: 58, bottom: 48 },
        xAxis: {
          type: 'value',
          name: canAlignAll ? '相对事件时点（月）' : '各事件按时间升序的观测期次',
          nameLocation: 'middle',
          nameGap: 31,
          minInterval: 1,
          axisTick: { show: false },
          axisLine: { lineStyle: { color: '#dfe4ed' } },
          axisLabel: {
            fontFamily: 'MiSans', color: '#405751', fontSize: 11,
            formatter: (value: number) => canAlignAll ? (value === 0 ? 'T0' : `T${value > 0 ? '+' : ''}${value}`) : `第 ${value} 期`,
          },
        },
        yAxis: {
          type: 'value',
          name: displayMode === 'relative' && canAlignAll
            ? relativeAsPercent ? '相对 T0 变化（%）' : `相对 T0 差值${analysis.unit ? `（${analysis.unit}）` : ''}`
            : [analysis.metric, analysis.unit].filter(Boolean).join(' · '),
          nameTextStyle: { fontFamily: 'MiSans', color: '#405751', fontSize: 11 },
          axisLabel: {
            fontFamily: 'MiSans', color: '#405751', fontSize: 11,
            formatter: (value: number) => displayMode === 'relative' && canAlignAll && relativeAsPercent ? `${value}%` : formatNumber(value),
          },
          splitLine: { lineStyle: { color: '#edf0f5' } },
        },
        series,
      },
    }
  }, [analysis, canAlignAll, displayMode, eventPaths, relativeAsPercent, relativeSuffix])

  const comparisonNames = analysis?.events.map((event) => `“${event.name}”`).join('、') ?? ''

  return (
    <div className="history-page">
      <section className="page-card history-header-card">
        <div>
          <span className="eyebrow">真实历史路径 · T0 对齐</span>
          <h2>看同类事件发生前后，关键指标实际怎么走</h2>
          <p>系统会围绕当前研究选择同类已发生事件和同一项客观指标，把各事件发生时点统一记作 T0，再比较前后变化路径。结果用于提供历史情景参照，不代替事实核查，也不推断当前对象的未来表现。</p>
        </div>
        <div className="history-agent-status">
          <span className={running ? 'agent-live-dot running' : 'agent-live-dot'} />
          <div><strong>本次历史情景复盘</strong><span>{running ? '正在查找同类事件并整理公开数据' : analysis ? `已生成于 ${analysis.created_at}` : '尚未运行，不展示示例数据'}</span></div>
        </div>
      </section>

      <section className="page-card history-trigger-card">
        <div className="history-trigger-task"><span>当前研究</span><strong>{run.title}</strong></div>
        <div className="history-trigger-method"><AimOutlined /><div><strong>{customMode ? '优先采用你填写的比较口径' : '未填写条件，由系统推荐比较口径'}</strong><span>{customMode ? '指标、场景、时间范围和频率会随启动请求一并提交。' : '系统会根据当前研究主题与已核查主张选择可比较的历史路径。'}</span></div></div>
        <span className="history-capability-status supported">自定义口径已接入</span>
      </section>

      <section className="page-card history-config-card history-analysis-config-card">
        <div className="history-config-intro">
          <div><SettingOutlined /><span><strong>你想比较什么</strong><small>只填你关心的部分，其余仍由系统补全；全部留空则完全由系统推荐。</small></span></div>
          {customMode && <Button type="text" disabled={running} onClick={() => resetHistoryAnalysisConfig(run.id)}>恢复系统推荐</Button>}
        </div>
        <label className="history-config-field history-metric-field">
          <span>比较指标</span>
          <Input
            value={historyAnalysisConfig.metric}
            disabled={running}
            onChange={(event) => updateConfig('metric', event.target.value)}
            placeholder="如：股价涨幅、营业收入、净利润"
          />
        </label>
        <label className="history-config-field history-scenarios-field">
          <span>关注的历史事件或场景</span>
          <Input.TextArea
            value={historyAnalysisConfig.scenarios}
            disabled={running}
            autoSize={{ minRows: 1, maxRows: 2 }}
            onChange={(event) => updateConfig('scenarios', event.target.value)}
            placeholder="如：版号恢复发放、监管政策调整；多个场景用逗号隔开"
          />
        </label>
        <div className="history-config-field history-date-field">
          <span>观察时间范围</span>
          <div className="history-date-range">
            <DatePicker
              aria-label="开始日期"
              value={parseHistoryDate(normalizedConfig.start)}
              disabled={running}
              format="YYYY年MM月DD日"
              inputReadOnly
              getPopupContainer={(trigger) => trigger.parentElement ?? document.body}
              placeholder="选择开始日期"
              onChange={(value) => updateConfig('start', value?.format('YYYY-MM-DD') ?? '')}
            />
            <i>至</i>
            <DatePicker
              aria-label="结束日期"
              value={parseHistoryDate(normalizedConfig.end)}
              disabled={running}
              format="YYYY年MM月DD日"
              inputReadOnly
              getPopupContainer={(trigger) => trigger.parentElement ?? document.body}
              placeholder="选择结束日期"
              onChange={(value) => updateConfig('end', value?.format('YYYY-MM-DD') ?? '')}
            />
          </div>
        </div>
        <label className="history-config-field history-frequency-field">
          <span>统计频率</span>
          <Select
            value={historyAnalysisConfig.frequency}
            disabled={running}
            onChange={(value) => updateConfig('frequency', value)}
            options={Object.entries(frequencyLabels).map(([value, label]) => ({ value, label }))}
          />
        </label>
        <div className="history-config-actions">
          <Button type="primary" icon={running ? <ReloadOutlined spin /> : <PlayCircleOutlined />} loading={running} onClick={startAnalysis}>
            {running ? '复盘生成中' : customMode ? '按我的要求开始' : analysis ? '按系统推荐重新生成' : '按系统推荐开始'}
          </Button>
        </div>
      </section>

      {!analysis ? (
        <section className="page-card history-empty-card">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={loading ? '正在读取该任务已有的历史情景结果…' : '这项任务还没有真实历史情景结果，因此暂不显示图表和数字。'}
          />
          {!loading && <p>开始后，页面会明确列出比较了哪些事件、哪项指标、以哪一个真实观测点作为 T0 基准，以及事件前后的实际变化。</p>}
        </section>
      ) : (
        <>
          {analysis.requested_config && (
            <section className="page-card history-applied-config">
              <span>本次采用的比较要求</span>
              <strong>{analysis.requested_config.metric || analysis.metric}</strong>
              <small>
                {analysis.requested_config.scenarios.length > 0 ? analysis.requested_config.scenarios.join('、') : '历史场景由系统推荐'}
                {' · '}{analysis.requested_config.start || '不限起点'} 至 {analysis.requested_config.end || '不限终点'}
                {' · '}{frequencyLabels[analysis.requested_config.frequency]}
              </small>
            </section>
          )}
          <section className="page-card history-comparison-brief">
            <div className="history-brief-icon"><LineChartOutlined /></div>
            <div>
              <span>这次到底比较什么</span>
              <strong>用“{analysis.metric}{analysis.unit ? `（${analysis.unit}）` : ''}”观察 {comparisonNames} 的事件前后路径</strong>
              <p>{canAlignAll
                ? '每条线代表一个历史事件，横轴按各自事件月份对齐到 T0；默认纵轴显示相对各自基准点的变化，因此不同年份、不同绝对量级可以放在同一口径下比较。'
                : '部分事件只给出了年份、没有精确月份，无法可靠确定 T0。本图已按每个事件的真实日期升序排列，第 1 期就是该事件最早的同口径观测；当前仅显示原始数值，不计算伪造的相对变化。'}“原始数值”始终用于回看后端返回的数据本身。</p>
            </div>
          </section>

          {(!canAlignAll || excludedPointCount > 0) && (
            <section className="history-data-quality-note">
              <ClockCircleOutlined />
              <div>
                <strong>{canAlignAll ? '已统一数据统计周期' : '当前数据不能可靠对齐 T0'}</strong>
                <span>
                  {!canAlignAll && '至少一个事件时点未精确到月，因此已关闭“相对 T0”，改为展示按日期升序的原始数值。'}
                  {excludedPointCount > 0 && ` 同一事件中发现年度、季度或月度数据混用，已排除 ${excludedPointCount} 个不同统计周期的数据点，避免把年度合计和月度值直接相除。`}
                </span>
              </div>
            </section>
          )}

          <section className="history-kpi-strip">
            <div><HistoryOutlined /><span>同类事件</span><strong>{analysis.events.length}</strong><small>个真实返回样本</small></div>
            <div><DatabaseOutlined /><span>对照指标</span><strong className="history-kpi-text">{analysis.metric}</strong><small>{analysis.unit || '后端未注明单位'}</small></div>
            <div><ClockCircleOutlined /><span>实际数据点</span><strong>{totalPoints}</strong><small>个公开数值记录</small></div>
            <div><CheckCircleFilled /><span>数据完整度</span><strong>{Math.round(completeness)}%</strong><small>按后端目标点数计算</small></div>
          </section>

          <section className="page-card history-chart-card">
            <div className="history-section-title history-chart-heading">
              <div><strong>{analysis.metric} · 事件前后变化路径</strong><span>{displayMode === 'relative' && canAlignAll ? `以每个事件最接近 T0 的真实数据为基准，${relativeAsPercent ? '统一换算为变化百分比' : '因存在零值基准，统一显示原始差值'}。` : canAlignAll ? '显示后端返回的原始指标值，不做换算。' : '每条线内部已按真实日期升序，横轴“第 N 期”表示该事件第 N 个同口径观测。'}悬停可核验日期和数值。</span></div>
              <div className="history-chart-tools">
                <Segmented
                  size="small"
                  value={displayMode}
                  onChange={(value) => setDisplayMode(value as DisplayMode)}
                  options={[{ label: '相对 T0', value: 'relative', disabled: !canAlignAll }, { label: '原始数值', value: 'raw' }]}
                />
                <div className="chart-source-note"><DatabaseOutlined /> {analysis.events.length} 个事件 · {totalPoints} 个真实数据点</div>
              </div>
            </div>
            {chartModel && <ReactECharts option={chartModel.option} style={{ height: 380 }} showLoading={running} />}
          </section>

          <section className="page-card history-samples-card">
            <div className="history-section-title">
              <div><strong>每个事件得出了什么</strong><span>基准点、覆盖范围和路径变化逐项列清；找不到精确 T0 数据时只采用最近的真实观测点，不做插值。</span></div>
              <Button icon={<PaperClipOutlined />} type={analysis.attached ? 'default' : 'primary'} loading={attaching} disabled={analysis.attached} onClick={attachAnalysis}>{analysis.attached ? '已加入底稿附件' : '加入研究底稿附件'}</Button>
            </div>
            <Table
              rowKey={(path) => `${path.event.name}-${path.event.period}`}
              pagination={false}
              dataSource={eventPaths}
              columns={[
                {
                  title: '历史事件',
                  width: '25%',
                  render: (_, path) => {
                    const sources = (path.event.sources ?? []).filter((source) => getHistorySourceUrl(source.url))
                    return <div className="history-event-cell">
                      <strong>{path.event.name}</strong>
                      <span>{path.event.description || '后端未返回事件说明'}</span>
                      {sources.length > 0
                        ? <div className="history-source-links">{sources.map((source, index) => <button type="button" key={`${source.url}-${index}`} title={source.title || source.url} onClick={() => openHistorySource(source.url)}><LinkOutlined /><em>{source.title || `信息来源 ${index + 1}`}</em></button>)}</div>
                        : <small className="history-source-empty">暂无来源链接</small>}
                    </div>
                  },
                },
                {
                  title: 'T0 与采用基准',
                  width: '22%',
                  render: (_, path) => path.baseline
                    ? <div className="history-baseline-cell"><strong>T0：{path.event.period}</strong><span>{path.exactT0 ? `采用 T0 当期 ${path.baseline.t}` : path.canAlign ? `采用最接近 T0 的 ${path.baseline.t}` : `日期无法对齐，采用首个观测 ${path.baseline.t}`}</span><small>{withUnit(path.baseline.value, analysis.unit)}</small></div>
                    : <span className="history-insufficient">{path.alignmentReason || '没有可用基准点'}</span>,
                },
                {
                  title: '实际覆盖',
                  width: '18%',
                  render: (_, path) => <div className="history-coverage-cell"><strong>{coverageText(path)}</strong><span>{rangeText(path)}</span><small>{path.points.length} 个真实数据点</small></div>,
                },
                {
                  title: '从基准到最后观测',
                  width: '18%',
                  render: (_, path) => {
                    const later = observedAfterBaseline(path)
                    if (!path.baseline || later.length === 0) return <span className="history-insufficient">基准后没有观测，无法形成路径</span>
                    const last = later.at(-1)!
                    const change = relativeValue(last.value, path.baseline.value)
                    return <div className="history-result-cell"><strong className={change > 0 ? 'is-up' : change < 0 ? 'is-down' : ''}>{signedValue(change, relativeSuffix)}</strong><span>{withUnit(path.baseline.value, analysis.unit)} → {withUnit(last.value, analysis.unit)}</span><small>最后观测：{last.t}</small></div>
                  },
                },
                {
                  title: '事件后路径范围',
                  width: '17%',
                  render: (_, path) => {
                    if (!path.baseline) return '—'
                    const after = observedAfterEvent(path)
                    if (after.length === 0) return <span className="history-insufficient">事件后数据不足</span>
                    const changes = [0, ...after.map((point) => relativeValue(point.value, path.baseline!.value))]
                    return <div className="history-extremes"><span>最高 <strong className="is-up">{signedValue(Math.max(...changes), relativeSuffix)}</strong></span><span>最低 <strong className="is-down">{signedValue(Math.min(...changes), relativeSuffix)}</strong></span></div>
                  },
                },
              ]}
            />
            <div className="history-data-note">本页仅使用接口返回的历史事件、公开数据点和信息来源。所有可识别日期均按时间升序展示；同一事件中不同统计周期的数据不会混合计算。点击事件下方的来源按钮，可在新标签页回查后端返回的对应公开页面。</div>
          </section>
        </>
      )}
    </div>
  )
}
