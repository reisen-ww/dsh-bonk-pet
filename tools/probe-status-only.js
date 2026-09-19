/**
 * Watch the plugin's real reaction to a status frame, with NO knocking.
 *
 * The knock probe reports zero lyrics, and the cause is not yet established: it
 * could be the knock, or it could be that the status frame never reaches
 * `setWorking` at all. This isolates the two by sending ONLY a status frame and
 * reporting whether the pet sings — if it does not, the knock is innocent and the
 * probe's driver is at fault.
 *
 * Run: node tools/probe-status-only.js <origin> [token]
 */

import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = process.argv[2] ?? 'http://127.0.0.1:43894'
const token = process.argv[3] ?? ''
const url = `${base}/${token === '' ? '' : `?token=${token}`}`
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9400 + Math.floor(Math.random() * 400)

const edge = spawn(
  EDGE,
  [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--window-size=1280,800',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'bonk-status-'))}`,
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
  await call(ws, 'Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__srcs = []
      const Real = window.EventSource
      window.EventSource = function (...a) {
        const es = new Real(...a)
        window.__srcs.push(es)
        return es
      }
      window.EventSource.prototype = Real.prototype
      window.__said = []
      window.__watch = () => {
        const b = document.querySelector('[data-bonk-bubble]')
        if (b === null) return false
        let last = ''
        setInterval(() => {
          const now = b.dataset.show === '1' ? b.textContent : ''
          if (now !== '' && now !== last) window.__said.push(now)
          last = now
        }, 60)
        return true
      }
    `,
  })

  await call(ws, 'Page.navigate', { url })
  await sleep(3200)
  // Unlock sound so the music path is not the variable under test.
  await call(ws, 'Runtime.evaluate', { expression: `localStorage.setItem('dsh-bonk-pet/sound', 'on')` })
  await call(ws, 'Page.navigate', { url })
  await sleep(3200)

  const ev = async (expression) =>
    (await call(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))
      .result.value

  console.log(`  watching: ${await ev(`window.__watch()`)}`)
  await ev(`window.__said = []`)

  // What does the REAL host send on connect? Record every frame the plugin gets,
  // so a spontaneous `idle` becomes visible instead of being inferred.
  await ev(`(() => {
    window.__frames = []
    for (const es of window.__srcs) {
      es.addEventListener('message', (e) => window.__frames.push(String(e.data).slice(0, 90)))
    }
    return window.__srcs.length
  })()`)

  console.log('  sending one running frame...')
  const sent = await ev(`(() => {
    let n = 0
    for (const es of window.__srcs) {
      es.dispatchEvent(new MessageEvent('message', {
        data: JSON.stringify({ type: 'status', status: 'running' }),
      }))
      n += 1
    }
    return n
  })()`)
  console.log(`  dispatched to ${sent} source(s)`)

  for (const t of [1500, 3000, 7000, 14000]) {
    await sleep(t === 1500 ? 1500 : t - 1500)
    const said = await ev(`window.__said.slice()`)
    const frames = await ev(`window.__frames.slice(-4)`)
    console.log(`  t=${t}ms  said=[${said.join(' | ')}]  hostFrames=[${frames.join(' ; ')}]`)
  }

  ws.close()
} finally {
  edge.kill()
}
