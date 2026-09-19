/**
 * End-to-end verification against a REAL DSH instance in a REAL browser.
 *
 * Launches headless Edge with the DevTools protocol open, navigates to a live
 * `dsh web` origin, and asserts the pet actually mounted inside the shipped
 * application shell — not just that the bundle downloads.
 *
 * Targets the CURRENT host contract:
 *   - `/api/bonk-pet/skin`   -> `{ slots: {pet?,basin?,pipe?,rice?}, dir, accepted }`
 *   - `/api/bonk-pet/tracks` -> `{ dir, tracks: [...], effects: {knock?,clang?} }`
 *   - `/api/bonk-pet/asset`  -> one guarded file (the old `/audio` name is gone)
 *
 * and the current client contract: four independent artwork slots, each swapped
 * in ONLY after its image decodes, marked with `img[data-bonk-art="<slot>"]`.
 *
 * Usage:
 *   node test/e2e.js <origin> <token> [edgePath] [screenshotPath]
 */

import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseLines } from '../tools/parse-lines.js'

const origin = process.argv[2] ?? 'http://127.0.0.1:43871'
const token = process.argv[3] ?? ''
const edge =
  process.argv[4] ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const shotPath = process.argv[5] ?? join(process.cwd(), 'assets', 'e2e-live.png')

const PORT = 9333
const profileDir = mkdtempSync(join(tmpdir(), 'bonk-e2e-'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Minimal CDP client over one page target.
 *
 * Uses Node's built-in WebSocket (undici) so the test has no npm dependency —
 * the plugin ships with no runtime deps and its test suite should not need a
 * separate install step either.
 */
class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url)
    this.nextId = 1
    this.pending = new Map()
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true })
      this.ws.addEventListener('error', (event) => reject(new Error(String(event.message ?? 'ws error'))), {
        once: true,
      })
    })
    this.ws.addEventListener('message', (event) => {
      let msg
      try {
        msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data))
      } catch {
        return
      }
      if (msg.id === undefined) return
      const entry = this.pending.get(msg.id)
      if (entry === undefined) return
      this.pending.delete(msg.id)
      if (msg.error !== undefined) entry.reject(new Error(JSON.stringify(msg.error)))
      else entry.resolve(msg.result)
    })
  }
  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP timeout: ${method}`))
      }, 30_000)
    })
  }
  /** Evaluate an expression in the page and return its JSON value. */
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (result.exceptionDetails !== undefined) {
      const detail = result.exceptionDetails
      const thrown = detail.exception?.description ?? detail.text ?? 'evaluate threw'
      throw new Error(thrown)
    }
    return result.result?.value
  }
  /** Subscribe to a CDP event. */
  onEvent(method, handler) {
    this.ws.addEventListener('message', (event) => {
      let msg
      try {
        msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data))
      } catch {
        return
      }
      if (msg.method === method) handler(msg.params)
    })
  }
  close() {
    try {
      this.ws.close()
    } catch {
      /* already closed */
    }
  }
}

const child = spawn(
  edge,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--disable-extensions',
    '--disable-sync',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profileDir}`,
    '--window-size=1280,800',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

let cdp = null
const cleanup = () => {
  cdp?.close()
  try {
    child.kill()
  } catch {
    /* already gone */
  }
  setTimeout(() => rmSync(profileDir, { recursive: true, force: true }), 300)
}

const results = []
function section(name) {
  console.log(`\n-- ${name} ${'-'.repeat(Math.max(0, 58 - name.length))}`)
}
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ::  ${detail}`}`)
}

try {
  // Wait for the DevTools endpoint.
  let version = null
  for (let i = 0; i < 60; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      version = await response.json()
      break
    } catch {
      await sleep(500)
    }
  }
  if (version === null) throw new Error('DevTools endpoint never came up')
  console.log(`browser: ${version.Browser}`)
  console.log(`origin : ${origin}`)

  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page = targets.find((t) => t.type === 'page')
  if (page === undefined) throw new Error('no page target')

  cdp = new Cdp(page.webSocketDebuggerUrl)
  await cdp.ready
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')

  // Collect page errors so a broken plugin cannot pass silently.
  const pageErrors = []
  cdp.onEvent('Runtime.exceptionThrown', (params) => {
    const d = params?.exceptionDetails
    pageErrors.push(d?.exception?.description ?? d?.text ?? 'unknown')
  })

  // Record real network requests: `performance` resource timing does not cover
  // EventSource, so the only honest way to prove the browser subscribed to the
  // relay is to watch the network at the protocol level.
  const requestedUrls = []
  /** Every asset route response, so a 200 can be told apart from a 404. */
  const assetResponses = []
  await cdp.send('Network.enable')
  cdp.onEvent('Network.requestWillBeSent', (params) => {
    const url = params?.request?.url
    if (typeof url === 'string') requestedUrls.push(url)
  })
  cdp.onEvent('Network.responseReceived', (params) => {
    const url = params?.response?.url
    if (typeof url === 'string' && url.includes('/api/bonk-pet/')) {
      assetResponses.push({ url, status: params.response.status, mime: params.response.mimeType })
    }
  })

  const url = token.length > 0 ? `${origin}/?token=${token}` : `${origin}/`

  // Capture the plugin's own EventSource so a failure frame can be delivered
  // exactly the way the host would deliver it. Installed BEFORE navigation so
  // the plugin's constructor call is recorded.
  //
  // Incoming frames are logged too. Without that, a test that sees an
  // unexpected `data-state="hit"` cannot tell whether the plugin dropped a pipe
  // because the page received an error frame, or for some other reason — and
  // "the pet was not idle" failures were being investigated blind.
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__bonkSources = [];
      window.__bonkFrames = [];
      const RealEventSource = window.EventSource;
      window.EventSource = function (...args) {
        const es = new RealEventSource(...args);
        es.addEventListener('message', (event) => {
          try {
            window.__bonkFrames.push({ url: String(args[0]), data: String(event.data).slice(0, 120) })
          } catch {}
        });
        window.__bonkSources.push(es);
        return es;
      };
      window.EventSource.prototype = RealEventSource.prototype;
    `,
  })

  await cdp.send('Page.navigate', { url })

  // Give the SPA time to boot its plugin tree and mount the pet.
  let mounted = false
  for (let i = 0; i < 40; i += 1) {
    await sleep(1000)
    mounted = await cdp.eval(`document.querySelector('[data-bonk-root]') !== null`).catch(() => false)
    if (mounted === true) break
  }

  section('shell')
  check('the pet mounts inside the real DSH shell', mounted === true)

  if (mounted) {
    const probe = await cdp.eval(`(() => {
      const root = document.querySelector('[data-bonk-root]')
      const style = document.querySelector('style[data-plugin-css="dsh-bonk-pet/bonk-pet.css"]')
      const cs = getComputedStyle(root)
      const r = root.getBoundingClientRect()
      return {
        scope: document.body.hasAttribute('data-dsh-bonk-pet'),
        state: root.dataset.state,
        position: cs.position,
        zIndex: cs.zIndex,
        styleInjected: style !== null,
        styleChars: style === null ? 0 : style.textContent.length,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        inViewport: r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && r.x >= 0 && r.y >= 0,
        viewport: innerWidth + 'x' + innerHeight,
      }
    })()`)

    check('scope attribute is on <body>', probe.scope === true)
    check('the stylesheet is injected', probe.styleInjected === true, `${probe.styleChars} chars`)
    check('anchored to the viewport', probe.position === 'fixed', `${probe.position} z=${probe.zIndex}`)
    check(
      'sits inside the viewport',
      probe.inViewport === true,
      `x=${probe.rect.x} y=${probe.rect.y} ${probe.rect.w}x${probe.rect.h} in ${probe.viewport}`,
    )
    check('idle at rest', probe.state === 'idle' || probe.state === 'hungry', probe.state)

    // ---- the artwork probe, read straight off the live host --------------
    section('artwork slots (live /api/bonk-pet/skin)')
    const skin = await cdp.eval(`(async () => {
      const r = await fetch('/api/bonk-pet/skin', { cache: 'no-store' })
      const body = await r.json()
      return { ok: r.ok, status: r.status, slots: body.slots, dir: body.dir, accepted: body.accepted }
    })()`)
    const slotNames = Object.keys(skin.slots ?? {})
    check(
      'the skin probe reports the new slot shape',
      skin.ok === true && typeof skin.slots === 'object' && skin.slots !== null,
      `slots=[${slotNames.join(',')}]`,
    )
    check('the host finds the user pet.png', skin.slots?.pet?.name === 'pet.png', JSON.stringify(skin.slots?.pet))
    check(
      'no basin.png exists (combined pet image is expected)',
      skin.slots?.basin === undefined,
      `basin=${JSON.stringify(skin.slots?.basin)}`,
    )

    // ---- every supplied slot really swapped in AND really decoded --------
    // The strongest available evidence that the right file arrived is the
    // decoded pixel size: it can only come from the bytes themselves.
    const arts = await cdp.eval(`(async () => {
      const root = document.querySelector('[data-bonk-root]')
      const wanted = ['pet', 'basin', 'pipe', 'rice']
      // The rice drop hangs off document.body, NOT off the pet: the root
      // element carries "contain: layout", so a fixed-position descendant
      // would be positioned against the pet's own box and land off-screen.
      const findHost = (slot) => {
        const sel = {
          pet: '[data-bonk-whale]',
          basin: '[data-bonk-basin]',
          pipe: '[data-bonk-pipe]',
          rice: '[data-bonk-rice]',
        }[slot]
        return slot === 'rice' ? document.querySelector(sel) : root.querySelector(sel)
      }
      const probe = await (await fetch('/api/bonk-pet/skin', { cache: 'no-store' })).json()
      const present = Object.keys(probe.slots ?? {}).filter((s) => wanted.includes(s))
      // Wait for the client's own swap, which only happens after its img loads.
      for (let i = 0; i < 80; i += 1) {
        const ready = present.every((slot) => {
          const host = findHost(slot)
          return host !== null && host.dataset.art === 'custom'
        })
        if (ready) break
        await new Promise((r) => setTimeout(r, 250))
      }
      const out = {}
      for (const slot of wanted) {
        const host = findHost(slot)
        const img = host === null ? null : host.querySelector('img[data-bonk-art="' + slot + '"]')
        const rect = img === null ? null : img.getBoundingClientRect()
        out[slot] = {
          hostPresent: host !== null,
          hostArtMarked: host === null ? null : host.dataset.art ?? null,
          imgPresent: img !== null,
          complete: img?.complete ?? false,
          naturalWidth: img?.naturalWidth ?? 0,
          naturalHeight: img?.naturalHeight ?? 0,
          src: img === null ? null : decodeURIComponent(img.getAttribute('src') ?? ''),
          objectFit: img === null ? null : getComputedStyle(img).objectFit,
          box: rect === null ? null : { w: Math.round(rect.width * 10) / 10, h: Math.round(rect.height * 10) / 10 },
          // The drawn SVG must be GONE from a swapped slot, not merely hidden.
          svgStillThere: host === null ? null : host.querySelector('svg') !== null,
        }
      }
      return out
    })()`)

    check(
      'pet.png replaced the drawn whale',
      arts.pet.hostArtMarked === 'custom' && arts.pet.imgPresent === true && arts.pet.svgStillThere === false,
      `data-art=${arts.pet.hostArtMarked} svg-gone=${arts.pet.svgStillThere === false}`,
    )
    check(
      'pet.png really decoded in the browser',
      arts.pet.complete === true && arts.pet.naturalWidth > 0,
      `natural=${arts.pet.naturalWidth}x${arts.pet.naturalHeight} box=${arts.pet.box?.w}x${arts.pet.box?.h} fit=${arts.pet.objectFit}`,
    )
    check('pet.png came from the asset route', (arts.pet.src ?? '').includes('pet.png'), arts.pet.src)

    check(
      'pipe.png replaced the drawn pipe',
      arts.pipe.hostArtMarked === 'custom' && arts.pipe.imgPresent === true && arts.pipe.svgStillThere === false,
      `data-art=${arts.pipe.hostArtMarked} natural=${arts.pipe.naturalWidth}x${arts.pipe.naturalHeight}`,
    )
    check(
      'pipe.png really decoded in the browser',
      arts.pipe.complete === true && arts.pipe.naturalWidth === 512 && arts.pipe.naturalHeight === 293,
      `natural=${arts.pipe.naturalWidth}x${arts.pipe.naturalHeight} (file is 512x293) src=${arts.pipe.src}`,
    )

    check(
      'rice.png replaced the drawn rice mound',
      arts.rice.hostArtMarked === 'custom' && arts.rice.imgPresent === true,
      `data-art=${arts.rice.hostArtMarked} natural=${arts.rice.naturalWidth}x${arts.rice.naturalHeight}`,
    )
    check(
      'rice.png really decoded in the browser',
      arts.rice.complete === true && arts.rice.naturalWidth === 512,
      `natural=${arts.rice.naturalWidth}x${arts.rice.naturalHeight} src=${arts.rice.src}`,
    )

    check(
      'the basin slot kept its drawn SVG (no basin file supplied)',
      arts.basin.hostArtMarked !== 'custom' && arts.basin.svgStillThere === true,
      `data-art=${arts.basin.hostArtMarked} svg=${arts.basin.svgStillThere}`,
    )

    // ---- the combined pet+basin composition ------------------------------
    section('combined pet+basin composition')
    const basinState = await cdp.eval(`(() => {
      const root = document.querySelector('[data-bonk-root]')
      const basin = root.querySelector('[data-bonk-basin]')
      const whale = root.querySelector('[data-bonk-whale]')
      return {
        flag: root.getAttribute('data-pet-has-basin'),
        basinDisplay: getComputedStyle(basin).display,
        whalePointerEvents: getComputedStyle(whale).pointerEvents,
        whaleCursor: getComputedStyle(whale).cursor,
        // The hidden basin must not be reachable by a hit test.
        hitAtWhaleCentre: (() => {
          const r = whale.getBoundingClientRect()
          const el = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))
          return el === null ? null : el.tagName.toLowerCase() + (el.dataset.bonkArt ? '[' + el.dataset.bonkArt + ']' : '')
        })(),
      }
    })()`)
    check(
      'the root is flagged data-pet-has-basin="1"',
      basinState.flag === '1',
      `data-pet-has-basin=${JSON.stringify(basinState.flag)}`,
    )
    check(
      'the drawn basin layer is display:none',
      basinState.basinDisplay === 'none',
      `display=${basinState.basinDisplay}`,
    )
    check(
      'the whole pet became the click target',
      basinState.whalePointerEvents === 'auto' && basinState.whaleCursor === 'pointer',
      `pointer-events=${basinState.whalePointerEvents} cursor=${basinState.whaleCursor}`,
    )
    check(
      'a real hit test at the pet centre lands on the pet image',
      (basinState.hitAtWhaleCentre ?? '').startsWith('img'),
      `elementFromPoint -> ${basinState.hitAtWhaleCentre}`,
    )

    // ---- interaction: click the PET, not the basin -----------------------
    // Real mouse events at real viewport coordinates, so the browser's own hit
    // testing decides what was clicked. A synthetic `element.click()` would
    // bypass exactly the thing under test.
    section('knock by clicking the pet')

    // Instrumentation: record where each pointer/click event actually lands,
    // and whether the plugin takes a pointer capture during the press. All of
    // this is observation only — no plugin behaviour is altered here.
    await cdp.eval(`(() => {
      window.__e2e = { targets: [], caps: [] }
      const root = document.querySelector('[data-bonk-root]')
      window.__origCapture = root.setPointerCapture.bind(root)
      root.setPointerCapture = (id) => { window.__e2e.caps.push(id); return window.__origCapture(id) }
      const own = (el) => {
        if (el === null || el === undefined) return 'null'
        const tags = ['bonkRoot','bonkRig','bonkWhale','bonkBasin','bonkPipe','bonkRice']
        const hit = tags.filter((k) => el.dataset[k] !== undefined)
        return el.tagName.toLowerCase() + (hit.length ? '[' + hit.join(',') + ']' : '') +
          (el.dataset.bonkArt ? ' art=' + el.dataset.bonkArt : '')
      }
      for (const type of ['pointerdown', 'pointerup', 'click']) {
        document.addEventListener(type, (e) => {
          if (window.__e2e.targets.length < 40) window.__e2e.targets.push(type + '->' + own(e.target))
        }, true)
      }
      return true
    })()`)

    const clickAt = async (x, y) => {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 })
      await sleep(150)
    }
    const readKnock = () => cdp.eval(`(() => {
      const root = document.querySelector('[data-bonk-root]')
      const whale = root.querySelector('[data-bonk-whale]')
      const bubble = root.querySelector('[data-bonk-bubble]')
      return {
        state: root.dataset.state,
        bubble: bubble.dataset.show,
        text: bubble.textContent,
        stored: JSON.parse(localStorage.getItem('dsh-bonk-pet/v1') || '{}').knocks ?? null,
        targets: window.__e2e.targets.slice(),
        caps: window.__e2e.caps.slice(),
        shakeComputed: getComputedStyle(whale).animationName,
        shakeLive: (document.getAnimations ? document.getAnimations() : [])
          .map((a) => a.animationName).filter(Boolean),
      }
    })()`)
    const resetProbe = () => cdp.eval(`(() => {
      window.__e2e = { targets: [], caps: [] }
      document.querySelector('[data-bonk-root]').dataset.state = ''
      return true
    })()`)

    const centre = await cdp.eval(`(() => {
      const r = document.querySelector('[data-bonk-whale]').getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    })()`)
    const knocksBefore = await cdp.eval(`JSON.parse(localStorage.getItem('dsh-bonk-pet/v1') || '{}').knocks ?? 0`)

    // ---- (a) the shipped configuration: pet.png carries the click --------
    await resetProbe()
    await clickAt(centre.x, centre.y)
    const petClick = await readKnock()
    check(
      'a real click on the pet triggers a knock',
      petClick.state === 'knock',
      `data-state=${JSON.stringify(petClick.state)} at (${centre.x},${centre.y}); events=[${petClick.targets.join(' ')}]`,
    )
    // The pet greets on mount with a line of its own, so "a bubble is visible"
    // is NOT evidence of a knock. The line has to be one that a knock can say.
    //
    // Read from the plugin rather than duplicated here: a hardcoded copy used to
    // live at this spot, and editing the COPY in `lib/client.js` — a pure
    // content change with no logic in it — broke this suite and read like a
    // regression. `parse-lines.js` is the one parser; `tools/check-lines.js`
    // uses the same one.
    const LINES = parseLines()
    const KNOCK_LINES = [...(LINES.get('knock') ?? []), ...(LINES.get('knockNag') ?? [])]
    const GREET_LINES = LINES.get('greet') ?? []
    check(
      'the knock line list was read from the plugin, not copied',
      KNOCK_LINES.length >= 6 && GREET_LINES.length >= 1,
      `knock=${KNOCK_LINES.length} greet=${GREET_LINES.length}`,
    )
    check(
      'a knock line of dialogue appears',
      petClick.state === 'knock' && petClick.bubble === '1' && KNOCK_LINES.includes(petClick.text),
      `state=${JSON.stringify(petClick.state)} bubble=${JSON.stringify(petClick.bubble)} text=${JSON.stringify(petClick.text)}`,
    )
    check(
      'the knock counter persists to localStorage',
      petClick.stored === knocksBefore + 1,
      `knocks ${knocksBefore} -> ${petClick.stored}`,
    )
    // `beginDrag` runs on `pointerdown` at the root and captures the pointer.
    // The browser then retargets the matching pointerup/click to the capture
    // element's subtree, so the listeners wired on [data-bonk-whale] never see
    // them. Reported as a failure because it is one: the click is swallowed.
    check(
      'the plugin does not hijack the pet click with a pointer capture',
      petClick.caps.length === 0,
      `setPointerCapture ids=[${petClick.caps.join(',')}] events=[${petClick.targets.join(' ')}]`,
    )

    // ---- (b) isolation: neutralise ONLY the capture call ----------------
    // Bisection, not a fix: nothing else about the page is changed, so a pass
    // here proves the capture call is the single cause of the swallowed click.
    await resetProbe()
    await cdp.eval(
      `(() => { document.querySelector('[data-bonk-root]').setPointerCapture = function () {}; return true })()`,
    )
    await clickAt(centre.x, centre.y)
    const noCapture = await readKnock()
    check(
      'isolation: the pet click path works once only the capture call is removed',
      noCapture.state === 'knock' && noCapture.stored === (petClick.stored ?? 0) + 1,
      `data-state=${JSON.stringify(noCapture.state)} knocks=${petClick.stored} -> ${noCapture.stored} events=[${noCapture.targets.join(' ')}]`,
    )
    check(
      'bonk-shake really runs in the engine for a real pet click',
      noCapture.shakeComputed.includes('bonk-shake') && noCapture.shakeLive.some((n) => n.includes('bonk-shake')),
      `computed=${noCapture.shakeComputed} live=[${noCapture.shakeLive.join(',')}]`,
    )
    check(
      'a knock line of dialogue appears on a working pet click',
      noCapture.bubble === '1' && KNOCK_LINES.includes(noCapture.text),
      `bubble=${JSON.stringify(noCapture.bubble)} text=${JSON.stringify(noCapture.text)}`,
    )

    // ---- (c) the contrast path: the drawn basin --------------------------
    // `data-pet-has-basin` is dropped in the page only, so the plugin source
    // is untouched; this selects the path where `beginDrag` early-returns on a
    // basin target and therefore never captures the pointer.
    await cdp.eval(`(() => {
      const r = document.querySelector('[data-bonk-root]')
      r.setPointerCapture = window.__origCapture
      r.removeAttribute('data-pet-has-basin')
      window.__e2e = { targets: [], caps: [] }
      r.dataset.state = ''
      return true
    })()`)
    const basinCentre = await cdp.eval(`(() => {
      const r = document.querySelector('[data-bonk-basin]').getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) }
    })()`)
    await cdp.eval(`document.querySelector('[data-bonk-root]').dataset.state = ''`)
    const knocksBeforeBasin = await cdp.eval(
      `JSON.parse(localStorage.getItem('dsh-bonk-pet/v1') || '{}').knocks ?? 0`,
    )
    await clickAt(basinCentre.x, basinCentre.y)
    const basinClick = await readKnock()
    const frames = await cdp.eval(`(window.__bonkFrames ?? []).map((f) => f.url + ' :: ' + f.data.slice(0, 80))`)
    // Assert on the KNOCK COUNTER, not on `data-state`.
    //
    // The state is a single slot shared by every transient animation, so an
    // unrelated real error arriving between the click and this read overwrites
    // `knock` with `hit` — and the harness genuinely does emit one during a test
    // run ("resume failed for session ..." from a stale session in the profile).
    // The counter is per-cause and immune to that interference.
    check(
      'a real click on the drawn basin triggers a knock (the other path)',
      basinClick.stored === knocksBeforeBasin + 1,
      `knocks ${knocksBeforeBasin} -> ${basinClick.stored} state=${JSON.stringify(basinClick.state)} at (${basinCentre.x},${basinCentre.y}) box=${basinCentre.w}x${basinCentre.h} captures=[${basinClick.caps.join(',')}] frames=[${frames.join(' | ')}]`,
    )

    // Put the shipped configuration back for everything that follows.
    await cdp.eval(`(() => {
      const r = document.querySelector('[data-bonk-root]')
      r.setAttribute('data-pet-has-basin', '1')
      r.dataset.state = ''
      return true
    })()`)

    // ---- the host's audio contract ---------------------------------------
    section('audio contract (live /api/bonk-pet/tracks)')
    const audio = await cdp.eval(`(async () => {
      const r = await fetch('/api/bonk-pet/tracks', { cache: 'no-store' })
      const body = await r.json()
      return { ok: r.ok, status: r.status, dir: body.dir, tracks: body.tracks, effects: body.effects }
    })()`)
    check(
      'the tracks route answers with the new shape',
      audio.ok === true && Array.isArray(audio.tracks) && typeof audio.effects === 'object',
      `dir=${audio.dir}`,
    )
    check(
      'effects.knock resolves to the knock sound effect',
      audio.effects?.knock === '敲盆.mp3',
      `effects.knock=${JSON.stringify(audio.effects?.knock)}`,
    )
    check(
      'effects.clang resolves to the steel-pipe landing effect',
      audio.effects?.clang === '钢管落地.mp3',
      `effects.clang=${JSON.stringify(audio.effects?.clang)}`,
    )
    check(
      'the two effect files are NOT in the song rotation',
      !audio.tracks.includes('敲盆.mp3') && !audio.tracks.includes('钢管落地.mp3'),
      `tracks=[${audio.tracks.join(', ')}]`,
    )
    check(
      'the song is in the rotation',
      audio.tracks.includes('letmego.mp3'),
      `tracks=[${audio.tracks.join(', ')}]`,
    )

    // ---- every audio file really fetches AND really decodes --------------
    // A 200 with arbitrary bytes proves nothing; `decodeAudioData` only
    // resolves on bytes that are genuinely valid audio for this engine.
    section('audio decode (fetch + decodeAudioData)')
    const audioFiles = [
      ...(audio.tracks ?? []),
      ...Object.values(audio.effects ?? {}),
    ].filter((v, i, a) => typeof v === 'string' && a.indexOf(v) === i)
    const decoded = await cdp.eval(`(async () => {
      const names = ${JSON.stringify(audioFiles)}
      const Ctx = window.AudioContext || window.webkitAudioContext
      if (Ctx === undefined) return { supported: false, results: [] }
      const out = []
      for (const name of names) {
        const r = await fetch('/api/bonk-pet/asset?name=' + encodeURIComponent(name), { cache: 'no-store' })
        if (!r.ok) {
          out.push({ name, ok: false, status: r.status + ' ' + r.statusText })
          continue
        }
        const bytes = await r.arrayBuffer()
        const ctx = new Ctx()
        try {
          const buf = await ctx.decodeAudioData(bytes.slice(0))
          out.push({
            name,
            ok: true,
            status: r.status,
            contentType: r.headers.get('content-type'),
            bytes: bytes.byteLength,
            seconds: Math.round(buf.duration * 1000) / 1000,
            channels: buf.numberOfChannels,
            sampleRate: String(buf.sampleRate),
            frames: buf.length,
          })
        } catch (e) {
          out.push({ name, ok: false, status: r.status, bytes: bytes.byteLength, error: String(e) })
        } finally {
          try { ctx.close() } catch {}
        }
      }
      return { supported: true, results: out }
    })()`)
    check('the page exposes an AudioContext', decoded.supported === true)
    check(
      'every audio file is discoverable by the page',
      audioFiles.length === 3,
      `${audioFiles.length} file(s): ${audioFiles.join(', ')}`,
    )
    for (const one of decoded.results ?? []) {
      check(
        `decodeAudioData succeeds for ${one.name}`,
        one.ok === true && one.seconds > 0,
        one.ok === true
          ? `${one.contentType} ${one.bytes} bytes -> ${one.seconds}s ch=${one.channels} rate=${one.sampleRate} frames=${one.frames}`
          : `status=${one.status} ${one.error ?? ''}`,
      )
    }

    // ---- the live host -> browser wire -----------------------------------
    section('host relay')
    const subscribed = requestedUrls.some((u) => u.includes('/api/bonk-pet/events'))
    check('the browser subscribed to the host relay', subscribed === true)

    const assetOk = assetResponses.filter((r) => r.url.includes('/api/bonk-pet/asset'))
    const assetBad = assetOk.filter((r) => r.status !== 200)
    check(
      'every asset request was served with 200',
      assetOk.length > 0 && assetBad.length === 0,
      `${assetOk.length} response(s), ${assetBad.length} non-200${assetBad.length === 0 ? '' : ': ' + assetBad.map((r) => r.status + ' ' + r.url).join(' | ')}`,
    )

    // ---- CSS animations actually bind in a real engine --------------------
    // The unit suite runs against a stub DOM and cannot prove a keyframe is
    // parsed and attached; only a real engine can. Each check reads the
    // computed `animation-name` AND the engine's live animation list.
    section('animations in a real engine')
    const anims = await cdp.eval(`(() => {
      const root = document.querySelector('[data-bonk-root]')
      const whale = root.querySelector('[data-bonk-whale]')
      const pipe = root.querySelector('[data-bonk-pipe]')
      const live = () => (document.getAnimations ? document.getAnimations() : [])
        .map((a) => a.animationName).filter(Boolean)
      const before = root.dataset.state

      // --- bonk-fall: the exact attribute transition a failure performs.
      const pipeRest = getComputedStyle(pipe).animationName
      pipe.dataset.fall = '1'
      const fallComputed = getComputedStyle(pipe).animationName
      const fallLive = live()
      pipe.dataset.fall = '0'

      // --- bonk-sway: the singing state.
      root.dataset.state = 'sing'
      const swayComputed = getComputedStyle(whale).animationName
      const swayLive = live()
      const notesOpacity = getComputedStyle(root.querySelector('[data-bonk-notes]')).opacity
      root.dataset.state = before

      return {
        pipeRest, fallComputed, fallLive,
        swayComputed, swayLive, notesOpacity,
      }
    })()`)

    check(
      'bonk-fall binds when the pipe drops',
      anims.fallComputed.includes('bonk-fall') && anims.fallLive.some((n) => n.includes('bonk-fall')),
      `at-rest=${anims.pipeRest} falling=${anims.fallComputed} live=[${anims.fallLive.join(',')}]`,
    )
    check(
      'bonk-sway binds in the singing state',
      anims.swayComputed.includes('bonk-sway') && anims.swayLive.some((n) => n.includes('bonk-sway')),
      `computed=${anims.swayComputed} live=[${anims.swayLive.join(',')}] notes-opacity=${anims.notesOpacity}`,
    )

    // ---- the pet is still intact after the whole sweep -------------------
    section('final state')
    const finalState = await cdp.eval(`(() => {
      const root = document.querySelector('[data-bonk-root]')
      const whale = root.querySelector('[data-bonk-whale]')
      const r = root.getBoundingClientRect()
      return {
        mounted: document.body.contains(root),
        state: root.dataset.state,
        petImg: whale.querySelector('img[data-bonk-art="pet"]') !== null,
        petDecoded: (whale.querySelector('img[data-bonk-art="pet"]')?.naturalWidth ?? 0) > 0,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        inViewport: r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && r.x >= 0 && r.y >= 0,
      }
    })()`)
    check(
      'the pet survives the full interaction sweep',
      finalState.mounted === true && finalState.petImg === true && finalState.petDecoded === true,
      `state=${finalState.state} rect=${finalState.rect.w}x${finalState.rect.h}@${finalState.rect.x},${finalState.rect.y}`,
    )

    // ---- failure relay: every error kind must drop the pipe --------------
    // The four failure signals come from the harness and cannot be triggered on
    // demand, so the frame is delivered the way the host would deliver it — on
    // the very EventSource the plugin opened — and the reaction is observed.
    section('failure relay (all four error kinds)')
    const sources = await cdp.eval(`window.__bonkSources.length`)
    check('the plugin\'s own EventSource was captured', sources > 0, `${sources} source(s)`)

    const readReaction = () => cdp.eval(`(() => {
      const root = document.querySelector('[data-bonk-root]')
      const pipe = root.querySelector('[data-bonk-pipe]')
      const bubble = root.querySelector('[data-bonk-bubble]')
      return {
        state: root.dataset.state,
        fall: pipe.dataset.fall,
        says: bubble.dataset.show === '1' ? bubble.textContent : null,
      }
    })()`)

    const FRAMES = [
      { frame: { type: 'error', kind: 'tool', tool: 'pwsh', message: 'TOOL_TIMEOUT' }, expect: '工具 pwsh 挂了：TOOL_TIMEOUT' },
      { frame: { type: 'error', kind: 'request', provider: 'deepseek', message: 'rate limited' }, expect: 'deepseek 请求失败：rate limited' },
      { frame: { type: 'error', kind: 'session', message: 'credentials rejected' }, expect: '会话出错：credentials rejected' },
      { frame: { type: 'error', kind: 'turn', message: 'boom', where: '第 3 回合 · 第 7 步' }, expect: '回合失败（第 3 回合 · 第 7 步）：boom' },
    ]

    for (const { frame, expect } of FRAMES) {
      // Let any previous reaction fully clear first. Two things can hold the
      // pipe: `pipeBusy` while one is airborne, and the residual transient
      // state from an earlier interaction (the knock section runs just before
      // this one). Sampling too early reads the PREVIOUS bubble, which looks
      // like a wrong message but is really a race in the test.
      let clear = false
      for (let i = 0; i < 30; i += 1) {
        const now = await readReaction()
        if (now.state !== 'hit' && now.fall === '0') {
          clear = true
          break
        }
        await sleep(200)
      }
      check(`the pet is idle before the "${frame.kind}" failure`, clear === true)

      await cdp.eval(`(() => {
        const data = ${JSON.stringify(JSON.stringify(frame))}
        for (const es of window.__bonkSources) es.dispatchEvent(new MessageEvent('message', { data }))
        return true
      })()`)

      // Wait for the impact rather than guessing a delay: the pipe falls for
      // ~420ms and the line appears on landing.
      //
      // The assertion is on the MESSAGE, not on `data-state`. `hit` is a
      // transient that expires after STATE_MS.hit (1500ms); a poll that starts
      // late can catch the correct line after the state has already returned to
      // idle, which says nothing about whether the pipe fell. The line is
      // written at impact and held for 2400ms, so it is the durable evidence.
      // The state is still reported, for diagnosis.
      let impact = null
      for (let i = 0; i < 40; i += 1) {
        await sleep(120)
        const now = await readReaction()
        if (now.says === expect) {
          impact = now
          break
        }
        impact = now
      }
      check(
        `a "${frame.kind}" failure drops the pipe`,
        impact !== null && impact.says === expect,
        `state=${impact?.state} says=${JSON.stringify(impact?.says)}`,
      )

      // Let the bounce finish so the next frame is not rate-limited away.
      await sleep(1200)
    }

    check(
      'no uncaught page errors for the whole run',
      pageErrors.length === 0,
      pageErrors.length === 0 ? '0 exceptions' : pageErrors.slice(0, 3).join(' | '),
    )

    // ---- evidence: a real screenshot of the live shell --------------------
    // Taken at rest, after the transient knock state and its bubble have both
    // fallen back, so the frame shows the pet as a user would find it.
    section('screenshot')
    const settle = await cdp.eval(`(async () => {
      const root = document.querySelector('[data-bonk-root]')
      for (let i = 0; i < 40; i += 1) {
        if (root.dataset.state !== 'knock' && root.querySelector('[data-bonk-bubble]').dataset.show !== '1') break
        await new Promise((r) => setTimeout(r, 200))
      }
      return root.dataset.state
    })()`)
    mkdirSync(dirname(shotPath), { recursive: true })
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))
    check('the screenshot was captured', shot.data.length > 1000, `${shotPath} (${Math.round(shot.data.length / 1024)} KB) at rest=${settle}`)
  }
} catch (error) {
  check('harness ran', false, error.stack ?? error.message)
} finally {
  cleanup()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length > 0) {
  console.log('failures:')
  for (const one of failed) console.log(`  - ${one.name}  ::  ${one.detail ?? ''}`)
}
process.exit(failed.length === 0 ? 0 : 1)
