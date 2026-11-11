import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { GitInfo, SessionInfo } from '../types'

const info = atom({ plugin: 'git-context', key: 'info' } as const, null)
const session = atom({ plugin: 'git-context', key: 'session' } as const, null)
const isOpen = atom({ plugin: 'git-context', key: 'isOpen' } as const, false)

async function git($: any, cwd: string, args: string[]) {
  try {
    const r = await $.process.run(['git', ...args], { cwd, timeoutMs: 10000 })
    return r.exitCode === 0 ? (r.stdout as string).trim() : null
  } catch {
    return null
  }
}

async function refresh($: any) {
  const cwd: string = await $.session.cwd()
  const status = await git($, cwd, ['status', '--porcelain=v2', '--branch'])
  if (status === null) {
    await update($, info, () => null)
    return
  }
  let branch = '(unknown)'
  let upstream: string | null = null
  let ahead = 0
  let behind = 0
  let staged = 0
  let modified = 0
  let untracked = 0
  let conflicted = 0
  for (const line of status.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      branch = line.slice(14)
    } else if (line.startsWith('# branch.upstream ')) {
      upstream = line.slice(18)
    } else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line)
      if (m) {
        ahead = Number(m[1])
        behind = Number(m[2])
      }
    } else if (line.startsWith('? ')) {
      untracked += 1
    } else if (line.startsWith('u ')) {
      conflicted += 1
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const xy = line.split(' ')[1] ?? '..'
      if (xy[0] !== '.') staged += 1
      if (xy[1] !== '.') modified += 1
    }
  }
  const root = (await git($, cwd, ['rev-parse', '--show-toplevel'])) ?? cwd
  const stash = await git($, cwd, ['stash', 'list'])
  const next: GitInfo = {
    repo: root.split('/').pop() || root,
    root,
    branch,
    upstream,
    ahead,
    behind,
    staged,
    modified,
    untracked,
    conflicted,
    stashes: stash ? stash.split('\n').length : 0,
    lastCommit: (await git($, cwd, ['log', '-1', '--format=%h %s'])) ?? '—',
    remote: (await git($, cwd, ['remote', 'get-url', 'origin'])) ?? 'none',
    cwd,
  }
  await update($, info, () => next)
}


async function refreshSession($: any) {
  try {
    const u = await $.session.usage()
    const next: SessionInfo = {
      model: await $.session.model(),
      tokens: u.context.tokens ?? null,
      window: u.context.window,
      percent: u.context.percent ?? null,
      costUsd: u.cost ? u.cost.usd : null,
      limits: (u.rateLimits as { kind: string; percentUsed: number }[]).map(l => ({
        kind: l.kind,
        percentUsed: l.percentUsed,
      })),
      startedAt: u.startedAt,
      now: await $.clock.now(),
      turns: await $.session.turns(),
      version: (await $.session.version()).version,
    }
    await update($, session, () => next)
  } catch {
    // leave the last reading in place
  }
}

function fmtTokens(n: number) {
  return n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? Math.round(n / 1000) + 'k' : String(n)
}

function fmtElapsed(ms: number) {
  const m = Math.max(0, Math.floor(ms / 60000))
  return m >= 60 ? Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0') + 'm' : m + 'm'
}

function pctColor(p: number) {
  return p >= 85 ? 'red' : p >= 60 ? 'yellow' : 'green'
}

function limitName(k: string) {
  return k === 'five_hour' ? '5h' : k === 'seven_day' ? '7d' : k === 'spend_limit' ? 'spend' : k
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    refresh($)
    refreshSession($)
    $.clock.every(15000, () => {
      refresh($)
      refreshSession($)
    })
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    refreshSession($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    refresh($)
    refreshSession($)
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)
    refresh($)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const g = await read($, info)
    const s = await read($, session)
    if (g === null && s === null) return next(e)
    const open = await read($, isOpen)
    const { Box, Text, Button } = $.ui.resolve(e)

    const dirty = g ? g.staged + g.modified + g.untracked + g.conflicted : 0
    const accent = !g ? 'blue' : g.conflicted > 0 ? 'red' : g.behind > 0 || dirty > 0 ? 'yellow' : 'green'

    const Head = (p: { t: string }) => (
      <Box key={p.t}>
        <Text bold color="blue">{p.t}</Text>
      </Box>
    )
    const Row = (p: { k: string; v: string; color?: string }) => (
      <Box key={p.k}>
        <Text dimColor>{'  ' + p.k.padEnd(11)}</Text>
        <Text color={p.color as any}>{p.v}</Text>
      </Box>
    )
    const num = (n: number, color: string) => ({ v: String(n), color: n > 0 ? color : undefined })

    const bar = (pct: number) => {
      const filled = Math.max(0, Math.min(8, Math.round((pct / 100) * 8)))
      return '█'.repeat(filled) + '░'.repeat(8 - filled)
    }

    const toggle = (
      <Button
        key="toggle"
        label={open ? 'Hide details' : 'Details'}
        onPress={() => update($, isOpen, v => !v)}
      />
    )

    const gitRow = g ? (
      <Box key="git">
        <Text color={accent}>▌ </Text>
        <Text bold>{g.repo}</Text>
        <Text>  </Text>
        <Text backgroundColor="cyan" color="black" bold> ⎇ {g.branch} </Text>
        <Text>  </Text>
        {g.behind > 0 ? (
          <Text backgroundColor="yellow" color="black" bold> ↓{g.behind} in </Text>
        ) : (
          <Text dimColor>↓0 in</Text>
        )}
        <Text>  </Text>
        {g.ahead > 0 ? (
          <Text backgroundColor="green" color="black" bold> ↑{g.ahead} out </Text>
        ) : (
          <Text dimColor>↑0 out</Text>
        )}
        <Text>  </Text>
        {g.conflicted > 0 ? (
          <Text backgroundColor="red" color="white" bold> ✖ {g.conflicted} conflicts </Text>
        ) : dirty > 0 ? (
          <Text color="yellow">● {dirty} changed</Text>
        ) : (
          <Text color="green">✓ clean</Text>
        )}
        <Text> </Text>
        {toggle}
      </Box>
    ) : null

    const sessionRow = s ? (
      <Box key="session">
        <Text color={e.props.isWorking ? 'yellow' : 'green'}>{e.props.isWorking ? '◐ ' : '● '}</Text>
        <Text backgroundColor="magenta" color="black" bold> {s.model} </Text>
        {s.percent !== null ? (
          <Text>
            <Text dimColor>  ctx </Text>
            <Text color={pctColor(s.percent)}>{bar(s.percent)} {Math.round(s.percent)}%</Text>
            <Text dimColor> {s.tokens !== null ? fmtTokens(s.tokens) : '?'}/{fmtTokens(s.window)}</Text>
          </Text>
        ) : (
          <Text dimColor>  ctx —/{fmtTokens(s.window)}</Text>
        )}
        {s.costUsd !== null ? <Text color="cyan">  ${s.costUsd.toFixed(2)}</Text> : null}
        {s.limits.map(l => (
          <Text key={l.kind} color={pctColor(l.percentUsed)}>  {limitName(l.kind)} {Math.round(l.percentUsed)}%</Text>
        ))}
        <Text dimColor>  ⏱ {fmtElapsed(s.now - s.startedAt)}  ↻ {s.turns}</Text>
        {!g ? <Text> </Text> : null}
        {!g ? toggle : null}
      </Box>
    ) : null

    return (
      <Box flexDirection="column">
        {gitRow}
        {sessionRow}
        {open ? (
          <Box flexDirection="column" borderStyle="round" borderColor={accent} paddingX={1}>
            {g ? (
              <Box flexDirection="column">
                <Box>
                  <Text bold color="cyan">⎇ {g.branch}</Text>
                  <Text dimColor>  {g.repo}</Text>
                </Box>
                <Head t="SYNC" />
                <Row k="upstream" v={g.upstream ?? 'none (no tracking branch)'} color={g.upstream ? undefined : 'red'} />
                <Row k="↓ incoming" v={`${g.behind} to pull`} color={g.behind > 0 ? 'yellow' : undefined} />
                <Row k="↑ outgoing" v={`${g.ahead} to push`} color={g.ahead > 0 ? 'green' : undefined} />
                <Head t="WORKTREE" />
                <Row k="● staged" {...num(g.staged, 'green')} />
                <Row k="● modified" {...num(g.modified, 'yellow')} />
                <Row k="? new" {...num(g.untracked, 'magenta')} />
                <Row k="✖ conflicts" {...num(g.conflicted, 'red')} />
                <Row k="⚑ stashes" {...num(g.stashes, 'cyan')} />
                <Head t="CONTEXT" />
                <Row k="HEAD" v={g.lastCommit} />
                <Row k="ORIGIN" v={g.remote} />
                <Row k="ROOT" v={g.root} />
                <Row k="CWD" v={g.cwd} />
              </Box>
            ) : null}
            {s ? (
              <Box flexDirection="column">
                <Head t="CLAUDE SESSION" />
                <Row k="model" v={s.model} color="magenta" />
                <Row
                  k="context"
                  v={s.percent !== null ? `${Math.round(s.percent)}% (${s.tokens !== null ? s.tokens.toLocaleString() : '?'} of ${s.window.toLocaleString()} tokens)` : `window ${s.window.toLocaleString()} tokens`}
                  color={s.percent !== null ? pctColor(s.percent) : undefined}
                />
                <Row k="cost" v={s.costUsd !== null ? `$${s.costUsd.toFixed(4)}` : 'n/a'} color="cyan" />
                {s.limits.map(l => (
                  <Row key={l.kind} k={limitName(l.kind)} v={`${l.percentUsed}% used`} color={pctColor(l.percentUsed)} />
                ))}
                <Row k="elapsed" v={fmtElapsed(s.now - s.startedAt)} />
                <Row k="prompts" v={String(s.turns)} />
                <Row k="version" v={s.version} />
              </Box>
            ) : null}
          </Box>
        ) : null}
      </Box>
    )
  })
}
