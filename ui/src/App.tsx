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
import { SettingsView } from './components/SettingsView'
import { getResearchRuns } from './services/mockApi'
import { getActiveTask, getTaskProgress, useWorkspaceStore } from './store'

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const activeView = useWorkspaceStore((state) => state.activeView)
  const activeTask = useWorkspaceStore(getActiveTask)
  const hasRunningTasks = useWorkspaceStore((state) => state.tasks.some((task) => task.phase === 'running' && task.isDemoRunning))
  const advanceRunningTasks = useWorkspaceStore((state) => state.advanceRunningTasks)

  const { data: runs, isLoading, isError, refetch } = useQuery({
    queryKey: ['research-runs'],
    queryFn: getResearchRuns,
  })

  useEffect(() => {
    if (!hasRunningTasks) return
    const timer = window.setInterval(advanceRunningTasks, 7200)
    return () => window.clearInterval(timer)
  }, [advanceRunningTasks, hasRunningTasks])

  const baseRun = runs?.[0]
  const matchedRun = runs?.find((run) => run.id === activeTask.id)
  const run = matchedRun ? {
    ...matchedRun,
    progress: getTaskProgress(activeTask),
  } : (baseRun ? {
    ...baseRun,
    id: activeTask.id,
    title: activeTask.title,
    company: activeTask.company,
    createdAt: activeTask.createdAt,
    progress: getTaskProgress(activeTask),
  } : undefined)

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
          {!['tasks', 'settings'].includes(activeView) && <ResearchHeader run={run} />}
          {activeView === 'tasks' && <TaskCenter runs={runs ?? [run]} />}
          {activeView === 'workbench' && <Workbench run={run} />}
          {activeView === 'topology' && <AgentTopology run={run} />}
          {activeView === 'analytics' && <AnalyticsView run={run} />}
          {activeView === 'reports' && <ReportsView run={run} />}
          {activeView === 'settings' && <SettingsView />}
          {activeView !== 'settings' && <SupervisorAssistant run={run} />}
        </>
      )}
    </AppShell>
  )
}

export default App
