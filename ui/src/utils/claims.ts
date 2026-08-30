import type { Claim } from '../types'

const legacyRewriteNotes = new Set([
  '按现有证据调整表述',
  '调整表述',
])

export function getRewrittenClaimStatement(claim: Claim) {
  if (claim.humanAction !== 'rewrite') return null
  const rewrittenStatement = claim.humanNote?.trim()
  if (!rewrittenStatement || legacyRewriteNotes.has(rewrittenStatement)) return null
  return rewrittenStatement
}

export function getClaimDisplayStatement(claim: Claim) {
  return getRewrittenClaimStatement(claim) ?? claim.statement
}

export function isClaimRemoved(claim: Claim) {
  return claim.humanAction === 'remove'
}
