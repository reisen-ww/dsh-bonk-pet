/**
 * Verify the pet struggles when grabbed mid-dash, and stays put otherwise.
 *
 * The rule being tested: grabbing the pet WHILE it is running for its rice makes
 * it wriggle and complain; grabbing it at rest does not, because `struggle` would
 * then fire on every ordinary drag and stop meaning anything.
 *
 * Written as a contrast pair on purpose — a probe that only checks "grabbing
 * during a dash shows the struggle state" passes trivially if the state is shown
 * on EVERY grab. The negative case is what gives the positive one meaning.
 *
 * Run: node tools/serve-demo.js   (terminal 1)
 *      node test/probe-struggle.js [baseUrl]
 */

import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = process.argv[2] ?? 'http://127.0.0.1:43900'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9400 + Math.floor(Math.random() * 400)

const edge = spawn(
  EDGE,
  [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--window-size=1280,800',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'bonk-struggle-'))}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function target() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page')
      if (page !== undefined) return page.webSocketDebuggerUrl
    } catch {}
    await sleep(300)
  }
  throw new Error('debugger unreachable')
}

let seq = 0
const pending = new Map()
const call = (ws, method, params = {}) => {
  const id = (seq += 1)
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ::  ${detail}`}`)
}

try {
  const ws = new WebSocket(await target())
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id === undefined) return
    const s = pending.get(m.id)
    if (s === undefined) return
    pending.delete(m.id)
    if (m.error !== undefined) s.reject(new Error(JSON.stringify(m.error)))
    else s.resolve(m.result)
  })

  await call(ws, 'Page.enable')
  await call(ws, 'Runtime.enable')
  await call(ws, 'Page.navigate', { url: `${base}/` })
  await sleep(3000)
  await call(ws, 'Runtime.evaluate', { expression: `localStorage.removeItem('dsh-bonk-pet/v1')` })
  await call(ws, 'Page.navigate', { url: `${base}/` })
  await sleep(3500)

  const ev = async (expression) =>
    (await call(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))
      .result.value

  const state = () =>
    ev(`(() => {
      const root = document.querySelector('[data-bonk-root]')
      return {
        state: root.dataset.state,
        bubble: document.querySelector('[data-bonk-bubble]').textContent,
        showing: document.querySelector('[data-bonk-bubble]').dataset.show,
        ricePresent: document.querySelector('[data-bonk-rice]')?.dataset.show ?? '0',
      }
    })()`)

  const centre = () =>
    ev(`(() => {
      const r = document.querySelector('[data-bonk-whale]').getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    })()`)

  const mouse = (type, x, y) =>
    call(ws, 'Input.dispatchMouseEvent', {
      type, x, y, button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: 1, pointerType: 'mouse',
    })

  /** Press and hold at the pet, without releasing. */
  const grabAndHold = async () => {
    const c = await centre()
    await mouse('mousePressed', c.x, c.y)
    await sleep(120)
    return c
  }

  console.log('-- grabbing at rest must NOT struggle --')
  const restGrab = await grabAndHold()
  const restState = await state()
  await mouse('mouseReleased', restGrab.x, restGrab.y)
  await sleep(300)
  check(
    'a grab at rest is a plain drag, not a struggle',
    restState.state !== 'struggle',
    `state=${JSON.stringify(restState.state)}`,
  )

  console.log('\n-- grabbing mid-dash MUST struggle --')
  // A dash has to actually be in flight first.
  //
  // `beg` — the only thing that puts rice on the page, and therefore the only
  // route into `dashToRice` — fires from the KNOCK STREAK (3 knocks), not from
  // being hungry. The "让它饿" button only lowers `food` and then reloads; on its
  // own it never produces a dash, so an earlier version of this probe waited for
  // rice that could never appear.
  await ev(`(() => {
    const state = JSON.parse(localStorage.getItem('dsh-bonk-pet/v1') || '{}')
    state.food = 0
    state.at = Date.now()
    localStorage.setItem('dsh-bonk-pet/v1', JSON.stringify(state))
    return state.food
  })()`)
  await call(ws, 'Page.navigate', { url: `${base}/` })
  await sleep(3500)

  // Three knock clicks is the documented trigger for begging.
  for (let i = 0; i < 3; i += 1) {
    const c = await centre()
    await mouse('mousePressed', c.x, c.y)
    await sleep(60)
    await mouse('mouseReleased', c.x, c.y)
    await sleep(450)
  }

  // Wait for the rice to appear: that is `beg` having run, and `dashToRice` is
  // scheduled 700ms behind it.
  let sawRice = false
  for (let i = 0; i < 40 && !sawRice; i += 1) {
    await sleep(200)
    const s = await state()
    sawRice = s.ricePresent === '1'
    if (!sawRice && i % 8 === 0) console.log(`    waiting for rice... ${JSON.stringify(s)}`)
  }
  check('the rice appeared, so a dash is happening', sawRice, `rice=${sawRice}`)

  const midDash = await grabAndHold()
  const struggleState = await state()
  await mouse('mouseReleased', midDash.x, midDash.y)
  await sleep(400)

  check(
    'grabbing mid-dash shows the struggle state',
    struggleState.state === 'struggle',
    `state=${JSON.stringify(struggleState.state)}`,
  )
  check(
    'it complains about the rice specifically',
    /饭|吃|拽|放开|挣扎/.test(struggleState.bubble),
    `bubble=${JSON.stringify(struggleState.bubble)}`,
  )

  console.log(`\n    struggle bubble: ${JSON.stringify(struggleState.bubble)}`)

  ws.close()
} finally {
  edge.kill()
}

const bad = results.filter((r) => !r.ok)
console.log(`\n${results.length - bad.length}/${results.length} passed`)
process.exit(bad.length === 0 ? 0 : 1)
