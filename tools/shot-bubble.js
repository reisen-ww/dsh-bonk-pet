/**
 * Capture the pet with a bubble on screen, so the alignment can be judged by eye.
 *
 * The bubble probe asserts the tail lands inside a "head band" rather than on an
 * exact pixel, because where a character's head sits is a property of the artwork
 * and not something geometry can derive. That band is a weaker claim than the user
 * is making when they say "再往右点就好", so this produces the actual picture for
 * them to accept or reject.
 *
 * Run: node tools/serve-demo.js   (terminal 1)
 *      node tools/shot-bubble.js [baseUrl] [outPath]
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = process.argv[2] ?? 'http://127.0.0.1:43900'
const out = process.argv[3] ?? 'assets/bubble-check.png'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9400 + Math.floor(Math.random() * 400)

const edge = spawn(
  EDGE,
  [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--window-size=1280,800',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'bonk-shot-'))}`,
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
  await sleep(3500)

  const ev = async (expression) =>
    (await call(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))
      .result.value

  // Force a bubble and hide the preview chrome, so the picture shows only the pet.
  await ev(`(() => {
    document.querySelectorAll('body > *:not([data-bonk-root])').forEach((n) => {
      if (n.tagName !== 'SCRIPT' && n.tagName !== 'STYLE') n.style.display = 'none'
    })
    const b = document.querySelector('[data-bonk-bubble]')
    b.textContent = '敲什么敲，我干活呢'
    b.dataset.show = '1'
    return true
  })()`)
  await sleep(600)

  // Crop to the pet's neighbourhood so the tail has to be judged at real scale.
  const box = await ev(`(() => {
    const r = document.querySelector('[data-bonk-root]').getBoundingClientRect()
    return { x: Math.max(0, Math.round(r.left - 200)), y: Math.max(0, Math.round(r.top - 60)),
             w: Math.min(420, window.innerWidth), h: Math.min(280, window.innerHeight) }
  })()`)

  const shot = await call(ws, 'Page.captureScreenshot', {
    format: 'png',
    clip: { x: box.x, y: box.y, width: box.w, height: box.h, scale: 2 },
  })
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  console.log(`wrote ${out} (${box.w}x${box.h} @2x)`)

  ws.close()
} finally {
  edge.kill()
}
