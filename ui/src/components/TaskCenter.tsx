import { useMemo, useState } from 'react'
import {
  CheckCircleFilled,
  ClockCircleOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  FileSearchOutlined,
  MoreOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons'
import { Button, Dropdown, Form, Input, Modal, Progress, Radio, Select, Table, Tag, Tooltip, Upload, message } from 'antd'
import type { ResearchRun } from '../types'
import { getTaskProgress, useWorkspaceStore } from '../store'
import type { ResearchTaskSession } from '../store'

const taskTypeByValue: Record<string, string> = {
  company: '企业研究',
  policy: '政策研究',
  risk: '风险线索',
}

const phaseMeta = {
  draft: { label: '待启动', className: 'draft', icon: <ClockCircleOutlined /> },
  running: { label: '研究中', className: 'running', icon: <ClockCircleOutlined /> },
  review: { label: '待复核', className: 'review', icon: <SafetyCertificateOutlined /> },
  ready: { label: '已完成', className: 'done', icon: <CheckCircleFilled /> },
}

export function TaskCenter({ runs }: { runs: ResearchRun[] }) {
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ResearchTaskSession | null>(null)
  const [form] = Form.useForm()
  const tasks = useWorkspaceStore((state) => state.tasks)
  const activeTaskId = useWorkspaceStore((state) => state.activeTaskId)
  const selectTask = useWorkspaceStore((state) => state.selectTask)
  const setActiveView = useWorkspaceStore((state) => state.setActiveView)
  const createTask = useWorkspaceStore((state) => state.createTask)
  const toggleTaskRunning = useWorkspaceStore((state) => state.toggleTaskRunning)
  const deleteTask = useWorkspaceStore((state) => state.deleteTask)

  const runById = useMemo(() => new Map(runs.map((run) => [run.id, run])), [runs])
  const rows = tasks.map((task) => ({ task, run: runById.get(task.id) ?? runs[0] }))
  const runningTasks = tasks.filter((task) => task.phase === 'running')
  const reviewTasks = tasks.filter((task) => task.phase === 'review')
  const readyTasks = tasks.filter((task) => task.phase === 'ready')
  const pendingCount = reviewTasks.reduce(
    (total, task) => total + task.reviewClaimIds.filter((id) => !task.reviewedClaimIds.includes(id)).length,
    0,
  )

  const openTask = (task: ResearchTaskSession) => {
    selectTask(task.id)
    setActiveView(task.phase === 'ready' ? 'reports' : 'workbench')
  }

  const submitTask = async () => {
    const values = await form.validateFields()
    createTask({
      title: values.topic.trim(),
      company: values.company?.trim() || '待识别研究对象',
      category: taskTypeByValue[values.type] ?? '企业研究',
    })
    setCreateOpen(false)
    form.resetFields()
    message.success('新任务已加入，小盾会和其他任务一起处理')
  }

  const confirmDelete = () => {
    if (!deleteTarget) return
    deleteTask(deleteTarget.id)
    message.success(`已删除“${deleteTarget.title}”`)
    setDeleteTarget(null)
  }

  return (
    <div className="task-center">
      <section className="task-page-heading">
        <div>
          <h2>全部研究</h2>
          <p>小盾正在同时处理 {runningTasks.length} 项研究，切换任务不会打断后台进度。</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建研究</Button>
      </section>

      <section className="task-kpi-grid" aria-label="任务统计">
        <div className="metric-card"><div><span>进行中</span><strong>{runningTasks.length}</strong><small><i /> {runningTasks.filter((task) => task.isDemoRunning).length} 项正在推进</small></div><ClockCircleOutlined /></div>
        <div className="metric-card"><div><span>等你复核</span><strong>{reviewTasks.length}</strong><small><i className="warn" /> {pendingCount} 项疑点待判断</small></div><SafetyCertificateOutlined /></div>
        <div className="metric-card"><div><span>已完成</span><strong>{readyTasks.length}</strong><small><i /> 底稿可以随时查看</small></div><CheckCircleFilled /></div>
        <div className="metric-card"><div><span>全部任务</span><strong>{tasks.length}</strong><small><i /> 独立保存每条进度</small></div><FileSearchOutlined /></div>
      </section>

      <div className="task-dashboard-grid">
        <section className="page-card task-table-card">
          <div className="task-card-heading">
            <div><strong>任务列表</strong><span>按最近更新排序</span></div>
            <Button icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>添加任务</Button>
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
                width: 150,
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
                    <Button type="link" onClick={() => openTask(task)}>{task.phase === 'ready' ? '查看底稿' : '打开'}</Button>
                    {task.phase === 'running' && (
                      <Tooltip title={task.isDemoRunning ? '暂停任务' : '继续任务'}>
                        <Button
                          aria-label={task.isDemoRunning ? '暂停任务' : '继续任务'}
                          icon={task.isDemoRunning ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                          onClick={() => toggleTaskRunning(task.id)}
                        />
                      </Tooltip>
                    )}
                    <Dropdown menu={{ items: [
                      { key: 'open', label: '打开任务', onClick: () => openTask(task) },
                      { type: 'divider' },
                      {
                        key: 'delete',
                        danger: true,
                        disabled: tasks.length <= 1,
                        icon: <DeleteOutlined />,
                        label: tasks.length <= 1 ? '至少保留一条任务' : '删除任务',
                        onClick: () => setDeleteTarget(task),
                      },
                    ] }}>
                      <Button aria-label="更多操作" icon={<MoreOutlined />} />
                    </Dropdown>
                  </div>
                ),
              },
            ]}
          />
        </section>

        <aside className="page-card parallel-queue-card">
          <div className="task-card-heading">
            <div><strong>正在处理</strong><span>{runningTasks.length} 项并行任务</span></div>
            <span className="parallel-live"><i /> 实时更新</span>
          </div>
          <div className="parallel-task-list">
            {runningTasks.map((task) => (
              <button key={task.id} className={task.id === activeTaskId ? 'parallel-task active' : 'parallel-task'} onClick={() => openTask(task)}>
                <span className="parallel-task-top"><strong>{task.title}</strong><em>{getTaskProgress(task)}%</em></span>
                <Progress percent={getTaskProgress(task)} showInfo={false} size="small" status={task.isDemoRunning ? 'active' : 'normal'} />
                <span className="parallel-task-meta"><i className={task.isDemoRunning ? 'running' : 'paused'} /> {task.isDemoRunning ? '小盾正在查' : '已暂停'}<small>{task.updatedAt}</small></span>
              </button>
            ))}
          </div>
          {reviewTasks[0] && (
            <button className="queue-next-action" onClick={() => openTask(reviewTasks[0])}>
              <span><SafetyCertificateOutlined /></span>
              <div><small>接下来处理</small><strong>{reviewTasks[0].title}</strong><p>{pendingCount} 项疑点等你判断</p></div>
            </button>
          )}
        </aside>
      </div>

      <Modal title="新建研究" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={submitTask} okText="开始研究" cancelText="取消" width={680}>
        <div className="mock-notice"><SafetyCertificateOutlined /><span>提交后会创建一条独立任务，并与当前研究同时运行。</span></div>
        <Form form={form} layout="vertical" initialValues={{ type: 'company', sources: ['official', 'company'] }}>
          <Form.Item name="topic" label="今天要研究什么？" rules={[{ required: true, message: '请输入研究问题' }]}>
            <Input.TextArea rows={3} placeholder="例如：核验某公司年度经营数据与海外业务增长情况" />
          </Form.Item>
          <div className="form-two-columns">
            <Form.Item name="company" label="研究对象（可选）"><Input placeholder="公司、行业或政策名称" /></Form.Item>
            <Form.Item name="type" label="研究类型"><Radio.Group options={[{ label: '企业研究', value: 'company' }, { label: '政策研究', value: 'policy' }, { label: '风险线索', value: 'risk' }]} /></Form.Item>
          </div>
          <Form.Item name="sources" label="优先信源">
            <Select mode="multiple" options={[{ label: '监管披露', value: 'official' }, { label: '公司公告', value: 'company' }, { label: '行业机构', value: 'industry' }, { label: '财经媒体', value: 'media' }]} />
          </Form.Item>
          <Form.Item label="补充材料（可选）">
            <Upload.Dragger beforeUpload={() => false} multiple accept=".pdf,.xlsx,.xls,.docx,.txt">
              <p className="ant-upload-drag-icon"><CloudUploadOutlined /></p>
              <p className="ant-upload-text">点击或拖拽 PDF、Excel、Word 文件到这里</p>
            </Upload.Dragger>
          </Form.Item>
        </Form>
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
            <p>删除后，这条任务的研究进度、证据上下文和复核记录都会移除，当前演示中无法恢复。</p>
          </div>
        </div>
      </Modal>
    </div>
  )
}
