export type RouteMode = 'router' | 'continued' | 'fallback' | 'manual' | 'default'

export type RouteEntry = {
  /** the turn's id */
  id: string
  at: number
  prompt: string
  mode: RouteMode
  /** category the classifier picked, '' when the router was off */
  category: string
  reason: string
  /** who classified: 'claude:haiku', 'external', '' */
  classifier: string
  classifyMs: number
  /** model asked for ('' = session default) */
  model: string
  /** effort asked for ('' = session default) */
  effort: string
  /** model the engine had resolved for the first step, before any rewrite */
  sessionModel: string
  steps: number
  inputTokens: number
  outputTokens: number
  durationMs: number
  status: 'running' | 'done' | 'aborted' | 'error' | 'refused'
}

declare module 'claude-code' {
  interface PluginState {
    'model-router': {
      enabled: boolean
      backend: string
      manualModel: string
      manualEffort: string
      log: Shaped<RouteEntry[]>
      selected: string | null
    }
  }
}
