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
import { getActiveTask, useWorkspaceStore } from '../store'

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
    return '记下了。我会保留已经找到的证据，再围绕当前疑点补一轮限定检索和独立复核。'
  }
  if (request.includes('范围')) {
    return '可以调整。告诉我想新增或排除哪些公司、时间区间、指标或信源，我会按新的范围继续查。'
  }
  if (request.includes('修正')) {
    return claimStatement
      ? `建议将当前表述改为更审慎的可核验口径，并保留证据限定：${claimStatement}`
      : '告诉我需要修正哪条事实主张，我会根据原始证据换成更审慎、可核验的说法。'
  }
  return '好，我记下了。我会结合当前任务、事实主张和已有证据继续处理，结果会回到对应的工作区。'
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
      content: '哪条结论看着不对，直接问我就好。你也可以补充要求或让我重新找证据，当前任务和证据会自动带入对话。',
    },
  ])
  const activeView = useWorkspaceStore((state) => state.activeView)
  const selectedClaimId = useWorkspaceStore(getActiveTask).selectedClaimId
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
        <span><strong>问问小盾</strong><small>已关联当前任务</small></span>
      </button>

      <Drawer
        className="supervisor-assistant-drawer"
        title={
          <div className="assistant-drawer-title">
            <span><SafetyCertificateOutlined /></span>
            <div><strong>小盾</strong><small>你的事实核验搭档</small></div>
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
          <span>这段对话由小盾接收；后台核验任务彼此隔离，不会互相影响判断。</span>
        </div>

        <div className="assistant-quick-actions">
          <span>快捷要求</span>
          <div>{quickRequests.map((request) => <button key={request} onClick={() => sendRequest(request)}>{request}</button>)}</div>
        </div>

        <div className="assistant-message-list">
          {messages.map((message) => (
            <div className={`assistant-message ${message.role}`} key={message.id}>
              {message.role === 'assistant' && <span className="assistant-message-avatar">盾</span>}
              <div>
                <small>{message.role === 'assistant' ? '小盾' : '你'}</small>
                {message.replyTo && (
                  <div className="assistant-sent-reply-card">
                    <RetweetOutlined />
                    <div><strong>追问小盾</strong><span>{message.replyTo.content}</span></div>
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
              placeholder="有疑问或想补充什么，直接告诉小盾…"
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
              <Button type="primary" icon={<ArrowUpOutlined />} aria-label="发送给小盾" onClick={() => sendRequest(input)} />
            </div>
          </div>
          <span>Enter 发送 · Shift + Enter 换行 · 当前为 UI Mock</span>
        </div>
      </Drawer>
    </>
  )
}
