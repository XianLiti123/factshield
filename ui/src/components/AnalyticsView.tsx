import { useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import {
  CheckCircleFilled,
  ClockCircleOutlined,
  DatabaseOutlined,
  HistoryOutlined,
  LockOutlined,
  PaperClipOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { Button, Select, Table, Tag, message } from 'antd'
import type { ResearchRun } from '../types'

const samples = [
  { key: '1', event: '2014 年地方债务规范化管理', date: '2014-10', source: '国务院公开文件、Wind 公开指标', window: '前 12 月 / 后 24 月', integrity: '完整' },
  { key: '2', event: '2018 年隐性债务治理阶段', date: '2018-08', source: '财政部公开信息、中债数据', window: '前 12 月 / 后 24 月', integrity: '完整' },
  { key: '3', event: '2023 年一揽子化债工作', date: '2023-07', source: '中央公开会议、交易所数据', window: '前 12 月 / 后 24 月', integrity: '部分月份待补' },
]

const indicatorSeries = {
  spread: {
    label: '城投债信用利差', unit: 'bp',
    values: [
      [178, 171, 169, 165, 158, 151, 147, 142, 139, 136, 132, 129, 127],
      [149, 153, 161, 174, 189, 182, 176, 170, 165, 159, 156, 153, 151],
      [136, 141, 148, 152, 146, 139, 133, 128, 124, 121, 118, 116, 114],
    ],
  },
  credit: {
    label: '社会融资规模存量增速', unit: '%',
    values: [
      [15.7, 15.3, 14.8, 14.2, 13.7, 13.2, 12.8, 12.6, 12.4, 12.3, 12.1, 11.9, 11.8],
      [10.5, 10.3, 10.1, 10.0, 10.2, 10.4, 10.7, 10.8, 10.9, 10.8, 10.7, 10.6, 10.5],
      [9.4, 9.2, 9.0, 8.9, 9.0, 9.1, 9.2, 9.1, 9.0, 8.9, 8.8, 8.7, 8.6],
    ],
  },
  infrastructure: {
    label: '基础设施投资累计增速', unit: '%',
    values: [
      [21.2, 20.6, 19.8, 18.9, 18.2, 17.6, 17.1, 16.4, 15.8, 15.2, 14.7, 14.3, 13.9],
      [3.1, 3.4, 3.7, 4.1, 4.4, 4.7, 4.5, 4.2, 3.9, 3.8, 3.7, 3.6, 3.5],
      [6.8, 6.4, 6.0, 5.7, 5.9, 6.1, 6.2, 6.0, 5.8, 5.6, 5.4, 5.2, 5.0],
    ],
  },
}

export function AnalyticsView({ run }: { run: ResearchRun }) {
  const [indicator, setIndicator] = useState<keyof typeof indicatorSeries>('spread')
  const [running, setRunning] = useState(false)
  const [attached, setAttached] = useState(false)
  const current = indicatorSeries[indicator]

  const chartOption = useMemo(() => ({
    color: ['#246bfd', '#7c54c8', '#1f9a70'],
    tooltip: { trigger: 'axis', valueFormatter: (value: number) => `${value} ${current.unit}` },
    legend: { top: 2, right: 8, icon: 'circle', textStyle: { color: '#66738a', fontSize: 10 } },
    grid: { left: 48, right: 20, top: 44, bottom: 38 },
    xAxis: {
      type: 'category', boundaryGap: false,
      data: ['T-12', 'T-9', 'T-6', 'T-3', 'T0', 'T+3', 'T+6', 'T+9', 'T+12', 'T+15', 'T+18', 'T+21', 'T+24'],
      axisTick: { show: false }, axisLine: { lineStyle: { color: '#dfe4ed' } }, axisLabel: { color: '#7c879b', fontSize: 9 },
    },
    yAxis: { type: 'value', name: current.unit, nameTextStyle: { color: '#8b96aa' }, axisLabel: { color: '#7c879b', fontSize: 9 }, splitLine: { lineStyle: { color: '#edf0f5' } } },
    series: [
      { name: '2014 样本', type: 'line', smooth: true, symbolSize: 5, data: current.values[0], lineStyle: { width: 2 } },
      { name: '2018 样本', type: 'line', smooth: true, symbolSize: 5, data: current.values[1], lineStyle: { width: 2 } },
      { name: '2023 样本', type: 'line', smooth: true, symbolSize: 5, data: current.values[2], lineStyle: { width: 2 } },
    ],
  }), [current])

  const startMock = () => {
    setRunning(true)
    window.setTimeout(() => {
      setRunning(false)
      message.success('历史情景客观统计 Mock 演示已完成')
    }, 1200)
  }

  return (
    <div className="history-page">
      <section className="page-card history-header-card">
        <div>
          <span className="eyebrow">工作台必备模块 · 手动触发</span>
          <h2>历史情景复盘</h2>
          <p>针对已经结束的历史事件查询公开时序数据，进行客观对照统计，并将结果作为当前研究底稿的辅助附件。</p>
        </div>
        <div className="history-agent-status">
          <span className={running ? 'agent-live-dot running' : 'agent-live-dot'} />
          <div><strong>历史情景复盘 SubAgent</strong><span>{running ? '正在执行 Mock 统计' : '等待研究员手动触发'}</span></div>
        </div>
      </section>

      <div className="history-restriction-banner">
        <LockOutlined />
        <div><strong>能力边界已锁定</strong><span>仅查询和整理已结束历史事件的客观数据，不解读规律、不推断未来、不产生任何投资建议。</span></div>
        <Tag color="blue">必备模块</Tag>
      </div>

      <section className="page-card history-config-card">
        <div className="history-config-field"><span>当前研究任务</span><strong>{run.title}</strong></div>
        <div className="history-config-field"><span>历史情景类别</span><Select defaultValue="debt" options={[{ value: 'debt', label: '地方债务治理相关事件' }, { value: 'policy', label: '重大政策调整事件' }, { value: 'industry', label: '行业指标异常事件' }]} /></div>
        <div className="history-config-field"><span>客观指标</span><Select value={indicator} onChange={setIndicator} options={[{ value: 'spread', label: '城投债信用利差' }, { value: 'credit', label: '社会融资规模存量增速' }, { value: 'infrastructure', label: '基础设施投资累计增速' }]} /></div>
        <div className="history-config-field"><span>观察窗口</span><Select defaultValue="36m" options={[{ value: '36m', label: '事件前 12 月至后 24 月' }, { value: '24m', label: '事件前 6 月至后 18 月' }]} /></div>
        <Button type="primary" icon={running ? <ReloadOutlined spin /> : <PlayCircleOutlined />} loading={running} onClick={startMock}>{running ? '统计中' : '启动 Mock 统计'}</Button>
      </section>

      <section className="history-kpi-strip">
        <div><HistoryOutlined /><span>历史样本</span><strong>3</strong><small>个已结束事件</small></div>
        <div><DatabaseOutlined /><span>公开数据源</span><strong>9</strong><small>个来源已记录</small></div>
        <div><ClockCircleOutlined /><span>观察窗口</span><strong>36</strong><small>个月</small></div>
        <div><CheckCircleFilled /><span>数据完整度</span><strong>94.6%</strong><small>缺口已单独标注</small></div>
      </section>

      <section className="page-card history-chart-card">
        <div className="history-section-title">
          <div><strong>{current.label}历史样本对照</strong><span>T0 表示各历史事件公开发生时点，曲线仅展示客观数据。</span></div>
          <div className="chart-source-note"><DatabaseOutlined /> 数据来源：公开文件、交易所及公开指标库</div>
        </div>
        <ReactECharts option={chartOption} style={{ height: 360 }} showLoading={running} />
      </section>

      <section className="page-card history-samples-card">
        <div className="history-section-title">
          <div><strong>历史事件样本与来源</strong><span>所有样本均为已结束事件，缺失月份不会自动补写。</span></div>
          <Button icon={<PaperClipOutlined />} type={attached ? 'default' : 'primary'} onClick={() => { setAttached(true); message.success('已作为 Mock 附件加入研究底稿') }}>{attached ? '已加入底稿附件' : '加入研究底稿附件'}</Button>
        </div>
        <Table
          pagination={false}
          dataSource={samples}
          columns={[
            { title: '历史事件', dataIndex: 'event' },
            { title: '公开时点', dataIndex: 'date', width: 110 },
            { title: '数据来源', dataIndex: 'source' },
            { title: '观察窗口', dataIndex: 'window', width: 145 },
            { title: '完整性', dataIndex: 'integrity', width: 115, render: (value) => <Tag color={value === '完整' ? 'green' : 'gold'}>{value}</Tag> },
          ]}
        />
      </section>
    </div>
  )
}
