/**
 * End-to-end smoke test for dsh-bonk-pet.
 *
 * Drives both halves for real:
 *   - host half: fake Cordis ctx, asserts the SSE route registers and that
 *     tool/turn failures produce broadcast frames.
 *   - client half: loads lib/client.js through the module-loader shim against
 *     the DOM harness, then clicks the basin and pushes failure frames.
 *
 * Hermetic by construction: `DSH_HOME` is redirected to a scratch directory
 * before the host half is imported, so the assertions about "no audio, no
 * artwork" describe the fixture rather than whatever the developer happens to
 * have in their real `~/.dsh/bonk-pet/`.
 *
 * Run: node test/run.js
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installHarness } from './harness.js'

/** Scratch harness home; removed when the run finishes. */
const sandboxHome = mkdtempSync(join(tmpdir(), 'bonk-test-'))
process.env.DSH_HOME = sandboxHome

process.on('exit', () => {
  rmSync(sandboxHome, { recursive: true, force: true })
})

const results = []
function check(name, fn) {
  try {
    const out = fn()
    if (out && typeof out.then === 'function') {
      return out.then(
        () => results.push({ name, ok: true }),
        (error) => results.push({ name, ok: false, error }),
      )
    }
    results.push({ name, ok: true })
  } catch (error) {
    results.push({ name, ok: false, error })
  }
  return Promise.resolve()
}

// ---------------------------------------------------------------------------
// Host half
// ---------------------------------------------------------------------------

/** A minimal stand-in for the Cordis context the host half consumes. */
function makeHostCtx() {
  const handlers = new Map()
  const routes = new Map()
  const effects = []

  return {
    handlers,
    routes,
    effects,
    on(name, fn) {
      if (!handlers.has(name)) handlers.set(name, [])
      handlers.get(name).push(fn)
      return () => {}
    },
    inject(_services, fn) {
      fn({
        effect(factory) {
          effects.push(factory())
        },
        webServer: {
          register(route) {
            assert.equal(route.kind, 'exact', 'route must be an exact route')
            if (routes.has(route.path)) throw new Error(`duplicate route ${route.path}`)
            routes.set(route.path, route)
            return () => routes.delete(route.path)
          },
        },
      })
    },
    effect(factory) {
      effects.push(factory())
    },
  }
}

/** A stand-in for an http ServerResponse that records SSE frames. */
function makeResponse() {
  const frames = []
  return {
    frames,
    headers: null,
    ended: false,
    statusCode: 0,
    writeHead(code, headers) {
      this.statusCode = code
      this.headers = headers
    },
    write(chunk) {
      frames.push(String(chunk))
      return true
    },
    end() {
      this.ended = true
    },
    on() {},
    // `emit` and `once` are not decoration. A real `http.ServerResponse` is an
    // EventEmitter, and `Readable.pipe(dest)` calls `dest.emit('pipe', src)` and
    // `dest.once(…)` before writing anything. Without them, serving a file that
    // EXISTS throws inside `pipe` and the route answers 500 — so a stub missing
    // these passes every 404 assertion while misreporting every success.
    emit() {
      return true
    },
    once() {
      return this
    },
  }
}

const host = await import('../lib/index.js')

await check('host: exports name and apply', () => {
  assert.equal(typeof host.apply, 'function')
  assert.equal(host.name, 'bonk-pet')
})

const hostCtx = makeHostCtx()
host.apply(hostCtx)

await check('host: registers the SSE route', () => {
  assert.ok(hostCtx.routes.has('/api/bonk-pet/events'), 'route missing')
})

await check('host: route writes event-stream headers and flushes', () => {
  const route = hostCtx.routes.get('/api/bonk-pet/events')
  const response = makeResponse()
  route.handler({ on() {} }, response)
  assert.equal(response.statusCode, 200)
  assert.match(response.headers['content-type'], /text\/event-stream/)
  assert.equal(response.headers['cache-control'], 'no-store, no-transform')
  assert.ok(response.frames[0].startsWith(':'), 'expected a comment flush frame')
})

await check('host: ignores successful tool results', () => {
  const route = hostCtx.routes.get('/api/bonk-pet/events')
  const response = makeResponse()
  route.handler({ on() {} }, response)
  const before = response.frames.length
  for (const fn of hostCtx.handlers.get('tools/result') ?? []) {
    fn({ name: 'read' }, { isError: false })
  }
  assert.equal(response.frames.length, before, 'no frame should be emitted')
})

await check('host: broadcasts a failed tool call', () => {
  const route = hostCtx.routes.get('/api/bonk-pet/events')
  const response = makeResponse()
  route.handler({ on() {} }, response)
  // The REAL shape from dsh-tools: `error: { message, info? }` where `info` is
  // `{ name, code }` and exists only for a HarnessError. The previous fixture
  // used `error: { code }`, a shape dsh-tools never produces — so it passed
  // while the shipped code was reading a nonexistent property and captioning
  // every tool failure with the generic fallback.
  for (const fn of hostCtx.handlers.get('tools/result') ?? []) {
    fn(
      { name: 'pwsh' },
      {
        isError: true,
        error: { message: 'command timed out after 30s', info: { name: 'ToolError', code: 'TOOL_TIMEOUT' } },
      },
    )
  }
  const frame = response.frames.find((f) => f.startsWith('data: '))
  assert.ok(frame !== undefined, 'expected a data frame')
  const payload = JSON.parse(frame.slice(6))
  assert.equal(payload.type, 'error')
  assert.equal(payload.kind, 'tool')
  assert.equal(payload.tool, 'pwsh')
  assert.equal(payload.message, 'TOOL_TIMEOUT', 'the code is the most useful caption')
})

await check('host: a tool failure with no code falls back to its message', () => {
  // A guard denial and a plain thrown Error both arrive as `error: { message }`
  // with no `info`. Captioning those as the generic string would throw away the
  // only thing the payload actually said.
  const route = hostCtx.routes.get('/api/bonk-pet/events')
  const response = makeResponse()
  route.handler({ on() {} }, response)
  for (const fn of hostCtx.handlers.get('tools/result') ?? []) {
    fn({ name: 'read' }, { isError: true, error: { message: 'denied by policy' } })
  }
  const frame = response.frames.find((f) => f.startsWith('data: '))
  const payload = JSON.parse(frame.slice(6))
  assert.equal(payload.message, 'denied by policy')
})

await check('host: a tool failure with nothing usable still gets a caption', () => {
  // Degenerate payload: the frame must still be emittable, because a failure
  // the pet says nothing about is worse than one it describes vaguely.
  const route = hostCtx.routes.get('/api/bonk-pet/events')
  const response = makeResponse()
  route.handler({ on() {} }, response)
  for (const fn of hostCtx.handlers.get('tools/result') ?? []) {
    fn({ name: 'x' }, { isError: true })
  }
  const frame = response.frames.find((f) => f.startsWith('data: '))
  assert.ok(frame !== undefined, 'expected a data frame even with no error detail')
  const payload = JSON.parse(frame.slice(6))
  assert.equal(payload.message, '工具执行失败')
})

await check('host: broadcasts a failed turn', () => {
  const route = hostCtx.routes.get('/api/bonk-pet/events')
  const response = makeResponse()
  route.handler({ on() {} }, response)
  for (const fn of hostCtx.handlers.get('agent/error') ?? []) {
    fn({ error: new Error('provider exploded') })
  }
  const frame = response.frames.find((f) => f.startsWith('data: '))
  const payload = JSON.parse(frame.slice(6))
  assert.equal(payload.kind, 'turn')
  assert.equal(payload.message, 'provider exploded')
})

await check('host: a failed turn reports where it broke', () => {
  const route = hostCtx.routes.get('/api/bonk-pet/events')
  const response = makeResponse()
  route.handler({ on() {} }, response)
  for (const fn of hostCtx.handlers.get('agent/error') ?? []) {
    fn({ turn: 3, step: 7, error: 'boom' })
  }
  const payload = JSON.parse(response.frames.find((f) => f.startsWith('data: ')).slice(6))
  assert.equal(payload.where, '第 3 回合 · 第 7 步')
})

await check('host: a retried model request is reported', () => {
  // A provider hiccup the loop retries never reaches `agent/error`, so without
  // this signal the pet would sit through repeated failures looking pleased.
  const route = hostCtx.routes.get('/api/bonk-pet/events')
  const response = makeResponse()
  route.handler({ on() {} }, response)
  const handlers = hostCtx.handlers.get('agent/request-error') ?? []
  assert.ok(handlers.length > 0, 'agent/request-error must be subscribed')
  for (const fn of handlers) {
    fn({ provider: 'deepseek', failure: { message: 'rate limited', code: 'RATE_LIMIT' } })
  }
  const payload = JSON.parse(response.frames.find((f) => f.startsWith('data: ')).slice(6))
  assert.equal(payload.type, 'error')
  assert.equal(payload.kind, 'request')
  assert.equal(payload.provider, 'deepseek')
  assert.equal(payload.message, 'rate limited')
})

await check('host: the retry chain is handed on, not swallowed', () => {
  // `agent/request-error` is a WATERFALL: @deepseek-ai/dsh-llm-retry listens on
  // it to decide whether to retry, and continues the chain by calling next().
  // A listener that never calls next() would silently disable retries — a far
  // worse bug than a missing animation.
  const handlers = hostCtx.handlers.get('agent/request-error') ?? []
  assert.ok(handlers.length > 0, 'agent/request-error must be subscribed')

  let continued = 0
  for (const fn of handlers) {
    const result = fn({ provider: 'p', failure: { message: 'x' } }, () => {
      continued += 1
      return Promise.resolve({ kind: 'retry' })
    })
    // A waterfall participant may return a promise; settle it so a rejection
    // would surface here rather than as an unhandled rejection later.
    assert.ok(
      result === undefined || typeof result.then === 'function',
      'the listener must not return a foreign action synchronously',
    )
  }
  assert.equal(continued, handlers.length, 'every listener must continue the waterfall')
})

await check('host: a session-level failure is reported', () => {
  // Signature is positional: (sessionId, message), not an object.
  const route = hostCtx.routes.get('/api/bonk-pet/events')
  const response = makeResponse()
  route.handler({ on() {} }, response)
  const handlers = hostCtx.handlers.get('api-session/error') ?? []
  assert.ok(handlers.length > 0, 'api-session/error must be subscribed')
  for (const fn of handlers) fn('session-1', 'credentials rejected')
  const payload = JSON.parse(response.frames.find((f) => f.startsWith('data: ')).slice(6))
  assert.equal(payload.kind, 'session')
  assert.equal(payload.message, 'credentials rejected')
})

await check('host: clips an unbounded error message', () => {
  const route = hostCtx.routes.get('/api/bonk-pet/events')
  const response = makeResponse()
  route.handler({ on() {} }, response)
  for (const fn of hostCtx.handlers.get('agent/error') ?? []) {
    fn({ error: 'x'.repeat(5000) })
  }
  const frame = response.frames.find((f) => f.startsWith('data: '))
  const payload = JSON.parse(frame.slice(6))
  assert.ok(payload.message.length <= 201, `not clipped: ${payload.message.length}`)
})

await check('host: a dead socket never breaks the failure pipeline', () => {
  const route = hostCtx.routes.get('/api/bonk-pet/events')
  const dying = makeResponse()
  route.handler({ on() {} }, dying)
  // The socket dies after the stream opened: broadcast writes must be contained
  // and the listener must not throw back into the tool pipeline.
  let writes = 0
  dying.write = () => {
    writes += 1
    throw new Error('socket dead')
  }
  for (const fn of hostCtx.handlers.get('agent/error') ?? []) {
    fn({ error: 'boom' })
    fn({ error: 'boom again' })
  }
  assert.equal(writes, 1, 'the dead response should be dropped after one failure')
})

await check('host: unload ends every open stream', () => {
  const route = hostCtx.routes.get('/api/bonk-pet/events')
  const response = makeResponse()
  route.handler({ on() {} }, response)
  assert.equal(response.ended, false)
  // The teardown effect is the last one registered.
  hostCtx.effects.at(-1)()
  assert.equal(response.ended, true, 'stream should be ended on unload')
})

await check('host: registers the track, asset and skin routes', () => {
  assert.ok(hostCtx.routes.has('/api/bonk-pet/tracks'), 'tracks route missing')
  assert.ok(hostCtx.routes.has('/api/bonk-pet/asset'), 'asset route missing')
  assert.ok(hostCtx.routes.has('/api/bonk-pet/skin'), 'skin route missing')
})

await check('host: broadcasts the running/idle status', () => {
  const route = hostCtx.routes.get('/api/bonk-pet/events')
  const response = makeResponse()
  route.handler({ on() {} }, response)
  for (const fn of hostCtx.handlers.get('agent/status') ?? []) {
    fn({ status: 'running' })
  }
  const frame = response.frames.find((f) => f.startsWith('data: '))
  const payload = JSON.parse(frame.slice(6))
  assert.equal(payload.type, 'status')
  assert.equal(payload.status, 'running')
})

await check('host: ignores an unknown agent status', () => {
  const route = hostCtx.routes.get('/api/bonk-pet/events')
  const response = makeResponse()
  route.handler({ on() {} }, response)
  const before = response.frames.length
  for (const fn of hostCtx.handlers.get('agent/status') ?? []) {
    fn({ status: 'sideways' })
  }
  assert.equal(response.frames.length, before)
})

/** Drive the audio route with a real query string. */
function audioRequest(query) {
  const response = makeResponse()
  response.end = function (body) {
    this.ended = true
    this.body = body
  }
  return { response, request: { url: `/api/bonk-pet/asset${query}`, on() {} } }
}

await check('host: audio route rejects traversal and odd names', async () => {
  const route = hostCtx.routes.get('/api/bonk-pet/asset')
  const cases = [
    '?name=../../secret.mp3',
    '?name=..%2Fsecret.mp3',
    '?name=sub/dir.mp3',
    '?name=sub\\dir.mp3',
    '?name=.hidden.mp3',
    '?name=',
    '?name=' + 'a'.repeat(200) + '.mp3',
  ]
  for (const query of cases) {
    const { response, request } = audioRequest(query)
    await route.handler(request, response)
    assert.ok(response.statusCode >= 400, `${query} should be refused, got ${response.statusCode}`)
  }
})

await check('host: audio route refuses a non-audio extension', async () => {
  const route = hostCtx.routes.get('/api/bonk-pet/asset')
  const { response, request } = audioRequest('?name=notes.txt')
  await route.handler(request, response)
  assert.equal(response.statusCode, 415)
})

await check('host: audio route 404s a missing but well-formed name', async () => {
  const route = hostCtx.routes.get('/api/bonk-pet/asset')
  const { response, request } = audioRequest('?name=definitely-not-here.mp3')
  await route.handler(request, response)
  assert.equal(response.statusCode, 404)
})

await check('host: track listing answers even with no audio directory', async () => {
  const route = hostCtx.routes.get('/api/bonk-pet/tracks')
  const response = makeResponse()
  response.end = function (body) {
    this.ended = true
    this.body = body
  }
  await route.handler({ on() {} }, response)
  assert.equal(response.statusCode, 200)
  const payload = JSON.parse(response.body)
  assert.ok(Array.isArray(payload.tracks), 'tracks must be an array')
  assert.ok(typeof payload.dir === 'string' && payload.dir.length > 0, 'dir must be reported')
})

await check('host: the artwork probe fills slots from the bundled set', async () => {
  const route = hostCtx.routes.get('/api/bonk-pet/skin')
  const response = makeResponse()
  response.end = function (body) {
    this.ended = true
    this.body = body
  }
  await route.handler({ on() {} }, response)
  assert.equal(response.statusCode, 200)
  const payload = JSON.parse(response.body)
  assert.ok(payload.slots !== null && typeof payload.slots === 'object', 'slots must be an object')
  // This used to assert an EMPTY map, on the premise that every slot came from
  // the user's own directory. That premise is exactly what made a fresh install a
  // blank whale, so it was replaced by the bundled fallback. What must still hold
  // is that whatever comes back is well-formed and typed.
  for (const [slot, entry] of Object.entries(payload.slots)) {
    assert.ok(typeof entry.name === 'string' && entry.name.startsWith(slot), `bad name for ${slot}`)
    assert.ok(typeof entry.type === 'string' && entry.type.startsWith('image/'), `bad type for ${slot}`)
  }
  assert.ok(
    Array.isArray(payload.accepted) && payload.accepted.includes('pet.png'),
    'the accepted names must be advertised',
  )
  assert.ok(typeof payload.dir === 'string' && payload.dir.length > 0)
})

await check('host: a user file wins over the bundled one for the same slot', async () => {
  // The precedence rule, tested directly. If it ever inverted, dropping in your
  // own pet.png would silently do nothing — the owner's own artwork is the whole
  // reason the fallback is a fallback.
  const dir = join(sandboxHome, 'bonk-pet')
  mkdirSync(dir, { recursive: true })
  const mine = join(dir, 'pet.png')
  // A real PNG signature, so nothing downstream is misled by a text file.
  writeFileSync(mine, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  try {
    const route = hostCtx.routes.get('/api/bonk-pet/skin')
    const response = makeResponse()
    response.end = function (body) {
      this.ended = true
      this.body = body
    }
    await route.handler({ on() {} }, response)
    const payload = JSON.parse(response.body)
    assert.equal(payload.slots.pet?.bundled, false, 'the user-supplied pet.png must win')
  } finally {
    rmSync(mine, { force: true })
  }
})

await check('host: the asset route 404s a known-but-absent image type', async () => {
  // A supported extension that simply is not present must 404 — not 415
  // (unsupported) and not 400 (bad name).
  //
  // Uses `basin.png`, NOT `pet.png`: the plugin now ships pet.png as a bundled
  // fallback, so requesting it succeeds on a fresh install and this would assert
  // against the bundled file instead of the absent-file path. `basin` is a slot
  // that is deliberately not bundled — the drawn SVGs cover it.
  const route = hostCtx.routes.get('/api/bonk-pet/asset')
  const { response, request } = audioRequest('?name=basin.png')
  await route.handler(request, response)
  assert.equal(response.statusCode, 404)
})

await check('host: sound effects are split out of the song rotation', async () => {
  // `listAudio` must claim the effect files so a crash sound can never be
  // picked as background music. The user's files are named in Chinese.
  const route = hostCtx.routes.get('/api/bonk-pet/tracks')
  const response = makeResponse()
  response.end = function (body) {
    this.ended = true
    this.body = body
  }
  await route.handler({ on() {} }, response)
  assert.equal(response.statusCode, 200)
  const payload = JSON.parse(response.body)
  assert.ok(Array.isArray(payload.tracks), 'tracks must be an array')
  assert.ok(payload.effects !== null && typeof payload.effects === 'object', 'effects must be an object')

  // Whatever was claimed as an effect must be absent from the rotation.
  for (const file of Object.values(payload.effects)) {
    assert.ok(!payload.tracks.includes(file), `${file} must not also be a song`)
  }
})

await check('host: the volume route reports all three levels', async () => {
  // The sliders live in Settings → Plugins; the pet reads this route. If it
  // ever stops answering, the browser half silently keeps its defaults and a
  // slider move appears to do nothing — so the route is load-bearing.
  const route = hostCtx.routes.get('/api/bonk-pet/volume')
  assert.ok(route !== undefined, 'volume route missing')
  const response = makeResponse()
  response.end = function (body) {
    this.ended = true
    this.body = body
  }
  await route.handler({ on() {} }, response)
  assert.equal(response.statusCode, 200)
  const payload = JSON.parse(response.body)
  for (const key of ['music', 'pipe', 'knock']) {
    assert.equal(typeof payload[key], 'number', `${key} must be a number`)
    assert.ok(payload[key] >= 0 && payload[key] <= 1, `${key} must be within 0..1`)
  }
})

await check('host: the pipe is quieter than the music by default', () => {
  // The whole point of the feature: the steel-pipe impact was the sound the
  // user complained about, so its default must sit below the others rather
  // than at the old flat 0.7.
  assert.ok(host.VOLUME_DEFAULTS.pipe < host.VOLUME_DEFAULTS.music, 'pipe should default quieter')
  assert.ok(host.VOLUME_DEFAULTS.pipe < 0.5, 'pipe default should be clearly reduced')
})

await check('resolveVolumes clamps, fills gaps, and rejects junk', () => {
  // Raw YAML edits can put anything in the settings document; Audio.volume
  // throws outside 0..1, so the clamp has to happen before the value is used.
  const full = host.resolveVolumes({ music: 0.2, pipe: 0.1, knock: 0.3 })
  assert.deepEqual(full, { music: 0.2, pipe: 0.1, knock: 0.3 })

  const clamped = host.resolveVolumes({ music: 5, pipe: -3, knock: 0.5 })
  assert.equal(clamped.music, 1, 'above 1 clamps to 1')
  assert.equal(clamped.pipe, 0, 'below 0 clamps to 0')

  const partial = host.resolveVolumes({ music: 0.9 })
  assert.equal(partial.music, 0.9, 'supplied value wins')
  assert.equal(partial.pipe, host.VOLUME_DEFAULTS.pipe, 'missing field falls back')
  assert.equal(partial.knock, host.VOLUME_DEFAULTS.knock, 'missing field falls back')

  // Garbage must degrade to defaults, never to NaN (which would make the
  // assignment a silent no-op and pin the sound at whatever it was).
  for (const junk of [undefined, null, 'loud', [], { music: 'x' }, { pipe: Number.NaN }]) {
    const out = host.resolveVolumes(junk)
    for (const key of ['music', 'pipe', 'knock']) {
      assert.ok(Number.isFinite(out[key]), `${key} must stay finite for ${JSON.stringify(junk)}`)
    }
  }
})

await check('host: a symlink cannot escape the asset directory', async () => {
  // The string guard alone is not enough: a symlink inside the directory has a
  // path that starts with the directory yet points outside it. Writing the
  // target outside the served folder and linking to it proves whether the
  // realpath re-check is doing its job.
  const dir = join(sandboxHome, 'bonk-pet')
  mkdirSync(dir, { recursive: true })
  const secret = join(sandboxHome, 'secret.png')
  writeFileSync(secret, 'not yours')
  const link = join(dir, 'pet.png')
  rmSync(link, { force: true })
  try {
    symlinkSync(secret, link)
  } catch {
    // Windows without developer mode cannot create symlinks; nothing to prove.
    return
  }

  const route = hostCtx.routes.get('/api/bonk-pet/asset')
  const { response, request } = audioRequest('?name=pet.png')
  await route.handler(request, response)

  // The invariant is the SECRET, not the status code.
  //
  // Before the bundled fallback existed this asserted 404, because a refused
  // user file was the end of the road. Now a refused file can legitimately fall
  // through to the bundled pet.png (a 200), and that is not a hole — the
  // fallback is a different directory. Asserting 404 would therefore fail for a
  // reason that has nothing to do with the guarantee, so the guarantee is stated
  // directly: whatever comes back, it is never the file outside the directory.
  assert.ok(
    response.statusCode === 404 || response.statusCode === 200,
    `unexpected status ${response.statusCode}`,
  )
  const body = String(response.body ?? '')
  assert.ok(!body.includes('not yours'), 'the symlink target must never be served')
  rmSync(link, { force: true })
})

await check('host: a child agent finishing does not stop the song', async () => {
  // `agent/status` fires per agent. A naive last-writer-wins would report
  // `idle` the moment any child finished, silencing the pet mid-task.
  //
  // Runs against a FRESH context: the aggregate lives in the plugin instance,
  // so sharing `hostCtx` would inherit whatever earlier tests left behind.
  const fresh = makeHostCtx()
  host.apply(fresh)

  const sse = makeResponse()
  fresh.routes.get('/api/bonk-pet/events').handler({ on() {} }, sse)

  const fire = (agent, status) => {
    for (const handler of fresh.handlers.get('agent/status') ?? []) handler({ agent, status })
  }
  const frames = () => sse.frames.filter((f) => f.startsWith('data: '))

  const parent = { id: 'parent' }
  const child = { id: 'child' }

  fire(parent, 'running')
  assert.equal(frames().length, 1, 'the parent starting must be reported')
  assert.match(frames()[0], /"status":"running"/)

  // The child starts and stops while the parent is still working.
  fire(child, 'running')
  fire(child, 'idle')
  assert.equal(
    frames().length,
    1,
    'a child finishing must not be reported as idle while the parent runs',
  )

  // A second child doing the same must also stay quiet.
  fire({ id: 'child2' }, 'running')
  fire({ id: 'child2' }, 'idle')
  assert.equal(frames().length, 1, 'any child finishing must stay quiet')

  // Only when every agent has stopped does the aggregate go idle.
  fire(parent, 'idle')
  assert.equal(frames().length, 2, 'the parent stopping must be reported')
  assert.match(frames()[1], /"status":"idle"/)
})

// ---------------------------------------------------------------------------
// Client half
// ---------------------------------------------------------------------------

const harness = installHarness()

// Load the plugin bundle through the shim; it registers a factory by id.
await import('../lib/client.js')

await check('client: bundle registers a factory and exports apply', () => {
  const factory = harness.registry.get('dsh-bonk-pet')
  assert.equal(typeof factory, 'function', 'factory not registered')
  const mod = factory(() => {
    throw new Error('no requires expected')
  })
  assert.equal(typeof mod.apply, 'function', 'apply not exported')
})

/** Invoke apply with a ctx that runs effects immediately. */
function bootClient() {
  const disposers = []
  const ctx = {
    effect(factory) {
      const dispose = factory()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
    on() {
      return () => {}
    },
  }
  const factory = harness.registry.get('dsh-bonk-pet')
  const mod = factory(() => {
    throw new Error('no requires expected')
  })
  mod.apply(ctx)
  return disposers
}

let disposers = []

await check('client: mounts the pet into the document', () => {
  disposers = bootClient()
  const root = harness.document.body.querySelector('[data-bonk-root]')
  assert.ok(root !== null, 'root not mounted')
  assert.ok(harness.document.body.hasAttribute('data-dsh-bonk-pet'), 'scope attribute missing')
})

await check('client: injects its stylesheet exactly once', () => {
  const styles = harness.document.head.querySelectorAll('style')
  const mine = styles.filter((tag) => tag.dataset.pluginCss === 'dsh-bonk-pet/bonk-pet.css')
  assert.equal(mine.length, 1, `expected one style tag, found ${mine.length}`)
  assert.equal(mine[0].dataset.plugin, 'dsh-bonk-pet')
  // The rules must actually be there, not an empty tag.
  assert.ok(mine[0].textContent.includes('[data-bonk-root]'), 'stylesheet body is empty')
  assert.ok(mine[0].textContent.includes('@keyframes bonk-fall'), 'pipe animation missing')
  assert.ok(
    mine[0].textContent.includes('position:fixed'),
    'the pet must be anchored to the viewport',
  )
})

await check('client: opens the failure stream', () => {
  assert.equal(harness.sources.length, 1, 'expected exactly one EventSource')
  assert.equal(harness.sources[0].url, '/api/bonk-pet/events')
  assert.equal(harness.sources[0].closed, false)
})

await check('client: knocking increments the counter and shows a line', () => {
  const root = harness.document.body.querySelector('[data-bonk-root]')
  const basin = root.querySelector('[data-bonk-basin]')
  const bubble = root.querySelector('[data-bonk-bubble]')
  assert.ok(basin !== null, 'basin missing')
  basin.dispatch('click', { clientX: 0, clientY: 0, pointerId: 1 })
  assert.equal(root.dataset.state, 'knock', 'expected knock state')
  assert.equal(bubble.dataset.show, '1', 'expected the bubble to open')
  assert.ok(bubble.textContent.length > 0, 'expected a line of dialogue')
  const stored = JSON.parse(harness.localStorage.getItem('dsh-bonk-pet/v1'))
  assert.equal(stored.knocks, 1, 'knock not persisted')
})

await check('client: knocking drains food', () => {
  const before = JSON.parse(harness.localStorage.getItem('dsh-bonk-pet/v1')).food
  const root = harness.document.body.querySelector('[data-bonk-root]')
  root.querySelector('[data-bonk-basin]').dispatch('click', { clientX: 0, clientY: 0, pointerId: 1 })
  const after = JSON.parse(harness.localStorage.getItem('dsh-bonk-pet/v1')).food
  assert.ok(after < before, `food should drop: ${before} -> ${after}`)
})

await check('client: a repeated knock is not swallowed', () => {
  // Re-entering the same transient state must clear `data-state` first, or the
  // engine never restarts the shake keyframes and the second knock looks dead.
  const root = harness.document.body.querySelector('[data-bonk-root]')
  const basin = root.querySelector('[data-bonk-basin]')
  const before = JSON.parse(harness.localStorage.getItem('dsh-bonk-pet/v1')).knocks

  basin.dispatch('click', { clientX: 0, clientY: 0, pointerId: 1 })
  assert.equal(root.dataset.state, 'knock', 'first knock enters the state')
  basin.dispatch('click', { clientX: 0, clientY: 0, pointerId: 1 })
  assert.equal(root.dataset.state, 'knock', 'second knock keeps the state')

  const after = JSON.parse(harness.localStorage.getItem('dsh-bonk-pet/v1')).knocks
  assert.equal(after - before, 2, `both knocks must count, got ${after - before}`)
})

await check('client: a failure frame drops the pipe', () => {
  const root = harness.document.body.querySelector('[data-bonk-root]')
  const source = harness.sources[0]
  source.emit('message', { type: 'error', kind: 'tool', tool: 'pwsh', message: 'TOOL_TIMEOUT' })
  const pipe = root.querySelector('[data-bonk-pipe]')
  assert.equal(pipe.dataset.fall, '1', 'pipe should start falling')
  const stored = JSON.parse(harness.localStorage.getItem('dsh-bonk-pet/v1'))
  assert.equal(stored.hits, 1, 'hit not persisted')
})

await check('client: malformed frames are ignored', () => {
  const root = harness.document.body.querySelector('[data-bonk-root]')
  const before = root.querySelector('[data-bonk-pipe]').dataset.fall
  const source = harness.sources[0]
  // Bypass emit()'s JSON.stringify to send junk.
  for (const handler of Object.values(source._listeners ?? {}).flat()) handler({ data: 'not json' })
  assert.equal(root.querySelector('[data-bonk-pipe]').dataset.fall, before)
})

await check('client: repeated failures are rate-limited while a pipe is airborne', () => {
  const root = harness.document.body.querySelector('[data-bonk-root]')
  const source = harness.sources[0]
  const before = JSON.parse(harness.localStorage.getItem('dsh-bonk-pet/v1')).hits
  source.emit('message', { type: 'error' })
  source.emit('message', { type: 'error' })
  const after = JSON.parse(harness.localStorage.getItem('dsh-bonk-pet/v1')).hits
  assert.ok(after - before <= 1, `expected at most one hit, got ${after - before}`)
})

await check('client: teardown removes every node and the scope attribute', () => {
  for (const dispose of disposers) dispose()
  assert.equal(harness.document.body.querySelector('[data-bonk-root]'), null, 'root left behind')
  assert.equal(
    harness.document.body.hasAttribute('data-dsh-bonk-pet'),
    false,
    'scope attribute left behind',
  )
})

// ---------------------------------------------------------------------------
// Client: singing while the agent works
// ---------------------------------------------------------------------------

// The first harness was restored above; boot a second one so the audio tests
// start from a clean document and a known track listing.
const sing = installHarness()
sing.tracks(['letmego.mp3', 'other.mp3'])
await import(`../lib/client.js?sing=${Date.now()}`)

function bootSing(soundOn) {
  const disposers = []
  const factory = sing.registry.get('dsh-bonk-pet')
  const mod = factory(() => {
    throw new Error('no requires expected')
  })
  mod.apply({
    effect(f) {
      const d = f()
      if (typeof d === 'function') disposers.push(d)
      return d
    },
    on() {
      return () => {}
    },
  })
  return disposers
}

let singDisposers = []

await check('sing: mounts with an audio element and loads the track list', async () => {
  if (typeof localStorage !== 'undefined') localStorage.setItem('dsh-bonk-pet/sound', 'on')
  singDisposers = bootSing(true)
  await sing.flush()
  const asked = sing.requests.map((r) => r.url)
  assert.ok(asked.includes('/api/bonk-pet/tracks'), `expected a track listing fetch, saw ${asked}`)
  assert.equal(sing.audio.length, 1, 'exactly one Audio element expected')
  assert.equal(sing.audio[0].loop, true, 'the song must loop')
})

await check('sing: running starts the song, idle stops it', async () => {
  const source = sing.sources.at(-1)
  const audio = sing.audio[0]
  assert.equal(audio.playCalls, 0, 'must not play before a task starts')

  source.emit('message', { type: 'status', status: 'running' })
  await sing.flush()
  assert.equal(audio.playCalls, 1, 'running should start playback')
  assert.match(audio.src, /letmego\.mp3/, `expected the letmego track, got ${audio.src}`)

  source.emit('message', { type: 'status', status: 'idle' })
  assert.ok(audio.pauseCalls >= 1, 'idle should pause playback')
})

await check('sing: the pet enters the sing state while running', () => {
  const root = sing.document.body.querySelector('[data-bonk-root]')
  const source = sing.sources.at(-1)
  source.emit('message', { type: 'status', status: 'running' })
  assert.equal(root.dataset.state, 'sing', 'expected the sing state')
  source.emit('message', { type: 'status', status: 'idle' })
  assert.notEqual(root.dataset.state, 'sing', 'sing must end when idle')
})

await check('sing: a repeated status does not restart the song', async () => {
  const source = sing.sources.at(-1)
  const audio = sing.audio[0]
  source.emit('message', { type: 'status', status: 'running' })
  await sing.flush()
  const after = audio.playCalls
  source.emit('message', { type: 'status', status: 'running' })
  source.emit('message', { type: 'status', status: 'running' })
  await sing.flush()
  assert.equal(audio.playCalls, after, 'an unchanged status must not replay the song')
  source.emit('message', { type: 'status', status: 'idle' })
})

/** Boot a harness for the audio-policy cases, optionally pre-unlocking sound. */
async function bootBlocked(soundOn) {
  const h = installHarness()
  h.tracks(['letmego.mp3'])
  if (soundOn) h.localStorage.setItem('dsh-bonk-pet/sound', 'on')
  await import(`../lib/client.js?b=${Date.now()}-${Math.random()}`)
  const factory = h.registry.get('dsh-bonk-pet')
  const mod = factory(() => {
    throw new Error('no requires expected')
  })
  const disposers = []
  mod.apply({
    effect(f) {
      const d = f()
      if (typeof d === 'function') disposers.push(d)
      return d
    },
    on() {
      return () => {}
    },
  })
  await h.flush()
  return { h, disposers, root: h.document.body.querySelector('[data-bonk-root]') }
}

await check('sing: sound starts locked and invites a click', async () => {
  // A browser that has never been granted a gesture: the pet may not play yet.
  const { h, disposers, root } = await bootBlocked(false)
  const audio = h.audio[0]
  h.sources.at(-1).emit('message', { type: 'status', status: 'running' })
  await h.flush(12)

  assert.equal(audio.playCalls, 0, 'playback must not be attempted before a gesture')
  const chip = root.querySelector('[data-bonk-mute]')
  assert.equal(chip.dataset.show, '1', 'the chip must invite a click')

  // The click unlocks and starts the song.
  chip.dispatch('click', {})
  await h.flush(12)
  assert.equal(audio.playCalls, 1, 'the click must start playback')
  assert.equal(chip.dataset.show, '0', 'the chip must hide once sound works')
  assert.match(audio.src, /letmego\.mp3/)

  for (const d of disposers) d()
  h.restore()
})

await check('sing: a rejected play() re-offers the click', async () => {
  // Sound was unlocked earlier, but the browser still refuses right now.
  // An autoplay refusal is NOT a bad file: readyState stays 0 because the
  // policy rejects before any bytes load, so the track must survive.
  const { h, disposers, root } = await bootBlocked(true)
  const audio = h.audio[0]
  // Code 0 = autoplay refusal: `error` stays null, which is exactly how a real
  // browser reports it.
  audio.failWith(0)

  h.sources.at(-1).emit('message', { type: 'status', status: 'running' })
  await h.flush(12)

  assert.equal(audio.playCalls, 1, 'the pet should have tried to play')
  const chip = root.querySelector('[data-bonk-mute]')
  assert.equal(chip.dataset.show, '1', 'a refused play must re-offer the chip')

  // Now the browser allows it; the click must retry the SAME track.
  audio.playResult = Promise.resolve()
  audio.error = null
  chip.dispatch('click', {})
  await h.flush(12)
  assert.equal(audio.playCalls, 2, 'the click must retry playback')
  assert.match(audio.src, /letmego/, 'the same, good track must be retried')
  assert.equal(chip.dataset.show, '0', 'the chip must hide once sound works')

  for (const d of disposers) d()
  h.restore()
})

await check('sing: a late play() success cannot resurrect a stopped song', async () => {
  // The race that used to wedge the pet into permanent silence: play() is
  // still in flight when the task ends, and its success callback would write
  // 'playing' over a newer 'stopped'. The `music !== 'stopped'` guard then
  // refused to ever start again.
  const { h, disposers, root } = await bootBlocked(true)
  const audio = h.audio[0]
  const source = h.sources.at(-1)

  // Hold the play() promise open so we control when it settles.
  let settle = null
  audio.playResult = new Promise((resolve) => {
    settle = resolve
  })

  source.emit('message', { type: 'status', status: 'running' })
  await h.flush(4)
  assert.equal(root.dataset.state, 'sing', 'singing while the task runs')

  // The task ends while play() is still pending.
  source.emit('message', { type: 'status', status: 'idle' })
  await h.flush(4)
  assert.notEqual(root.dataset.state, 'sing', 'the song must stop')

  // The stale success arrives late.
  settle()
  await h.flush(12)

  // The pet must still be able to sing on the next task.
  audio.playResult = Promise.resolve()
  source.emit('message', { type: 'status', status: 'running' })
  await h.flush(12)
  assert.equal(
    root.dataset.state,
    'sing',
    'a stale play() callback must not permanently block playback',
  )
  assert.equal(audio.playCalls, 2, 'the second task must actually start playback')

  for (const d of disposers) d()
  h.restore()
})

await check('sing: a network failure does not blacklist a good track', async () => {
  // Only a decode/format failure retires a track. A transient network error
  // used to look identical (readyState was left over from an earlier success)
  // and would permanently remove a perfectly good song.
  const { h, disposers, root } = await bootBlocked(true)
  const audio = h.audio[0]
  const source = h.sources.at(-1)

  // A previous successful load leaves readyState high.
  audio.readyState = 4
  // Network error: code 2, which must NOT retire the file.
  audio.failWith(2)

  source.emit('message', { type: 'status', status: 'running' })
  await h.flush(12)

  // Retry: the same track must still be selected.
  audio.error = null
  audio.playResult = Promise.resolve()
  source.emit('message', { type: 'status', status: 'idle' })
  await h.flush(4)
  h.localStorage.setItem('dsh-bonk-pet/sound', 'on')
  root.querySelector('[data-bonk-mute]').dispatch('click', {})
  source.emit('message', { type: 'status', status: 'running' })
  await h.flush(12)

  assert.match(audio.src, /letmego/, 'a network error must not retire the track')

  for (const d of disposers) d()
  h.restore()
})

await check('sing: a dropped relay stops the song instead of looping forever', async () => {
  // If the stream dies mid-task, the pet can never learn the task ended; it
  // must fall back to rest rather than sing on a dead wire.
  const { h, disposers, root } = await bootBlocked(true)
  const audio = h.audio[0]
  const source = h.sources.at(-1)

  source.emit('message', { type: 'status', status: 'running' })
  await h.flush()
  assert.equal(root.dataset.state, 'sing', 'singing while the task runs')

  // The relay drops.
  source.dispatchError()
  assert.notEqual(root.dataset.state, 'sing', 'a dropped stream must end the song')
  assert.ok(audio.pauseCalls >= 1, 'the audio must be paused')

  for (const d of disposers) d()
  h.restore()
})

await check('sing: an undecodable track is retired, not retried forever', async () => {
  // Two files, the first one loads metadata but cannot be decoded. The pet
  // must retire it and move to the second, not loop on a hopeless file.
  const h = installHarness()
  h.tracks(['letmego.ogg', 'backup.mp3'])
  h.localStorage.setItem('dsh-bonk-pet/sound', 'on')
  await import(`../lib/client.js?dead=${Date.now()}-${Math.random()}`)
  const factory = h.registry.get('dsh-bonk-pet')
  const disposers = []
  factory(() => {
    throw new Error('no requires')
  }).apply({
    effect(f) {
      const d = f()
      if (typeof d === 'function') disposers.push(d)
      return d
    },
    on() {
      return () => {}
    },
  })
  await h.flush()

  const audio = h.audio[0]
  const source = h.sources.at(-1)

  // First attempt: the file loads but cannot be decoded (MediaError 4 =
  // src not supported). That is about the file, so it must be retired.
  audio.failWith(4)
  source.emit('message', { type: 'status', status: 'running' })
  await h.flush(12)
  assert.match(audio.src, /letmego\.ogg/, 'the preferred track is tried first')

  // Next task: the dead file must be skipped in favour of the other one.
  source.emit('message', { type: 'status', status: 'idle' })
  audio.error = null
  audio.playResult = Promise.resolve()
  const chip = h.document.body.querySelector('[data-bonk-root]').querySelector('[data-bonk-mute]')
  chip.dispatch('click', {})
  await h.flush(12)
  source.emit('message', { type: 'status', status: 'running' })
  await h.flush(12)

  assert.match(audio.src, /backup\.mp3/, `expected the fallback track, got ${audio.src}`)

  for (const d of disposers) d()
  h.restore()
})

await check('sing: teardown stops the audio', () => {
  const audio = sing.audio[0]
  const before = audio.pauseCalls
  for (const dispose of singDisposers) dispose()
  assert.ok(audio.pauseCalls > before, 'teardown must pause playback')
})

sing.restore()

// ---------------------------------------------------------------------------

harness.restore()

let failed = 0
for (const result of results) {
  if (result.ok) {
    console.log(`  PASS  ${result.name}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${result.name}`)
    console.log(`        ${result.error?.message ?? result.error}`)
    if (result.error?.stack) {
      console.log(
        result.error.stack
          .split('\n')
          .slice(1, 4)
          .map((line) => `        ${line.trim()}`)
          .join('\n'),
      )
    }
  }
}
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
