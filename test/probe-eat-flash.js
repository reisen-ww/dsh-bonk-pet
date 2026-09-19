/**
 * Measure the pet's position THROUGH the moment it finishes eating.
 *
 * Why a dedicated probe: `test/probe-dash.js` reports the closest and the
 * final distance, both of which stay correct even if the pet lurches in
 * between. A jump that starts and ends in the right place is invisible to
 * min/last — it needs the MAXIMUM over the window after the bite.
 *
 * The suspected mechanism: `settleAfterDash` resets the rig's translate to 0
 * AND moves `root.left/top`, in one frame. `left/top` are not transitioned, so
 * the root jumps instantly, while `transform` animates back over .3s — so the
 * pet visually leaves the food and slides home. This measures whether that
 * happens, and how far.
 *
 * Run: node tools/serve-demo.js   (terminal 1)
 *      node test/probe-eat-flash.js [baseUrl]
 */

import { spawn } from 'node:child_process'

const base = process.argv[2] ?? 'http://127.0.0.1:43900'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9344

const edge = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--window-size=1200,800',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.env.TEMP}\\probe-flash-profile`,
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
    } catch {
      // starting
    }
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

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ::  ${detail}`}`)
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
    (
      await call(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    ).result.value

  // Sample the pet's centre against the rice's centre every frame, and record
  // the rig's transform + root's left/top so a mismatch between them is visible.
  await ev(`(() => {
    window.__flash = []
    const tick = () => {
      const root = document.querySelector('[data-bonk-root]')
      const rice = document.querySelector('[data-bonk-rice]')
      const rig = root === null ? null : root.querySelector('[data-bonk-rig]')
      if (root !== null && rice !== null && rig !== null) {
        const pet = root.querySelector('[data-bonk-whale]').getBoundingClientRect()
        const r = rice.getBoundingClientRect()
        const px = pet.left + pet.width / 2
        const py = pet.top + pet.height / 2
        const rx = r.left + r.width / 2
        const ry = r.top + r.height / 2
        window.__flash.push({
          t: Math.round(performance.now()),
          d: Math.round(Math.hypot(px - rx, py - ry)),
          px: Math.round(px), py: Math.round(py),
          rx: Math.round(rx), ry: Math.round(ry),
          eaten: rice.dataset.eaten,
          walking: rig.dataset.walking ?? '',
          tf: getComputedStyle(rig).transform,
          left: root.style.left,
        })
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    return true
  })()`)

  console.log('-- eat-settle flash --')

  const knock = () =>
    ev(`(() => {
      document.querySelector('[data-bonk-whale]').dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return true
    })()`)

  let appeared = false
  for (let i = 0; i < 30 && !appeared; i += 1) {
    await knock()
    for (let j = 0; j < 8; j += 1) {
      await sleep(350)
      if ((await ev(`document.querySelector('[data-bonk-rice]')?.dataset.show === '1'`)) === true) {
        appeared = true
        break
      }
    }
  }
  check('rice appeared', appeared)
  await sleep(7000)

  const report = await ev(`(() => {
    const all = window.__flash
    // Window of interest: from the first frame marked eaten, to the end.
    const i0 = all.findIndex((s) => s.eaten === '1')
    if (i0 < 0) return { n: 0, reason: 'never saw eaten=1' }
    const after = all.slice(i0)
    const worst = after.reduce((a, b) => (b.d > a.d ? b : a))
    // The instant the settle lands: left goes from '' to a px value.
    const settleAt = all.findIndex((s, i) => i > 0 && s.left !== '' && all[i - 1].left === '')
    return {
      n: all.length,
      afterEatFrames: after.length,
      firstAfterEat: after[0].d,
      worstD: worst.d,
      worst,
      settleAt,
      tail: after.slice(-6).map((s) => s.d),
    }
  })()`)

  console.log(`    frames=${report.n} after-eat=${report.afterEatFrames} first=${report.firstAfterEat}px worst=${report.worstD}px`)
  if (report.worst !== undefined) {
    console.log(
      `    worst at pet(${report.worst.px},${report.worst.py}) rice(${report.worst.rx},${report.worst.ry}) walking=${report.worst.walking} tf=${report.worst.tf}`,
    )
  }
  console.log(`    tail distances: ${JSON.stringify(report.tail)}`)

  check(
    'the pet does NOT lurch after taking the bite',
    report.worstD !== undefined && report.worstD <= 40,
    `worst after-eat distance = ${report.worstD}px (should stay near 0)`,
  )

  ws.close()
} finally {
  edge.kill()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length === 0 ? 0 : 1)
