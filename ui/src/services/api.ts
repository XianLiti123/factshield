import { getResearchRunPhase, type ResearchTaskSession, type TaskPhase } from '../store'
import type { AgentQuestion, ResearchRun } from '../types'
import { getEffectiveReviewedClaimIds, readReopenedReviewIds } from '../utils/reviewDrafts'

const TOKEN_KEY = 'factshield.auth.token'
const SESSION_KEY_PREFIX = 'factshield.chat.session.'
const RESEARCH_PROGRESS_KEY_PREFIX = 'factshield.research.progress.'

export type UserInfo = { id: number; email: string; display_name: string; avatar_url?: string | null; avatar?: string | null }
export type AuthResponse = { token: string; user: UserInfo }
export type CapabilityStatus = {
  llm: boolean
  web_search: boolean
  responses_api: boolean
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
  search_engine: 'tavily' | 'python' | 'response_api'
  search: {
    engine: 'tavily' | 'python' | 'response_api'
    tavily_configured: boolean
    response_api_configured: boolean
    needs_key: boolean
    default_engine: 'tavily' | 'python' | 'response_api'
    default_reason: string
    engines: Array<{
      id: 'tavily' | 'python' | 'response_api'
      label: string
      needs_key: boolean
      configured: boolean
    }>
  }
  llm_settings: {
    use_response_api: boolean
    mode: 'responses' | 'chat'
    responses_supported: boolean
  }
  context: {
    trigger_percent: number
    default_percent: number
    min_percent: number
    max_percent: number
    window_tokens: number
  }
  global_capabilities: {
    embedding: boolean
    reranker: boolean
    tavily?: boolean
    tickflow?: boolean
    efinance?: boolean
  }
}
export type DataSourceMode = 'http' | 'python'
export type DataSourceConfig = {
  id: string
  name: string
  description: string
  category: string
  mode: DataSourceMode
  specification: string
  enabled: boolean
  updated_at?: string
}
export type DocumentConversion = { filename: string; mode: string; content: string }
export type StreamEvent = {
  type: 'token' | 'think' | 'tool' | 'context' | 'paused' | 'question' | 'answer' | 'done' | 'error'
  content: string
  payload?: {
    question_id?: string
    question?: string
    options?: string[]
    allow_custom?: boolean
    actor?: string
    answer?: string
  }
}
export type ChatHistoryMessage = { role: 'assistant' | 'user'; content: string }
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
    question_id?: string
    question?: string
    options?: string[]
    allow_custom?: boolean
    answer?: string
  }
  ts: string
}

export type HistoryAnalysisPoint = {
  t: string
  value: number
}

export type HistoryAnalysisSource = {
  title: string
  url: string
}

export type HistoryAnalysisEvent = {
  name: string
  period: string
  description: string
  points: HistoryAnalysisPoint[]
  sources?: HistoryAnalysisSource[]
}

export type HistoryAnalysis = {
  id: number
  task_id: string
  attached: boolean
  created_at: string
  metric: string
  unit: string
  events: HistoryAnalysisEvent[]
  completeness: number
  requested_config?: HistoryAnalysisRequest
}

export type HistoryAnalysisFrequency = 'auto' | 'monthly' | 'quarterly' | 'yearly'

export type HistoryAnalysisRequest = {
  metric: string | null
  scenarios: string[]
  start: string | null
  end: string | null
  frequency: HistoryAnalysisFrequency
}

export type WorkspaceSearchTask = {
  task_id: string
  title: string
  company: string
  status: string
  updated_at: string
}

export type WorkspaceSearchClaim = {
  id: string
  task_id: string
  statement: string
  status: string
  task_title: string
}

export type WorkspaceSearchEvidence = {
  id: string
  task_id: string
  title: string
  publisher: string
  url: string
  task_title: string
}

export type WorkspaceSearchResult = {
  query: string
  tasks: WorkspaceSearchTask[]
  claims: WorkspaceSearchClaim[]
  evidence: WorkspaceSearchEvidence[]
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

function getResearchProgressKey(taskId: string, createdAt: string) {
  return `${RESEARCH_PROGRESS_KEY_PREFIX}${taskId}.${encodeURIComponent(createdAt)}`
}

function rememberResearchProgress(taskId: string, createdAt: string, progress: number | null | undefined) {
  try {
    const legacyKey = `${RESEARCH_PROGRESS_KEY_PREFIX}${taskId}`
    const key = getResearchProgressKey(taskId, createdAt)
    const storedProgress = Number(window.localStorage.getItem(key)) || 0
    window.localStorage.removeItem(legacyKey)
    if (progress == null || !Number.isFinite(Number(progress))) return storedProgress
    const nextProgress = Math.min(100, Math.max(0, Number(progress)))
    const displayProgress = Math.max(storedProgress, nextProgress)
    window.localStorage.setItem(key, String(displayProgress))
    return displayProgress
  } catch {
    if (progress == null || !Number.isFinite(Number(progress))) return 0
    return Math.min(100, Math.max(0, Number(progress)))
  }
}

function forgetResearchProgress(taskId: string) {
  try {
    const legacyKey = `${RESEARCH_PROGRESS_KEY_PREFIX}${taskId}`
    const scopedKeyPrefix = `${legacyKey}.`
    Object.keys(window.localStorage).forEach((key) => {
      if (key === legacyKey || key.startsWith(scopedKeyPrefix)) window.localStorage.removeItem(key)
    })
  } catch {
    // Storage may be unavailable in private browsing; task deletion still succeeds.
  }
}

async function parseError(response: Response) {
  const raw = await response.text()
  try {
    const payload = JSON.parse(raw)
    if (typeof payload.detail === 'string') return payload.detail
    if (Array.isArray(payload.detail)) return payload.detail.map((item: { msg?: string }) => item.msg).filter(Boolean).join('；')
  } catch {
    // Keep the plain-text response below when the backend does not return JSON.
  }
  if (raw.trim()) return raw.trim()
  return `请求失败（${response.status}）`
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const token = getToken()
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, { ...init, headers })
  if (!response.ok) throw new ApiError(await parseError(response), response.status)
  return response.json() as Promise<T>
}

export const register = (username: string, email: string, password: string) => request<AuthResponse>('/api/auth/register', {
  method: 'POST', body: JSON.stringify({ username, email, password }),
})

export const login = (email: string, password: string) => request<AuthResponse>('/api/auth/login', {
  method: 'POST', body: JSON.stringify({ email, password }),
})

export const getMe = () => request<UserInfo>('/api/auth/me')

export async function updateDisplayName(displayName: string) {
  const payload = await request<AvatarUpdateResponse>('/api/auth/display-name', {
    method: 'PUT',
    body: JSON.stringify({ display_name: displayName }),
  })
  return payload.user ? { ...payload, ...payload.user } : payload
}

export const changePassword = (currentPassword: string, newPassword: string, token?: string) => request<{ status: string }>('/api/auth/password', {
  method: 'PUT',
  headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
})

export async function changePasswordFromLogin(email: string, currentPassword: string, newPassword: string) {
  const session = await login(email, currentPassword)
  try {
    return await changePassword(currentPassword, newPassword, session.token)
  } finally {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.token}` },
      })
    } catch {
      // The password change has already completed; an unreachable logout endpoint
      // should not make the user repeat the operation.
    }
  }
}

type AvatarUpdateResponse = Partial<UserInfo> & {
  user?: Partial<UserInfo>
  avatar?: string | null
  avatar_url?: string | null
}

export async function updateAvatar(avatar: string) {
  const payload = await request<AvatarUpdateResponse>('/api/auth/avatar', {
    method: 'PUT',
    body: JSON.stringify({ avatar }),
  })
  return payload.user ? { ...payload, ...payload.user } : payload
}

export async function checkApiHealth(timeout = 2500) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch('/api/health', {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) return false
    const payload = await response.json() as { status?: string }
    return payload.status === 'ok'
  } catch {
    return false
  } finally {
    window.clearTimeout(timeoutId)
  }
}

function getChatSessionStorageKey(taskId: string, userId: number) {
  return `${SESSION_KEY_PREFIX}${userId}.${taskId}`
}

function getStoredChatSession(taskId: string, userId: number) {
  const scopedKey = getChatSessionStorageKey(taskId, userId)
  const legacyKey = `${SESSION_KEY_PREFIX}${taskId}`
  return {
    scopedKey,
    legacyKey,
    sessionId: window.localStorage.getItem(scopedKey) ?? window.localStorage.getItem(legacyKey),
  }
}

export async function getChatHistory(taskId: string, userId: number) {
  const { scopedKey, legacyKey, sessionId } = getStoredChatSession(taskId, userId)
  if (!sessionId) return []
  try {
    const history = await request<{ session_id: string; messages: ChatHistoryMessage[] }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/history`,
    )
    window.localStorage.setItem(scopedKey, history.session_id)
    return history.messages
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      window.localStorage.removeItem(scopedKey)
      if (window.localStorage.getItem(legacyKey) === sessionId) window.localStorage.removeItem(legacyKey)
      return []
    }
    throw error
  }
}

export async function getTaskChatHistory(taskId: string, userId: number) {
  const sessionId = `task-${taskId}`
  try {
    const history = await request<{ session_id: string; messages: ChatHistoryMessage[] }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/history`,
    )
    return history.messages
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return []
    throw error
  }
}

export async function logout() {
  try { await request<{ status: string }>('/api/auth/logout', { method: 'POST' }) } finally { setToken(null) }
}

export const getCapabilities = () => request<CapabilityStatus>('/api/capabilities')
export async function assertResearchReady() {
  const capabilities = await getCapabilities()
  const missing = [
    !capabilities.llm && '主 LLM',
    !capabilities.web_search && '联网搜索',
    !capabilities.embedding && 'Embedding',
  ].filter(Boolean)
  if (missing.length > 0) {
    throw new ApiError(`真实研究还缺少可用能力：${missing.join('、')}。请先检查系统设置与服务端配置。`, 503)
  }
}

export type SessionStatus = {
  session_id: string
  running: boolean
  paused: boolean
  thread_id: string | null
  pending_question: AgentQuestion | null
}

export type SessionCompactResult = {
  status: 'compacted' | string
  session_id: string
  tokens_before: number
  tokens_after: number
}

export const listSessions = () => request<{ session_ids: string[] }>('/api/sessions')

export const getSessionStatus = (sessionId: string) => request<SessionStatus>(
  `/api/sessions/${encodeURIComponent(sessionId)}/status`,
)

export const compactSession = (sessionId: string) => request<SessionCompactResult>(
  `/api/sessions/${encodeURIComponent(sessionId)}/compact`, { method: 'POST' },
)

export const pauseSession = (sessionId: string) => request<{ status: string; session_id: string }>(
  `/api/sessions/${encodeURIComponent(sessionId)}/pause`, { method: 'POST' },
)

export const abortSession = (sessionId: string) => request<{ status: string; session_id: string }>(
  `/api/sessions/${encodeURIComponent(sessionId)}/abort`, { method: 'POST' },
)

export async function streamResumeSession(sessionId: string, onEvent: (event: StreamEvent) => void) {
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/resume`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken() ?? ''}` },
  })
  if (!response.ok) throw new ApiError(await parseError(response), response.status)
  if (!response.body) throw new ApiError('浏览器未返回恢复流', 500)
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
    if (done) return
  }
}
export const getSettings = () => request<SettingsResponse>('/api/settings')
export const saveContextCompactTrigger = (triggerPercent: number) => request<{
  status: string
  trigger_percent: number
  default_percent: number
}>('/api/settings/context-compact', {
  method: 'PUT',
  body: JSON.stringify({ trigger_percent: triggerPercent }),
})
export const saveLlmMode = (useResponseApi: boolean) => request<{
  status: string
  use_response_api: boolean
  mode: 'responses' | 'chat'
}>('/api/settings/llm-mode', {
  method: 'PUT',
  body: JSON.stringify({ use_response_api: useResponseApi }),
})
export const saveSearchEngine = (engine: 'tavily' | 'python' | 'response_api', apiKey?: string) => (
  request<{
    status: string
    search_engine: 'tavily' | 'python' | 'response_api'
    tavily_configured: boolean
    needs_key: boolean
  }>('/api/settings/search-engine', {
    method: 'PUT',
    body: JSON.stringify({ engine, api_key: apiKey?.trim() || null }),
  })
)
export const saveModelConfig = (slot: 'llm' | 'vision', config: { base_url: string; api_key: string; model_name: string; use_response_api?: boolean }) => (
  request<{ status: string; slot: string; config: ModelSlotConfig }>(`/api/settings/${slot}`, {
    method: 'PUT', body: JSON.stringify(config),
  })
)
export const getDataSources = () => request<{ data_sources: DataSourceConfig[] }>('/api/data-sources')
export const saveDataSources = (dataSources: DataSourceConfig[]) => (
  request<{ status: string; data_sources: DataSourceConfig[] }>('/api/data-sources', {
    method: 'PUT',
    body: JSON.stringify({
      data_sources: dataSources.map(({ updated_at: _updatedAt, ...source }) => source),
    }),
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

export type AgentDocumentUpload = {
  file_path: string
  filename: string
  size: number
}

export function uploadDocumentForAgent(file: File) {
  const body = new FormData()
  body.append('file', file)
  return request<AgentDocumentUpload>('/api/documents/upload', { method: 'POST', body })
}

export type TaskAttachmentUpload = {
  upload_id: string
  filename: string
  chars: number
}

export function uploadTaskAttachments(files: File[]) {
  const body = new FormData()
  files.forEach((file) => body.append('files', file))
  return request<{ uploads: TaskAttachmentUpload[] }>('/api/tasks/uploads', { method: 'POST', body })
}

const taskTypeLabels: Record<string, string> = {
  company: '企业研究',
  policy: '政策研究',
  risk: '风险线索',
}

function toWorkspaceTask(task: ApiTask): ResearchTaskSession {
  const displayProgress = rememberResearchProgress(task.id, task.createdAt, task.progress)
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
    phaseConfirmed: reportedPhase !== 'review',
    persisted: true,
  }
}

export async function listTasks() {
  const data = await request<ApiTask[]>('/api/tasks')
  const tasks = data.map(toWorkspaceTask)

  // 列表摘要只有 task.status，没有每条主张的 humanAction。对于已经跑完但仍被
  // 后端摘要标成 review 的任务，必须补读详情才能区分“仍待复核”和“实际已完成”。
  return Promise.all(tasks.map(async (task) => {
    const reopenedReviewIds = readReopenedReviewIds(task.id)
    const shouldReadReviewDetail = task.phase === 'review' || (task.phase === 'ready' && reopenedReviewIds.length > 0)
    if (!shouldReadReviewDetail || (task.progress ?? 0) < 100 || (task.claimCount ?? 0) === 0) return task
    try {
      const run = await getTask(task.id)
      const reviewClaimIds = run.claims
        .filter((claim) => claim.status !== 'verified' || Boolean(claim.humanAction))
        .map((claim) => claim.id)
      const backendReviewedClaimIds = run.claims
        .filter((claim) => Boolean(claim.humanAction) && !reopenedReviewIds.includes(claim.id))
        .map((claim) => claim.id)
      const reviewedClaimIds = getEffectiveReviewedClaimIds(task.id, reviewClaimIds, backendReviewedClaimIds)
      const phase = reopenedReviewIds.length > 0 ? 'review' : getResearchRunPhase(run)
      return {
        ...task,
        phase,
        phaseConfirmed: true,
        reviewClaimIds,
        reviewedClaimIds,
        selectedClaimId: reopenedReviewIds.find((claimId) => reviewClaimIds.includes(claimId))
          ?? reviewClaimIds.find((claimId) => !reviewedClaimIds.includes(claimId))
          ?? reviewClaimIds[0]
          ?? run.claims[0]?.id
          ?? '',
        progress: Math.max(task.progress ?? 0, run.progress),
        claimCount: run.claims.length,
        isDemoRunning: phase === 'running',
      }
    } catch {
      // 单条详情暂时不可用时仍展示任务列表；store 会保护已由详情确认的完成态。
      return task
    }
  }))
}

export const searchWorkspace = (query: string) => request<WorkspaceSearchResult>(
  `/api/tasks/search?q=${encodeURIComponent(query.trim())}`,
)

export async function createTask(input: { topic: string; title?: string; company?: string; researchType?: string; preferredSources?: string[]; attachmentIds?: string[] }) {
  const task = await request<ApiTask>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      topic: input.topic,
      title: input.title,
      company: input.company ?? '',
      research_type: input.researchType,
      preferred_sources: input.preferredSources ?? [],
      attachment_ids: input.attachmentIds ?? [],
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
  if (run.id !== taskId) {
    throw new ApiError(`任务详情返回了错误的任务编号：请求 ${taskId}，实际收到 ${run.id}`, 409)
  }
  return { ...run, progress: rememberResearchProgress(taskId, run.createdAt, run.progress) }
}
export const stopTask = (taskId: string) => request<{ status: string; task_id: string }>(`/api/tasks/${taskId}/stop`, { method: 'POST' })
export const guideTask = (taskId: string, instruction: string) => request<{ status: string; task_id: string }>(
  `/api/tasks/${taskId}/guidance`, {
    method: 'POST',
    body: JSON.stringify({ instruction }),
  },
)
export const getTaskQuestions = (taskId: string) => request<{ task_id: string; questions: AgentQuestion[] }>(
  `/api/tasks/${encodeURIComponent(taskId)}/questions`,
)

export const answerTaskQuestion = (taskId: string, questionId: string, answer: string) => (
  request<{ status: string; question_id: string; answer: string }>(
    `/api/tasks/${encodeURIComponent(taskId)}/questions/${encodeURIComponent(questionId)}/answer`, {
      method: 'POST',
      body: JSON.stringify({ answer }),
    },
  )
)

export const getSessionQuestions = (sessionId: string) => request<{ session_id: string; questions: AgentQuestion[] }>(
  `/api/sessions/${encodeURIComponent(sessionId)}/questions`,
)

export const answerSessionQuestion = (sessionId: string, questionId: string, answer: string) => (
  request<{ status: string; question_id: string; answer: string }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/questions/${encodeURIComponent(questionId)}/answer`, {
      method: 'POST',
      body: JSON.stringify({ answer }),
    },
  )
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

export type ReportExportFormat = 'pdf' | 'docx'

function getDownloadFilename(contentDisposition: string | null, fallback: string) {
  if (!contentDisposition) return fallback
  const encodedFilename = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  if (encodedFilename) {
    try {
      return decodeURIComponent(encodedFilename.trim())
    } catch {
      // Fall through to the regular filename parameter.
    }
  }
  return contentDisposition.match(/filename="([^"]+)"/i)?.[1]
    ?? contentDisposition.match(/filename=([^;]+)/i)?.[1]?.trim()
    ?? fallback
}

export async function exportReport(taskId: string, format: ReportExportFormat) {
  const headers = new Headers()
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(
    `/api/tasks/${encodeURIComponent(taskId)}/report?format=${encodeURIComponent(format)}`,
    { headers },
  )
  if (!response.ok) {
    const detail = await parseError(response)
    const label = format === 'pdf' ? 'PDF' : 'Word'
    throw new ApiError(
      response.status >= 500 ? `后端生成 ${label} 失败（${detail}），未创建本地文件` : detail,
      response.status,
    )
  }
  const blob = await response.blob()
  if (blob.size === 0) throw new ApiError('后端返回了空文件，导出已取消', 502)

  const signature = new Uint8Array(await blob.slice(0, 5).arrayBuffer())
  const isPdf = signature[0] === 0x25
    && signature[1] === 0x50
    && signature[2] === 0x44
    && signature[3] === 0x46
    && signature[4] === 0x2d
  const isDocx = signature[0] === 0x50
    && signature[1] === 0x4b
    && signature[2] === 0x03
    && signature[3] === 0x04
  if ((format === 'pdf' && !isPdf) || (format === 'docx' && !isDocx)) {
    throw new ApiError(`后端返回的 ${format === 'pdf' ? 'PDF' : 'Word'} 文件格式无效，导出已取消`, 502)
  }

  return {
    blob,
    filename: getDownloadFilename(response.headers.get('Content-Disposition'), `${taskId}.${format}`),
  }
}

export type AuditEvent = {
  id: number
  task_id: string
  seq: number
  actor: string
  kind: string
  payload: {
    title?: string
    speech?: string
    details?: Array<{ label: string; text: string }>
    metrics?: Array<{ label: string; value: string }>
    tone?: string | null
    progress?: number | null
  }
  ts: string
}

export type AgentExecution = {
  task_id: string
  agent: string
  agent_label: string
  task_status: string
  progress: number
  inputs: Record<string, unknown>
  timeline: AuditEvent[]
  tool_calls: Array<{
    task_id?: string
    actor?: string
    node?: string
    seq?: number
    tool?: string
    args?: Record<string, unknown>
    result?: string
    created_at?: string
    ts?: string
    [key: string]: unknown
  }>
  artifacts: Record<string, unknown>
  errors: Array<Record<string, unknown>>
}

export type FlowError = {
  id: number
  flowType: string
  flowId: string
  node: string
  error: string
  attempts: number
  autoRepair: boolean
  repairCount: number
  status: 'failed' | 'repairing' | 'repaired' | 'repair_failed' | string
  createdAt: string
  updatedAt: string
  repairedAt?: string | null
}

export type FlowErrorDetail = FlowError & {
  prompt: string
  traceback: string
}

export const listFlowErrors = (options: { flowType?: string; flowId?: string; status?: string } = {}) => {
  const query = new URLSearchParams()
  if (options.flowType) query.set('flow_type', options.flowType)
  if (options.flowId) query.set('flow_id', options.flowId)
  if (options.status) query.set('status', options.status)
  const suffix = query.toString() ? `?${query.toString()}` : ''
  return request<{ total: number; errors: FlowError[] }>(`/api/errors${suffix}`)
}

export const getFlowError = (errorId: number) => request<FlowErrorDetail>(`/api/errors/${errorId}`)

export const repairFlowError = (errorId: number) => request<{
  status: string
  error_id: number
  flow_type: string
  flow_id: string
}>(`/api/errors/${errorId}/repair`, { method: 'POST' })

export const markFlowErrorRepaired = (errorId: number, note = '') => request<{
  status: string
  error_id: number
}>(`/api/errors/${errorId}/mark-repaired`, {
  method: 'POST',
  body: JSON.stringify({ note }),
})

export type TaskAgentSummary = {
  id: string
  label: string
  event_count: number
  tool_call_count: number
}

export const getAuditLog = (taskId: string) => request<{ task_id: string; events: AuditEvent[]; resolutions: unknown[] }>(`/api/tasks/${taskId}/audit-log`)

export const getTaskAgents = (taskId: string) => request<{ task_id: string; agents: TaskAgentSummary[] }>(`/api/tasks/${taskId}/agents`)

export const getAgentExecution = (taskId: string, agent: string) => request<AgentExecution>(
  `/api/tasks/${taskId}/agents/${encodeURIComponent(agent)}`,
)

export const startHistoryAnalysis = (taskId: string, options?: HistoryAnalysisRequest) => request<{ status: string; task_id: string }>(
  `/api/tasks/${taskId}/history-analysis`, {
    method: 'POST',
    ...(options ? { body: JSON.stringify(options) } : {}),
  },
)

export async function getHistoryAnalysis(taskId: string) {
  try {
    return await request<HistoryAnalysis>(`/api/tasks/${taskId}/history-analysis`)
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

export const attachHistoryAnalysis = (taskId: string) => request<{ status: string; task_id: string }>(
  `/api/tasks/${taskId}/history-analysis/attach`, { method: 'POST' },
)

export async function streamTaskEvents(
  taskId: string,
  createdAt: string,
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
        if (event.payload.progress != null) {
          rememberResearchProgress(taskId, createdAt, event.payload.progress)
        }
        onEvent(event)
      }
    }
    if (done) return
  }
}

export async function streamChat(
  message: string,
  taskId: string,
  userId: number,
  onEvent: (event: StreamEvent) => void,
) {
  const { scopedKey: sessionKey, legacyKey, sessionId: savedSessionId } = getStoredChatSession(taskId, userId)
  // The backend identifies three-way data retrieval sessions by this prefix and
  // removes ask_user from their toolset. Send the scoped id itself instead of a
  // server-generated chat id, including on the first search.
  const fixedSessionId = taskId.startsWith('database-') ? taskId : null
  let storedSession = fixedSessionId ?? savedSessionId
  const send = (sessionId: string | null) => fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken() ?? ''}` },
      body: JSON.stringify({ message, session_id: sessionId }),
    })
  let response = await send(storedSession)
  if (response.status === 404 && storedSession && !fixedSessionId) {
    window.localStorage.removeItem(sessionKey)
    if (window.localStorage.getItem(legacyKey) === storedSession) window.localStorage.removeItem(legacyKey)
    storedSession = null
    response = await send(null)
  }
  if (!response.ok) throw new ApiError(await parseError(response), response.status)
  const responseSessionId = response.headers.get('X-Session-Id')
  if (responseSessionId) window.localStorage.setItem(sessionKey, responseSessionId)
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

export async function streamTaskChat(
  message: string,
  taskId: string,
  userId: number,
  claimId: string | undefined,
  onEvent: (event: StreamEvent) => void,
) {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken() ?? ''}` },
    body: JSON.stringify({ message, claim_id: claimId ?? null }),
  })
  if (!response.ok) throw new ApiError(await parseError(response), response.status)
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
