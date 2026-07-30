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

type AgentNodeData = AgentInfo & { kind?: 'supervisor' | 'reviewer'; [key: string]: unknown }

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
      <div className="agent-node-detail"><span>执行结果</span><strong>{data.detail}</strong></div>
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
    const asNodeData = (agent: AgentInfo): AgentNodeData => ({
      ...agent,
      // 后端的 reviewer warning 可能来自历史复核事件；当前没有未处理冲突时，
      // 独立复核已经完成，不能继续在执行监控中显示为阻塞节点。
      status: agent.id === 'reviewer' && agent.status === 'warning' && conflictCount === 0
        ? 'done'
        : agent.status,
    })
    const topologyNodes: Node<AgentNodeData>[] = [
      { id: 'supervisor', type: 'agent', position: { x: 300, y: 0 }, data: { ...find('supervisor'), kind: 'supervisor' } },
      { id: 'collector', type: 'agent', position: { x: 0, y: 150 }, data: asNodeData(find('collector')) },
      { id: 'parser', type: 'agent', position: { x: 300, y: 150 }, data: asNodeData(find('parser')) },
      { id: 'retriever', type: 'agent', position: { x: 600, y: 150 }, data: asNodeData(find('retriever')) },
      { id: 'scorer', type: 'agent', position: { x: 0, y: 300 }, data: asNodeData(find('scorer')) },
      { id: 'assembler', type: 'agent', position: { x: 300, y: 300 }, data: asNodeData(find('assembler')) },
      { id: 'reviewer', type: 'agent', position: { x: 300, y: 460 }, data: { ...asNodeData(find('reviewer')), kind: 'reviewer' } },
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
  }, [conflictCount, run.agents])

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
