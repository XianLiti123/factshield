import { useMemo, useRef, useState } from 'react'
import {
  ArrowUpOutlined,
  CheckCircleFilled,
  CloseOutlined,
  FileOutlined,
  FileSearchOutlined,
  MessageOutlined,
  PaperClipOutlined,
  RetweetOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons'
import { Button, Drawer, Input, Tag } from 'antd'
import type { ResearchRun } from '../types'
import { useWorkspaceStore } from '../store'

type AssistantMessage = {
  id: number
  role: 'assistant' | 'user'
  content: string
  attachments?: AttachmentInfo[]
  replyTo?: {
    id: number
    content: string
  }
}

type AttachmentInfo = {
  name: string
  size: number
  type: string
}

function getFileExtension(fileName: string) {
  const extension = fileName.split('.').pop()
  return extension && extension !== fileName ? extension.toUpperCase() : '文件'
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

const quickRequests = ['解释当前结论', '补充取证', '调整研究范围', '修正当前表述']

function createMockReply(request: string, claimStatement?: string) {
  if (request.includes('解释')) {
    return '当前结论的关键依据是：支持证据能够证明相关因素存在，但不足以排除其他因素的贡献，因此独立审查将其标记为需要人工研判。'
  }
  if (request.includes('取证')) {
    return '已记录补充取证要求。正式接入后，Supervisor 会保留现有证据，并围绕当前疑点追加限定检索与独立复核。'
  }
  if (request.includes('范围')) {
    return '可以调整。请直接说明新增或排除的公司、时间区间、指标或信源范围，Supervisor 将据此更新研究任务。'
  }
  if (request.includes('修正')) {
    return claimStatement
      ? `建议将当前表述改为更审慎的可核验口径，并保留证据限定：${claimStatement}`
      : '请指定需要修正的事实主张，Supervisor 将基于原始证据给出更审慎的可核验表述。'
  }
  return '要求已记录。正式接入 Supervisor 服务后，系统会结合当前任务、事实主张和证据链执行，并将处理结果回传到对应工作区。'
}

export function SupervisorAssistant({ run }: { run: ResearchRun }) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<File[]>([])
  const [replyTarget, setReplyTarget] = useState<{ id: number; content: string } | null>(null)
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const [messages, setMessages] = useState<AssistantMessage[]>([
    {
      id: 1,
      role: 'assistant',
      content: '你可以直接追问核验依据、补充研究要求或要求重新取证。我会自动携带当前任务与证据上下文。',
    },
  ])
  const activeView = useWorkspaceStore((state) => state.activeView)
  const selectedClaimId = useWorkspaceStore((state) => state.selectedClaimId)
  const selectedClaim = useMemo(
    () => run.claims.find((claim) => claim.id === selectedClaimId),
    [run.claims, selectedClaimId],
  )
  const hasClaimContext = activeView === 'workbench' && selectedClaim

  const sendRequest = (request: string) => {
    const content = request.trim()
    if (!content && attachments.length === 0) return
    const timestamp = Date.now()
    const attachmentInfos = attachments.map((file) => ({ name: file.name, size: file.size, type: file.type }))
    const userContent = content || '请结合我补充的附件继续核验。'
    setMessages((current) => [
      ...current,
      { id: timestamp, role: 'user', content: userContent, attachments: attachmentInfos, replyTo: replyTarget ?? undefined },
      { id: timestamp + 1, role: 'assistant', content: createMockReply(userContent, hasClaimContext ? selectedClaim.statement : undefined) },
    ])
    setInput('')
    setAttachments([])
    setReplyTarget(null)
  }

  const addAttachments = (files: FileList | null) => {
    if (!files) return
    setAttachments((current) => {
      const existing = new Set(current.map((file) => `${file.name}-${file.size}`))
      const additions = Array.from(files).filter((file) => !existing.has(`${file.name}-${file.size}`))
      return [...current, ...additions].slice(0, 5)
    })
    if (attachmentInputRef.current) attachmentInputRef.current.value = ''
  }

  return (
    <>
      <button className="supervisor-assistant-trigger" onClick={() => setOpen(true)}>
        <span className="assistant-trigger-icon"><MessageOutlined /><i /></span>
        <span><strong>向研究主控追问</strong><small>自动携带当前上下文</small></span>
      </button>

      <Drawer
        className="supervisor-assistant-drawer"
        title={
          <div className="assistant-drawer-title">
            <span><SafetyCertificateOutlined /></span>
            <div><strong>研究主控</strong><small>Supervisor 单一交互入口</small></div>
          </div>
        }
        width={440}
        open={open}
        onClose={() => setOpen(false)}
      >
        <div className="assistant-context-card">
          <div className="assistant-context-heading"><span>当前上下文</span><Tag icon={<CheckCircleFilled />}>已自动绑定</Tag></div>
          <strong>{run.title}</strong>
          {hasClaimContext && <p><FileSearchOutlined /> C{String(selectedClaim.index).padStart(2, '0')} · {selectedClaim.statement}</p>}
          {!hasClaimContext && <p>任务编号 {run.id} · 当前页面：{activeView === 'tasks' ? '开始研究' : activeView === 'reports' ? '研究底稿' : '研究辅助视图'}</p>}
        </div>

        <div className="assistant-isolation-note">
          <SafetyCertificateOutlined />
          <span>请求仅发送给 Supervisor；SubAgent 仍保持隔离，不直接参与对话。</span>
        </div>

        <div className="assistant-quick-actions">
          <span>快捷要求</span>
          <div>{quickRequests.map((request) => <button key={request} onClick={() => sendRequest(request)}>{request}</button>)}</div>
        </div>

        <div className="assistant-message-list">
          {messages.map((message) => (
            <div className={`assistant-message ${message.role}`} key={message.id}>
              {message.role === 'assistant' && <span className="assistant-message-avatar">S</span>}
              <div>
                <small>{message.role === 'assistant' ? '研究主控' : '你'}</small>
                {message.replyTo && (
                  <div className="assistant-sent-reply-card">
                    <RetweetOutlined />
                    <div><strong>追问研究主控</strong><span>{message.replyTo.content}</span></div>
                  </div>
                )}
                <p>{message.content}</p>
                {message.role === 'assistant' && (
                  <button
                    className={replyTarget?.id === message.id ? 'assistant-reply-button selected' : 'assistant-reply-button'}
                    onClick={() => setReplyTarget({ id: message.id, content: message.content })}
                  >
                    <RetweetOutlined /> {replyTarget?.id === message.id ? '已选中' : '追问'}
                  </button>
                )}
                {message.attachments && message.attachments.length > 0 && (
                  <div className="assistant-message-attachments">
                    {message.attachments.map((file) => (
                      <div className="assistant-sent-attachment-card" key={`${file.name}-${file.size}`}>
                        <span><FileOutlined /></span>
                        <div><strong>{file.name}</strong><small>{getFileExtension(file.name)} · {formatFileSize(file.size)}</small></div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="assistant-composer">
          <div className="assistant-composer-box">
            {replyTarget && (
              <div className="assistant-reply-target-card">
                <div><strong>追问这条回复</strong><span>{replyTarget.content}</span></div>
                <button aria-label="取消追问" onClick={() => setReplyTarget(null)}><CloseOutlined /></button>
              </div>
            )}
            <Input.TextArea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onPressEnter={(event) => {
                if (!event.shiftKey) {
                  event.preventDefault()
                  sendRequest(input)
                }
              }}
              autoSize={{ minRows: 2, maxRows: 5 }}
              placeholder="补充要求或追问当前核验结论…"
            />
            {attachments.length > 0 && (
              <div className="assistant-pending-attachments">
                {attachments.map((file, index) => (
                  <div className="assistant-attachment-card" key={`${file.name}-${file.size}`}>
                    <span className="assistant-attachment-icon"><FileOutlined /></span>
                    <div>
                      <strong>{file.name}</strong>
                      <small>{getFileExtension(file.name)} · {formatFileSize(file.size)}</small>
                    </div>
                    <button aria-label={`移除附件 ${file.name}`} onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}><CloseOutlined /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="assistant-composer-toolbar">
              <input
                ref={attachmentInputRef}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg"
                onChange={(event) => addAttachments(event.target.files)}
              />
              <Button type="text" icon={<PaperClipOutlined />} aria-label="添加附件" onClick={() => attachmentInputRef.current?.click()}>添加附件</Button>
              <Button type="primary" icon={<ArrowUpOutlined />} aria-label="发送给研究主控" onClick={() => sendRequest(input)} />
            </div>
          </div>
          <span>Enter 发送 · Shift + Enter 换行 · 当前为 UI Mock</span>
        </div>
      </Drawer>
    </>
  )
}
