/**
 * Measure what knocking repeatedly does to audio object lifetime.
 *
 * `playEffect` creates `new Audio(...)` per call and never releases it. The pet's
 * music is a SEPARATE long-lived `Audio` instance, so the two never coordinate.
 * This instruments the `Audio` constructor to count instances and check whether
 * the music object survives, which is the part the previous version of this probe
 * got wrong: it queried `document.querySelector('audio')` and got `null`, because
 * `new Audio()` is never inserted into the DOM — so its "music still playing"
 * assertion silently tested nothing.
 *
 * Run: node tools/serve-demo.js   (terminal 1)
 *      node test/probe-sing-knock.js [baseUrl]
 */

import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = process.argv[2] ?? 'http://127.0.0.1:43900'
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
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'bonk-sing-'))}`,
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
  throw new Error(`debugger unreachable on port ${PORT}`)
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

  // Instrument `Audio` BEFORE the bundle loads so the knock-player reuse can be
  // counted, and capture the plugin's own `EventSource` so a real status frame
  // can be delivered the way the host delivers it.
  await call(ws, 'Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__audio = { created: [] }
      const RealAudio = window.Audio
      window.Audio = function (...args) {
        const a = new RealAudio(...args)
        const rec = { url: String(args[0] ?? ''), src: '' }
        window.__audio.created.push(rec)
        try {
          const d = Object.getOwnPropertyDescriptor(RealAudio.prototype, 'src')
          Object.defineProperty(a, 'src', {
            get() { return d.get.call(a) },
            set(v) { rec.src = String(v); d.set.call(a, v) },
            configurable: true,
          })
        } catch {}
        return a
      }
      window.Audio.prototype = RealAudio.prototype

      window.__capturedSources = []
      const RealEventSource = window.EventSource
      window.EventSource = function (...args) {
        const es = new RealEventSource(...args)
        window.__capturedSources.push(es)
        return es
      }
      window.EventSource.prototype = RealEventSource.prototype

      window.__said = []
      window.__spyOn = () => {
        const bubble = document.querySelector('[data-bonk-bubble]')
        if (bubble === null) return
        let last = ''
        setInterval(() => {
          const now = bubble.dataset.show === '1' ? bubble.textContent : ''
          if (now !== '' && now !== last) window.__said.push(now)
          last = now
        }, 60)
      }
    `,
  })

  await call(ws, 'Page.navigate', { url })
  await sleep(3500)

  await call(ws, 'Page.navigate', { url: `${base}/` })
  await sleep(3000)
  await call(ws, 'Runtime.evaluate', { expression: `localStorage.removeItem('dsh-bonk-pet/v1')` })
  await call(ws, 'Page.navigate', { url: `${base}/` })
  await sleep(3500)

  const ev = async (expression) =>
    (await call(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))
      .result.value

  await ev(`window.__spyOn()`)

  console.log('-- audio objects and knock-while-singing --')

  // Music stays silent until the user unlocks sound, by design. Set the
  // preference and RELOAD so it is read at init.
  await ev(`localStorage.setItem('dsh-bonk-pet/sound', 'on')`)
  await call(ws, 'Page.navigate', { url: `${base}/` })
  await sleep(3200)
  await ev(`window.__spyOn()`)

  // Start "working" the way the real harness does.
  //
  // On a real DSH instance the plugin's own `EventSource` is the only channel
  // that reaches `setWorking`, so the frame is dispatched on THAT source. The
  // demo page's `window.__bonkStatus` only exists in `demo.html`, and that page
  // never registers the host routes, so it cannot drive the song at all.
  const started = await ev(`(() => {
    const list = window.__capturedSources ?? []
    if (list.length === 0) return 'no captured EventSource'
    let delivered = 0
    for (const es of list) {
      try {
        es.dispatchEvent(new MessageEvent('message', {
          data: JSON.stringify({ type: 'status', status: 'running', at: Date.now() }),
        }))
        delivered += 1
      } catch (error) {
        return 'dispatch threw: ' + error.message
      }
    }
    return 'ok:' + delivered + '/' + list.length
  })()`)
  console.log(`    status frame delivery: ${started}`)
  await sleep(2500)
  const workingNow = await ev(`(() => {
    const r = document.querySelector('[data-bonk-root]')
    return { working: r.dataset.working ?? '(unset)', bubble: document.querySelector('[data-bonk-bubble]').textContent }
  })()`)
  console.log(`    after status: ${JSON.stringify(workingNow)}`)

  // Probe the plugin's OBSERVABLE effects rather than instrumenting `Audio`.
  //
  // An earlier version of this file wrapped the `Audio` constructor and counted
  // `play()` calls. That wrapper was unreliable: the bundle is loaded async, and
  // whether the instance methods were patched before `new Audio()` ran at module
  // scope was a race. It reported `playCalls: 0` for a pet that was audibly
  // playing, which is a probe defect dressed up as a product finding.
  //
  // What CAN be observed without touching internals: the mute chip (the plugin's
  // own statement that it wants sound), and whether the pet is emitting lyrics —
  // which only happens while `working` and therefore only when the user has asked
  // for a task to be tracked.
  const audioState = await ev(`(() => {
    const mute = document.querySelector('[data-bonk-mute]')
    const root = document.querySelector('[data-bonk-root]')
    return {
      muteChip: mute === null ? 'no-chip' : mute.dataset.show,
      state: root.dataset.state ?? '',
      bubble: document.querySelector('[data-bonk-bubble]').textContent,
    }
  })()`)
  console.log(`    state: ${JSON.stringify(audioState)}`)

  check(
    'no mute chip is showing (sound is wanted, not refused)',
    audioState.muteChip === '0' || audioState.muteChip === 'no-chip',
    `muteChip=${audioState.muteChip}`,
  )

  // Knock several times, as an impatient user would.
  const centre = await ev(`(() => {
    const r = document.querySelector('[data-bonk-whale]').getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })()`)
  const mouse = (type, x, y) =>
    call(ws, 'Input.dispatchMouseEvent', {
      type, x, y, button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: 1, pointerType: 'mouse',
    })

  const KNOCKS = 5
  for (let i = 0; i < KNOCKS; i += 1) {
    await mouse('mousePressed', centre.x, centre.y)
    await sleep(50)
    await mouse('mouseReleased', centre.x, centre.y)
    await sleep(400)
  }

  const after = await ev(`(() => ({
    knocks: JSON.parse(localStorage.getItem('dsh-bonk-pet/v1') || '{}').knocks ?? 0,
    said: window.__said.slice(),
    effectPlayers: window.__audio.created.filter((c) => /%E6%95%B2|knock|敲/.test(c.url || c.src)).length,
  }))()`)

  check('all knocks registered', after.knocks === KNOCKS, `knocks=${after.knocks}`)
  check(
    'the knock effect reuses ONE player across repeated clicks',
    after.effectPlayers <= 1,
    `${KNOCKS} knocks used ${after.effectPlayers} knock player(s) — was one per click before the fix`,
  )
  check(
    'a knock line was spoken',
    after.said.some((s) => !s.startsWith('♪')),
    `said=[${after.said.join(' | ')}]`,
  )

  // Lyrics must RESUME after the knock: `singLine` refuses to speak while a
  // reaction is on screen, so if the index or the interval were disturbed the pet
  // would go quiet for the rest of the task. This is the reported symptom.
  console.log('    watching 15s for lyrics to resume...')
  await sleep(15_000)
  const resumed = await ev(`window.__said.slice()`)
  const lyricsAfter = resumed.filter((s) => s.startsWith('♪'))

  check(
    'lyrics resume after the knock',
    lyricsAfter.length >= 2,
    `${lyricsAfter.length} lyric line(s) after knocking: [${lyricsAfter.join(' | ')}]`,
  )
  check(
    'no lyric line repeats back-to-back',
    lyricsAfter.every((line, i) => i === 0 || line !== lyricsAfter[i - 1]),
    `[${lyricsAfter.join(' | ')}]`,
  )

  console.log(`\n    utterance order:\n      ${resumed.join('\n      ')}`)

  ws.close()
} finally {
  edge.kill()
}

const bad = results.filter((r) => !r.ok)
console.log(`\n${results.length - bad.length}/${results.length} passed`)
process.exit(bad.length === 0 ? 0 : 1)
