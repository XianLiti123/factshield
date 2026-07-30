import { useState, type ReactNode } from 'react'
import {
  ApartmentOutlined,
  BarChartOutlined,
  DownOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  IdcardOutlined,
  LogoutOutlined,
  MailOutlined,
  SearchOutlined,
  RocketOutlined,
  SafetyCertificateFilled,
  SettingOutlined,
  UserOutlined,
  WarningFilled,
} from '@ant-design/icons'
import { Avatar, Button, Dropdown, Input, Modal, Tag } from 'antd'
import type { MenuProps } from 'antd'
import { useWorkspaceStore } from '../store'
import type { UserInfo } from '../services/api'

const navItems = [
  { key: 'tasks' as const, label: '研究任务', icon: <RocketOutlined /> },
  { key: 'workbench' as const, label: '待我复核', icon: <FileSearchOutlined /> },
  { key: 'reports' as const, label: '研究底稿', icon: <FileTextOutlined /> },
]

const secondaryItems = [
  { key: 'topology' as const, label: '执行监控', icon: <ApartmentOutlined /> },
  { key: 'analytics' as const, label: '历史情景复盘', icon: <BarChartOutlined /> },
  { key: 'settings' as const, label: '系统设置', icon: <SettingOutlined /> },
]

const pageMeta = {
  tasks: { title: '研究任务', subtitle: '同时查看、切换和管理多项研究' },
  workbench: { title: '待我复核', subtitle: '只处理系统无法自动确认的疑点' },
  topology: { title: '执行监控', subtitle: '查看各执行单元的进度、耗时、回传状态与异常' },
  analytics: { title: '历史情景复盘', subtitle: '对照已结束事件的公开时序数据与客观指标' },
  reports: { title: '研究底稿', subtitle: '汇总证据链、核验记录与可审计交付物' },
  settings: { title: '系统设置', subtitle: '管理模型连接与研究偏好' },
}

export function AppShell({ children, user, onLogout }: { children: ReactNode; user: UserInfo; onLogout: () => void | Promise<void> }) {
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const activeView = useWorkspaceStore((state) => state.activeView)
  const setActiveView = useWorkspaceStore((state) => state.setActiveView)
  const tasks = useWorkspaceStore((state) => state.tasks)
  const openReviewQueue = useWorkspaceStore((state) => state.openReviewQueue)
  const activeMeta = pageMeta[activeView]
  const pendingItems = tasks.flatMap((task) => task.phase === 'review'
    ? task.reviewClaimIds
      .filter((claimId) => !task.reviewedClaimIds.includes(claimId))
      .map((claimId) => ({ taskId: task.id, claimId }))
    : [])
  const pendingCount = pendingItems.length
  const nextPendingItem = pendingItems[0]
  const username = user.username?.trim() || '研究员'
  const avatarText = Array.from(username)[0] || '研'

  const navigate = (view: typeof navItems[number]['key'] | typeof secondaryItems[number]['key']) => {
    if (view === 'workbench' && nextPendingItem) {
      openReviewQueue(nextPendingItem.claimId, nextPendingItem.taskId)
      return
    }
    setActiveView(view)
  }

  const accountMenuItems: MenuProps['items'] = [
    {
      key: 'account-summary',
      disabled: true,
      label: (
        <div className="account-menu-summary">
          <Avatar size={34} className="account-menu-avatar">{avatarText}</Avatar>
          <div><strong>{username}</strong><span>{user.email}</span></div>
        </div>
      ),
    },
    { type: 'divider' },
    { key: 'profile', icon: <UserOutlined />, label: '用户信息' },
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true },
  ]

  const handleAccountMenuClick: MenuProps['onClick'] = ({ key }) => {
    setAccountMenuOpen(false)
    if (key === 'profile') setProfileOpen(true)
    if (key === 'logout') setLogoutConfirmOpen(true)
  }

  const confirmLogout = async () => {
    setLoggingOut(true)
    try {
      await onLogout()
    } finally {
      setLoggingOut(false)
      setLogoutConfirmOpen(false)
    }
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

        <div className="environment-pill"><span /> 已连接本地 FastAPI</div>

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

        <section className="sidebar-principles-card" aria-label="研究底线">
          <span className="sidebar-principles-icon"><SafetyCertificateFilled /></span>
          <div className="sidebar-principles-copy">
            <strong>核验原则</strong>
            <span>原文优先 · 引用可回查</span>
            <small>争议信息由你确认</small>
          </div>
        </section>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="topbar-heading">
            <h1>{activeMeta.title}</h1>
            <p>{activeMeta.subtitle}</p>
          </div>
          <div className="topbar-actions">
            <Input className="workspace-search" prefix={<SearchOutlined />} placeholder="搜索任务、主张或证据" allowClear />
            <Dropdown
              trigger={['click']}
              placement="bottomRight"
              open={accountMenuOpen}
              onOpenChange={setAccountMenuOpen}
              menu={{ items: accountMenuItems, onClick: handleAccountMenuClick }}
              overlayClassName="account-dropdown"
            >
              <button className={accountMenuOpen ? 'profile-chip open' : 'profile-chip'} aria-label="打开账户菜单" aria-expanded={accountMenuOpen}>
                <Avatar size={40} className="user-avatar">{avatarText}</Avatar>
                <div className="profile-chip-copy"><strong>{username}</strong><span>{user.email}</span></div>
                <DownOutlined />
              </button>
            </Dropdown>
          </div>
        </header>
        <main className="content">{children}</main>
        <footer className="compliance-footer"><SafetyCertificateFilled /> 本工具仅为金融研究辅助系统，不构成任何投资建议；所有输出仅供研究人员参考，最终结论由研究员判断。</footer>
      </div>

      <Modal
        className="account-profile-modal"
        title="用户信息"
        open={profileOpen}
        onCancel={() => setProfileOpen(false)}
        width={520}
        footer={<Button type="primary" onClick={() => setProfileOpen(false)}>知道了</Button>}
      >
        <div className="account-profile-hero">
          <Avatar size={58}>{avatarText}</Avatar>
          <div>
            <span>当前登录账号</span>
            <strong>{username}</strong>
            <small><i /> 账号状态正常</small>
          </div>
          <Tag icon={<SafetyCertificateFilled />}>已认证</Tag>
        </div>
        <div className="account-profile-details">
          <div>
            <span className="account-detail-icon"><UserOutlined /></span>
            <div><small>用户名</small><strong>{username}</strong></div>
          </div>
          <div>
            <span className="account-detail-icon"><MailOutlined /></span>
            <div><small>登录邮箱</small><strong>{user.email}</strong></div>
          </div>
          <div>
            <span className="account-detail-icon"><IdcardOutlined /></span>
            <div><small>账号编号</small><strong>FS-{String(user.id).padStart(6, '0')}</strong></div>
          </div>
        </div>
        <div className="account-profile-note">账号信息来自当前登录凭证；如需修改邮箱或权限，请联系工作台管理员。</div>
      </Modal>

      <Modal
        className="logout-confirm-modal"
        title={null}
        open={logoutConfirmOpen}
        onCancel={() => setLogoutConfirmOpen(false)}
        closable={false}
        width={400}
        footer={null}
      >
        <div className="logout-confirm-content">
          <span className="logout-confirm-icon"><WarningFilled /></span>
          <div><strong>确认退出登录？</strong><p>退出后需要重新登录才能继续查看研究任务。</p></div>
        </div>
        <div className="logout-confirm-actions">
          <Button onClick={() => setLogoutConfirmOpen(false)} disabled={loggingOut}>取消</Button>
          <Button danger type="primary" loading={loggingOut} onClick={confirmLogout}>确认退出</Button>
        </div>
      </Modal>
    </div>
  )
}
