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
  const warningCount = run.agents.filter((agent) => agent.status === 'warning').length
  const conflictClaim = run.claims.find((claim) => claim.status === 'conflict')

  const { nodes, edges } = useMemo(() => {
    const find = (id: string) => run.agents.find((agent) => agent.id === id)!
    const asNodeData = (agent: AgentInfo): AgentNodeData => ({ ...agent })
    const topologyNodes: Node<AgentNodeData>[] = [
      { id: 'supervisor', type: 'agent', position: { x: 300, y: 0 }, data: { ...find('supervisor'), kind: 'supervisor' } },
      { id: 'collector', type: 'agent', position: { x: 0, y: 150 }, data: asNodeData(find('collector')) },
      { id: 'parser', type: 'agent', position: { x: 300, y: 150 }, data: asNodeData(find('parser')) },
      { id: 'retriever', type: 'agent', position: { x: 600, y: 150 }, data: asNodeData(find('retriever')) },
      { id: 'scorer', type: 'agent', position: { x: 0, y: 300 }, data: asNodeData(find('scorer')) },
      { id: 'assembler', type: 'agent', position: { x: 300, y: 300 }, data: asNodeData(find('assembler')) },
      { id: 'history', type: 'agent', position: { x: 600, y: 300 }, data: asNodeData(find('history')) },
      { id: 'reviewer', type: 'agent', position: { x: 300, y: 460 }, data: { ...find('reviewer'), kind: 'reviewer' } },
    ]

    const normalStyle = { stroke: '#79aaa4', strokeWidth: 1.6 }
    const reviewStyle = { stroke: '#d39a43', strokeWidth: 1.9 }
    const retryStyle = { stroke: '#dc6267', strokeWidth: 1.6, strokeDasharray: '5 4' }
    const workerIds = ['collector', 'parser', 'retriever', 'scorer', 'assembler', 'history']
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
      {
        id: 'reviewer-supervisor', source: 'reviewer', target: 'supervisor', type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, color: '#dc6267' }, style: retryStyle,
      },
    ]
    return { nodes: topologyNodes, edges: topologyEdges }
  }, [run.agents])

  return (
    <div className="page-card topology-page">
      <div className="page-card-header">
        <div><span className="eyebrow">任务运行状态</span><h2>执行监控</h2><p>查看各执行单元的进度、耗时和异常，快速定位当前阻塞环节。</p></div>
        <div className="topology-legend"><span><i className="running" />运行中</span><span><i className="done" />已完成</span><span><i className="warning" />需处理</span></div>
      </div>
      <div className="topology-status-strip">
        <div><span>执行单元</span><strong>{workers.length}</strong></div>
        <div><span>已完成</span><strong>{completedCount}</strong></div>
        <div><span>等待启动</span><strong>{waitingCount}</strong></div>
        <div className="warning"><span>待处理异常</span><strong>{warningCount}</strong></div>
      </div>
      <div className="topology-alert">
        <WarningFilled />
        <div><strong>当前阻塞：独立审查发现 {warningCount} 项冲突</strong><span>{conflictClaim?.statement ?? '需要返回核验工作台补充交叉证据。'}</span></div>
        <Button onClick={() => setActiveView('workbench')}>查看待核验主张</Button>
      </div>
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
