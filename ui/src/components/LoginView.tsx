import { useState, type AnimationEvent } from 'react'
import { LockOutlined, MailOutlined, UserOutlined } from '@ant-design/icons'
import { Button, Checkbox, Form, Input, message } from 'antd'
import { login, register, setToken, type UserInfo } from '../services/api'

interface LoginValues {
  username?: string
  email: string
  password: string
  remember: boolean
  agreement?: boolean
}

type AuthMode = 'login' | 'register'
type TransitionPhase = 'idle' | 'exit' | 'enter'
type TransitionDirection = 'forward' | 'backward'

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
      direction: target === 'register' ? 'forward' : 'backward',
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
      const response = await register(values.email, values.password)
      setToken(response.token)
      message.success('账号已创建')
      onLogin(response.user)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '注册失败')
    } finally {
      setSubmitting(false)
    }
  }

  const isRegister = mode === 'register'
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
          <div
            key={mode}
            className={`login-form-wrap auth-panel ${panelMotionClass}`}
            onAnimationEnd={handlePanelAnimationEnd}
          >
            <div className="login-heading">
              <h1>{isRegister ? '创建账号' : '欢迎回来'}</h1>
              <p>{isRegister ? '创建您的金融研究工作台账号' : '请输入您的工作台账号信息'}</p>
            </div>

            <Form<LoginValues>
              key={mode}
              className="login-form"
              layout="vertical"
              initialValues={isRegister ? { agreement: true } : { remember: true }}
              requiredMark={false}
              onFinish={isRegister ? submitRegistration : submitLogin}
              onFinishFailed={handleValidationFailed}
            >
              {isRegister && (
                <Form.Item className={invalidFieldClass('username')} label="用户名" name="username">
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

              <Form.Item
                className={invalidFieldClass('password')}
                label="密码"
                name="password"
                rules={[{ required: true, message: '请输入密码' }, { min: 6, message: '密码至少 6 位' }]}
              >
                <Input.Password prefix={<LockOutlined />} placeholder="请输入密码" autoComplete={isRegister ? 'new-password' : 'current-password'} />
              </Form.Item>

              {isRegister ? (
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
                  <Button className="auth-link" type="link" onClick={() => message.info('找回密码功能等待后端接入')}>忘记密码？</Button>
                </div>
              )}

              <Button className="login-submit" type="primary" htmlType="submit" loading={submitting} block>
                {submitting ? (isRegister ? '正在注册' : '正在登录') : (isRegister ? '注册' : '登录')}
              </Button>
            </Form>

            <div className="login-signup">
              <span>{isRegister ? '已有账号？' : '还没有账号？'}</span>
              <Button className="auth-link" type="link" onClick={() => switchMode(isRegister ? 'login' : 'register')}>{isRegister ? '返回登录' : '申请账号'}</Button>
            </div>
          </div>
        </div>
        <div className="login-visual-placeholder" aria-hidden="true" />
      </section>
    </main>
  )
}
