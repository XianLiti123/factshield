import { useMemo } from 'react'
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
import { CheckCircleFilled, ClockCircleFilled, LoadingOutlined, LockFilled, WarningFilled } from '@ant-design/icons'
import { Button } from 'antd'
import { useWorkspaceStore } from '../store'
import type { AgentInfo, ResearchRun } from '../types'

type AgentNodeData = AgentInfo & {
  kind?: 'supervisor' | 'reviewer'
  detailLabel: string
  displayDetail: string
  [key: string]: unknown
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
    <div className={`agent-node ${data.kind ?? ''} ${data.status}`}>
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
  }, [conflictCount, pendingReviewClaims.length, run.agents, run.claims.length, run.evidence.length])

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
    </div>
  )
}
