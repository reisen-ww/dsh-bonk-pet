/**
 * Answer one question: does `pointerdown` fire when CDP presses on the pet?
 *
 * Every drag probe reports "the pet never moved", and `moveDrag`'s earliest side
 * effect (`rig.dataset.walking = '0'`) never appears — which means `drag` is
 * still null when the moves arrive, which means `beginDrag` never ran. This
 * records the press and the first move with the listener list and the actual
 * target, so the cause is observed instead of inferred.
 *
 * It presses at BOTH the whale's centre and the probe's offset point, because
 * those differ and only one of them is what the probes use.
 *
 * Run: node tools/probe-press.js [baseUrl]
 */

import { spawn } from 'node:child_process'

const base = process.argv[2] ?? 'http://127.0.0.1:43900'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9353

const edge = spawn(
  EDGE,
  [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--window-size=1280,800',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.env.TEMP}\\probe-press-profile`,
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

  // Capture the capture-phase target of every pointer event, plus whether the
  // plugin's own handler ran (it sets `data-walking`).
  await ev(`(() => {
    window.__press = []
    for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
      window.addEventListener(type, (e) => {
        const t = e.target
        const path = (e.composedPath ? e.composedPath() : []).slice(0, 4).map((n) =>
          n === window ? 'window' : (n.tagName || '?').toLowerCase() + (n.dataset && n.dataset.bonkArt ? '[art=' + n.dataset.bonkArt + ']' : ''))
        window.__press.push(type + ' @' + Math.round(e.clientX) + ',' + Math.round(e.clientY) + ' target=' + (t.tagName || '?').toLowerCase() + ' path=' + path.join('>') + ' buttons=' + e.buttons)
      }, true)
    }
    return true
  })()`)

  const rect = await ev(`(() => {
    const r = document.querySelector('[data-bonk-whale]').getBoundingClientRect()
    return { left: r.left, top: r.top, w: r.width, h: r.height }
  })()`)

  const points = {
    'whale centre    ': { x: Math.round(rect.left + rect.w / 2), y: Math.round(rect.top + rect.h / 2) },
    'probe point +75 ': { x: Math.round(rect.left + 75), y: Math.round(rect.top + 75) },
    'root-ish +40    ': { x: Math.round(rect.left + 40), y: Math.round(rect.top + 40) },
  }

  const mouse = (type, x, y) =>
    call(ws, 'Input.dispatchMouseEvent', {
      type, x, y, button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: 1, pointerType: 'mouse',
    })

  for (const [label, p] of Object.entries(points)) {
    await ev(`window.__press = []`)
    await mouse('mousePressed', p.x, p.y)
    await sleep(60)
    await mouse('mouseMoved', p.x - 120, p.y - 60)
    await sleep(200)
    const walked = await ev(`document.querySelector('[data-bonk-rig]').dataset.walking ?? '(none)'`)
    const dx = await ev(`document.querySelector('[data-bonk-rig]').style.getPropertyValue('--bonk-dx') || '(none)'`)
    await mouse('mouseReleased', p.x - 120, p.y - 60)
    await sleep(400)
    const press = await ev(`window.__press.slice(0, 3)`)
    console.log(`\n${label} (${p.x},${p.y})`)
    console.log(`  walking=${walked}  --bonk-dx=${dx}`)
    for (const line of press) console.log(`  ${line}`)
  }

  ws.close()
} finally {
  edge.kill()
}
