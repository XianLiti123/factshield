import type { Claim } from '../types'

export type ReviewAction = 'reject' | 'keep' | 'remove' | 'rewrite'
export type ReviewResolution = { action: ReviewAction; note: string }

const REVIEW_DRAFTS_STORAGE_PREFIX = 'factshield.review-drafts.'
const REOPENED_REVIEWS_STORAGE_PREFIX = 'factshield.reopened-reviews.'

export function readReviewDrafts(taskId: string): Record<string, ReviewResolution> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`${REVIEW_DRAFTS_STORAGE_PREFIX}${taskId}`) ?? '{}') as Record<string, ReviewResolution>
    return Object.fromEntries(Object.entries(parsed).filter(([, resolution]) => (
      resolution
      && ['reject', 'keep', 'remove', 'rewrite'].includes(resolution.action)
      && typeof resolution.note === 'string'
    )))
  } catch {
    return {}
  }
}

export function persistReviewDrafts(taskId: string, drafts: Record<string, ReviewResolution>) {
  try {
    const key = `${REVIEW_DRAFTS_STORAGE_PREFIX}${taskId}`
    if (Object.keys(drafts).length > 0) window.localStorage.setItem(key, JSON.stringify(drafts))
    else window.localStorage.removeItem(key)
  } catch {
    // Storage may be unavailable; drafts still remain available until reload.
  }
}

export function readReopenedReviewIds(taskId: string) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`${REOPENED_REVIEWS_STORAGE_PREFIX}${taskId}`) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((claimId): claimId is string => typeof claimId === 'string') : []
  } catch {
    return []
  }
}

export function persistReopenedReviewIds(taskId: string, claimIds: string[]) {
  try {
    const key = `${REOPENED_REVIEWS_STORAGE_PREFIX}${taskId}`
    if (claimIds.length > 0) window.localStorage.setItem(key, JSON.stringify(claimIds))
    else window.localStorage.removeItem(key)
  } catch {
    // Storage may be unavailable; reopened reviews still remain available until reload.
  }
}

export function getStatusBeforeHumanReview(action: string | null | undefined): Claim['status'] {
  return action === 'remove' || action === 'rewrite' ? 'review' : 'conflict'
}
