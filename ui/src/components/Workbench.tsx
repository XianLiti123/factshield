import { useMemo, useState } from 'react'
import {
  BookOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  FilePdfOutlined,
  FilterOutlined,
  LinkOutlined,
  SearchOutlined,
  SafetyCertificateOutlined,
  SwapOutlined,
  RetweetOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import { Button, Drawer, Empty, Input, Modal, Segmented, Select, Steps, Table, Tag, Tooltip, message } from 'antd'
import type { Claim, Evidence, ResearchRun } from '../types'
import { useWorkspaceStore } from '../store'
import { StatusBadge } from './StatusBadge'

function ClaimList({ claims }: { claims: Claim[] }) {
  const [keyword, setKeyword] = useState('')
  const [filter, setFilter] = useState('all')
  const selectedClaimId = useWorkspaceStore((state) => state.selectedClaimId)
  const selectClaim = useWorkspaceStore((state) => state.selectClaim)
  const filteredClaims = claims.filter((claim) => {
    const matchesKeyword = claim.statement.toLowerCase().includes(keyword.toLowerCase())
    return matchesKeyword && (filter === 'all' || claim.status === filter)
  })

  return (
    <section className="panel claim-panel">
      <div className="panel-header">
        <div><h2>事实主张</h2><span>{filteredClaims.length} / {claims.length} 条</span></div>
        <Tooltip title="按状态筛选"><FilterOutlined /></Tooltip>
      </div>
      <div className="claim-tools">
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索事实主张"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <Select
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: '全部状态' },
            { value: 'verified', label: '仅看可信' },
            { value: 'review', label: '仅看待复核' },
            { value: 'conflict', label: '仅看高度存疑' },
          ]}
        />
      </div>
      <div className="claim-list">
        {filteredClaims.map((claim) => (
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
        {filteredClaims.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的事实主张" />}
      </div>
      <div className="panel-legend">
        <span><i className="verified" /> 可信 3</span>
        <span><i className="review" /> 待复核 1</span>
        <span><i className="conflict" /> 高度存疑 1</span>
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
    <section className="panel evidence-panel">
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
          <a href="#source"><LinkOutlined /> 打开来源</a>
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

function VerdictPanel({ claim }: { claim: Claim }) {
  const [auditOpen, setAuditOpen] = useState(false)
  const [retryOpen, setRetryOpen] = useState(false)

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
              scroll={{ x: 470 }}
              dataSource={comparisonRows}
              columns={[
                { title: '来源', dataIndex: 'source', width: 116, ellipsis: true },
                { title: '披露内容', dataIndex: 'value', width: 92 },
                { title: '口径/依据', dataIndex: 'basis', ellipsis: true },
                { title: '关系', dataIndex: 'stance', width: 92, render: (value) => <Tag color={value.startsWith('质疑') ? 'red' : 'green'}>{value}</Tag> },
              ]}
            />
          </div>
          <div className="conflict-actions">
            <button onClick={() => message.info('已记录：暂不采纳，等待研究员最终研判')}>暂不采纳</button>
            <button onClick={() => message.success('已标记为人工复核完成（Mock）')}>记录人工意见</button>
            <button className="primary" onClick={() => setRetryOpen(true)}><RetweetOutlined /> 发起重新取证</button>
          </div>
        </div>
      )}

      {!claim.conflictReason && (
        <div className="agreement-box">
          <CheckOutlined /><div><strong>两级核验结论一致</strong><span>当前结论可进入研究底稿</span></div>
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
  const selectedClaimId = useWorkspaceStore((state) => state.selectedClaimId)
  const selectedClaim = run.claims.find((claim) => claim.id === selectedClaimId) ?? run.claims[0]
  const evidenceList = useMemo(
    () => run.evidence.filter((evidence) => selectedClaim.evidenceIds.includes(evidence.id)),
    [run.evidence, selectedClaim.evidenceIds],
  )

  return (
    <div className="workbench-grid">
      <ClaimList claims={run.claims} />
      <EvidenceViewer key={selectedClaim.id} evidenceList={evidenceList} />
      <VerdictPanel claim={selectedClaim} />
    </div>
  )
}
