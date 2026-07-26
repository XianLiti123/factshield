import { CheckCircleFilled, ExclamationCircleFilled, WarningFilled } from '@ant-design/icons'
import type { ClaimStatus } from '../types'

const statusMeta = {
  verified: { label: '可信', icon: <CheckCircleFilled /> },
  review: { label: '待复核', icon: <ExclamationCircleFilled /> },
  conflict: { label: '高度存疑', icon: <WarningFilled /> },
}

export function StatusBadge({ status, compact = false }: { status: ClaimStatus; compact?: boolean }) {
  const meta = statusMeta[status]
  return (
    <span className={`status-badge ${status} ${compact ? 'compact' : ''}`}>
      {meta.icon}<span>{meta.label}</span>
    </span>
  )
}
