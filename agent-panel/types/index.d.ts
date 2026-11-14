export type Step = { tool: string; detail: string; at: number }

export type Agent = {
  id: string
  description: string
  type: string
  status: string
  parentId: string
  startedAt: number
  endedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'agent-panel': {
      agents: Shaped<Agent[]>
      steps: Shaped<Record<string, Step[]>>
      selected: string | null
      now: number
    }
  }
}
