import {
  ArrowLeftOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons'
import { Tag } from 'antd'
import type { ResearchRun } from '../types'
import { getActiveTask, useWorkspaceStore } from '../store'

export function ResearchHeader({ run, preview = false }: { run: ResearchRun; preview?: boolean }) {
  const activeTask = useWorkspaceStore(getActiveTask)
  const setActiveView = useWorkspaceStore((state) => state.setActiveView)
  const persistedRunPhase = (run.status === 'review' || run.status === 'ready')
    && (run.progress < 100 || run.claims.length === 0)
    ? 'running'
    : run.status
  const displayPhase = !preview && activeTask.persisted && persistedRunPhase ? persistedRunPhase : activeTask.phase
  const phaseCopy = preview
    ? 'UI 预览'
    : activeTask.isDemo && displayPhase === 'running'
      ? '演示处理中'
      : displayPhase === 'running'
        ? '自动研究中'
        : displayPhase === 'ready'
          ? '底稿已就绪'
          : displayPhase === 'stopped'
            ? '任务已终止'
            : displayPhase === 'failed'
              ? '执行失败'
              : '待人工复核'

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
      </div>

    </section>
  )
}
