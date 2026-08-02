import { useEffect, useState, type AnimationEvent } from 'react'
import {
  ApartmentOutlined,
  AuditOutlined,
  CheckCircleFilled,
  FileSearchOutlined,
  LockOutlined,
  MailOutlined,
  SafetyCertificateFilled,
  UserOutlined,
} from '@ant-design/icons'
import { Button, Checkbox, Form, Input, message } from 'antd'
import { changePasswordFromLogin, login, register, setToken, type UserInfo } from '../services/api'

interface LoginValues {
  username?: string
  email: string
  password: string
  currentPassword?: string
  newPassword?: string
  confirmPassword?: string
  remember: boolean
  agreement?: boolean
}

type AuthMode = 'login' | 'register' | 'password'
type TransitionPhase = 'idle' | 'exit' | 'enter'
type TransitionDirection = 'forward' | 'backward'
type ShowcaseKind = 'tasks' | 'review' | 'report'

const showcaseSlides: Array<{
  kind: ShowcaseKind
  title: string
  description: string
}> = [
  {
    kind: 'tasks',
    title: '把几项研究，同时推进',
    description: '每个任务独立保留进度、证据与上下文。现在做到哪一步，打开工作台就能看清楚。',
  },
  {
    kind: 'review',
    title: '只把真正的疑点留给你',
    description: '系统先完成资料检索与交叉核验，你只需对照原文，处理无法自动确认的关键判断。',
  },
  {
    kind: 'report',
    title: '每个结论，都能回到原文',
    description: '主张、证据和核验过程完整归档，让研究结论不是一句答案，而是一条可回查的证据链。',
  },
]

function ShowcaseVisual({ kind }: { kind: ShowcaseKind }) {
  if (kind === 'tasks') {
    return (
      <div className="showcase-composition showcase-task-composition">
        <div className="showcase-window showcase-task-window">
          <div className="showcase-window-bar"><i /><i /><i /><span>研究任务</span><b>＋ 新建研究</b></div>
          <div className="showcase-app-body">
            <div className="showcase-mini-sidebar">
              <span className="showcase-mini-logo"><SafetyCertificateFilled /></span>
              <i className="active" /><i /><i /><i />
            </div>
            <div className="showcase-task-main">
              <div className="showcase-screen-heading"><div><small>研究工作区</small><strong>今天要推进什么？</strong></div><span>3 项正在进行</span></div>
              <div className="showcase-task-grid">
                <div className="showcase-task-card primary">
                  <span><i />正在核验</span><strong>央行存款准备金率<br />调整政策核查</strong>
                  <div className="showcase-progress"><i /></div><small>证据检索 · 68%</small>
                </div>
                <div className="showcase-task-card">
                  <span><i />等待复核</span><strong>新能源汽车海外<br />业务增长研究</strong>
                  <div className="showcase-task-metric"><b>2</b><small>条疑点待处理</small></div>
                </div>
                <div className="showcase-task-card">
                  <span><i />整理底稿</span><strong>锂电材料价格<br />周期复盘</strong>
                  <div className="showcase-task-metric"><b>24</b><small>条证据已归档</small></div>
                </div>
              </div>
              <div className="showcase-queue-strip"><ApartmentOutlined /><div><strong>任务彼此独立运行</strong><span>进度、上下文与证据互不干扰</span></div><b>并行 3</b></div>
            </div>
          </div>
        </div>
        <div className="showcase-float-card showcase-task-count">
          <span>并行任务</span><strong>03</strong><small>各自独立推进</small>
          <div><i /><i /><i /></div>
        </div>
        <div className="showcase-float-card showcase-task-focus">
          <div className="showcase-float-ring"><strong>68%</strong></div>
          <div><span>当前进度</span><strong>证据检索中</strong><small>已归档 12 份材料</small></div>
        </div>
      </div>
    )
  }

  if (kind === 'review') {
    return (
      <div className="showcase-composition showcase-review-composition">
        <div className="showcase-window showcase-review-window">
          <div className="showcase-window-bar"><i /><i /><i /><span>待我复核</span><b>1 / 2 已处理</b></div>
          <div className="showcase-review-summary"><div><small>系统已完成自动核验</small><strong>只需处理 2 条疑点</strong></div><span>待人工复核</span></div>
          <div className="showcase-review-grid">
            <div className="showcase-claim-list">
              <small>事实主张</small>
              <div className="active"><span>C01</span><i>存在冲突</i><p>政策调整的执行范围与市场解读是否一致</p></div>
              <div><span>C02</span><i>待确认</i><p>调整将在全部金融机构同步执行</p></div>
            </div>
            <div className="showcase-document">
              <div><FileSearchOutlined /><span>政策公告原文</span><b>95</b></div>
              <article><small>中国人民银行</small><strong>关于下调金融机构<br />存款准备金率的通知</strong><i /><p>自本月起，下调金融机构存款准备金率……</p><em>核验引用</em><blockquote>本次调整不包含已执行特定准备金率的机构。</blockquote></article>
            </div>
            <div className="showcase-verdicts">
              <small>双层核验</small>
              <div className="verified"><span>盾</span><strong>小盾的第一轮判断</strong><p>主张与公告原文存在口径差异。</p><i><CheckCircleFilled /> 已完成</i></div>
              <div className="review"><span>复</span><strong>独立复核</strong><p>建议保留限制条件后再采用。</p><i><CheckCircleFilled /> 一致</i></div>
            </div>
          </div>
        </div>
        <div className="showcase-float-card showcase-review-count">
          <span>待你判断</span><strong>02</strong><small>其他结论已自动归档</small>
        </div>
        <div className="showcase-float-card showcase-review-result">
          <span><CheckCircleFilled /> 两级结论一致</span>
          <strong>建议补充限制条件</strong>
          <small>原文已定位，可直接对照</small>
        </div>
      </div>
    )
  }

  return (
    <div className="showcase-composition showcase-report-composition">
      <div className="showcase-window showcase-report-window">
        <div className="showcase-window-bar"><i /><i /><i /><span>研究底稿</span><b>审计链完整</b></div>
        <div className="showcase-report-body">
          <div className="showcase-report-page">
            <span className="showcase-report-mark"><SafetyCertificateFilled /></span>
            <small>FACTSHIELD RESEARCH</small>
            <h3>金融研究事实核验底稿</h3>
            <p>2024 年货币政策调整<br />与市场影响研究</p>
            <div className="showcase-report-meta"><span>8 条事实主张</span><span>24 条原始证据</span><span>2 条人工决策</span></div>
            <footer>FS-2026-001 · 自动生成</footer>
          </div>
          <div className="showcase-trace-card">
            <div className="showcase-trace-heading"><AuditOutlined /><div><strong>结论证据链</strong><span>从研究结论回查至原始材料</span></div></div>
            <div className="showcase-trace-line"><i>01</i><div><strong>事实主张已确认</strong><span>政策调整范围与公告口径一致</span></div><CheckCircleFilled /></div>
            <div className="showcase-trace-line"><i>02</i><div><strong>引用原文已定位</strong><span>中国人民银行公告 · 第 2 段</span></div><CheckCircleFilled /></div>
            <div className="showcase-trace-line"><i>03</i><div><strong>来源完整性校验</strong><span>SHA-256 · 9f2c…a817</span></div><CheckCircleFilled /></div>
            <div className="showcase-trace-seal"><SafetyCertificateFilled /><span>来源可访问 · 引用可定位 · 过程可审计</span></div>
          </div>
        </div>
      </div>
      <div className="showcase-float-card showcase-report-stats">
        <span>底稿内容</span>
        <div><strong>8</strong><small>主张</small><i /><strong>24</strong><small>证据</small></div>
      </div>
      <div className="showcase-float-card showcase-report-verified">
        <SafetyCertificateFilled />
        <div><strong>完整性已验证</strong><small>来源、引用与决策均可回查</small></div>
      </div>
    </div>
  )
}

function AuthShowcase() {
  const [activeSlide, setActiveSlide] = useState(0)
  const [paused, setPaused] = useState(false)
  const slide = showcaseSlides[activeSlide]

  useEffect(() => {
    if (paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = window.setInterval(() => {
      setActiveSlide((current) => (current + 1) % showcaseSlides.length)
    }, 5600)
    return () => window.clearInterval(timer)
  }, [paused, activeSlide])

  return (
    <aside
      className="login-showcase"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="showcase-glow showcase-glow-one" />
      <div className="showcase-glow showcase-glow-two" />
      <div key={slide.kind} className="showcase-slide" aria-live="polite">
        <div className="showcase-visual"><ShowcaseVisual kind={slide.kind} /></div>
        <div className="showcase-copy">
          <h2>{slide.title}</h2>
          <p>{slide.description}</p>
        </div>
      </div>
      <div className="showcase-dots" role="tablist" aria-label="产品功能介绍">
        {showcaseSlides.map((item, index) => (
          <button
            key={item.kind}
            type="button"
            className={index === activeSlide ? 'active' : ''}
            aria-label={`查看：${item.title}`}
            aria-selected={index === activeSlide}
            role="tab"
            onClick={() => setActiveSlide(index)}
          />
        ))}
      </div>
    </aside>
  )
}

export function LoginView({ onLogin }: { onLogin: (user: UserInfo) => void }) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [submitting, setSubmitting] = useState(false)
  const [invalidFields, setInvalidFields] = useState<string[]>([])
  const [shakeAttempt, setShakeAttempt] = useState(0)
  const [transition, setTransition] = useState<{
    phase: TransitionPhase
    direction: TransitionDirection
    target: AuthMode
  }>({ phase: 'idle', direction: 'forward', target: 'login' })

  const switchMode = (target: AuthMode) => {
    if (target === mode || transition.phase !== 'idle' || submitting) return
    setTransition({
      phase: 'exit',
      direction: ({ login: 0, register: 1, password: 2 }[target] > { login: 0, register: 1, password: 2 }[mode]) ? 'forward' : 'backward',
      target,
    })
  }

  const handlePanelAnimationEnd = (event: AnimationEvent<HTMLDivElement>) => {
    if (event.currentTarget !== event.target) return

    if (transition.phase === 'exit') {
      setMode(transition.target)
      setTransition((current) => ({ ...current, phase: 'enter' }))
      return
    }

    if (transition.phase === 'enter') {
      setTransition((current) => ({ ...current, phase: 'idle' }))
    }
  }

  const submitLogin = async (values: LoginValues) => {
    setSubmitting(true)
    try {
      const response = await login(values.email, values.password)
      setToken(response.token)
      message.success('登录成功')
      onLogin(response.user)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '登录失败')
    } finally {
      setSubmitting(false)
    }
  }

  const submitRegistration = async (values: LoginValues) => {
    setSubmitting(true)
    try {
      const response = await register(values.username?.trim() ?? '', values.email, values.password)
      setToken(response.token)
      message.success('账号已创建')
      onLogin(response.user)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '注册失败')
    } finally {
      setSubmitting(false)
    }
  }

  const submitPasswordChange = async (values: LoginValues) => {
    setSubmitting(true)
    try {
      await changePasswordFromLogin(values.email, values.currentPassword ?? '', values.newPassword ?? '')
      message.success('密码已修改，请使用新密码登录')
      setTransition({ phase: 'exit', direction: 'backward', target: 'login' })
    } catch (error) {
      message.error(error instanceof Error ? error.message : '密码修改失败')
    } finally {
      setSubmitting(false)
    }
  }

  const isRegister = mode === 'register'
  const isPasswordChange = mode === 'password'
  const invalidFieldClass = (name: string) => invalidFields.includes(name)
    ? `auth-field-shake auth-field-shake-${shakeAttempt % 2}`
    : ''
  const handleValidationFailed = ({ errorFields }: { errorFields: Array<{ name: Array<string | number> }> }) => {
    setInvalidFields(errorFields.map((field) => String(field.name[0])))
    setShakeAttempt((attempt) => attempt + 1)
  }
  const panelMotionClass = transition.phase === 'idle'
    ? ''
    : `auth-panel--${transition.phase}-${transition.direction}`

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-form-side">
          <div className="auth-brand" aria-label="FactShield">
            <span className="auth-brand-mark"><SafetyCertificateFilled /></span>
            <strong>FactShield</strong>
          </div>
          <div
            key={mode}
            className={`login-form-wrap auth-panel${isPasswordChange ? ' auth-password-panel' : ''} ${panelMotionClass}`}
            onAnimationEnd={handlePanelAnimationEnd}
          >
            <div className="login-heading">
              <h1>{isPasswordChange ? '修改密码' : isRegister ? '创建账号' : '欢迎回来'}</h1>
              <p>{isPasswordChange ? '验证当前账号后设置一个新密码' : isRegister ? '创建您的金融研究工作台账号' : '请输入您的工作台账号信息'}</p>
            </div>

            <Form<LoginValues>
              key={mode}
              className="login-form"
              layout="vertical"
              initialValues={isRegister ? { agreement: true } : isPasswordChange ? {} : { remember: true }}
              requiredMark={false}
              onFinish={isPasswordChange ? submitPasswordChange : isRegister ? submitRegistration : submitLogin}
              onFinishFailed={handleValidationFailed}
            >
              {isRegister && (
                <Form.Item
                  className={invalidFieldClass('username')}
                  label="用户名"
                  name="username"
                  rules={[
                    { required: true, whitespace: true, message: '请输入用户名' },
                    { min: 2, message: '用户名至少 2 个字符' },
                    { max: 32, message: '用户名不能超过 32 个字符' },
                  ]}
                >
                  <Input prefix={<UserOutlined />} placeholder="请输入用户名" autoComplete="username" />
                </Form.Item>
              )}

              <Form.Item
                className={invalidFieldClass('email')}
                label="邮箱"
                name="email"
                rules={[{ required: true, message: '请输入邮箱' }, { type: 'email', message: '请输入有效邮箱' }]}
              >
                <Input prefix={<MailOutlined />} placeholder="请输入邮箱地址" autoComplete="email" />
              </Form.Item>

              {!isPasswordChange && <Form.Item
                  className={invalidFieldClass('password')}
                  label="密码"
                  name="password"
                  rules={[{ required: true, message: '请输入密码' }, { min: 6, message: '密码至少 6 位' }]}
                >
                  <Input.Password prefix={<LockOutlined />} placeholder="请输入密码" autoComplete={isRegister ? 'new-password' : 'current-password'} />
                </Form.Item>}

              {isPasswordChange && <>
                <Form.Item
                  className={invalidFieldClass('currentPassword')}
                  label="当前密码"
                  name="currentPassword"
                  rules={[{ required: true, message: '请输入当前密码完成身份验证' }]}
                >
                  <Input.Password prefix={<LockOutlined />} placeholder="请输入当前密码" autoComplete="current-password" />
                </Form.Item>
                <Form.Item
                  className={invalidFieldClass('newPassword')}
                  label="新密码"
                  name="newPassword"
                  rules={[{ required: true, message: '请输入新密码' }, { min: 8, message: '新密码至少 8 位' }]}
                >
                  <Input.Password prefix={<LockOutlined />} placeholder="请输入至少 8 位的新密码" autoComplete="new-password" />
                </Form.Item>
                <Form.Item
                  className={invalidFieldClass('confirmPassword')}
                  label="确认新密码"
                  name="confirmPassword"
                  dependencies={['newPassword']}
                  rules={[
                    { required: true, message: '请再次输入新密码' },
                    ({ getFieldValue }) => ({
                      validator(_, value) {
                        return !value || getFieldValue('newPassword') === value
                          ? Promise.resolve()
                          : Promise.reject(new Error('两次输入的新密码不一致'))
                      },
                    }),
                  ]}
                >
                  <Input.Password prefix={<LockOutlined />} placeholder="请再次输入新密码" autoComplete="new-password" />
                </Form.Item>
                <div className="password-change-note"><SafetyCertificateFilled /> 当前密码仅用于确认账号身份，修改成功后不会保留。</div>
              </>}

              {isPasswordChange ? null : isRegister ? (
                <div className="register-agreement">
                  <div className="auth-check-control">
                    <Form.Item name="agreement" valuePropName="checked" noStyle>
                      <Checkbox aria-label="同意服务条款" />
                    </Form.Item>
                    <span className="auth-check-copy">我已阅读并同意</span>
                    <button type="button" className="auth-inline-link" onClick={() => message.info('服务条款页面等待后续接入')}>服务条款</button>
                  </div>
                </div>
              ) : (
                <div className="login-options">
                  <div className="auth-check-control">
                    <Form.Item name="remember" valuePropName="checked" noStyle>
                      <Checkbox aria-label="记住登录状态" />
                    </Form.Item>
                    <span className="auth-check-copy">记住我</span>
                  </div>
                  <Button className="auth-link" type="link" onClick={() => switchMode('password')}>忘记密码？</Button>
                </div>
              )}

              <Button className="login-submit" type="primary" htmlType="submit" loading={submitting} block>
                {submitting
                  ? isPasswordChange ? '正在修改' : isRegister ? '正在注册' : '正在登录'
                  : isPasswordChange ? '确认修改密码' : isRegister ? '注册' : '登录'}
              </Button>
            </Form>

            <div className="login-signup">
              <span>{isPasswordChange ? '想起当前登录信息了？' : isRegister ? '已有账号？' : '还没有账号？'}</span>
              <Button className="auth-link" type="link" onClick={() => switchMode(isPasswordChange || isRegister ? 'login' : 'register')}>{isPasswordChange || isRegister ? '返回登录' : '申请账号'}</Button>
            </div>
          </div>
        </div>
        <AuthShowcase />
      </section>
    </main>
  )
}
