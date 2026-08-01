import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpOutlined,
  BulbOutlined,
  CheckCircleFilled,
  CloseOutlined,
  FileOutlined,
  FileSearchOutlined,
  MessageOutlined,
  PaperClipOutlined,
  RetweetOutlined,
  SafetyCertificateOutlined,
  ToolOutlined,
} from '@ant-design/icons'
import { Button, Drawer, Input, Tag, message } from 'antd'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ResearchRun } from '../types'
import { getActiveTask, useWorkspaceStore } from '../store'
import { getTaskChatHistory, streamTaskChat, uploadDocument } from '../services/api'
import { ATTACHMENT_ACCEPT, mergeAttachmentFiles } from '../utils/attachments'

type AssistantMessage = {
  id: number
  role: 'assistant' | 'user'
  content: string
  thinking?: string
  tools?: string[]
  contexts?: string[]
  attachments?: AttachmentInfo[]
  replyTo?: {
    id: number
    content: string
  }
  status?: string
  streaming?: boolean
  restoredFromBackend?: boolean
}

type AttachmentInfo = {
  name: string
  size: number
  type: string
}

const ASSISTANT_HISTORY_KEY_PREFIX = 'factshield.assistant.history.'
const initialAssistantMessage: AssistantMessage = {
  id: 1,
  role: 'assistant',
  content: '哪条结论看着不对，直接问我就好。你也可以补充要求或让我重新找证据，当前任务和证据会自动带入对话。',
}

function getInitialAssistantMessages() {
  return [{ ...initialAssistantMessage }]
}

function getAssistantHistoryKey(userId: number, taskId: string) {
  return `${ASSISTANT_HISTORY_KEY_PREFIX}${userId}.${taskId}`
}

function parseAssistantMessages(stored: string | null): AssistantMessage[] {
  if (!stored) return []
  try {
    const parsed = JSON.parse(stored) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is AssistantMessage => {
      if (!item || typeof item !== 'object') return false
      const candidate = item as Partial<AssistantMessage>
      return typeof candidate.id === 'number'
        && (candidate.role === 'assistant' || candidate.role === 'user')
        && typeof candidate.content === 'string'
    })
  } catch {
    return []
  }
}

function hasProcessDetails(message: AssistantMessage) {
  return Boolean(message.thinking || message.tools?.length || message.contexts?.length)
}

function enrichWithLegacyDetails(current: AssistantMessage[], legacy: AssistantMessage[]) {
  if (!legacy.some(hasProcessDetails)) return current
  if (current.length <= 1) return legacy
  return current.map((message) => {
    const legacyMessage = legacy.find((item) => item.role === message.role && item.content === message.content)
    if (!legacyMessage) return message
    return {
      ...message,
      thinking: message.thinking || legacyMessage.thinking,
      tools: message.tools?.length ? message.tools : legacyMessage.tools,
      contexts: message.contexts?.length ? message.contexts : legacyMessage.contexts,
      attachments: message.attachments?.length ? message.attachments : legacyMessage.attachments,
      replyTo: message.replyTo ?? legacyMessage.replyTo,
      restoredFromBackend: hasProcessDetails(legacyMessage) ? false : message.restoredFromBackend,
    }
  })
}

function loadAssistantMessages(userId: number, taskId: string): AssistantMessage[] {
  try {
    const scopedKey = getAssistantHistoryKey(userId, taskId)
    const scoped = parseAssistantMessages(window.localStorage.getItem(scopedKey))
    const legacy = parseAssistantMessages(window.localStorage.getItem(`${ASSISTANT_HISTORY_KEY_PREFIX}${taskId}`))
    const messages = enrichWithLegacyDetails(scoped, legacy)
    if (messages.length === 0) return getInitialAssistantMessages()
    if (legacy.some(hasProcessDetails)) window.localStorage.setItem(scopedKey, JSON.stringify(messages))
    return messages
  } catch {
    return getInitialAssistantMessages()
  }
}

function saveAssistantMessages(userId: number, taskId: string, messages: AssistantMessage[]) {
  try {
    window.localStorage.setItem(getAssistantHistoryKey(userId, taskId), JSON.stringify(messages))
  } catch {
    // The current page still keeps the conversation when browser storage is unavailable.
  }
}

function getRecoveredMessageContent(role: AssistantMessage['role'], content: string) {
  if (role !== 'user') return content
  const requestMarker = '\n\n用户要求：'
  const requestIndex = content.indexOf(requestMarker)
  if (requestIndex < 0) return content
  const request = content.slice(requestIndex + requestMarker.length)
  return request.split('\n用户补充材料摘要：')[0].trim() || content
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

const markdownComponents: Components = {
  a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
  table: ({ children }) => <div className="assistant-markdown-table"><table>{children}</table></div>,
}

function MarkdownContent({ content, className }: { content: string; className: string }) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{content}</ReactMarkdown>
    </div>
  )
}

function ToolCall({ content }: { content: string }) {
  const separatorIndex = content.indexOf(':')
  const name = separatorIndex > 0 ? content.slice(0, separatorIndex).trim() : content.trim()
  const details = separatorIndex > 0 ? content.slice(separatorIndex + 1).trim() : ''

  return (
    <li>
      <strong>{name || '工具'}</strong>
      {details && <code>{details}</code>}
    </li>
  )
}

export function SupervisorAssistant({ run, userId }: { run: ResearchRun; userId: number }) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<File[]>([])
  const [attachmentDragging, setAttachmentDragging] = useState(false)
  const [replyTarget, setReplyTarget] = useState<{ id: number; content: string } | null>(null)
  const [sending, setSending] = useState(false)
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const [messages, setMessagesState] = useState<AssistantMessage[]>(() => loadAssistantMessages(userId, run.id))
  const messagesRef = useRef(messages)
  const setMessages = (update: (current: AssistantMessage[]) => AssistantMessage[]) => {
    const stored = loadAssistantMessages(userId, run.id)
    const current = stored.length > messagesRef.current.length ? stored : messagesRef.current
    const next = update(current)
    messagesRef.current = next
    saveAssistantMessages(userId, run.id, next)
    setMessagesState(next)
  }
  const activeView = useWorkspaceStore((state) => state.activeView)
  const selectedClaimId = useWorkspaceStore(getActiveTask).selectedClaimId
  const selectedClaim = useMemo(
    () => run.claims.find((claim) => claim.id === selectedClaimId),
    [run.claims, selectedClaimId],
  )
  const hasClaimContext = activeView === 'workbench' && selectedClaim

  useEffect(() => {
    if (loadAssistantMessages(userId, run.id).length > 1) return
    let cancelled = false
    getTaskChatHistory(run.id, userId).then((history) => {
      if (cancelled || history.length === 0) return
      setMessages((current) => current.length > 1 ? current : [
        ...current,
        ...history.map((item, index): AssistantMessage => ({
          id: index + 2,
          role: item.role,
          content: getRecoveredMessageContent(item.role, item.content),
          restoredFromBackend: item.role === 'assistant',
        })),
      ])
    }).catch(() => {
      // Local history remains available if the backend cannot be reached.
    })
    return () => { cancelled = true }
  }, [run.id, userId])

  const sendRequest = async (request: string) => {
    const content = request.trim()
    if ((!content && attachments.length === 0) || sending) return
    const timestamp = Date.now()
    const attachmentInfos = attachments.map((file) => ({ name: file.name, size: file.size, type: file.type }))
    const userContent = content || '请结合我补充的附件继续核验。'
    setMessages((current) => [
      ...current,
      { id: timestamp, role: 'user', content: userContent, attachments: attachmentInfos, replyTo: replyTarget ?? undefined },
      { id: timestamp + 1, role: 'assistant', content: '', status: '正在理解你的问题…', streaming: true },
    ])
    setInput('')
    setReplyTarget(null)
    setSending(true)
    try {
      const converted = []
      for (const file of attachments) converted.push(await uploadDocument(file, { save: false }))
      const attachmentContext = converted.length > 0
        ? `\n用户补充材料摘要：\n${converted.map((item) => `【${item.filename}】\n${item.content}`).join('\n\n')}`
        : ''
      const taskMessage = [
        replyTarget ? `追问上一条回复：${replyTarget.content}` : '',
        `用户要求：${userContent}${attachmentContext}`,
      ].filter(Boolean).join('\n\n')
      await streamTaskChat(taskMessage, run.id, userId, hasClaimContext ? selectedClaimId : undefined, (event) => {
        if (event.type === 'error') throw new Error(event.content || '对话失败')
        setMessages((current) => current.map((item) => {
          if (item.id !== timestamp + 1) return item
          if (event.type === 'token') {
            return { ...item, content: item.content + event.content, status: undefined }
          }
          if (event.type === 'think') {
            return { ...item, thinking: `${item.thinking ?? ''}${event.content}`, status: undefined }
          }
          if (event.type === 'tool') {
            return { ...item, tools: [...(item.tools ?? []), event.content], status: undefined }
          }
          if (event.type === 'context') {
            return { ...item, contexts: [...(item.contexts ?? []), event.content], status: undefined }
          }
          if (event.type === 'done') return { ...item, streaming: false, status: undefined }
          return item
        }))
      })
      setMessages((current) => current.map((item) => item.id === timestamp + 1
        ? {
            ...item,
            content: item.content || '这次没有返回正文，请检查模型配置后重试。',
            status: undefined,
            streaming: false,
          }
        : item))
      setAttachments([])
    } catch (error) {
      const errorText = error instanceof Error ? error.message : '对话失败'
      setMessages((current) => current.map((item) => item.id === timestamp + 1
        ? { ...item, content: `没能完成这次请求：${errorText}`, status: undefined, streaming: false }
        : item))
      message.error(errorText)
    } finally {
      setSending(false)
    }
  }

  const addAttachments = (files: FileList | File[] | null) => {
    if (!files) return
    setAttachments((current) => {
      const result = mergeAttachmentFiles(current, Array.from(files))
      if (result.rejected.length > 0) message.warning(result.rejected[0])
      return result.files
    })
    if (attachmentInputRef.current) attachmentInputRef.current.value = ''
  }

  if (activeView === 'tasks' || activeView === 'settings' || activeView === 'database') return null

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
          {!hasClaimContext && <p>任务编号 {run.id} · 当前页面：{activeView === 'reports' ? '研究底稿' : '研究辅助视图'}</p>}
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
                    <div>
                      <strong>追问小盾</strong>
                      <MarkdownContent content={message.replyTo.content} className="assistant-reply-markdown assistant-reply-markdown-compact" />
                    </div>
                  </div>
                )}
                {message.role === 'user' && <p>{message.content}</p>}
                {message.role === 'assistant' && (
                  <div className="assistant-response">
                    {message.contexts && message.contexts.length > 0 && (
                      <div className="assistant-context-notices">
                        {message.contexts.map((notice, index) => <span key={`${notice}-${index}`}>{notice}</span>)}
                      </div>
                    )}
                    {message.thinking && (
                      <section className="assistant-response-section assistant-thinking-section">
                        <div className="assistant-response-heading">
                          <BulbOutlined />
                          <span>思考过程</span>
                          {message.streaming && !message.content && <i>思考中</i>}
                        </div>
                        <MarkdownContent content={message.thinking} className="assistant-process-markdown" />
                      </section>
                    )}
                    {message.tools && message.tools.length > 0 && (
                      <section className="assistant-response-section assistant-tools-section">
                        <div className="assistant-response-heading"><ToolOutlined /><span>调用工具</span></div>
                        <ul>{message.tools.map((tool, index) => <ToolCall content={tool} key={`${tool}-${index}`} />)}</ul>
                      </section>
                    )}
                    {message.content && (
                      <section className="assistant-answer-section">
                        <div className="assistant-answer-heading"><MessageOutlined /><span>回答</span></div>
                        {message.restoredFromBackend && !message.thinking && !message.tools?.length && (
                          <div className="assistant-restored-note">这条旧记录由后端恢复；当时的思考过程和工具事件未被历史接口保存。</div>
                        )}
                        <MarkdownContent content={message.content} className="assistant-markdown" />
                      </section>
                    )}
                    {message.status && <div className="assistant-live-status"><i />{message.status}</div>}
                  </div>
                )}
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
          <div
            className={`assistant-composer-box${attachmentDragging ? ' is-dragging' : ''}`}
            onDragEnter={(event) => { event.preventDefault(); setAttachmentDragging(true) }}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setAttachmentDragging(true) }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setAttachmentDragging(false) }}
            onDrop={(event) => { event.preventDefault(); setAttachmentDragging(false); addAttachments(Array.from(event.dataTransfer.files)) }}
          >
            {attachmentDragging && <div className="assistant-attachment-drop-hint"><PaperClipOutlined /><span>松开即可添加附件</span></div>}
            {replyTarget && (
              <div className="assistant-reply-target-card">
                <div>
                  <strong>追问这条回复</strong>
                  <MarkdownContent content={replyTarget.content} className="assistant-reply-markdown" />
                </div>
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
                accept={ATTACHMENT_ACCEPT}
                onChange={(event) => addAttachments(event.target.files)}
              />
              <Button type="text" icon={<PaperClipOutlined />} aria-label="添加附件" onClick={() => attachmentInputRef.current?.click()}>添加附件</Button>
              <Button type="primary" loading={sending} icon={<ArrowUpOutlined />} aria-label="发送给小盾" onClick={() => sendRequest(input)} />
            </div>
          </div>
          <span>Enter 发送 · Shift + Enter 换行 · 已连接 FastAPI 流式对话</span>
        </div>
      </Drawer>
    </>
  )
}
