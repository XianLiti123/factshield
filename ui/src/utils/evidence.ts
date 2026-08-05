type EvidenceDisplayInput = {
  title?: string | null
  filename?: string | null
  publisher?: string | null
  sourceType?: string | null
  locator?: string | null
  url?: string | null
}

function cleanLabel(value: string | null | undefined) {
  return value?.replace(/\s+/g, ' ').trim() ?? ''
}

function isInternalEvidenceLabel(value: string) {
  return /^(?:[.·\s-]*)task:[^\s]+(?:\s*第\s*\d+\s*(?:段|页))?$/i.test(value)
    || /^(?:[.·\s-]*)FS-\d{4}[^\s]*(?:\s*第\s*\d+\s*(?:段|页))?$/i.test(value)
}

function fileNameFromUrl(rawUrl: string | null | undefined) {
  const value = cleanLabel(rawUrl)
  if (!value) return ''
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
    const name = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) ?? '')
    return name && name.includes('.') ? name : ''
  } catch {
    return ''
  }
}

export function getEvidenceDisplayName(evidence: EvidenceDisplayInput) {
  const title = cleanLabel(evidence.title)
  if (title && !isInternalEvidenceLabel(title)) return title

  const filename = cleanLabel(evidence.filename) || fileNameFromUrl(evidence.url)
  if (filename) return filename

  const publisher = cleanLabel(evidence.publisher)
  const sourceType = cleanLabel(evidence.sourceType)
  if (publisher && sourceType) return `${publisher} · ${sourceType}`

  const location = cleanLabel(evidence.locator).match(/第\s*\d+\s*(?:段|页|节)/)?.[0]
  const material = sourceType || publisher || '任务材料'
  if (location) return `${material} · ${location}`
  return material === '任务材料' ? '未命名证据' : material
}
