/**
 * Check that a landscape prop image is not squashed by a portrait slot.
 *
 * The drawn pipe SVG is a tall vertical bar, but the user's `pipe.png` is a
 * landscape render. Sizing the element from the drawing would crush it to a
 * stub, so the element must adopt the artwork's own aspect once it loads.
 *
 * Run: node test/probe-pipe.js <baseUrl> <token>
 */

import { spawn } from 'node:child_process'

const [base, token] = process.argv.slice(2)
if (base === undefined || token === undefined) {
  console.error('usage: node test/probe-pipe.js <baseUrl> <token>')
  process.exit(2)
}

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9336

const edge = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=' + process.env.TEMP + '\\probe-pipe-profile',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function findTarget() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page')
      if (page !== undefined) return page.webSocketDebuggerUrl
    } catch {
      // browser still starting
    }
    await sleep(250)
  }
  throw new Error('could not reach the debugger')
}

let seq = 0
const pending = new Map()

function call(ws, method, params = {}) {
  const id = (seq += 1)
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

try {
  const url = await findTarget()
  const ws = new WebSocket(url)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id === undefined) return
    const slot = pending.get(msg.id)
    if (slot === undefined) return
    pending.delete(msg.id)
    if (msg.error !== undefined) slot.reject(new Error(JSON.stringify(msg.error)))
    else slot.resolve(msg.result)
  })

  await call(ws, 'Page.enable')
  await call(ws, 'Runtime.enable')
  await call(ws, 'Page.navigate', { url: `${base}/?token=${token}` })
  await sleep(6000)

  const expr = `(() => {
    const pipe = document.querySelector('[data-bonk-pipe]');
    if (pipe === null) return { error: 'no pipe element' };
    const img = pipe.querySelector('img[data-bonk-art]');
    if (img === null) return { error: 'pipe still drawn, no artwork' };
    const rect = pipe.getBoundingClientRect();
    const natural = img.naturalWidth / img.naturalHeight;
    const box = rect.width / rect.height;
    return {
      natural: img.naturalWidth + 'x' + img.naturalHeight,
      naturalRatio: Number(natural.toFixed(3)),
      box: Math.round(rect.width) + 'x' + Math.round(rect.height),
      boxRatio: Number(box.toFixed(3)),
      distortionPct: Number((Math.abs(box - natural) / natural * 100).toFixed(1)),
      dataArt: pipe.dataset.art ?? null,
      cssRatio: pipe.style.getPropertyValue('--bonk-art-ratio') || null,
    };
  })()`

  const result = await call(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true })
  console.log(JSON.stringify(result.result.value, null, 2))

  const v = result.result.value
  if (v.error === undefined) {
    console.log(
      v.distortionPct < 5
        ? `RESULT: aspect preserved (${v.distortionPct}% off)`
        : `RESULT: STILL DISTORTED by ${v.distortionPct}%`,
    )
  }

  ws.close()
} finally {
  edge.kill()
}
