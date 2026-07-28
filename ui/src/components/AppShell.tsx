import type { ReactNode } from 'react'
import {
  ApartmentOutlined,
  BarChartOutlined,
  BellOutlined,
  DownOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  SearchOutlined,
  RocketOutlined,
  SafetyCertificateFilled,
} from '@ant-design/icons'
import { Avatar, Badge, Button, Input, Tooltip } from 'antd'
import { useWorkspaceStore } from '../store'

const navItems = [
  { key: 'tasks' as const, label: '开始研究', icon: <RocketOutlined /> },
  { key: 'workbench' as const, label: '待我复核', icon: <FileSearchOutlined /> },
  { key: 'reports' as const, label: '研究底稿', icon: <FileTextOutlined /> },
]

const secondaryItems = [
  { key: 'topology' as const, label: '执行监控', icon: <ApartmentOutlined /> },
  { key: 'analytics' as const, label: '历史情景复盘', icon: <BarChartOutlined /> },
]

const pageMeta = {
  tasks: { title: '开始研究', subtitle: '输入问题，其余步骤交给系统' },
  workbench: { title: '待我复核', subtitle: '只处理系统无法自动确认的疑点' },
  topology: { title: '执行监控', subtitle: '查看各执行单元的进度、耗时、回传状态与异常' },
  analytics: { title: '历史情景复盘', subtitle: '对照已结束事件的公开时序数据与客观指标' },
  reports: { title: '研究底稿', subtitle: '汇总证据链、核验记录与可审计交付物' },
}

export function AppShell({ children }: { children: ReactNode }) {
  const activeView = useWorkspaceStore((state) => state.activeView)
  const setActiveView = useWorkspaceStore((state) => state.setActiveView)
  const taskPhase = useWorkspaceStore((state) => state.taskPhase)
  const reviewedClaimIds = useWorkspaceStore((state) => state.reviewedClaimIds)
  const openReviewQueue = useWorkspaceStore((state) => state.openReviewQueue)
  const activeMeta = pageMeta[activeView]
  const pendingCount = taskPhase === 'ready' ? 0 : Math.max(0, 2 - reviewedClaimIds.length)

  const navigate = (view: typeof navItems[number]['key'] | typeof secondaryItems[number]['key']) => {
    if (view === 'workbench' && taskPhase === 'draft') {
      openReviewQueue('claim-3')
      return
    }
    setActiveView(view)
  }

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark"><SafetyCertificateFilled /></span>
          <div className="brand-copy">
            <strong>FactShield</strong>
            <span>事实溯源工作台</span>
          </div>
        </div>

        <div className="environment-pill"><span /> 演示空间 · Mock 数据</div>

        <div className="sidebar-section-label">工作区</div>
        <nav className="sidebar-nav" aria-label="主要导航">
          {navItems.map((item) => (
            <button
              className={activeView === item.key ? 'nav-item active' : 'nav-item'}
              key={item.key}
              onClick={() => navigate(item.key)}
            >
              {item.icon}<span>{item.label}</span>
              {item.key === 'workbench' && pendingCount > 0 && <em>{pendingCount}</em>}
            </button>
          ))}
        </nav>

        <div className="sidebar-divider" />
        <div className="sidebar-section-label">辅助查看</div>
        <nav className="sidebar-nav secondary" aria-label="辅助导航">
          {secondaryItems.map((item) => (
            <button className={activeView === item.key ? 'nav-item active' : 'nav-item'} key={item.key} onClick={() => navigate(item.key)}>
              {item.icon}<span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="isolation-card">
          <div className="isolation-icon"><SafetyCertificateFilled /></div>
          <div>
            <strong>隔离策略已启用</strong>
            <p>SubAgent 间通信已阻断</p>
          </div>
          <span className="live-dot" />
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="topbar-heading">
            <h1>{activeMeta.title}</h1>
            <p>{activeMeta.subtitle}</p>
          </div>
          <div className="topbar-actions">
            <Input className="workspace-search" prefix={<SearchOutlined />} placeholder="搜索任务、主张或证据" allowClear />
            <Tooltip title="通知中心">
              <Badge dot><Button className="topbar-icon-button" icon={<BellOutlined />} /></Badge>
            </Tooltip>
            <div className="profile-chip">
              <Avatar size={40} className="user-avatar">研</Avatar>
              <div><strong>研究员</strong><span>金融研究一组</span></div>
              <DownOutlined />
            </div>
          </div>
        </header>
        <main className="content">{children}</main>
        <footer className="compliance-footer"><SafetyCertificateFilled /> 本工具仅为金融研究辅助系统，不构成任何投资建议；所有输出仅供研究人员参考，最终结论由研究员判断。</footer>
      </div>
    </div>
  )
}
