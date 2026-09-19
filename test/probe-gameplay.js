/**
 * Drive the whole gameplay loop in a real browser and check each transition.
 *
 * The unit tests cover each piece in isolation and the E2E suite covers
 * mounting, clicking and failure frames 鈥?but nothing has driven the full
 * chain the user actually asked for: knock until hungry 鈫?the pet goes to beg
 * 鈫?rice appears 鈫?click it 鈫?the pet eats and recovers.
 *
 * Failures in a chain like this live in the seams (a flag that never clears, a
 * threshold that disagrees with the one next to it), which is exactly what
 * per-piece tests miss.
 *
 * Run: node tools/serve-demo.js   (in one terminal)
 *      node test/probe-gameplay.js [baseUrl]
 */

import { spawn } from 'node:child_process'

const base = process.argv[2] ?? 'http://127.0.0.1:43900'
// DSH serves its UI behind a `?token=` handshake that sets a cookie; a plain
// `${base}/` navigation is rejected. Passing the token lets this probe run
// against a real DSH host as well as the stand-alone preview server.
const token = process.argv[3] ?? ''
const entry = token === '' ? `${base}/` : `${base}/?token=${token}`
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9341

const edge = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.env.TEMP}\\probe-gameplay-profile`,
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

const errors = []

try {
  const ws = new WebSocket(await target())
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params?.exceptionDetails
      errors.push(d?.exception?.description ?? d?.text ?? 'unknown')
      return
    }
    if (m.id === undefined) return
    const s = pending.get(m.id)
    if (s === undefined) return
    pending.delete(m.id)
    if (m.error !== undefined) s.reject(new Error(JSON.stringify(m.error)))
    else s.resolve(m.result)
  })

  await call(ws, 'Page.enable')
  await call(ws, 'Runtime.enable')
  // Start from a clean save so the numbers below are predictable.
  await call(ws, 'Page.navigate', { url: entry })
  await sleep(3000)
  await call(ws, 'Runtime.evaluate', {
    expression: `localStorage.removeItem('dsh-bonk-pet/v1')`,
  })
  await call(ws, 'Page.navigate', { url: entry })
  await sleep(3500)

  const ev = async (expression) =>
    (
      await call(ws, 'Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
    ).result.value

  /** Everything the loop needs to observe, in one round trip. */
  const snap = () =>
    ev(`(() => {
      const root = document.querySelector('[data-bonk-root]')
      const save = JSON.parse(localStorage.getItem('dsh-bonk-pet/v1') || '{}')
      const rice = document.querySelector('[data-bonk-rice]')
      const pet = root.querySelector('[data-bonk-whale]').getBoundingClientRect()
      const rr = rice.getBoundingClientRect()
      return {
        state: root.dataset.state,
        food: Math.round(save.food ?? 100),
        knocks: save.knocks ?? 0,
        feeds: save.feeds ?? 0,
        meterLow: root.querySelector('[data-bonk-meter]').dataset.low,
        riceShow: rice.dataset.show,
        riceEaten: rice.dataset.eaten,
        // Where the food landed, and how far the pet had to travel: the two
        // numbers that prove this is a dash and not a bowl at its feet.
        riceAt: { x: Math.round(rr.left), y: Math.round(rr.top) },
        petAt: { x: Math.round(pet.left), y: Math.round(pet.top) },
        gap: Math.round(Math.hypot(rr.left - pet.left, rr.top - pet.top)),
        says: root.querySelector('[data-bonk-bubble]').dataset.show === '1'
          ? root.querySelector('[data-bonk-bubble]').textContent
          : null,
      }
    })()`)

  const knock = () =>
    ev(`(() => {
      const pet = document.querySelector('[data-bonk-whale]')
      pet.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return true
    })()`)

  console.log('-- full gameplay loop --')

  const start = await snap()
  check('starts full and idle', start.food > 90 && start.state === 'idle', JSON.stringify(start))

  // ---- knock until the hunger threshold is crossed ----------------------
  // Each knock costs food, so this is the user's own route to hunger.
  let hungry = null
  for (let i = 0; i < 12; i += 1) {
    await knock()
    await sleep(420)
    const now = await snap()
    if (now.food <= 35) {
      hungry = now
      break
    }
  }
  check(
    'knocking drains food past the hunger line',
    hungry !== null,
    hungry === null ? 'never got hungry' : `food=${hungry.food} knocks=${hungry.knocks}`,
  )
  check(
    'the hunger meter lights up at the same threshold as the sad face',
    hungry !== null && hungry.meterLow === '1',
    `meterLow=${hungry?.meterLow}`,
  )

  // ---- the pet finds food and dashes to it -------------------------------
  // Rice appears at a random spot away from the pet; the pet notices and runs.
  // The point of the mechanic is that the food is NOT where the pet is, so
  // `gap` (distance between them, sampled the instant the rice shows) is the
  // load-bearing assertion — a bowl at the pet's feet would pass every other
  // check here while being exactly the thing this replaced.
  let found = null
  for (let i = 0; i < 24; i += 1) {
    await knock()
    for (let j = 0; j < 10; j += 1) {
      await sleep(350)
      const now = await snap()
      if (now.riceShow === '1') {
        found = now
        break
      }
    }
    if (found !== null) break
  }
  check(
    'a hungry pet eventually gets rice on the page',
    found !== null,
    found === null ? 'never appeared' : `food=${found.food} says=${JSON.stringify(found.says)}`,
  )
  check(
    'the rice lands away from the pet, on a random spot',
    found !== null && found.gap > 120,
    found === null ? 'n/a' : `rice=${JSON.stringify(found.riceAt)} pet=${JSON.stringify(found.petAt)} gap=${found.gap}px`,
  )
  check(
    'the rice appears on the page frame, not inside the pet',
    found !== null &&
      (await ev(`document.querySelector('[data-bonk-rice]').closest('[data-bonk-rig]') === null`)),
    'rice is a sibling of the rig',
  )

  // ---- the dash ----------------------------------------------------------
  // The pet eats on its own; the user watches. So this asserts the whole
  // sequence with no clicks: it moves, it eats, the rice goes, food recovers.
  //
  // The LANDING is asserted against the rice's own position, not merely that
  // the pet moved: an earlier version only checked "travelled > 60px", which
  // passed even when the rice was rendered off-screen and the pet could never
  // reach it. See test/probe-dash.js for the full per-frame measurement.
  const beforeEat = found ?? (await snap())
  let ate = null
  for (let i = 0; i < 40; i += 1) {
    await sleep(400)
    const now = await snap()
    if (now.feeds > beforeEat.feeds) {
      ate = now
      break
    }
  }
  check(
    'the pet dashes over and eats without being clicked',
    ate !== null,
    ate === null ? 'never ate' : `feeds ${beforeEat.feeds}->${ate.feeds}`,
  )
  check(
    'the pet actually travelled to the food',
    ate !== null && Math.hypot(ate.petAt.x - beforeEat.petAt.x, ate.petAt.y - beforeEat.petAt.y) > 60,
    ate === null
      ? 'n/a'
      : `pet ${JSON.stringify(beforeEat.petAt)} -> ${JSON.stringify(ate.petAt)}`,
  )
  check(
    'the pet ends up ON the rice, not merely near it',
    found !== null &&
      ate !== null &&
      Math.hypot(ate.petAt.x - found.riceAt.x, ate.petAt.y - found.riceAt.y) <= 40,
    found === null || ate === null
      ? 'n/a'
      : `pet ${JSON.stringify(ate.petAt)} vs rice ${JSON.stringify(found.riceAt)}`,
  )
  check(
    'eating restores food',
    ate !== null && ate.food > beforeEat.food,
    `food ${beforeEat.food}->${ate?.food}`,
  )

  // The rice clears itself once eaten.
  await sleep(1200)
  const cleared = await snap()
  check(
    'the rice is gone once eaten',
    cleared.riceShow === '0',
    `show=${cleared.riceShow}`,
  )

  // ---- the counter survives a reload ------------------------------------
  await call(ws, 'Page.navigate', { url: entry })
  await sleep(3000)
  const reloaded = await snap()
  check(
    'the save survives a reload',
    reloaded.knocks >= cleared.knocks && reloaded.feeds >= cleared.feeds,
    `knocks=${reloaded.knocks} feeds=${reloaded.feeds} food=${reloaded.food}`,
  )

  check('no uncaught page errors during the loop', errors.length === 0, errors.slice(0, 2).join(' | ') || '0')

  ws.close()
} finally {
  edge.kill()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length === 0 ? 0 : 1)
