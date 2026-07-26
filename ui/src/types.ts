export type ClaimStatus = 'verified' | 'review' | 'conflict'
export type AgentStatus = 'done' | 'running' | 'waiting' | 'warning'

export interface Evidence {
  id: string
  title: string
  publisher: string
  publishedAt: string
  locator: string
  quote: string
  sourceType: string
  relation: 'support' | 'challenge'
  credibility: number
}

export interface Claim {
  id: string
  index: number
  statement: string
  status: ClaimStatus
  confidence: number
  category: string
  supervisorVerdict: string
  reviewerVerdict: string
  conflictReason?: string
  issueType?: string
  evidenceIds: string[]
}

export interface AgentInfo {
  id: string
  name: string
  role: string
  status: AgentStatus
  detail: string
  duration?: string
  restriction?: string
}

export interface ResearchRun {
  id: string
  title: string
  company: string
  createdAt: string
  progress: number
  claims: Claim[]
  evidence: Evidence[]
  agents: AgentInfo[]
}
