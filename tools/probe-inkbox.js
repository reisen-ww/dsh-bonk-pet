/**
 * Measure the TRANSPARENT PADDING inside the pet's artwork.
 *
 * The bubble is positioned relative to the image element's box, but a character
 * PNG usually carries empty space above the head. If the skin has, say, 40px of
 * transparent margin on top, a bubble anchored to "6px above the image" floats
 * 40px+ above the visible head — which is what the alignment looks like in a
 * screenshot even though every geometric assertion passes.
 *
 * Reading the alpha channel is the only way to know where the ink actually is,
 * so this rasterises the image and reports the ink bounding box.
 *
 * Run: node tools/serve-demo.js   (terminal 1)
 *      node tools/probe-inkbox.js [baseUrl]
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
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'bonk-ink-'))}`,
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

  const result = await ev(`(async () => {
    const img = document.querySelector('[data-bonk-whale] img[data-bonk-art]')
    if (img === null) return { err: 'the whale has no custom image attached' }
    if (img.naturalWidth === 0) return { err: 'image not decoded' }
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const g = c.getContext('2d')
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height).data
    let top = c.height
    let bottom = 0
    let left = c.width
    let right = 0
    for (let y = 0; y < c.height; y += 1) {
      for (let x = 0; x < c.width; x += 1) {
        if (d[(y * c.width + x) * 4 + 3] > 8) {
          if (y < top) top = y
          if (y > bottom) bottom = y
          if (x < left) left = x
          if (x > right) right = x
        }
      }
    }
    const box = img.getBoundingClientRect()
    const scale = box.height / c.height
    return {
      naturalPx: [c.width, c.height],
      inkBoxPx: [left, top, right, bottom],
      renderedCss: [Math.round(box.width), Math.round(box.height)],
      scale,
      blankTopCss: +(top * scale).toFixed(1),
      blankBottomCss: +((c.height - bottom) * scale).toFixed(1),
      blankLeftCss: +(left * scale).toFixed(1),
      blankRightCss: +((c.width - right) * scale).toFixed(1),
      inkWidthCss: +((right - left) * scale).toFixed(1),
      inkTopFromImageTopCss: +(top * scale).toFixed(1),
    }
  })()`)

  console.log(JSON.stringify(result, null, 2))

  if (result.err === undefined) {
    console.log(
      `\n  the visible head starts ${result.blankTopCss}px below the image's top edge`,
    )
    console.log(
      `  so a bubble anchored to the image box floats that much too high for the eye`,
    )
  }

  ws.close()
} finally {
  edge.kill()
}
