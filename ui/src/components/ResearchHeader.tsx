import {
  ArrowLeftOutlined,
  BarChartOutlined,
  ClockCircleOutlined,
  CloudDownloadOutlined,
  MoreOutlined,
  ApartmentOutlined,
} from '@ant-design/icons'
import { Button, Dropdown, Space, Tag } from 'antd'
import type { ResearchRun } from '../types'
import { getActiveTask, useWorkspaceStore } from '../store'

export function ResearchHeader({ run }: { run: ResearchRun }) {
  const taskPhase = useWorkspaceStore(getActiveTask).phase
  const setActiveView = useWorkspaceStore((state) => state.setActiveView)
  const phaseCopy = taskPhase === 'running' ? '自动研究中' : taskPhase === 'ready' ? '底稿已就绪' : '待人工复核'

  return (
    <section className="research-header">
      <div className="research-title-row">
        <div className="research-title">
          <div className="breadcrumb-row">
            <button aria-label="返回任务列表" onClick={() => setActiveView('tasks')}><ArrowLeftOutlined /></button>
            <span>当前研究</span><span>/</span><strong>{run.id}</strong>
          </div>
          <div className="title-line">
            <h1>{run.title}</h1>
            <Tag className="running-tag" icon={<span className="pulse-dot" />}>
              {phaseCopy}
            </Tag>
          </div>
          <div className="research-meta">
            <span>{run.company}</span><i />
            <span>任务编号 {run.id}</span><i />
            <span><ClockCircleOutlined /> 创建于 {run.createdAt}</span>
          </div>
        </div>
        <Space className="research-actions" size={8}>
          {taskPhase === 'ready' && <Button type="primary" icon={<CloudDownloadOutlined />} onClick={() => setActiveView('reports')}>导出底稿</Button>}
          <Dropdown menu={{ items: [
            { key: 'history', icon: <BarChartOutlined />, label: '历史情景复盘', onClick: () => setActiveView('analytics') },
            { key: 'monitor', icon: <ApartmentOutlined />, label: '查看执行监控', onClick: () => setActiveView('topology') },
            { key: 'copy', label: '复制任务链接' },
          ] }}>
            <Button icon={<MoreOutlined />} />
          </Dropdown>
        </Space>
      </div>

    </section>
  )
}
