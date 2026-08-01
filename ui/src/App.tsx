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
import { DatabaseView } from './components/DatabaseView'
import { getResearchRuns } from './services/mockApi'
import { getActiveTask, getTaskProgress, useWorkspaceStore } from './store'
import { ApiError, getMe, getTask, listTasks, logout, setToken, type UserInfo } from './services/api'

function App() {
  const [user, setUser] = useState<UserInfo | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const activeView = useWorkspaceStore((state) => state.activeView)
  const activeTask = useWorkspaceStore(getActiveTask)
  const hasRunningTasks = useWorkspaceStore((state) => state.tasks.some((task) => task.phase === 'running' && task.isDemoRunning))
  const advanceRunningTasks = useWorkspaceStore((state) => state.advanceRunningTasks)
  const hydrateTasks = useWorkspaceStore((state) => state.hydrateTasks)
  const syncTaskRun = useWorkspaceStore((state) => state.syncTaskRun)

  const { data: runs, isLoading, isError, refetch } = useQuery({
    queryKey: ['research-runs'],
    queryFn: getResearchRuns,
  })

  const { data: persistedTasks, isLoading: tasksLoading, isError: tasksError } = useQuery({
    queryKey: ['workspace-tasks', user?.id],
    queryFn: listTasks,
    enabled: Boolean(user),
    refetchInterval: (query) => query.state.data?.some((task) => task.phase === 'running') ? 3000 : false,
  })

  const isPersistedTask = Boolean(activeTask.id && activeTask.persisted && !activeTask.isDemo)
  const {
    data: persistedRun,
    isLoading: runLoading,
    isFetching: runFetching,
    isError: runError,
    refetch: refetchRun,
  } = useQuery({
    // createdAt and user id are part of the identity because the backend can reuse a deleted task's id.
    queryKey: ['research-run', activeTask.id, activeTask.createdAt, user?.id],
    queryFn: ({ queryKey }) => getTask(queryKey[1] as string),
    enabled: Boolean(user && isPersistedTask),
    refetchOnMount: 'always',
    refetchInterval: (query) => {
      const latestRun = query.state.data
      if (latestRun?.status === 'running') return 2500
      // 流水线收尾时，任务状态和主张明细可能落在相邻的两个读取快照里。
      // 未到 100% 或主张仍为空都不是可展示的复核终态，继续刷新直至完整。
      if ((latestRun?.status === 'review' || latestRun?.status === 'ready')
        && (latestRun.progress < 100 || latestRun.claims.length === 0)) return 1000
      return false
    },
  })

  useEffect(() => {
    getMe()
      .then(setUser)
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) setToken(null)
      })
      .finally(() => setAuthLoading(false))
  }, [])

  useEffect(() => {
    if (persistedTasks) hydrateTasks(persistedTasks, true)
  }, [hydrateTasks, persistedTasks])

  useEffect(() => {
    if (persistedRun?.id === activeTask.id && persistedRun.createdAt === activeTask.createdAt) {
      syncTaskRun(persistedRun)
    }
  }, [activeTask.createdAt, activeTask.id, persistedRun, syncTaskRun])

  useEffect(() => {
    if (!hasRunningTasks) return
    const timer = window.setInterval(advanceRunningTasks, 7200)
    return () => window.clearInterval(timer)
  }, [advanceRunningTasks, hasRunningTasks])

  const baseRun = runs?.[0]
  const matchedRun = runs?.find((run) => run.id === activeTask.id)
  // 后端的顺序号可能在旧任务删除后被复用。任务编号相同但创建时间不同的详情属于
  // 旧查询缓存，不能在新任务下展示，也不能反向同步进当前任务的状态。
  const currentPersistedRun = persistedRun?.id === activeTask.id && persistedRun.createdAt === activeTask.createdAt
    ? persistedRun
    : undefined
  const persistedRunIdentityMismatch = Boolean(isPersistedTask && persistedRun && !currentPersistedRun)
  const isResearchPreview = !['tasks', 'settings', 'database'].includes(activeView) && (!activeTask.id || activeTask.phase === 'draft')
  const run = isResearchPreview
    ? baseRun
    : isPersistedTask
      ? currentPersistedRun
      : matchedRun ? {
        ...matchedRun,
        progress: getTaskProgress(activeTask),
      } : (activeTask.isDemo && baseRun ? {
        ...baseRun,
        id: activeTask.id,
        title: activeTask.title,
        company: activeTask.company,
        createdAt: activeTask.createdAt,
        progress: getTaskProgress(activeTask),
      } : undefined)

  if (authLoading) {
    return <div className="loading-state"><Skeleton active paragraph={{ rows: 8 }} /></div>
  }

  if (!user) {
    return <LoginView onLogin={(nextUser) => {
      hydrateTasks([])
      setUser(nextUser)
    }} />
  }

  if (tasksLoading) {
    return <div className="loading-state"><Skeleton active paragraph={{ rows: 8 }} /></div>
  }

  if (tasksError) {
    return <Result status="error" title="任务列表加载失败" subTitle="请确认 FastAPI 已启动后刷新页面。" />
  }

  const handleLogout = async () => {
    try {
      await logout()
    } finally {
      hydrateTasks([])
      setUser(null)
    }
  }

  return (
    <AppShell user={user} onLogout={handleLogout}>
      {isLoading && !['tasks', 'settings', 'database'].includes(activeView) && (
        <div className="loading-state">
          <Skeleton active paragraph={{ rows: 8 }} />
        </div>
      )}
      {isError && !['tasks', 'settings', 'database'].includes(activeView) && (
        <Result
          status="error"
          title="研究任务加载失败"
          subTitle="演示研究数据加载失败，可以点击重新加载。"
          extra={<Button icon={<ReloadOutlined />} onClick={() => refetch()}>重新加载</Button>}
        />
      )}
      {activeView === 'tasks' && <TaskCenter />}
      {activeView === 'settings' && <SettingsView />}
      {activeView === 'database' && <DatabaseView userId={user.id} />}
      {isPersistedTask && (runLoading || (runFetching && !currentPersistedRun)) && !['tasks', 'settings', 'database'].includes(activeView) && (
        <div className="loading-state"><Skeleton active paragraph={{ rows: 8 }} /></div>
      )}
      {isPersistedTask && runError && !['tasks', 'settings', 'database'].includes(activeView) && (
        <Result
          status="error"
          title="研究详情加载失败"
          subTitle="任务列表已连接，但这条研究的详情暂时读取失败。"
          extra={<Button icon={<ReloadOutlined />} onClick={() => refetchRun()}>重新加载</Button>}
        />
      )}
      {persistedRunIdentityMismatch && !runFetching && !runError && !['tasks', 'settings', 'database'].includes(activeView) && (
        <Result
          status="warning"
          title="研究详情与当前任务不一致"
          subTitle="已拦截旧任务缓存，没有把其他项目的复核内容显示到这里。"
          extra={<Button icon={<ReloadOutlined />} onClick={() => refetchRun()}>重新读取当前任务</Button>}
        />
      )}
      {run && !['tasks', 'settings', 'database'].includes(activeView) && (
        <>
          <ResearchHeader run={run} preview={isResearchPreview} />
          {isResearchPreview && (
            <div className="ui-preview-banner">
              <strong>UI 预览模式</strong>
              <span>当前使用示例研究展示完整页面；所有操作仅保留在本次预览中，不会写入你的任务或后端。</span>
            </div>
          )}
          {!isResearchPreview && activeTask.isDemo && !['tasks', 'settings', 'database'].includes(activeView) && (
            <div className="ui-preview-banner">
              <strong>流程演示任务</strong>
              <span>时间线、证据和结论均为内置示例；本次流程不会访问外部数据，也不会写入后端。</span>
            </div>
          )}
          {activeView === 'workbench' && <Workbench run={run} preview={isResearchPreview} />}
          {activeView === 'topology' && <AgentTopology run={run} />}
          {activeView === 'analytics' && <AnalyticsView run={run} />}
          {activeView === 'reports' && <ReportsView run={run} />}
        </>
      )}
      {run && activeTask.id && activeTask.phase !== 'draft' && (
        <SupervisorAssistant key={`${user.id}-${run.id}`} run={run} userId={user.id} />
      )}
    </AppShell>
  )
}

export default App
