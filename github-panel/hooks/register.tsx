import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Pr, Run, Watch } from '../types'

const PANE = 'github-panel'
const runs = atom({ plugin: 'github-panel', key: 'runs' } as const, [], { shape: 'runs-1' })
const error = atom({ plugin: 'github-panel', key: 'error' } as const, null)
const now = atom({ plugin: 'github-panel', key: 'now' } as const, 0)
const repo = atom({ plugin: 'github-panel', key: 'repo' } as const, null)
const branch = atom({ plugin: 'github-panel', key: 'branch' } as const, null)
const project = atom({ plugin: 'github-panel', key: 'project' } as const, '')
const repos = atom({ plugin: 'github-panel', key: 'repos' } as const, [], { shape: 'repos-1' })
const prs = atom({ plugin: 'github-panel', key: 'prs' } as const, [], { shape: 'prs-1' })
const tab = atom({ plugin: 'github-panel', key: 'tab' } as const, 'actions')
const selected = atom({ plugin: 'github-panel', key: 'selected' } as const, null)
const prRuns = atom({ plugin: 'github-panel', key: 'prRuns' } as const, [], { shape: 'prruns-1' })
const watched = atom({ plugin: 'github-panel', key: 'watched' } as const, [], { shape: 'watched-1' })
const allBranches = atom({ plugin: 'github-panel', key: 'allBranches' } as const, false)

async function run($: any, cwd: string, cmd: string[]) {
  try {
    const r = await $.process.run(cmd, { cwd, timeoutMs: 20000 })
    return r.exitCode === 0
      ? { ok: true, out: (r.stdout as string).trim() }
      : { ok: false, out: ((r.stderr as string) || (r.stdout as string)).trim() }
  } catch (err) {
    return { ok: false, out: 'gh not found' }
  }
}

let busy = false

function parseRuns(out: string): Run[] {
  return (JSON.parse(out || '[]') as any[]).map(x => ({
    id: x.databaseId,
    workflow: x.workflowName ?? '',
    title: x.displayTitle ?? '',
    branch: x.headBranch ?? '',
    event: x.event ?? '',
    status: x.status ?? '',
    conclusion: x.conclusion ?? '',
    createdAt: Date.parse(x.createdAt),
    updatedAt: Date.parse(x.updatedAt),
    url: x.url ?? '',
  }))
}

const RUN_FIELDS = 'databaseId,workflowName,displayTitle,headBranch,event,status,conclusion,createdAt,updatedAt,url'

async function loadPrRuns($: any) {
  const num = await read($, selected)
  if (num === null) return
  const pr = (await read($, prs)).find(p => p.number === num)
  if (!pr) return
  const cwd: string = await $.session.cwd()
  const chosen = await read($, project)
  const r = await run($, cwd, [
    'gh', 'run', 'list', '--limit', '20', '--branch', pr.branch, '--json', RUN_FIELDS,
    ...(chosen ? ['-R', chosen] : []),
  ])
  if (r.ok) {
    try {
      await update($, prRuns, () => parseRuns(r.out))
    } catch (err) {
      await update($, prRuns, () => [])
    }
  }
}

let watching = false

const sameWatch = (a: Watch, repoName: string, num: number) => a.repo === repoName && a.number === num

async function snapshot($: any, w: Watch) {
  const cwd: string = await $.session.cwd()
  const r = await run($, cwd, [
    'gh', 'pr', 'view', String(w.number), ...(w.repo ? ['-R', w.repo] : []),
    '--json', 'title,state,reviewDecision,statusCheckRollup,url,headRefName',
  ])
  if (!r.ok) return null
  const x = JSON.parse(r.out)
  const checks: any[] = x.statusCheckRollup ?? []
  const result = (c: any) => c.conclusion || c.state || ''
  const failed = checks.filter(c => ['FAILURE', 'ERROR', 'TIMED_OUT', 'STARTUP_FAILURE', 'CANCELLED'].includes(result(c)))
  const pending = checks.filter(c => (c.status && c.status !== 'COMPLETED') || c.state === 'PENDING' || c.state === 'EXPECTED')
  return {
    title: x.title as string,
    url: x.url as string,
    state: x.state as string,
    review: (x.reviewDecision || '') as string,
    checks: checks.length === 0 ? 'none' : failed.length > 0 && pending.length === 0 ? 'failing' : pending.length > 0 ? 'pending' : 'passing',
    failed: failed.map(c => `${c.name || c.context} (${c.detailsUrl || c.targetUrl || 'no link'})`),
  }
}

async function pollWatched($: any) {
  if (watching) return
  watching = true
  try {
    for (const w of await read($, watched)) {
      const snap = await snapshot($, w)
      if (!snap) continue
      const sig = `${snap.state}|${snap.review}|${snap.checks}`
      if (w.last === sig) continue
      const was = w.last ? w.last.split('|') : null
      const changes: string[] = []
      if (was) {
        if (was[2] !== snap.checks && snap.checks !== 'pending') changes.push(`checks are now ${snap.checks}`)
        if (was[1] !== snap.review) changes.push(`review decision is now ${snap.review || 'none'}`)
        if (was[0] !== snap.state) changes.push(`the PR is now ${snap.state}`)
      }
      await update($, watched, list => list.map(o => (sameWatch(o, w.repo, w.number) ? { ...o, last: sig } : o)))
      if (!was || changes.length === 0) continue
      const label = `${w.repo || 'this repo'} PR #${w.number} "${snap.title}"`
      let text = `[github-panel watch] ${label}: ${changes.join('; ')}. ${snap.url}`
      if (snap.checks === 'failing') {
        text += `\nFailed checks: ${snap.failed.join(', ')}.\nLook at the failing logs (for example \`gh run view <run-id> --log-failed\`), tell me what is wrong and propose a fix.`
      } else if (snap.checks === 'passing' && snap.state === 'OPEN') {
        text += '\nAll checks pass. Tell me briefly whether anything else blocks the merge.'
      } else {
        text += '\nSummarise what changed and whether I need to act.'
      }
      if (snap.state !== 'OPEN') await update($, watched, list => list.filter(o => !sameWatch(o, w.repo, w.number)))
      await $.ui.toast(`PR #${w.number}: ${changes.join('; ')}`)
      void $.prompt.submit({ text })
    }
  } catch (err) {
    // try again next tick
  } finally {
    watching = false
  }
}

async function watchPr($: any, num: number, repoName: string) {
  const list = await read($, watched)
  if (list.some(o => sameWatch(o, repoName, num))) return false
  await update($, watched, l => [...l, { repo: repoName, number: num, last: '' }])
  await pollWatched($)
  return true
}

async function unwatchPr($: any, num: number, repoName: string) {
  await update($, watched, l => l.filter(o => !sameWatch(o, repoName, num)))
}

async function togglePrWatch($: any, num: number) {
  const repoName = await read($, project)
  const list = await read($, watched)
  if (list.some(o => sameWatch(o, repoName, num))) await unwatchPr($, num, repoName)
  else await watchPr($, num, repoName)
}

function parsePrRef(input: string): { num: number; repoName: string } | null {
  const url = /github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/.exec(input)
  if (url) return { num: Number(url[2]), repoName: url[1]! }
  const m = /^#?(\d+)(?:\s+(\S+\/\S+))?$/.exec(input.trim())
  return m ? { num: Number(m[1]), repoName: m[2] ?? '' } : null
}

async function openUrl($: any, url: string) {
  if (!url) return
  const cwd: string = await $.session.cwd()
  for (const bin of ['open', 'xdg-open']) {
    const r = await run($, cwd, [bin, url])
    if (r.ok) return
  }
  await $.ui.toast('Could not open the browser: ' + url)
}

async function toggle($: any, num: number) {
  const was = await read($, selected)
  await update($, prRuns, () => [])
  await update($, selected, () => (was === num ? null : num))
  if (was !== num) await loadPrRuns($)
}

async function loadRepos($: any) {
  const cwd: string = await $.session.cwd()
  const r = await run($, cwd, ['gh', 'repo', 'list', '--limit', '100', '--json', 'nameWithOwner', '-q', '.[].nameWithOwner'])
  if (r.ok) await update($, repos, () => r.out.split('\n').filter(Boolean))
}

async function choose($: any, name: string) {
  await update($, project, () => name.trim())
  await update($, runs, () => [])
  await update($, prs, () => [])
  await update($, selected, () => null)
  await update($, prRuns, () => [])
  await refresh($)
}

async function refresh($: any) {
  if (busy) return
  busy = true
  try {
    const cwd: string = await $.session.cwd()
    const br = await run($, cwd, ['git', 'rev-parse', '--abbrev-ref', 'HEAD'])
    const current = br.ok ? br.out : null
    const chosen = await read($, project)
    const all = (await read($, allBranches)) || chosen !== ''
    const args = [
      'gh', 'run', 'list', '--limit', '30',
      '--json', RUN_FIELDS,
    ]
    if (chosen) args.push('-R', chosen)
    if (!all && current && current !== 'HEAD') args.push('--branch', current)
    const r = await run($, cwd, args)
    const pr = await run($, cwd, [
      'gh', 'pr', 'list', '--limit', '30', '--state', 'open',
      '--json', 'number,title,author,isDraft,reviewDecision,headRefName,updatedAt,url,statusCheckRollup',
      ...(chosen ? ['-R', chosen] : []),
    ])
    if (pr.ok) {
      const plist: Pr[] = (JSON.parse(pr.out || '[]') as any[]).map(x => {
        const checks: any[] = x.statusCheckRollup ?? []
        const failing = checks.some(c => ['FAILURE', 'ERROR', 'TIMED_OUT', 'STARTUP_FAILURE'].includes(c.conclusion ?? c.state))
        const pending = checks.some(c => (c.status && c.status !== 'COMPLETED') || c.state === 'PENDING' || c.state === 'EXPECTED')
        return {
          number: x.number,
          title: x.title ?? '',
          author: x.author?.login ?? '',
          draft: !!x.isDraft,
          review: x.reviewDecision ?? '',
          branch: x.headRefName ?? '',
          checks: checks.length === 0 ? 'none' : failing ? 'failing' : pending ? 'pending' : 'passing',
          updatedAt: Date.parse(x.updatedAt),
          url: x.url ?? '',
        }
      })
      await update($, prs, () => plist)
      await loadPrRuns($)
    } else {
      await update($, prs, () => [])
    }
    const name = chosen
      ? { ok: true, out: chosen }
      : await run($, cwd, ['gh', 'repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'])
    await update($, now, () => Date.now())
    await update($, branch, () => (chosen ? null : current))
    if (name.ok) await update($, repo, () => name.out)
    if (!r.ok) {
      await update($, error, () => (r.out.split('\n')[0] || 'gh failed').slice(0, 120))
      return
    }
    const list = parseRuns(r.out)
    list.sort((a, b) => Number(b.status !== 'completed') - Number(a.status !== 'completed'))
    await update($, runs, () => list)
    await update($, error, () => null)
  } catch (err) {
    await update($, error, () => 'could not read runs')
  } finally {
    busy = false
  }
}

function look(r: Run): { icon: string; color: string; label: string } {
  if (r.status === 'completed') {
    switch (r.conclusion) {
      case 'success': return { icon: '✓', color: 'green', label: 'passed' }
      case 'failure': return { icon: '✗', color: 'red', label: 'failed' }
      case 'cancelled': return { icon: '⊘', color: 'gray', label: 'cancelled' }
      case 'skipped': return { icon: '↷', color: 'gray', label: 'skipped' }
      case 'timed_out': return { icon: '⏱', color: 'red', label: 'timed out' }
      case 'action_required': return { icon: '!', color: 'yellow', label: 'action needed' }
      default: return { icon: '•', color: 'gray', label: r.conclusion || 'done' }
    }
  }
  if (r.status === 'in_progress') return { icon: '◐', color: 'yellow', label: 'running' }
  return { icon: '○', color: 'cyan', label: r.status.replace('_', ' ') || 'queued' }
}

function dur(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return s + 's'
  const m = Math.floor(s / 60)
  return m < 60 ? m + 'm' + String(s % 60).padStart(2, '0') + 's' : Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0') + 'm'
}

function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  return Math.floor(s / 86400) + 'd ago'
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'github-panel', description: 'Open the GitHub side panel; /github-panel owner/repo picks a project' })
    void $.ui.open({ id: PANE, title: 'GitHub' })
    await $.command.register({ name: 'gh-watch', description: 'Watch a PR: /gh-watch 12 [owner/repo] or a PR URL; Claude is told when checks, review or state change' })
    await $.command.register({ name: 'gh-unwatch', description: 'Stop watching a PR: /gh-unwatch 12 [owner/repo]' })
    await $.tool.register({
      name: 'watch_pr',
      description: 'Watch a GitHub pull request. You are prompted automatically when its checks finish (pass or fail), its review decision changes, or it is merged or closed. Use after opening a PR or when asked to babysit one.',
      inputSchema: { type: 'object', properties: { number: { type: 'number' }, repo: { type: 'string', description: 'owner/name; omit for the current directory repo' } }, required: ['number'] },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'unwatch_pr',
      description: 'Stop watching a GitHub pull request started with watch_pr.',
      inputSchema: { type: 'object', properties: { number: { type: 'number' }, repo: { type: 'string' } }, required: ['number'] },
      isDeferred: false,
    })
    refresh($)
    loadRepos($)
    pollWatched($)
    $.clock.every(15000, () => {
      refresh($)
      pollWatched($)
    })
    return next(e)
  })

  on('command.run', { command: 'github-panel' }, async ($, e) => {
    await $.ui.open({ id: PANE, title: 'GitHub' })
    const arg = e.args.trim()
    if (arg) await choose($, arg === 'current' ? '' : arg)
    else refresh($)
    return { text: 'GitHub Actions panel opened.' }
  })

  on('command.run', { command: 'gh-watch' }, async ($, e) => {
    const ref = parsePrRef(e.args)
    if (!ref) return { text: 'Usage: /gh-watch <number> [owner/repo] or a PR URL' }
    const added = await watchPr($, ref.num, ref.repoName)
    return { text: added ? `Watching PR #${ref.num}. Claude is told when it changes.` : `Already watching PR #${ref.num}.` }
  })

  on('command.run', { command: 'gh-unwatch' }, async ($, e) => {
    const ref = parsePrRef(e.args)
    if (!ref) return { text: 'Usage: /gh-unwatch <number> [owner/repo]' }
    await unwatchPr($, ref.num, ref.repoName)
    return { text: `Stopped watching PR #${ref.num}.` }
  })

  on('tool.call', { tool: /^mcp__github-panel__watch_pr$/ }, async ($, e) => {
    const input = e as unknown as { number?: number; repo?: string }
    if (typeof input.number !== 'number') return { deny: 'number is required' }
    const added = await watchPr($, input.number, input.repo ?? '')
    return { result: added ? `Watching PR #${input.number}. You will be prompted when its checks, review or state change.` : `Already watching PR #${input.number}.` }
  })

  on('tool.call', { tool: /^mcp__github-panel__unwatch_pr$/ }, async ($, e) => {
    const input = e as unknown as { number?: number; repo?: string }
    if (typeof input.number !== 'number') return { deny: 'number is required' }
    await unwatchPr($, input.number, input.repo ?? '')
    return { result: `Stopped watching PR #${input.number}.` }
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

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Select, Input } = $.ui.resolve(e)
    const chosen = await read($, project)
    const known = await read($, repos)
    const options = [
      { value: '', label: 'This directory' },
      ...(chosen && !known.includes(chosen) ? [{ value: chosen, label: chosen }] : []),
      ...known.map(n => ({ value: n, label: n })),
    ]
    const list = await read($, runs)
    const prList = await read($, prs)
    const sel = await read($, selected)
    const selRuns = await read($, prRuns)
    const watchList = await read($, watched)
    const isWatched = (n: number) => watchList.some(o => sameWatch(o, chosen, n))
    const current = await read($, tab)
    const err = await read($, error)
    const t = (await read($, now)) || Date.now()
    const rp = await read($, repo)
    const br = await read($, branch)
    const all = await read($, allBranches)
    // stay well inside the pane: a Button that outgrows its row wraps and tears its brackets apart
    const cols = Math.min(e.viewport?.columns ?? 48, 56)
    const rows = Math.max(1, Math.floor(((e.viewport?.rows ?? 30) - 6) / 3))

    const active = list.filter(r => r.status !== 'completed').length
    const failed = list.filter(r => r.status === 'completed' && r.conclusion === 'failure').length
    const passed = list.filter(r => r.status === 'completed' && r.conclusion === 'success').length

    return (
      <Box flexDirection="column">
        <Box>
          <Text bold>{rp ?? 'GitHub'}</Text>
          <Text dimColor>{chosen ? '' : all ? '  all branches' : br ? '  ⎇ ' + br : ''}</Text>
        </Box>
        <Box>
          {active > 0 ? <Text backgroundColor="yellow" color="black" bold> ◐ {active} running </Text> : <Text dimColor>◐ 0 running</Text>}
          <Text> </Text>
          {failed > 0 ? <Text backgroundColor="red" color="white" bold> ✗ {failed} failed </Text> : <Text dimColor>✗ 0 failed</Text>}
          <Text> </Text>
          <Text color="green">✓ {passed}</Text>
          {watchList.length > 0 ? <Text color="cyan">  👁 {watchList.length} watched</Text> : null}
        </Box>
        <Select key="project" label="Project " options={options} value={chosen} onSelect={v => choose($, v)} />
        <Input key="custom" label="Repo " placeholder="owner/name, Enter" onSubmit={v => { if (v.trim()) choose($, v) }} />
        <Box>
          {chosen ? null : <Button label={all ? 'This branch' : 'All branches'} onPress={async () => { await update($, allBranches, v => !v); refresh($) }} />}
          <Text> </Text>
          <Button label="Refresh" onPress={() => refresh($)} />
        </Box>
        <Box>
          <Button label={(current === 'actions' ? '▸ ' : '') + `Actions (${list.length})`} onPress={() => update($, tab, () => 'actions')} />
          <Text> </Text>
          <Button label={(current === 'prs' ? '▸ ' : '') + `Pull requests (${prList.length})`} onPress={() => update($, tab, () => 'prs')} />
        </Box>
        <Text> </Text>
        {err ? <Text color="red">{err}</Text> : null}
        {current === 'prs' ? prList.length === 0 && !err ? <Text dimColor>No open pull requests.</Text> : null : null}
        {current === 'prs' ? prList.slice(0, rows).map(p => {
          const c = p.checks === 'failing' ? { i: '✗', c: 'red' } : p.checks === 'pending' ? { i: '◐', c: 'yellow' } : p.checks === 'passing' ? { i: '✓', c: 'green' } : { i: '–', c: 'gray' }
          const rv = p.review === 'APPROVED' ? { t: 'approved', c: 'green' } : p.review === 'CHANGES_REQUESTED' ? { t: 'changes requested', c: 'red' } : p.review === 'REVIEW_REQUIRED' ? { t: 'review required', c: 'yellow' } : { t: 'no review', c: 'gray' }
          return (
            <Box key={String(p.number)} flexDirection="column">
              <Button key={'pr-' + p.number} label={(sel === p.number ? '▾ ' : '▸ ') + c.i + ' #' + p.number + ' ' + clip(p.title, cols - 14)} onPress={() => toggle($, p.number)} />
              <Text>
                <Text dimColor>{'  ' + clip(p.author, 14) + ' · ⎇ ' + clip(p.branch, 18) + ' · ' + ago(t - p.updatedAt)}</Text>
              </Text>
              <Text>
                <Text color={rv.c as any}>{'  ' + rv.t}</Text>
                <Text dimColor>{' · checks ' + p.checks}</Text>
                {p.draft ? <Text color="gray"> · draft</Text> : null}
              </Text>
              <Box>
                <Text>  </Text>
                <Button key={'open-' + p.number} label="↗ Open" onPress={() => openUrl($, p.url)} />
                <Text> </Text>
                <Button key={'watch-' + p.number} label={isWatched(p.number) ? '👁 Watching' : '👁 Watch'} onPress={() => togglePrWatch($, p.number)} />
              </Box>
              {sel === p.number ? (
                <Box flexDirection="column" paddingLeft={2}>
                  <Text bold color="blue">ACTIONS FOR ⎇ {clip(p.branch, cols - 20)}</Text>
                  {selRuns.length === 0 ? <Text dimColor>No workflow runs for this branch.</Text> : null}
                  {selRuns.slice(0, 8).map(r => {
                    const s = look(r)
                    const took = r.status === 'completed' ? r.updatedAt - r.createdAt : t - r.createdAt
                    return (
                      <Box key={String(r.id)} flexDirection="column">
                        <Box>
                          <Text color={s.color as any} bold>{s.icon} </Text>
                          <Button key={'pr-run-' + r.id} label={clip(r.workflow, cols - 12) + ' ↗'} onPress={() => openUrl($, r.url)} />
                        </Box>
                        <Text>
                          <Text color={s.color as any}>{'  ' + s.label}</Text>
                          <Text dimColor> · {dur(took)} · {ago(t - r.createdAt)}</Text>
                        </Text>
                      </Box>
                    )
                  })}
                </Box>
              ) : null}
            </Box>
          )
        }) : null}
        {current === 'prs' && prList.length > rows ? <Text dimColor>+{prList.length - rows} more</Text> : null}
        {current === 'actions' && !err && list.length === 0 ? <Text dimColor>No workflow runs found.</Text> : null}
        {current === 'actions' ? list.slice(0, rows).map(r => {
          const s = look(r)
          const took = r.status === 'completed' ? r.updatedAt - r.createdAt : t - r.createdAt
          return (
            <Box key={String(r.id)} flexDirection="column">
              <Box>
                <Text color={s.color as any} bold>{s.icon} </Text>
                <Button key={'run-' + r.id} label={clip(r.workflow, cols - 10) + ' ↗'} onPress={() => openUrl($, r.url)} />
              </Box>
              <Text dimColor>{'  ' + clip(r.title, cols - 6)}</Text>
              <Text>
                <Text color={s.color as any}>{'  ' + s.label}</Text>
                <Text dimColor> · {dur(took)} · {ago(t - r.createdAt)}{all ? ' · ' + clip(r.branch, 16) : ''}</Text>
              </Text>
            </Box>
          )
        }) : null}
        {current === 'actions' && list.length > rows ? <Text dimColor>+{list.length - rows} more</Text> : null}
      </Box>
    )
  })
}
