import { useMemo, useState } from 'react'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import { CheckCircleFilled, ClockCircleFilled, CloseOutlined, LoadingOutlined, LockFilled, WarningFilled } from '@ant-design/icons'
import { Button, Drawer, Empty, Spin, Tag, message } from 'antd'
import { useWorkspaceStore } from '../store'
import { getAgentExecution, type AgentExecution, type AuditEvent } from '../services/api'
import type { AgentInfo, ResearchRun } from '../types'

type AgentNodeData = AgentInfo & {
  kind?: 'supervisor' | 'reviewer'
  detailLabel: string
  displayDetail: string
  onOpen?: (agentId: string) => void
  [key: string]: unknown
}

const agentNames: Record<string, string> = {
  supervisor: '小盾', collector: '采集员', parser: '解析员', retriever: '检索员',
  scorer: '评分员', assembler: '组装员', reviewer: '审查员', system: '系统',
}

type AgentDetailProps = {
  agent: AgentInfo
  events: AuditEvent[]
  execution?: AgentExecution | null
  loading: boolean
  error: string
  onRetry: () => void
}

const agentDetailLabels: Record<string, string> = {
  supervisor: '核验进展',
  collector: '采集进展',
  parser: '解析产出',
  retriever: '取证进展',
  scorer: '标注进展',
  assembler: '底稿进展',
  reviewer: '复核结论',
}

function getAgentFallbackDetail(
  agent: AgentInfo,
  run: ResearchRun,
  pendingReviewCount: number,
  conflictCount: number,
) {
  const isDone = agent.status === 'done'
  const isRunning = agent.status === 'running'

  switch (agent.id) {
    case 'supervisor':
      if (isRunning) return '正在协调当前研究链路'
      if (isDone && pendingReviewCount > 0) return `已整理 ${run.claims.length} 条主张，${pendingReviewCount} 条待判断`
      if (isDone) return `已完成 ${run.claims.length} 条主张的核验协调`
      return '等待研究任务启动'
    case 'collector':
      if (isDone) return '公开信源采集已完成'
      if (isRunning) return '正在采集公开信源'
      return '等待研究拆解完成'
    case 'parser':
      if (isDone) return `已形成 ${run.claims.length} 条事实主张`
      if (isRunning) return '正在解析材料并提取主张'
      return '等待原始材料'
    case 'retriever':
      if (isDone) return `已绑定 ${run.evidence.length} 条原文证据`
      if (isRunning) return '正在为主张定位原文证据'
      return '等待主张提取完成'
    case 'scorer':
      if (isDone) return `已完成 ${run.evidence.length} 条证据的来源标注`
      if (isRunning) return '正在标注信源类型与可信度'
      return '等待证据检索完成'
    case 'assembler':
      if (isDone) return '研究底稿已生成'
      if (isRunning) return '正在组装主张、证据与复核记录'
      return '等待双层核验完成'
    case 'reviewer':
      if (agent.status === 'warning' && conflictCount > 0) return `发现 ${conflictCount} 条高度存疑主张`
      if (isDone && pendingReviewCount > 0) return `独立复核完成，${pendingReviewCount} 条留待判断`
      if (isDone) return '独立复核已完成，未发现待处理冲突'
      if (isRunning) return '正在独立检查事实与证据'
      return '等待一级核验完成'
    default:
      if (isDone) return '当前环节已完成'
      if (isRunning) return '当前环节正在处理'
      return '等待前序环节完成'
  }
}

function AgentNode({ data }: NodeProps<Node<AgentNodeData>>) {
  const displayName = data.name.replace(/\s*SubAgent$/, '')
  const statusLabel = data.status === 'done'
    ? '已完成'
    : data.status === 'warning'
      ? '需处理'
      : data.status === 'waiting'
        ? '等待中'
        : '运行中'
  const statusIcon = data.status === 'done'
    ? <CheckCircleFilled />
    : data.status === 'warning'
      ? <WarningFilled />
      : data.status === 'waiting'
        ? <ClockCircleFilled />
        : <LoadingOutlined spin />

  return (
    <div className={`agent-node ${data.kind ?? ''} ${data.status}`} role="button" tabIndex={0} onClick={() => data.onOpen?.(data.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') data.onOpen?.(data.id) }}>
      <Handle type="target" position={Position.Top} />
      <div className="agent-node-top">
        <span className="agent-node-icon">{data.kind === 'reviewer' ? '复' : data.kind === 'supervisor' ? '盾' : '核'}</span>
        <div className="agent-node-copy"><strong>{displayName}</strong><span>{data.role}</span></div>
        <i>{statusIcon}</i>
      </div>
      <div className="agent-node-detail"><span>{data.detailLabel}</span><strong>{data.displayDetail}</strong></div>
      <div className="agent-node-footer"><span className={`agent-status-label ${data.status}`}>{statusLabel}</span><span>{data.duration ? `耗时 ${data.duration}` : '尚未启动'}</span></div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

function AgentDetail({ agent, events, loading, error, onRetry }: AgentDetailProps) {
  const agentEvents = events.filter((event) => event.actor === agent.id)
  return (
    <div className="agent-detail-drawer-body">
      <div className="agent-detail-summary">
        <span className={`agent-detail-mark ${agent.id === 'reviewer' ? 'reviewer' : agent.id === 'supervisor' ? 'supervisor' : ''}`}>{agent.id === 'reviewer' ? '复' : agent.id === 'supervisor' ? '盾' : '核'}</span>
        <div><strong>{agentNames[agent.id] ?? agent.name.replace(/\s*SubAgent$/, '')}</strong><small>{agent.role}</small></div>
        <Tag color={agent.status === 'warning' ? 'error' : agent.status === 'running' ? 'processing' : agent.status === 'done' ? 'success' : 'default'}>{agent.status === 'done' ? '已完成' : agent.status === 'running' ? '运行中' : agent.status === 'warning' ? '需处理' : '等待中'}</Tag>
      </div>
      <div className="agent-detail-intro"><strong>完整执行过程</strong><span>以下内容来自任务审计日志，只展示该 Agent 实际产生的事件。</span></div>
      {loading ? <div className="agent-detail-loading"><Spin /><span>正在读取执行记录…</span></div> : error ? <div className="agent-detail-error"><span>{error}</span><Button size="small" onClick={onRetry}>重试</Button></div> : agentEvents.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无该 Agent 的可回放事件" /> : <div className="agent-detail-timeline">{agentEvents.map((event) => <div className={`agent-detail-event ${event.payload.tone ?? ''}`} key={`${event.seq}-${event.id}`}><div className="agent-detail-event-marker"><i /></div><div className="agent-detail-event-copy"><div className="agent-detail-event-head"><strong>{event.payload.title || (event.kind === 'done' ? '执行完成' : '执行进展')}</strong><time>{new Date(event.ts).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></div>{event.payload.speech && <p>{event.payload.speech}</p>}{event.payload.details && event.payload.details.length > 0 && <div className="agent-detail-items">{event.payload.details.map((item, index) => <div key={`${item.label}-${index}`}><span>{item.label}</span><strong>{item.text}</strong></div>)}</div>}{event.payload.metrics && event.payload.metrics.length > 0 && <div className="agent-detail-metrics">{event.payload.metrics.map((item) => <span key={`${item.label}-${item.value}`}><small>{item.label}</small><strong>{item.value}</strong></span>)}</div>}</div></div>)}</div>}
    </div>
  )
}

function stringifyExecutionValue(value: unknown) {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  try { return JSON.stringify(value, null, 2) } catch { return String(value) }
}

function AgentExecutionDetail({ execution, loading, error, onRetry }: { execution: AgentExecution | null; loading: boolean; error: string; onRetry: () => void }) {
  if (loading) return <div className="agent-detail-loading"><Spin /><span>正在读取执行记录...</span></div>
  if (error) return <div className="agent-detail-error"><span>{error}</span><Button size="small" onClick={onRetry}>重试</Button></div>
  if (!execution) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无执行详情" />
  return (
    <div className="agent-detail-sections">
      <section className="agent-detail-section"><h3>输入</h3><pre>{stringifyExecutionValue(execution.inputs)}</pre></section>
      <section className="agent-detail-section"><h3>执行时间线 <em>{execution.timeline.length}</em></h3>
        {execution.timeline.length === 0 ? <p className="agent-detail-empty-copy">暂无时间线事件</p> : <div className="agent-detail-timeline">{execution.timeline.map((event) => <div className={`agent-detail-event ${event.payload.tone ?? ''}`} key={`${event.seq}-${event.id}`}><div className="agent-detail-event-marker"><i /></div><div className="agent-detail-event-copy"><div className="agent-detail-event-head"><strong>{event.payload.title || (event.kind === 'done' ? '执行完成' : '执行进展')}</strong><time>{new Date(event.ts).toLocaleTimeString('zh-CN')}</time></div>{event.payload.speech && <p>{event.payload.speech}</p>}{event.payload.details && <div className="agent-detail-items">{event.payload.details.map((item, index) => <div key={`${item.label}-${index}`}><span>{item.label}</span><strong>{item.text}</strong></div>)}</div>}{event.payload.metrics && <div className="agent-detail-metrics">{event.payload.metrics.map((item) => <span key={`${item.label}-${item.value}`}><small>{item.label}</small><strong>{item.value}</strong></span>)}</div>}</div></div>)}</div>}
      </section>
      <section className="agent-detail-section"><h3>工具调用 <em>{execution.tool_calls.length}</em></h3>
        {execution.tool_calls.length === 0 ? <p className="agent-detail-empty-copy">该 Agent 没有工具调用记录</p> : <div className="agent-detail-tool-list">{execution.tool_calls.map((call, index) => <div className="agent-detail-tool" key={`${call.seq ?? index}-${call.tool ?? 'tool'}`}><div><strong>{call.tool || '未命名工具'}</strong><small>{call.node || '执行节点'}{call.seq ? ` · 第 ${call.seq} 次` : ''}</small></div>{call.args && <pre>{stringifyExecutionValue(call.args)}</pre>}{call.result && <p>{call.result}</p>}</div>)}</div>}
      </section>
      <section className="agent-detail-section"><h3>产出</h3>{Object.keys(execution.artifacts).length === 0 ? <p className="agent-detail-empty-copy">暂无结构化产出</p> : <pre>{stringifyExecutionValue(execution.artifacts)}</pre>}</section>
      <section className={`agent-detail-section${execution.errors.length > 0 ? ' has-errors' : ''}`}><h3>异常 <em>{execution.errors.length}</em></h3>{execution.errors.length === 0 ? <p className="agent-detail-empty-copy">未记录异常</p> : <div className="agent-detail-error-list">{execution.errors.map((item, index) => <pre key={index}>{stringifyExecutionValue(item)}</pre>)}</div>}</section>
    </div>
  )
}

const nodeTypes = { agent: AgentNode }

export function AgentTopology({ run }: { run: ResearchRun }) {
  const setActiveView = useWorkspaceStore((state) => state.setActiveView)
  const workers = run.agents.filter((agent) => !['supervisor', 'reviewer'].includes(agent.id))
  const completedCount = workers.filter((agent) => agent.status === 'done').length
  const waitingCount = workers.filter((agent) => agent.status === 'waiting').length
  const pendingReviewClaims = run.claims.filter((claim) => claim.status !== 'verified' && !claim.humanAction)
  const conflictClaims = pendingReviewClaims.filter((claim) => claim.status === 'conflict')
  const conflictCount = conflictClaims.length
  const conflictClaim = conflictClaims[0]
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([])
  const [agentExecution, setAgentExecution] = useState<AgentExecution | null>(null)
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditError, setAuditError] = useState('')
  const selectedAgent = selectedAgentId ? run.agents.find((agent) => agent.id === selectedAgentId) : undefined

  const openAgentDetail = async (agentId: string) => {
    setSelectedAgentId(agentId)
    setAuditLoading(true)
    setAuditError('')
    try {
      const result = await getAgentExecution(run.id, agentId)
      setAgentExecution(result)
    } catch (error) {
      setAuditEvents([])
      setAgentExecution(null)
      setAuditError(error instanceof Error ? error.message : '执行记录读取失败')
      message.error('执行记录读取失败')
    } finally {
      setAuditLoading(false)
    }
  }

  const { nodes, edges } = useMemo(() => {
    const find = (id: string) => run.agents.find((agent) => agent.id === id)!
    const asNodeData = (agent: AgentInfo, kind?: 'supervisor' | 'reviewer'): AgentNodeData => {
      // 后端的 reviewer warning 可能来自历史复核事件；当前没有未处理冲突时，
      // 独立复核已经完成，不能继续在执行监控中显示为阻塞节点。
      const status = agent.id === 'reviewer' && agent.status === 'warning' && conflictCount === 0
        ? 'done'
        : agent.status
      const normalizedAgent = { ...agent, status }

      return {
        ...normalizedAgent,
        onOpen: openAgentDetail,
        kind,
        detailLabel: agentDetailLabels[agent.id] ?? '当前进展',
        displayDetail: agent.detail.trim()
          || getAgentFallbackDetail(normalizedAgent, run, pendingReviewClaims.length, conflictCount),
      }
    }
    const rowGap = 170
    const topologyNodes: Node<AgentNodeData>[] = [
      { id: 'supervisor', type: 'agent', position: { x: 300, y: 0 }, data: asNodeData(find('supervisor'), 'supervisor') },
      { id: 'collector', type: 'agent', position: { x: 0, y: rowGap }, data: asNodeData(find('collector')) },
      { id: 'parser', type: 'agent', position: { x: 300, y: rowGap }, data: asNodeData(find('parser')) },
      { id: 'retriever', type: 'agent', position: { x: 600, y: rowGap }, data: asNodeData(find('retriever')) },
      { id: 'scorer', type: 'agent', position: { x: 0, y: rowGap * 2 }, data: asNodeData(find('scorer')) },
      { id: 'assembler', type: 'agent', position: { x: 300, y: rowGap * 2 }, data: asNodeData(find('assembler')) },
      { id: 'reviewer', type: 'agent', position: { x: 300, y: rowGap * 3 }, data: asNodeData(find('reviewer'), 'reviewer') },
    ]

    const normalStyle = { stroke: '#79aaa4', strokeWidth: 1.6 }
    const reviewStyle = { stroke: '#d39a43', strokeWidth: 1.9 }
    const retryStyle = { stroke: '#dc6267', strokeWidth: 1.6, strokeDasharray: '5 4' }
    const workerIds = ['collector', 'parser', 'retriever', 'scorer', 'assembler']
    const topologyEdges: Edge[] = [
      ...workerIds.map((id) => ({
        id: `dispatch-${id}`,
        source: 'supervisor',
        target: id,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, color: '#79aaa4' },
        style: normalStyle,
      })),
      {
        id: 'supervisor-reviewer', source: 'supervisor', target: 'reviewer', type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, color: '#d39a43' }, style: reviewStyle, animated: true,
      },
      ...(conflictCount > 0 ? [{
        id: 'reviewer-supervisor', source: 'reviewer', target: 'supervisor', type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, color: '#dc6267' }, style: retryStyle,
      }] : []),
    ]
    return { nodes: topologyNodes, edges: topologyEdges }
  }, [conflictCount, openAgentDetail, pendingReviewClaims.length, run.agents, run.claims.length, run.evidence.length])

  return (
    <div className="page-card topology-page">
      <div className="page-card-header">
        <div><span className="eyebrow">任务运行状态</span><h2>当前执行链路</h2><p>查看各执行单元的进度、耗时以及仍需关注的主张。</p></div>
        <div className="topology-legend"><span><i className="running" />运行中</span><span><i className="done" />已完成</span><span><i className="warning" />需处理</span></div>
      </div>
      <div className="topology-status-strip">
        <div><span>执行单元</span><strong>{workers.length}</strong></div>
        <div><span>已完成</span><strong>{completedCount}</strong></div>
        <div><span>等待启动</span><strong>{waitingCount}</strong></div>
        <div className={conflictCount > 0 ? 'warning' : pendingReviewClaims.length > 0 ? 'attention' : undefined}>
          <span>待复核主张</span><strong>{pendingReviewClaims.length}</strong>
        </div>
      </div>
      {conflictCount > 0 && (
        <div className="topology-alert">
          <WarningFilled />
          <div><strong>当前阻塞：有 {conflictCount} 条冲突主张尚未处理</strong><span>{conflictClaim.statement}</span></div>
          <Button onClick={() => setActiveView('workbench')}>处理冲突主张</Button>
        </div>
      )}
      <div className="isolation-banner"><LockFilled /><strong>隔离状态正常</strong><span>后台助手只把结果交给小盾，彼此不共享上下文。</span></div>
      <div className="flow-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.04, minZoom: 0.95, maxZoom: 1 }}
          minZoom={0.8}
          maxZoom={1.15}
          nodesDraggable={false}
          nodesConnectable={false}
        >
          <Background color="#dce8e4" gap={24} />
          <Controls />
        </ReactFlow>
      </div>
      <Drawer className="agent-detail-drawer" title={<div><strong>{selectedAgent ? `${agentNames[selectedAgent.id] ?? selectedAgent.name} · 执行记录` : 'Agent 执行记录'}</strong><small>{run.id}</small></div>} closeIcon={<CloseOutlined />} width={520} open={Boolean(selectedAgent)} onClose={() => setSelectedAgentId(null)}>
        {selectedAgent && <div className="agent-detail-drawer-body"><div className="agent-detail-summary"><span className={`agent-detail-mark ${selectedAgent.id === 'reviewer' ? 'reviewer' : selectedAgent.id === 'supervisor' ? 'supervisor' : ''}`}>{selectedAgent.id === 'reviewer' ? '审' : selectedAgent.id === 'supervisor' ? '盾' : '执'}</span><div><strong>{agentNames[selectedAgent.id] ?? selectedAgent.name.replace(/\s*SubAgent$/, '')}</strong><small>{selectedAgent.role}</small></div><Tag color={selectedAgent.status === 'warning' ? 'error' : selectedAgent.status === 'running' ? 'processing' : selectedAgent.status === 'done' ? 'success' : 'default'}>{selectedAgent.status === 'done' ? '已完成' : selectedAgent.status === 'running' ? '运行中' : selectedAgent.status === 'warning' ? '需处理' : '等待中'}</Tag></div><div className="agent-detail-intro"><strong>完整执行过程</strong><span>来自后端 Agent 执行详情</span></div><AgentExecutionDetail execution={agentExecution} loading={auditLoading} error={auditError} onRetry={() => void openAgentDetail(selectedAgent.id)} /></div>}
      </Drawer>
    </div>
  )
}
