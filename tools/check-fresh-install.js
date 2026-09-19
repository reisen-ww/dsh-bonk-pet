/**
 * Simulate a STRANGER installing the plugin, with no access to the author's files.
 *
 * The point of the bundled assets is that a fresh install works. Nothing so far
 * proves that, because every test runs on the author's machine with a populated
 * `~/.dsh/bonk-pet/`. This points `DSH_HOME` at an empty directory, imports the
 * host half, and requires that it finds artwork and sound WITHOUT the user having
 * supplied any — the exact situation of someone who just installed it.
 *
 * Run: node tools/check-fresh-install.js
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sandbox = mkdtempSync(join(tmpdir(), 'bonk-fresh-'))
process.env.DSH_HOME = sandbox

const home = await import('../lib/index.js')

const routes = new Map()
const effects = []
home.apply({
  on: () => () => {},
  inject(_services, fn) {
    fn({
      effect(factory) {
        effects.push(factory())
      },
      webServer: {
        register(route) {
          routes.set(route.path, route)
          return () => routes.delete(route.path)
        },
      },
    })
  },
  effect(factory) {
    effects.push(factory())
  },
})

/** Minimal response that records status and body. */
function makeResponse() {
  const chunks = []
  return {
    statusCode: 0,
    headers: null,
    writeHead(code, headers) {
      this.statusCode = code
      this.headers = headers
    },
    write(chunk) {
      chunks.push(Buffer.from(String(chunk)))
      return true
    },
    end(body) {
      if (body !== undefined) chunks.push(Buffer.from(String(body)))
      this.body = Buffer.concat(chunks).toString('utf8')
    },
    on() {},
    emit() {
      return true
    },
    once() {
      return this
    },
    destroy() {},
  }
}

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ::  ${detail}`}`)
}

console.log(`fresh DSH_HOME = ${sandbox}\n`)

// --- artwork -----------------------------------------------------------------
const skin = makeResponse()
await routes.get('/api/bonk-pet/skin').handler({}, skin)
const slots = JSON.parse(skin.body).slots ?? {}
check(
  'artwork is available with no user files',
  typeof slots.pet?.name === 'string' && slots.pet.bundled === true,
  `slots=${JSON.stringify(Object.keys(slots))} pet=${JSON.stringify(slots.pet)}`,
)

// --- audio -------------------------------------------------------------------
const tracks = makeResponse()
await routes.get('/api/bonk-pet/tracks').handler({}, tracks)
const audio = JSON.parse(tracks.body)
check(
  'sound effects are available with no user files',
  typeof audio.effects?.knock === 'string' && typeof audio.effects?.clang === 'string',
  `effects=${JSON.stringify(audio.effects)}`,
)
check(
  'the bundled song ships, so a fresh install can sing',
  Array.isArray(audio.tracks) && audio.tracks.includes('letmego.mp3'),
  `tracks=${JSON.stringify(audio.tracks)}`,
)

// --- the bytes actually stream ------------------------------------------------
//
// The response must be AWAITED, not inspected immediately: `stream.pipe(response)`
// writes on the next ticks, so checking the body straight after `handler()` returns
// sees 0 bytes even though the route worked. That is a test bug, not a product one,
// and it is why this asserts on byte counts rather than just the status.
const streamBytes = async (name) => {
  const res = makeResponse()
  let settled = false
  const originalEnd = res.end.bind(res)
  res.end = (body) => {
    originalEnd(body)
    settled = true
  }
  await routes
    .get('/api/bonk-pet/asset')
    .handler({ url: `/api/bonk-pet/asset?name=${encodeURIComponent(name)}`, on() {} }, res)
  // Give the stream a bounded window to finish; if it never does, that is itself
  // a failure the byte count will report.
  for (let i = 0; i < 100 && !settled; i += 1) {
    await new Promise((r) => setTimeout(r, 20))
  }
  return { status: res.statusCode, type: res.headers?.['content-type'], bytes: Buffer.byteLength(res.body ?? '', 'utf8') }
}

for (const [label, name] of [
  ['bundled artwork', slots.pet?.name],
  ['bundled knock sfx', audio.effects?.knock],
]) {
  if (typeof name !== 'string') {
    check(`${label} streams`, false, 'nothing to request')
    continue
  }
  const got = await streamBytes(name)
  check(
    `${label} streams`,
    got.status === 200 && got.bytes > 1000,
    `${name} -> ${got.status} ${got.type ?? '?'} ${got.bytes}B`,
  )
}

// --- and the fallback is not a hole ------------------------------------------
const escape = makeResponse()
await routes
  .get('/api/bonk-pet/asset')
  .handler({ url: '/api/bonk-pet/asset?name=../../../etc/passwd', on() {} }, escape)
check(
  'traversal is still refused on a fresh install',
  escape.statusCode >= 400,
  `status=${escape.statusCode}`,
)

rmSync(sandbox, { recursive: true, force: true })

const bad = results.filter((r) => !r.ok)
console.log(`\n${results.length - bad.length}/${results.length} passed`)
process.exit(bad.length === 0 ? 0 : 1)
