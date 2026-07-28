import { useState } from 'react'
import {
  CheckCircleFilled,
  CloudUploadOutlined,
  DownOutlined,
  FileSearchOutlined,
  HistoryOutlined,
  LinkOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons'
import { Button, Collapse, Input, Select, Upload, message } from 'antd'
import type { ResearchRun } from '../types'
import { useWorkspaceStore } from '../store'

const defaultTopic = '核验宁德时代 2025 年经营质量、海外增长与关键风险'

export function TaskCenter({ run }: { run: ResearchRun }) {
  const [topic, setTopic] = useState(defaultTopic)
  const startResearch = useWorkspaceStore((state) => state.startResearch)
  const openReviewQueue = useWorkspaceStore((state) => state.openReviewQueue)
  const reviewedClaimIds = useWorkspaceStore((state) => state.reviewedClaimIds)
  const unresolvedCount = run.claims.filter((claim) => claim.status !== 'verified' && !reviewedClaimIds.includes(claim.id)).length

  const submitResearch = () => {
    if (!topic.trim()) {
      message.warning('先输入你要研究的问题')
      return
    }
    startResearch(topic.trim())
    message.loading({ content: '已启动研究，系统正在自动采集与核验…', duration: 1.2 })
  }

  return (
    <div className="research-start-page">
      <section className="research-start-card">
        <div className="start-card-copy">
          <span className="start-kicker"><SafetyCertificateOutlined /> 金融研究事实核验</span>
          <h1>把研究问题交给系统，<br />你只处理真正的疑点。</h1>
          <p>系统自动完成资料采集、原文定位、双层核验与证据链整理。无需配置 Agent，也无需逐页摘抄。</p>
        </div>

        <div className="research-composer">
          <label htmlFor="research-topic">今天要研究什么？</label>
          <Input.TextArea
            id="research-topic"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            autoSize={{ minRows: 3, maxRows: 5 }}
            placeholder="输入公司、事件或你想核验的观点"
          />
          <div className="research-upload-row">
            <Upload beforeUpload={() => false} multiple showUploadList={false} accept=".pdf,.xlsx,.xls,.docx,.txt">
              <Button type="text" icon={<CloudUploadOutlined />}>补充本地材料</Button>
            </Upload>
            <span>可选 · PDF / Word / Excel</span>
          </div>

          <Collapse
            ghost
            expandIconPosition="end"
            expandIcon={({ isActive }) => <DownOutlined rotate={isActive ? 180 : 0} />}
            items={[{
              key: 'advanced',
              label: '高级选项',
              children: (
                <div className="research-advanced-options">
                  <div><span>研究类型</span><Select defaultValue="company" options={[{ label: '企业研究', value: 'company' }, { label: '政策研究', value: 'policy' }, { label: '风险线索', value: 'risk' }]} /></div>
                  <div><span>优先信源</span><Select mode="multiple" defaultValue={['official', 'company']} maxTagCount="responsive" options={[{ label: '监管披露', value: 'official' }, { label: '公司公告', value: 'company' }, { label: '行业机构', value: 'industry' }, { label: '财经媒体', value: 'media' }]} /></div>
                  <div className="history-auto-note"><HistoryOutlined /><span><strong>历史情景复盘自动加入</strong>系统会对关键事件匹配历史样本，无需单独配置。</span></div>
                </div>
              ),
            }]}
          />

          <Button className="start-research-button" type="primary" size="large" icon={<FileSearchOutlined />} onClick={submitResearch}>
            开始研究
          </Button>
          <div className="one-click-note"><CheckCircleFilled /> 一次启动，完成后只提醒你处理黄色与红色疑点</div>
        </div>
      </section>

      <section className="recent-research-strip">
        <div className="recent-copy">
          <span>最近研究</span>
          <strong>{run.title}</strong>
          <p>{run.claims.length} 条事实主张 · {run.evidence.length} 份原始证据 · {unresolvedCount} 条待你复核</p>
        </div>
        <div className="recent-statuses">
          <span className="verified"><i /> 可信 3</span>
          <span className="review"><i /> 待复核 1</span>
          <span className="conflict"><i /> 高度存疑 1</span>
        </div>
        <Button icon={<LinkOutlined />} onClick={() => openReviewQueue('claim-3')}>继续处理疑点</Button>
      </section>

      <section className="automatic-work-note">
        <span>系统自动完成</span>
        <div><strong>01</strong><p>采集公开资料与用户材料</p></div>
        <div><strong>02</strong><p>定位原文并生成证据链</p></div>
        <div><strong>03</strong><p>双层核验并筛出疑点</p></div>
        <div><strong>04</strong><p>组装可导出的研究底稿</p></div>
      </section>
    </div>
  )
}
