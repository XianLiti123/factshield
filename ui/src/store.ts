import { create } from 'zustand'

type ViewName = 'tasks' | 'workbench' | 'topology' | 'analytics' | 'reports'

interface WorkspaceStore {
  activeView: ViewName
  selectedClaimId: string
  demoStep: number
  isDemoRunning: boolean
  setActiveView: (view: ViewName) => void
  selectClaim: (id: string) => void
  startDemo: () => void
  advanceDemo: () => void
  stopDemo: () => void
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  activeView: 'workbench',
  selectedClaimId: 'claim-3',
  demoStep: 8,
  isDemoRunning: false,
  setActiveView: (activeView) => set({ activeView }),
  selectClaim: (selectedClaimId) => set({ selectedClaimId }),
  startDemo: () => set({ demoStep: 0, isDemoRunning: true }),
  advanceDemo: () => set((state) => ({ demoStep: Math.min(state.demoStep + 1, 8) })),
  stopDemo: () => set({ isDemoRunning: false }),
}))
