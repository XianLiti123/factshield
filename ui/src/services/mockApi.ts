import { researchRuns } from '../mocks/research'
import type { ResearchRun } from '../types'

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

export async function getResearchRuns(): Promise<ResearchRun[]> {
  await delay(420)
  return researchRuns
}
