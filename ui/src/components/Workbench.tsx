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
import { useQueryClient } from '@tanstack/react-query'
import type { Claim, Evidence, ResearchRun } from '../types'
import { getActiveTask, useWorkspaceStore } from '../store'
import {
  guideTask,
  resolveClaim as resolvePersistedClaim,
  retryClaim as retryPersistedClaim,
  streamTaskEvents,
  type ResearchEvent,
} from '../services/api'
import { StatusBadge } from './StatusBadge'

type ClaimVisibility = 'issues' | 'all'
type EvidenceView = 'text' | 'source'

type GuidanceRecord = {
  id: number
  afterStep: number
  content: string
  attachments: string[]
  suspectedStages: string[]
}

type EventStreamStatus = 'idle' | 'connecting' | 'live' | 'ended' | 'error'

function backendActorIcon(actor: string) {
  if (actor === 'collector') return <CloudDownloadOutlined />
  if (actor === 'parser') return <ReadOutlined />
  if (actor === 'retriever') return <DatabaseOutlined />
  if (actor === 'scorer') return <SafetyCertificateOutlined />
  if (actor === 'reviewer') return <SwapOutlined />
  if (actor === 'assembler') return <BookOutlined />
  if (actor === 'researcher') return <SendOutlined />
  if (actor === 'history') return <ClockCircleOutlined />
  if (actor === 'system') return <CheckOutlined />
  return <FileSearchOutlined />
}

function eventTime(value: string) {
  const matched = value.match(/(\d{2}:\d{2}:\d{2})/)
  return matched?.[1] ?? value
}

function compactText(value: string, maxLength = 54) {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

function naturalList(items: string[]) {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join('、')}和${items.at(-1)}`
}

function eventMetric(event: ResearchEvent, label: string) {
  return event.payload.metrics?.find((metric) => metric.label.includes(label))?.value
}

function buildConversationalSpeech(event: ResearchEvent, eventHistory: ResearchEvent[]) {
  const speech = event.payload.speech?.trim() ?? ''
  const details = event.payload.details ?? []
  const title = event.payload.title ?? ''
  const detailSamples = details.slice(0, 3).map((detail) => compactText(detail.text))
  const previousEvents = eventHistory.filter((item) => item.seq <= event.seq)
  const claimEvent = previousEvents.filter((item) => item.actor === 'parser').at(-1)
  const evidenceEvent = previousEvents.filter((item) => item.actor === 'retriever').at(-1)
  const materialEvent = previousEvents.filter((item) => item.actor === 'collector' && item.kind !== 'warning').at(-1)
  const claimCount = claimEvent?.payload.details?.length
  const evidenceCount = evidenceEvent ? eventMetric(evidenceEvent, '证据') : undefined
  const materialCount = materialEvent ? eventMetric(materialEvent, '素材') : undefined

  if (event.kind === 'error') {
    return `这一步没有顺利完成，我先把后端返回的原因原样记下来：${speech || '暂时没有收到更具体的错误说明。'}任务记录和已经找到的材料仍然保留，方便随后定位和重试。`
  }

  if (event.actor === 'researcher') {
    return `我收到你刚才补充的要求了：“${speech || '请按研究员的补充要求继续核验。'}”这条要求已经加入当前任务，我会在接下来的核验节点优先检查它，并把受影响的结论重新留痕。`
  }

  if (event.actor === 'collector') {
    if (event.kind === 'warning') {
      return `我在按核查点寻找公开材料时遇到了一处问题：${speech || title}。我会把这次失败单独记下，不会拿缺失的材料硬凑结论；其他能够正常访问的来源仍会继续采集。`
    }
    const collectedCount = eventMetric(event, '素材') ?? String(details.length)
    const examples = details.slice(0, 3).map((detail) => compactText(detail.label, 34)).filter(Boolean)
    return `我按前面拆出的核查点逐项寻找公开材料，目前已经收进 ${collectedCount} 份原始内容${examples.length ? `，其中包括${naturalList(examples)}` : ''}。这一轮我只做采集和归档：保留原始链接与正文位置，不急着替材料下结论，下一步再从原文里拆出可以逐条验证的事实。`
  }

  if (event.actor === 'parser') {
    const examples = detailSamples.slice(0, 2)
    return `材料到手后，我先把其中能够被外部证据核对的事实句单独拆出来，共整理出 ${details.length} 条待核查主张${examples.length ? `，例如“${examples.join('”和“')}”` : ''}。这一步只是明确“接下来要证明什么”，还没有把任何一句话直接当成可信结论。`
  }

  if (event.actor === 'retriever') {
    const total = eventMetric(event, '证据') ?? '若干'
    return `我把当前${claimCount ? `的 ${claimCount} 条` : '每一条'}主张逐一拿去和已归档原文比对，优先寻找能够直接支持或挑战表述的段落。目前共绑定了 ${total} 条可回查证据。这里先建立“主张—原文”的对应关系，来源是否可靠、证据是否足够支撑原句，还要继续往下检查。`
  }

  if (event.actor === 'scorer') {
    const sourceGroups = new Map<string, number>()
    details.forEach((detail) => {
      const category = detail.text.replace(/\s+[\d.]+\s*$/, '').trim() || '其他来源'
      sourceGroups.set(category, (sourceGroups.get(category) ?? 0) + 1)
    })
    const summary = [...sourceGroups.entries()].map(([category, count]) => `${category} ${count} 项`)
    return `证据已经找齐后，我又逐个检查它们来自哪里，并按统一规则标记来源等级${summary.length ? `：${naturalList(summary)}` : ''}。这个分数只表示来源本身的可追溯性和权威程度，不等于“高分来源说的每句话都是真的”；接下来仍要结合原文内容判断它究竟能支持到什么程度。`
  }

  if (event.actor === 'supervisor' && title.includes('拆解')) {
    const checkpoints = detailSamples
    const keywords = eventMetric(event, '关键词')
    return `我先把研究问题拆开，不急着直接给结论。现在形成了 ${details.length} 个可以分别核查的点${checkpoints.length ? `，包括${naturalList(checkpoints)}` : ''}。${keywords ? `接下来会围绕“${compactText(keywords, 80)}”定向寻找公开材料，` : '接下来会按这些核查点寻找公开材料，'}每个判断都要能回到具体原文。`
  }

  if (event.actor === 'supervisor' && event.kind === 'warning') {
    const retry = eventMetric(event, '重试')
    return `我把第一轮主张和证据放在一起检查时，发现现有材料还不足以稳妥支持部分表述。为了不把证据不足写成确定结论，我先把相关问题退回重新取证${detailSamples.length ? `，补充方向是${naturalList(detailSamples)}` : ''}${retry ? `，这是第 ${retry} 轮` : ''}。旧证据不会被覆盖，后面会和新材料一起比较。`
  }

  if (event.actor === 'supervisor') {
    return `证据绑定和来源检查完成后，我开始做第一轮核验。我把${claimCount ? ` ${claimCount} 条主张` : '每条主张'}和${evidenceCount ? ` ${evidenceCount} 条原文证据` : '对应原文'}逐一并排，重点检查两件事：不同材料之间有没有冲突，以及现有引文是否真的足以支撑原句的范围和强度。这一步只完成初步判断，接下来还要交给独立复核重新检查，避免同一轮判断直接定案。`
  }

  if (event.actor === 'reviewer') {
    const conflict = eventMetric(event, '高度存疑')
    return `第一轮核验结束后，我把${claimCount ? ` ${claimCount} 条主张` : '全部待核主张'}和对应原文交给独立复核重新检查。这一轮会重新看引用是否忠于上下文、数字口径是否一致、表述有没有超过证据能够支持的边界。${conflict === '0' ? '本轮没有标出高度存疑项，但完整复核记录仍会保留。' : conflict ? `本轮标出了 ${conflict} 条高度存疑内容，它们不会自动写成正式结论。` : '发现的疑点会保留给你判断，不会自动写成正式结论。'}`
  }

  if (event.actor === 'assembler') {
    return `核验和独立复核都完成后，我开始整理底稿。这里不会再创造新的判断，只把已经形成的${claimCount ? ` ${claimCount} 条主张` : '事实主张'}、${evidenceCount ? ` ${evidenceCount} 条原文证据` : '对应原文证据'}及其复核记录按模板排好，并保留引用位置，方便你逐条回到来源检查。`
  }

  if (event.actor === 'history') {
    return `${speech}这一部分只记录公开数据和客观统计，不拿历史样本直接推断未来；${details.length ? `本次留下了 ${details.length} 组可回查记录，` : ''}需要使用时可以作为底稿附件单独核对。`
  }

  if (event.actor === 'system' && event.kind === 'done') {
    const scale = [materialCount ? `${materialCount} 份原始材料` : '', claimCount ? `${claimCount} 条事实主张` : '', evidenceCount ? `${evidenceCount} 条原文证据` : ''].filter(Boolean)
    return `这轮自动研究已经走完${scale.length ? `：${naturalList(scale)}` : ''}以及两轮核验记录都已保存。接下来只把系统无法代替你决定的疑点交给你复核，其他过程记录仍然可以随时回看。`
  }

  const detailSummary = detailSamples.length ? `这一步同时留下了这些可回查记录：${naturalList(detailSamples)}。` : ''
  return `${speech || title || '这一步已经完成。'}${detailSummary}我会保留当前结果和依据，再进入下一项检查。`
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
  selectedClaimId,
  onSelectClaim,
}: {
  claims: Claim[]
  pendingCount: number
  visibility: ClaimVisibility
  onVisibilityChange: (visibility: ClaimVisibility) => void
  selectedClaimId: string
  onSelectClaim: (claimId: string) => void
}) {
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
            onClick={() => onSelectClaim(claim.id)}
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
  const [view, setView] = useState<EvidenceView>('text')
  const selectedEvidence = evidenceList.find((item) => item.id === selectedEvidenceId) ?? evidenceList[0]

  useEffect(() => {
    if (!evidenceList.some((item) => item.id === selectedEvidenceId)) {
      setSelectedEvidenceId(evidenceList[0]?.id ?? '')
    }
  }, [evidenceList, selectedEvidenceId])

  if (!selectedEvidence) return <Empty description="该主张暂无证据" />

  return (
    <section className="evidence-panel">
      <div className="panel-header evidence-heading">
        <div><h2>原始证据</h2><span>{evidenceList.length} 条已引用</span></div>
        <Segmented
          size="small"
          value={view}
          onChange={(value) => setView(value as EvidenceView)}
          options={[{ label: '原文', value: 'text' }, { label: '来源信息', value: 'source' }]}
        />
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
      {view === 'text' ? <article className="document-viewer">
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
      </article> : <article className="source-info-view">
        <div className="document-toolbar">
          <div className="document-file">
            <DatabaseOutlined />
            <div><strong>来源档案</strong><span>用于确认材料出处与引用关系</span></div>
          </div>
          <button className="source-link-button" onClick={() => message.info('UI 原型：接入来源地址后将在此打开原始页面')}><LinkOutlined /> 打开来源</button>
        </div>
        <div className="source-info-content">
          <section className="source-identity-card">
            <div className="source-identity-icon"><FileSearchOutlined /></div>
            <div className="source-identity-copy">
              <span>当前材料</span>
              <h3>{selectedEvidence.title}</h3>
              <p>{selectedEvidence.publisher}</p>
            </div>
            <span className={`source-relation ${selectedEvidence.relation}`}>
              {selectedEvidence.relation === 'support' ? '支持主张' : '质疑主张'}
            </span>
          </section>

          <section className="source-detail-card">
            <div className="source-section-heading"><strong>来源详情</strong><span>随所选证据同步更新</span></div>
            <dl className="source-detail-grid">
              <div><dt>发布机构</dt><dd>{selectedEvidence.publisher}</dd></div>
              <div><dt>披露日期</dt><dd>{selectedEvidence.publishedAt}</dd></div>
              <div><dt>材料类型</dt><dd>{selectedEvidence.sourceType}</dd></div>
              <div><dt>证据定位</dt><dd>{selectedEvidence.locator}</dd></div>
            </dl>
          </section>

          <section className="source-quality-card">
            <div className="source-quality-copy">
              <SafetyCertificateOutlined />
              <div><strong>来源可信度</strong><span>根据来源层级、可访问性与引用完整性综合评估</span></div>
            </div>
            <div className="source-quality-score">
              <strong>{Math.round(selectedEvidence.credibility * 100)}<small>%</small></strong>
              <span>已完成归档校验</span>
            </div>
            <div className="source-quality-track"><i style={{ width: `${selectedEvidence.credibility * 100}%` }} /></div>
          </section>
        </div>
      </article>}
      <div className="evidence-verification">
        <SafetyCertificateOutlined />
        <div><strong>证据完整性已验证</strong><span>来源可访问 · 原文未篡改 · 引用定位准确</span></div>
        <span className="hash-code">SHA-256 · 9f2c…a817</span>
      </div>
    </section>
  )
}

function VerdictPanel({ claim, onResolve, onRetry, persisted }: {
  claim: Claim
  onResolve: (action: 'reject' | 'keep' | 'remove' | 'rewrite', decision: string) => void
  onRetry: () => Promise<void>
  persisted: boolean
}) {
  const [auditOpen, setAuditOpen] = useState(false)
  const [retryOpen, setRetryOpen] = useState(false)
  const decisions = claim.status === 'conflict'
    ? [
        { label: '不采纳', action: 'reject' as const, result: '不采纳该主张' },
        { label: '保留并注明', action: 'keep' as const, result: '保留并标注疑点' },
      ]
    : claim.status === 'review' ? [
        { label: '删除该表述', action: 'remove' as const, result: '删除无法证实的表述' },
        { label: '改为计划投产', action: 'rewrite' as const, result: '改写为计划投产' },
      ] : []

  const comparisonRows = [
    { key: '1', source: '2025 年年度报告', value: '原材料降本', basis: '营业成本分析', stance: '支持原料影响', type: '公司公告' },
    { key: '2', source: '上海有色网 SMM', value: '均价 -21.4%', basis: '电池级碳酸锂年度均价', stance: '支持原料影响', type: '行业数据' },
    { key: '3', source: '投资者关系记录', value: '多因素共同作用', basis: '技术、结构、海外、原料', stance: '质疑单一归因', type: '监管披露' },
  ]

  const auditRows = [
    { key: '1', time: '14:41:26', actor: '独立复核', action: '完成二级复核', input: '小盾的一级汇总 v0.2', output: '标记“归因冲突”，建议重新取证', evidence: 'EV-04 / EV-05 / EV-06' },
    { key: '2', time: '14:41:08', actor: '独立复核', action: '检查证据完整性', input: '3 条原文证据及定位', output: '证据可访问，归因强度不足', evidence: '3 / 3 已验证' },
    { key: '3', time: '14:40:08', actor: '小盾', action: '生成一级汇总结论', input: '4 组后台核验结果', output: '初步判断陈述基本成立', evidence: '3 条证据绑定' },
    { key: '4', time: '14:38:36', actor: '证据检索', action: '检索匹配原文', input: '毛利率改善归因核验点', output: '返回 3 个原文片段及坐标', evidence: '相似度 0.86–0.94' },
    { key: '5', time: '14:36:42', actor: '文档解析', action: '提取结构化指标', input: '年报第 41 页、调研记录问题 12', output: '提取成本与产品结构描述', evidence: '原文坐标已绑定' },
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
            <button key={decision.label} onClick={() => onResolve(decision.action, decision.result)}>{decision.label}</button>
          ))}
          <button className="primary" onClick={() => setRetryOpen(true)}><RetweetOutlined /> 重新取证</button>
        </div>
      )}

      <div className="verification-flow">
        <div className="verdict-card supervisor">
          <div className="verdict-card-header">
            <div className="verdict-avatar">盾</div>
            <div><strong>小盾的第一轮判断</strong><span><ClockCircleOutlined /> 14:40:08 完成</span></div>
            <span className="verdict-state"><CheckOutlined /> 已完成</span>
          </div>
          <p>{claim.supervisorVerdict}</p>
          <div className="verdict-basis"><BookOutlined /> 基于 {claim.evidenceIds.length} 条证据形成结论</div>
        </div>

        <div className="flow-connector"><span /><SwapOutlined /><span /></div>

        <div className="verdict-card reviewer">
          <div className="verdict-card-header">
            <div className="verdict-avatar">复</div>
            <div><strong>独立复核</strong><span><ClockCircleOutlined /> 14:41:26 完成</span></div>
            <span className={claim.status === 'verified' ? 'verdict-state' : 'verdict-state warning'}>
              {claim.status === 'verified' ? <><CheckOutlined /> 一致</> : '发现分歧'}
            </span>
          </div>
          <p>{claim.reviewerVerdict}</p>
          <div className="independence-note"><SafetyCertificateOutlined /> 未读取其他核验过程</div>
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
        <div><i className="blue" /><span>14:41:26</span><p>独立复核已完成</p></div>
        <div><i className="orange" /><span>14:41:08</span><p>识别到因果归因证据不足</p></div>
        <div><i className="green" /><span>14:40:08</span><p>小盾给出第一轮判断</p></div>
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
        <div className="audit-seal"><SafetyCertificateOutlined /><div><strong>审计链完整</strong><span>各环节时间、来源与原文定位均已记录；后台核验任务彼此隔离。</span></div></div>
      </Drawer>

      <Modal title="发起第二轮取证" open={retryOpen} onCancel={() => setRetryOpen(false)} onOk={async () => { await onRetry(); setRetryOpen(false) }} okText="确认发起" cancelText="取消" width={660}>
        <div className="mock-notice"><RetweetOutlined /><span>{persisted ? '确认后会调用 FastAPI，为当前主张启动真实重新取证。' : '本操作只演示 UI 流程，不会访问外部数据。'}</span></div>
        <div className="retry-summary"><strong>触发原因</strong><p>{claim.conflictReason}</p></div>
        <Steps
          direction="vertical"
          size="small"
          current={0}
          items={[
            { title: '小盾收到复核疑点', description: '问题类型：归因冲突；缺少各因素贡献的定量拆分。' },
            { title: '重新派发原子任务', description: '仅向公开信源采集、文档解析、证据检索单元追加限定任务。' },
            { title: '新旧证据并排比较', description: '保留第一轮证据，不覆盖历史记录。' },
            { title: '再次进入独立审查', description: '形成第二轮可信度标签，最终由研究员研判。' },
          ]}
        />
      </Modal>
    </section>
  )
}

export function Workbench({ run, preview = false }: { run: ResearchRun; preview?: boolean }) {
  const queryClient = useQueryClient()
  const [claimVisibility, setClaimVisibility] = useState<ClaimVisibility>('issues')
  const [previewSelectedClaimId, setPreviewSelectedClaimId] = useState('claim-3')
  const [previewReviewedClaimIds, setPreviewReviewedClaimIds] = useState<string[]>([])
  const [guidance, setGuidance] = useState('')
  const [guidanceHistory, setGuidanceHistory] = useState<GuidanceRecord[]>([])
  const [guidanceAttachments, setGuidanceAttachments] = useState<File[]>([])
  const [suspectedEventSteps, setSuspectedEventSteps] = useState<number[]>([])
  const [backendEvents, setBackendEvents] = useState<ResearchEvent[]>([])
  const [eventStreamStatus, setEventStreamStatus] = useState<EventStreamStatus>('idle')
  const [realGuidanceOpen, setRealGuidanceOpen] = useState(false)
  const [realGuidanceSubmitting, setRealGuidanceSubmitting] = useState(false)
  const [selectedBackendEventSeqs, setSelectedBackendEventSeqs] = useState<number[]>([])
  const processListRef = useRef<HTMLDivElement>(null)
  const guidanceAttachmentInputRef = useRef<HTMLInputElement>(null)
  const activeTask = useWorkspaceStore(getActiveTask)
  // 持久化任务在详情页以 ResearchRun 完整快照为准，避免任务列表摘要先一步
  // 切到 review，和上一轮仍在 running 的空主张明细拼成短暂空页。
  const persistedRunPhase = (run.status === 'review' || run.status === 'ready')
    && (run.progress < 100 || run.claims.length === 0)
    ? 'running'
    : run.status
  const taskPhase = preview
    ? 'review'
    : activeTask.persisted && persistedRunPhase
      ? persistedRunPhase
      : activeTask.phase
  const researchTopic = preview ? run.title : activeTask.researchTopic
  const demoStep = preview ? 8 : activeTask.demoStep
  const isDemoRunning = preview ? false : activeTask.isDemoRunning
  const reviewedClaimIds = preview ? previewReviewedClaimIds : activeTask.reviewedClaimIds
  const selectedClaimId = preview ? previewSelectedClaimId : activeTask.selectedClaimId
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
    () => selectedClaim ? run.evidence.filter((evidence) => selectedClaim.evidenceIds.includes(evidence.id)) : [],
    [run.evidence, selectedClaim],
  )

  useEffect(() => {
    if (!activeTask.persisted || preview || taskPhase !== 'running') {
      setBackendEvents([])
      setEventStreamStatus('idle')
      return
    }

    const controller = new AbortController()
    let disposed = false
    setBackendEvents([])
    setEventStreamStatus('connecting')

    streamTaskEvents(run.id, (event) => {
      if (disposed) return
      setEventStreamStatus('live')
      setBackendEvents((current) => {
        if (current.some((item) => item.seq === event.seq)) return current
        return [...current, event].sort((left, right) => left.seq - right.seq)
      })
    }, controller.signal)
      .then(() => {
        if (!disposed) setEventStreamStatus('ended')
      })
      .catch((error) => {
        if (!disposed && error instanceof Error && error.name !== 'AbortError') {
          setEventStreamStatus('error')
        }
      })

    return () => {
      disposed = true
      controller.abort()
    }
  }, [activeTask.persisted, preview, run.id, taskPhase])

  const handleResolve = async (action: 'reject' | 'keep' | 'remove' | 'rewrite', decision: string) => {
    if (!selectedClaim) return
    const nextClaim = pendingClaims.find((claim) => claim.id !== selectedClaim.id)
    if (activeTask.persisted && !preview) {
      try {
        await resolvePersistedClaim(run.id, selectedClaim.id, action, decision)
        await queryClient.invalidateQueries({ queryKey: ['research-run', run.id] })
      } catch (error) {
        message.error(error instanceof Error ? error.message : '裁决提交失败')
        return
      }
    } else if (preview) {
      setPreviewReviewedClaimIds((current) => current.includes(selectedClaim.id) ? current : [...current, selectedClaim.id])
      if (nextClaim) setPreviewSelectedClaimId(nextClaim.id)
    } else {
      resolveClaim(selectedClaim.id, nextClaim?.id)
    }
    message.success(nextClaim ? `${decision}，已自动进入下一条` : `${decision}，所有疑点已处理`)
  }

  const handleRetry = async () => {
    if (!selectedClaim) return
    if (!activeTask.persisted || preview) {
      message.success('已加入演示取证队列')
      return
    }
    try {
      await retryPersistedClaim(run.id, selectedClaim.id)
      message.success('已启动真实重新取证')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '重新取证失败')
      throw error
    }
  }

  const toggleBackendEvent = (seq: number) => {
    setSelectedBackendEventSeqs((current) => current.includes(seq)
      ? current.filter((item) => item !== seq)
      : [...current, seq])
  }

  const submitRealGuidance = async () => {
    const content = guidance.trim()
    const selectedEvents = backendEvents.filter((event) => selectedBackendEventSeqs.includes(event.seq))
    if (!content && selectedEvents.length === 0) {
      message.warning('请写下要调整的内容，或先选择一个有问题的研究步骤')
      return
    }
    const stageContext = selectedEvents.length > 0
      ? `请重点重新检查这些步骤：${selectedEvents.map((event) => `「${event.payload.title || '研究进度更新'}」`).join('、')}。`
      : ''
    const instruction = [stageContext, content].filter(Boolean).join('\n')
    setRealGuidanceSubmitting(true)
    try {
      await guideTask(run.id, instruction)
      setGuidance('')
      setSelectedBackendEventSeqs([])
      setRealGuidanceOpen(false)
      message.success('小盾记下了，会在当前研究的下一个核验点按你的要求调整')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '介入指令提交失败')
    } finally {
      setRealGuidanceSubmitting(false)
    }
  }

  const changeClaimVisibility = (visibility: ClaimVisibility) => {
    setClaimVisibility(visibility)
    if (visibility === 'issues' && selectedClaim?.status === 'verified' && pendingClaims[0]) {
      if (preview) setPreviewSelectedClaimId(pendingClaims[0].id)
      else selectClaim(pendingClaims[0].id)
    }
  }

  useEffect(() => {
    if (taskPhase !== 'running') return
    const frame = window.requestAnimationFrame(() => {
      processListRef.current?.querySelector('[data-current="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [backendEvents.length, demoStep, guidanceHistory.length, taskPhase])

  if (taskPhase === 'running' && activeTask.persisted) {
    const completedAgents = run.agents.filter((agent) => agent.status === 'done').length
    const currentAgent = run.agents.find((agent) => agent.status === 'running')
    const latestEventSeq = backendEvents.at(-1)?.seq
    const latestRetryEvent = backendEvents.slice().reverse().find((event) => (
      event.actor === 'supervisor'
      && event.kind === 'warning'
      && (event.payload.title?.includes('二次取证') || event.payload.title?.includes('疑点'))
    ))
    const retryFinished = latestRetryEvent ? backendEvents.some((event) => (
      event.seq > latestRetryEvent.seq
      && ((event.actor === 'supervisor' && event.kind === 'progress' && event.payload.title?.includes('一级核验'))
        || ['reviewer', 'assembler', 'system'].includes(event.actor))
    )) : false
    const activeRetryEvent = latestRetryEvent && !retryFinished ? latestRetryEvent : undefined
    const retryRound = activeRetryEvent?.payload.metrics?.find((metric) => metric.label.includes('重试'))?.value
    const latestStageTitle = backendEvents.at(-1)?.payload.title
    const progressStatus = activeRetryEvent
      ? `${retryRound ? `第 ${retryRound} 轮` : ''}补充取证 · ${latestStageTitle || '正在补充材料'}`
      : currentAgent
        ? '小盾正在继续查证'
        : '小盾正在整理刚才的结果'
    const streamLabel = eventStreamStatus === 'connecting'
      ? '正在连接'
      : eventStreamStatus === 'error'
        ? '连接中断'
        : eventStreamStatus === 'ended'
          ? '本轮已记录'
          : '实时记录'
    return (
      <div className="research-running-page">
        <div className="running-two-column-layout">
          <section className="running-progress-card">
            <div className="running-card-heading">
              <div>
                <span className="start-kicker"><i /> 小盾正在帮你查</span>
                <h2>{researchTopic || run.title}</h2>
                <p>我会一边核查，一边把做到哪一步、依据是什么都记下来；切换任务也不会打断我。</p>
              </div>
            </div>
            <Progress percent={Math.round(run.progress)} showInfo={false} strokeColor="#0d6575" trailColor="#dfeae6" />
            <div className="running-progress-meta"><strong>{Math.round(run.progress)}%</strong><span>{progressStatus}</span></div>
            <div className="running-progress-summary">
              <div><span>执行单元</span><strong>{completedAgents} / {run.agents.length}</strong><small>已完成</small></div>
              <div><span>已生成主张</span><strong>{run.claims.length}</strong><small>条事实主张</small></div>
              <div><span>已绑定证据</span><strong>{run.evidence.length}</strong><small>条原文证据</small></div>
            </div>
            <div className="running-footer-actions"><Button onClick={() => setActiveView('topology')}>查看执行监控</Button><Button onClick={() => setActiveView('tasks')}>返回任务列表</Button></div>
          </section>
          <section className="research-process-panel running-process-card">
            <div className="process-panel-heading">
              <div><strong>小盾的研究动态</strong><span>我会边查边说，把每一步怎么做、查到了什么都讲清楚</span></div>
              <div className="process-panel-actions">
                <span className={eventStreamStatus === 'error' || eventStreamStatus === 'ended' ? 'process-recording paused' : 'process-recording'}><i /> {streamLabel}</span>
                <Button danger icon={<PauseCircleOutlined />} onClick={() => setRealGuidanceOpen(true)}>打断一下</Button>
              </div>
            </div>
            <div className="research-process-list" ref={processListRef}>
              {backendEvents.length === 0 ? (
                <div className={`process-stream-empty ${eventStreamStatus === 'error' ? 'error' : ''}`}>
                  <span><FileSearchOutlined /></span>
                  <strong>{eventStreamStatus === 'error' ? '暂时没有接到研究动态' : '小盾正在理解这项研究'}</strong>
                  <p>{eventStreamStatus === 'error' ? '任务仍由后端继续执行，刷新页面后会回放已经写入的全部记录。' : '正在等待后端写入第一条执行播报，收到后会在这里逐字显示。'}</p>
                </div>
              ) : backendEvents.map((event) => {
                const isCurrent = event.seq === latestEventSeq && !['done', 'stopped', 'error'].includes(event.kind)
                const details = event.payload.details ?? []
                const metrics = event.payload.metrics ?? []
                const conversationalSpeech = buildConversationalSpeech(event, backendEvents)
                const tone = event.payload.tone === 'danger' || event.kind === 'error'
                  ? 'danger'
                  : event.payload.tone === 'warning' || event.kind === 'warning'
                    ? 'warning'
                    : ''
                const status = event.kind === 'error'
                  ? '执行失败'
                  : event.kind === 'warning'
                    ? '需要留意'
                    : event.kind === 'done'
                      ? '已完成'
                      : isCurrent
                        ? '最新播报'
                        : '已记录'
                return (
                  <div
                    className={`research-process-item backend-event${isCurrent ? ' current' : ''}${tone ? ` ${tone}` : ''}`}
                    data-current={isCurrent ? 'true' : undefined}
                    key={event.seq}
                  >
                    <span className="process-item-icon">{backendActorIcon(event.actor)}</span>
                    <div className="process-item-content">
                      <div className="process-item-title">
                        <strong>{event.payload.title || '研究进度更新'}</strong>
                        <span>小盾 · {eventTime(event.ts)}</span>
                      </div>
                      {conversationalSpeech && (
                        <TypewriterBroadcast
                          text={conversationalSpeech}
                          active={isCurrent && eventStreamStatus === 'live'}
                          complete={!isCurrent || eventStreamStatus !== 'live'}
                        />
                      )}
                      {details.length > 0 && (
                        <>
                          <div className="process-evidence-label">本步执行依据</div>
                          <ul>{details.map((detail, index) => <li key={`${detail.label}-${index}`}><b>{detail.label}</b><span>{detail.text}</span></li>)}</ul>
                        </>
                      )}
                      {metrics.length > 0 && (
                        <div className="process-item-metrics">
                          {metrics.map((metric, index) => <span key={`${metric.label}-${index}`}>{metric.label} {metric.value}</span>)}
                        </div>
                      )}
                    </div>
                    <div className="process-item-controls"><small>{status}</small></div>
                  </div>
                )
              })}
            </div>
          </section>
        </div>
        <Modal
          className="real-guidance-modal"
          title="打断一下，告诉小盾哪里要调整"
          open={realGuidanceOpen}
          onCancel={() => setRealGuidanceOpen(false)}
          onOk={submitRealGuidance}
          okText="提交并继续"
          cancelText="先不打断"
          confirmLoading={realGuidanceSubmitting}
          width={680}
        >
          <div className="real-guidance-intro">
            <span><PauseCircleOutlined /></span>
            <div><strong>当前进度和已经找到的证据都会保留</strong><p>你的要求会真实提交给研究任务，小盾会在下一个核验点读取并据此调整。</p></div>
          </div>
          {backendEvents.length > 0 && (
            <div className="real-guidance-section">
              <div className="real-guidance-section-title"><strong>哪一步需要重新看？</strong><span>可多选，也可以只写要求</span></div>
              <div className="real-guidance-stage-list">
                {backendEvents.filter((event) => event.actor !== 'system').map((event) => {
                  const selected = selectedBackendEventSeqs.includes(event.seq)
                  return (
                    <button
                      type="button"
                      className={selected ? 'selected' : ''}
                      key={event.seq}
                      onClick={() => toggleBackendEvent(event.seq)}
                    >
                      <span>{backendActorIcon(event.actor)}</span>
                      <div><strong>{event.payload.title || '研究进度更新'}</strong><small>{eventTime(event.ts)}</small></div>
                      <i>{selected ? <CheckOutlined /> : null}</i>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          <div className="real-guidance-section">
            <div className="real-guidance-section-title"><strong>告诉小盾怎么调整</strong><span>Enter 提交 · Shift + Enter 换行</span></div>
            <Input.TextArea
              value={guidance}
              onChange={(event) => setGuidance(event.target.value)}
              onPressEnter={(event) => {
                if (!event.shiftKey) {
                  event.preventDefault()
                  void submitRealGuidance()
                }
              }}
              autoSize={{ minRows: 4, maxRows: 7 }}
              placeholder="例如：先不要采用媒体转述，优先回到公司公告核对；收入和利润请统一按同一报告期比较……"
            />
          </div>
        </Modal>
      </div>
    )
  }

  if (taskPhase === 'running') {
    const progress = Math.round((demoStep / 8) * 100)
    const runningSteps = [
      { title: '采集并解析资料', description: '归档公开披露和补充材料，提取原文坐标' },
      { title: '多源交叉核验', description: '小盾汇总结果，再交给独立复核检查' },
      { title: '筛出需要人工判断的疑点', description: '可信结论自动进入底稿，黄红疑点等待你处理' },
    ]
    const processEvents = [
      {
        step: 0,
        time: '14:32:01',
        actor: '小盾',
        icon: <FileSearchOutlined />,
        title: '先弄清楚这次要查什么',
        speech: `我来核验“${researchTopic || run.title}”。先把研究对象、时间范围和证据标准理清楚，再逐条找原文、核对口径；证据不够的地方我会单独留给你判断。`,
        details: [
          { label: '对象识别', text: `${run.company}；研究范围以当前任务描述和已提交材料为准。` },
          { label: '核验范围', text: `围绕 ${run.claims.length} 条事实主张分别查证，不合并不同口径的结论。` },
          { label: '证据约束', text: '监管披露和公司原文优先；结论必须绑定文件名、页码或问答序号，不接受无出处转述。' },
          { label: '输出约束', text: '区分事实、管理层判断与研究推断；证据不足时保留疑点，不补写确定性结论。' },
        ],
        metrics: ['1 个研究对象', '4 个核验维度', '一手信源优先'],
      },
      {
        step: 1,
        time: '14:32:04',
        actor: '小盾',
        icon: <FileSearchOutlined />,
        title: '把问题拆开来查',
        speech: `这项研究里有 ${run.claims.length} 条需要分别回答的判断，不能拿同一组证据一次作答。我先逐条拆开，再让后台助手各查一块；当前任务的材料和进度会单独保存。`,
        details: [
          ...run.claims.map((claim) => ({ label: `任务 C${String(claim.index).padStart(2, '0')}`, text: claim.statement })),
        ],
        metrics: ['5 条事实主张', '4 组隔离核验任务'],
      },
      {
        step: 2,
        time: '14:32:16',
        actor: '公开信源检索',
        icon: <DatabaseOutlined />,
        title: '开始检索公开信源',
        speech: `我现在开始为 ${run.claims.length} 条主张分别寻找原始来源。先查监管披露和当事方原文，再用独立行业数据交叉确认；搜索摘要不会直接当作证据。`,
        details: [
          { label: '检索请求 01', text: `“${run.company} 年度报告 经营数据”——优先保留监管披露和原始报告。` },
          { label: '检索请求 02', text: `“${run.claims[2]?.statement ?? run.title}”——查找可定位到上下文的原文。` },
          { label: '检索请求 03', text: `“${run.claims[3]?.statement ?? run.title}”——补充独立来源进行交叉确认。` },
          { label: '结果筛选', text: '共命中 24 份；排除重复转载 5 份、无法定位原文 2 份、统计期间不一致 1 份。' },
          { label: '候选来源', text: `${Array.from(new Set(run.evidence.slice(0, 5).map((evidence) => evidence.publisher))).join('、')}，共保留 ${run.evidence.length} 份材料。` },
        ],
        metrics: ['命中 24 份', '保留 16 份', '排除 8 份'],
      },
      {
        step: 3,
        time: '14:33:02',
        actor: '文档解析',
        icon: <ReadOutlined />,
        title: '逐份打开材料并读取原文',
        speech: '检索结果已经筛完，我正在逐份打开保留下来的材料。年报中的数字要同时核对单位和上期口径；管理层回答要连同上下文阅读，不能只摘一句。我会把每个可用结论绑定到文件名、页码或问答序号。',
        details: [
          ...run.evidence.slice(0, 4).map((evidence, index) => ({ label: `已浏览 ${String(index + 1).padStart(2, '0')}`, text: `《${evidence.title}》${evidence.locator}——已提取对应原文并保留定位。` })),
          { label: '字段检查', text: '统一金额单位为亿元、比例保留两位小数；8 处摘录均已绑定原始页码或问题序号。' },
        ],
        metrics: ['浏览 8 份原文', '提取 18 个字段', '绑定 8 处坐标'],
      },
      {
        step: 4,
        time: '14:34:18',
        actor: '证据交叉核验',
        icon: <SwapOutlined />,
        title: '比对不同来源的口径与结论',
        tone: 'warning',
        speech: '我开始把当事方披露、监管文件和独立来源并排核对。三条主张能够互相印证，另外两条存在归因口径或确定时间点的问题，还没有找到足以直接支持原表述的来源。',
        details: [
          ...run.claims.map((claim) => ({
            label: `C${String(claim.index).padStart(2, '0')} · ${claim.status === 'verified' ? '来源一致' : claim.status === 'conflict' ? '口径冲突' : '证据缺口'}`,
            text: claim.statement,
          })),
        ],
        metrics: ['3 组口径一致', '1 项归因冲突', '1 项证据缺口'],
      },
      {
        step: 5,
        time: '14:35:06',
        actor: '小盾',
        icon: <SafetyCertificateOutlined />,
        title: '第一轮结果回来了',
        tone: 'warning',
        speech: '第一轮结果都回来了。三条主张的证据能互相印证，我先把它们列为可信候选；另外两条缺少足够直接的支持，我不会把它们直接写进底稿。',
        details: [
          { label: '合并结果', text: 'C01、C02、C05 获得一手来源或一手来源与独立来源共同支持，进入可信结论候选。' },
          { label: '保留分歧', text: `C03“${run.claims[2]?.statement}”缺少足够的归因拆分，不改写为确定结论。` },
          { label: '限制结论', text: `C04“${run.claims[3]?.statement}”超出原文可支持范围，进入人工队列。` },
          { label: '证据绑定', text: '5 条一级结论共绑定 8 份原始材料，引用均可回到页码、表格或问答序号。' },
        ],
        metrics: ['5 条一级结论', '8 份证据绑定', '2 项疑点'],
      },
      {
        step: 6,
        time: '14:35:29',
        actor: '独立复核',
        icon: <SafetyCertificateOutlined />,
        title: '再做一次独立复核',
        tone: 'danger',
        speech: '这一轮会独立重查，只看待核主张和原始证据，不读取前面的核验过程。复算结果一致，但 C03 的归因强度和 C04 的确定时间点都超出了现有材料能支持的边界，需要退回。',
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
        actor: '小盾',
        icon: <CheckOutlined />,
        title: '结果分好级了',
        tone: 'danger',
        speech: '独立复核完成了。C01、C02、C05 可以定为可信并自动归档；C03 的因果关系表述过强，C04 缺少确定时间点的直接证据，这两项需要你判断、改写或继续取证。',
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
      message.success('小盾记下了，会从当前进度继续查')
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
              <span className={isDemoRunning ? 'start-kicker' : 'start-kicker paused'}><i /> {isDemoRunning ? '小盾正在帮你查' : '小盾先停在这里了'}</span>
              <h2>{researchTopic || run.title}</h2>
              <p>{isDemoRunning ? '我正在收集、核验和整理证据，有需要你判断的地方会及时告诉你。' : '任务和已经找到的证据都还在，把你的想法告诉我就能继续。'}</p>
            </div>
          </div>
          <Progress percent={progress} showInfo={false} strokeColor="#0d6575" trailColor="#dfeae6" />
          <div className="running-progress-meta"><strong>{progress}%</strong><span>{isDemoRunning ? '小盾会把查证过程记在这里（UI 演示）' : '停在当前进度，等你补充想法'}</span></div>
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
              <div><strong>小盾的研究动态</strong><span>我会边查边记，发现疑点或需要你判断时就告诉你</span></div>
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
                            <div className="process-item-metrics"><span>小盾记下了</span><span>从当前节点继续</span></div>
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
                <div><strong>{suspectedEvents.length > 0 ? `处理 ${suspectedEvents.length} 个怀疑环节` : '调整研究方向'}</strong><span>{suspectedEvents.length > 0 ? '补充说明或材料后，小盾会把这些环节重新检查一遍。' : '可以直接继续，也可以补充要求、附件或标记有问题的环节。'}</span></div>
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
                  placeholder={suspectedEvents.length > 0 ? '告诉小盾这个环节哪里不对，或直接提交让我重新检查…' : '例如：优先核对监管披露，并补充 2024—2025 年同口径数据…'}
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
            <Button size="large" onClick={() => setActiveView('tasks')}>返回任务列表</Button>
          </div>
        </section>
      </div>
    )
  }

  if (!selectedClaim) {
    return (
      <section className="research-workbench page-card">
        <Empty description={taskPhase === 'failed' ? '研究执行失败，尚未生成可复核主张' : '研究尚未生成可复核主张'} />
      </section>
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
            selectedClaimId={selectedClaimId}
            onSelectClaim={preview ? setPreviewSelectedClaimId : selectClaim}
          />
          <EvidenceViewer key={selectedClaim.id} evidenceList={evidenceList} />
        </section>
        <VerdictPanel claim={selectedClaim} onResolve={handleResolve} onRetry={handleRetry} persisted={Boolean(activeTask.persisted && !preview)} />
      </div>
    </div>
  )
}
