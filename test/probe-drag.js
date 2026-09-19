/**
 * Measure the pet's position through the moment a drag is released.
 *
 * Same class of bug as the post-eat lurch, different trigger: releasing the
 * mouse rewrites `root.left/top` (instant) while also zeroing the rig transform
 * (transitioned), so the pet can be displaced twice for a frame and twitch.
 *
 * The probe drives a real pointer drag through CDP, samples every frame, and
 * reports the largest deviation from the settled position AFTER release. A
 * working release moves zero pixels; a twitching one spikes and comes back.
 *
 * Run: node tools/serve-demo.js   (terminal 1)
 *      node test/probe-drag.js [baseUrl]
 */

import { spawn } from 'node:child_process'

const base = process.argv[2] ?? 'http://127.0.0.1:43900'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9345

const edge = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--window-size=1200,800',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.env.TEMP}\\probe-drag-profile`,
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
      await call(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    ).result.value

  await ev(`(() => {
    window.__drag = []
    window.__mark = 0
    const tick = () => {
      const root = document.querySelector('[data-bonk-root]')
      const rig = root === null ? null : root.querySelector('[data-bonk-rig]')
      const whale = root === null ? null : root.querySelector('[data-bonk-whale]')
      if (root !== null && rig !== null && whale !== null) {
        // Measure the WHALE, not the root. A transform on the rig does not
        // change the root's own rect, so sampling root hides exactly the
        // displacement this probe exists to catch.
        const w = whale.getBoundingClientRect()
        const r = root.getBoundingClientRect()
        window.__drag.push({
          t: window.__mark,
          x: Math.round(w.left),
          y: Math.round(w.top),
          rootX: Math.round(r.left),
          rootY: Math.round(r.top),
          tf: getComputedStyle(rig).transform,
        })
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    return true
  })()`)

  console.log('-- drag release --')

  // Where is the pet right now? Drag its centre to a different place.
  const start = await ev(`(() => {
    const r = document.querySelector('[data-bonk-whale]').getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })()`)

  const to = { x: start.x - 300, y: start.y - 150 }

  const mouse = (type, x, y, button) =>
    call(ws, 'Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: button ?? 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: 1,
      pointerType: 'mouse',
    })

  await mouse('mousePressed', start.x, start.y)
  await sleep(80)
  for (let i = 1; i <= 6; i += 1) {
    await mouse('mouseMoved', start.x + ((to.x - start.x) * i) / 6, start.y + ((to.y - start.y) * i) / 6)
    await sleep(70)
  }
  await ev(`window.__mark = 1`)
  await mouse('mouseReleased', to.x, to.y)
  await sleep(1500)

  const report = await ev(`(() => {
    const all = window.__drag.filter((s) => s.t === 1)
    if (all.length === 0) return { n: 0 }
    // Ignore the frames before the pet actually stops moving. The release is
    // dispatched over CDP, so the sampling loop can still catch one in-flight
    // drag frame or two right after the mark; including those made this probe
    // report 12px of "twitch" that was really just the tail of the drag.
    let settleStart = 0
    for (let i = 1; i < all.length; i += 1) {
      if (all[i].x === all[i - 1].x && all[i].y === all[i - 1].y) {
        if (settleStart === 0) settleStart = i - 1
      } else {
        settleStart = 0
      }
    }
    const tail = all.slice(-25)
    const sx = tail.reduce((a, b) => a + b.x, 0) / tail.length
    const sy = tail.reduce((a, b) => a + b.y, 0) / tail.length
    let worst = 0
    let worstAt = null
    // Only frames from the first moment of stillness onward count as "after".
    for (const s of all.slice(settleStart)) {
      const dev = Math.hypot(s.x - sx, s.y - sy)
      if (dev > worst) { worst = dev; worstAt = s }
    }
    return {
      n: all.length,
      settleStart,
      settled: { x: Math.round(sx), y: Math.round(sy) },
      worst: Math.round(worst),
      worstAt,
    }
  })()`)

  console.log(
    `    release frames=${report.n}, still from frame ${report.settleStart}, settled at (${report.settled?.x},${report.settled?.y})`,
  )
  console.log(`    worst deviation of the WHALE from settled = ${report.worst}px`)
  if (report.worstAt !== null && report.worstAt !== undefined) {
    console.log(
      `    that frame: whale(${report.worstAt.x},${report.worstAt.y}) root(${report.worstAt.rootX},${report.worstAt.rootY}) tf=${report.worstAt.tf}`,
    )
  }

  check(
    'the pet does not twitch when the drag is released',
    report.worst !== undefined && report.worst <= 2,
    `worst = ${report.worst}px (a clean release moves 0)`,
  )

  // And it must actually have moved, or the test proves nothing.
  check(
    'the drag actually moved the pet',
    Math.hypot(report.settled.x - start.x, report.settled.y - start.y) > 100,
    `from (${start.x},${start.y}) to (${report.settled?.x},${report.settled?.y})`,
  )

  ws.close()
} finally {
  edge.kill()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length === 0 ? 0 : 1)
