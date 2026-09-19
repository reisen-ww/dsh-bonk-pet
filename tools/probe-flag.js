/**
 * Check whether the `--no-clamp` sensitivity switch actually reaches the page.
 *
 * The fit probe still passes with the clamp nominally disabled, which means the
 * flag is not being observed — and a sensitivity check that cannot fail is worse
 * than none, because it manufactures confidence. This asks the page directly
 * whether `window.__bonkNoClamp` is set, and reports whether a drag escapes.
 *
 * Run: node tools/probe-flag.js [baseUrl]
 */

import { spawn } from 'node:child_process'

const base = process.argv[2] ?? 'http://127.0.0.1:43900'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9354

const edge = spawn(
  EDGE,
  [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--window-size=1280,800',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.env.TEMP}\\probe-flag-profile`,
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

  // Exactly what probe-fit.js does in --no-clamp mode.
  const r = await call(ws, 'Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__bonkNoClamp = true`,
  })
  console.log(`  addScriptToEvaluateOnNewDocument -> ${JSON.stringify(r)}`)

  await call(ws, 'Page.navigate', { url: `${base}/` })
  await sleep(3500)

  const ev = async (expression) =>
    (await call(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))
      .result.value

  console.log(`  window.__bonkNoClamp on the page = ${JSON.stringify(await ev(`window.__bonkNoClamp`))}`)
  console.log(`  typeof check                     = ${await ev(`typeof window.__bonkNoClamp`)}`)

  // Does the loaded bundle even contain the guard? If the bundle predates the
  // switch, the flag is irrelevant.
  const src = await ev(`(async () => {
    const r = await fetch('/lib/client.js', { cache: 'no-store' })
    const t = await r.text()
    return { hasGuard: t.includes('__bonkNoClamp'), bytes: t.length }
  })()`)
  console.log(`  served client.js                 = ${JSON.stringify(src)}`)

  const disk = await (await import('node:fs/promises')).readFile('lib/client.js', 'utf8')
  console.log(`  on-disk client.js                = hasGuard=${disk.includes('__bonkNoClamp')} bytes=${disk.length}`)

  ws.close()
} finally {
  edge.kill()
}
