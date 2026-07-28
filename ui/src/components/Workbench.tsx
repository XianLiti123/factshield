import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  CloudDownloadOutlined,
  DatabaseOutlined,
  FilePdfOutlined,
  FileSearchOutlined,
  LinkOutlined,
  PaperClipOutlined,
  PauseCircleOutlined,
  ReadOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
  SwapOutlined,
  RetweetOutlined,
  UnorderedListOutlined,
  CloseOutlined,
} from '@ant-design/icons'
import { Button, Drawer, Empty, Input, Modal, Progress, Segmented, Steps, Table, Tag, message } from 'antd'
import type { Claim, Evidence, ResearchRun } from '../types'
import { useWorkspaceStore } from '../store'
import { StatusBadge } from './StatusBadge'

type ClaimVisibility = 'issues' | 'all'

type GuidanceRecord = {
  id: number
  afterStep: number
  content: string
  attachments: string[]
  suspectedStages: string[]
}

function TypewriterBroadcast({ text, active, complete }: { text: string; active: boolean; complete: boolean }) {
  const [visibleLength, setVisibleLength] = useState(active ? 0 : text.length)

  useEffect(() => {
    setVisibleLength(active ? 0 : text.length)
  }, [text])

  useEffect(() => {
    if (complete) setVisibleLength(text.length)
  }, [complete, text.length])

  useEffect(() => {
    if (!active || visibleLength >= text.length) return
    const timer = window.setTimeout(() => setVisibleLength((length) => Math.min(length + 1, text.length)), 30)
    return () => window.clearTimeout(timer)
  }, [active, text.length, visibleLength])

  return (
    <p className="process-agent-broadcast">
      {text.slice(0, visibleLength)}
      {active && visibleLength < text.length && <i className="typewriter-cursor" aria-hidden="true" />}
    </p>
  )
}

function ClaimList({
  claims,
  pendingCount,
  visibility,
  onVisibilityChange,
}: {
  claims: Claim[]
  pendingCount: number
  visibility: ClaimVisibility
  onVisibilityChange: (visibility: ClaimVisibility) => void
}) {
  const selectedClaimId = useWorkspaceStore((state) => state.selectedClaimId)
  const selectClaim = useWorkspaceStore((state) => state.selectClaim)

  return (
    <section className="claim-panel">
      <div className="panel-header">
        <div><h2>事实主张</h2><span>{visibility === 'issues' ? '仅显示待人工研判项' : '展示全部可信度等级'}</span></div>
        <strong className={visibility === 'issues' ? 'pending-count' : 'pending-count all'}>{claims.length}</strong>
      </div>
      <div className="claim-visibility-switch">
        <Segmented
          block
          value={visibility}
          onChange={(value) => onVisibilityChange(value as ClaimVisibility)}
          options={[
            { label: `待人工复核（${pendingCount}）`, value: 'issues' },
            { label: '全部核验结论', value: 'all' },
          ]}
        />
      </div>
      <div className="claim-list">
        {claims.map((claim) => (
          <button
            key={claim.id}
            className={selectedClaimId === claim.id ? `claim-item selected ${claim.status}` : 'claim-item'}
            onClick={() => selectClaim(claim.id)}
          >
            <div className="claim-item-top">
              <span className="claim-index">C{String(claim.index).padStart(2, '0')}</span>
              <StatusBadge status={claim.status} compact />
              <span className="claim-score">{Math.round(claim.confidence * 100)}%</span>
            </div>
            <p>{claim.statement}</p>
            <div className="claim-item-footer">
              <span>{claim.issueType ?? claim.category}</span><span>{claim.evidenceIds.length} 条证据</span>
            </div>
          </button>
        ))}
        {claims.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="疑点已全部处理" />}
      </div>
      <div className="auto-pass-note">
        <CheckOutlined /> {visibility === 'issues' ? '可信结论已自动归档，可切换至全部结论查看' : '可信结论已自动归档，无需人工复核'}
      </div>
    </section>
  )
}

function EvidenceCard({ evidence, active, onClick }: { evidence: Evidence; active: boolean; onClick: () => void }) {
  return (
    <button className={active ? 'evidence-card active' : 'evidence-card'} onClick={onClick}>
      <div className="evidence-source-icon"><FilePdfOutlined /></div>
      <div className="evidence-card-copy">
        <div className="evidence-card-title">
          <strong>{evidence.title}</strong>
          <span className={`relation-tag ${evidence.relation}`}>{evidence.relation === 'support' ? '支持' : '质疑'}</span>
        </div>
        <span>{evidence.publisher} · {evidence.locator}</span>
      </div>
      <small>{Math.round(evidence.credibility * 100)}</small>
    </button>
  )
}

function EvidenceViewer({ evidenceList }: { evidenceList: Evidence[] }) {
  const [selectedEvidenceId, setSelectedEvidenceId] = useState(evidenceList[0]?.id ?? '')
  const selectedEvidence = evidenceList.find((item) => item.id === selectedEvidenceId) ?? evidenceList[0]

  if (!selectedEvidence) return <Empty description="该主张暂无证据" />

  return (
    <section className="evidence-panel">
      <div className="panel-header evidence-heading">
        <div><h2>原始证据</h2><span>{evidenceList.length} 条已引用</span></div>
        <Segmented size="small" options={[{ label: '原文', value: 'text' }, { label: '来源信息', value: 'source' }]} />
      </div>
      <div className="evidence-list">
        {evidenceList.map((evidence) => (
          <EvidenceCard
            key={evidence.id}
            evidence={evidence}
            active={evidence.id === selectedEvidence.id}
            onClick={() => setSelectedEvidenceId(evidence.id)}
          />
        ))}
      </div>
      <article className="document-viewer">
        <div className="document-toolbar">
          <div className="document-file">
            <FilePdfOutlined />
            <div><strong>{selectedEvidence.title}</strong><span>原始文件 · 已完成哈希校验</span></div>
          </div>
          <button className="source-link-button" onClick={() => message.info('UI 原型：接入后端后将在此打开原始来源')}><LinkOutlined /> 打开来源</button>
        </div>
        <div className="document-page">
          <div className="document-brand">{selectedEvidence.publisher}</div>
          <h3>{selectedEvidence.title}</h3>
          <div className="document-meta">
            <span>披露日期：{selectedEvidence.publishedAt}</span>
            <span>证据定位：{selectedEvidence.locator}</span>
          </div>
          <p>公司坚持以技术创新推动经营质量提升，在复杂多变的全球市场环境中持续加强供应链管理，并根据客户需求动态优化产品和产能结构。</p>
          <div className={`highlight-quote ${selectedEvidence.relation}`}>
            <span className="quote-marker">核验引用</span>
            “{selectedEvidence.quote}”
          </div>
          <p>相关经营数据均按企业会计准则编制，本段所涉及业务口径与公司年度报告保持一致。部分前瞻性表述可能受到市场环境、原材料价格及项目进度影响。</p>
          <div className="page-number">— {selectedEvidence.locator.split('·')[0]} —</div>
        </div>
      </article>
      <div className="evidence-verification">
        <SafetyCertificateOutlined />
        <div><strong>证据完整性已验证</strong><span>来源可访问 · 原文未篡改 · 引用定位准确</span></div>
        <span className="hash-code">SHA-256 · 9f2c…a817</span>
      </div>
    </section>
  )
}

function VerdictPanel({ claim, onResolve }: { claim: Claim; onResolve: (decision: string) => void }) {
  const [auditOpen, setAuditOpen] = useState(false)
  const [retryOpen, setRetryOpen] = useState(false)
  const decisions = claim.status === 'conflict'
    ? [
        { label: '不采纳', result: '不采纳该主张' },
        { label: '保留并注明', result: '保留并标注疑点' },
      ]
    : claim.status === 'review' ? [
        { label: '删除该表述', result: '删除无法证实的表述' },
        { label: '改为计划投产', result: '改写为计划投产' },
      ] : []

  const comparisonRows = [
    { key: '1', source: '2025 年年度报告', value: '原材料降本', basis: '营业成本分析', stance: '支持原料影响', type: '公司公告' },
    { key: '2', source: '上海有色网 SMM', value: '均价 -21.4%', basis: '电池级碳酸锂年度均价', stance: '支持原料影响', type: '行业数据' },
    { key: '3', source: '投资者关系记录', value: '多因素共同作用', basis: '技术、结构、海外、原料', stance: '质疑单一归因', type: '监管披露' },
  ]

  const auditRows = [
    { key: '1', time: '14:41:26', actor: '独立幻觉审查单元', action: '完成二级复核', input: 'Supervisor 一级汇总 v0.2', output: '标记“归因冲突”，建议重新取证', evidence: 'EV-04 / EV-05 / EV-06' },
    { key: '2', time: '14:41:08', actor: '独立幻觉审查单元', action: '检查证据完整性', input: '3 条原文证据及定位', output: '证据可访问，归因强度不足', evidence: '3 / 3 已验证' },
    { key: '3', time: '14:40:08', actor: 'Supervisor 主控', action: '生成一级汇总结论', input: '4 个 SubAgent 原始结果', output: '初步判断陈述基本成立', evidence: '3 条证据绑定' },
    { key: '4', time: '14:38:36', actor: '向量证据检索 SubAgent', action: '检索匹配原文', input: '毛利率改善归因核验点', output: '返回 3 个原文片段及坐标', evidence: '相似度 0.86–0.94' },
    { key: '5', time: '14:36:42', actor: '文档解析提取 SubAgent', action: '提取结构化指标', input: '年报第 41 页、调研记录问题 12', output: '提取成本与产品结构描述', evidence: '原文坐标已绑定' },
  ]

  return (
    <section className="panel verdict-panel">
      <div className="panel-header">
        <div><h2>双层核验</h2><span>独立结论对照</span></div>
        <StatusBadge status={claim.status} />
      </div>
      <div className="claim-focus">
        <span>当前事实主张 · C{String(claim.index).padStart(2, '0')}</span>
        <p>{claim.statement}</p>
        <div className="confidence-meter">
          <span>综合可信度</span>
          <div><i style={{ width: `${claim.confidence * 100}%` }} /></div>
          <strong>{Math.round(claim.confidence * 100)}%</strong>
        </div>
      </div>

      {claim.status === 'verified' ? (
        <div className="verified-view-bar">
          <CheckOutlined />
          <div><strong>两级核验结论一致</strong><span>该绿色结论已自动通过，无需人工操作</span></div>
        </div>
      ) : (
        <div className={`quick-decision-bar ${claim.status}`}>
          <div>
            <span>你的判断</span>
            <strong>{claim.status === 'conflict' ? '归因证据存在冲突' : '现有证据无法证实该表述'}</strong>
          </div>
          {decisions.map((decision) => (
            <button key={decision.label} onClick={() => onResolve(decision.result)}>{decision.label}</button>
          ))}
          <button className="primary" onClick={() => setRetryOpen(true)}><RetweetOutlined /> 重新取证</button>
        </div>
      )}

      <div className="verification-flow">
        <div className="verdict-card supervisor">
          <div className="verdict-card-header">
            <div className="verdict-avatar">S</div>
            <div><strong>Supervisor 一级汇总</strong><span><ClockCircleOutlined /> 14:40:08 完成</span></div>
            <span className="verdict-state"><CheckOutlined /> 已完成</span>
          </div>
          <p>{claim.supervisorVerdict}</p>
          <div className="verdict-basis"><BookOutlined /> 基于 {claim.evidenceIds.length} 条证据形成结论</div>
        </div>

        <div className="flow-connector"><span /><SwapOutlined /><span /></div>

        <div className="verdict-card reviewer">
          <div className="verdict-card-header">
            <div className="verdict-avatar">R</div>
            <div><strong>独立幻觉审查</strong><span><ClockCircleOutlined /> 14:41:26 完成</span></div>
            <span className={claim.status === 'verified' ? 'verdict-state' : 'verdict-state warning'}>
              {claim.status === 'verified' ? <><CheckOutlined /> 一致</> : '发现分歧'}
            </span>
          </div>
          <p>{claim.reviewerVerdict}</p>
          <div className="independence-note"><SafetyCertificateOutlined /> 未读取其他 SubAgent 推理过程</div>
        </div>
      </div>

      {claim.conflictReason && (
        <div className="conflict-box">
          <div className="conflict-title"><SwapOutlined /><strong>高度存疑说明</strong><span>{claim.issueType ?? '证据冲突'}</span></div>
          <p>{claim.conflictReason}</p>
          <div className="comparison-table-wrap">
            <div className="comparison-title"><strong>多源依据并排对比</strong><span>问题类型与可信度等级分开呈现</span></div>
            <Table
              size="small"
              pagination={false}
              tableLayout="fixed"
              dataSource={comparisonRows}
              columns={[
                { title: '来源', dataIndex: 'source', width: '23%' },
                { title: '披露内容', dataIndex: 'value', width: '21%' },
                { title: '口径/依据', dataIndex: 'basis', width: '28%' },
                { title: '关系', dataIndex: 'stance', width: '28%', render: (value) => <Tag color={value.startsWith('质疑') ? 'red' : 'green'}>{value}</Tag> },
              ]}
            />
          </div>
        </div>
      )}

      {!claim.conflictReason && claim.status === 'review' && (
        <div className="review-box">
          <div className="conflict-title"><SafetyCertificateOutlined /><strong>当前证据不足</strong><span>{claim.issueType}</span></div>
          <p>系统只能确认项目将分阶段释放产能，现有原文没有承诺“2026 年第四季度满产”。</p>
        </div>
      )}

      <div className="audit-mini">
        <div className="audit-title"><strong>关键审计记录</strong><button onClick={() => setAuditOpen(true)}>查看全部</button></div>
        <div><i className="blue" /><span>14:41:26</span><p>Reviewer 完成独立复核</p></div>
        <div><i className="orange" /><span>14:41:08</span><p>识别到因果归因证据不足</p></div>
        <div><i className="green" /><span>14:40:08</span><p>Supervisor 生成一级结论</p></div>
      </div>

      <Drawer title="全链路审计记录" width={820} open={auditOpen} onClose={() => setAuditOpen(false)} extra={<Tag color="blue">Mock 数据</Tag>}>
        <div className="audit-drawer-intro"><UnorderedListOutlined /><div><strong>C{String(claim.index).padStart(2, '0')} · {claim.statement}</strong><span>记录执行单元、输入输出、证据绑定、一级汇总与二级复核；本记录仅为 UI 展示。</span></div></div>
        <Table
          size="small"
          pagination={false}
          scroll={{ x: 760 }}
          dataSource={auditRows}
          columns={[
            { title: '时间', dataIndex: 'time', width: 82 },
            { title: '执行单元', dataIndex: 'actor', width: 165 },
            { title: '操作', dataIndex: 'action', width: 130 },
            { title: '输入', dataIndex: 'input' },
            { title: '输出', dataIndex: 'output' },
            { title: '证据/状态', dataIndex: 'evidence', width: 135 },
          ]}
        />
        <div className="audit-seal"><SafetyCertificateOutlined /><div><strong>审计链完整</strong><span>各环节时间、来源与原文定位均已记录；未展示任何 SubAgent 间直接通信。</span></div></div>
      </Drawer>

      <Modal title="发起第二轮取证" open={retryOpen} onCancel={() => setRetryOpen(false)} onOk={() => { setRetryOpen(false); message.success('重新取证流程已加入 Mock 运行队列') }} okText="确认发起" cancelText="取消" width={660}>
        <div className="mock-notice"><RetweetOutlined /><span>本操作只演示 UI 流程，不会实际调度任何 Agent 或访问外部数据。</span></div>
        <div className="retry-summary"><strong>触发原因</strong><p>{claim.conflictReason}</p></div>
        <Steps
          direction="vertical"
          size="small"
          current={0}
          items={[
            { title: 'Supervisor 接收复核疑点', description: '问题类型：归因冲突；缺少各因素贡献的定量拆分。' },
            { title: '重新派发原子任务', description: '仅向公开信源采集、文档解析、证据检索单元追加限定任务。' },
            { title: '新旧证据并排比较', description: '保留第一轮证据，不覆盖历史记录。' },
            { title: '再次进入独立审查', description: '形成第二轮可信度标签，最终由研究员研判。' },
          ]}
        />
      </Modal>
    </section>
  )
}

export function Workbench({ run }: { run: ResearchRun }) {
  const [claimVisibility, setClaimVisibility] = useState<ClaimVisibility>('issues')
  const [guidance, setGuidance] = useState('')
  const [guidanceHistory, setGuidanceHistory] = useState<GuidanceRecord[]>([])
  const [guidanceAttachments, setGuidanceAttachments] = useState<File[]>([])
  const [suspectedEventSteps, setSuspectedEventSteps] = useState<number[]>([])
  const processListRef = useRef<HTMLDivElement>(null)
  const guidanceAttachmentInputRef = useRef<HTMLInputElement>(null)
  const taskPhase = useWorkspaceStore((state) => state.taskPhase)
  const researchTopic = useWorkspaceStore((state) => state.researchTopic)
  const demoStep = useWorkspaceStore((state) => state.demoStep)
  const isDemoRunning = useWorkspaceStore((state) => state.isDemoRunning)
  const reviewedClaimIds = useWorkspaceStore((state) => state.reviewedClaimIds)
  const selectedClaimId = useWorkspaceStore((state) => state.selectedClaimId)
  const selectClaim = useWorkspaceStore((state) => state.selectClaim)
  const resolveClaim = useWorkspaceStore((state) => state.resolveClaim)
  const finishResearch = useWorkspaceStore((state) => state.finishResearch)
  const stopDemo = useWorkspaceStore((state) => state.stopDemo)
  const resumeDemo = useWorkspaceStore((state) => state.resumeDemo)
  const setActiveView = useWorkspaceStore((state) => state.setActiveView)
  const pendingClaims = run.claims.filter((claim) => claim.status !== 'verified' && !reviewedClaimIds.includes(claim.id))
  const visibleClaims = claimVisibility === 'all' ? run.claims : pendingClaims
  const selectedClaim = visibleClaims.find((claim) => claim.id === selectedClaimId) ?? visibleClaims[0] ?? run.claims[0]
  const evidenceList = useMemo(
    () => run.evidence.filter((evidence) => selectedClaim.evidenceIds.includes(evidence.id)),
    [run.evidence, selectedClaim.evidenceIds],
  )

  const handleResolve = (decision: string) => {
    const nextClaim = pendingClaims.find((claim) => claim.id !== selectedClaim.id)
    resolveClaim(selectedClaim.id, nextClaim?.id)
    message.success(nextClaim ? `${decision}，已自动进入下一条` : `${decision}，所有疑点已处理`)
  }

  const changeClaimVisibility = (visibility: ClaimVisibility) => {
    setClaimVisibility(visibility)
    if (visibility === 'issues' && selectedClaim.status === 'verified' && pendingClaims[0]) {
      selectClaim(pendingClaims[0].id)
    }
  }

  useEffect(() => {
    if (taskPhase !== 'running') return
    const frame = window.requestAnimationFrame(() => {
      processListRef.current?.querySelector('[data-current="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [demoStep, guidanceHistory.length, taskPhase])

  if (taskPhase === 'running') {
    const progress = Math.round((demoStep / 8) * 100)
    const runningSteps = [
      { title: '采集并解析资料', description: '归档公开披露和补充材料，提取原文坐标' },
      { title: '多源交叉核验', description: 'Supervisor 汇总，独立审查单元二次复核' },
      { title: '筛出需要人工判断的疑点', description: '可信结论自动进入底稿，黄红疑点等待你处理' },
    ]
    const processEvents = [
      {
        step: 0,
        time: '14:32:01',
        actor: 'Supervisor 主控',
        icon: <FileSearchOutlined />,
        title: '开始理解研究任务',
        speech: `我现在开始核验“${researchTopic || run.title}”。这不是一个只核对数字的问题，我需要同时确认经营质量、海外增长、盈利改善归因和欧洲产能风险。先把研究对象、时间范围和证据标准定清楚，再开始取证。`,
        details: [
          { label: '对象识别', text: '宁德时代（300750.SZ），报告期限定为 2025 财年；涉及历史比较时向前回溯三年。' },
          { label: '核验范围', text: '经营质量、海外收入、盈利改善归因、欧洲产能进度与关键风险。' },
          { label: '证据约束', text: '监管披露和公司原文优先；结论必须绑定文件名、页码或问答序号，不接受无出处转述。' },
          { label: '输出约束', text: '区分事实、管理层判断与研究推断；证据不足时保留疑点，不补写确定性结论。' },
        ],
        metrics: ['1 个研究对象', '4 个核验维度', '一手信源优先'],
      },
      {
        step: 1,
        time: '14:32:04',
        actor: 'Supervisor 主控',
        icon: <FileSearchOutlined />,
        title: '拆分需要分别核验的问题',
        speech: '这个问题里混合了数字、排名、因果归因和未来产能四类判断，不能用同一组证据一次回答。我已经拆成 5 条可以独立判断真假的事实主张，接下来分别取证。各执行单元只接收自己的任务，不会互相传递判断。',
        details: [
          { label: '任务 C01', text: '核对营业收入同比增速，并判断海外业务是否构成主要增量来源。' },
          { label: '任务 C02', text: '核对全球动力电池使用量排名及连续领先年限。' },
          { label: '任务 C03', text: '区分原材料降价、产品结构与海外客户对毛利率改善的影响。' },
          { label: '任务 C04', text: '核对匈牙利工厂投产、产能释放与“满产”时点之间的表述差异。' },
          { label: '任务 C05', text: '复算经营现金流净额与归母净利润的三年关系。' },
        ],
        metrics: ['5 条事实主张', '4 个隔离执行单元'],
      },
      {
        step: 2,
        time: '14:32:16',
        actor: '公开信源检索 SubAgent',
        icon: <DatabaseOutlined />,
        title: '开始检索公开信源',
        speech: '我现在开始为 5 条主张分别寻找原始来源。先检索监管披露和公司公告，再用独立行业数据做交叉确认。搜索摘要不能直接作为证据，所以我会打开原文，并排除重复转载、期间不一致和无法定位出处的材料。',
        details: [
          { label: '检索请求 01', text: '“宁德时代 2025 年报 营业收入 境外收入”——命中 9 份，保留年报及业绩说明会记录。' },
          { label: '检索请求 02', text: '“宁德时代 匈牙利工厂 产能释放 满产”——命中 7 份，保留公司公告与互动易答复。' },
          { label: '检索请求 03', text: '“CATL battery usage ranking 2025 SNE Research”——命中 8 份，保留行业统计原始发布。' },
          { label: '结果筛选', text: '共命中 24 份；排除重复转载 5 份、无法定位原文 2 份、统计期间不一致 1 份。' },
          { label: '候选来源', text: '巨潮资讯、深交所互动易、SNE Research、上海有色网 SMM，共保留 16 份材料。' },
        ],
        metrics: ['命中 24 份', '保留 16 份', '排除 8 份'],
      },
      {
        step: 3,
        time: '14:33:02',
        actor: '文档解析 SubAgent',
        icon: <ReadOutlined />,
        title: '逐份打开材料并读取原文',
        speech: '检索结果已经筛完，我正在逐份打开保留下来的材料。年报中的数字要同时核对单位和上期口径；管理层回答要连同上下文阅读，不能只摘一句。我会把每个可用结论绑定到文件名、页码或问答序号。',
        details: [
          { label: '已浏览 01', text: '《2025 年年度报告》第 26 页——提取营业总收入、同比增速、境外收入及对应单位。' },
          { label: '已浏览 02', text: '《2025 年年度报告》第 41 页——定位主要原材料价格与营业成本变化说明。' },
          { label: '已浏览 03', text: '业绩说明会问题 12——原文同时列出技术、产品结构、海外客户与原材料因素。' },
          { label: '已浏览 04', text: '业绩说明会问题 15——原文仅说明项目将按建设进度和客户需求分阶段释放产能。' },
          { label: '字段检查', text: '统一金额单位为亿元、比例保留两位小数；8 处摘录均已绑定原始页码或问题序号。' },
        ],
        metrics: ['浏览 8 份原文', '提取 18 个字段', '绑定 8 处坐标'],
      },
      {
        step: 4,
        time: '14:34:18',
        actor: '证据交叉核验 SubAgent',
        icon: <SwapOutlined />,
        title: '比对不同来源的口径与结论',
        tone: 'warning',
        speech: '我开始把公司披露、监管问答和行业数据并排核对。收入增速和现金流复算都能对上，但毛利率归因出现了问题：原文明确提到多个共同因素，把它写成“主要来自原材料下降”会夸大证据。匈牙利工厂的确定满产日期也还没有找到直接来源。',
        details: [
          { label: 'C01 · 数值复算', text: '年报披露收入增速 18.2%；按本期与上期原始值复算为 18.17%，四舍五入口径一致。' },
          { label: 'C02 · 来源一致', text: '公司披露与 SNE Research 的排名方向一致，统计对象均为全球动力电池使用量。' },
          { label: 'C03 · 归因冲突', text: '原材料价格下降得到支持，但管理层原文同时列出产品结构与海外客户因素，无法证明单一主因。' },
          { label: 'C04 · 证据缺口', text: '公开来源仅确认分阶段释放产能，未发现“2026 年第四季度满产”的明确承诺。' },
          { label: 'C05 · 现金流复算', text: '三年经营现金流净额均覆盖归母净利润，计算结果与年报现金流量表一致。' },
        ],
        metrics: ['3 组口径一致', '1 项归因冲突', '1 项证据缺口'],
      },
      {
        step: 5,
        time: '14:35:06',
        actor: 'Supervisor 主控',
        icon: <SafetyCertificateOutlined />,
        title: '汇总第一轮核验结果',
        tone: 'warning',
        speech: '第一轮结果已经回到我这里。C01、C02 和 C05 的证据可以相互印证，我先列为可信候选。C03 的“主要来自原材料下降”非常可疑，因为没有任何来源给出各因素贡献度；C04 的满产时点也超出了原文边界。这两项不能自动进入底稿。',
        details: [
          { label: '合并结果', text: 'C01、C02、C05 获得一手来源或一手来源与独立来源共同支持，进入可信结论候选。' },
          { label: '保留分歧', text: 'C03 中“主要来自原材料下降”缺少贡献度拆分，不将多因素表述改写为单一因果。' },
          { label: '限制结论', text: 'C04 的“满产时点”超出原文可支持范围，标记为证据不足并进入人工队列。' },
          { label: '证据绑定', text: '5 条一级结论共绑定 8 份原始材料，引用均可回到页码、表格或问答序号。' },
        ],
        metrics: ['5 条一级结论', '8 份证据绑定', '2 项疑点'],
      },
      {
        step: 6,
        time: '14:35:29',
        actor: '独立幻觉审查单元',
        icon: <SafetyCertificateOutlined />,
        title: '独立审查单元重新核验',
        tone: 'danger',
        speech: '我现在以独立审查单元的身份重新检查这些结论。我没有读取其他 SubAgent 的过程，只看待核主张和原始证据。复算结果一致，但 C03 确实把“多因素共同作用”强化成了“单一主要原因”；C04 也把产能释放计划外推成了确定日期。这两项需要退回。',
        details: [
          { label: '引用忠实度', text: '逐条比对摘录与上下文，未发现断章取义；8 处引用定位均可复现。' },
          { label: '数值复算', text: '重新计算收入增速与现金流覆盖关系，结果与一级汇总一致。' },
          { label: '发现分歧', text: '“主要来自”属于强因果表述，现有材料只能证明多因素共同作用。' },
          { label: '边界检查', text: '产能材料描述的是计划与释放节奏，不能外推出确定的满产日期。' },
        ],
        metrics: ['复核 5 条主张', '发现 2 项分歧', '引用定位完整'],
      },
      {
        step: 7,
        time: '14:35:46',
        actor: 'Supervisor 主控',
        icon: <CheckOutlined />,
        title: '给出最终分级并说明原因',
        tone: 'danger',
        speech: '二级复核完成。C01、C02、C05 定为可信并自动归档；C03 存在明显的因果夸大，我把它定为高度存疑项，禁止直接写入正式结论；C04 缺少确定满产日期的直接证据，需要你自行复核，可以选择改写为“分阶段释放产能”或要求系统继续取证。',
        details: [
          { label: '自动归档', text: 'C01、C02、C05 证据充分且二级复核一致，自动写入研究底稿。' },
          { label: '待人工复核', text: 'C04 缺少确定满产日期的直接证据，允许研究员改写为“分阶段释放”或追加取证。' },
          { label: '高度存疑', text: 'C03 存在重大归因冲突，在研究员处理前禁止进入正式结论。' },
          { label: '交付准备', text: '已整理事实主张、原始证据链、一级汇总、二级复核记录及历史情景附件。' },
        ],
        metrics: ['可信 3', '待复核 1', '高度存疑 1'],
      },
    ]
    const visibleEvents = processEvents.filter((event) => event.step <= demoStep)
    const suspectedEvents = visibleEvents.filter((event) => suspectedEventSteps.includes(event.step))
    const hasGuidanceChanges = guidance.trim().length > 0 || guidanceAttachments.length > 0 || suspectedEvents.length > 0
    const toggleSuspectedEvent = (step: number) => {
      setSuspectedEventSteps((current) => current.includes(step) ? current.filter((item) => item !== step) : [...current, step])
    }
    const submitGuidance = () => {
      const content = guidance.trim()
      if (!hasGuidanceChanges) {
        resumeDemo()
        message.success('已从当前进度继续研究')
        return
      }
      setGuidanceHistory((current) => [...current, {
        id: Date.now(),
        afterStep: demoStep,
        content: content || (suspectedEvents.length > 0 ? '请重新检查已标记的可疑环节。' : '请结合补充附件继续核验。'),
        attachments: guidanceAttachments.map((file) => file.name),
        suspectedStages: suspectedEvents.map((event) => event.title),
      }])
      setGuidance('')
      setGuidanceAttachments([])
      setSuspectedEventSteps([])
      resumeDemo()
      message.success('研究要求已记录，系统将从当前进度继续')
    }
    const addGuidanceAttachments = (files: FileList | null) => {
      if (!files) return
      setGuidanceAttachments((current) => {
        const existing = new Set(current.map((file) => `${file.name}-${file.size}`))
        const additions = Array.from(files).filter((file) => !existing.has(`${file.name}-${file.size}`))
        return [...current, ...additions].slice(0, 5)
      })
      if (guidanceAttachmentInputRef.current) guidanceAttachmentInputRef.current.value = ''
    }
    return (
      <div className="research-running-page">
        <div className="running-two-column-layout">
          <section className="running-progress-card">
          <div className="running-card-heading">
            <div>
              <span className={isDemoRunning ? 'start-kicker' : 'start-kicker paused'}><i /> {isDemoRunning ? '系统正在自动研究' : '研究过程已暂停'}</span>
              <h2>{researchTopic || run.title}</h2>
              <p>{isDemoRunning ? '系统正在自动采集、核验与整理证据；需要人工判断时会提醒你。' : '当前任务与已有证据均已保留，请补充要求后继续。'}</p>
            </div>
          </div>
          <Progress percent={progress} showInfo={false} strokeColor="#0d6575" trailColor="#dfeae6" />
          <div className="running-progress-meta"><strong>{progress}%</strong><span>{isDemoRunning ? '持续记录研究执行过程（UI 演示）' : '已停在当前进度，等待研究员引导'}</span></div>
          <Steps direction="vertical" size="small" current={Math.min(Math.floor(demoStep / 3), 2)} items={runningSteps} />
          <div className="running-progress-summary">
            <div><span>已归档材料</span><strong>{Math.min(12, demoStep * 2 + 2)}</strong><small>份公开原文</small></div>
            <div><span>已生成主张</span><strong>{Math.min(5, Math.max(1, demoStep))}</strong><small>条核验结论</small></div>
            <div><span>当前阶段</span><strong>{Math.min(Math.floor(demoStep / 3) + 1, 3)} / 3</strong><small>{runningSteps[Math.min(Math.floor(demoStep / 3), 2)].title}</small></div>
          </div>
          <div className="running-footer-actions"><Button onClick={() => finishResearch('claim-3')}>直接查看演示结果</Button></div>
          </section>

          <section className="research-process-panel running-process-card">
            <div className="process-panel-heading">
              <div><strong>Supervisor 实时播报</strong><span>一边执行研究，一边说明正在做什么、发现了什么以及为何需要你复核</span></div>
              <div className="process-panel-actions">
                <span className={isDemoRunning ? 'process-recording' : 'process-recording paused'}><i /> {isDemoRunning ? '实时记录' : '已暂停'}</span>
                <Button danger icon={<PauseCircleOutlined />} disabled={!isDemoRunning} onClick={stopDemo}>终止</Button>
              </div>
            </div>
            <div className="research-process-list" ref={processListRef}>
              {visibleEvents.map((event, index) => {
                const isLatest = index === visibleEvents.length - 1
                const eventGuidanceRecords = guidanceHistory.filter((item) => item.afterStep === event.step)
                const isCurrent = isLatest && isDemoRunning && eventGuidanceRecords.length === 0
                const isTimelineTail = isLatest && eventGuidanceRecords.length === 0
                return (
                  <Fragment key={event.step}>
                    <div
                      className={`research-process-item${isCurrent ? ' current' : ''}${event.tone ? ` ${event.tone}` : ''}${suspectedEventSteps.includes(event.step) ? ' suspected' : ''}${!isDemoRunning ? ' paused-review' : ''}`}
                      data-current={isTimelineTail ? 'true' : undefined}
                    >
                      <span className="process-item-icon">{event.icon}</span>
                      <div className="process-item-content">
                        <div className="process-item-title"><strong>{event.title}</strong><span>{event.actor} · {event.time}</span></div>
                        <TypewriterBroadcast text={event.speech} active={isCurrent} complete={!isCurrent} />
                        <div className="process-evidence-label">本步执行依据</div>
                        <ul>{event.details.map((detail) => <li key={detail.label}><b>{detail.label}</b><span>{detail.text}</span></li>)}</ul>
                        <div className="process-item-metrics">{event.metrics.map((metric) => <span key={metric}>{metric}</span>)}</div>
                      </div>
                      <div className="process-item-controls">
                        <small>{isCurrent ? '进行中' : isLatest && !isDemoRunning && eventGuidanceRecords.length === 0 ? '已暂停' : '已完成'}</small>
                        {!isDemoRunning && (
                          <button
                            className={suspectedEventSteps.includes(event.step) ? 'process-issue-button selected' : 'process-issue-button'}
                            onClick={() => toggleSuspectedEvent(event.step)}
                          >
                            {suspectedEventSteps.includes(event.step) ? <><CheckOutlined /> 已标记</> : '有问题'}
                          </button>
                        )}
                      </div>
                    </div>
                    {eventGuidanceRecords.map((item, guidanceIndex) => {
                      const isGuidanceTail = isLatest && guidanceIndex === eventGuidanceRecords.length - 1
                      return (
                        <div className="research-process-item guidance" data-current={isGuidanceTail ? 'true' : undefined} key={item.id}>
                          <span className="process-item-icon"><SendOutlined /></span>
                          <div className="process-item-content">
                            <strong>研究员补充指令</strong>
                            <p className="process-agent-broadcast">{item.content}</p>
                            {item.suspectedStages.length > 0 && <div className="guidance-record-stages">{item.suspectedStages.map((stage) => <span key={stage}><SafetyCertificateOutlined />怀疑环节：{stage}</span>)}</div>}
                            {item.attachments.length > 0 && <div className="guidance-record-attachments">{item.attachments.map((fileName) => <span key={fileName}><PaperClipOutlined />{fileName}</span>)}</div>}
                            <div className="process-item-metrics"><span>Supervisor 已接收</span><span>从当前节点继续</span></div>
                          </div>
                          <small>已提交</small>
                        </div>
                      )
                    })}
                  </Fragment>
                )
              })}
            </div>

            {!isDemoRunning && (
              <div className="process-guidance-box">
                <div><strong>{suspectedEvents.length > 0 ? `处理 ${suspectedEvents.length} 个怀疑环节` : '调整研究方向'}</strong><span>{suspectedEvents.length > 0 ? '补充说明或材料后，Supervisor 将针对这些环节重新检查。' : '可以直接继续，也可以补充要求、附件或标记有问题的环节。'}</span></div>
                {suspectedEvents.length > 0 && (
                  <div className="suspected-stage-chips">
                    {suspectedEvents.map((event) => (
                      <div key={event.step} className="suspected-stage-chip">
                        <span className="suspected-stage-icon">{event.icon}</span>
                        <div><strong>{event.title}</strong><small>{event.actor}</small></div>
                        <button aria-label={`移除怀疑环节 ${event.title}`} onClick={() => toggleSuspectedEvent(event.step)}><CloseOutlined /></button>
                      </div>
                    ))}
                  </div>
                )}
                <Input.TextArea
                  value={guidance}
                  onChange={(event) => setGuidance(event.target.value)}
                  onPressEnter={(event) => {
                    if (!event.shiftKey) {
                      event.preventDefault()
                      submitGuidance()
                    }
                  }}
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  placeholder={suspectedEvents.length > 0 ? '说明这个环节存在什么问题，或直接提交让 Supervisor 重新检查…' : '例如：优先核对监管披露，并补充 2024—2025 年同口径数据…'}
                />
                {guidanceAttachments.length > 0 && (
                  <div className="guidance-pending-attachments">
                    {guidanceAttachments.map((file, index) => (
                      <span key={`${file.name}-${file.size}`}>
                        <PaperClipOutlined /><em>{file.name}</em>
                        <button aria-label={`移除引导附件 ${file.name}`} onClick={() => setGuidanceAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}><CloseOutlined /></button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="process-guidance-actions">
                  <div className="process-guidance-tools">
                    <input
                      ref={guidanceAttachmentInputRef}
                      type="file"
                      multiple
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg"
                      onChange={(event) => addGuidanceAttachments(event.target.files)}
                    />
                    <Button type="text" icon={<PaperClipOutlined />} onClick={() => guidanceAttachmentInputRef.current?.click()}>添加附件</Button>
                  </div>
                  <Button type="primary" icon={hasGuidanceChanges ? <SendOutlined /> : undefined} onClick={submitGuidance}>{hasGuidanceChanges ? '提交并继续' : '继续'}</Button>
                  <span className="process-guidance-shortcut">Enter 提交 · Shift + Enter 换行</span>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    )
  }

  if (taskPhase === 'ready') {
    return (
      <div className="research-ready-page">
        <section className="ready-focus-card">
          <div className="ready-icon"><CheckOutlined /></div>
          <span>研究已完成</span>
          <h2>疑点已全部处理，底稿可以交付。</h2>
          <p>5 条事实主张、8 份原始证据、双层核验记录与历史情景附件已经整理完毕。</p>
          <div className="ready-summary"><span><strong>3</strong>可信结论</span><span><strong>2</strong>人工复核</span><span><strong>8</strong>原始证据</span></div>
          <div className="ready-actions">
            <Button type="primary" size="large" icon={<CloudDownloadOutlined />} onClick={() => setActiveView('reports')}>查看并导出底稿</Button>
            <Button size="large" onClick={() => setActiveView('tasks')}>开始新研究</Button>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="workbench-shell">
      <div className="review-queue-header">
        <div><span>系统已完成自动核验</span><h2>只需处理 {pendingClaims.length} 条疑点</h2><p>左侧选疑点，中间看原文，右侧做一次判断。处理后自动进入下一条。</p></div>
        <div className="review-progress"><strong>{reviewedClaimIds.length} / 2</strong><span>已处理</span></div>
      </div>
      <div className="workbench-grid">
        <section className="panel evidence-workspace">
          <ClaimList
            claims={visibleClaims}
            pendingCount={pendingClaims.length}
            visibility={claimVisibility}
            onVisibilityChange={changeClaimVisibility}
          />
          <EvidenceViewer key={selectedClaim.id} evidenceList={evidenceList} />
        </section>
        <VerdictPanel claim={selectedClaim} onResolve={handleResolve} />
      </div>
    </div>
  )
}
