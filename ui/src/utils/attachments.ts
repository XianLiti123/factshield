export const ATTACHMENT_ACCEPT = '.pdf,.xlsx,.xls,.docx,.txt'
export const ASSISTANT_ATTACHMENT_ACCEPT = `${ATTACHMENT_ACCEPT},.jpg,.jpeg,.png,.gif,.bmp,.webp,.tif,.tiff`
export const MAX_ATTACHMENT_FILES = 5
export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024

const supportedExtensions = new Set(['pdf', 'xlsx', 'xls', 'docx', 'txt'])
const imageExtensions = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tif', 'tiff'])
const assistantSupportedExtensions = new Set([...supportedExtensions, ...imageExtensions])

export function attachmentKey(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`
}

export function formatAttachmentSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

export function isImageAttachment(file: Pick<File, 'name' | 'type'>) {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  return file.type.startsWith('image/') || imageExtensions.has(extension)
}

function mergeFiles(current: File[], incoming: File[], allowedExtensions: Set<string>) {
  const accepted: File[] = []
  const rejected: string[] = []
  const known = new Set(current.map(attachmentKey))

  for (const file of incoming) {
    const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!allowedExtensions.has(extension)) {
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

export function mergeAttachmentFiles(current: File[], incoming: File[]) {
  return mergeFiles(current, incoming, supportedExtensions)
}

export function mergeAssistantAttachmentFiles(current: File[], incoming: File[]) {
  return mergeFiles(current, incoming, assistantSupportedExtensions)
}
