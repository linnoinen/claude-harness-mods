export type Run = {
  id: number
  workflow: string
  title: string
  branch: string
  event: string
  status: string
  conclusion: string
  createdAt: number
  updatedAt: number
  url: string
}

export type Watch = { repo: string; number: number; last: string }

export type Pr = {
  number: number
  title: string
  author: string
  draft: boolean
  review: string
  branch: string
  checks: string
  updatedAt: number
  url: string
}

declare module 'claude-code' {
  interface PluginState {
    'github-panel': {
      runs: Shaped<Run[]>
      error: string | null
      now: number
      repo: string | null
      branch: string | null
      allBranches: boolean
      project: string
      prs: Shaped<Pr[]>
      tab: string
      watched: Shaped<Watch[]>
      selected: number | null
      prRuns: Shaped<Run[]>
      repos: Shaped<string[]>
    }
  }
}
