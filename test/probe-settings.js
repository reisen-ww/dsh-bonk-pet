/**
 * Open the DSH Settings → Plugins tab and report whether this plugin's volume
 * card rendered, then drive one slider and confirm the host stored the value.
 *
 * Why a dedicated probe: the card is contributed through a slot the settings
 * package owns, so "the plugin registered something" and "the user can see it"
 * are different claims. Only opening the panel proves the second one. It also
 * exercises the real write path (slider → settings scope → host document →
 * /api/bonk-pet/volume), which is where a namespace mismatch would show up.
 *
 * Run: node test/probe-settings.js <origin> <token>
 */

import { spawn } from 'node:child_process'

const base = process.argv[2] ?? 'http://127.0.0.1:43894'
const token = process.argv[3] ?? ''
const entry = token === '' ? `${base}/` : `${base}/?token=${token}`
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9342

const edge = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.env.TEMP}\\probe-settings-profile`,
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
  await call(ws, 'Page.navigate', { url: entry })
  await sleep(4000)

  const ev = async (expression) =>
    (
      await call(ws, 'Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
    ).result.value

  console.log('-- settings card --')

  // The card lives inside the settings modal, so the modal has to be opened the
  // way a user would. The gear is an icon-only button with no text, so text
  // matching finds nothing; instead scan every button for one that carries a
  // settings-ish aria-label/title, then fall back to clicking near the
  // bottom-left corner where the shell parks it.
  const opened = await ev(`(async () => {
    const btns = Array.from(document.querySelectorAll('button,[role="button"]'))
    const named = btns.find((el) => {
      const s = [el.getAttribute('aria-label'), el.getAttribute('title'), el.dataset.tip]
        .filter(Boolean).join(' ')
      return /设置|偏好|setting|preference|gear/i.test(s)
    })
    if (named !== undefined) { named.click(); return 'aria: ' + (named.getAttribute('aria-label') || named.getAttribute('title')) }
    const byText = btns.find((el) => /设置|Settings/i.test((el.textContent || '').trim()))
    if (byText !== undefined) { byText.click(); return 'text' }
    // Last resort: the left rail's bottom-most button is the settings gear.
    const rail = btns
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0 && r.left < 80)
      .sort((a, b) => b.r.top - a.r.top)
    if (rail.length === 0) return ''
    rail[0].el.click()
    return 'rail-bottom @y=' + Math.round(rail[0].r.top)
  })()`)
  check('found a way into Settings', opened !== '', opened || 'no settings control matched')
  await sleep(2000)

  // The plugin cards live behind the Plugins tab of that section.
  const tabbed = await ev(`(() => {
    const tabs = Array.from(document.querySelectorAll('button,[role="tab"],[role="button"]'))
      .filter((el) => /插件|Plugins/i.test((el.textContent || '').trim()))
    if (tabs.length === 0) return 0
    tabs[tabs.length - 1].click()
    return tabs.length
  })()`)
  await sleep(2000)

  const card = await ev(`(() => {
    const el = document.querySelector('.bonk-set-card')
    const why = window.__bonkSettingsCard ?? '(no breadcrumb at all)'
    if (el === null) {
      // Report what IS there, so a failure is diagnosable rather than opaque.
      const body = document.body.innerText || ''
      return { found: false, why, tabs: ${tabbed}, sample: body.slice(0, 400) }
    }
    const ranges = Array.from(el.querySelectorAll('input[type="range"]'))
    return {
      found: true,
      why,
      sliders: ranges.length,
      labels: Array.from(el.querySelectorAll('.bonk-set-name')).map((n) => n.textContent),
      values: ranges.map((r) => r.value),
    }
  })()`)
  check(
    'the volume card rendered in Settings → Plugins',
    card.found === true && card.sliders === 3,
    card.found
      ? `sliders=${card.sliders} labels=${JSON.stringify(card.labels)} (${card.why})`
      : `breadcrumb: ${card.why}; page said: ${JSON.stringify(card.sample)}`,
  )

  if (card.found === true && card.sliders === 3) {
    check(
      'the default pipe volume is visibly lower than the music',
      Number(card.values[1]) < Number(card.values[0]),
      `music=${card.values[0]} pipe=${card.values[1]} knock=${card.values[2]}`,
    )

    // Drive the pipe slider and confirm the host actually stored it.
    const wrote = await ev(`(() => {
      const el = document.querySelector('.bonk-set-card')
      const range = el.querySelectorAll('input[type="range"]')[1]
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(range, '0.05')
      range.dispatchEvent(new Event('input', { bubbles: true }))
      range.dispatchEvent(new Event('change', { bubbles: true }))
      return range.value
    })()`)
    await sleep(2500)
    const stored = await ev(`(async () => {
      const r = await fetch('/api/bonk-pet/volume', { cache: 'no-store' })
      return (await r.json()).pipe
    })()`)
    check(
      'moving the slider reaches the host volume route',
      Math.abs(Number(stored) - 0.05) < 0.02,
      `slider=${wrote} host reported pipe=${stored}`,
    )
  }

  check('no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' | ') || '0')

  const shot = await call(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true })
  const { writeFileSync } = await import('node:fs')
  const out = `${process.cwd()}\\assets\\settings-live.png`
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  console.log(`\n  screenshot: ${out}`)

  ws.close()
} finally {
  edge.kill()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length === 0 ? 0 : 1)
