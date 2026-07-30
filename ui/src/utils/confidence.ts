export type ConfidenceLevel = '高' | '中' | '低'

export function getConfidenceLevel(confidence: number): ConfidenceLevel {
  const score = confidence <= 1 ? confidence * 100 : confidence
  if (score >= 80) return '高'
  if (score >= 60) return '中'
  return '低'
}

export function getConfidenceLevelClass(confidence: number) {
  const level = getConfidenceLevel(confidence)
  return level === '高' ? 'high' : level === '中' ? 'medium' : 'low'
}
