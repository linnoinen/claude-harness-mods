import { expect, test } from 'claude-code/testing'

const reply = (text: string): any => ({
  value: { isAnswered: true as const, text, usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
})

// Runs one main-loop turn and answers the model request the way the engine would,
// returning the model and effort the request was sent with.
function stubTurn(on: any, turnId: string) {
  const sent: { model?: string; effort?: unknown } = {}
  on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_: any, e: any) {
    if (e.turnId === turnId) {
      sent.model = e.model
      sent.effort = e.effort
    }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null } as any
  })
  on('ui.status', () => ({ value: undefined }))
  return sent
}

async function driveTurn($: any, turnId: string, text: string) {
  await $.turn.start({ text, turnId })
  for await (const _ of $.turn.step({ turnId, index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 })) {
    // drain
  }
}

async function runTurn($: any, on: any, turnId: string, text: string) {
  const sent = stubTurn(on, turnId)
  await driveTurn($, turnId, text)
  return sent
}

test('router on: a trivial prompt goes to haiku at low effort', async ($, on) => {
  on('model.complete', () => reply('{"category":"trivial","reason":"a greeting"}'))
  on('session.messages', () => ({ value: [] }))
  const sent = await runTurn($, on, 't1', 'hi there')
  expect(sent.model).toBe('haiku')
  expect(sent.effort).toBe('low')
})

test('router on: a hard task goes to opus', async ($, on) => {
  on('model.complete', () => reply('{"category":"complex","reason":"multi-file refactor"}'))
  on('session.messages', () => ({ value: [] }))
  const sent = await runTurn($, on, 't2', 'refactor the auth layer across services')
  expect(sent.model).toBe('opus')
  expect(sent.effort).toBe('high')
})

test('router on: a failed classifier falls back to standard', async ($, on) => {
  on('model.complete', (): any => ({ value: { isAnswered: false, reason: 'api-error', status: 500, error: 'server_error', usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }))
  on('session.messages', () => ({ value: [] }))
  const sent = await runTurn($, on, 't3', 'add a test')
  expect(sent.model).toBe('sonnet')
  expect(sent.effort).toBe('medium')
})

test('external classifier is used when chosen', { options: { classifier: 'openai', externalUrl: 'https://classifier.example/v1/chat/completions', externalModel: 'm' } }, async ($, on) => {
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'router' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.messages', () => ({ value: [] }))
  let called = ''
  on('env.get', () => ({ value: undefined }))
  on('http.fetch', (_: any, e: any) => {
    called = e.url
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ choices: [{ message: { content: '{"category":"deep","reason":"research"}' } }] }) } }
  })
  on('model.complete', () => reply('{"category":"trivial","reason":"should not be used"}'))
  const sent = stubTurn(on, 't4')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await driveTurn($, 't4', 'design a new storage engine')
  expect(called).toBe('https://classifier.example/v1/chat/completions')
  expect(sent.model).toBe('opus')
  expect(sent.effort).toBe('xhigh')
})

test('jev classifier: sends a choice question and routes on its answer', { options: { classifier: 'jev', externalApiKey: 'k' } }, async ($, on) => {
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'router' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.messages', () => ({ value: [] }))
  let url = ''
  let sentBody: any
  on('env.get', () => ({ value: undefined }))
  on('http.fetch', (_: any, e: any) => {
    url = e.url
    sentBody = JSON.parse(e.init.body)
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ answers: { route: { type: 'choice', choice: 'complex', confidence: 0.9, probabilities: {} } } }) } }
  })
  on('model.complete', () => reply('{"category":"trivial","reason":"unused"}'))
  const sent = stubTurn(on, 't8')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await driveTurn($, 't8', 'untangle the build graph')
  expect(url).toBe('https://api.typesafe.ai/v1/systemone')
  expect(sentBody.questions.route.type).toBe('choice')
  expect(Object.keys(sentBody.questions.route.criteria)).toContain('deep')
  expect(sent.model).toBe('opus')
  expect(sent.effort).toBe('high')
})

test('jev below the minimum confidence hands over to claude', { options: { classifier: 'jev', externalMinConfidence: 0.8 } }, async ($, on) => {
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'router' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.messages', () => ({ value: [] }))
  on('env.get', () => ({ value: undefined }))
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ answers: { route: { choice: 'deep', confidence: 0.4 } } }) } }))
  on('model.complete', () => reply('{"category":"simple","reason":"small"}'))
  const sent = stubTurn(on, 't9')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await driveTurn($, 't9', 'rename a var')
  expect(sent.model).toBe('sonnet')
  expect(sent.effort).toBe('low')
})

test('router off with no manual pick leaves the request alone', async ($, on) => {
  on('state.get', (_: any, e: any, next: any) => (e.key === 'enabled' ? { value: { value: false, version: 1 } } : next(e)))
  const sent = await runTurn($, on, 't5', 'hello')
  expect(sent.model).toBe('claude-opus-5-5')
  expect(sent.effort).toBe('high')
})

test('router off with a manual pick applies it', async ($, on) => {
  on('state.get', (_: any, e: any, next: any) =>
    e.key === 'enabled' ? { value: { value: false, version: 1 } }
    : e.key === 'manualModel' ? { value: { value: 'sonnet', version: 1 } }
    : e.key === 'manualEffort' ? { value: { value: 'low', version: 1 } }
    : next(e))
  const sent = await runTurn($, on, 't6', 'hello')
  expect(sent.model).toBe('sonnet')
  expect(sent.effort).toBe('low')
})

test('the log pane lists a routed turn and opens its details', async ($, on) => {
  on('model.complete', () => reply('{"category":"simple","reason":"rename"}'))
  on('session.messages', () => ({ value: [] }))
  await runTurn($, on, 't7', 'rename foo to bar')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'model-router', surface, component: 'Pane', requestId: 'model-router',
      props: { title: 'Router', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
    } as any)
    expect((await ui.find({ type: 'Text', text: /rename foo to bar/ }))).toBeTruthy()
    await ui.press({ key: 'entry-t7' } as any)
    expect((await ui.find({ type: 'Text', text: /rename$/ }))).toBeTruthy()
    await ui.press({ key: 'back' } as any)
    await ui.unmount()
  }
})
