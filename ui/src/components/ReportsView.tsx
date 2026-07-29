import { BarChartOutlined, CheckCircleFilled, DownloadOutlined, EyeOutlined, FilePdfOutlined, FileWordOutlined, HistoryOutlined, PaperClipOutlined } from '@ant-design/icons'
import { Button, Tag, message } from 'antd'
import type { ResearchRun } from '../types'
import { getActiveTask, useWorkspaceStore } from '../store'
import { StatusBadge } from './StatusBadge'

export function ReportsView({ run }: { run: ResearchRun }) {
  const setActiveView = useWorkspaceStore((state) => state.setActiveView)
  const reviewedClaimIds = useWorkspaceStore(getActiveTask).reviewedClaimIds
  const exportMock = (format: string) => message.success(`${format} 底稿已生成（UI 演示）`)

  return (
    <div className="reports-layout">
      <section className="page-card report-list-card">
        <div className="page-card-header"><div><span className="eyebrow">可审计交付物</span><h2>研究底稿</h2><p>每条结论均附原始证据链和双层核验记录。</p></div></div>
        <div className="report-summary">
          <div className="report-cover"><span>FACTSHIELD</span><SafetyLogo /><strong>金融研究事实核验底稿</strong><p>{run.title}</p><small>{run.id} · 2026-07-26</small></div>
          <div className="report-details">
            <h3>{run.title}</h3>
            <p>底稿已生成预览版本，当前包含 5 条事实主张、8 份原始证据、5 份一级核验记录、5 份独立复核记录与 1 份历史情景附件。</p>
            <div className="report-checks"><span><CheckCircleFilled /> 证据链接完整</span><span><CheckCircleFilled /> 引用定位有效</span><span><CheckCircleFilled /> 审计日志已封存</span></div>
            <div className="report-actions"><Button type="primary" icon={<EyeOutlined />} onClick={() => message.info('底稿预览已打开（UI 演示）')}>预览底稿</Button><Button icon={<FilePdfOutlined />} onClick={() => exportMock('PDF')}>导出 PDF</Button><Button icon={<FileWordOutlined />} onClick={() => exportMock('Word')}>导出 Word</Button></div>
            <div className="report-disclaimer">本底稿仅为金融研究辅助材料，不构成任何投资建议；高度存疑内容必须由研究员人工复核。</div>
          </div>
        </div>
        <div className="report-history-appendix">
          <div className="appendix-icon"><BarChartOutlined /></div>
          <div className="appendix-copy"><span>附件 A · 历史情景复盘</span><strong>地方债务治理历史情景时序统计</strong><p>包含 3 个已结束历史事件样本、3 项客观指标和完整数据来源记录；不包含未来判断或观点解读。</p></div>
          <div className="appendix-meta"><Tag color="blue">36 个月窗口</Tag><Tag color="green">数据完整度 94.6%</Tag></div>
          <Button icon={<PaperClipOutlined />} onClick={() => setActiveView('analytics')}>查看附件</Button>
        </div>
        <div className="report-claims">
          <div className="report-claims-title"><strong>结论目录</strong><span>按事实主张排序</span></div>
          {run.claims.map((claim) => (
            <div className="report-claim" key={claim.id}>
              <span>C{String(claim.index).padStart(2, '0')}</span>
              <p>{claim.statement}</p>
              {reviewedClaimIds.includes(claim.id)
                ? <span className="manual-review-status"><CheckCircleFilled /> 已人工复核</span>
                : claim.status === 'verified'
                  ? <span className="auto-pass-status"><CheckCircleFilled /> 可信</span>
                  : <StatusBadge status={claim.status} compact />}
              <strong>{Math.round(claim.confidence * 100)}%</strong>
            </div>
          ))}
        </div>
      </section>
      <aside className="page-card report-side-card">
        <h3><HistoryOutlined /> 版本记录</h3>
        <div className="version-item current"><i /><strong>v0.4 · 历史情景附件版</strong><span>刚刚生成</span><p>追加客观时序统计与来源记录</p></div>
        <div className="version-item"><i /><strong>v0.3 · 双层核验版</strong><span>14:42</span><p>加入独立审查结论与疑点说明</p></div>
        <div className="version-item"><i /><strong>v0.2 · 一级汇总版</strong><span>14:40</span><p>小盾完成证据汇总</p></div>
        <Button block icon={<DownloadOutlined />} onClick={() => message.success('审计日志已生成（UI 演示）')}>下载审计日志</Button>
      </aside>
    </div>
  )
}

function SafetyLogo() {
  return <div className="report-logo">FS</div>
}
