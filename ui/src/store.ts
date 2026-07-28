import { create } from 'zustand'

export type ViewName = 'tasks' | 'workbench' | 'topology' | 'analytics' | 'reports' | 'settings'
export type TaskPhase = 'draft' | 'running' | 'review' | 'ready'

interface WorkspaceStore {
  activeView: ViewName
  taskPhase: TaskPhase
  researchTopic: string
  selectedClaimId: string
  reviewedClaimIds: string[]
  demoStep: number
  isDemoRunning: boolean
  setActiveView: (view: ViewName) => void
  selectClaim: (id: string) => void
  startResearch: (topic: string) => void
  finishResearch: (firstPendingClaimId?: string) => void
  resolveClaim: (claimId: string, nextClaimId?: string) => void
  openReviewQueue: (claimId?: string) => void
  advanceDemo: () => void
  stopDemo: () => void
  resumeDemo: () => void
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  activeView: 'tasks',
  taskPhase: 'draft',
  researchTopic: '',
  selectedClaimId: 'claim-3',
  reviewedClaimIds: [],
  demoStep: 8,
  isDemoRunning: false,
  setActiveView: (activeView) => set({ activeView }),
  selectClaim: (selectedClaimId) => set({ selectedClaimId }),
  startResearch: (researchTopic) => set({
    activeView: 'workbench',
    taskPhase: 'running',
    researchTopic,
    selectedClaimId: 'claim-3',
    reviewedClaimIds: [],
    demoStep: 0,
    isDemoRunning: true,
  }),
  finishResearch: (selectedClaimId = 'claim-3') => set({
    activeView: 'workbench',
    taskPhase: 'review',
    selectedClaimId,
    reviewedClaimIds: [],
    demoStep: 8,
    isDemoRunning: false,
  }),
  resolveClaim: (claimId, nextClaimId) => set((state) => ({
    reviewedClaimIds: state.reviewedClaimIds.includes(claimId)
      ? state.reviewedClaimIds
      : [...state.reviewedClaimIds, claimId],
    selectedClaimId: nextClaimId ?? claimId,
    taskPhase: nextClaimId ? 'review' : 'ready',
  })),
  openReviewQueue: (selectedClaimId = 'claim-3') => set({
    activeView: 'workbench',
    taskPhase: 'review',
    selectedClaimId,
    isDemoRunning: false,
  }),
  advanceDemo: () => set((state) => ({ demoStep: Math.min(state.demoStep + 1, 8) })),
  stopDemo: () => set({ isDemoRunning: false }),
  resumeDemo: () => set({ isDemoRunning: true }),
}))
