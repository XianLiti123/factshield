import { BarChartOutlined, CheckCircleFilled, DownloadOutlined, EyeOutlined, FilePdfOutlined, FileWordOutlined, HistoryOutlined, PaperClipOutlined } from '@ant-design/icons'
import { Button, Modal, Tag, message } from 'antd'
import { useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ResearchRun } from '../types'
import { getActiveTask, useWorkspaceStore } from '../store'
import { StatusBadge } from './StatusBadge'
import { exportReport, getAuditLog, getReport, type ReportExportFormat } from '../services/api'

const reportMarkdownComponents: Components = {
  a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
  table: ({ children }) => <div className="report-markdown-table"><table>{children}</table></div>,
}

type WritableExportFile = {
  write: (data: Blob) => Promise<void>
  close: () => Promise<void>
}

type ExportFileHandle = {
  name: string
  createWritable: () => Promise<WritableExportFile>
}

type PreparedReportExport = {
  format: ReportExportFormat
  blob: Blob
  filename: string
}

type SaveFilePicker = (options: {
  suggestedName: string
  excludeAcceptAllOption: boolean
  types: Array<{ description: string; accept: Record<string, string[]> }>
}) => Promise<ExportFileHandle>

const exportFileTypes: Record<ReportExportFormat, { description: string; accept: Record<string, string[]> }> = {
  pdf: { description: 'PDF 文档', accept: { 'application/pdf': ['.pdf'] } },
  docx: {
    description: 'Word 文档',
    accept: { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] },
  },
}

function getSaveFilePicker() {
  return (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker?.bind(window)
}

function downloadWithBrowser(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function ReportsView({ run }: { run: ResearchRun }) {
  const setActiveView = useWorkspaceStore((state) => state.setActiveView)
  const activeTask = useWorkspaceStore(getActiveTask)
  const reviewedClaimIds = activeTask.reviewedClaimIds
  const [reportContent, setReportContent] = useState('')
  const [reportOpen, setReportOpen] = useState(false)
  const [exportingFormat, setExportingFormat] = useState<ReportExportFormat | null>(null)
  const [preparedExport, setPreparedExport] = useState<PreparedReportExport | null>(null)
  const [savingExport, setSavingExport] = useState(false)
  const previewReport = async () => {
    if (!activeTask.persisted) {
      message.info('当前是 UI 演示底稿')
      return
    }
    try {
      const report = await getReport(run.id)
      setReportContent(report.content)
      setReportOpen(true)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '底稿加载失败')
    }
  }
  const downloadReport = async (format: ReportExportFormat) => {
    if (!activeTask.persisted) {
      message.info('演示任务暂无真实底稿可导出')
      return
    }
    setExportingFormat(format)
    try {
      const { blob, filename } = await exportReport(run.id, format)
      setPreparedExport({ format, blob, filename })
    } catch (error) {
      message.error(error instanceof Error ? error.message : '底稿导出失败')
    } finally {
      setExportingFormat(null)
    }
  }
  const savePreparedReport = async () => {
    if (!preparedExport) return
    setSavingExport(true)
    try {
      const picker = getSaveFilePicker()
      if (picker) {
        const fileHandle = await picker({
          suggestedName: preparedExport.filename,
          excludeAcceptAllOption: true,
          types: [exportFileTypes[preparedExport.format]],
        })
        const writable = await fileHandle.createWritable()
        await writable.write(preparedExport.blob)
        await writable.close()
        message.success(`${preparedExport.format === 'pdf' ? 'PDF' : 'Word'} 底稿已保存为 ${fileHandle.name}`)
      } else {
        downloadWithBrowser(preparedExport.blob, preparedExport.filename)
        message.success('文件已下载到浏览器默认下载目录')
      }
      setPreparedExport(null)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      message.error(error instanceof Error ? error.message : '文件保存失败')
    } finally {
      setSavingExport(false)
    }
  }
  const downloadAudit = async () => {
    if (!activeTask.persisted) {
      message.success('审计日志已生成（UI 演示）')
      return
    }
    try {
      const audit = await getAuditLog(run.id)
      const blob = new Blob([JSON.stringify(audit, null, 2)], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${run.id}-audit-log.json`
      link.click()
      URL.revokeObjectURL(url)
      message.success('真实审计日志已下载')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '审计日志下载失败')
    }
  }

  return (
    <div className="reports-layout">
      <section className="page-card report-list-card">
        <div className="page-card-header"><div><span className="eyebrow">可审计交付物</span><h2>当前交付版本</h2><p>每条结论均附原始证据链和双层核验记录。</p></div></div>
        <div className="report-summary">
          <div className="report-cover"><span>FACTSHIELD</span><SafetyLogo /><strong>金融研究事实核验底稿</strong><p>{run.title}</p><small>{run.id} · 2026-07-26</small></div>
          <div className="report-details">
            <h3>{run.title}</h3>
            <p>底稿已生成预览版本，当前包含 5 条事实主张、8 份原始证据、5 份一级核验记录、5 份独立复核记录与 1 份历史情景附件。</p>
            <div className="report-checks"><span><CheckCircleFilled /> 证据链接完整</span><span><CheckCircleFilled /> 引用定位有效</span><span><CheckCircleFilled /> 审计日志已封存</span></div>
            <div className="report-actions"><Button type="primary" icon={<EyeOutlined />} onClick={previewReport}>预览底稿</Button><Button icon={<FilePdfOutlined />} loading={exportingFormat === 'pdf'} disabled={exportingFormat !== null && exportingFormat !== 'pdf'} onClick={() => downloadReport('pdf')}>导出 PDF</Button><Button icon={<FileWordOutlined />} loading={exportingFormat === 'docx'} disabled={exportingFormat !== null && exportingFormat !== 'docx'} onClick={() => downloadReport('docx')}>导出 Word</Button></div>
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
        <Button block icon={<DownloadOutlined />} onClick={downloadAudit}>下载审计日志</Button>
      </aside>
      <Modal className="report-preview-modal" title={`${run.id} · 底稿预览`} open={reportOpen} onCancel={() => setReportOpen(false)} footer={null} width={900}>
        <article className="report-markdown-preview">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={reportMarkdownComponents}>{reportContent}</ReactMarkdown>
        </article>
      </Modal>
      <Modal
        title="底稿文件已生成"
        open={preparedExport !== null}
        closable={!savingExport}
        maskClosable={!savingExport}
        onCancel={() => setPreparedExport(null)}
        footer={[
          <Button key="cancel" disabled={savingExport} onClick={() => setPreparedExport(null)}>取消</Button>,
          <Button key="save" type="primary" icon={<DownloadOutlined />} loading={savingExport} onClick={savePreparedReport}>
            {getSaveFilePicker() ? '选择保存位置' : '下载文件'}
          </Button>,
        ]}
      >
        {preparedExport && (
          <div className="report-export-ready">
            <strong>{preparedExport.filename}</strong>
            <span>{preparedExport.format === 'pdf' ? 'PDF 文档' : 'Word 文档'} · {formatFileSize(preparedExport.blob.size)}</span>
            <p>文件内容已完整生成并通过格式校验，现在可以选择保存位置。</p>
          </div>
        )}
      </Modal>
    </div>
  )
}

function SafetyLogo() {
  return <div className="report-logo">FS</div>
}
