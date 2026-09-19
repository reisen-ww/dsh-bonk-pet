/**
 * Hit-test a grid of points around the pet, to find which coordinates actually
 * land on the draggable element.
 *
 * The drag probes compute their press point as `whale.left + 75`, assuming the
 * whale fills the root's 150px box. It does not — the whale is sized to the
 * drawn artwork's aspect and measures 112x116 — so +75 can fall outside the pet
 * entirely. That produces a drag that "does nothing" without any error, which is
 * exactly the symptom the probes were reporting.
 *
 * Run: node tools/probe-hittest.js [baseUrl]
 */

import { spawn } from 'node:child_process'

const base = process.argv[2] ?? 'http://127.0.0.1:43900'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9352

const edge = spawn(
  EDGE,
  [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--window-size=1280,800',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.env.TEMP}\\probe-hit-profile`,
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

  const grid = await ev(`(() => {
    const root = document.querySelector('[data-bonk-root]')
    const whale = root.querySelector('[data-bonk-whale]')
    const r = whale.getBoundingClientRect()
    const name = (el) => {
      if (el === null) return 'null'
      if (el === whale) return 'WHALE'
      if (whale.contains(el)) return 'whale-child'
      if (root.contains(el)) return 'root-other:' + el.tagName.toLowerCase()
      return 'outside:' + el.tagName.toLowerCase()
    }
    const rows = []
    // Sweep the root's box at 25px steps, which covers the whale and the gaps.
    const rr = root.getBoundingClientRect()
    for (let y = rr.top + 10; y < rr.bottom; y += 25) {
      const row = []
      for (let x = rr.left + 10; x < rr.right; x += 25) {
        row.push(name(document.elementFromPoint(x, y)))
      }
      rows.push({ y: Math.round(y), cells: row })
    }
    return {
      root: [Math.round(rr.left), Math.round(rr.top), Math.round(rr.width), Math.round(rr.height)],
      whale: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      xs: Array.from({ length: Math.ceil((rr.width - 10) / 25) }, (_, i) => Math.round(rr.left + 10 + i * 25)),
      rows,
      // The exact point the drag probes use.
      probePoint: { x: Math.round(r.left + 75), y: Math.round(r.top + 75) },
      probeHit: name(document.elementFromPoint(r.left + 75, r.top + 75)),
      centreHit: name(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)),
    }
  })()`)

  console.log(`root  : ${JSON.stringify(grid.root)}`)
  console.log(`whale : ${JSON.stringify(grid.whale)}   <- note: NOT 150x150`)
  console.log(`\nhit grid (x = ${grid.xs.join(', ')}):`)
  for (const row of grid.rows) {
    console.log(`  y=${String(row.y).padStart(4)}  ${row.cells.map((c) => c.padEnd(16)).join('')}`)
  }
  console.log(`\nprobe press point ${JSON.stringify(grid.probePoint)} -> ${grid.probeHit}`)
  console.log(`whale centre point               -> ${grid.centreHit}`)

  ws.close()
} finally {
  edge.kill()
}
