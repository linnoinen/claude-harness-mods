export type GitInfo = {
  repo: string
  root: string
  branch: string
  upstream: string | null
  ahead: number
  behind: number
  staged: number
  modified: number
  untracked: number
  conflicted: number
  stashes: number
  lastCommit: string
  remote: string
  cwd: string
}

export type SessionInfo = {
  model: string
  tokens: number | null
  window: number
  percent: number | null
  costUsd: number | null
  limits: { kind: string; percentUsed: number }[]
  startedAt: number
  now: number
  turns: number
  version: string
}

declare module 'claude-code' {
  interface PluginState {
    'git-context': { info: GitInfo | null; session: SessionInfo | null; isOpen: boolean }
  }
}
