export const ATTACHMENT_ACCEPT = '.pdf,.xlsx,.xls,.docx,.txt'
export const MAX_ATTACHMENT_FILES = 5
export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024

const supportedExtensions = new Set(['pdf', 'xlsx', 'xls', 'docx', 'txt'])

export function attachmentKey(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`
}

export function formatAttachmentSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

export function mergeAttachmentFiles(current: File[], incoming: File[]) {
  const accepted: File[] = []
  const rejected: string[] = []
  const known = new Set(current.map(attachmentKey))

  for (const file of incoming) {
    const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!supportedExtensions.has(extension)) {
      rejected.push(`${file.name}：不支持该格式`)
      continue
    }
    if (file.size > MAX_ATTACHMENT_SIZE) {
      rejected.push(`${file.name}：超过 10MB`)
      continue
    }
    const key = attachmentKey(file)
    if (known.has(key)) continue
    if (current.length + accepted.length >= MAX_ATTACHMENT_FILES) {
      rejected.push(`${file.name}：一次最多添加 ${MAX_ATTACHMENT_FILES} 个附件`)
      continue
    }
    known.add(key)
    accepted.push(file)
  }

  return { files: [...current, ...accepted], rejected }
}
