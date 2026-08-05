import type { Claim } from '../types'

export type ReviewAction = 'reject' | 'keep' | 'remove' | 'rewrite'
export type ReviewResolution = { action: ReviewAction; note: string }
export type ReviewWorkspaceState = { inspectionOpen: boolean; visibility: 'issues' | 'all' }

const REVIEW_DRAFTS_STORAGE_PREFIX = 'factshield.review-drafts.'
const REOPENED_REVIEWS_STORAGE_PREFIX = 'factshield.reopened-reviews.'
const REVIEW_WORKSPACE_STORAGE_PREFIX = 'factshield.review-workspace.'

const DEFAULT_REVIEW_WORKSPACE_STATE: ReviewWorkspaceState = {
  inspectionOpen: false,
  visibility: 'issues',
}

export function readReviewWorkspaceState(taskId: string): ReviewWorkspaceState {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`${REVIEW_WORKSPACE_STORAGE_PREFIX}${taskId}`) ?? '{}') as Partial<ReviewWorkspaceState>
    return {
      inspectionOpen: parsed.inspectionOpen === true,
      visibility: parsed.visibility === 'all' ? 'all' : 'issues',
    }
  } catch {
    return DEFAULT_REVIEW_WORKSPACE_STATE
  }
}

export function persistReviewWorkspaceState(taskId: string, state: ReviewWorkspaceState) {
  try {
    window.localStorage.setItem(`${REVIEW_WORKSPACE_STORAGE_PREFIX}${taskId}`, JSON.stringify(state))
  } catch {
    // Storage may be unavailable; the current workspace state still survives until unmount.
  }
}

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

export function getEffectiveReviewedClaimIds(
  taskId: string,
  reviewClaimIds: string[],
  backendReviewedClaimIds: string[],
) {
  const draftClaimIds = new Set(Object.keys(readReviewDrafts(taskId)))
  const reviewedClaimIds = new Set(backendReviewedClaimIds)
  const reopenedClaimIds = new Set(readReopenedReviewIds(taskId))
  return reviewClaimIds.filter((claimId) => (
    !reopenedClaimIds.has(claimId)
    && (reviewedClaimIds.has(claimId) || draftClaimIds.has(claimId))
  ))
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

export function getStatusBeforeHumanReview(action: string | null | undefined, note?: string | null): Claim['status'] {
  return action === 'remove' || action === 'rewrite' || (action === 'keep' && note?.startsWith('确认按原表述'))
    ? 'review'
    : 'conflict'
}
