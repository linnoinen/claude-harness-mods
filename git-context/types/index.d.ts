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

declare module 'claude-code' {
  interface PluginState {
    'git-context': { info: GitInfo | null; isOpen: boolean }
  }
}
