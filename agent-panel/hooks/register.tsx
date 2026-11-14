import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Agent, Step } from '../types'

const PANE = 'agent-panel'
const KEEP = 40

const agents = atom({ plugin: 'agent-panel', key: 'agents' } as const, [], { shape: 'agents-1' })
const steps = atom({ plugin: 'agent-panel', key: 'steps' } as const, {}, { shape: 'steps-1' })
const selected = atom({ plugin: 'agent-panel', key: 'selected' } as const, null)
const now = atom({ plugin: 'agent-panel', key: 'now' } as const, 0)

const LIVE = ['pending', 'running', 'waiting', 'idle']
const isLive = (a: Agent) => LIVE.includes(a.status)

const clip = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, Math.max(1, n - 1)) + '…' : one
}

function dur(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return s + 's'
  const m = Math.floor(s / 60)
  return m < 60 ? m + 'm' + String(s % 60).padStart(2, '0') + 's' : Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0') + 'm'
}

function look(status: string): { icon: string; color: string } {
  switch (status) {
    case 'running': return { icon: '◐', color: 'yellow' }
    case 'pending': return { icon: '○', color: 'cyan' }
    case 'waiting':
    case 'idle': return { icon: '◌', color: 'cyan' }
    case 'completed': return { icon: '✓', color: 'green' }
    case 'failed': return { icon: '✗', color: 'red' }
    case 'killed': return { icon: '⊘', color: 'gray' }
    default: return { icon: '•', color: 'gray' }
  }
}

function detailOf(e: Record<string, unknown>): string {
  for (const k of ['command', 'file_path', 'path', 'pattern', 'url', 'query', 'description', 'prompt', 'skill']) {
    const v = e[k]
    if (typeof v === 'string' && v) return v
  }
  return ''
}

async function sync($: any) {
  try {
    const list = (await $.agent.list()) as any[]
    const t = Date.now()
    await update($, agents, (prev: Agent[]) => {
      const before = new Map(prev.map(a => [a.id, a]))
      const next: Agent[] = list.map(x => {
        const old = before.get(x.id)
        const live = LIVE.includes(x.status)
        return {
          id: x.id,
          description: x.description || x.name || x.type,
          type: x.type,
          status: x.status,
          parentId: x.parentId ?? '',
          startedAt: old?.startedAt ?? t,
          endedAt: live ? 0 : old?.endedAt || t,
        }
      })
      // keep agents the engine has already forgotten, so a finished one stays readable
      for (const a of prev) if (!list.some(x => x.id === a.id)) next.push({ ...a, status: LIVE.includes(a.status) ? 'completed' : a.status, endedAt: a.endedAt || t })
      return next.slice(-30)
    })
    await update($, now, () => t)
  } catch (err) {
    // try again next tick
  }
}

async function record($: any, id: string, step: Step) {
  await update($, steps, (m: Record<string, Step[]>) => ({ ...m, [id]: [...(m[id] ?? []), step].slice(-KEEP) }))
  void sync($)
}

async function view($: any, e: any, rows: number) {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, agents)
    const log = await read($, steps)
    const sel = await read($, selected)
    const t = (await read($, now)) || Date.now()
    const cols = Math.min(e.viewport?.columns ?? 48, 56)
    const live = list.filter(isLive)
    const done = list.filter(a => !isLive(a)).reverse()
    const chosen = sel ? list.find(a => a.id === sel) : undefined

    if (chosen) {
      const s = look(chosen.status)
      const mine = log[chosen.id] ?? []
      const took = (chosen.endedAt || t) - chosen.startedAt
      return (
        <Box flexDirection="column">
          <Box>
            <Button key="back" label="← All agents" onPress={() => update($, selected, () => null)} />
            <Text> </Text>
            <Button key="view" label="Open transcript" onPress={async () => {
              const r = await $.ui.view({ agentId: chosen.id })
              if (r.deny) await $.ui.toast(r.deny)
            }} />
          </Box>
          <Text> </Text>
          <Text bold>{clip(chosen.description, cols - 2)}</Text>
          <Text>
            <Text color={s.color as any} bold>{s.icon} {chosen.status}</Text>
            <Text dimColor> · {chosen.type} · {dur(took)}</Text>
          </Text>
          <Text> </Text>
          <Text bold color="blue">TASKS · {mine.length} tool call{mine.length === 1 ? '' : 's'}</Text>
          {mine.length === 0 ? <Text dimColor>No tool calls yet.</Text> : null}
          {mine.slice().reverse().slice(0, Math.max(2, rows - 9)).map((m, i) => (
            <Box key={'step-' + i} flexDirection="column">
              <Text>
                <Text color={chosen.id && i === 0 && isLive(chosen) ? 'yellow' : 'gray'}>{i === 0 && isLive(chosen) ? '▸ ' : '  '}</Text>
                <Text bold>{m.tool}</Text>
                <Text dimColor> {dur(t - m.at)} ago</Text>
              </Text>
              {m.detail ? <Text dimColor>{'    ' + clip(m.detail, cols - 6)}</Text> : null}
            </Box>
          ))}
        </Box>
      )
    }

    const row = (a: Agent) => {
      const s = look(a.status)
      const mine = log[a.id] ?? []
      const last = mine[mine.length - 1]
      const took = (a.endedAt || t) - a.startedAt
      return (
        <Box key={a.id} flexDirection="column">
          <Box>
            <Text color={s.color as any} bold>{s.icon} </Text>
            <Button key={'agent-' + a.id} label={clip(a.description, cols - 8)} onPress={() => update($, selected, () => a.id)} />
          </Box>
          <Text dimColor>{'  ' + a.type + ' · ' + dur(took) + ' · ' + mine.length + ' calls'}</Text>
          {isLive(a) ? (
            <Text>
              <Text color="yellow">{'  ▸ '}</Text>
              <Text>{last ? last.tool + (last.detail ? ' ' + clip(last.detail, cols - 10 - last.tool.length) : '') : 'starting…'}</Text>
            </Text>
          ) : null}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box>
          <Text bold>Subagents</Text>
          <Text> </Text>
          {live.length > 0 ? <Text backgroundColor="yellow" color="black" bold> ◐ {live.length} working </Text> : <Text dimColor>◐ 0 working</Text>}
          <Text dimColor>  ✓ {done.length}</Text>
        </Box>
        <Text> </Text>
        {list.length === 0 ? <Text dimColor>No subagents yet. They show up here when Claude spawns one.</Text> : null}
        {live.slice(0, Math.max(1, Math.floor((rows - 3) / 3))).map(row)}
        {done.length > 0 && live.length > 0 ? <Text dimColor>── finished ──</Text> : null}
        {done.slice(0, Math.max(1, rows - 5 - live.length * 3)).map(row)}
      </Box>
    )
}

// the host's pane (github-panel) gets the agents section as its lower half
const HOST = 'github-panel'
let hosted = false

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'agent-panel', description: 'Show the subagents panel: every running subagent and what it is doing' })
    void sync($)
    $.clock.every(1000, () => void sync($))
    // no host pane drawn after a few seconds: seat our own
    $.clock.after(4000, () => {
      if (!hosted) void $.ui.open({ id: PANE, title: 'Agents' })
    })
    return next(e)
  })

  on('command.run', { command: 'agent-panel' }, async ($, e) => {
    if (!hosted) await $.ui.open({ id: PANE, title: 'Agents' })
    else await $.ui.open({ id: HOST, title: 'GitHub' })
    void sync($)
    return { text: hosted ? 'Agents are in the lower half of the right-hand pane.' : 'Agents panel opened.' }
  })

  // every tool call a subagent makes is a step in its log; the main loop has no agentId
  on('tool.call', async ($, e, next) => {
    const id = (e as { agentId?: string }).agentId
    if (id) {
      try {
        await record($, id, { tool: String((e as any).tool), detail: detailOf(e as any), at: Date.now() })
      } catch (err) {
        // never let the log hold up a tool call
      }
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    void sync($)
    return next(e)
  })

  // split the host pane: its own view on top, the agents below
  on('ui.render', { component: 'Pane', requestId: HOST }, async ($, e, next) => {
    hosted = true
    const total = e.viewport?.rows ?? 30
    const lower = Math.max(8, Math.floor(total * 0.45))
    const upper = Math.max(6, total - lower - 1)
    const top = await next({ ...e, viewport: { ...e.viewport, rows: upper } })
    const { Box, Text } = $.ui.resolve(e)
    const bottom = await view($, e, lower)
    return (
      <Box flexDirection="column">
        <Box flexDirection="column" height={upper} overflow="hidden">{top}</Box>
        <Text dimColor>{'─'.repeat(Math.min(e.viewport?.columns ?? 48, 56))}</Text>
        <Box flexDirection="column" height={lower} overflow="hidden">{bottom}</Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => view($, e, e.viewport?.rows ?? 30))
}
