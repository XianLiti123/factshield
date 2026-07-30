import { useState } from 'react'
import {
  CheckCircleFilled,
  ClockCircleOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons'
import { Button, Form, Input, Modal, Progress, Radio, Select, Table, Tag, Tooltip, Upload, message } from 'antd'
import { useQueryClient } from '@tanstack/react-query'
import { getTaskProgress, useWorkspaceStore } from '../store'
import type { ResearchTaskSession } from '../store'
import { assertResearchReady, createTask as createPersistedTask, deleteTask as deletePersistedTask, stopTask as stopPersistedTask } from '../services/api'

const taskTypeByValue: Record<string, string> = {
  company: 'company',
  policy: 'policy',
  risk: 'risk',
}

export const DEMO_RESEARCH_QUESTION = '核验宁德时代 2025 年经营质量、海外增长与匈牙利工厂进度（演示）'

const normalizeResearchQuestion = (value: unknown) => String(value ?? '')
  .trim()
  .replace(/\s+/g, '')
  .replace(/[。？?]$/g, '')

const isDemoResearchQuestion = (value: unknown) => (
  normalizeResearchQuestion(value) === normalizeResearchQuestion(DEMO_RESEARCH_QUESTION)
)

const phaseMeta = {
  draft: { label: '待启动', className: 'draft', icon: <ClockCircleOutlined /> },
  running: { label: '研究中', className: 'running', icon: <ClockCircleOutlined /> },
  review: { label: '待复核', className: 'review', icon: <SafetyCertificateOutlined /> },
  ready: { label: '已完成', className: 'done', icon: <CheckCircleFilled /> },
  stopped: { label: '已终止', className: 'draft', icon: <PauseCircleOutlined /> },
  failed: { label: '执行失败', className: 'review', icon: <SafetyCertificateOutlined /> },
}

const researchTemplates = [
  {
    key: 'annual-report',
    title: '年报经营质量',
    description: '核验增长、利润含金量、现金流与关键风险',
    meta: '企业研究 · 监管披露优先',
    icon: <FileSearchOutlined />,
    topic: '核验目标公司最近一个完整年度的经营质量、利润含金量、现金流与关键风险',
    type: 'company',
    sources: ['official', 'company'],
  },
  {
    key: 'policy-impact',
    title: '政策影响评估',
    description: '梳理适用范围、实施时间和行业影响',
    meta: '政策研究 · 官方信源优先',
    icon: <FileTextOutlined />,
    topic: '梳理一项新政策的适用范围、关键条款、实施时间，以及对相关行业和公司的影响',
    type: 'policy',
    sources: ['official', 'industry'],
  },
  {
    key: 'risk-trace',
    title: '风险线索核查',
    description: '追查来源、时间线、关联主体与矛盾说法',
    meta: '风险线索 · 多方交叉核验',
    icon: <SafetyCertificateOutlined />,
    topic: '围绕一条风险线索，核验事实来源、发生时间、关联主体，以及相互矛盾的公开说法',
    type: 'risk',
    sources: ['official', 'company', 'media'],
  },
]

type CreatePreset = Pick<(typeof researchTemplates)[number], 'topic' | 'type' | 'sources'>

export function TaskCenter() {
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ResearchTaskSession | null>(null)
  const [creating, setCreating] = useState(false)
  const [taskFilter, setTaskFilter] = useState<'all' | 'running' | 'review' | 'ready'>('all')
  const [createPreset, setCreatePreset] = useState<CreatePreset | null>(null)
  const [form] = Form.useForm()
  const queryClient = useQueryClient()
  const topicValue = Form.useWatch('topic', form)
  const demoQuestionMatched = isDemoResearchQuestion(topicValue)
  const tasks = useWorkspaceStore((state) => state.tasks)
  const activeTaskId = useWorkspaceStore((state) => state.activeTaskId)
  const selectTask = useWorkspaceStore((state) => state.selectTask)
  const setActiveView = useWorkspaceStore((state) => state.setActiveView)
  const addTask = useWorkspaceStore((state) => state.addTask)
  const createDemoTask = useWorkspaceStore((state) => state.createTask)
  const toggleTaskRunning = useWorkspaceStore((state) => state.toggleTaskRunning)
  const deleteTask = useWorkspaceStore((state) => state.deleteTask)

  const runningTasks = tasks.filter((task) => task.phase === 'running')
  const reviewTasks = tasks.filter((task) => task.phase === 'review')
  const readyTasks = tasks.filter((task) => task.phase === 'ready')
  const rows = tasks
    .filter((task) => taskFilter === 'all' || task.phase === taskFilter)
    .map((task) => ({ task }))
  const pendingCount = reviewTasks.reduce(
    (total, task) => total + task.reviewClaimIds.filter((id) => !task.reviewedClaimIds.includes(id)).length,
    0,
  )

  const openCreate = (preset: CreatePreset | null = null) => {
    setCreatePreset(preset)
    setCreateOpen(true)
  }

  const openTask = (task: ResearchTaskSession) => {
    if (task.phase === 'draft') {
      selectTask(task.id)
      message.info('任务和材料已保存；自动研究流水线接通前不会生成虚假结论')
      return
    }
    selectTask(task.id)
    setActiveView('workbench')
  }

  const openReport = (task: ResearchTaskSession) => {
    selectTask(task.id)
    setActiveView('reports')
  }

  const submitTask = async () => {
    const values = await form.validateFields()
    if (isDemoResearchQuestion(values.topic)) {
      createDemoTask({
        title: DEMO_RESEARCH_QUESTION,
        company: '宁德时代 · 300750.SZ',
        category: '流程演示',
      })
      setCreateOpen(false)
      form.resetFields()
      message.success('演示研究已启动，小盾会按阶段跑完一遍并停在待复核')
      return
    }
    setCreating(true)
    try {
      await assertResearchReady()
      const task = await createPersistedTask({
        topic: values.topic.trim(),
        title: values.topic.trim(),
        company: values.company?.trim() || '待识别研究对象',
        researchType: taskTypeByValue[values.type] ?? 'company',
        preferredSources: values.sources ?? [],
      })
      // 后端删除任务后可能复用同一个顺序号，先清掉这个编号曾经留下的详情缓存。
      queryClient.removeQueries({ queryKey: ['research-run', task.id] })
      addTask(task)
      await queryClient.invalidateQueries({ queryKey: ['workspace-tasks'] })
      setCreateOpen(false)
      form.resetFields()
      message.success('研究已启动，小盾正在后台处理')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '任务创建失败')
    } finally {
      setCreating(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      if (deleteTarget.persisted) await deletePersistedTask(deleteTarget.id)
      queryClient.removeQueries({ queryKey: ['research-run', deleteTarget.id] })
      deleteTask(deleteTarget.id)
      await queryClient.invalidateQueries({ queryKey: ['workspace-tasks'] })
      message.success(`已删除“${deleteTarget.title}”`)
      setDeleteTarget(null)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除失败')
    }
  }

  const stopTask = async (task: ResearchTaskSession) => {
    if (!task.persisted) {
      toggleTaskRunning(task.id)
      return
    }
    try {
      await stopPersistedTask(task.id)
      message.success('已提交终止请求，当前节点结束后会停止')
      await queryClient.invalidateQueries({ queryKey: ['workspace-tasks'] })
    } catch (error) {
      message.error(error instanceof Error ? error.message : '终止失败')
    }
  }

  return (
    <div className="task-center">
      <section className="task-page-heading">
        <div>
          <h2>全部研究</h2>
          <p>小盾正在同时处理 {runningTasks.length} 项研究，切换任务不会打断后台进度。</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate()}>新建研究</Button>
      </section>

      <section className="task-kpi-grid" aria-label="任务统计">
        <button type="button" className={taskFilter === 'running' ? 'metric-card active' : 'metric-card'} aria-pressed={taskFilter === 'running'} onClick={() => setTaskFilter('running')}><div><span>进行中</span><strong>{runningTasks.length}</strong><small><i /> {runningTasks.filter((task) => task.isDemoRunning).length} 项正在推进</small></div><ClockCircleOutlined /></button>
        <button type="button" className={taskFilter === 'review' ? 'metric-card active' : 'metric-card'} aria-pressed={taskFilter === 'review'} onClick={() => setTaskFilter('review')}><div><span>等你复核</span><strong>{reviewTasks.length}</strong><small><i className="warn" /> {pendingCount} 项疑点待判断</small></div><SafetyCertificateOutlined /></button>
        <button type="button" className={taskFilter === 'ready' ? 'metric-card active' : 'metric-card'} aria-pressed={taskFilter === 'ready'} onClick={() => setTaskFilter('ready')}><div><span>已完成</span><strong>{readyTasks.length}</strong><small><i /> 底稿可以随时查看</small></div><CheckCircleFilled /></button>
        <button type="button" className={taskFilter === 'all' ? 'metric-card active' : 'metric-card'} aria-pressed={taskFilter === 'all'} onClick={() => setTaskFilter('all')}><div><span>全部任务</span><strong>{tasks.length}</strong><small><i /> 独立保存每条进度</small></div><FileSearchOutlined /></button>
      </section>

      <div className="task-dashboard-grid">
        <section className="page-card task-table-card">
          <div className="task-card-heading">
            <div><strong>任务列表</strong><span>显示 {rows.length} 项 · 按最近更新排序</span></div>
          </div>
          <Table
            pagination={false}
            dataSource={rows}
            rowKey={({ task }) => task.id}
            scroll={{ x: 820 }}
            rowClassName={({ task }) => task.id === activeTaskId ? 'task-row active' : 'task-row'}
            onRow={({ task }) => ({ onDoubleClick: () => openTask(task) })}
            columns={[
              {
                title: '研究任务',
                key: 'task',
                width: 330,
                render: (_, { task }) => (
                  <div className="task-title-cell">
                    <strong>{task.title}</strong>
                    <span>{task.id} · {task.category}</span>
                  </div>
                ),
              },
              {
                title: '状态',
                key: 'status',
                width: 105,
                render: (_, { task }) => {
                  const meta = phaseMeta[task.phase]
                  return <Tag className={`task-status ${meta.className}`} icon={meta.icon}>{task.phase === 'running' && !task.isDemoRunning ? '已暂停' : meta.label}</Tag>
                },
              },
              {
                title: '进度',
                key: 'progress',
                width: 178,
                render: (_, { task }) => (
                  <div className="task-progress-cell"><Progress percent={getTaskProgress(task)} size={[82, 6]} showInfo={false} /><strong>{getTaskProgress(task)}%</strong></div>
                ),
              },
              {
                title: '待处理',
                key: 'pending',
                width: 90,
                render: (_, { task }) => {
                  const count = task.phase === 'review'
                    ? task.reviewClaimIds.filter((id) => !task.reviewedClaimIds.includes(id)).length
                    : 0
                  return count > 0 ? <span className="task-pending-count">{count} 项</span> : <span className="task-empty-count">-</span>
                },
              },
              { title: '更新时间', key: 'updatedAt', width: 110, render: (_, { task }) => task.updatedAt },
              {
                title: '',
                key: 'actions',
                width: 150,
                fixed: 'right',
                render: (_, { task }) => (
                  <div className="task-row-actions">
                    {task.phase !== 'draft' && <Button type="link" onClick={() => openTask(task)}>{task.phase === 'ready' ? '查看复核' : '打开'}</Button>}
                    {task.phase === 'ready' && <Tooltip title="查看研究底稿"><Button aria-label="查看研究底稿" icon={<FileTextOutlined />} onClick={() => openReport(task)} /></Tooltip>}
                    {task.phase === 'running' && (
                      <Tooltip title={task.persisted ? '终止任务' : task.isDemoRunning ? '暂停演示' : '继续演示'}>
                        <Button
                          aria-label={task.persisted ? '终止任务' : task.isDemoRunning ? '暂停演示' : '继续演示'}
                          icon={task.persisted || task.isDemoRunning ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                          onClick={() => stopTask(task)}
                        />
                      </Tooltip>
                    )}
                    <Tooltip title="删除任务"><Button danger aria-label="删除任务" icon={<DeleteOutlined />} onClick={() => setDeleteTarget(task)} /></Tooltip>
                  </div>
                ),
              },
            ]}
          />
        </section>

        <aside className="page-card task-template-card">
          <div className="task-card-heading">
            <div><strong>从模板开始</strong><span>预填问题结构和信源偏好</span></div>
          </div>
          <div className="task-template-list">
            {researchTemplates.map((template) => (
              <button type="button" key={template.key} className="task-template-item" onClick={() => openCreate(template)}>
                <span className="task-template-icon">{template.icon}</span>
                <span className="task-template-copy">
                  <strong>{template.title}</strong>
                  <small>{template.description}</small>
                  <em>{template.meta}</em>
                </span>
                <PlusOutlined />
              </button>
            ))}
            <p className="task-template-note"><SafetyCertificateOutlined /> 只会预填表单，不会直接创建任务。</p>
          </div>
        </aside>
      </div>

      <Modal
        className="research-create-modal"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        footer={null}
        title={null}
        width={960}
        centered
        afterOpenChange={(open) => {
          if (!open) return
          form.resetFields()
          if (createPreset) form.setFieldsValue(createPreset)
        }}
      >
        <div className="research-create-shell">
          <section className="research-create-story">
            <span className="research-create-eyebrow"><SafetyCertificateOutlined /> 新建独立研究</span>
            <h2>把问题交给小盾，<br />每条研究都单独收好。</h2>
            <p>说清楚要核验什么，再把手头材料放进来。任务会独立保存，切去处理其他研究也不会混在一起。</p>
            <div className="research-create-steps" aria-label="创建研究说明">
              <div><span>01</span><strong>确定问题</strong><small>先圈定真正要查的事</small></div>
              <div><span>02</span><strong>补充材料</strong><small>已有文件会随任务归档</small></div>
              <div><span>03</span><strong>保存待办</strong><small>随后可独立查看和管理</small></div>
            </div>
            <div className="research-create-truth"><i /><span>配置齐全后，创建会直接启动真实研究流水线；当前不会保存无法启动的假任务。</span></div>
          </section>

          <section className="research-create-form-panel">
            <header>
              <span>CREATE RESEARCH</span>
              <h3>今天想查清什么？</h3>
              <p>一句话写清研究对象、时间范围和你最关心的问题。</p>
            </header>
            <Form className="research-create-form" form={form} layout="vertical" initialValues={{ type: 'company', sources: ['official', 'company'] }}>
              <Form.Item name="topic" label="研究问题" rules={[{ required: true, message: '请输入研究问题' }]}>
                <Input.TextArea autoFocus rows={4} placeholder="例如：核验某公司 2025 年经营质量、海外增长与关键风险" />
              </Form.Item>
              {demoQuestionMatched && (
                <div className="demo-question-match"><PlayCircleOutlined /><span><strong>已识别演示问题</strong>提交后会直接播放完整处理流程，不访问外部数据。</span></div>
              )}

              <Form.Item className="research-material-field" name="attachments" label="任务附件（等待后端支持绑定）">
                <Upload.Dragger disabled beforeUpload={() => false} multiple accept=".pdf,.xlsx,.xls,.docx,.txt">
                  <p className="ant-upload-drag-icon"><CloudUploadOutlined /></p>
                  <div className="research-upload-copy">
                    <strong>队友原生任务接口暂不接收附件</strong>
                    <span>为避免材料串到其他任务，这里暂不上传</span>
                  </div>
                </Upload.Dragger>
              </Form.Item>

              <details className="research-preferences">
                <summary><span>研究偏好</span><small>可选，不填也能保存</small></summary>
                <div className="research-preferences-body">
                  <div className="form-two-columns">
                    <Form.Item name="company" label="研究对象"><Input placeholder="公司、行业或政策名称" /></Form.Item>
                    <Form.Item name="type" label="研究类型"><Radio.Group options={[{ label: '企业', value: 'company' }, { label: '政策', value: 'policy' }, { label: '风险', value: 'risk' }]} /></Form.Item>
                  </div>
                  <Form.Item name="sources" label="优先信源">
                    <Select mode="multiple" options={[{ label: '监管披露', value: 'official' }, { label: '公司公告', value: 'company' }, { label: '行业机构', value: 'industry' }, { label: '财经媒体', value: 'media' }]} />
                  </Form.Item>
                </div>
              </details>

              <footer className="research-create-actions">
                <span><SafetyCertificateOutlined /> 每条任务拥有独立材料和上下文</span>
                <div><Button onClick={() => setCreateOpen(false)}>暂不创建</Button><Button type="primary" loading={creating} onClick={submitTask}>{demoQuestionMatched ? '启动演示研究' : '保存研究任务'}</Button></div>
              </footer>
            </Form>
          </section>
        </div>
      </Modal>

      <Modal
        title="删除研究任务？"
        open={Boolean(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
        onOk={confirmDelete}
        okText="删除任务"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        width={520}
      >
        <div className="delete-task-confirmation">
          <span><DeleteOutlined /></span>
          <div>
            <strong>{deleteTarget?.title}</strong>
            <p>删除后，这条任务的记录会被移除且无法恢复。</p>
          </div>
        </div>
      </Modal>
    </div>
  )
}
