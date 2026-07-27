import type { ReactNode } from 'react'
import {
  ApartmentOutlined,
  BarChartOutlined,
  BellOutlined,
  DownOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  PlusOutlined,
  SearchOutlined,
  UnorderedListOutlined,
  QuestionCircleOutlined,
  SafetyCertificateFilled,
  SettingOutlined,
} from '@ant-design/icons'
import { Avatar, Badge, Button, Input, Tooltip } from 'antd'
import { useWorkspaceStore } from '../store'

const navItems = [
  { key: 'tasks' as const, label: '研究任务', icon: <UnorderedListOutlined /> },
  { key: 'workbench' as const, label: '核验工作台', icon: <FileSearchOutlined /> },
  { key: 'topology' as const, label: 'Agent 拓扑', icon: <ApartmentOutlined /> },
  { key: 'analytics' as const, label: '历史情景复盘', icon: <BarChartOutlined /> },
  { key: 'reports' as const, label: '研究底稿', icon: <FileTextOutlined /> },
]

const pageMeta = {
  tasks: { title: '研究任务', subtitle: '管理研究主题、公开材料与核验进度' },
  workbench: { title: '核验工作台', subtitle: '审阅事实主张、原始证据与双层核验结论' },
  topology: { title: 'Agent 拓扑', subtitle: '查看 Supervisor 与隔离 SubAgent 的受控执行状态' },
  analytics: { title: '历史情景复盘', subtitle: '对照已结束事件的公开时序数据与客观指标' },
  reports: { title: '研究底稿', subtitle: '汇总证据链、核验记录与可审计交付物' },
}

export function AppShell({ children }: { children: ReactNode }) {
  const activeView = useWorkspaceStore((state) => state.activeView)
  const setActiveView = useWorkspaceStore((state) => state.setActiveView)
  const activeMeta = pageMeta[activeView]

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
              onClick={() => setActiveView(item.key)}
            >
              {item.icon}<span>{item.label}</span>
              {item.key === 'workbench' && <em>5</em>}
            </button>
          ))}
        </nav>

        <div className="sidebar-divider" />
        <button className="nav-item"><SettingOutlined /><span>系统设置</span></button>
        <button className="nav-item"><QuestionCircleOutlined /><span>使用帮助</span></button>

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
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setActiveView('tasks')}>新建研究</Button>
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
