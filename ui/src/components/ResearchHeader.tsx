import {
  ArrowLeftOutlined,
  BarChartOutlined,
  CaretRightOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  CloudDownloadOutlined,
  MoreOutlined,
  PauseOutlined,
  PlayCircleOutlined,
} from '@ant-design/icons'
import { Button, Dropdown, Progress, Space, Tag, Tooltip } from 'antd'
import type { ResearchRun } from '../types'
import { useWorkspaceStore } from '../store'

const demoLabels = [
  '正在创建研究任务', 'Supervisor 正在拆解问题', '信源采集 SubAgent 开始检索',
  '文档解析 SubAgent 正在提取', '发现 24 条候选证据', '一级汇总完成',
  '独立审查正在复核', '发现 1 项结论冲突', '双层核验完成',
]

export function ResearchHeader({ run }: { run: ResearchRun }) {
  const demoStep = useWorkspaceStore((state) => state.demoStep)
  const isDemoRunning = useWorkspaceStore((state) => state.isDemoRunning)
  const startDemo = useWorkspaceStore((state) => state.startDemo)
  const setActiveView = useWorkspaceStore((state) => state.setActiveView)
  const progress = isDemoRunning ? Math.round((demoStep / 8) * 100) : run.progress

  return (
    <section className="research-header">
      <div className="breadcrumb-row">
        <button aria-label="返回任务列表" onClick={() => setActiveView('tasks')}><ArrowLeftOutlined /></button>
        <span>研究任务</span><span>/</span><strong>{run.id}</strong>
      </div>
      <div className="research-title-row">
        <div className="research-title">
          <div className="title-line">
            <h1>{run.title}</h1>
            <Tag className="running-tag" icon={<span className="pulse-dot" />}>
              {isDemoRunning ? '模拟运行中' : '核验中'}
            </Tag>
          </div>
          <div className="research-meta">
            <span>{run.company}</span><i />
            <span>任务编号 {run.id}</span><i />
            <span><ClockCircleOutlined /> 创建于 {run.createdAt}</span>
          </div>
        </div>
        <Space size={10}>
          <Tooltip title="手动进入历史情景客观统计">
            <Button icon={<BarChartOutlined />} onClick={() => setActiveView('analytics')}>历史情景复盘</Button>
          </Tooltip>
          <Tooltip title="从头演示 Agent 的运行过程">
            <Button icon={isDemoRunning ? <PauseOutlined /> : <PlayCircleOutlined />} onClick={startDemo}>
              {isDemoRunning ? '重新开始' : '模拟运行'}
            </Button>
          </Tooltip>
          <Button type="primary" icon={<CloudDownloadOutlined />}>导出底稿</Button>
          <Dropdown menu={{ items: [{ key: 'copy', label: '复制任务链接' }, { key: 'archive', label: '归档任务' }] }}>
            <Button icon={<MoreOutlined />} />
          </Dropdown>
        </Space>
      </div>

      <div className="run-overview">
        <div className="progress-block">
          <div className="progress-label">
            <strong>{demoLabels[demoStep]}</strong>
            <span>{progress}%</span>
          </div>
          <Progress percent={progress} showInfo={false} strokeColor="#246bfd" trailColor="#e8edf8" />
          <div className="current-task">
            {isDemoRunning ? <CaretRightOutlined /> : <CheckCircleFilled />}
            <span>{isDemoRunning ? `正在执行阶段 ${demoStep + 1}/9` : '已完成资料检索与复算，正在生成最终结论'}</span>
          </div>
        </div>
        <div className="overview-stat"><span>事实主张</span><strong>5</strong><small>条</small></div>
        <div className="overview-stat positive"><span>可信</span><strong>3</strong><small>条</small></div>
        <div className="overview-stat caution"><span>待复核</span><strong>1</strong><small>条</small></div>
        <div className="overview-stat danger"><span>高度存疑</span><strong>1</strong><small>条</small></div>
        <div className="overview-stat"><span>原始证据</span><strong>24</strong><small>份</small></div>
      </div>
    </section>
  )
}
