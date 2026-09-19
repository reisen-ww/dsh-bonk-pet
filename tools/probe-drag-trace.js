/**
 * Trace ONE large drag step by step, reporting why the pet moves or does not.
 *
 * The earlier version of this file had its own bug — it destructured an
 * `Array.entries()` pair and moved by the INDEX (1, 2, 3 px) instead of the
 * intended offset, so it only ever exercised sub-threshold movement and could
 * not see what a real drag does. This one moves explicit distances and, crucially,
 * captures exceptions from the drag path: a throw inside `moveDrag` would stop
 * the pet dead while leaving the pointer events flowing, which is
 * indistinguishable from "the handler never ran" unless you look for it.
 *
 * Run: node tools/probe-drag-trace.js [baseUrl]
 */

import { spawn } from 'node:child_process'

const base = process.argv[2] ?? 'http://127.0.0.1:43900'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9350

const edge = spawn(
  EDGE,
  [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--window-size=1280,800',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.env.TEMP}\\probe-trace-profile`,
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
  await call(ws, 'Page.navigate', { url: `${base}/` })
  await sleep(3500)

  const ev = async (expression) =>
    (await call(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))
      .result.value

  const state = () =>
    ev(`(() => {
      const root = document.querySelector('[data-bonk-root]')
      const rig = root.querySelector('[data-bonk-rig]')
      const r = root.getBoundingClientRect()
      const w = root.querySelector('[data-bonk-whale]').getBoundingClientRect()
      return {
        root: [Math.round(r.left), Math.round(r.top)],
        whale: [Math.round(w.left), Math.round(w.top)],
        inlineLeft: root.style.left || '(none)',
        dx: rig.style.getPropertyValue('--bonk-dx') || '(none)',
        walking: rig.dataset.walking ?? '(none)',
      }
    })()`)

  const mouse = (type, x, y) =>
    call(ws, 'Input.dispatchMouseEvent', {
      type, x, y, button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: 1, pointerType: 'mouse',
    })

  const start = await state()
  console.log(`  start            : ${JSON.stringify(start)}`)

  const from = { x: start.whale[0] + 75, y: start.whale[1] + 75 }
  console.log(`  press at         : (${from.x},${from.y})`)

  await mouse('mousePressed', from.x, from.y)
  await sleep(130)

  // Real distances, well past the 4px threshold.
  for (const step of [-100, -250, -400]) {
    await mouse('mouseMoved', from.x + step, from.y + Math.round(step * 0.6))
    await sleep(220)
    const now = await state()
    console.log(`  move dx=${String(step).padStart(5)} : root=${JSON.stringify(now.root)} inlineLeft=${now.inlineLeft} --bonk-dx=${now.dx}`)
  }

  await mouse('mouseReleased', from.x - 400, from.y - 240)
  await sleep(800)
  const end = await state()
  console.log(`  after release    : ${JSON.stringify(end)}`)
  console.log(`  MOVE CHECK       : root moved ${Math.abs(end.root[0] - start.root[0])}px horizontally`)
  console.log(`  exceptions       : ${errors.length === 0 ? 'none' : errors.slice(0, 3).join(' | ')}`)

  ws.close()
} finally {
  edge.kill()
}
