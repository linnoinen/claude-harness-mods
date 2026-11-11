import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { GitInfo } from '../types'

const info = atom({ plugin: 'git-context', key: 'info' } as const, null)
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


export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    refresh($)
    $.clock.every(15000, () => refresh($))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    refresh($)
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)
    refresh($)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const g = await read($, info)
    if (g === null) return next(e)
    const open = await read($, isOpen)
    const { Box, Text, Button } = $.ui.resolve(e)

    const dirty = g.staged + g.modified + g.untracked + g.conflicted

    const Row = (p: { k: string; v: string }) => (
      <Box key={p.k}>
        <Text dimColor>{p.k.padEnd(10)}</Text>
        <Text>{p.v}</Text>
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Box>
          <Text bold>{g.repo}</Text>
          <Text dimColor> on </Text>
          <Text bold color="cyan">{g.branch}</Text>
          <Text>  </Text>
          <Text color={g.behind > 0 ? 'yellow' : undefined} dimColor={g.behind === 0}>↓{g.behind} in</Text>
          <Text>  </Text>
          <Text color={g.ahead > 0 ? 'green' : undefined} dimColor={g.ahead === 0}>↑{g.ahead} out</Text>
          <Text dimColor>{dirty > 0 ? `  ● ${dirty} changed` : '  ✓ clean'} </Text>
          <Button
            key="toggle"
            label={open ? 'Hide details' : 'Details'}
            onPress={() => update($, isOpen, v => !v)}
          />
        </Box>
        {open ? (
          <Box flexDirection="column" borderStyle="round" paddingX={1}>
            <Row k="Repo" v={g.root} />
            <Row k="Branch" v={g.branch} />
            <Row k="Upstream" v={g.upstream ?? 'none (no tracking branch)'} />
            <Row k="Incoming" v={`${g.behind} commit(s) to pull`} />
            <Row k="Outgoing" v={`${g.ahead} commit(s) to push`} />
            <Row k="Staged" v={String(g.staged)} />
            <Row k="Modified" v={String(g.modified)} />
            <Row k="Untracked" v={String(g.untracked)} />
            <Row k="Conflicts" v={String(g.conflicted)} />
            <Row k="Stashes" v={String(g.stashes)} />
            <Row k="Last" v={g.lastCommit} />
            <Row k="Remote" v={g.remote} />
            <Row k="Cwd" v={g.cwd} />
          </Box>
        ) : null}
      </Box>
    )
  })
}
