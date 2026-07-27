import {
  ArrowLeftOutlined,
  BarChartOutlined,
  ClockCircleOutlined,
  CloudDownloadOutlined,
  MoreOutlined,
  PauseOutlined,
  PlayCircleOutlined,
} from '@ant-design/icons'
import { Button, Dropdown, Space, Tag, Tooltip } from 'antd'
import type { ResearchRun } from '../types'
import { useWorkspaceStore } from '../store'

export function ResearchHeader({ run }: { run: ResearchRun }) {
  const demoStep = useWorkspaceStore((state) => state.demoStep)
  const isDemoRunning = useWorkspaceStore((state) => state.isDemoRunning)
  const startDemo = useWorkspaceStore((state) => state.startDemo)
  const setActiveView = useWorkspaceStore((state) => state.setActiveView)
  const progress = isDemoRunning ? Math.round((demoStep / 8) * 100) : run.progress

  return (
    <section className="research-header">
      <div className="research-title-row">
        <div className="research-title">
          <div className="breadcrumb-row">
            <button aria-label="返回任务列表" onClick={() => setActiveView('tasks')}><ArrowLeftOutlined /></button>
            <span>研究任务</span><span>/</span><strong>{run.id}</strong>
          </div>
          <div className="title-line">
            <h1>{run.title}</h1>
            <Tag className="running-tag" icon={<span className="pulse-dot" />}>
              {isDemoRunning ? `模拟运行 ${progress}%` : '核验中'}
            </Tag>
          </div>
          <div className="research-meta">
            <span>{run.company}</span><i />
            <span>任务编号 {run.id}</span><i />
            <span><ClockCircleOutlined /> 创建于 {run.createdAt}</span>
          </div>
        </div>
        <Space className="research-actions" size={8}>
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

    </section>
  )
}
