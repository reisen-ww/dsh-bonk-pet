/**
 * Minimal DOM/browser harness for exercising the client half of dsh-bonk-pet
 * under plain Node. It implements only what lib/client.js actually touches, so
 * the plugin can be smoke-tested without a browser or a running DSH.
 *
 * It is intentionally small: a real HTML parser is out of scope. `innerHTML`
 * is scanned for `data-bonk-*` attributes and each hit becomes a stub element,
 * which is enough for the plugin's `querySelector` lookups and event wiring.
 */

class StubClassList {
  constructor() {
    this.set = new Set()
  }
  add(...names) {
    for (const name of names) this.set.add(name)
  }
  remove(...names) {
    for (const name of names) this.set.delete(name)
  }
  contains(name) {
    return this.set.has(name)
  }
}

class StubElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase()
    this.ownerDocument = ownerDocument
    this.attributes = new Map()
    // `dataset` is a live view over the `data-*` attributes, exactly as in the
    // real DOM, so `hasAttribute('data-x')` and `dataset.x` never disagree.
    const self = this
    this.dataset = new Proxy(
      {},
      {
        get(_target, prop) {
          if (typeof prop !== 'string') return undefined
          return self.attributes.get(dataAttribute(prop))
        },
        set(_target, prop, value) {
          self.attributes.set(dataAttribute(prop), String(value))
          return true
        },
        has(_target, prop) {
          return typeof prop === 'string' && self.attributes.has(dataAttribute(prop))
        },
        deleteProperty(_target, prop) {
          return typeof prop === 'string' && self.attributes.delete(dataAttribute(prop))
        },
        ownKeys() {
          return [...self.attributes.keys()]
            .filter((key) => key.startsWith('data-'))
            .map((key) => camel(key.slice(5)))
        },
        getOwnPropertyDescriptor(_target, prop) {
          if (typeof prop !== 'string') return undefined
          const name = dataAttribute(prop)
          if (!self.attributes.has(name)) return undefined
          return { value: self.attributes.get(name), enumerable: true, configurable: true }
        },
      },
    )
    this.style = makeStubStyle()
    this.children = []
    this.parentElement = null
    this.textContent = ''
    this._listeners = new Map()
    this._innerHTML = ''
    this.classList = new StubClassList()
    this.tabIndex = -1
    this.id = ''
  }

  get innerHTML() {
    return this._innerHTML
  }

  set innerHTML(html) {
    this._innerHTML = String(html)
    this.children = []
    // Create a stub child per data-bonk-* attribute occurrence, preserving the
    // first-seen order so nested lookups behave predictably.
    const seen = new Set()
    // Capture the full attribute suffix so `data-bonk-meter` yields
    // `dataset.bonkMeter`, matching the real DOM round-trip.
    const re = /data-([a-z][a-z-]*)/g
    let match
    while ((match = re.exec(this._innerHTML)) !== null) {
      const key = match[1]
      if (seen.has(key)) continue
      seen.add(key)
      const child = new StubElement('div', this.ownerDocument)
      child.dataset[camel(key)] = ''
      child.parentElement = this
      this.children.push(child)
    }
    // The hunger meter hosts a bare <i> fill element; attach it to the meter
    // rather than to this container so `meter.querySelector('i')` resolves.
    if (this._innerHTML.includes('<i>')) {
      const host = this.querySelector('[data-bonk-meter]') ?? this
      const fill = new StubElement('i', this.ownerDocument)
      fill.parentElement = host
      host.children.push(fill)
    }
  }

  /** Read by the plugin to restart a CSS animation on rapid re-fire. */
  get offsetWidth() {
    return 150
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value))
  }
  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null
  }
  removeAttribute(name) {
    this.attributes.delete(name)
  }
  hasAttribute(name) {
    return this.attributes.has(name)
  }

  appendChild(node) {
    node.parentElement = this
    this.children.push(node)
    return node
  }
  append(...nodes) {
    for (const node of nodes) this.appendChild(node)
  }
  prepend(...nodes) {
    for (const node of nodes.reverse()) {
      node.parentElement = this
      this.children.unshift(node)
    }
  }
  remove() {
    if (this.parentElement === null) return
    const index = this.parentElement.children.indexOf(this)
    if (index >= 0) this.parentElement.children.splice(index, 1)
    this.parentElement = null
  }

  addEventListener(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, [])
    this._listeners.get(type).push(handler)
  }
  removeEventListener(type, handler) {
    const list = this._listeners.get(type)
    if (list === undefined) return
    const index = list.indexOf(handler)
    if (index >= 0) list.splice(index, 1)
  }

  /** Test hook: fire an event at this element. */
  dispatch(type, event = {}) {
    const payload = {
      type,
      target: this,
      currentTarget: this,
      preventDefault() {},
      stopPropagation() {},
      ...event,
    }
    for (const handler of this._listeners.get(type) ?? []) handler(payload)
    return payload
  }

  closest(selector) {
    let node = this
    while (node !== null) {
      if (matches(node, selector)) return node
      node = node.parentElement
    }
    return null
  }

  /** Depth-first search over stub children. */
  querySelector(selector) {
    for (const child of this.children) {
      if (matches(child, selector)) return child
      const found = child.querySelector(selector)
      if (found !== null) return found
    }
    return null
  }
  querySelectorAll(selector) {
    const out = []
    for (const child of this.children) {
      if (matches(child, selector)) out.push(child)
      out.push(...child.querySelectorAll(selector))
    }
    return out
  }

  getBoundingClientRect() {
    return { left: 100, top: 100, right: 250, bottom: 250, width: 150, height: 150 }
  }
  setPointerCapture() {}
  releasePointerCapture() {}
  focus() {}
}

function camel(key) {
  return key.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())
}

/** camelCase property name back to its `data-*` attribute name. */
function dataAttribute(prop) {
  return `data-${prop.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)}`
}

/** Support the attribute and tag[attribute] selectors the plugin uses. */
function matches(element, selector) {
  const trimmed = selector.trim()

  // tag[attr] / tag[attr=value]
  const compound = /^([a-zA-Z][\w-]*)?(\[[^\]]+\])$/.exec(trimmed)
  if (compound !== null) {
    const [, tag, attribute] = compound
    if (tag !== undefined && element.tagName !== tag.toUpperCase()) return false
    return matchesAttribute(element, attribute)
  }
  if (trimmed.startsWith('[')) return matchesAttribute(element, trimmed)
  return element.tagName === trimmed.toUpperCase()
}

function matchesAttribute(element, attribute) {
  const body = attribute.slice(1, -1)
  const eq = body.indexOf('=')
  if (eq === -1) return element.hasAttribute(body)
  const name = body.slice(0, eq)
  const value = body.slice(eq + 1).replace(/^["']|["']$/g, '')
  if (name.startsWith('data-')) {
    return element.dataset[camel(name.slice(5))] === value
  }
  return element.getAttribute(name) === value
}

function makeStubStyle() {
  const props = new Map()
  return {
    setProperty(name, value) {
      props.set(name, value)
    },
    removeProperty(name) {
      props.delete(name)
    },
    getPropertyValue(name) {
      return props.get(name) ?? ''
    },
    get _props() {
      return props
    },
  }
}

/**
 * Build a fake browser global set and install it on globalThis.
 * @returns helpers for driving the plugin from a test.
 */
export function installHarness() {
  const document = new StubElement('#document', null)
  document.ownerDocument = document
  document.head = new StubElement('head', document)
  document.body = new StubElement('body', document)
  document.documentElement = new StubElement('html', document)
  document.createElement = (tag) => new StubElement(tag, document)

  const appendedStyles = []
  const originalHeadAppend = document.head.appendChild.bind(document.head)
  document.head.appendChild = (node) => {
    if (node.tagName === 'STYLE') appendedStyles.push(node)
    return originalHeadAppend(node)
  }

  // The plugin queries the document both for its own root and for its
  // already-injected stylesheet tag.
  document.querySelector = (selector) => {
    if (selector === '[data-bonk-root]') {
      return document.body.querySelector('[data-bonk-root]')
    }
    return document.head.querySelector(selector)
  }
  document.querySelectorAll = (selector) => document.head.querySelectorAll(selector)

  const store = new Map()
  const localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  }

  /** Captured EventSource instances so a test can push a failure frame. */
  const sources = []

  class FakeEventSource {
    constructor(url) {
      this.url = url
      this.closed = false
      this._listeners = new Map()
      sources.push(this)
    }
    addEventListener(type, handler) {
      if (!this._listeners.has(type)) this._listeners.set(type, [])
      this._listeners.get(type).push(handler)
    }
    close() {
      this.closed = true
    }
    /** Test hook: deliver one SSE frame. */
    emit(type, data) {
      for (const handler of this._listeners.get(type) ?? []) {
        handler({ type, data: JSON.stringify(data) })
      }
    }
    /** Test hook: simulate the relay dropping the connection. */
    dispatchError() {
      for (const handler of this._listeners.get('error') ?? []) handler({ type: 'error' })
    }
  }

  /** Captured Audio elements, so a test can assert play/pause behaviour. */
  const audio = []

  class FakeAudio {
    constructor(src) {
      this.src = src ?? ''
      this.loop = false
      this.preload = 'auto'
      this.volume = 1
      this.paused = true
      this.playCalls = 0
      this.pauseCalls = 0
      /**
       * Mirrors HTMLMediaElement.readyState. 0 means no metadata has loaded —
       * which is what an autoplay refusal looks like, since the policy rejects
       * before any bytes are fetched. Tests set it to 1+ to simulate a file
       * that loaded and then failed to decode.
       */
      this.readyState = 0
      /**
       * Mirrors HTMLMediaElement.error. A real browser sets this to a
       * MediaError for a decode/format failure and leaves it null for an
       * autoplay refusal, which is how the client tells the two apart.
       * Use `failWith(code)` to model one.
       */
      this.error = null
      // Mirrors a browser that grants playback.
      this.playResult = Promise.resolve()
      audio.push(this)
    }

    /**
     * Model a playback failure the way a browser would.
     *
     * @param code - MediaError code (3 = decode, 4 = src not supported), or 0
     *   for an autoplay refusal, which leaves `error` null.
     */
    failWith(code) {
      this.error = code === 0 ? null : { code }
      this.playResult = Promise.reject(new Error(`MediaError ${code}`))
      return this
    }
    play() {
      this.playCalls += 1
      this.paused = false
      return this.playResult
    }
    pause() {
      this.pauseCalls += 1
      this.paused = true
    }
    removeAttribute(name) {
      if (name === 'src') this.src = ''
    }
  }

  /** Records every fetch the plugin makes; tests answer them. */
  const requests = []
  const responses = new Map()

  async function fakeFetch(url, init) {
    requests.push({ url: String(url), init })
    const key = String(url)
    const handler = responses.get(key)
    if (handler === undefined) {
      return { ok: false, status: 404, async json() { return {} } }
    }
    return handler(url, init)
  }

  const registry = new Map()
  const window = {
    __ModuleLoader__: {
      load({ id, factory }) {
        registry.set(id, factory)
        return factory
      },
    },
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true
    },
    localStorage,
    EventSource: FakeEventSource,
  }

  const timers = new Set()
  const originalSetTimeout = globalThis.setTimeout
  const originalSetInterval = globalThis.setInterval
  const originalClearTimeout = globalThis.clearTimeout
  const originalClearInterval = globalThis.clearInterval

  globalThis.window = window
  globalThis.document = document
  globalThis.localStorage = localStorage
  globalThis.EventSource = FakeEventSource
  globalThis.Audio = FakeAudio
  globalThis.fetch = fakeFetch
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init) {
      this.type = type
      this.detail = init?.detail
    }
  }

  return {
    document,
    window,
    registry,
    sources,
    audio,
    requests,
    localStorage,
    store,
    appendedStyles,
    /** Answer a fetch made by the plugin. */
    respond(url, handler) {
      responses.set(url, handler)
    },
    /** Convenience: answer the track listing with these file names. */
    tracks(names) {
      responses.set('/api/bonk-pet/tracks', async () => ({
        ok: true,
        status: 200,
        async json() {
          return { dir: '/tmp/bonk-pet', tracks: names, effects: {} }
        },
      }))
    },
    /** Convenience: answer the artwork probe with these slots. */
    art(slots) {
      responses.set('/api/bonk-pet/skin', async () => ({
        ok: true,
        status: 200,
        async json() {
          return { slots, dir: '/tmp/bonk-pet', accepted: [] }
        },
      }))
    },
    /** Run every pending timer immediately (drain the plugin's schedule). */
    async flush(rounds = 6) {
      for (let i = 0; i < rounds; i += 1) {
        await Promise.resolve()
      }
    },
    restore() {
      globalThis.setTimeout = originalSetTimeout
      globalThis.setInterval = originalSetInterval
      globalThis.clearTimeout = originalClearTimeout
      globalThis.clearInterval = originalClearInterval
      delete globalThis.window
      delete globalThis.document
      delete globalThis.localStorage
      delete globalThis.EventSource
      delete globalThis.Audio
      delete globalThis.fetch
      delete globalThis.CustomEvent
    },
  }
}

export { StubElement }
