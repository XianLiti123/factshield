import { useState } from 'react'
import {
  CheckCircleFilled,
  ClockCircleOutlined,
  CloudUploadOutlined,
  FilePdfOutlined,
  FileSearchOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons'
import { Button, Form, Input, Modal, Radio, Select, Table, Tag, Upload, message } from 'antd'
import type { ResearchRun } from '../types'
import { useWorkspaceStore } from '../store'

const taskRows = [
  { key: '1', id: 'FS-2026-0726-018', title: '宁德时代 2025 年经营质量与海外增长核验', type: '企业研究', status: '核验中', time: '今天 14:32', claims: 5, evidence: 24 },
  { key: '2', id: 'FS-2026-0725-011', title: '新能源汽车产业链政策调整事实核验', type: '政策研究', status: '已完成', time: '昨天 16:08', claims: 12, evidence: 47 },
  { key: '3', id: 'FS-2026-0723-006', title: '城投债务指标与公开披露口径核对', type: '风险研究', status: '待复核', time: '07-23 10:21', claims: 8, evidence: 31 },
]

export function TaskCenter({ run }: { run: ResearchRun }) {
  const [createOpen, setCreateOpen] = useState(false)
  const [form] = Form.useForm()
  const setActiveView = useWorkspaceStore((state) => state.setActiveView)
  const startDemo = useWorkspaceStore((state) => state.startDemo)

  const enterWorkbench = () => setActiveView('workbench')
  const submitMockTask = async () => {
    await form.validateFields()
    message.success('Mock 研究任务已创建，正在进入运行演示')
    setCreateOpen(false)
    setActiveView('workbench')
    startDemo()
  }

  return (
    <div className="task-center">
      <section className="task-hero page-card">
        <div>
          <span className="eyebrow">金融研究辅助工作台</span>
          <h1>从研究问题到可追溯证据底稿</h1>
          <p>输入研究主题或上传公开材料，系统运行过程以 Mock 数据演示；最终研判始终由研究员完成。</p>
        </div>
        <Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建研究任务</Button>
      </section>

      <section className="task-guide-grid">
        <div className="guide-card"><span>01</span><FileSearchOutlined /><div><strong>提交研究需求</strong><p>输入宏观、行业、政策或风险研究主题，也可上传 PDF、Excel 公开材料。</p></div></div>
        <div className="guide-card"><span>02</span><SafetyCertificateOutlined /><div><strong>观察隔离核验</strong><p>查看主控派发、原子 SubAgent 独立运行与双层核验状态。</p></div></div>
        <div className="guide-card"><span>03</span><FilePdfOutlined /><div><strong>审阅证据底稿</strong><p>集中复核待复核、高度存疑内容，点击结论即可返回原文定位。</p></div></div>
      </section>

      <section className="page-card task-table-card">
        <div className="page-card-header">
          <div><span className="eyebrow">Mock 历史数据</span><h2>研究任务</h2><p>查看运行状态、核验结果和可审计底稿。</p></div>
          <Button icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>创建任务</Button>
        </div>
        <Table
          pagination={false}
          dataSource={taskRows}
          onRow={(record) => ({ onClick: record.id === run.id ? enterWorkbench : undefined })}
          rowClassName={(record) => record.id === run.id ? 'clickable-row' : ''}
          columns={[
            { title: '任务编号', dataIndex: 'id', width: 165, render: (value) => <span className="task-id">{value}</span> },
            { title: '研究主题', dataIndex: 'title', render: (value, record) => <div className="task-title-cell"><strong>{value}</strong><span>{record.type}</span></div> },
            { title: '状态', dataIndex: 'status', width: 105, render: (value) => <Tag className={`task-status ${value === '已完成' ? 'done' : value === '待复核' ? 'review' : 'running'}`} icon={value === '已完成' ? <CheckCircleFilled /> : <ClockCircleOutlined />}>{value}</Tag> },
            { title: '事实主张', dataIndex: 'claims', width: 90, render: (value) => `${value} 条` },
            { title: '原始证据', dataIndex: 'evidence', width: 90, render: (value) => `${value} 份` },
            { title: '更新时间', dataIndex: 'time', width: 115 },
            { title: '', width: 92, render: (_, record) => <Button type="link" disabled={record.id !== run.id} onClick={enterWorkbench}>打开任务</Button> },
          ]}
        />
      </section>

      <Modal title="新建研究任务" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={submitMockTask} okText="启动研究任务" cancelText="取消" width={680}>
        <div className="mock-notice"><SafetyCertificateOutlined /><span>当前为 UI 原型，提交后将使用内置 Mock 数据演示运行流程，不会上传或处理真实文件。</span></div>
        <Form form={form} layout="vertical" initialValues={{ type: 'company', sources: ['official', 'company'] }}>
          <Form.Item name="topic" label="研究主题" rules={[{ required: true, message: '请输入研究主题' }]}>
            <Input.TextArea rows={3} placeholder="例如：核验某公司年度经营数据与海外业务增长情况" />
          </Form.Item>
          <div className="form-two-columns">
            <Form.Item name="type" label="研究类型"><Radio.Group options={[{ label: '企业研究', value: 'company' }, { label: '政策研究', value: 'policy' }, { label: '风险线索', value: 'risk' }]} /></Form.Item>
            <Form.Item name="sources" label="公开信源范围"><Select mode="multiple" options={[{ label: '监管机构', value: 'official' }, { label: '公司公告', value: 'company' }, { label: '行业机构', value: 'industry' }, { label: '财经媒体', value: 'media' }]} /></Form.Item>
          </div>
          <Form.Item label="补充公开材料（可选）">
            <Upload.Dragger beforeUpload={() => false} multiple accept=".pdf,.xlsx,.xls,.docx">
              <p className="ant-upload-drag-icon"><CloudUploadOutlined /></p><p className="ant-upload-text">点击或拖拽 PDF、Excel、Word 文件到此处</p><p className="ant-upload-hint">仅用于界面展示，不会实际上传</p>
            </Upload.Dragger>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
