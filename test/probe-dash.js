/**
 * Measure how accurately the pet lands on a scrap of rice.
 *
 * The gameplay probe proved the pet MOVES and that the feed counter rises, but
 * never asserted it ends up ON the food — so "dashes somewhere roughly nearby"
 * would pass it. This measures the thing that actually matters: the distance
 * between the pet's centre and the rice's centre, sampled across the dash, with
 * the final resting distance reported separately from the minimum reached.
 *
 * A large minimum means it never got there; a small minimum with a large final
 * means it arrived and then drifted when the dash was committed.
 *
 * Run: node tools/serve-demo.js   (terminal 1)
 *      node test/probe-dash.js [baseUrl]
 */

import { spawn } from 'node:child_process'

const base = process.argv[2] ?? 'http://127.0.0.1:43900'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9343

const edge = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--window-size=1200,800',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.env.TEMP}\\probe-dash-profile`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function target() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page')
      if (page !== undefined) return page.webSocketDebuggerUrl
    } catch {
      // starting
    }
    await sleep(250)
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
    (
      await call(ws, 'Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
    ).result.value

  // Install a sampler that records the pet/rice geometry on every frame, so the
  // dash is measured as it happens rather than guessed from endpoints.
  await ev(`(() => {
    window.__dash = { samples: [] }
    const tick = () => {
      const root = document.querySelector('[data-bonk-root]')
      const rice = document.querySelector('[data-bonk-rice]')
      if (root !== null && rice !== null) {
        const pet = root.querySelector('[data-bonk-whale]').getBoundingClientRect()
        const r = rice.getBoundingClientRect()
        const px = pet.left + pet.width / 2
        const py = pet.top + pet.height / 2
        const rx = r.left + r.width / 2
        const ry = r.top + r.height / 2
        window.__dash.samples.push({
          t: Math.round(performance.now()),
          show: rice.dataset.show,
          eaten: rice.dataset.eaten,
          d: Math.round(Math.hypot(px - rx, py - ry)),
          px: Math.round(px), py: Math.round(py),
          rx: Math.round(rx), ry: Math.round(ry),
          walking: root.querySelector('[data-bonk-rig]').dataset.walking,
        })
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    return true
  })()`)

  console.log('-- dash accuracy --')

  const knock = () =>
    ev(`(() => {
      document.querySelector('[data-bonk-whale]')
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return true
    })()`)

  /** Knock until hungry, then until rice appears; returns true if it did. */
  const knockUntilRice = async () => {
    for (let i = 0; i < 30; i += 1) {
      await knock()
      for (let j = 0; j < 8; j += 1) {
        await sleep(350)
        const on = await ev(`document.querySelector('[data-bonk-rice]')?.dataset.show === '1'`)
        if (on === true) return true
      }
    }
    return false
  }

  /** Let the dash play out, then report where it landed relative to the rice. */
  const measureLanding = async () => {
    await sleep(6000)
    return ev(`(() => {
      const all = window.__dash.samples
      let start = 0
      for (let i = 0; i < all.length; i += 1) {
        if (all[i].show === '1' && (i === 0 || all[i - 1].show !== '1')) start = i
      }
      const s = all.slice(start).filter((x) => x.show === '1' || x.eaten === '1')
      if (s.length === 0) return { n: 0 }
      const min = s.reduce((a, b) => (b.d < a.d ? b : a))
      const last = s[s.length - 1]
      return {
        n: s.length,
        minD: min.d,
        minAt: min,
        lastD: last.d,
        last: last,
        walkFrames: s.filter((x) => x.walking === '1').length,
      }
    })()`)
  }

  // Several drops, because a single landing could be lucky: the failure this
  // guards against (an off-screen drop) only shows up for SOME random spots.
  const rounds = []
  for (let round = 0; round < 3; round += 1) {
    const appeared = await knockUntilRice()
    if (!appeared) break
    rounds.push(await measureLanding())
    // Clear the field for the next drop.
    await ev(`localStorage.setItem('dsh-bonk-pet/v1', JSON.stringify({ ...JSON.parse(localStorage.getItem('dsh-bonk-pet/v1') || '{}'), food: 0 }))`)
  }

  check('rice appeared', rounds.length > 0, `${rounds.length} drop(s) measured`)

  if (rounds.length > 0) {
    for (const [i, r] of rounds.entries()) {
      console.log(
        `    drop ${i + 1}: closest ${r.minD}px, final ${r.lastD}px  ` +
          `(pet ${r.last?.px},${r.last?.py} / rice ${r.last?.rx},${r.last?.ry})`,
      )
    }
    const worstMin = Math.max(...rounds.map((r) => r.minD))
    const worstLast = Math.max(...rounds.map((r) => r.lastD))
    check(
      'the pet reaches the rice on every drop',
      worstMin <= 8,
      `worst closest = ${worstMin}px (${rounds.map((r) => r.minD).join(', ')})`,
    )
    check(
      'the pet is still on the rice after settling, every time',
      worstLast <= 12,
      `worst final = ${worstLast}px (${rounds.map((r) => r.lastD).join(', ')})`,
    )
  }

  ws.close()
} finally {
  edge.kill()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length === 0 ? 0 : 1)
