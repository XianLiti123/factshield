import { create } from 'zustand'
import type { ResearchRun } from './types'

export type ViewName = 'tasks' | 'workbench' | 'topology' | 'analytics' | 'reports' | 'settings'
export type TaskPhase = 'draft' | 'running' | 'review' | 'ready' | 'stopped' | 'failed'

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
  persisted?: boolean
  isDemo?: boolean
}

interface CreateTaskInput {
  title: string
  company?: string
  category?: string
}

interface WorkspaceStore {
  activeView: ViewName
  activeTaskId: string
  tasks: ResearchTaskSession[]
  setActiveView: (view: ViewName) => void
  selectTask: (id: string) => void
  createTask: (input: CreateTaskInput) => string
  selectClaim: (id: string) => void
  finishResearch: (firstPendingClaimId?: string) => void
  resolveClaim: (claimId: string, nextClaimId?: string) => void
  openReviewQueue: (claimId?: string, taskId?: string) => void
  advanceRunningTasks: () => void
  stopDemo: () => void
  resumeDemo: () => void
  toggleTaskRunning: (taskId: string) => void
  deleteTask: (taskId: string) => void
  hydrateTasks: (tasks: ResearchTaskSession[], preserveLocalDemos?: boolean) => void
  addTask: (task: ResearchTaskSession) => void
  syncTaskRun: (run: ResearchRun) => void
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
  tasks: initialTasks,
  setActiveView: (activeView) => set({ activeView }),
  selectTask: (activeTaskId) => set({ activeTaskId }),
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
  openReviewQueue: (claimId, taskId) => set((state) => {
    const activeTaskId = taskId ?? state.activeTaskId
    return {
      activeTaskId,
      activeView: 'workbench',
      tasks: updateTask(state.tasks, activeTaskId, (task) => ({
        ...task,
        selectedClaimId: claimId ?? task.reviewClaimIds.find((id) => !task.reviewedClaimIds.includes(id)) ?? task.selectedClaimId,
      })),
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
    return {
      tasks,
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

      const merged = {
        ...task,
        selectedClaimId: current.selectedClaimId,
        reviewClaimIds: current.reviewClaimIds,
        reviewedClaimIds: current.reviewedClaimIds,
      }

      // 当前详情由 GET /tasks/:id 的完整快照驱动。任务列表只有摘要，不能在两次
      // 详情轮询之间抢先覆盖 phase，否则会把“运行中的空主张快照”误画成复核空页。
      if (task.id === state.activeTaskId && current.persisted) {
        return {
          ...merged,
          phase: current.phase,
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
      const reviewClaimIds = run.claims
        .filter((claim) => claim.status !== 'verified')
        .map((claim) => claim.id)
      const reviewedClaimIds = run.claims
        .filter((claim) => Boolean(claim.humanAction))
        .map((claim) => claim.id)
      const reportedPhase: TaskPhase = run.status === 'running' || run.status === 'review' || run.status === 'ready'
        || run.status === 'stopped' || run.status === 'failed'
        ? run.status
        : task.phase
      const phase: TaskPhase = (reportedPhase === 'review' || reportedPhase === 'ready')
        && (run.progress < 100 || run.claims.length === 0)
        ? 'running'
        : reportedPhase
      return {
        ...task,
        phase,
        progress: Math.max(task.progress ?? 0, run.progress),
        claimCount: run.claims.length,
        reviewClaimIds,
        reviewedClaimIds,
        selectedClaimId: run.claims.some((claim) => claim.id === task.selectedClaimId)
          ? task.selectedClaimId
          : (reviewClaimIds[0] ?? run.claims[0]?.id ?? ''),
        isDemoRunning: phase === 'running',
      }
    }),
  })),
}))

export const getActiveTask = (state: WorkspaceStore) => (
  state.tasks.find((task) => task.id === state.activeTaskId) ?? state.tasks[0] ?? emptyTask
)

export const getTaskProgress = (task: ResearchTaskSession) => {
  if (task.persisted && typeof task.progress === 'number') return Math.round(task.progress)
  if (task.phase === 'ready' || task.phase === 'review') return 100
  return Math.round((task.demoStep / 8) * 100)
}
