import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, Result, Skeleton } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { AppShell } from './components/AppShell'
import { ResearchHeader } from './components/ResearchHeader'
import { Workbench } from './components/Workbench'
import { AgentTopology } from './components/AgentTopology'
import { AnalyticsView } from './components/AnalyticsView'
import { ReportsView } from './components/ReportsView'
import { TaskCenter } from './components/TaskCenter'
import { LoginView } from './components/LoginView'
import { SupervisorAssistant } from './components/SupervisorAssistant'
import { getResearchRun } from './services/mockApi'
import { useWorkspaceStore } from './store'

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const activeView = useWorkspaceStore((state) => state.activeView)
  const demoStep = useWorkspaceStore((state) => state.demoStep)
  const isDemoRunning = useWorkspaceStore((state) => state.isDemoRunning)
  const advanceDemo = useWorkspaceStore((state) => state.advanceDemo)
  const finishResearch = useWorkspaceStore((state) => state.finishResearch)
  const stopDemo = useWorkspaceStore((state) => state.stopDemo)

  const { data: run, isLoading, isError, refetch } = useQuery({
    queryKey: ['research-run', 'FS-2026-0726-018'],
    queryFn: getResearchRun,
  })

  useEffect(() => {
    if (!isDemoRunning) return
    if (demoStep >= 8) {
      finishResearch('claim-3')
      stopDemo()
      return
    }
    const timer = window.setTimeout(advanceDemo, 7200)
    return () => window.clearTimeout(timer)
  }, [advanceDemo, demoStep, finishResearch, isDemoRunning, stopDemo])

  if (!isAuthenticated) {
    return <LoginView onLogin={() => setIsAuthenticated(true)} />
  }

  return (
    <AppShell>
      {isLoading && (
        <div className="loading-state">
          <Skeleton active paragraph={{ rows: 8 }} />
        </div>
      )}
      {isError && (
        <Result
          status="error"
          title="研究任务加载失败"
          subTitle="当前使用本地 Mock 服务，可以点击重新加载。"
          extra={<Button icon={<ReloadOutlined />} onClick={() => refetch()}>重新加载</Button>}
        />
      )}
      {run && (
        <>
          {activeView !== 'tasks' && <ResearchHeader run={run} />}
          {activeView === 'tasks' && <TaskCenter run={run} />}
          {activeView === 'workbench' && <Workbench run={run} />}
          {activeView === 'topology' && <AgentTopology run={run} />}
          {activeView === 'analytics' && <AnalyticsView run={run} />}
          {activeView === 'reports' && <ReportsView run={run} />}
          <SupervisorAssistant run={run} />
        </>
      )}
    </AppShell>
  )
}

export default App
