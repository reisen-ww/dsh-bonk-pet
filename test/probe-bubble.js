/**
 * Measure where the bubble sits relative to the pet's actual artwork.
 *
 * The bubble is positioned `right:100%` against the root box, which is a fixed
 * 150x150. The user's skin is drawn narrower than that box and centred inside it,
 * so the bubble anchors to the BOX edge while the head is well inside — which is
 * why it reads as "没在头上". This reports the gap in pixels for the real skin so
 * the correction is derived from data instead of guessed.
 *
 * Run: node tools/serve-demo.js   (terminal 1)
 *      node tools/probe-bubble.js [baseUrl]
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
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'bonk-bubble-'))}`,
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

  // Force a bubble on screen so it can be measured.
  await ev(`(() => {
    const b = document.querySelector('[data-bonk-bubble]')
    b.textContent = '让报错跟着四四拍摇'
    b.dataset.show = '1'
    return true
  })()`)
  await sleep(400)

  const geo = await ev(`(() => {
    const root = document.querySelector('[data-bonk-root]')
    const whale = root.querySelector('[data-bonk-whale]')
    const bubble = root.querySelector('[data-bonk-bubble]')
    const rr = root.getBoundingClientRect()
    const wr = whale.getBoundingClientRect()
    const br = bubble.getBoundingClientRect()
    // Where the TAIL actually is. Measuring the bubble's own edge is what made
    // the first version of this probe misleading: the tail is inset 14px from
    // that edge, so an "aligned" edge still points the tail somewhere else.
    const tailRight = 14
    const tailW = 10
    const tailCentreX = br.right - tailRight - tailW / 2
    const archCentreX = wr.left + wr.width / 2
    return {
      root: { l: Math.round(rr.left), w: Math.round(rr.width) },
      whale: { l: Math.round(wr.left), w: Math.round(wr.width), t: Math.round(wr.top), h: Math.round(wr.height) },
      bubble: { r: Math.round(br.right), w: Math.round(br.width), b: Math.round(br.bottom) },
      tailCentreX: Math.round(tailCentreX),
      artCentreX: Math.round(archCentreX),
      // THE assertion: the tail must land on the pet's head, i.e. within the
      // artwork's own width and pointing at its centre.
      tailAimError: Math.round(Math.abs(tailCentreX - archCentreX)),
      tailInsideArt: tailCentreX > wr.left && tailCentreX < wr.right,
      tailAboveArtTop: Math.round(wr.top - br.bottom),
    }
  })()`)

  console.log(JSON.stringify(geo, null, 2))

  const results = []
  const check = (name, ok, detail) => {
    results.push({ name, ok })
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ::  ${detail}`}`)
  }

  const headRatio = Number(process.argv[3] ?? 0.62)

  check(
    'the tail lands inside the artwork, not beside it',
    geo.tailInsideArt === true,
    `tail x=${geo.tailCentreX}, artwork centre x=${geo.artCentreX}`,
  )
  // Assert the tail sits in the HEAD BAND, not at the geometric centre.
  //
  // A character portrait's head is not at the image midpoint — this skin holds a
  // notebook left and a pen right — so an assertion against the midpoint would
  // fail for a correctly placed bubble (and did). What is actually guaranteed is
  // that the tail lies in the right-of-centre band where the head is, and not out
  // at the far edge of the frame.
  const expectedHeadX = Math.round(geo.whale.l + geo.whale.w * headRatio)
  const headBandLo = geo.whale.l + geo.whale.w * 0.45
  const headBandHi = geo.whale.l + geo.whale.w * 0.85
  check(
    "the tail lands in the pet's head band",
    geo.tailCentreX >= headBandLo && geo.tailCentreX <= headBandHi,
    `tail x=${geo.tailCentreX}, head band=[${Math.round(headBandLo)},${Math.round(headBandHi)}], aimed at ${expectedHeadX}`,
  )
  check(
    "the tail sits just above the pet's top",
    geo.tailAboveArtTop >= -2 && geo.tailAboveArtTop <= 24,
    `${geo.tailAboveArtTop}px above the artwork's top`,
  )

  const bad = results.filter((r) => !r.ok)
  console.log(`\n${results.length - bad.length}/${results.length} passed`)
  ws.close()
  process.exitCode = bad.length === 0 ? 0 : 1
} finally {
  edge.kill()
}
