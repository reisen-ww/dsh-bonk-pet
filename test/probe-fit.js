/**
 * Verify the viewport fixes from the audit: a drag to a corner must leave the
 * whole pet on screen, and a reload must not restore a position that no longer
 * fits.
 *
 * The bug this guards: `commitPosition` used to clamp to `innerWidth - 60` for a
 * 150px element, so a drag could park 90px of the pet off-screen — and because
 * the value is persisted, every later reload put it back there.
 *
 * Run: node tools/serve-demo.js   (terminal 1)
 *      node test/probe-fit.js [baseUrl]
 */

import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = process.argv[2] ?? 'http://127.0.0.1:43900'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
// A random free-ish port and a FRESH profile directory per run.
//
// A fixed port plus a reused profile is what made this probe intermittently
// report "debugger unreachable": a previous Edge that had not fully exited held
// the profile lock, so the new process silently started without a debug port.
// A unique profile per run removes the coupling between consecutive runs.
const PORT = 9400 + Math.floor(Math.random() * 400)

const edge = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--window-size=1280,800',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'bonk-fit-'))}`,
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
    } catch {
      // still starting
    }
    await sleep(300)
  }
  throw new Error(`debugger unreachable on port ${PORT} — Edge exited? killed=${edge.killed}`)
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
      await call(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    ).result.value

  console.log('-- viewport fitting --')

  /**
   * Where is the pet's VISIBLE artwork, and how much of it is outside the window?
   *
   * Measures `[data-bonk-whale]`, not `[data-bonk-root]`.
   *
   * This distinction is the whole reason an earlier version of this probe could
   * never fail: during a drag the offset lives as a `transform` on
   * `[data-bonk-rig]`, which is a CHILD of the root. A child's transform does not
   * appear in the root's own `getBoundingClientRect()`, so while the pet was
   * visibly sliding off-screen the root still reported its resting box — and the
   * "never leaves the viewport while dragging" assertion passed no matter what.
   * The whale is inside the rig, so it tracks what the user actually sees.
   */
  const probe = () =>
    ev(`(() => {
      const r = document.querySelector('[data-bonk-whale]').getBoundingClientRect()
      return {
        left: Math.round(r.left), top: Math.round(r.top),
        right: Math.round(r.right), bottom: Math.round(r.bottom),
        w: Math.round(r.width), h: Math.round(r.height),
        vw: window.innerWidth, vh: window.innerHeight,
      }
    })()`)

  // The box the plugin's clamp maths assumes. `fitToViewport` uses PET_SIZE
  // (150) for the pet, so the artwork must fit within that or every edge
  // calculation is off by the difference.
  const rootBox = () =>
    ev(`(() => {
      const r = document.querySelector('[data-bonk-root]').getBoundingClientRect()
      return { w: Math.round(r.width), h: Math.round(r.height) }
    })()`)

  check(
    'the pet box is 150x150 as the clamp maths assumes',
    (await rootBox()).w === 150,
    JSON.stringify(await rootBox()),
  )

  // Sensitivity is NOT toggled from here.
  //
  // An earlier version read `window.__bonkNoClamp`, which meant shipping a test
  // seam inside the plugin — and it did not even work, because the probe was
  // measuring the root instead of the whale. Sensitivity is now verified by
  // patching the clamp out of `lib/client.js` on disk and re-running this file
  // (see `tools/check-sensitivity.js`), which exercises the real shipped path
  // rather than a bypass that only exists for tests.

  const start = await probe()

  const mouse = (type, x, y) =>
    call(ws, 'Input.dispatchMouseEvent', {
      type, x, y,
      button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: 1,
      pointerType: 'mouse',
    })

  /** Press at `from`, drag to `to` in steps, sampling each step. */
  const dragTo = async (from, to, steps = 8) => {
    await mouse('mousePressed', from.x, from.y)
    await sleep(120)
    let escaped = null
    for (let i = 1; i <= steps; i += 1) {
      const x = Math.round(from.x + ((to.x - from.x) * i) / steps)
      const y = Math.round(from.y + ((to.y - from.y) * i) / steps)
      await mouse('mouseMoved', x, y)
      await sleep(110)
      const during = await probe()
      const outside =
        during.right > during.vw + 1 ||
        during.bottom > during.vh + 1 ||
        during.left < -1 ||
        during.top < -1
      if (outside && escaped === null) escaped = during
    }
    await mouse('mouseReleased', to.x, to.y)
    await sleep(700)
    return escaped
  }

  // Step 1: park the pet near the MIDDLE first.
  //
  // The default anchor is already flush against the bottom-right corner, so a
  // drag from there has no room to overshoot and the probe below would pass
  // whether or not any clamping exists. Moving to the centre first is what gives
  // the next drag somewhere to escape to.
  //
  // The grab point is the whale's own centre, not `left + 75`: the root box is
  // 150px but the artwork inside it is smaller and offset, so a fixed +75 can
  // land outside the pet and start a drag that never begins.
  const centre = await probe()
  const centreFrom = {
    x: Math.round(centre.left + centre.w / 2),
    y: Math.round(centre.top + centre.h / 2),
  }
  await dragTo(centreFrom, { x: Math.round(centre.vw / 2), y: Math.round(centre.vh / 2) }, 8)
  const parked = await probe()
  console.log(
    `    parked mid-screen: box=(${parked.left},${parked.top})-(${parked.right},${parked.bottom}) viewport=${parked.vw}x${parked.vh}`,
  )
  check(
    'the pet can be dragged away from its corner',
    parked.left < parked.vw - 300 && parked.top < parked.vh - 200,
    `box=(${parked.left},${parked.top})`,
  )

  // Step 2: from the middle, shove it far past the bottom-right corner, sampling
  // WHILE the button is held. Checking only the released position would pass
  // even if the pet spends the whole drag off-screen and is yanked back at the
  // end — which is exactly what the user reported.
  const from = { x: Math.round(parked.left + 75), y: Math.round(parked.top + 75) }
  const to = { x: from.x + 1200, y: from.y + 900 }
  const escaped = await dragTo(from, to, 8)

  check(
    'the pet never leaves the viewport WHILE being dragged',
    escaped === null,
    escaped === null
      ? 'inside the viewport on every sampled drag frame'
      : `escaped mid-drag: box=(${escaped.left},${escaped.top})-(${escaped.right},${escaped.bottom}) viewport=${escaped.vw}x${escaped.vh}`,
  )

  const after = await probe()
  console.log(
    `    after drag to corner: box=(${after.left},${after.top})-(${after.right},${after.bottom}) viewport=${after.vw}x${after.vh}`,
  )
  check(
    'the whole pet stays inside the viewport after a corner drag',
    after.right <= after.vw && after.bottom <= after.vh && after.left >= 0 && after.top >= 0,
    `right=${after.right}/${after.vw} bottom=${after.bottom}/${after.vh}`,
  )

  // Reload: the stored position must still fit.
  await call(ws, 'Page.navigate', { url: `${base}/` })
  await sleep(3000)
  const reloaded = await probe()
  console.log(
    `    after reload:         box=(${reloaded.left},${reloaded.top})-(${reloaded.right},${reloaded.bottom})`,
  )
  check(
    'the reload restores position without clipping the pet',
    reloaded.right <= reloaded.vw && reloaded.bottom <= reloaded.vh,
    `right=${reloaded.right}/${reloaded.vw} bottom=${reloaded.bottom}/${reloaded.vh}`,
  )

  // Shrink the window: the pet must be pulled back in by the resize handler.
  await call(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 500, height: 400, deviceScaleFactor: 1, mobile: false,
  })
  await sleep(900)
  const shrunk = await probe()
  console.log(
    `    after shrink to 500x400: box=(${shrunk.left},${shrunk.top})-(${shrunk.right},${shrunk.bottom}) viewport=${shrunk.vw}x${shrunk.vh}`,
  )
  check(
    'shrinking the window pulls the pet back into view',
    shrunk.right <= shrunk.vw + 1 && shrunk.bottom <= shrunk.vh + 1,
    `right=${shrunk.right}/${shrunk.vw} bottom=${shrunk.bottom}/${shrunk.vh}`,
  )
  await call(ws, 'Emulation.clearDeviceMetricsOverride')

  ws.close()
} finally {
  edge.kill()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length === 0 ? 0 : 1)
