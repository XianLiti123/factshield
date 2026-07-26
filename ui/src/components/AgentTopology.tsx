import { useMemo } from 'react'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import { CheckCircleFilled, ClockCircleFilled, LoadingOutlined, LockFilled, WarningFilled } from '@ant-design/icons'
import type { AgentInfo, ResearchRun } from '../types'

type AgentNodeData = AgentInfo & { kind?: 'supervisor' | 'reviewer'; [key: string]: unknown }

function AgentNode({ data }: NodeProps<Node<AgentNodeData>>) {
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
        <span className="agent-node-icon">{data.kind === 'reviewer' ? 'R' : data.kind === 'supervisor' ? 'S' : 'A'}</span>
        <div><strong>{data.name}</strong><span>{data.role}</span></div>
        <i>{statusIcon}</i>
      </div>
      <div className="agent-node-detail">{data.detail}</div>
      <div className="agent-node-restriction"><LockFilled /> {data.restriction}</div>
      <div className="agent-node-footer"><span>{data.duration ?? '等待中'}</span><span>上下文隔离</span></div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

const nodeTypes = { agent: AgentNode }

export function AgentTopology({ run }: { run: ResearchRun }) {
  const { nodes, edges } = useMemo(() => {
    const find = (id: string) => run.agents.find((agent) => agent.id === id)!
    const asNodeData = (agent: AgentInfo): AgentNodeData => ({ ...agent })
    const topologyNodes: Node<AgentNodeData>[] = [
      { id: 'supervisor', type: 'agent', position: { x: 625, y: 10 }, data: { ...find('supervisor'), kind: 'supervisor' } },
      { id: 'collector', type: 'agent', position: { x: 0, y: 235 }, data: asNodeData(find('collector')) },
      { id: 'parser', type: 'agent', position: { x: 255, y: 235 }, data: asNodeData(find('parser')) },
      { id: 'retriever', type: 'agent', position: { x: 510, y: 235 }, data: asNodeData(find('retriever')) },
      { id: 'scorer', type: 'agent', position: { x: 765, y: 235 }, data: asNodeData(find('scorer')) },
      { id: 'assembler', type: 'agent', position: { x: 1020, y: 235 }, data: asNodeData(find('assembler')) },
      { id: 'history', type: 'agent', position: { x: 1275, y: 235 }, data: asNodeData(find('history')) },
      { id: 'reviewer', type: 'agent', position: { x: 625, y: 495 }, data: { ...find('reviewer'), kind: 'reviewer' } },
    ]

    const normalStyle = { stroke: '#8fa8d8', strokeWidth: 1.6 }
    const reviewStyle = { stroke: '#8c68c7', strokeWidth: 1.9 }
    const retryStyle = { stroke: '#dc6267', strokeWidth: 1.6, strokeDasharray: '5 4' }
    const workerIds = ['collector', 'parser', 'retriever', 'scorer', 'assembler', 'history']
    const topologyEdges: Edge[] = [
      ...workerIds.flatMap((id) => [
        {
          id: `dispatch-${id}`, source: 'supervisor', target: id, type: 'smoothstep',
          label: id === 'assembler' ? '核验通过后下发' : '受控派发',
          markerEnd: { type: MarkerType.ArrowClosed, color: '#8fa8d8' }, style: normalStyle,
        },
        {
          id: `return-${id}`, source: id, target: 'supervisor', type: 'smoothstep',
          markerEnd: { type: MarkerType.ArrowClosed, color: '#8fa8d8' }, style: normalStyle,
        },
      ]),
      {
        id: 'supervisor-reviewer', source: 'supervisor', target: 'reviewer', type: 'smoothstep', label: '一级汇总后送审',
        markerEnd: { type: MarkerType.ArrowClosed, color: '#8c68c7' }, style: reviewStyle, animated: true,
      },
      {
        id: 'reviewer-supervisor', source: 'reviewer', target: 'supervisor', type: 'smoothstep', label: '复核结果回传',
        markerEnd: { type: MarkerType.ArrowClosed, color: '#dc6267' }, style: retryStyle,
      },
    ]
    return { nodes: topologyNodes, edges: topologyEdges }
  }, [run.agents])

  return (
    <div className="page-card topology-page">
      <div className="page-card-header">
        <div><span className="eyebrow">Mock 运行可视化</span><h2>Supervisor–SubAgent 受控执行拓扑</h2><p>本页仅为 UI 演示：SubAgent 只与 Supervisor 交换结果，独立审查单元不直接读取 SubAgent 输出。</p></div>
        <div className="topology-legend"><span><i className="running" />运行中</span><span><i className="done" />已完成</span><span><i className="warning" />需关注</span></div>
      </div>
      <div className="isolation-banner"><LockFilled /><strong>唯一通信边界：Supervisor</strong><span>6 个职能 SubAgent 彼此无连线、无共享上下文；历史情景复盘是必备模块，运行时由研究员手动触发。</span></div>
      <div className="topology-flow-note">
        <span>① 主控拆解并派发</span><b>→</b><span>② SubAgent 独立执行</span><b>→</b><span>③ 结果回主控汇总</span><b>→</b><span>④ 独立二级复核</span><b>→</b><span>⑤ 疑点回主控重取证</span>
      </div>
      <div className="flow-canvas">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.12 }} minZoom={0.5} maxZoom={1.35}>
          <Background color="#dfe5f1" gap={24} />
          <Controls />
          <MiniMap pannable zoomable nodeColor={(node) => node.id === 'reviewer' ? '#7c3aed' : node.id === 'supervisor' ? '#246bfd' : '#a9b8d4'} />
        </ReactFlow>
      </div>
    </div>
  )
}
