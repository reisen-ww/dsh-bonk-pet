/**
 * Instrument one dash: where the pet thinks it is, where the rice is, where it lands.
 *
 * I have flip-flopped on this. The pet stopped landing on its food after the whale's
 * width became artwork-derived, and each change moved the error without explaining
 * it. This prints every quantity involved in ONE dash — the target, `petCenter()`,
 * the applied translate, and the settled position — so the correct offset can be
 * computed instead of inferred.
 *
 * Run: node tools/serve-demo.js   (terminal 1)
 *      node tools/trace-dash.js [baseUrl]
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
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'bonk-trace-dash-'))}`,
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

  const geom = () =>
    ev(`(() => {
      const root = document.querySelector('[data-bonk-root]')
      const rig = root.querySelector('[data-bonk-rig]')
      const whale = root.querySelector('[data-bonk-whale]')
      const rice = document.querySelector('[data-bonk-rice]')
      const b = root.getBoundingClientRect()
      const w = whale.getBoundingClientRect()
      const r = rice.getBoundingClientRect()
      return {
        rootBox: { l: Math.round(b.left), t: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) },
        whaleBox: { l: Math.round(w.left), t: Math.round(w.top), w: Math.round(w.width), h: Math.round(w.height) },
        whaleCentre: { x: Math.round(w.left + w.width / 2), y: Math.round(w.top + w.height / 2) },
        riceCentre: { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) },
        riceTopLeft: { x: Math.round(r.left), y: Math.round(r.top) },
        dx: rig.style.getPropertyValue('--bonk-dx'),
        dy: rig.style.getPropertyValue('--bonk-dy'),
        whaleInsideRoot: { x: Math.round(w.left - b.left), y: Math.round(w.top - b.top) },
      }
    })()`)

  // Make it hungry, then knock three times to trigger `beg` -> rice -> dash.
  await ev(`(() => {
    const s = JSON.parse(localStorage.getItem('dsh-bonk-pet/v1') || '{}')
    s.food = 0
    s.at = Date.now()
    localStorage.setItem('dsh-bonk-pet/v1', JSON.stringify(s))
    return true
  })()`)
  await call(ws, 'Page.navigate', { url: `${base}/` })
  await sleep(3500)

  const mouse = (type, x, y) =>
    call(ws, 'Input.dispatchMouseEvent', {
      type, x, y, button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: 1, pointerType: 'mouse',
    })

  console.log('== before any knock ==')
  console.log(JSON.stringify(await geom(), null, 2))

  for (let i = 0; i < 3; i += 1) {
    const c = await ev(`(() => {
      const r = document.querySelector('[data-bonk-whale]').getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    })()`)
    await mouse('mousePressed', c.x, c.y)
    await sleep(60)
    await mouse('mouseReleased', c.x, c.y)
    await sleep(450)
  }

  // Wait for the rice, then sample through the dash.
  for (let i = 0; i < 40; i += 1) {
    await sleep(200)
    const g = await geom()
    if (g.riceBox === undefined && g.riceCentre.x > 0) break
  }

  const withRice = await geom()
  console.log('\n== the moment the rice appears ==')
  console.log(JSON.stringify(withRice, null, 2))

  // Sample during the walk so the applied translate is visible.
  for (let i = 0; i < 10; i += 1) {
    await sleep(250)
    const g = await geom()
    console.log(
      `  t+${(i + 1) * 250}ms  whale=${JSON.stringify(g.whaleCentre)} rice=${JSON.stringify(g.riceCentre)} dx=${g.dx} dy=${g.dy}`,
    )
    if (g.riceCentre.x === 0) break
  }

  await sleep(2500)
  const settled = await geom()
  console.log('\n== settled ==')
  console.log(JSON.stringify(settled, null, 2))

  const err = {
    byWhaleCentre: Math.round(
      Math.hypot(settled.whaleCentre.x - settled.riceCentre.x, settled.whaleCentre.y - settled.riceCentre.y),
    ),
  }
  console.log(`\n  distance from the pet's ARTWORK CENTRE to the rice centre: ${err.byWhaleCentre}px`)

  ws.close()
} finally {
  edge.kill()
}
