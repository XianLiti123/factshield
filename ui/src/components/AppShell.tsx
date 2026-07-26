import type { ReactNode } from 'react'
import {
  ApartmentOutlined,
  BarChartOutlined,
  BellOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  UnorderedListOutlined,
  QuestionCircleOutlined,
  SafetyCertificateFilled,
  SettingOutlined,
} from '@ant-design/icons'
import { Avatar, Badge, Button, Tooltip } from 'antd'
import { useWorkspaceStore } from '../store'

const navItems = [
  { key: 'tasks' as const, label: '研究任务', icon: <UnorderedListOutlined /> },
  { key: 'workbench' as const, label: '核验工作台', icon: <FileSearchOutlined /> },
  { key: 'topology' as const, label: 'Agent 拓扑', icon: <ApartmentOutlined /> },
  { key: 'analytics' as const, label: '历史情景复盘', icon: <BarChartOutlined /> },
  { key: 'reports' as const, label: '研究底稿', icon: <FileTextOutlined /> },
]

export function AppShell({ children }: { children: ReactNode }) {
  const activeView = useWorkspaceStore((state) => state.activeView)
  const setActiveView = useWorkspaceStore((state) => state.setActiveView)

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

        <div className="sidebar-section-label">研究空间</div>
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

        <div className="sidebar-user">
          <Avatar size={36} className="user-avatar">研</Avatar>
          <div><strong>研究员</strong><span>金融研究一组</span></div>
          <Button type="text" icon={<SettingOutlined />} />
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="environment-pill"><span /> 演示环境 · Mock 数据</div>
          <div className="topbar-actions">
            <Tooltip title="通知中心">
              <Badge dot><Button type="text" icon={<BellOutlined />} /></Badge>
            </Tooltip>
            <span className="topbar-separator" />
            <span className="topbar-compliance"><SafetyCertificateFilled /> 仅供研究参考 · 不构成投资建议</span>
            <span className="topbar-separator" />
            <span>数据更新于 14:41:26</span>
          </div>
        </header>
        <main className="content">{children}</main>
        <footer className="compliance-footer"><SafetyCertificateFilled /> 本工具仅为金融研究辅助系统，不构成任何投资建议；所有输出仅供研究人员参考，最终结论由研究员判断。</footer>
      </div>
    </div>
  )
}
