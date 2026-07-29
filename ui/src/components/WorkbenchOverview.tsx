import {
  CheckCircleFilled,
  FileSearchOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons'
import ReactECharts from 'echarts-for-react'
import type { ResearchRun } from '../types'
import { StatusBadge } from './StatusBadge'

const workflowOption = {
  color: ['#0d6575', '#d39a43'],
  textStyle: { fontFamily: 'MiSans, sans-serif', color: '#405651', fontSize: 12 },
  tooltip: { trigger: 'axis', textStyle: { fontFamily: 'MiSans, sans-serif', fontSize: 12, color: '#263f39' } },
  legend: {
    top: 0,
    right: 0,
    icon: 'circle',
    itemWidth: 7,
    textStyle: { fontFamily: 'MiSans, sans-serif', color: '#4f655f', fontSize: 13 },
  },
  grid: { left: 42, right: 58, top: 38, bottom: 32, containLabel: true },
  xAxis: {
    type: 'category',
    boundaryGap: false,
    data: ['任务拆解', '信源采集', '文档解析', '证据检索', '一级汇总', '独立复核'],
    axisTick: { show: false },
    axisLine: { lineStyle: { color: '#dce6e2' } },
    axisLabel: { fontFamily: 'MiSans, sans-serif', color: '#405751', fontSize: 13, interval: 0, hideOverlap: false, margin: 12 },
  },
  yAxis: {
    type: 'value',
    min: 0,
    max: 100,
    axisLabel: { fontFamily: 'MiSans, sans-serif', color: '#405751', fontSize: 13, formatter: '{value}%' },
    splitLine: { lineStyle: { color: '#edf2f0' } },
  },
  series: [
    {
      name: '证据覆盖',
      type: 'line',
      smooth: true,
      symbol: 'circle',
      symbolSize: 6,
      lineStyle: { width: 2.4 },
      areaStyle: { opacity: 0.07 },
      data: [18, 42, 58, 76, 88, 94],
    },
    {
      name: '结论可信度',
      type: 'line',
      smooth: true,
      symbol: 'circle',
      symbolSize: 6,
      lineStyle: { width: 2, type: 'dashed' },
      data: [26, 48, 63, 72, 68, 82],
    },
  ],
}

export function WorkbenchOverview({ run, onOpenClaim }: { run: ResearchRun; onOpenClaim: (claimId: string) => void }) {
  const verified = run.claims.filter((claim) => claim.status === 'verified').length
  const review = run.claims.filter((claim) => claim.status === 'review').length
  const conflict = run.claims.filter((claim) => claim.status === 'conflict').length
  const distributionOption = {
    color: ['#15966c', '#d6a13f', '#d75b63'],
    textStyle: { fontFamily: 'MiSans, sans-serif', color: '#405651', fontSize: 12 },
    tooltip: { trigger: 'item', textStyle: { fontFamily: 'MiSans, sans-serif', fontSize: 12, color: '#263f39' } },
    title: {
      text: `${verified}\n可信`,
      left: 'center',
      top: '35%',
      textStyle: { fontFamily: 'MiSans, sans-serif', color: '#1f3935', fontSize: 25, fontWeight: 700, lineHeight: 30 },
    },
    series: [{
      type: 'pie',
      radius: ['58%', '78%'],
      center: ['50%', '46%'],
      avoidLabelOverlap: true,
      label: { show: false },
      itemStyle: { borderColor: '#fff', borderWidth: 3 },
      data: [
        { value: verified, name: '可信' },
        { value: review, name: '待复核' },
        { value: conflict, name: '高度存疑' },
      ],
    }],
  }

  return (
    <div className="workbench-overview">
      <section className="overview-metric-card">
        <div><span>事实主张</span><strong>{run.claims.length}</strong><small><i /> 全部已绑定原始证据</small></div>
        <FileSearchOutlined />
      </section>
      <section className="overview-metric-card">
        <div><span>原始证据</span><strong>24</strong><small><i /> 来源与原文定位已记录</small></div>
        <SafetyCertificateOutlined />
      </section>
      <section className="overview-metric-card">
        <div><span>双层核验进度</span><strong>{run.progress}%</strong><small><i /> 小盾与独立复核</small></div>
        <CheckCircleFilled />
      </section>

      <section className="page-card overview-trend-card">
        <div className="overview-card-heading">
          <div><strong>核验进度与证据覆盖</strong><span>当前任务各阶段完成度</span></div>
          <span className="overview-live"><i /> 核验中</span>
        </div>
        <div className="overview-trend-chart"><ReactECharts option={workflowOption} style={{ height: '100%' }} /></div>
      </section>

      <aside className="page-card overview-distribution-card">
        <div className="overview-card-heading"><div><strong>可信度分布</strong><span>双层核验结论</span></div></div>
        <div className="overview-distribution-chart"><ReactECharts option={distributionOption} style={{ height: '100%' }} /></div>
        <div className="distribution-list">
          <div><span><i className="verified" />可信</span><strong>{verified} 条</strong></div>
          <div><span><i className="review" />待复核</span><strong>{review} 条</strong></div>
          <div><span><i className="conflict" />高度存疑</span><strong>{conflict} 条</strong></div>
        </div>
      </aside>

      <section className="overview-claims-section">
        <div className="overview-section-heading"><div><strong>重点事实主张</strong><span>按风险与可信度综合排序</span></div><button onClick={() => onOpenClaim(run.claims[0].id)}>查看全部</button></div>
        <div className="overview-claim-grid">
          {run.claims.slice(0, 4).map((claim) => (
            <button className={`overview-claim-card ${claim.status}`} key={claim.id} onClick={() => onOpenClaim(claim.id)}>
              <div className="overview-claim-visual">
                <span>C{String(claim.index).padStart(2, '0')}</span>
                <strong>{Math.round(claim.confidence * 100)}%</strong>
              </div>
              <div className="overview-claim-copy">
                <StatusBadge status={claim.status} compact />
                <p>{claim.statement}</p>
                <div className="overview-claim-meta">
                  <span>{claim.issueType ?? claim.category}<i />{claim.evidenceIds.length} 条证据</span>
                  <strong>查看核验</strong>
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
