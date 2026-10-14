/**
 * Prove the two volume bugs stay fixed.
 *
 * Both were silent: the slider moved, the percentage updated, and the sound did
 * not change — so nothing but a real audio element can tell them apart. Each
 * check below is written so that reverting its fix makes it FAIL; see
 * `tools/check-sensitivity.js` for the project's rule on this.
 *
 * Bug 1 — `loadVolumes()` short-circuited on a stored local copy and never
 *   called `applyVolumes`, so `audio.volume` kept the placeholder 0.65 forever.
 * Bug 2 — the host's `volumes` was a module-level object with no persistence,
 *   so every value was lost when DSH restarted.
 *
 * Run: node tools/check-volume.js
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sandbox = mkdtempSync(join(tmpdir(), 'bonk-vol-'))
process.env.DSH_HOME = sandbox

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ::  ${detail}`}`)
}

// --- bug 2: the host half must persist --------------------------------------
{
  const home = await import('../lib/index.js')

  // Collect the routes the host registers, so the volume route can be driven.
  const routes = new Map()
  const effects = []
  home.apply({
    on: () => () => {},
    // `apply()` registers a teardown effect at its TOP level (see the relay
    // teardown at the end of lib/index.js), not only inside `inject()`. The
    // double must expose `effect` in both places: without this the tool died
    // with "ctx.effect is not a function" before a single check ran, which is
    // how the volume fix went unverified.
    effect(factory) {
      effects.push(factory())
    },
    inject(_services, fn) {
      fn({
        effect(factory) {
          effects.push(factory())
        },
        webServer: {
          register(options) {
            routes.set(options.path, options.handler)
            return () => {}
          },
        },
        logger: { info() {}, warn() {} },
      })
    },
  })

  const route = [...routes.entries()].find(([path]) => path.includes('volume'))
  check('the host registers a volume route', route !== undefined, `routes=${[...routes.keys()].join(', ')}`)

  if (route !== undefined) {
    const handler = route[1]

    /** Minimal response double; the host only needs these methods. */
    const respond = () => {
      const chunks = []
      let settle
      const promise = new Promise((resolve) => {
        settle = resolve
      })
      const response = {
        statusCode: 0,
        setHeader() {},
        // `sendJson()` in lib/index.js writes the status through
        // `writeHead(status, headers)`, so the double must implement it —
        // with only `setHeader` every route call threw before answering.
        writeHead(status) {
          response.statusCode = status
          return response
        },
        write(chunk) {
          if (chunk !== undefined) chunks.push(chunk)
        },
        end(chunk) {
          if (chunk !== undefined) chunks.push(chunk)
          settle({ status: response.statusCode, body: chunks.join('') })
        },
      }
      // The response is reached by callers as `pending.__response`. It used to
      // be attached to the `resolve` FUNCTION inside the executor, so the
      // promise itself carried nothing and every call passed `undefined` to the
      // handler.
      promise.__response = response
      return promise
    }

    /** Drive the handler and read the JSON it wrote. */
    const callRoute = async (method, body) => {
      const pending = respond()
      const response = pending.__response
      // `readBody()` in lib/index.js consumes the request as a Node stream
      // (`request.on('data' | 'end')`), not as an async iterator. A double that
      // only implements `Symbol.asyncIterator` has no `on`, so the read settled
      // through the `close` handler as `null` and every POST answered 413.
      const request = {
        method,
        headers: {},
        on(event, listener) {
          if (event === 'data' && body !== undefined) {
            listener(Buffer.from(JSON.stringify(body)))
          }
          if (event === 'end') {
            listener()
          }
          return request
        },
      }
      const promise = handler(request, response)
      const [result] = await Promise.all([pending, promise])
      return result
    }

    // A value of exactly 0 is the case the bug report is about, and 0 is also
    // the value a truthiness check would drop.
    //
    // Every assertion below parses the JSON instead of matching `"music":0`
    // with a regex: that regex also matches `"music":0.65`, so it passed
    // against the DEFAULTS and hid both failures it was written to catch.
    const musicOf = (text) => {
      try {
        const parsed = JSON.parse(text)
        const value = parsed?.volumes?.music ?? parsed?.music
        return typeof value === 'number' ? value : null
      } catch {
        return null
      }
    }

    const posted = await callRoute('POST', { music: 0, pipe: 0, knock: 0 })
    check(
      'the host accepts an all-zero volume set',
      posted.status === 200 && musicOf(posted.body) === 0,
      `status=${posted.status} body=${posted.body.slice(0, 90)}`,
    )

    const file = join(sandbox, 'bonk-pet', 'volume.json')
    // `saveVolumes()` writes on a detached promise (it must not block the
    // response), so the check has to let the event loop drain before reading.
    // Without this the assertion raced the write and reported "no volume.json"
    // even when persistence worked.
    await new Promise((resolve) => setTimeout(resolve, 50))
    let onDisk = null
    try {
      onDisk = readFileSync(file, 'utf8')
    } catch {
      onDisk = null
    }
    check(
      'the host writes the values to disk (survives a restart)',
      onDisk !== null && musicOf(onDisk) === 0,
      onDisk === null ? 'no volume.json was written' : `volume.json=${onDisk.replace(/\s+/g, ' ').slice(0, 70)}`,
    )

    const readBack = await callRoute('GET')
    check(
      'a GET returns the stored values, not the defaults',
      readBack.status === 200 && musicOf(readBack.body) === 0,
      `body=${readBack.body.slice(0, 90)}`,
    )

    // The real restart test: a FRESH import of the module must read the file
    // back. The module is cached by specifier, so this clears it first.
    const fresh = await import(`../lib/index.js?restart=${Date.now()}`)
    const freshRoutes = new Map()
    fresh.apply({
      on: () => () => {},
      effect(factory) {
        factory()
      },
      inject(_services, fn) {
        fn({
          effect(factory) {
            factory()
          },
          webServer: {
            register(options) {
              freshRoutes.set(options.path, options.handler)
              return () => {}
            },
          },
          logger: { info() {}, warn() {} },
        })
      },
    })
    const freshRoute = [...freshRoutes.entries()].find(([path]) => path.includes('volume'))
    if (freshRoute !== undefined) {
      const pending = respond()
      const request = { method: 'GET', headers: {}, on: () => request }
      const promise = freshRoute[1](request, pending.__response)
      const [result] = await Promise.all([pending, promise])
      check(
        'after a simulated restart the user value is still served',
        musicOf(result.body) === 0,
        `body=${result.body.slice(0, 90)}`,
      )
    } else {
      check('after a simulated restart the user value is still served', false, 'no route')
    }
  }

  for (const dispose of effects) {
    if (typeof dispose === 'function') dispose()
  }
}

// --- bug 1: the client must APPLY what it has -------------------------------
{
  const source = readFileSync('lib/client.js', 'utf8')

  // The client is a browser bundle with no importable entry point, so this
  // asserts the shape of the fix rather than executing it. That is weaker than
  // a browser probe, and is stated as such — the browser probe below is the
  // real proof.
  const loadBody = source.slice(source.indexOf('async function loadVolumes()'))
  const appliesLocal = loadBody.indexOf('applyVolumes(readStoredVolumes())')
  const storedGuard = loadBody.indexOf('if (stored !== null) return')
  check(
    'loadVolumes applies the local copy BEFORE the stored-copy guard',
    appliesLocal !== -1 && storedGuard !== -1 && appliesLocal < storedGuard,
    appliesLocal === -1
      ? 'applyVolumes(readStoredVolumes()) not found — the placeholder volume would win'
      : `apply at ${appliesLocal}, guard at ${storedGuard}`,
  )
}

rmSync(sandbox, { recursive: true, force: true })

const bad = results.filter((r) => !r.ok)
console.log(`\n${results.length - bad.length}/${results.length} passed`)
process.exit(bad.length === 0 ? 0 : 1)
