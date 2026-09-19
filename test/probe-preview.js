/**
 * Render the preview page with the user's real artwork and check it against
 * the same assertions the E2E suite makes.
 *
 * Written because the preview server is a claim ("this is what the plugin
 * will do"), and a claim about rendering has to be checked by rendering.
 *
 * Run: node test/probe-preview.js [baseUrl]
 */

import { spawn } from 'node:child_process'

const base = process.argv[2] ?? 'http://127.0.0.1:43900'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9340

const edge = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.env.TEMP}\\probe-preview-profile`,
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

const errors = []

try {
  const ws = new WebSocket(await target())
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params?.exceptionDetails
      errors.push(d?.exception?.description ?? d?.text ?? 'unknown')
      return
    }
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
  await sleep(5000)

  // An async IIFE returns a promise; `awaitPromise` makes the protocol settle
  // it before serialising, so callers never have to remember the flag.
  const ev = async (expression) =>
    (
      await call(ws, 'Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
    ).result.value

  console.log('-- preview page --')
  check('the pet mounted on the preview page', (await ev(`document.querySelector('[data-bonk-root]') !== null`)) === true)

  // The whole point of this server: the real artwork replaces the drawings.
  const art = await ev(`(async () => {
    const root = document.querySelector('[data-bonk-root]')
    const probe = await (await fetch('/api/bonk-pet/skin', { cache: 'no-store' })).json()
    const present = Object.keys(probe.slots ?? {})
    // The rice drop lives on document.body (the pet's own box has
    // "contain: layout", which would reposition a fixed child against it).
    const findImg = (s) => {
      const sel = { pet: '[data-bonk-whale]', basin: '[data-bonk-basin]', pipe: '[data-bonk-pipe]', rice: '[data-bonk-rice]' }[s]
      const scope = s === 'rice' ? document : root
      return scope.querySelector(sel + ' img[data-bonk-art="' + s + '"]')
    }
    for (let i = 0; i < 40; i += 1) {
      const ready = present.every((s) => findImg(s) !== null)
      if (ready) break
      await new Promise((r) => setTimeout(r, 150))
    }
    const out = {}
    for (const s of present) {
      const img = findImg(s)
      out[s] = img === null ? null : img.naturalWidth + 'x' + img.naturalHeight
    }
    return { present, decoded: out }
  })()`)
  check(
    'the real artwork loaded and decoded',
    Object.values(art.decoded).every((v) => v !== null && !v.startsWith('0x')),
    JSON.stringify(art.decoded),
  )

  // The combined pet+basin rule must hold here exactly as it does in DSH.
  const combined = await ev(`(() => {
    const root = document.querySelector('[data-bonk-root]')
    const basin = root.querySelector('[data-bonk-basin]')
    return { flag: root.dataset.petHasBasin ?? null, basinDisplay: getComputedStyle(basin).display }
  })()`)
  check(
    'pet.png without basin.png hides the drawn basin',
    combined.flag === '1' && combined.basinDisplay === 'none',
    `flag=${combined.flag} basin=${combined.basinDisplay}`,
  )

  // Audio: the real song and both effects must be discoverable and decodable.
  const audio = await ev(`(async () => {
    const body = await (await fetch('/api/bonk-pet/tracks', { cache: 'no-store' })).json()
    const Ctx = window.AudioContext || window.webkitAudioContext
    const names = [...body.tracks, ...Object.values(body.effects ?? {})]
    const out = []
    for (const name of names) {
      const r = await fetch('/api/bonk-pet/asset?name=' + encodeURIComponent(name))
      const bytes = await r.arrayBuffer()
      const ctx = new Ctx()
      try {
        const buf = await ctx.decodeAudioData(bytes.slice(0))
        out.push({ name, ok: true, seconds: Number(buf.duration.toFixed(2)) })
      } catch (e) {
        out.push({ name, ok: false, error: String(e) })
      }
      ctx.close()
    }
    return { tracks: body.tracks, effects: body.effects, out }
  })()`)
  check(
    'every real audio file decodes',
    audio.out.length >= 3 && audio.out.every((a) => a.ok === true),
    audio.out.map((a) => `${a.name}=${a.seconds}s`).join(' '),
  )
  check(
    'the effects stay out of the song rotation',
    audio.effects.knock !== undefined &&
      audio.effects.clang !== undefined &&
      !audio.tracks.includes(audio.effects.knock) &&
      !audio.tracks.includes(audio.effects.clang),
    `tracks=${JSON.stringify(audio.tracks)}`,
  )

  // Knock by clicking the pet, exactly as a user would.
  const knock = await ev(`(async () => {
    const root = document.querySelector('[data-bonk-root]')
    const whale = root.querySelector('[data-bonk-whale]')
    const r = whale.getBoundingClientRect()
    const x = Math.round(r.left + r.width / 2)
    const y = Math.round(r.top + r.height / 2)
    const hit = document.elementFromPoint(x, y)
    whale.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }))
    await new Promise((res) => setTimeout(res, 300))
    return {
      hitTag: hit === null ? null : hit.tagName,
      hitIsPet: hit !== null && hit.dataset.bonkArt === 'pet',
      state: root.dataset.state,
      says: root.querySelector('[data-bonk-bubble]').textContent,
    }
  })()`)
  check(
    'clicking the pet knocks, and the hit test lands on the artwork',
    knock.hitIsPet === true && knock.state === 'knock' && knock.says.length > 0,
    `hit=${knock.hitTag} state=${knock.state} says=${JSON.stringify(knock.says)}`,
  )

  check('no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' | ') || '0')

  // Evidence the user can look at.
  const shot = await call(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true })
  const { writeFileSync } = await import('node:fs')
  const out = process.cwd() + '\\assets\\preview-live.png'
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  console.log(`\n  screenshot: ${out}`)

  ws.close()
} finally {
  edge.kill()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length === 0 ? 0 : 1)
