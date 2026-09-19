/**
 * Verify the pet mouths the song's lyrics while a task is running.
 *
 * "The array is non-empty" is not evidence a user sees anything, so this drives
 * a real task start through the SSE channel the demo page exposes, then watches
 * the speech bubble for lyric lines and checks they advance rather than repeat.
 *
 * Run: node tools/serve-demo.js   (terminal 1)
 *      node test/probe-lyrics.js [baseUrl]
 */

import { spawn } from 'node:child_process'

const base = process.argv[2] ?? 'http://127.0.0.1:43900'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9346

const edge = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--window-size=1200,800',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.env.TEMP}\\probe-lyric-profile`,
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
  await sleep(3500)

  const ev = async (expression) =>
    (
      await call(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    ).result.value

  // Record every distinct bubble text from now on.
  await ev(`(() => {
    window.__said = []
    setInterval(() => {
      const b = document.querySelector('[data-bonk-bubble]')
      if (b === null) return
      if (b.dataset.show !== '1') return
      const t = (b.textContent || '').trim()
      if (t !== '' && window.__said[window.__said.length - 1] !== t) window.__said.push(t)
    }, 200)
    return true
  })()`)

  console.log('-- lyrics while working --')

  // Start a task the same way the demo's own button does.
  const started = await ev(`(() => {
    const btn = document.getElementById('btn-run')
    if (btn === null) return 'no button'
    btn.click()
    return 'clicked'
  })()`)
  check('started a task', started === 'clicked', started)

  // The first line lands ~900ms in, the rest every 6.5s. Sample long enough
  // for three lines.
  await sleep(16000)

  const seen = await ev(`window.__said`)
  const lyrics = seen.filter((t) => t.startsWith('♪'))
  console.log(`    bubble history: ${JSON.stringify(seen.slice(0, 10))}`)
  console.log(`    lyric lines: ${lyrics.length} -> ${JSON.stringify(lyrics)}`)

  check('lyrics appeared while working', lyrics.length >= 2, `${lyrics.length} line(s)`)
  check(
    'the lines advance instead of repeating one line',
    new Set(lyrics).size === lyrics.length || lyrics.length <= 1,
    `${new Set(lyrics).size} distinct of ${lyrics.length}`,
  )
  check(
    'the lyrics came from the song, not the old placeholders',
    lyrics.every((t) => !/我在干活呢|啦啦啦|唱首歌给你听/.test(t)),
    lyrics.join(' | ') || '(none)',
  )

  // Stop the task; lyrics must stop too.
  await ev(`document.getElementById('btn-reset')?.click?.()`)
  ws.close()
} finally {
  edge.kill()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length === 0 ? 0 : 1)
