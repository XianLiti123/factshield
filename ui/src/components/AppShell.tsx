import { useRef, useState, type ChangeEvent, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import {
  ApartmentOutlined,
  BarChartOutlined,
  CameraOutlined,
  DownOutlined,
  EditOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  IdcardOutlined,
  LogoutOutlined,
  MailOutlined,
  SearchOutlined,
  RocketOutlined,
  SafetyCertificateFilled,
  SettingOutlined,
  UploadOutlined,
  UserOutlined,
  WarningFilled,
} from '@ant-design/icons'
import { Avatar, Button, Dropdown, Input, Modal, Slider, Tag, message } from 'antd'
import type { MenuProps } from 'antd'
import { useWorkspaceStore } from '../store'
import type { UserInfo } from '../services/api'

const PROFILE_STORAGE_PREFIX = 'factshield.profile.'
const AVATAR_CROP_SIZE = 280
const AVATAR_OUTPUT_SIZE = 320

type LocalProfile = {
  displayName?: string
  avatar?: string
}

type CropImage = {
  src: string
  width: number
  height: number
}

function readLocalProfile(userId: number): LocalProfile {
  try {
    const stored = window.localStorage.getItem(`${PROFILE_STORAGE_PREFIX}${userId}`)
    return stored ? JSON.parse(stored) as LocalProfile : {}
  } catch {
    return {}
  }
}

function constrainCropOffset(image: CropImage, zoom: number, x: number, y: number) {
  const baseScale = Math.max(AVATAR_CROP_SIZE / image.width, AVATAR_CROP_SIZE / image.height)
  const maxX = Math.max(0, (image.width * baseScale * zoom - AVATAR_CROP_SIZE) / 2)
  const maxY = Math.max(0, (image.height * baseScale * zoom - AVATAR_CROP_SIZE) / 2)
  return {
    x: Math.max(-maxX, Math.min(maxX, x)),
    y: Math.max(-maxY, Math.min(maxY, y)),
  }
}

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
  const [localProfile, setLocalProfile] = useState<LocalProfile>(() => readLocalProfile(user.id))
  const [nameEditOpen, setNameEditOpen] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [avatarEditOpen, setAvatarEditOpen] = useState(false)
  const [cropImage, setCropImage] = useState<CropImage | null>(null)
  const [cropZoom, setCropZoom] = useState(1)
  const [cropOffset, setCropOffset] = useState({ x: 0, y: 0 })
  const [savingAvatar, setSavingAvatar] = useState(false)
  const [avatarDragging, setAvatarDragging] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const avatarDragDepthRef = useRef(0)
  const cropDragRef = useRef<{
    pointerId: number
    startClientX: number
    startClientY: number
    startOffsetX: number
    startOffsetY: number
  } | null>(null)
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
  const displayName = localProfile.displayName?.trim() || user.display_name?.trim() || user.email.split('@')[0] || '研究员'
  const avatarInitial = Array.from(displayName)[0] || '研'
  const avatarText = /^[a-z]$/i.test(avatarInitial) ? avatarInitial.toUpperCase() : avatarInitial
  const avatarSrc = localProfile.avatar

  const saveLocalProfile = (change: Partial<LocalProfile>) => {
    setLocalProfile((current) => {
      const next = { ...current, ...change }
      try {
        window.localStorage.setItem(`${PROFILE_STORAGE_PREFIX}${user.id}`, JSON.stringify(next))
      } catch {
        message.error('本地存储空间不足，资料未能保存')
        return current
      }
      return next
    })
  }

  const openNameEditor = () => {
    setNameDraft(displayName)
    setNameEditOpen(true)
  }

  const saveDisplayName = () => {
    const nextName = nameDraft.trim()
    if (nextName.length < 2 || nextName.length > 32) {
      message.error('用户名需要保持在 2–32 个字符之间')
      return
    }
    saveLocalProfile({ displayName: nextName })
    setNameEditOpen(false)
    message.success('用户名已更新')
  }

  const openAvatarEditor = () => {
    setCropImage(null)
    setCropZoom(1)
    setCropOffset({ x: 0, y: 0 })
    setAvatarDragging(false)
    avatarDragDepthRef.current = 0
    setAvatarEditOpen(true)
  }

  const loadAvatarFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      message.error('请选择 PNG、JPG 或 WebP 图片')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      message.error('图片不能超过 10 MB')
      return
    }
    const reader = new FileReader()
    reader.onerror = () => message.error('图片读取失败，请重新选择')
    reader.onload = () => {
      const src = String(reader.result ?? '')
      const image = new Image()
      image.onerror = () => message.error('无法识别这张图片')
      image.onload = () => {
        setCropImage({ src, width: image.naturalWidth, height: image.naturalHeight })
        setCropZoom(1)
        setCropOffset({ x: 0, y: 0 })
      }
      image.src = src
    }
    reader.readAsDataURL(file)
  }

  const handleAvatarFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) loadAvatarFile(file)
  }

  const handleAvatarDragEnter = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.stopPropagation()
    avatarDragDepthRef.current += 1
    setAvatarDragging(true)
  }

  const handleAvatarDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleAvatarDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    avatarDragDepthRef.current = Math.max(0, avatarDragDepthRef.current - 1)
    if (avatarDragDepthRef.current === 0) setAvatarDragging(false)
  }

  const handleAvatarDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    avatarDragDepthRef.current = 0
    setAvatarDragging(false)
    const files = Array.from(event.dataTransfer.files)
    const imageFile = files.find((file) => file.type.startsWith('image/'))
    if (!imageFile) {
      message.error('拖入的文件不是可识别的图片')
      return
    }
    if (files.length > 1) message.info('一次只能设置一张头像，已读取第一张图片')
    loadAvatarFile(imageFile)
  }

  const handleCropPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!cropImage) return
    cropDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startOffsetX: cropOffset.x,
      startOffsetY: cropOffset.y,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleCropPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = cropDragRef.current
    if (!cropImage || !drag || drag.pointerId !== event.pointerId) return
    setCropOffset(constrainCropOffset(
      cropImage,
      cropZoom,
      drag.startOffsetX + event.clientX - drag.startClientX,
      drag.startOffsetY + event.clientY - drag.startClientY,
    ))
  }

  const finishCropDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (cropDragRef.current?.pointerId !== event.pointerId) return
    cropDragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const saveCroppedAvatar = async () => {
    if (!cropImage) return
    setSavingAvatar(true)
    try {
      const source = new Image()
      source.src = cropImage.src
      await source.decode()
      const canvas = document.createElement('canvas')
      canvas.width = AVATAR_OUTPUT_SIZE
      canvas.height = AVATAR_OUTPUT_SIZE
      const context = canvas.getContext('2d')
      if (!context) throw new Error('浏览器无法创建头像画布')

      const outputScale = AVATAR_OUTPUT_SIZE / AVATAR_CROP_SIZE
      const baseScale = Math.max(AVATAR_CROP_SIZE / cropImage.width, AVATAR_CROP_SIZE / cropImage.height)
      const drawWidth = cropImage.width * baseScale * cropZoom * outputScale
      const drawHeight = cropImage.height * baseScale * cropZoom * outputScale
      const drawX = (AVATAR_OUTPUT_SIZE - drawWidth) / 2 + cropOffset.x * outputScale
      const drawY = (AVATAR_OUTPUT_SIZE - drawHeight) / 2 + cropOffset.y * outputScale
      context.beginPath()
      context.arc(AVATAR_OUTPUT_SIZE / 2, AVATAR_OUTPUT_SIZE / 2, AVATAR_OUTPUT_SIZE / 2, 0, Math.PI * 2)
      context.clip()
      context.drawImage(source, drawX, drawY, drawWidth, drawHeight)
      saveLocalProfile({ avatar: canvas.toDataURL('image/png') })
      setAvatarEditOpen(false)
      message.success('头像已更新')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '头像保存失败')
    } finally {
      setSavingAvatar(false)
    }
  }

  const navigate = (view: typeof navItems[number]['key'] | typeof secondaryItems[number]['key']) => {
    if (view === 'workbench' && nextPendingItem) {
      openReviewQueue(nextPendingItem.claimId, nextPendingItem.taskId)
      return
    }
    setActiveView(view)
  }

  const accountMenuItems: MenuProps['items'] = [
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
                <Avatar size={40} className="user-avatar" src={avatarSrc}><span className="avatar-glyph">{avatarText}</span></Avatar>
                <div className="profile-chip-copy"><strong>{displayName}</strong><span>{user.email}</span></div>
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
          <Avatar size={58} src={avatarSrc}><span className="avatar-glyph">{avatarText}</span></Avatar>
          <div>
            <span>当前登录账号</span>
            <strong>{displayName}</strong>
            <small><i /> 账号状态正常</small>
          </div>
          <Tag icon={<SafetyCertificateFilled />}>已认证</Tag>
        </div>
        <div className="account-profile-actions">
          <Button icon={<CameraOutlined />} onClick={openAvatarEditor}>修改头像</Button>
          <Button icon={<EditOutlined />} onClick={openNameEditor}>修改用户名</Button>
        </div>
        <div className="account-profile-details">
          <div>
            <span className="account-detail-icon"><UserOutlined /></span>
            <div><small>用户名</small><strong>{displayName}</strong></div>
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
        <div className="account-profile-note">头像与修改后的用户名保存在当前浏览器；登录邮箱与账号权限仍由后端账号管理。</div>
      </Modal>

      <Modal
        className="profile-name-modal"
        title="修改用户名"
        open={nameEditOpen}
        onCancel={() => setNameEditOpen(false)}
        onOk={saveDisplayName}
        okText="保存修改"
        cancelText="取消"
      >
        <label className="profile-edit-label" htmlFor="profile-display-name">用户名</label>
        <Input
          id="profile-display-name"
          value={nameDraft}
          maxLength={32}
          showCount
          autoFocus
          onChange={(event) => setNameDraft(event.target.value)}
          onPressEnter={saveDisplayName}
          placeholder="请输入 2–32 个字符"
        />
        <p className="profile-edit-hint">修改后会立即应用到右上角账户卡和用户信息页。</p>
      </Modal>

      <Modal
        className="avatar-crop-modal"
        title="修改头像"
        open={avatarEditOpen}
        onCancel={() => setAvatarEditOpen(false)}
        width={520}
        footer={[
          <Button key="cancel" disabled={savingAvatar} onClick={() => setAvatarEditOpen(false)}>取消</Button>,
          <Button key="save" type="primary" loading={savingAvatar} disabled={!cropImage} onClick={saveCroppedAvatar}>使用此头像</Button>,
        ]}
      >
        <input ref={avatarInputRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={handleAvatarFile} />
        <div
          className={avatarDragging ? 'avatar-drop-zone dragging' : 'avatar-drop-zone'}
          onDragEnter={handleAvatarDragEnter}
          onDragOver={handleAvatarDragOver}
          onDragLeave={handleAvatarDragLeave}
          onDrop={handleAvatarDrop}
        >
          <div className="avatar-crop-toolbar">
            <Button icon={<UploadOutlined />} onClick={() => avatarInputRef.current?.click()}>{cropImage ? '重新选择图片' : '从电脑选择图片'}</Button>
            <span>也可以把图片直接拖到这里 · 最大 10 MB</span>
          </div>
          {cropImage ? (
            <>
              <div className="avatar-crop-stage">
                <div
                  className="avatar-crop-viewport"
                  onPointerDown={handleCropPointerDown}
                  onPointerMove={handleCropPointerMove}
                  onPointerUp={finishCropDrag}
                  onPointerCancel={finishCropDrag}
                >
                  <img
                    className="avatar-crop-image"
                    src={cropImage.src}
                    alt="待裁剪头像"
                    draggable={false}
                    style={{
                      width: cropImage.width * Math.max(AVATAR_CROP_SIZE / cropImage.width, AVATAR_CROP_SIZE / cropImage.height) * cropZoom,
                      height: cropImage.height * Math.max(AVATAR_CROP_SIZE / cropImage.width, AVATAR_CROP_SIZE / cropImage.height) * cropZoom,
                      left: `calc(50% + ${cropOffset.x}px)`,
                      top: `calc(50% + ${cropOffset.y}px)`,
                    }}
                  />
                </div>
              </div>
              <div className="avatar-zoom-control">
                <span>缩小</span>
                <Slider
                  min={1}
                  max={3}
                  step={0.01}
                  value={cropZoom}
                  tooltip={{ formatter: (value) => `${Math.round((value ?? 1) * 100)}%` }}
                  onChange={(zoom) => {
                    setCropZoom(zoom)
                    setCropOffset((current) => constrainCropOffset(cropImage, zoom, current.x, current.y))
                  }}
                />
                <span>放大</span>
              </div>
              <p className="avatar-crop-hint">拖动图片调整位置，缩放后圆形区域内的内容会成为你的头像。</p>
            </>
          ) : (
            <button className="avatar-upload-empty" type="button" onClick={() => avatarInputRef.current?.click()}>
              <span><CameraOutlined /></span>
              <strong>选择或拖入一张头像图片</strong>
              <small>导入后可以拖动和缩放，截取你想要的圆形区域</small>
            </button>
          )}
          {avatarDragging && (
            <div className="avatar-drop-overlay" aria-live="polite">
              <span><UploadOutlined /></span>
              <strong>松开即可导入图片</strong>
              <small>新图片会替换当前待裁剪图片</small>
            </div>
          )}
        </div>
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
