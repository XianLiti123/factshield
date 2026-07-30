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
import { Button, Drawer, Empty, Input, Modal, Progress, Segmented, Steps, message } from 'antd'
import { useQueryClient } from '@tanstack/react-query'
import type { Claim, Evidence, ResearchRun } from '../types'
import { getActiveTask, getResearchRunPhase, useWorkspaceStore } from '../store'
import {
  assertResearchReady,
  createTask as createPersistedTask,
  guideTask,
  resolveClaim as resolvePersistedClaim,
  retryClaim as retryPersistedClaim,
  streamTaskEvents,
  type ResearchEvent,
} from '../services/api'
import { StatusBadge } from './StatusBadge'
import { getClaimDisplayStatement, getRewrittenClaimStatement, isClaimRemoved } from '../utils/claims'

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

type ClaimRetryProgress = {
  claimId: string
  status: 'starting' | 'running' | 'success' | 'error'
  title: string
  detail: string
  afterSeq: number
  evidenceCountBefore: number
}

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
            className={[
              'claim-item',
              selectedClaimId === claim.id ? 'selected' : '',
              claim.status,
              claim.humanAction === 'rewrite' ? 'adjusted' : '',
              isClaimRemoved(claim) ? 'removed' : '',
            ].filter(Boolean).join(' ')}
            onClick={() => onSelectClaim(claim.id)}
          >
            <div className="claim-item-top">
              <span className="claim-index">C{String(claim.index).padStart(2, '0')}</span>
              {claim.humanAction === 'rewrite'
                ? <span className="claim-resolution-tag adjusted">已调整</span>
                : isClaimRemoved(claim)
                  ? <span className="claim-resolution-tag removed">已排除</span>
                  : <StatusBadge status={claim.status} compact />}
              <span className="claim-score">{Math.round(claim.confidence * 100)}%</span>
            </div>
            <p>{getClaimDisplayStatement(claim)}</p>
            <div className="claim-item-footer">
              <span>{isClaimRemoved(claim) ? '不进入最终结论' : claim.issueType ?? claim.category}</span><span>{claim.evidenceIds.length} 条证据</span>
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

function getEvidenceSourceUrl(evidence: Evidence) {
  const rawUrl = evidence.url?.trim()
  if (!rawUrl) return null
  try {
    const normalizedUrl = /^https?:\/\//i.test(rawUrl)
      ? rawUrl
      : rawUrl.startsWith('//')
        ? `https:${rawUrl}`
        : `https://${rawUrl}`
    const parsedUrl = new URL(normalizedUrl)
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:' ? parsedUrl.href : null
  } catch {
    return null
  }
}

function openEvidenceSource(sourceUrl: string) {
  const sourceWindow = window.open(sourceUrl, '_blank')
  if (sourceWindow) sourceWindow.opener = null
  if (!sourceWindow) message.warning('浏览器阻止了新窗口，请允许本站打开新标签页后重试')
}

function EvidenceViewer({ evidenceList, preferredEvidenceId }: { evidenceList: Evidence[]; preferredEvidenceId?: string }) {
  const [selectedEvidenceId, setSelectedEvidenceId] = useState(evidenceList[0]?.id ?? '')
  const [view, setView] = useState<EvidenceView>('text')
  const selectedEvidence = evidenceList.find((item) => item.id === selectedEvidenceId) ?? evidenceList[0]
  const selectedSourceUrl = selectedEvidence ? getEvidenceSourceUrl(selectedEvidence) : null

  useEffect(() => {
    if (preferredEvidenceId && evidenceList.some((item) => item.id === preferredEvidenceId)) {
      setSelectedEvidenceId(preferredEvidenceId)
      return
    }
    if (!evidenceList.some((item) => item.id === selectedEvidenceId)) {
      setSelectedEvidenceId(evidenceList[0]?.id ?? '')
    }
  }, [evidenceList, preferredEvidenceId, selectedEvidenceId])

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
          <button
            className="source-link-button"
            disabled={!selectedSourceUrl}
            title={selectedSourceUrl ? `打开 ${selectedSourceUrl}` : selectedEvidence.url ? '后端返回的来源地址无效' : '后端未返回来源地址'}
            onClick={() => selectedSourceUrl && openEvidenceSource(selectedSourceUrl)}
          ><LinkOutlined /> {selectedSourceUrl ? '打开来源' : '暂无来源地址'}</button>
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
          <button
            className="source-link-button"
            disabled={!selectedSourceUrl}
            title={selectedSourceUrl ? `打开 ${selectedSourceUrl}` : selectedEvidence.url ? '后端返回的来源地址无效' : '后端未返回来源地址'}
            onClick={() => selectedSourceUrl && openEvidenceSource(selectedSourceUrl)}
          ><LinkOutlined /> {selectedSourceUrl ? '打开来源' : '暂无来源地址'}</button>
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
              <div><dt>原始地址</dt><dd className="source-url-value" title={selectedEvidence.url || undefined}>{selectedEvidence.url || '后端未返回'}</dd></div>
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

function VerdictPanel({ claim, evidenceList, onResolve, onRetry, persisted, retryProgress, onDismissRetry }: {
  claim: Claim
  evidenceList: Evidence[]
  onResolve: (action: 'reject' | 'keep' | 'remove' | 'rewrite', decision: string) => Promise<boolean>
  onRetry: () => Promise<void>
  persisted: boolean
  retryProgress: ClaimRetryProgress | null
  onDismissRetry: () => void
}) {
  const [auditOpen, setAuditOpen] = useState(false)
  const [retryOpen, setRetryOpen] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [rewriteOpen, setRewriteOpen] = useState(false)
  const [rewriteValue, setRewriteValue] = useState('')
  const [resolutionSubmitting, setResolutionSubmitting] = useState(false)
  const currentRetry = retryProgress?.claimId === claim.id ? retryProgress : null
  const retryBusy = retryProgress?.status === 'starting' || retryProgress?.status === 'running'
  const rewrittenStatement = getRewrittenClaimStatement(claim)
  const displayStatement = getClaimDisplayStatement(claim)
  const removed = isClaimRemoved(claim)
  const rewriteError = !rewriteValue.trim()
    ? '请填写调整后的完整表述'
    : rewriteValue.trim().length < 5
      ? '调整后的表述至少需要 5 个字'
      : rewriteValue.trim() === claim.statement.trim()
        ? '新表述与原表述相同，请先完成调整'
        : ''

  useEffect(() => {
    setRemoveOpen(false)
    setRewriteOpen(false)
    setRewriteValue('')
    setResolutionSubmitting(false)
  }, [claim.id])

  const submitResolution = async (action: 'remove' | 'rewrite', content: string) => {
    setResolutionSubmitting(true)
    try {
      const resolved = await onResolve(action, content)
      if (!resolved) return
      setRemoveOpen(false)
      setRewriteOpen(false)
      setRewriteValue('')
    } finally {
      setResolutionSubmitting(false)
    }
  }

  const openRewriteEditor = () => {
    setRewriteValue(rewrittenStatement ?? '')
    setRewriteOpen(true)
  }
  const decisions = claim.status === 'conflict'
    ? [
        { label: '不采纳', action: 'reject' as const, result: '不采纳该主张' },
        { label: '保留并注明', action: 'keep' as const, result: '保留并标注疑点' },
      ]
    : []

  const evidenceSummaries = evidenceList.reduce<Array<{
    key: string
    source: string
    quote: string
    basis: string
    relation: Evidence['relation']
    duplicateCount: number
  }>>((summaries, evidence) => {
    const source = evidence.publisher || evidence.title || '来源未标注'
    const quote = evidence.quote?.trim() || '未返回可展示的原文片段'
    const basis = [evidence.sourceType, evidence.locator].filter(Boolean).join(' · ') || '未返回原文定位'
    const duplicate = summaries.find((item) => (
      item.source === source
      && item.quote === quote
      && item.relation === evidence.relation
    ))
    if (duplicate) {
      duplicate.duplicateCount += 1
      return summaries
    }
    summaries.push({
      key: evidence.id,
      source,
      quote,
      basis,
      relation: evidence.relation,
      duplicateCount: 1,
    })
    return summaries
  }, [])
  const reviewHeading = evidenceList.length === 0
    ? '为什么这条还不能确认'
    : claim.status === 'conflict'
      ? '为什么这条需要你判断'
      : '现有证据还差什么'
  const reviewExplanation = claim.conflictReason
    || (evidenceList.length === 0
      ? '本轮没有找到能够直接支持或质疑这句话的原文，因此系统没有自动确认。'
      : '当前证据还不足以完整支持原句，需要你结合原文决定是否保留或调整。')
  const decisionSummary = evidenceList.length === 0 || claim.issueType?.includes('缺失')
    ? '当前没有原文证据可以核对'
    : claim.status === 'conflict'
      ? '现有证据之间存在矛盾'
      : '现有证据还不足以确认原句'

  return (
    <section className="panel verdict-panel">
      <div className="panel-header">
        <div><h2>双层核验</h2><span>独立结论对照</span></div>
        <StatusBadge status={claim.status} />
      </div>
      <div className="claim-focus">
        <span>{removed ? '已排除表述' : rewrittenStatement ? '调整后的事实主张' : '当前事实主张'} · C{String(claim.index).padStart(2, '0')}</span>
        <p className={removed ? 'removed-statement' : ''}>{displayStatement}</p>
        {rewrittenStatement && <div className="claim-original-statement"><span>原表述</span><p>{claim.statement}</p></div>}
        <div className="confidence-meter">
          <span>综合可信度</span>
          <div><i style={{ width: `${claim.confidence * 100}%` }} /></div>
          <strong>{Math.round(claim.confidence * 100)}%</strong>
        </div>
      </div>

      {claim.humanAction ? (
        <div className={`resolved-view-bar ${claim.humanAction}`}>
          <CheckOutlined />
          <div>
            <strong>{removed ? '该表述已从最终结论排除' : rewrittenStatement ? '已采用调整后的表述' : claim.humanAction === 'rewrite' ? '尚未填写调整后的完整表述' : '人工复核已完成'}</strong>
            <span>{removed ? '原句仍保留在全部核验结论和审计记录中' : rewrittenStatement ? '原句与调整结果均已留痕，可继续修改' : '处理动作已保留在审计记录中'}</span>
          </div>
          {claim.humanAction === 'rewrite' && <button onClick={openRewriteEditor}>{rewrittenStatement ? '重新调整' : '补充表述'}</button>}
        </div>
      ) : claim.status === 'verified' ? (
        <div className="verified-view-bar">
          <CheckOutlined />
          <div><strong>两级核验结论一致</strong><span>该绿色结论已自动通过，无需人工操作</span></div>
        </div>
      ) : (
        <div className={`quick-decision-bar ${claim.status}`}>
          <div>
            <span>你的判断</span>
            <strong>{decisionSummary}</strong>
          </div>
          {claim.status === 'review' ? (
            <>
              <button onClick={() => setRemoveOpen(true)}>删除该表述</button>
              <button onClick={openRewriteEditor}>调整表述</button>
            </>
          ) : decisions.map((decision) => (
            <button key={decision.label} onClick={() => void onResolve(decision.action, decision.result)}>{decision.label}</button>
          ))}
          <button className="primary" disabled={retryBusy} onClick={() => setRetryOpen(true)}>
            <RetweetOutlined /> {currentRetry && retryBusy ? '取证中…' : retryBusy ? '其他主张取证中' : '重新取证'}
          </button>
        </div>
      )}

      {currentRetry && (
        <div className={`claim-retry-progress ${currentRetry.status}`} role="status">
          <span className="claim-retry-icon">
            {currentRetry.status === 'success' ? <CheckOutlined /> : currentRetry.status === 'error' ? <CloseOutlined /> : <RetweetOutlined />}
          </span>
          <div>
            <strong>{currentRetry.title}</strong>
            <span>{currentRetry.detail}</span>
          </div>
          {(currentRetry.status === 'success' || currentRetry.status === 'error') && (
            <button aria-label="关闭重新取证状态" onClick={onDismissRetry}><CloseOutlined /></button>
          )}
        </div>
      )}

      <div className="verification-flow">
        <div className="verdict-card supervisor">
          <div className="verdict-card-header">
            <div className="verdict-avatar">盾</div>
            <div><strong>小盾的第一轮判断</strong><span><ClockCircleOutlined /> 已完成</span></div>
            <span className="verdict-state"><CheckOutlined /> 已完成</span>
          </div>
          <p>{claim.supervisorVerdict}</p>
          <div className="verdict-basis"><BookOutlined /> 基于 {claim.evidenceIds.length} 条证据形成结论</div>
        </div>

        <div className="flow-connector"><span /><SwapOutlined /><span /></div>

        <div className="verdict-card reviewer">
          <div className="verdict-card-header">
            <div className="verdict-avatar">复</div>
            <div><strong>独立复核</strong><span><ClockCircleOutlined /> 已完成</span></div>
            <span className={claim.status === 'verified' ? 'verdict-state' : 'verdict-state warning'}>
              {claim.status === 'verified' ? <><CheckOutlined /> 一致</> : evidenceList.length === 0 ? '证据不足' : '需要研判'}
            </span>
          </div>
          <p>{claim.reviewerVerdict}</p>
          <div className="independence-note"><SafetyCertificateOutlined /> 未读取其他核验过程</div>
        </div>
      </div>

      {claim.status !== 'verified' && (
        <div className="conflict-box">
          <div className="conflict-title"><SafetyCertificateOutlined /><strong>{reviewHeading}</strong><span>{claim.issueType ?? (evidenceList.length === 0 ? '证据缺失' : '需要复核')}</span></div>
          <p>{reviewExplanation}</p>
          {evidenceSummaries.length > 0 ? (
            <div className="claim-evidence-summary">
              <div className="claim-evidence-summary-head">
                <strong>相关原文</strong>
                <span>{evidenceList.length} 条证据{evidenceSummaries.length < evidenceList.length ? ` · 合并为 ${evidenceSummaries.length} 组` : ''}</span>
              </div>
              <div className="claim-evidence-summary-list">
                {evidenceSummaries.map((evidence) => (
                  <article className="claim-evidence-summary-item" key={evidence.key}>
                    <div className="claim-evidence-summary-meta">
                      <strong>{evidence.source}</strong>
                      {evidence.duplicateCount > 1 && <span>重复 {evidence.duplicateCount} 条</span>}
                      <i className={evidence.relation}>{evidence.relation === 'challenge' ? '质疑' : '支持'}</i>
                    </div>
                    <p>{evidence.quote}</p>
                    <small>{evidence.basis}</small>
                  </article>
                ))}
              </div>
            </div>
          ) : (
            <div className="claim-evidence-empty">
              <FileSearchOutlined />
              <div><strong>当前没有可比较的原文证据</strong><span>可以发起重新取证；找到原文后，这里才会按“支持 / 质疑”展示真实关系。</span></div>
            </div>
          )}
        </div>
      )}

      <div className="audit-mini">
        <div className="audit-title"><strong>当前主张处理记录</strong><button onClick={() => setAuditOpen(true)}>查看详情</button></div>
        <div><i className="green" /><span>判断</span><p>{claim.supervisorVerdict || '第一轮判断已完成'}</p></div>
        <div><i className="blue" /><span>复核</span><p>{claim.reviewerVerdict || '独立复核已完成'}</p></div>
        <div><i className="orange" /><span>证据</span><p>当前绑定 {evidenceList.length} 条原文证据</p></div>
      </div>

      <Drawer title="当前主张核验详情" width={720} open={auditOpen} onClose={() => setAuditOpen(false)}>
        <div className="audit-drawer-intro"><UnorderedListOutlined /><div><strong>C{String(claim.index).padStart(2, '0')} · {displayStatement}</strong><span>这里仅展示后端已经返回给当前主张的判断和证据，不再混入固定演示记录。</span></div></div>
        <div className="claim-audit-detail">
          {claim.humanAction && <section><span>人工处理</span><p>{removed ? '已从最终结论中排除该表述，原句保留供审计回查。' : rewrittenStatement ? `调整后：${rewrittenStatement}` : claim.humanNote || '人工复核动作已记录。'}</p></section>}
          {rewrittenStatement && <section><span>调整前原句</span><p>{claim.statement}</p></section>}
          <section><span>第一轮判断</span><p>{claim.supervisorVerdict || '后端未返回第一轮判断说明'}</p></section>
          <section><span>独立复核</span><p>{claim.reviewerVerdict || '后端未返回独立复核说明'}</p></section>
          <section><span>当前问题</span><p>{reviewExplanation}</p></section>
          <section><span>证据情况</span><p>当前共绑定 {evidenceList.length} 条原文证据。</p></section>
        </div>
      </Drawer>

      <Modal
        className="claim-remove-modal"
        title="确认删除该表述？"
        open={removeOpen}
        onCancel={() => setRemoveOpen(false)}
        onOk={() => void submitResolution('remove', '从最终结论中删除该表述')}
        confirmLoading={resolutionSubmitting}
        okText="确认排除"
        cancelText="先不删除"
        okButtonProps={{ danger: true }}
        width={560}
      >
        <div className="claim-resolution-modal-copy">
          <span>即将排除的原表述</span>
          <p>{claim.statement}</p>
          <small>确认后，这句话不会再作为最终结论展示；原句和本次删除动作仍会保留在“全部核验结论”与审计记录中。</small>
        </div>
      </Modal>

      <Modal
        className="claim-rewrite-modal"
        title="调整表述"
        open={rewriteOpen}
        onCancel={() => setRewriteOpen(false)}
        onOk={() => void submitResolution('rewrite', rewriteValue.trim())}
        confirmLoading={resolutionSubmitting}
        okButtonProps={{ disabled: Boolean(rewriteError) }}
        okText="采用新表述"
        cancelText="取消"
        width={620}
      >
        <div className="claim-resolution-modal-copy original">
          <span>原表述</span>
          <p>{claim.statement}</p>
        </div>
        <label className="claim-rewrite-field">
          <span>调整后的完整表述</span>
          <Input.TextArea
            value={rewriteValue}
            onChange={(event) => setRewriteValue(event.target.value)}
            autoSize={{ minRows: 4, maxRows: 8 }}
            maxLength={600}
            showCount
            placeholder="根据现有证据，重新写出一条可以直接进入最终结论的完整表述…"
            status={rewriteValue.length > 0 && rewriteError ? 'error' : undefined}
          />
          <small className={rewriteValue.length > 0 && rewriteError ? 'error' : ''}>{rewriteValue.length > 0 && rewriteError ? rewriteError : '提交后将以新表述作为最终结论，原句仍保留供审计回查。'}</small>
        </label>
      </Modal>

      <Modal
        title="发起第二轮取证"
        open={retryOpen}
        onCancel={() => setRetryOpen(false)}
        onOk={async () => {
          try {
            await onRetry()
            setRetryOpen(false)
          } catch {
            // 请求错误已经显示在当前主张的取证状态中，保留弹窗方便再次确认。
          }
        }}
        confirmLoading={currentRetry?.status === 'starting'}
        okText="确认发起"
        cancelText="取消"
        width={660}
      >
        <div className="mock-notice"><RetweetOutlined /><span>{persisted ? '确认后会调用 FastAPI，为当前主张启动真实重新取证。' : '本操作只演示 UI 流程，不会访问外部数据。'}</span></div>
        <div className="retry-summary"><strong>触发原因</strong><p>{claim.conflictReason || '当前主张缺少能够直接支持原句的证据，需要重新检索并复核。'}</p></div>
        <Steps
          direction="vertical"
          size="small"
          current={0}
          items={[
            { title: '小盾收到复核疑点', description: `问题类型：${claim.issueType || '证据不足'}；只处理当前这条主张。` },
            { title: '重新检索相关原文', description: '围绕当前主张重新匹配公开材料，并保留可以回查的原文片段。' },
            { title: '新旧证据并排比较', description: '保留第一轮证据，不覆盖历史记录。' },
            { title: '再次进入独立复核', description: '刷新证据、复核意见与可信度标签，再交给你判断。' },
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
  const [localClaimResolutions, setLocalClaimResolutions] = useState<Record<string, { action: 'reject' | 'keep' | 'remove' | 'rewrite'; note: string }>>({})
  const [guidance, setGuidance] = useState('')
  const [guidanceHistory, setGuidanceHistory] = useState<GuidanceRecord[]>([])
  const [guidanceAttachments, setGuidanceAttachments] = useState<File[]>([])
  const [suspectedEventSteps, setSuspectedEventSteps] = useState<number[]>([])
  const [backendEvents, setBackendEvents] = useState<ResearchEvent[]>([])
  const [eventStreamStatus, setEventStreamStatus] = useState<EventStreamStatus>('idle')
  const [retryProgress, setRetryProgress] = useState<ClaimRetryProgress | null>(null)
  const [realGuidanceOpen, setRealGuidanceOpen] = useState(false)
  const [realGuidanceSubmitting, setRealGuidanceSubmitting] = useState(false)
  const [selectedBackendEventSeqs, setSelectedBackendEventSeqs] = useState<number[]>([])
  const [restartingResearch, setRestartingResearch] = useState(false)
  const processListRef = useRef<HTMLDivElement>(null)
  const guidanceAttachmentInputRef = useRef<HTMLInputElement>(null)
  const activeTask = useWorkspaceStore(getActiveTask)
  const searchFocus = useWorkspaceStore((state) => state.searchFocus)
  // 持久化任务在详情页以 ResearchRun 完整快照为准，避免任务列表摘要先一步
  // 切到 review，和上一轮仍在 running 的空主张明细拼成短暂空页。
  const persistedRunPhase = getResearchRunPhase(run)
  const taskPhase = preview
    ? 'review'
    : activeTask.persisted && persistedRunPhase
      ? persistedRunPhase
      : activeTask.phase
  const researchTopic = preview ? run.title : activeTask.researchTopic
  const demoStep = preview ? 8 : activeTask.demoStep
  const isDemoRunning = preview ? false : activeTask.isDemoRunning
  const focusedEvidenceId = !preview && searchFocus?.taskId === run.id ? searchFocus.evidenceId : undefined
  const focusedClaimId = !preview && searchFocus?.taskId === run.id
    ? searchFocus.claimId ?? run.claims.find((claim) => focusedEvidenceId && claim.evidenceIds.includes(focusedEvidenceId))?.id
    : undefined
  const selectedClaimId = focusedClaimId ?? (preview ? previewSelectedClaimId : activeTask.selectedClaimId)
  const selectClaim = useWorkspaceStore((state) => state.selectClaim)
  const resolveClaim = useWorkspaceStore((state) => state.resolveClaim)
  const finishResearch = useWorkspaceStore((state) => state.finishResearch)
  const stopDemo = useWorkspaceStore((state) => state.stopDemo)
  const resumeDemo = useWorkspaceStore((state) => state.resumeDemo)
  const setActiveView = useWorkspaceStore((state) => state.setActiveView)
  const addTask = useWorkspaceStore((state) => state.addTask)
  // 真实任务以完整后端快照为准：处理后的疑点可能被改成 verified，但 humanAction 会保留，
  // 因此“非 verified 或存在 humanAction”才是稳定的总疑点口径，不能复用可能残留的本地数组。
  const effectiveClaims = activeTask.persisted && !preview
    ? run.claims
    : run.claims.map((claim) => {
        const resolution = localClaimResolutions[claim.id]
        if (!resolution) return claim
        return {
          ...claim,
          humanAction: resolution.action,
          humanNote: resolution.note,
          status: resolution.action === 'rewrite' || resolution.action === 'keep' ? 'verified' as const : 'conflict' as const,
        }
      })
  const issueClaims = activeTask.persisted && !preview
    ? effectiveClaims.filter((claim) => claim.status !== 'verified' || Boolean(claim.humanAction))
    : effectiveClaims.filter((claim) => claim.status !== 'verified' || Boolean(claim.humanAction))
  const reviewedIssueIds = activeTask.persisted && !preview
    ? issueClaims.filter((claim) => Boolean(claim.humanAction)).map((claim) => claim.id)
    : preview
      ? previewReviewedClaimIds.filter((claimId) => issueClaims.some((claim) => claim.id === claimId))
      : activeTask.reviewedClaimIds.filter((claimId) => issueClaims.some((claim) => claim.id === claimId))
  const pendingClaims = issueClaims.filter((claim) => !reviewedIssueIds.includes(claim.id))
  const reviewedIssueCount = issueClaims.length - pendingClaims.length
  const visibleClaims = focusedClaimId || claimVisibility === 'all' ? effectiveClaims : pendingClaims
  const selectedClaim = visibleClaims.find((claim) => claim.id === selectedClaimId)
    ?? visibleClaims[0]
    ?? (claimVisibility === 'all' ? run.claims[0] : undefined)
  const evidenceList = useMemo(
    () => selectedClaim ? run.evidence.filter((evidence) => selectedClaim.evidenceIds.includes(evidence.id)) : [],
    [run.evidence, selectedClaim],
  )

  useEffect(() => {
    setRetryProgress(null)
  }, [run.id])

  useEffect(() => {
    const shouldObserveBackend = activeTask.persisted
      && !preview
      && !['draft', 'failed'].includes(taskPhase)
    if (!shouldObserveBackend) {
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

      setRetryProgress((current) => {
        if (!current || event.seq <= current.afterSeq || current.status === 'success' || current.status === 'error') return current
        const title = event.payload.title ?? ''
        const detail = event.payload.speech?.trim() ?? ''
        if (event.kind === 'error' && title.includes('重新取证')) {
          return {
            ...current,
            status: 'error',
            title: '重新取证没有完成',
            detail: detail || '后端没有返回更具体的失败原因，请稍后重试。',
          }
        }
        if (title.includes('启动重新取证')) {
          return {
            ...current,
            status: 'running',
            title: '小盾已开始重新检索这条主张',
            detail: '正在重新匹配能够直接支持或质疑原句的公开材料。',
          }
        }
        if (title.includes('二次取证完成')) {
          return {
            ...current,
            status: 'running',
            title: '新一轮检索已结束，正在重新复核',
            detail: '后台正在用最新证据重新判断这条主张，完成后会自动刷新当前页面。',
          }
        }
        if (title.includes('重新复核完成')) {
          void queryClient.invalidateQueries({ queryKey: ['research-run', run.id] }).then(() => {
            const refreshedRun = queryClient.getQueryData<ResearchRun>(['research-run', run.id])
            const refreshedClaim = refreshedRun?.claims.find((claim) => claim.id === current.claimId)
            const evidenceCount = refreshedClaim?.evidenceIds.length ?? current.evidenceCountBefore
            const addedCount = Math.max(0, evidenceCount - current.evidenceCountBefore)
            setRetryProgress((latest) => latest?.claimId === current.claimId ? {
              ...latest,
              status: 'success',
              title: '重新取证与复核已完成',
              detail: addedCount > 0
                ? `本轮新增 ${addedCount} 条可回查证据，当前主张的证据和复核结论已经刷新。`
                : evidenceCount === 0
                  ? '本轮仍未找到能够直接绑定到该主张的原文证据，系统保留“证据缺失”，没有用无关材料凑数。'
                  : '本轮没有新增可绑定证据，现有证据与复核结论已重新检查。',
            } : latest)
          })
          return {
            ...current,
            status: 'running',
            title: '重新复核已完成，正在刷新结果',
            detail: '正在重新读取这条主张的证据和最新复核结论。',
          }
        }
        return current
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
  }, [activeTask.persisted, preview, queryClient, run.id, taskPhase])

  const handleResolve = async (action: 'reject' | 'keep' | 'remove' | 'rewrite', decision: string) => {
    if (!selectedClaim) return false
    const nextClaim = pendingClaims.find((claim) => claim.id !== selectedClaim.id)
    if (activeTask.persisted && !preview) {
      try {
        await resolvePersistedClaim(run.id, selectedClaim.id, action, decision)
        await queryClient.invalidateQueries({ queryKey: ['research-run', run.id] })
      } catch (error) {
        message.error(error instanceof Error ? error.message : '裁决提交失败')
        return false
      }
    } else if (preview) {
      setLocalClaimResolutions((current) => ({ ...current, [selectedClaim.id]: { action, note: decision } }))
      setPreviewReviewedClaimIds((current) => current.includes(selectedClaim.id) ? current : [...current, selectedClaim.id])
      if (nextClaim) setPreviewSelectedClaimId(nextClaim.id)
    } else {
      setLocalClaimResolutions((current) => ({ ...current, [selectedClaim.id]: { action, note: decision } }))
      resolveClaim(selectedClaim.id, nextClaim?.id)
    }
    message.success(nextClaim ? `${decision}，已自动进入下一条` : `${decision}，所有疑点已处理`)
    return true
  }

  const handleRetry = async () => {
    if (!selectedClaim) return
    if (!activeTask.persisted || preview) {
      message.success('已加入演示取证队列')
      return
    }
    if (retryProgress?.status === 'starting' || retryProgress?.status === 'running') return
    const claimId = selectedClaim.id
    setRetryProgress({
      claimId,
      status: 'starting',
      title: '正在提交重新取证请求',
      detail: '已经锁定当前主张，正在等待 FastAPI 接收。',
      afterSeq: backendEvents.at(-1)?.seq ?? 0,
      evidenceCountBefore: selectedClaim.evidenceIds.length,
    })
    try {
      await retryPersistedClaim(run.id, claimId)
      setRetryProgress((current) => current?.claimId === claimId && current.status === 'starting' ? {
        ...current,
        status: 'running',
        title: '后端已受理，等待第一条取证进展',
        detail: '重新检索和复核会在后台继续，当前卡片会实时显示进度。',
      } : current)
      message.success('重新取证已受理，进度会显示在当前主张下方')
    } catch (error) {
      const detail = error instanceof Error ? error.message : '重新取证失败'
      setRetryProgress((current) => current?.claimId === claimId ? {
        ...current,
        status: 'error',
        title: '重新取证请求未能启动',
        detail,
      } : current)
      message.error(detail)
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

  const restartStoppedResearch = async () => {
    if (!activeTask.persisted || taskPhase !== 'stopped') return
    const researchType = activeTask.category === '政策研究'
      ? 'policy'
      : activeTask.category === '风险线索'
        ? 'risk'
        : 'company'
    setRestartingResearch(true)
    try {
      await assertResearchReady()
      const restartedTask = await createPersistedTask({
        topic: researchTopic || run.title,
        title: run.title,
        company: run.company,
        researchType,
      })
      addTask(restartedTask)
      setActiveView('workbench')
      await queryClient.invalidateQueries({ queryKey: ['workspace-tasks'] })
      message.success('已创建新的同题研究，小盾正在重新检索和核验')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '重新开始研究失败')
    } finally {
      setRestartingResearch(false)
    }
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

  if (taskPhase === 'stopped' && activeTask.persisted) {
    const recordedEvents = backendEvents.filter((event) => event.actor !== 'system' || event.kind !== 'stopped')
    return (
      <div className="research-stopped-page">
        <div className="stopped-two-column-layout">
          <section className="stopped-summary-card page-card">
            <span className="stopped-status-icon"><PauseCircleOutlined /></span>
            <span className="stopped-eyebrow">这次研究停在 {Math.round(run.progress)}%</span>
            <h2>记录都还在，可以让小盾重新查一遍</h2>
            <p>旧任务已经按你的操作终止，后端不会继续消费它的执行节点。重新开始会保留这条记录，同时创建一条同题新任务，从检索、核验到整理重新执行。</p>
            <Progress percent={Math.round(run.progress)} showInfo={false} strokeColor="#9a7650" trailColor="#ebe5dd" />
            <div className="stopped-progress-meta"><strong>{Math.round(run.progress)}%</strong><span>终止前进度</span></div>
            <div className="stopped-preserved-summary">
              <div><strong>{recordedEvents.length}</strong><span>条过程记录</span></div>
              <div><strong>{run.claims.length}</strong><span>条已生成主张</span></div>
              <div><strong>{run.evidence.length}</strong><span>份已绑定证据</span></div>
            </div>
            <div className="stopped-actions">
              <Button type="primary" size="large" icon={<RetweetOutlined />} loading={restartingResearch} onClick={restartStoppedResearch}>重新开始研究</Button>
              <Button size="large" onClick={() => setActiveView('tasks')}>返回任务列表</Button>
            </div>
            <small className="stopped-lineage-note">新任务会使用相同研究问题和研究对象；这条已终止任务不会被覆盖或删除。</small>
          </section>

          <section className="research-process-panel stopped-process-card">
            <div className="process-panel-heading">
              <div><strong>终止前的研究动态</strong><span>已经完成的思考、检索和工具记录仍可回看</span></div>
              <span className="process-recording paused"><i /> 已停止记录</span>
            </div>
            <div className="research-process-list">
              {recordedEvents.length === 0 ? (
                <div className="process-stream-empty">
                  <span><FileSearchOutlined /></span>
                  <strong>这次终止发生得较早</strong>
                  <p>后端还没写入可展示的研究动态，可以重新开始一条同题研究。</p>
                </div>
              ) : recordedEvents.map((event) => {
                const details = event.payload.details ?? []
                const metrics = event.payload.metrics ?? []
                const speech = buildConversationalSpeech(event, recordedEvents)
                const tone = event.payload.tone === 'danger' || event.kind === 'error'
                  ? 'danger'
                  : event.payload.tone === 'warning' || event.kind === 'warning'
                    ? 'warning'
                    : ''
                return (
                  <div className={`research-process-item backend-event${tone ? ` ${tone}` : ''}`} key={event.seq}>
                    <span className="process-item-icon">{backendActorIcon(event.actor)}</span>
                    <div className="process-item-content">
                      <div className="process-item-title"><strong>{event.payload.title || '研究进度更新'}</strong><span>小盾 · {eventTime(event.ts)}</span></div>
                      {speech && <TypewriterBroadcast text={speech} active={false} complete />}
                      {details.length > 0 && <><div className="process-evidence-label">本步执行依据</div><ul>{details.map((detail, index) => <li key={`${detail.label}-${index}`}><b>{detail.label}</b><span>{detail.text}</span></li>)}</ul></>}
                      {metrics.length > 0 && <div className="process-item-metrics">{metrics.map((metric, index) => <span key={`${metric.label}-${index}`}>{metric.label} {metric.value}</span>)}</div>}
                    </div>
                    <div className="process-item-controls"><small>已保留</small></div>
                  </div>
                )
              })}
            </div>
          </section>
        </div>
      </div>
    )
  }

  if (!focusedClaimId && (taskPhase === 'ready' || (taskPhase === 'review' && issueClaims.length > 0 && pendingClaims.length === 0))) {
    const autoVerifiedCount = run.claims.filter((claim) => claim.status === 'verified' && !claim.humanAction).length
    return (
      <div className="research-ready-page">
        <section className="ready-focus-card">
          <div className="ready-icon"><CheckOutlined /></div>
          <span>研究已完成</span>
          <h2>疑点已全部处理，底稿可以交付。</h2>
          <p>{run.claims.length} 条事实主张、{run.evidence.length} 份原始证据与双层核验记录已经整理完毕。</p>
          <div className="ready-summary"><span><strong>{autoVerifiedCount}</strong>自动归档</span><span><strong>{reviewedIssueCount}</strong>人工复核</span><span><strong>{run.evidence.length}</strong>原始证据</span></div>
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
        <div className="review-progress"><strong>{reviewedIssueCount} / {issueClaims.length}</strong><span>已处理</span></div>
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
          <EvidenceViewer key={selectedClaim.id} evidenceList={evidenceList} preferredEvidenceId={focusedEvidenceId} />
        </section>
        <VerdictPanel
          claim={selectedClaim}
          evidenceList={evidenceList}
          onResolve={handleResolve}
          onRetry={handleRetry}
          persisted={Boolean(activeTask.persisted && !preview)}
          retryProgress={retryProgress}
          onDismissRetry={() => setRetryProgress(null)}
        />
      </div>
    </div>
  )
}
