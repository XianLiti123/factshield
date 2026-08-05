import { create } from 'zustand'
import type { AgentQuestion, ResearchRun } from './types'
import { getEffectiveReviewedClaimIds, readReopenedReviewIds } from './utils/reviewDrafts'

export type ViewName = 'tasks' | 'workbench' | 'topology' | 'analytics' | 'reports' | 'database' | 'settings'
export type TaskPhase = 'draft' | 'running' | 'review' | 'ready' | 'stopped' | 'failed'

export function getResearchRunPhase(run: ResearchRun): TaskPhase {
  const supportedPhases: TaskPhase[] = ['running', 'review', 'ready', 'stopped', 'failed']
  const reportedPhase = supportedPhases.includes(run.status as TaskPhase)
    ? run.status as TaskPhase
    : 'draft'
  if ((reportedPhase === 'review' || reportedPhase === 'ready')
    && (run.progress < 100 || run.claims.length === 0)) return 'running'
  if (readReopenedReviewIds(run.id).length > 0) return 'review'
  if (reportedPhase === 'review') {
    const hasUnresolvedIssue = run.claims.some((claim) => claim.status !== 'verified' && !claim.humanAction)
    if (!hasUnresolvedIssue) return 'ready'
  }
  return reportedPhase
}

export interface ResearchTaskSession {
  id: string
  title: string
  company: string
  category: string
  phase: TaskPhase
  researchTopic: string
  selectedClaimId: string
  reviewClaimIds: string[]
  reviewedClaimIds: string[]
  demoStep: number
  isDemoRunning: boolean
  createdAt: string
  updatedAt: string
  progress?: number
  claimCount?: number
  phaseConfirmed?: boolean
  persisted?: boolean
  isDemo?: boolean
  waitingQuestion?: AgentQuestion | null
}

export type SearchFocus = {
  taskId: string
  claimId?: string
  evidenceId?: string
}

export type HistoryAnalysisJob = {
  taskId: string
  baselineAnalysisId: number | null
  startedAt: number
  config: HistoryAnalysisConfig
}

export type HistoryAnalysisFrequency = 'auto' | 'monthly' | 'quarterly' | 'yearly'

export type HistoryAnalysisConfig = {
  metric: string
  scenarios: string
  start: string
  end: string
  frequency: HistoryAnalysisFrequency
}

export const EMPTY_HISTORY_ANALYSIS_CONFIG: HistoryAnalysisConfig = {
  metric: '',
  scenarios: '',
  start: '',
  end: '',
  frequency: 'auto',
}

const HISTORY_ANALYSIS_CONFIGS_KEY = 'factshield.history-analysis.configs'

function loadHistoryAnalysisConfigs(): Record<string, HistoryAnalysisConfig> {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(HISTORY_ANALYSIS_CONFIGS_KEY) ?? '{}') as Record<string, Partial<HistoryAnalysisConfig>>
    return Object.fromEntries(Object.entries(parsed).map(([taskId, config]) => [taskId, {
      metric: typeof config.metric === 'string' ? config.metric : '',
      scenarios: typeof config.scenarios === 'string' ? config.scenarios : '',
      start: typeof config.start === 'string' ? config.start : '',
      end: typeof config.end === 'string' ? config.end : '',
      frequency: ['auto', 'monthly', 'quarterly', 'yearly'].includes(config.frequency ?? '')
        ? config.frequency as HistoryAnalysisFrequency
        : 'auto',
    }]))
  } catch {
    return {}
  }
}

function persistHistoryAnalysisConfigs(configs: Record<string, HistoryAnalysisConfig>) {
  try {
    window.localStorage.setItem(HISTORY_ANALYSIS_CONFIGS_KEY, JSON.stringify(configs))
  } catch {
    // Storage may be unavailable; the in-memory configuration still survives page navigation.
  }
}

interface CreateTaskInput {
  title: string
  company?: string
  category?: string
}

interface WorkspaceStore {
  activeView: ViewName
  activeTaskId: string
  searchFocus: SearchFocus | null
  historyAnalysisJobs: Record<string, HistoryAnalysisJob>
  historyAnalysisConfigs: Record<string, HistoryAnalysisConfig>
  tasks: ResearchTaskSession[]
  setActiveView: (view: ViewName) => void
  selectTask: (id: string) => void
  createTask: (input: CreateTaskInput) => string
  selectClaim: (id: string) => void
  finishResearch: (firstPendingClaimId?: string) => void
  resolveClaim: (claimId: string, nextClaimId?: string) => void
  setReviewClaimDrafted: (taskId: string, claimId: string, reviewed: boolean) => void
  openReviewQueue: (claimId?: string, taskId?: string) => void
  openSearchResult: (focus: SearchFocus) => void
  advanceRunningTasks: () => void
  stopDemo: () => void
  resumeDemo: () => void
  toggleTaskRunning: (taskId: string) => void
  deleteTask: (taskId: string) => void
  hydrateTasks: (tasks: ResearchTaskSession[], preserveLocalDemos?: boolean) => void
  addTask: (task: ResearchTaskSession) => void
  syncTaskRun: (run: ResearchRun) => void
  setHistoryAnalysisConfig: (taskId: string, config: HistoryAnalysisConfig) => void
  resetHistoryAnalysisConfig: (taskId: string) => void
  startHistoryAnalysisJob: (taskId: string, baselineAnalysisId: number | null, config: HistoryAnalysisConfig) => void
  finishHistoryAnalysisJob: (taskId: string) => void
}

const initialTasks: ResearchTaskSession[] = [
  {
    id: 'FS-2026-0729-031',
    title: '比亚迪 2025 年海外销量与巴西产能核验',
    company: '比亚迪 · 002594.SZ',
    category: '企业研究',
    phase: 'running',
    researchTopic: '核验比亚迪 2025 年海外销量、盈利质量与巴西产能进度',
    selectedClaimId: 'claim-3',
    reviewClaimIds: ['claim-3', 'claim-4'],
    reviewedClaimIds: [],
    demoStep: 1,
    isDemoRunning: true,
    createdAt: '2026-07-29 09:18',
    updatedAt: '刚刚',
  },
  {
    id: 'FS-2026-0729-029',
    title: '贵州茅台批价走势与渠道库存核验',
    company: '贵州茅台 · 600519.SH',
    category: '企业研究',
    phase: 'running',
    researchTopic: '核验贵州茅台批价走势、渠道库存与回款质量',
    selectedClaimId: 'claim-3',
    reviewClaimIds: ['claim-3', 'claim-4'],
    reviewedClaimIds: [],
    demoStep: 3,
    isDemoRunning: true,
    createdAt: '2026-07-29 08:46',
    updatedAt: '1 分钟前',
  },
  {
    id: 'FS-2026-0726-018',
    title: '宁德时代 2025 年经营质量与海外增长核验',
    company: '宁德时代 · 300750.SZ',
    category: '企业研究',
    phase: 'review',
    researchTopic: '核验宁德时代 2025 年经营质量、海外增长与关键风险',
    selectedClaimId: 'claim-3',
    reviewClaimIds: ['claim-3', 'claim-4'],
    reviewedClaimIds: [],
    demoStep: 8,
    isDemoRunning: false,
    createdAt: '2026-07-26 14:32',
    updatedAt: '今天 10:12',
  },
  {
    id: 'FS-2026-0725-011',
    title: '新能源汽车产业链政策调整事实核验',
    company: '新能源汽车产业链',
    category: '政策研究',
    phase: 'ready',
    researchTopic: '核验新能源汽车产业链近期政策调整及适用范围',
    selectedClaimId: 'claim-4',
    reviewClaimIds: ['claim-3', 'claim-4'],
    reviewedClaimIds: ['claim-3', 'claim-4'],
    demoStep: 8,
    isDemoRunning: false,
    createdAt: '2026-07-25 16:08',
    updatedAt: '昨天 17:40',
  },
]

const emptyTask: ResearchTaskSession = {
  id: '',
  title: '尚未创建研究任务',
  company: '待选择研究对象',
  category: '研究任务',
  phase: 'draft',
  researchTopic: '',
  selectedClaimId: 'claim-1',
  reviewClaimIds: [],
  reviewedClaimIds: [],
  demoStep: 0,
  isDemoRunning: false,
  createdAt: '',
  updatedAt: '',
  persisted: false,
}

const updateTask = (
  tasks: ResearchTaskSession[],
  taskId: string,
  updater: (task: ResearchTaskSession) => ResearchTaskSession,
) => tasks.map((task) => task.id === taskId ? updater(task) : task)

const makeTaskId = () => `FS-2026-${String(Date.now()).slice(-6)}`

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  activeView: 'tasks',
  activeTaskId: 'FS-2026-0726-018',
  searchFocus: null,
  historyAnalysisJobs: {},
  historyAnalysisConfigs: loadHistoryAnalysisConfigs(),
  tasks: initialTasks,
  setActiveView: (activeView) => set({ activeView, searchFocus: null }),
  selectTask: (activeTaskId) => set({ activeTaskId, searchFocus: null }),
  createTask: ({ title, company = '待识别研究对象', category = '企业研究' }) => {
    const id = makeTaskId()
    const now = new Date().toLocaleString('zh-CN', { hour12: false })
    const task: ResearchTaskSession = {
      id,
      title,
      company,
      category,
      phase: 'running',
      researchTopic: title,
      selectedClaimId: 'claim-3',
      reviewClaimIds: ['claim-3', 'claim-4'],
      reviewedClaimIds: [],
      demoStep: 0,
      isDemoRunning: true,
      createdAt: now,
      updatedAt: '刚刚',
      persisted: false,
      isDemo: true,
    }
    set((state) => ({ tasks: [task, ...state.tasks], activeTaskId: id, activeView: 'workbench' }))
    return id
  },
  selectClaim: (selectedClaimId) => set((state) => ({
    searchFocus: null,
    tasks: updateTask(state.tasks, state.activeTaskId, (task) => ({ ...task, selectedClaimId })),
  })),
  finishResearch: (selectedClaimId) => set((state) => ({
    tasks: updateTask(state.tasks, state.activeTaskId, (task) => ({
      ...task,
      phase: 'review',
      selectedClaimId: selectedClaimId ?? task.reviewClaimIds[0] ?? task.selectedClaimId,
      demoStep: 8,
      isDemoRunning: false,
      updatedAt: '刚刚',
    })),
    activeView: 'workbench',
  })),
  resolveClaim: (claimId, nextClaimId) => set((state) => ({
    tasks: updateTask(state.tasks, state.activeTaskId, (task) => {
      const reviewedClaimIds = task.reviewedClaimIds.includes(claimId)
        ? task.reviewedClaimIds
        : [...task.reviewedClaimIds, claimId]
      const unresolvedClaimIds = task.reviewClaimIds.filter((id) => !reviewedClaimIds.includes(id))
      return {
        ...task,
        reviewedClaimIds,
        selectedClaimId: nextClaimId ?? unresolvedClaimIds[0] ?? claimId,
        phase: unresolvedClaimIds.length > 0 ? 'review' : 'ready',
        updatedAt: '刚刚',
      }
    }),
  })),
  setReviewClaimDrafted: (taskId, claimId, reviewed) => set((state) => ({
    tasks: updateTask(state.tasks, taskId, (task) => ({
      ...task,
      reviewedClaimIds: reviewed
        ? task.reviewedClaimIds.includes(claimId)
          ? task.reviewedClaimIds
          : [...task.reviewedClaimIds, claimId]
        : task.reviewedClaimIds.filter((id) => id !== claimId),
      phase: !reviewed && task.phase === 'ready' ? 'review' : task.phase,
      updatedAt: '刚刚',
    })),
  })),
  openReviewQueue: (claimId, taskId) => set((state) => {
    const activeTaskId = taskId ?? state.activeTaskId
    return {
      activeTaskId,
      activeView: 'workbench',
      searchFocus: null,
      tasks: updateTask(state.tasks, activeTaskId, (task) => ({
        ...task,
        selectedClaimId: claimId ?? task.reviewClaimIds.find((id) => !task.reviewedClaimIds.includes(id)) ?? task.selectedClaimId,
      })),
    }
  }),
  openSearchResult: (focus) => set((state) => {
    const task = state.tasks.find((item) => item.id === focus.taskId)
    const hasContentTarget = Boolean(focus.claimId || focus.evidenceId)
    return {
      activeTaskId: focus.taskId,
      activeView: hasContentTarget ? 'workbench' : task?.phase === 'ready' ? 'reports' : 'workbench',
      searchFocus: hasContentTarget ? focus : null,
      tasks: focus.claimId
        ? updateTask(state.tasks, focus.taskId, (item) => ({ ...item, selectedClaimId: focus.claimId! }))
        : state.tasks,
    }
  }),
  advanceRunningTasks: () => set((state) => ({
    tasks: state.tasks.map((task) => {
      if (task.phase !== 'running' || !task.isDemoRunning) return task
      const demoStep = Math.min(task.demoStep + 1, 8)
      if (demoStep >= 8) {
        return {
          ...task,
          demoStep,
          phase: 'review',
          selectedClaimId: task.reviewClaimIds[0] ?? task.selectedClaimId,
          isDemoRunning: false,
          updatedAt: '刚刚',
        }
      }
      return { ...task, demoStep, updatedAt: '刚刚' }
    }),
  })),
  stopDemo: () => set((state) => ({
    tasks: updateTask(state.tasks, state.activeTaskId, (task) => ({ ...task, isDemoRunning: false, updatedAt: '刚刚' })),
  })),
  resumeDemo: () => set((state) => ({
    tasks: updateTask(state.tasks, state.activeTaskId, (task) => ({ ...task, phase: 'running', isDemoRunning: true, updatedAt: '刚刚' })),
  })),
  toggleTaskRunning: (taskId) => set((state) => ({
    tasks: updateTask(state.tasks, taskId, (task) => task.phase === 'running'
      ? { ...task, isDemoRunning: !task.isDemoRunning, updatedAt: '刚刚' }
      : task),
  })),
  deleteTask: (taskId) => set((state) => {
    const tasks = state.tasks.filter((task) => task.id !== taskId)
    const { [taskId]: _removedAnalysisJob, ...historyAnalysisJobs } = state.historyAnalysisJobs
    const { [taskId]: _removedAnalysisConfig, ...historyAnalysisConfigs } = state.historyAnalysisConfigs
    persistHistoryAnalysisConfigs(historyAnalysisConfigs)
    return {
      tasks,
      historyAnalysisJobs,
      historyAnalysisConfigs,
      activeTaskId: state.activeTaskId === taskId ? (tasks[0]?.id ?? '') : state.activeTaskId,
      activeView: state.activeTaskId === taskId ? 'tasks' : state.activeView,
    }
  }),
  hydrateTasks: (tasks, preserveLocalDemos = false) => set((state) => {
    const localDemos = preserveLocalDemos
      ? state.tasks.filter((task) => task.isDemo && !task.persisted)
      : []
    const mergedTasks = tasks.map((task) => {
      const current = state.tasks.find((item) => item.id === task.id)
      if (!current) return task

      const incomingHasClaimDetail = Boolean(task.phaseConfirmed)
      const preserveConfirmedReady = current.phase === 'ready'
        && Boolean(current.phaseConfirmed)
        && task.phase === 'review'
        && !incomingHasClaimDetail

      const merged: ResearchTaskSession = {
        ...task,
        selectedClaimId: current.selectedClaimId,
        reviewClaimIds: incomingHasClaimDetail ? task.reviewClaimIds : current.reviewClaimIds,
        reviewedClaimIds: incomingHasClaimDetail ? task.reviewedClaimIds : current.reviewedClaimIds,
        waitingQuestion: task.waitingQuestion === undefined ? current.waitingQuestion : task.waitingQuestion,
      }

      // GET /tasks 只有任务摘要，无法判断 review 中的疑点是否已经全部人工处理。
      // 一旦完整主张快照确认任务已完成，后续旧摘要不得把终态降回“待复核”。
      if (preserveConfirmedReady) {
        return {
          ...merged,
          phase: 'ready' as TaskPhase,
          phaseConfirmed: true,
          progress: Math.max(current.progress ?? 0, task.progress ?? 0),
          claimCount: current.claimCount ?? task.claimCount,
          isDemoRunning: false,
        }
      }

      // 当前详情由 GET /tasks/:id 的完整快照驱动。任务列表只有摘要，不能在两次
      // 详情轮询之间抢先覆盖 phase，否则会把“运行中的空主张快照”误画成复核空页。
      if (task.id === state.activeTaskId && current.persisted && !incomingHasClaimDetail) {
        return {
          ...merged,
          phase: current.phase,
          phaseConfirmed: current.phaseConfirmed,
          progress: current.progress,
          claimCount: current.claimCount,
          isDemoRunning: current.phase === 'running',
        }
      }
      return merged
    })
    const hydratedTasks = [
      ...localDemos,
      ...mergedTasks.filter((task) => !localDemos.some((demo) => demo.id === task.id)),
    ]
    return {
      tasks: hydratedTasks,
      activeTaskId: hydratedTasks.some((task) => task.id === state.activeTaskId) ? state.activeTaskId : (hydratedTasks[0]?.id ?? ''),
      activeView: hydratedTasks.length > 0 ? state.activeView : 'tasks',
    }
  }),
  addTask: (task) => set((state) => ({
    tasks: [task, ...state.tasks.filter((item) => item.id !== task.id)],
    activeTaskId: task.id,
    activeView: 'tasks',
  })),
  syncTaskRun: (run) => set((state) => ({
    tasks: updateTask(state.tasks, run.id, (task) => {
      const reopenedReviewIds = readReopenedReviewIds(run.id)
      const reviewClaimIds = run.claims
        .filter((claim) => claim.status !== 'verified' || Boolean(claim.humanAction))
        .map((claim) => claim.id)
      const backendReviewedClaimIds = run.claims
        .filter((claim) => Boolean(claim.humanAction) && !reopenedReviewIds.includes(claim.id))
        .map((claim) => claim.id)
      const reviewedClaimIds = getEffectiveReviewedClaimIds(run.id, reviewClaimIds, backendReviewedClaimIds)
      const phase = getResearchRunPhase(run)
      return {
        ...task,
        phase,
        phaseConfirmed: true,
        progress: Math.max(task.progress ?? 0, run.progress),
        claimCount: run.claims.length,
        reviewClaimIds,
        reviewedClaimIds,
        waitingQuestion: run.waitingQuestion ?? null,
        selectedClaimId: reopenedReviewIds.find((claimId) => reviewClaimIds.includes(claimId))
          ?? (run.claims.some((claim) => claim.id === task.selectedClaimId)
          ? task.selectedClaimId
          : (reviewClaimIds[0] ?? run.claims[0]?.id ?? '')),
        isDemoRunning: phase === 'running',
      }
    }),
  })),
  setHistoryAnalysisConfig: (taskId, config) => set((state) => {
    const historyAnalysisConfigs = { ...state.historyAnalysisConfigs, [taskId]: config }
    persistHistoryAnalysisConfigs(historyAnalysisConfigs)
    return { historyAnalysisConfigs }
  }),
  resetHistoryAnalysisConfig: (taskId) => set((state) => {
    const { [taskId]: _removedAnalysisConfig, ...historyAnalysisConfigs } = state.historyAnalysisConfigs
    persistHistoryAnalysisConfigs(historyAnalysisConfigs)
    return { historyAnalysisConfigs }
  }),
  startHistoryAnalysisJob: (taskId, baselineAnalysisId, config) => set((state) => ({
    historyAnalysisJobs: {
      ...state.historyAnalysisJobs,
      [taskId]: { taskId, baselineAnalysisId, startedAt: Date.now(), config },
    },
  })),
  finishHistoryAnalysisJob: (taskId) => set((state) => {
    const { [taskId]: _finishedAnalysisJob, ...historyAnalysisJobs } = state.historyAnalysisJobs
    return { historyAnalysisJobs }
  }),
}))

export const getActiveTask = (state: WorkspaceStore) => (
  state.tasks.find((task) => task.id === state.activeTaskId) ?? state.tasks[0] ?? emptyTask
)

export const getTaskProgress = (task: ResearchTaskSession) => {
  if (task.persisted && typeof task.progress === 'number') return Math.round(task.progress)
  if (task.phase === 'ready' || task.phase === 'review') return 100
  return Math.round((task.demoStep / 8) * 100)
}
