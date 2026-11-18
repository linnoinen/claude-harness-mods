import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { RouteEntry, RouteMode } from '../types'

const PANE = 'model-router'
const KEEP = 200

// ── state ────────────────────────────────────────────────────────────────
const enabled = atom({ plugin: 'model-router', key: 'enabled' } as const, true)
const backend = atom({ plugin: 'model-router', key: 'backend' } as const, '')
const manualModel = atom({ plugin: 'model-router', key: 'manualModel' } as const, 'default')
const manualEffort = atom({ plugin: 'model-router', key: 'manualEffort' } as const, 'default')
const log = atom({ plugin: 'model-router', key: 'log' } as const, [], { shape: 'log-1' })
const selected = atom({ plugin: 'model-router', key: 'selected' } as const, null)

// ── routing table ────────────────────────────────────────────────────────
type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
type Route = { model: string; effort: Effort; desc: string }

const ROUTES: Record<string, Route> = {
  trivial: { model: 'haiku', effort: 'low', desc: 'greetings, one-line factual answers, tiny lookups, yes/no' },
  simple: { model: 'sonnet', effort: 'low', desc: 'small well-defined edits, renames, shell one-liners, short explanations' },
  standard: { model: 'sonnet', effort: 'medium', desc: 'ordinary coding: a feature or fix in a few files, writing tests, routine debugging' },
  complex: { model: 'opus', effort: 'high', desc: 'multi-file refactors, hard bugs, architecture, careful code review, planning' },
  deep: { model: 'opus', effort: 'xhigh', desc: 'open-ended design, research, very hard reasoning, long autonomous multi-step work' },
}
const LABELS = Object.keys(ROUTES)
const FALLBACK = 'standard'

const MODELS = [
  { value: 'default', label: 'Session default' },
  { value: 'haiku', label: 'Haiku' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
  { value: 'claude-fable-5-2', label: 'Fable' },
]
const EFFORTS = [
  { value: 'default', label: 'Default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'X-high' },
  { value: 'max', label: 'Max' },
]

const SYSTEM = [
  'You route coding-assistant requests to a model tier. Pick exactly one category:',
  ...LABELS.map(l => `- ${l}: ${ROUTES[l]!.desc}`),
  'Judge the work the request will need, not its length. A short follow-up ("do it", "yes") inherits the difficulty of the conversation it continues.',
  'Reply with JSON only: {"category": "<one of ' + LABELS.join(', ') + '>", "reason": "<one short sentence>"}',
].join('\n')

// ── helpers ──────────────────────────────────────────────────────────────
const clip = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, Math.max(1, n - 1)) + '…' : one
}
const hhmm = (t: number) => {
  const d = new Date(t)
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0')
}
const dur = (ms: number) => (ms < 1000 ? ms + 'ms' : ms < 60000 ? (ms / 1000).toFixed(1) + 's' : Math.floor(ms / 60000) + 'm' + String(Math.round((ms % 60000) / 1000)).padStart(2, '0') + 's')
const tok = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n))
const shortModel = (m: string) => (m === '' || m === 'default' ? 'default' : m.replace(/^claude-/, '').replace(/-\d.*$/, ''))

// Turn the harness's tag-wrapped prompts (bash commands, slash commands, their
// output) into readable text. Display only: the log keeps the raw prompt.
function prettyPrompt(raw: string): string {
  const tag = (name: string) => new RegExp('<' + name + '>([\\s\\S]*?)</' + name + '>', 'g')
  let s = raw
  s = s.replace(tag('local-command-caveat'), '')
  s = s.replace(tag('system-reminder'), '')
  s = s.replace(tag('bash-input'), (_m, c) => '$ ' + String(c).trim())
  s = s.replace(tag('bash-stdout'), (_m, c) => String(c).trim() ? String(c).trimEnd() + '\n' : '')
  s = s.replace(tag('bash-stderr'), (_m, c) => String(c).trim() ? 'stderr: ' + String(c).trimEnd() + '\n' : '')
  s = s.replace(tag('local-command-stdout'), (_m, c) => String(c).trim() ? String(c).trimEnd() + '\n' : '')
  s = s.replace(tag('local-command-stderr'), (_m, c) => String(c).trim() ? 'stderr: ' + String(c).trimEnd() + '\n' : '')
  // slash command: <command-name>/x</command-name> <command-message>..</command-message> <command-args>a</command-args>
  s = s.replace(tag('command-message'), '')
  s = s.replace(tag('command-name'), (_m, c) => String(c).trim())
  s = s.replace(tag('command-args'), (_m, c) => (String(c).trim() ? ' ' + String(c).trim() : ''))
  return s.replace(/\n{3,}/g, '\n\n').trim()
}

function parseReply(text: string): { category: string; reason: string } | undefined {
  const m = /\{[\s\S]*\}/.exec(text)
  if (m) {
    try {
      const j = JSON.parse(m[0])
      const c = String(j.category ?? '').toLowerCase().trim()
      if (LABELS.includes(c)) return { category: c, reason: String(j.reason ?? '') }
    } catch {
      // fall through to a word search
    }
  }
  const lower = text.toLowerCase()
  const hit = LABELS.find(l => new RegExp('\\b' + l + '\\b').test(lower))
  return hit ? { category: hit, reason: clip(text, 160) } : undefined
}

async function withTimeout<T>($: any, ms: number, p: Promise<T>): Promise<T> {
  // a timer that cannot run never wins the race
  const timer = Promise.resolve()
    .then(() => $.clock.sleep(ms))
    .then(
      () => { throw new Error('timed out after ' + ms + 'ms') },
      () => new Promise<never>(() => {}),
    )
  return Promise.race([p, timer])
}

type Options = {
  classifier: string
  externalUrl: string
  externalModel: string
  externalMinConfidence: number
  externalApiKey: string
}

async function classifyClaude($: any, model: string, prompt: string) {
  const r = await $.model.complete({ model, system: SYSTEM, prompt, maxTokens: 200, effort: 'low', timeoutMs: 10000 })
  if (!r.isAnswered) throw new Error('claude classifier: ' + r.reason + (r.status ? ' ' + r.status : ''))
  const p = parseReply(r.text)
  if (!p) throw new Error('claude classifier gave no category: ' + clip(r.text, 80))
  return p
}

const EXTERNAL = ['jev', 'openai', 'simple']
const isExternal = (v: string) => EXTERNAL.includes(v)
const classifierLabel = (v: string) => (v === 'jev' ? 'Jev' : v === 'openai' ? 'External (OpenAI format)' : v === 'simple' ? 'External (simple)' : v === 'haiku' ? 'Haiku (latest)' : v)

const JEV_URL = 'https://api.typesafe.ai/v1/systemone'

async function classifyJev($: any, o: Options, prompt: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const key = o.externalApiKey || (await $.env.get('TYPESAFE_API_KEY'))
  if (key) headers.Authorization = 'Bearer ' + key
  const criteria: Record<string, string> = {}
  for (const l of LABELS) criteria[l] = ROUTES[l]!.desc
  const body = {
    state: prompt,
    model: o.externalModel || 'jev-latest',
    questions: {
      route: {
        type: 'choice',
        instructions: 'Which model tier does this coding-assistant request need? Judge the work required, not the length; a short follow-up inherits the difficulty of the conversation it continues.',
        criteria,
      },
    },
  }
  const res = await withTimeout($, 10000, $.http.fetch(o.externalUrl || JEV_URL, { method: 'POST', headers, body: JSON.stringify(body) })) as any
  if (!res.ok) throw new Error('jev: HTTP ' + res.status)
  let a: any
  try {
    a = JSON.parse(res.text)?.answers?.route
  } catch {
    throw new Error('jev: reply is not JSON')
  }
  const choice = String(a?.choice ?? '')
  if (!LABELS.includes(choice)) throw new Error('jev gave no category: ' + clip(res.text, 80))
  const conf = typeof a.confidence === 'number' ? a.confidence : undefined
  if (conf !== undefined && conf < (o.externalMinConfidence || 0)) {
    throw new Error(`jev confidence ${conf.toFixed(2)} below ${o.externalMinConfidence}`)
  }
  return { category: choice, reason: conf !== undefined ? `jev confidence ${conf.toFixed(2)}` : 'jev' }
}

async function classifyExternal($: any, o: Options, format: string, prompt: string) {
  if (format === 'jev') return classifyJev($, o, prompt)
  if (!o.externalUrl) throw new Error('external classifier: no URL set')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const key = o.externalApiKey || (await $.env.get('TYPESAFE_API_KEY'))
  if (key) headers.Authorization = 'Bearer ' + key
  const body =
    format === 'simple'
      ? { system: SYSTEM, prompt, labels: LABELS }
      : {
          model: o.externalModel || undefined,
          temperature: 0,
          max_tokens: 200,
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: prompt },
          ],
        }
  const res = await withTimeout($, 10000, $.http.fetch(o.externalUrl, { method: 'POST', headers, body: JSON.stringify(body) })) as any
  if (!res.ok) throw new Error('external classifier: HTTP ' + res.status)
  let text: string = res.text
  try {
    const j = JSON.parse(res.text)
    if (typeof j.category === 'string') text = JSON.stringify(j)
    else if (j.choices?.[0]?.message?.content) text = String(j.choices[0].message.content)
    else if (Array.isArray(j.content) && j.content[0]?.text) text = String(j.content[0].text)
    else if (typeof j.output === 'string') text = j.output
    else if (typeof j.text === 'string') text = j.text
  } catch {
    // plain text reply
  }
  const p = parseReply(text)
  if (!p) throw new Error('external classifier gave no category: ' + clip(text, 80))
  return p
}

async function contextFor($: any, text: string) {
  let recent = ''
  try {
    const msgs = (await $.session.messages()) as { role: string; text: string }[]
    recent = msgs
      .filter(m => m.text && m.text.trim())
      .slice(-5, -1)
      .map(m => `${m.role}: ${clip(m.text, 400)}`)
      .join('\n')
  } catch {
    // no history: classify the prompt alone
  }
  return (recent ? '<recent_conversation>\n' + recent + '\n</recent_conversation>\n\n' : '') + '<request>\n' + clip(text, 4000) + '\n</request>'
}

async function patch($: any, id: string, fn: (r: RouteEntry) => RouteEntry) {
  await update($, log, (l: RouteEntry[]) => l.map(r => (r.id === id ? fn(r) : r)))
}

async function lastRouted($: any) {
  const l = await read($, log)
  for (let i = l.length - 1; i >= 0; i--) {
    const x = l[i]
    if (x && x.category && x.model) return { model: x.model, effort: x.effort, category: x.category }
  }
  return undefined
}

async function showStatus($: any) {
  if (await read($, enabled)) {
    const last = await lastRouted($)
    $.ui.status(last ? `⇄ router · ${last.category} → ${shortModel(last.model)}/${last.effort}` : '⇄ router on')
  } else {
    const m = await read($, manualModel)
    const ef = await read($, manualEffort)
    $.ui.status(`⇄ router off · ${shortModel(m)}/${ef}`)
  }
}

// ── register ─────────────────────────────────────────────────────────────
export const register: Register = (on, options) => {
  const o = options as unknown as Options
  // the route each running main-loop turn takes; the log in $.state is the durable copy
  const routes = new Map<string, { model: string; effort: string }>()

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'router',
      description: 'Smart model router: /router on | off | log | status',
      argumentHint: 'on | off | log | status',
    })
    void $.ui.open({ id: PANE, title: 'Router' })
    void showStatus($)
    return next(e)
  })

  on('command.run', { command: 'router' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'on' || arg === 'off') {
      await update($, enabled, () => arg === 'on')
      void showStatus($)
      return { text: `Model router ${arg} for this session.` }
    }
    if (arg === 'log') {
      await $.ui.open({ id: PANE, title: 'Router' })
      return { text: 'Router log opened.' }
    }
    const isOn = await read($, enabled)
    const entries = await read($, log)
    const m = await read($, manualModel)
    const ef = await read($, manualEffort)
    return {
      text: isOn
        ? `Router on (classifier: ${(await read($, backend)) || o.classifier || 'haiku'}). ${entries.length} turns routed this session.`
        : `Router off. Manual: model ${m}, effort ${ef}.`,
    }
  })

  // Decide the turn's route before its first request.
  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const t0 = Date.now()
    const isOn = await read($, enabled)
    let mode: RouteMode
    let category = ''
    let reason = ''
    let classifier = ''
    let model = ''
    let effort = ''

    if (isOn) {
      const last = e.text.trim() ? undefined : await lastRouted($)
      if (last) {
        mode = 'continued'
        ;({ model, effort, category } = last)
        reason = 'Continuation of the previous turn; kept its route.'
      } else {
        const which = (await read($, backend)) || o.classifier || 'haiku'
        const prompt = await contextFor($, e.text)
        let errors: string[] = []
        let got: { category: string; reason: string } | undefined
        if (isExternal(which)) {
          try {
            got = await classifyExternal($, o, which, prompt)
            classifier = which
          } catch (err) {
            errors.push(String((err as Error).message ?? err))
          }
        }
        if (!got) {
          try {
            const cm = isExternal(which) ? 'haiku' : which
            got = await classifyClaude($, cm, prompt)
            classifier = cm
          } catch (err) {
            errors.push(String((err as Error).message ?? err))
          }
        }
        if (got) {
          mode = errors.length ? 'fallback' : 'router'
          category = got.category
          reason = got.reason + (errors.length ? ` (after: ${errors.join('; ')})` : '')
        } else {
          mode = 'fallback'
          category = FALLBACK
          reason = 'Classifier failed, used the default category: ' + errors.join('; ')
        }
        const route = ROUTES[category] ?? ROUTES[FALLBACK]!
        model = route.model
        effort = route.effort
      }
    } else {
      const m = await read($, manualModel)
      const ef = await read($, manualEffort)
      model = m === 'default' ? '' : m
      effort = ef === 'default' ? '' : ef
      mode = model || effort ? 'manual' : 'default'
    }

    routes.set(e.turnId, { model, effort })
    const entry: RouteEntry = {
      id: e.turnId,
      at: t0,
      prompt: e.text,
      mode,
      category,
      reason,
      classifier,
      classifyMs: Date.now() - t0,
      model,
      effort,
      sessionModel: '',
      steps: 0,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
      status: 'running',
    }
    await update($, log, (l: RouteEntry[]) => [...l, entry].slice(-KEEP))
    void showStatus($)
    return next(e)
  })

  // Apply the route to every model request of the turn.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    let r = routes.get(e.turnId)
    if (!r) {
      const found = (await read($, log)).find(x => x.id === e.turnId)
      if (found) routes.set(e.turnId, (r = { model: found.model, effort: found.effort }))
    }
    const sessionModel = e.model
    void patch($, e.turnId, x => ({ ...x, steps: x.steps + 1, sessionModel: x.sessionModel || sessionModel }))
    if (!r || (!r.model && !r.effort)) return yield* next(e)
    const step = { ...e }
    if (r.model) step.model = r.model
    if (r.effort && e.effort !== undefined) step.effort = r.effort as Effort
    return yield* next(step)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && routes.has(e.turnId)) {
      routes.delete(e.turnId)
      const u = e.usage
      await patch($, e.turnId, x => ({
        ...x,
        status: e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'aborted' : e.reason === 'refusal' ? 'refused' : 'error',
        durationMs: e.durationMs,
        inputTokens: u ? (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) : 0,
        outputTokens: u?.output_tokens ?? 0,
        sessionModel: u?.model || x.sessionModel,
      }))
    }
    return next(e)
  })

  // ── band row above the prompt: toggle + manual picker ──────────────────
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Box, Text, Button, Select } = $.ui.resolve(e)
    const isOn = await read($, enabled)
    const m = await read($, manualModel)
    const ef = await read($, manualEffort)
    const entries = await read($, log)
    const latest = entries[entries.length - 1]
    const toggle = (
      <Button key="router-toggle" label={isOn ? 'Router: on' : 'Router: off'} variant={isOn ? 'primary' : 'secondary'} onPress={async () => {
        await update($, enabled, v => !v)
        void showStatus($)
      }} />
    )
    return (
      <Box flexDirection="row" flexWrap="wrap">
        <Text color={isOn ? 'magenta' : 'gray'}>⇄ </Text>
        {toggle}
        <Text> </Text>
        {isOn ? (
          latest && latest.category ? (
            <Text>
              <Text dimColor>last </Text>
              <Text bold>{latest.category}</Text>
              <Text dimColor> → </Text>
              <Text color="magenta">{shortModel(latest.model)}</Text>
              <Text dimColor> · {latest.effort}</Text>
            </Text>
          ) : (
            <Text dimColor>routes each prompt to a fitting model</Text>
          )
        ) : (
          <Box flexDirection="row">
            <Select key="manual-model" label="Model" value={m} options={MODELS} onSelect={v => {
              void update($, manualModel, () => v).then(() => showStatus($))
            }} />
            <Text> </Text>
            <Select key="manual-effort" label="Effort" value={ef} options={EFFORTS} onSelect={v => {
              void update($, manualEffort, () => v).then(() => showStatus($))
            }} />
          </Box>
        )}
        <Text> </Text>
        <Button key="router-log" label="Log" onPress={() => void $.ui.open({ id: PANE, title: 'Router' })} />
      </Box>
    )
  })

  // ── right-hand tab: the router log ─────────────────────────────────────
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Select } = $.ui.resolve(e)
    const entries = await read($, log)
    const sel = await read($, selected)
    const isOn = await read($, enabled)
    const which = (await read($, backend)) || o.classifier || 'haiku'
    const cols = Math.max(24, e.props.bodyColumns ?? 48)
    const rows = e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 30
    const chosen = sel ? entries.find(x => x.id === sel) : undefined

    const modeColor = (mo: RouteMode) => (mo === 'router' || mo === 'continued' ? 'magenta' : mo === 'fallback' ? 'yellow' : mo === 'manual' ? 'cyan' : 'gray')
    const statusMark = (s: RouteEntry['status']) => (s === 'running' ? '◐' : s === 'done' ? '✓' : s === 'aborted' ? '⊘' : '✗')

    if (chosen) {
      const R = (p: { k: string; v: string; color?: string }) => (
        <Box key={p.k}>
          <Text dimColor>{p.k.padEnd(11)}</Text>
          <Text color={p.color as any}>{p.v}</Text>
        </Box>
      )
      return (
        <Box flexDirection="column">
          <Button key="back" label="← Router log" onPress={() => update($, selected, () => null)} />
          <Text> </Text>
          <Text bold>{statusMark(chosen.status)} {chosen.category || chosen.mode} → {shortModel(chosen.model || chosen.sessionModel)}</Text>
          <Text> </Text>
          <Text bold color="blue">PROMPT</Text>
          {chosen.prompt
            ? prettyPrompt(chosen.prompt).split('\n').slice(0, 40).map((ln, i) => <Text key={'p' + i}>{clip(ln, cols * 2) || ' '}</Text>)
            : <Text>(no typed prompt: continuation)</Text>}
          <Text> </Text>
          <Text bold color="blue">DECISION</Text>
          <R k="mode" v={chosen.mode} color={modeColor(chosen.mode)} />
          {chosen.category ? <R k="category" v={chosen.category + ' — ' + (ROUTES[chosen.category]?.desc ?? '')} /> : null}
          {chosen.reason ? <R k="reason" v={chosen.reason} /> : null}
          {chosen.classifier ? <R k="classifier" v={chosen.classifier + ' · ' + dur(chosen.classifyMs)} /> : null}
          <Text> </Text>
          <Text bold color="blue">EXECUTION</Text>
          <R k="model" v={chosen.model || '(session default)'} color="magenta" />
          <R k="effort" v={chosen.effort || '(session default)'} />
          <R k="answered" v={chosen.sessionModel || '—'} />
          <R k="status" v={chosen.status} color={chosen.status === 'done' ? 'green' : chosen.status === 'running' ? 'yellow' : 'red'} />
          <R k="started" v={hhmm(chosen.at)} />
          <R k="duration" v={chosen.durationMs ? dur(chosen.durationMs) : '—'} />
          <R k="requests" v={String(chosen.steps)} />
          <R k="tokens" v={`${tok(chosen.inputTokens)} in · ${tok(chosen.outputTokens)} out`} />
        </Box>
      )
    }

    const list = entries.slice().reverse()
    const room = Math.max(1, Math.floor((rows - 7) / 2))
    const routed = entries.filter(x => x.mode === 'router' || x.mode === 'continued' || x.mode === 'fallback')
    const counts: Record<string, number> = {}
    for (const x of routed) counts[shortModel(x.model)] = (counts[shortModel(x.model)] ?? 0) + 1

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" flexWrap="wrap">
          <Button key="pane-toggle" label={isOn ? 'Router: on' : 'Router: off'} variant={isOn ? 'primary' : 'secondary'} onPress={async () => {
            await update($, enabled, v => !v)
            void showStatus($)
          }} />
          <Text> </Text>
          <Select key="backend" label="Classifier" value={which} options={[...new Set(['haiku', 'claude-haiku-5-5', 'jev', 'openai', 'simple', which])].map(v => ({ value: v, label: classifierLabel(v) }))} onSelect={v => void update($, backend, () => v)} />
        </Box>
        <Text dimColor>
          {entries.length} turns · {Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(' · ') || 'none routed yet'}
        </Text>
        <Text> </Text>
        {list.length === 0 ? <Text dimColor>No turns yet. Each prompt shows up here with the model it ran on.</Text> : null}
        {list.slice(0, room).map(x => (
          <Box key={x.id} flexDirection="column">
            <Button key={'entry-' + x.id} plain onPress={() => update($, selected, () => x.id)}>
              <Text color={x.status === 'running' ? 'yellow' : x.status === 'done' ? 'green' : 'red'}>{statusMark(x.status)} </Text>
              <Text dimColor>{hhmm(x.at)} </Text>
              <Text color={modeColor(x.mode)} bold>{x.category || x.mode}</Text>
              <Text> → {shortModel(x.model || x.sessionModel)}</Text>
              <Text dimColor>{x.effort ? ' · ' + x.effort : ''}</Text>
            </Button>
            <Text dimColor>{'  ' + (x.prompt ? clip(prettyPrompt(x.prompt) || x.prompt, cols - 4) : '(continuation)')}</Text>
          </Box>
        ))}
      </Box>
    )
  })
}
