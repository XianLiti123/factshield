import { useEffect, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import {
  AimOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  DatabaseOutlined,
  HistoryOutlined,
  LineChartOutlined,
  PaperClipOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { Button, Empty, Segmented, Table, message } from 'antd'
import type { ResearchRun } from '../types'
import { getActiveTask, useWorkspaceStore } from '../store'
import {
  attachHistoryAnalysis,
  getHistoryAnalysis,
  startHistoryAnalysis,
  type HistoryAnalysis,
  type HistoryAnalysisEvent,
  type HistoryAnalysisPoint,
} from '../services/api'

const POLL_INTERVAL = 2500
const POLL_LIMIT = 72

type DisplayMode = 'relative' | 'raw'

type PreparedPoint = HistoryAnalysisPoint & {
  month: number | null
  offset: number | null
  sourceIndex: number
}

type EventPath = {
  event: HistoryAnalysisEvent
  eventMonth: number | null
  points: PreparedPoint[]
  baseline: PreparedPoint | null
  baselineIndex: number
  exactT0: boolean
  canAlign: boolean
}

function parseYearMonth(value: string) {
  const matched = value.match(/(\d{4})\s*(?:[-/.]|年)\s*(\d{1,2})(?:\s*月|(?=\D|$))/)
  if (!matched) return null
  const year = Number(matched[1])
  const month = Number(matched[2])
  if (!Number.isInteger(year) || month < 1 || month > 12) return null
  return year * 12 + month - 1
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
  const eventMonth = parseYearMonth(event.period)
  const prepared = event.points
    .filter((point) => Number.isFinite(point.value))
    .map((point, sourceIndex) => {
      const month = parseYearMonth(point.t)
      return {
        ...point,
        month,
        offset: eventMonth !== null && month !== null ? month - eventMonth : null,
        sourceIndex,
      }
    })

  const canAlign = eventMonth !== null && prepared.length > 0 && prepared.every((point) => point.month !== null)
  const points = canAlign
    ? [...prepared].sort((left, right) => left.month! - right.month!)
    : prepared
  const baseline = points.length === 0
    ? null
    : canAlign
      ? points.reduce((nearest, point) => Math.abs(point.offset!) < Math.abs(nearest.offset!) ? point : nearest, points[0])
      : points[0]
  const baselineIndex = baseline ? points.indexOf(baseline) : -1

  return {
    event,
    eventMonth,
    points,
    baseline,
    baselineIndex,
    exactT0: baseline?.offset === 0,
    canAlign,
  }
}

function coverageText(path: EventPath) {
  if (path.points.length === 0) return '没有取得数据点'
  if (!path.canAlign) return `第 1–${path.points.length} 个观测点（日期无法按 T0 换算）`
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

export function AnalyticsView({ run }: { run: ResearchRun }) {
  const activeTask = useWorkspaceStore(getActiveTask)
  const persisted = Boolean(activeTask.persisted && !activeTask.isDemo)
  const [analysis, setAnalysis] = useState<HistoryAnalysis | null>(null)
  const [displayMode, setDisplayMode] = useState<DisplayMode>('relative')
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [attaching, setAttaching] = useState(false)
  const [baselineAnalysisId, setBaselineAnalysisId] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setRunning(false)
    setDisplayMode('relative')
    setBaselineAnalysisId(null)
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
        if (result && result.id !== baselineAnalysisId) {
          setAnalysis(result)
          setDisplayMode('relative')
          setRunning(false)
          message.success('历史情景复盘已生成')
          return
        }
        if (attempts >= POLL_LIMIT) {
          setRunning(false)
          message.warning('暂未取得新结果，可稍后重新进入本页查看')
        }
      } catch (error) {
        if (!cancelled) {
          setRunning(false)
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
  }, [baselineAnalysisId, persisted, run.id, running])

  const startAnalysis = async () => {
    if (!persisted) {
      message.info('演示任务不会生成虚构历史情景，请选择真实任务后运行')
      return
    }
    setBaselineAnalysisId(analysis?.id ?? null)
    setRunning(true)
    try {
      await startHistoryAnalysis(run.id)
      message.success('复盘任务已提交，结果生成后会自动显示在本页')
    } catch (error) {
      setRunning(false)
      message.error(error instanceof Error ? error.message : '历史情景复盘启动失败')
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
  const relativeAsPercent = eventPaths.every((path) => path.baseline && path.baseline.value !== 0)
  const completeness = analysis
    ? Math.max(0, Math.min(100, analysis.completeness <= 1 ? analysis.completeness * 100 : analysis.completeness))
    : 0

  const relativeValue = (value: number, baseline: number) => (
    relativeAsPercent ? ((value - baseline) / Math.abs(baseline)) * 100 : value - baseline
  )
  const relativeSuffix = relativeAsPercent ? '%' : analysis?.unit ? ` ${analysis.unit}` : ''

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
        value: [canAlignAll ? point.offset! : index + 1, displayMode === 'relative' && path.baseline
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
            const shown = displayMode === 'relative'
              ? signedValue(item.data.value[1], relativeSuffix)
              : withUnit(item.data.rawValue, analysis.unit)
            const baseline = item.data.baselineValue === null
              ? ''
              : `<br/><span style="color:#84928e">基准：${item.data.baselineAt} · ${withUnit(item.data.baselineValue, analysis.unit)}</span>`
            return `${item.marker}<strong>${item.seriesName}</strong><br/>观测：${item.data.observedAt}<br/>${displayMode === 'relative' ? '相对基准' : '原始数值'}：${shown}${baseline}`
          }).join('<br/><br/>'),
        },
        legend: { type: 'scroll', top: 0, right: 8, left: 8, icon: 'circle', textStyle: { fontFamily: 'MiSans', color: '#405751', fontSize: 11 } },
        grid: { left: 66, right: 24, top: 58, bottom: 48 },
        xAxis: {
          type: 'value',
          name: canAlignAll ? '相对事件时点（月）' : '各事件的观测顺序',
          nameLocation: 'middle',
          nameGap: 31,
          minInterval: 1,
          axisTick: { show: false },
          axisLine: { lineStyle: { color: '#dfe4ed' } },
          axisLabel: {
            fontFamily: 'MiSans', color: '#405751', fontSize: 11,
            formatter: (value: number) => canAlignAll ? (value === 0 ? 'T0' : `T${value > 0 ? '+' : ''}${value}`) : `第 ${value} 点`,
          },
        },
        yAxis: {
          type: 'value',
          name: displayMode === 'relative'
            ? relativeAsPercent ? '相对 T0 变化（%）' : `相对 T0 差值${analysis.unit ? `（${analysis.unit}）` : ''}`
            : [analysis.metric, analysis.unit].filter(Boolean).join(' · '),
          nameTextStyle: { fontFamily: 'MiSans', color: '#405751', fontSize: 11 },
          axisLabel: {
            fontFamily: 'MiSans', color: '#405751', fontSize: 11,
            formatter: (value: number) => displayMode === 'relative' && relativeAsPercent ? `${value}%` : formatNumber(value),
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
        <div className="history-trigger-method"><AimOutlined /><div><strong>自动选择可比较的历史路径</strong><span>基于当前研究主题与已核查主张选择同类事件，只使用后端实际返回的公开数值，不在前端补点或编造样本。</span></div></div>
        <Button type="primary" icon={running ? <ReloadOutlined spin /> : <PlayCircleOutlined />} loading={running} onClick={startAnalysis}>{running ? '复盘生成中' : analysis ? '重新生成复盘' : '开始历史情景复盘'}</Button>
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
          <section className="page-card history-comparison-brief">
            <div className="history-brief-icon"><LineChartOutlined /></div>
            <div>
              <span>这次到底比较什么</span>
              <strong>用“{analysis.metric}{analysis.unit ? `（${analysis.unit}）` : ''}”观察 {comparisonNames} 的事件前后路径</strong>
              <p>{canAlignAll ? '每条线代表一个历史事件，横轴按各自事件月份对齐到 T0；' : '部分日期无法换算为月份，横轴暂按实际观测顺序展示，相关样本会明确标注；'}默认纵轴显示相对各自基准点的变化，因此不同年份、不同绝对量级可以放在同一口径下比较。“原始数值”用于回看后端返回的数据本身。</p>
            </div>
          </section>

          <section className="history-kpi-strip">
            <div><HistoryOutlined /><span>同类事件</span><strong>{analysis.events.length}</strong><small>个真实返回样本</small></div>
            <div><DatabaseOutlined /><span>对照指标</span><strong className="history-kpi-text">{analysis.metric}</strong><small>{analysis.unit || '后端未注明单位'}</small></div>
            <div><ClockCircleOutlined /><span>实际数据点</span><strong>{totalPoints}</strong><small>个公开数值记录</small></div>
            <div><CheckCircleFilled /><span>数据完整度</span><strong>{Math.round(completeness)}%</strong><small>按后端目标点数计算</small></div>
          </section>

          <section className="page-card history-chart-card">
            <div className="history-section-title history-chart-heading">
              <div><strong>{analysis.metric} · 事件前后变化路径</strong><span>{displayMode === 'relative' ? `以每个事件最接近 T0 的真实数据为基准，${relativeAsPercent ? '统一换算为变化百分比' : '因存在零值基准，统一显示原始差值'}。` : '显示后端返回的原始指标值，不做换算。'}悬停可核验日期和数值。</span></div>
              <div className="history-chart-tools">
                <Segmented
                  size="small"
                  value={displayMode}
                  onChange={(value) => setDisplayMode(value as DisplayMode)}
                  options={[{ label: '相对 T0', value: 'relative' }, { label: '原始数值', value: 'raw' }]}
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
                  render: (_, path) => <div className="history-event-cell"><strong>{path.event.name}</strong><span>{path.event.description || '后端未返回事件说明'}</span></div>,
                },
                {
                  title: 'T0 与采用基准',
                  width: '22%',
                  render: (_, path) => path.baseline
                    ? <div className="history-baseline-cell"><strong>T0：{path.event.period}</strong><span>{path.exactT0 ? `采用 T0 当期 ${path.baseline.t}` : path.canAlign ? `采用最接近 T0 的 ${path.baseline.t}` : `日期无法对齐，采用首个观测 ${path.baseline.t}`}</span><small>{withUnit(path.baseline.value, analysis.unit)}</small></div>
                    : '没有可用基准点',
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
            <div className="history-data-note">本页仅使用接口返回的历史事件和公开数据点。后端当前没有返回逐条来源链接，因此不展示虚构的来源数量；需要审阅出处时，应以研究底稿中的原始检索记录为准。</div>
          </section>
        </>
      )}
    </div>
  )
}
