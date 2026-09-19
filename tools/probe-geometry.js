/**
 * Report the pet's real geometry and what the browser hits at its centre.
 *
 * The drag probes keep reporting "the pet never moved", which means the pointer
 * events are not reaching the drag handler at all. Before blaming the handler,
 * confirm the probe is actually pressing ON the pet: report the whale's rect, the
 * element under its centre point, and whether that element is inside the pet.
 *
 * Run: node tools/probe-geometry.js [baseUrl]
 */

import { spawn } from 'node:child_process'

const base = process.argv[2] ?? 'http://127.0.0.1:43900'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9351

const edge = spawn(
  EDGE,
  [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--window-size=1280,800',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.env.TEMP}\\probe-geom-profile`,
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
    } catch {}
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
  await sleep(3500)

  const ev = async (expression) =>
    (await call(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))
      .result.value

  const info = await ev(`(() => {
    const root = document.querySelector('[data-bonk-root]')
    if (root === null) return { error: 'no root' }
    const rr = root.getBoundingClientRect()
    const out = {
      root: [Math.round(rr.left), Math.round(rr.top), Math.round(rr.width), Math.round(rr.height)],
      viewport: [window.innerWidth, window.innerHeight],
      petHasBasin: root.dataset.petHasBasin ?? '(unset)',
      parts: {},
    }
    for (const [name, sel] of [
      ['whale', '[data-bonk-whale]'],
      ['basin', '[data-bonk-basin]'],
      ['pipe', '[data-bonk-pipe]'],
    ]) {
      const el = root.querySelector(sel)
      if (el === null) { out.parts[name] = 'missing'; continue }
      const r = el.getBoundingClientRect()
      const cx = Math.round(r.left + r.width / 2)
      const cy = Math.round(r.top + r.height / 2)
      const hit = document.elementFromPoint(cx, cy)
      out.parts[name] = {
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        centre: [cx, cy],
        display: getComputedStyle(el).display,
        pointerEvents: getComputedStyle(el).pointerEvents,
        hitAtCentre: hit === null ? 'null' : hit.tagName.toLowerCase() + (hit.dataset.bonkArt ? '[art=' + hit.dataset.bonkArt + ']' : ''),
      }
    }
    // What does the ROOT itself hit at the whale's centre?
    const w = root.querySelector('[data-bonk-whale]')
    if (w !== null) {
      const r = w.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      out.rootPointerEvents = getComputedStyle(root).pointerEvents
      out.hitIsInsideRoot = hit !== null && root.contains(hit)
      out.hitIsWhaleOrChild = hit !== null && (hit === w || w.contains(hit))
    }
    return out
  })()`)

  console.log(JSON.stringify(info, null, 2))
  ws.close()
} finally {
  edge.kill()
}
