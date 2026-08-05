export type ClaimStatus = 'verified' | 'review' | 'conflict'
export type AgentStatus = 'done' | 'running' | 'waiting' | 'warning'

export interface Evidence {
  id: string
  title: string
  filename?: string
  publisher: string
  publishedAt: string
  url?: string
  locator: string
  quote: string
  sourceType: string
  relation: 'support' | 'challenge'
  credibility: number
  credibilityLevel: '高' | '中' | '低' | ''
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
  humanAction?: string | null
  humanNote?: string | null
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

export interface AgentQuestion {
  id: string
  question: string
  options: string[]
  allowCustom: boolean
  answer?: string | null
  actor?: string | null
  node?: string | null
  status?: 'pending' | 'answered' | 'cancelled' | string | null
  createdAt?: string | null
  answeredAt?: string | null
}

export interface ResearchRun {
  id: string
  title: string
  company: string
  createdAt: string
  progress: number
  status?: 'running' | 'review' | 'ready' | 'stopped' | 'failed'
  claims: Claim[]
  evidence: Evidence[]
  agents: AgentInfo[]
  waitingQuestion?: AgentQuestion | null
}
