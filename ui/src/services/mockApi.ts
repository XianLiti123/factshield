import { researchRun } from '../mocks/research'
import type { ResearchRun } from '../types'

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

export async function getResearchRun(): Promise<ResearchRun> {
  await delay(420)
  return researchRun
}
