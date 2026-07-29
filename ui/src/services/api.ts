import type { ResearchTaskSession, TaskPhase } from '../store'
import type { ResearchRun } from '../types'

const TOKEN_KEY = 'factshield.auth.token'
const SESSION_KEY_PREFIX = 'factshield.chat.session.'
const RESEARCH_PROGRESS_KEY_PREFIX = 'factshield.research.progress.'

export type UserInfo = { id: number; email: string }
export type AuthResponse = { token: string; user: UserInfo }
export type CapabilityStatus = {
  llm: boolean
  web_search: boolean
  vision: boolean
  embedding: boolean
  reranker: boolean
}
export type ModelSlotConfig = {
  base_url: string
  api_key: string
  model_name: string
  updated_at: string
}
export type SettingsResponse = {
  configs: Partial<Record<'llm' | 'vision', ModelSlotConfig>>
  global_capabilities: { embedding: boolean; reranker: boolean }
}
export type DocumentConversion = { filename: string; mode: string; content: string }
export type StreamEvent = { type: 'token' | 'think' | 'tool' | 'context' | 'done' | 'error'; content: string }
export type ResearchEvent = {
  id: number
  task_id: string
  seq: number
  actor: string
  kind: 'progress' | 'warning' | 'done' | 'stopped' | 'error' | string
  payload: {
    title?: string
    speech?: string
    details?: Array<{ label: string; text: string }>
    metrics?: Array<{ label: string; value: string }>
    tone?: 'warning' | 'danger' | string | null
    progress?: number | null
  }
  ts: string
}

type ApiTask = {
  id: string
  title: string
  company: string
  status: string
  researchType: string
  progress: number
  createdAt: string
  updatedAt: string
  claimCount: number
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

export function getToken() {
  return window.localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null) {
  if (token) window.localStorage.setItem(TOKEN_KEY, token)
  else window.localStorage.removeItem(TOKEN_KEY)
}

function rememberResearchProgress(taskId: string, progress: number | null | undefined) {
  const nextProgress = Math.min(100, Math.max(0, Number(progress) || 0))
  try {
    const key = `${RESEARCH_PROGRESS_KEY_PREFIX}${taskId}`
    const storedProgress = Number(window.localStorage.getItem(key)) || 0
    const displayProgress = Math.max(storedProgress, nextProgress)
    window.localStorage.setItem(key, String(displayProgress))
    return displayProgress
  } catch {
    return nextProgress
  }
}

function forgetResearchProgress(taskId: string) {
  try {
    window.localStorage.removeItem(`${RESEARCH_PROGRESS_KEY_PREFIX}${taskId}`)
  } catch {
    // Storage may be unavailable in private browsing; task deletion still succeeds.
  }
}

async function parseError(response: Response) {
  try {
    const payload = await response.json()
    if (typeof payload.detail === 'string') return payload.detail
    if (Array.isArray(payload.detail)) return payload.detail.map((item: { msg?: string }) => item.msg).filter(Boolean).join('；')
  } catch {
    // Non-JSON error response.
  }
  return `请求失败（${response.status}）`
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, { ...init, headers })
  if (!response.ok) throw new ApiError(await parseError(response), response.status)
  return response.json() as Promise<T>
}

export const register = (email: string, password: string) => request<AuthResponse>('/api/auth/register', {
  method: 'POST', body: JSON.stringify({ email, password }),
})

export const login = (email: string, password: string) => request<AuthResponse>('/api/auth/login', {
  method: 'POST', body: JSON.stringify({ email, password }),
})

export const getMe = () => request<UserInfo>('/api/auth/me')

export async function logout() {
  try { await request<{ status: string }>('/api/auth/logout', { method: 'POST' }) } finally { setToken(null) }
}

export const getCapabilities = () => request<CapabilityStatus>('/api/capabilities')
export async function assertResearchReady() {
  const capabilities = await getCapabilities()
  const missing = [
    !capabilities.web_search && 'Tavily 搜索',
    !capabilities.embedding && 'Embedding',
    !capabilities.reranker && 'Reranker',
  ].filter(Boolean)
  if (missing.length > 0) {
    throw new ApiError(`真实研究还缺少服务端配置：${missing.join('、')}。请先在 .env 配好并重启 FastAPI。`, 503)
  }
}
export const getSettings = () => request<SettingsResponse>('/api/settings')
export const saveModelConfig = (slot: 'llm' | 'vision', config: { base_url: string; api_key: string; model_name: string }) => (
  request<{ status: string; slot: string; config: ModelSlotConfig }>(`/api/settings/${slot}`, {
    method: 'PUT', body: JSON.stringify(config),
  })
)

export function uploadDocument(file: File, options: { mode?: 'normal' | 'ai'; save?: boolean } = {}) {
  const body = new FormData()
  body.append('file', file)
  const params = new URLSearchParams({
    mode: options.mode ?? 'normal',
    save: String(options.save ?? false),
    max_length: '12000',
  })
  return request<DocumentConversion>(`/api/documents/convert?${params}`, { method: 'POST', body })
}

const taskTypeLabels: Record<string, string> = {
  company: '企业研究',
  policy: '政策研究',
  risk: '风险线索',
}

function toWorkspaceTask(task: ApiTask): ResearchTaskSession {
  const displayProgress = rememberResearchProgress(task.id, task.progress)
  const supportedPhases: TaskPhase[] = ['running', 'review', 'ready', 'stopped', 'failed']
  const reportedPhase: TaskPhase = supportedPhases.includes(task.status as TaskPhase) ? task.status as TaskPhase : 'draft'
  const phase: TaskPhase = (reportedPhase === 'review' || reportedPhase === 'ready')
    && (displayProgress < 100 || (task.claimCount ?? 0) === 0)
    ? 'running'
    : reportedPhase
  return {
    id: task.id,
    title: task.title,
    company: task.company || '待识别研究对象',
    category: taskTypeLabels[task.researchType] ?? task.researchType,
    phase,
    researchTopic: task.title,
    selectedClaimId: '',
    reviewClaimIds: [],
    reviewedClaimIds: [],
    demoStep: Math.min(8, Math.round(displayProgress / 12.5)),
    isDemoRunning: phase === 'running',
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    progress: displayProgress,
    claimCount: task.claimCount ?? 0,
    persisted: true,
  }
}

export async function listTasks() {
  const data = await request<ApiTask[]>('/api/tasks')
  return data.map(toWorkspaceTask)
}

export async function createTask(input: { topic: string; title?: string; company?: string; researchType?: string; preferredSources?: string[] }) {
  const task = await request<ApiTask>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      topic: input.topic,
      title: input.title,
      company: input.company ?? '',
      research_type: input.researchType,
      preferred_sources: input.preferredSources ?? [],
    }),
  })
  return toWorkspaceTask(task)
}

export async function deleteTask(taskId: string) {
  const result = await request<{ status: string; task_id: string }>(`/api/tasks/${taskId}`, { method: 'DELETE' })
  forgetResearchProgress(taskId)
  return result
}

export async function getTask(taskId: string) {
  const run = await request<ResearchRun>(`/api/tasks/${taskId}`)
  return { ...run, progress: rememberResearchProgress(taskId, run.progress) }
}
export const stopTask = (taskId: string) => request<{ status: string; task_id: string }>(`/api/tasks/${taskId}/stop`, { method: 'POST' })
export const guideTask = (taskId: string, instruction: string) => request<{ status: string; task_id: string }>(
  `/api/tasks/${taskId}/guidance`, {
    method: 'POST',
    body: JSON.stringify({ instruction }),
  },
)
export const resolveClaim = (taskId: string, claimId: string, action: 'reject' | 'keep' | 'remove' | 'rewrite', comment?: string) => (
  request<{ status: string; claim_id: string; new_status: string }>(`/api/tasks/${taskId}/claims/${claimId}/resolve`, {
    method: 'POST', body: JSON.stringify({ action, comment }),
  })
)
export const retryClaim = (taskId: string, claimId: string) => request<{ status: string }>(
  `/api/tasks/${taskId}/claims/${claimId}/retry`, { method: 'POST' },
)
export const getReport = (taskId: string) => request<{ format: string; content: string }>(`/api/tasks/${taskId}/report`)
export const getAuditLog = (taskId: string) => request<{ task_id: string; events: unknown[]; resolutions: unknown[] }>(`/api/tasks/${taskId}/audit-log`)

export async function streamTaskEvents(
  taskId: string,
  onEvent: (event: ResearchEvent) => void,
  signal?: AbortSignal,
) {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/events`, {
    headers: { Authorization: `Bearer ${getToken() ?? ''}` },
    signal,
  })
  if (!response.ok) throw new ApiError(await parseError(response), response.status)
  if (!response.body) throw new ApiError('浏览器未返回任务事件流', 500)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const blocks = buffer.split(/\r?\n\r?\n/)
    buffer = blocks.pop() ?? ''
    for (const block of blocks) {
      const data = block.split(/\r?\n/).find((line) => line.startsWith('data:'))?.slice(5).trim()
      if (data) {
        const event = JSON.parse(data) as ResearchEvent
        rememberResearchProgress(taskId, event.payload.progress)
        onEvent(event)
      }
    }
    if (done) return
  }
}

export async function streamChat(
  message: string,
  taskId: string,
  onEvent: (event: StreamEvent) => void,
) {
  const sessionKey = `${SESSION_KEY_PREFIX}${taskId}`
  let storedSession = window.localStorage.getItem(sessionKey)
  const send = (sessionId: string | null) => fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken() ?? ''}` },
      body: JSON.stringify({ message, session_id: sessionId }),
    })
  let response = await send(storedSession)
  if (response.status === 404 && storedSession) {
    window.localStorage.removeItem(sessionKey)
    storedSession = null
    response = await send(null)
  }
  if (!response.ok) throw new ApiError(await parseError(response), response.status)
  const sessionId = response.headers.get('X-Session-Id')
  if (sessionId) window.localStorage.setItem(sessionKey, sessionId)
  if (!response.body) throw new ApiError('浏览器未返回流式响应', 500)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const blocks = buffer.split(/\r?\n\r?\n/)
    buffer = blocks.pop() ?? ''
    for (const block of blocks) {
      const data = block.split(/\r?\n/).find((line) => line.startsWith('data:'))?.slice(5).trim()
      if (data) onEvent(JSON.parse(data) as StreamEvent)
    }
    if (done) break
  }
}
