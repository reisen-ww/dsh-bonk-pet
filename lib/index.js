/**
 * Host half of dsh-bonk-pet.
 *
 * Watches the harness activity signals and relays them to the browser over
 * Server-Sent Events, so the floating pet can react in real time:
 *
 *   - `tools/result`  → one tool call failed (`result.isError === true`)
 *   - `agent/error`   → a step or turn errored
 *   - `agent/status`  → `running` (a task started) ⇄ `idle` (it stopped)
 *
 * It also serves the user's own audio files from `<dsh home>/bonk-pet/`, so a
 * song can be dropped in without rebuilding the plugin (the browser bundle has
 * no way to reference an external asset — `dsh.client` carries no static
 * directory field, and every shipped client plugin inlines its media instead).
 *
 * The relay is read-only and carries no credentials; only clipped, structured
 * `{type,kind,...}` frames are emitted, never transcript content or tool
 * arguments. The audio route serves exactly one directory and refuses
 * traversal.
 */

import { createReadStream, readFileSync } from 'node:fs'
import { mkdir, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Settings namespace owned by this plugin.
 *
 * DSH's Settings → Plugins tab enumerates every registered namespace and
 * renders a card for each; registering one is what makes the pet configurable
 * without editing files. Must match `NAMESPACE_PATTERN` in dsh-settings
 * (`/^[a-z][a-z0-9-]*$/`).
 */
export const SETTINGS_NAMESPACE = 'bonk-pet'

/**
 * Volume fields, all 0–1.
 *
 * Split rather than one master knob because the complaint that started this
 * was specific: the steel pipe is much louder than everything else. A single
 * slider would have forced turning the whole pet down to fix one sound.
 */
const VOLUME_FIELDS = ['music', 'pipe', 'knock']

/** Defaults, matching what the plugin shipped with before it was configurable. */
export const VOLUME_DEFAULTS = Object.freeze({ music: 0.65, pipe: 0.34, knock: 0.5 })

/**
 * Fallback volume used when the settings service is absent or its schema
 * cannot be built. The pet must still make sound on a host with no settings
 * provider, so every read degrades to these numbers rather than to silence.
 */
export function resolveVolumes(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const out = {}
  for (const field of VOLUME_FIELDS) {
    const value = source[field]
    const num = typeof value === 'number' && Number.isFinite(value) ? value : VOLUME_DEFAULTS[field]
    // Clamp here as well as in the schema: settings can be edited as raw YAML,
    // and Audio.volume throws on values outside 0–1.
    out[field] = Math.min(1, Math.max(0, num))
  }
  return out
}

/**
 * Leave a timestamped note when the plugin actually mounts.
 *
 * Purely diagnostic, and deliberately best-effort: a failed write must never
 * stop the pet from loading. It exists because "did the host pick up the
 * plugin?" is otherwise unanswerable from outside — the renderer fence answers
 * 403 identically whether a route exists or not, so the only trustworthy
 * evidence is the plugin's own word that it started.
 *
 * @param ctx - the plugin context; `logger` is used when available.
 */
async function recordMount(ctx) {
  const file = join(assetDir(), 'loaded.txt')
  const info = [
    `bonk-pet mounted at ${new Date().toISOString()}`,
    `pid ${process.pid}`,
    `node ${process.version}`,
    `exec ${process.execPath}`,
    `argv ${JSON.stringify(process.argv.slice(0, 4))}`,
  ].join('\n')
  try {
    await writeFile(file, info + '\n', 'utf8')
  } catch {
    // The directory may not exist yet or may be read-only; not our problem.
  }
  try {
    ctx.logger?.info?.('[bonk-pet] mounted')
  } catch {
    // A logger that throws must not take the plugin down with it.
  }
}

/**
 * Is `child` inside `parent` (or equal to it)?
 *
 * Compares path segments, not raw strings, so `/a/bc` is not treated as being
 * inside `/a/b`. Both arguments must already be absolute and normalised.
 */
function isInside(parent, child) {
  if (child === parent) return true
  return child.startsWith(parent.endsWith(sep) ? parent : parent + sep)
}

/** Stable Loader identity. */
export const name = 'bonk-pet'

const ROUTE_EVENTS = '/api/bonk-pet/events'
const ROUTE_TRACKS = '/api/bonk-pet/tracks'
const ROUTE_ASSET = '/api/bonk-pet/asset'
const ROUTE_SKIN = '/api/bonk-pet/skin'
/**
 * Current volume settings, so the pet picks up a slider change on its next
 * sound without re-reading the whole settings document.
 */
const ROUTE_VOLUME = '/api/bonk-pet/volume'

/** Keep-alive period; proxies and idle sockets drop silent streams. */
const KEEPALIVE_MS = 25_000

/**
 * Hard cap on a request body this plugin will read.
 *
 * The only write route takes three numbers, so 4KB is already generous. The
 * limit exists so an unbounded or hostile `POST` cannot make the host buffer
 * arbitrary memory: the body is collected chunk by chunk and the read is
 * abandoned the moment the running total exceeds this.
 */
const MAX_BODY_BYTES = 4096

/**
 * Read a request body into a string, refusing anything over `limit` bytes.
 *
 * @returns the decoded body, or `null` when it exceeded the limit or the
 *   stream errored — the caller answers 413 in both cases, which is the honest
 *   answer for a body we refused to finish reading.
 */
function readBody(request, limit) {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    let done = false
    const finish = (value) => {
      if (done) return
      done = true
      resolve(value)
    }
    request.on('data', (chunk) => {
      if (done) return
      size += chunk.length
      if (size > limit) {
        finish(null)
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => finish(Buffer.concat(chunks).toString('utf8')))
    request.on('error', () => finish(null))
    // A request that ends without ever emitting `end` (a client that vanished)
    // must not leave this promise pending forever.
    request.on('close', () => finish(null))
  })
}

/**
 * Bound the message we forward: the pet only ever shows a short caption, and an
 * unbounded provider error string would be both useless and a leak risk.
 */
const MAX_MESSAGE = 200

/**
 * Every file type the asset route may serve, by extension.
 *
 * Audio is what the pet sings; images are the optional user-supplied artwork
 * that replaces the drawn whale. One table and one route, because both are the
 * same job: hand the browser one guarded file out of the user's directory.
 */
const ASSET_TYPES = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.webm': 'audio/webm',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
}

/** Just the audio subset, used to decide what counts as a song. */
const AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.m4a',
  '.aac',
  '.ogg',
  '.oga',
  '.opus',
  '.wav',
  '.flac',
  '.webm',
])

/**
 * Sound-effect slots: a logical effect mapped to the file-name stems the user
 * may have used. The stem is matched against the audio files present, so any of
 * the accepted spellings works without renaming. A stem may be Chinese.
 */
const EFFECT_STEMS = {
  /** Played when the user knocks the basin. */
  knock: ['敲盆', 'bonk', 'knock'],
  /** Played at the moment the steel pipe lands. */
  clang: ['钢管落地', '钢管', 'clang', 'pipe'],
}

/**
 * The artwork slots the client can replace with the user's own images.
 *
 * `pet` is the character; the other three are props the client positions
 * itself (the basin the pet sits in, the pipe that falls on failure, the rice
 * of rice). Each slot is optional and independent: supplying only `pet.png`
 * keeps every drawn prop.
 */
const ART_SLOTS = ['pet', 'basin', 'pipe', 'rice']

/**
 * Extensions accepted for a slot, in preference order. A fixed list keeps the
 * contract trivial: drop `pet.png` in and it is used.
 */
const ART_EXTENSIONS = ['.png', '.webp', '.jpg', '.jpeg', '.gif', '.svg']

/**
 * Where the user drops their own audio and artwork. Honours `DSH_HOME` the way
 * the rest of the harness does, and falls back to `~/.dsh`.
 */
function assetDir() {
  const home = process.env.DSH_HOME?.trim()
  const base = home !== undefined && home.length > 0 ? home : join(homedir(), '.dsh')
  return join(base, 'bonk-pet')
}

function textOf(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message
  if (typeof value === 'object') {
    const message = value.message
    if (typeof message === 'string') return message
    const code = value.code
    if (typeof code === 'string') return code
  }
  try {
    return String(value)
  } catch {
    return ''
  }
}

function clip(value) {
  const text = textOf(value).replace(/\s+/g, ' ').trim()
  return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE)}…` : text
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  response.end(payload)
}

/**
 * List every audio file available, user directory first then bundled.
 *
 * The bundled directory exists so a fresh install is not silent. Only the two
 * small SOUND EFFECTS ship (the knock and the pipe clang, ~120KB together); the
 * song does not, because it is several megabytes and belongs to its author, so a
 * new user supplies their own music.
 *
 * User files shadow bundled ones by name, matching `findArt`.
 *
 * @returns a sorted array of file names (never paths).
 */
async function listAudioFiles() {
  const names = new Set()
  for (const dir of [assetDir(), bundledAssetDir()]) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      // A missing directory is the normal "nothing here" state.
      continue
    }
    for (const entry of entries) {
      if (entry.isFile() && AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        names.add(entry.name)
      }
    }
  }
  return [...names].sort()
}

/**
 * Split the audio files into songs and named sound effects.
 *
 * A file whose stem matches an effect alias is claimed by that effect and
 * removed from the song rotation — otherwise the crash of a falling pipe would
 * eventually be picked as background music.
 *
 * @returns `{ tracks, effects }`, where effects maps a name to a file name.
 */
async function listAudio() {
  const files = await listAudioFiles()
  const effects = {}
  const claimed = new Set()

  for (const [effect, stems] of Object.entries(EFFECT_STEMS)) {
    for (const stem of stems) {
      // Case-insensitive, matching how the extension check already behaves.
      // `Knock.mp3` on a case-insensitive filesystem should be the knock
      // sound, not background music. Chinese stems are unaffected.
      const wanted = stem.toLowerCase()
      const match = files.find((file) => {
        const base = file.slice(0, file.length - extname(file).length)
        return !claimed.has(file) && base.toLowerCase() === wanted
      })
      if (match !== undefined) {
        effects[effect] = match
        claimed.add(match)
        break
      }
    }
  }

  return { tracks: files.filter((file) => !claimed.has(file)), effects }
}

/**
 * Where the plugin's OWN artwork and audio live.
 *
 * These ship inside the package, and exist so a fresh install is not a blank
 * whale. Without them, everything below reads only the user's `~/.dsh/bonk-pet`
 * directory, so a stranger who installs this sees a pet with no picture and no
 * sound and reasonably concludes it is broken — every path the original code
 * took assumed the author's own machine.
 *
 * `import.meta.url` rather than `__dirname`: the host half is ESM, and a package
 * installed under a profile's `node_modules` may be a symlink, so the URL is the
 * only reliable anchor to the package root.
 */
function bundledAssetDir() {
  return fileURLToPath(new URL('../assets', import.meta.url))
}

/**
 * Find whichever artwork files the user supplied.
 *
 * Each slot is independent: the caller gets back only the slots that exist, so
 * a user can replace just the character and keep every drawn prop.
 *
 * The user's own files ALWAYS win; the bundled set only fills gaps.
 *
 * @returns an object mapping slot name to `{ name, type }`.
 */
async function findArt() {
  // `assetDir()` first so a user's `pet.png` beats the shipped one. Order
  // matters: this is the whole reason the bundled set is a fallback and not a
  // default.
  const dirs = [assetDir(), bundledAssetDir()]

  const found = {}
  for (const dir of dirs) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      // A missing directory is the normal "nothing here" state.
      continue
    }

    // One directory read instead of 24 sequential `stat` calls, and the first
    // accepted extension per slot wins (ART_EXTENSIONS is in preference order).
    const present = new Set(entries.filter((e) => e.isFile()).map((e) => e.name))

    for (const slot of ART_SLOTS) {
      // Already satisfied by a higher-priority directory.
      if (found[slot] !== undefined) continue
      for (const ext of ART_EXTENSIONS) {
        const name = `${slot}${ext}`
        if (present.has(name)) {
          found[slot] = { name, type: ASSET_TYPES[ext], bundled: dir !== assetDir() }
          break
        }
      }
    }
  }
  return found
}

/**
 * Reject anything that is not a plain file name.
 *
 * Shared by every asset read: no separators, no parent segments, no dotfiles,
 * no null bytes, and a hard length cap.
 *
 * @returns null when the name is acceptable, else a short reason.
 */
function rejectName(name) {
  if (typeof name !== 'string' || name.length === 0) return 'missing name'
  if (name.length > 128) return 'name too long'
  if (name.includes('/') || name.includes('\\')) return 'separator in name'
  if (name.includes('\0')) return 'null byte in name'
  if (name.includes('..')) return 'parent segment in name'
  if (name.startsWith('.')) return 'hidden file'
  return null
}

/**
 * Stream one file out of the asset directory.
 *
 * The directory is the only thing this ever reads: the resolved path must land
 * exactly where joining the raw name would, which rejects traversal, symlink
 * escapes and Windows drive-letter tricks before any I/O happens.
 */
async function streamAsset(request, response) {
  const url = new URL(request.url ?? '/', 'http://bonk.invalid')
  const name = url.searchParams.get('name') ?? ''

  const reason = rejectName(name)
  if (reason !== null) {
    sendJson(response, 400, { error: reason })
    return
  }

  // The extension check happens BEFORE the directory loop, because it does not
  // depend on which directory is being tried. Folding it into the loop turned
  // "unsupported type" (415) into "not found" (404) for any unrecognised
  // extension, which is a different and less useful answer.
  const type = ASSET_TYPES[extname(name).toLowerCase()]
  if (type === undefined) {
    sendJson(response, 415, { error: 'unsupported type' })
    return
  }

  const candidates = [assetDir(), bundledAssetDir()]
  for (const dir of candidates) {
    const resolvedDir = resolve(dir)
    const file = resolve(join(resolvedDir, normalize(name)))
    // Cheap string guard first: catches `..` and absolute-name tricks before
    // touching the filesystem. Note `join`/`resolve` normalise, so comparing the
    // result against a re-join would always be equal and prove nothing.
    if (!isInside(resolvedDir, file)) continue

    // String containment is NOT enough: a symlink inside the directory points
    // anywhere while its path still starts with `dir`. Resolve the real path and
    // re-check, so the guard actually means what it claims.
    //
    // The bundled directory is checked the same way, not exempted. "These are
    // our own files" is exactly the assumption that turns a fallback path into a
    // traversal hole.
    const real = await realpath(file).catch(() => null)
    const realDir = await realpath(resolvedDir).catch(() => null)
    if (real === null || realDir === null || !isInside(realDir, real)) continue

    const info = await stat(real).catch(() => null)
    if (info === null || !info.isFile()) continue

    response.writeHead(200, {
      'content-type': type,
      'content-length': info.size,
      'cache-control': 'no-store',
      'accept-ranges': 'none',
    })
    const stream = createReadStream(real)
    stream.on('error', () => {
      try {
        response.destroy()
      } catch {
        // already gone
      }
    })
    // If the client goes away mid-download (a skipped track, a closed tab), stop
    // reading: without this the whole file is still pulled off disk for nobody.
    response.on('close', () => {
      stream.destroy()
    })
    stream.pipe(response)
    return
  }

  // Neither directory had it. This MUST send something: the old code returned
  // after each failure branch, but the loop `continue`s instead, so without this
  // a missing file would leave the response open forever and the browser would
  // hang instead of falling back to its drawn art.
  sendJson(response, 404, { error: 'not found' })
}

export function apply(ctx) {
  /** Connected SSE responses. */
  const listeners = new Set()

  // Best-effort mount receipt; never awaited, never fatal.
  void recordMount(ctx)

  /**
   * Live volume settings, read by the browser half through `ROUTE_VOLUME`.
   *
   * PERSISTED to `<dsh home>/bonk-pet/volume.json`. It used to be a plain
   * module-level object with a comment claiming it was "the single stored
   * copy", which was wrong in the way that matters: the host process is
   * restarted with DSH, so every value the user set was discarded on restart
   * and the sliders came back at their defaults. The browser's `localStorage`
   * copy hid this — it kept the right number on screen while the host served
   * the old one back.
   *
   * Loading is synchronous on purpose. The route can be hit immediately after
   * mount, and an async load would race it: the first GET would answer with
   * defaults and the client would cache those.
   */
  const volumeFile = join(assetDir(), 'volume.json')

  function loadStoredVolumes() {
    try {
      const text = readFileSync(volumeFile, 'utf8')
      return resolveVolumes(JSON.parse(text))
    } catch {
      // Absent or unreadable is the normal first-run state, and a corrupt file
      // must not stop the pet from loading.
      return { ...VOLUME_DEFAULTS }
    }
  }

  function saveVolumes(next) {
    // Best-effort: a read-only profile still gets working sliders for this
    // session, it just cannot remember them.
    //
    // `mkdir` is not optional. On a fresh install `~/.dsh/bonk-pet` does not
    // exist yet — the directory is created by the user dropping in their own
    // audio or artwork, which may never happen. `writeFile` then failed with
    // ENOENT, the rejection was swallowed by the `catch`, and every volume the
    // user set was lost on the next DSH restart while the sliders kept showing
    // the right number from `localStorage`. Creating the directory first is what
    // makes the persistence real.
    void mkdir(assetDir(), { recursive: true })
      .then(() => writeFile(volumeFile, `${JSON.stringify(next, null, 2)}\n`, 'utf8'))
      .catch(() => {})
  }

  let volumes = loadStoredVolumes()

  // Volumes are owned by this plugin now, not by DSH's settings document.
  //
  // The old code registered a schemastery schema through
  // `ctx.inject(['settings'], …)` → `settings.register(ns, schema)`. The
  // current kernel's `SettingsForms` has no `register` method at all, so that
  // call threw a TypeError which the surrounding `try` swallowed — the card
  // silently vanished and the sliders became inert. The card is contributed by
  // the client half into the `settings.section` slot instead, and the values
  // round-trip through ROUTE_VOLUME below.

  /**
   * The most recent activity frame, replayed to every new subscriber.
   *
   * A dropped relay would otherwise leave the client stuck on whatever it last
   * heard — if a task is still running when the connection is re-established,
   * the `running` event is long past and the pet would stay silent until the
   * next transition. Replaying the current status closes that window.
   */
  let lastStatus = null

  const broadcast = (payload) => {
    if (payload?.type === 'status') lastStatus = payload
    if (listeners.size === 0) return
    const frame = `data: ${JSON.stringify(payload)}\n\n`
    for (const response of listeners) {
      try {
        response.write(frame)
      } catch {
        listeners.delete(response)
      }
    }
  }

  /** Write one frame to a single response, tolerating a dead socket. */
  const send = (response, payload) => {
    try {
      response.write(`data: ${JSON.stringify(payload)}\n\n`)
      return true
    } catch {
      return false
    }
  }

  // --- Signal 1: a single tool call failed. ---------------------------------
  // `tools/result` is observation-only and fires for every call; `isError` is
  // the failure marker (a nonzero background exit is NOT a tool failure).
  ctx.on('tools/result', (exec, result) => {
    try {
      if (result?.isError !== true) return
      // The real shape from `dsh-tools` is `error: { message, info? }`, where
      // `info` is `{ name, code }` and is present only for a HarnessError
      // (dsh-tools `toolErrorResult` / `errorInfo`). Reading `error.code`
      // directly — as this used to — always missed, so EVERY tool failure fell
      // through to the generic caption and signal #1 carried no information.
      // Prefer the code (short, greppable), then the name, then the message
      // (which is what a guard denial or a plain thrown Error provides).
      const error = result?.error
      const detail =
        error?.info?.code ??
        error?.info?.name ??
        error?.message ??
        error?.code ??
        error?.name ??
        '工具执行失败'
      broadcast({
        type: 'error',
        kind: 'tool',
        tool: clip(exec?.name) || 'tool',
        message: clip(detail),
        at: Date.now(),
      })
    } catch {
      // A listener must never break the tool pipeline.
    }
  })

  // --- Signal 2: a step or turn errored. ------------------------------------
  ctx.on('agent/error', (payload) => {
    try {
      // `turn` / `step` are part of the payload, so the bubble can say where
      // it broke instead of a bare "failed".
      const where = []
      if (typeof payload?.turn === 'number') where.push(`第 ${payload.turn} 回合`)
      if (typeof payload?.step === 'number') where.push(`第 ${payload.step} 步`)
      broadcast({
        type: 'error',
        kind: 'turn',
        message: clip(payload?.error) || '回合失败',
        where: where.length > 0 ? where.join(' · ') : undefined,
        at: Date.now(),
      })
    } catch {
      // Contained by contract; never surface into the agent loop.
    }
  })

  // --- Signal 2b: a model request failed and may be retried. ----------------
  // This is the signal a bare `agent/error` misses: a provider hiccup that the
  // loop retries never reaches `agent/error`, so without this the pet would sit
  // through repeated failures looking pleased with itself.
  //
  // CRITICAL: this is a *waterfall*. `@deepseek-ai/dsh-llm-retry` listens on the
  // same event to decide whether to retry, and it continues the chain by calling
  // `next()`. A listener that returns without doing so would silently disable
  // retries. So: observe only, then hand the chain straight on. Returning an
  // action here would change retry behaviour, which is not this plugin's job.
  ctx.on('agent/request-error', (payload, next) => {
    try {
      broadcast({
        type: 'error',
        kind: 'request',
        provider: clip(payload?.provider) || '模型',
        // `failure` is an LlmFailure: `message`/`code` are the useful parts.
        message:
          clip(payload?.failure?.message ?? payload?.failure?.code ?? payload?.failure) ||
          '模型请求失败',
        at: Date.now(),
      })
    } catch {
      // Never break the retry chain.
    }
    // Always continue: the retry policy is somebody else's decision.
    return typeof next === 'function' ? next() : undefined
  })

  // --- Signal 2c: an agent failed outside a durable turn position. ----------
  // Signature is positional: `(sessionId, message)`, not an object.
  ctx.on('api-session/error', (sessionId, message) => {
    try {
      broadcast({
        type: 'error',
        kind: 'session',
        message: clip(message) || '会话失败',
        at: Date.now(),
      })
    } catch {
      // Contained.
    }
  })

  // --- Signal 3: work started or stopped. -----------------------------------
  // `agent/status` is the idle ⇄ running transition, and `running` is what
  // starts the pet singing.
  //
  // The event fires per agent, so a naive last-writer-wins would stop the song
  // the moment any child agent finished while the main one was still working.
  // Track which agents are running and only report the aggregate transition.
  const runningAgents = new Set()

  /**
   * Identify the agent an event is about.
   *
   * @returns a stable key, or null when the payload carries no usable identity
   *   — in which case the event cannot take part in the aggregate, because an
   *   unidentified `running` could never be matched by a later `idle` and would
   *   leave the pet singing forever.
   */
  const agentKey = (payload) => {
    const agent = payload?.agent
    if (typeof agent === 'string' && agent.length > 0) return agent
    if (agent === null || agent === undefined) return null
    if (typeof agent.id === 'string' && agent.id.length > 0) return agent.id
    if (typeof agent.name === 'string' && agent.name.length > 0) return agent.name
    return null
  }

  ctx.on('agent/status', (payload) => {
    try {
      const status = payload?.status
      if (status !== 'running' && status !== 'idle') return
      const key = agentKey(payload)

      // No identity to track: forward it as-is rather than guess, so a
      // payload shape we do not recognise degrades to the simple behaviour
      // instead of wedging the aggregate.
      if (key === null) {
        broadcast({ type: 'status', status, at: Date.now() })
        return
      }

      const wasBusy = runningAgents.size > 0
      if (status === 'running') runningAgents.add(key)
      else runningAgents.delete(key)

      const busy = runningAgents.size > 0
      // Only the aggregate transition is worth sending; per-agent churn while
      // something is still running would make the pet start and stop singing.
      if (busy !== wasBusy) {
        broadcast({ type: 'status', status: busy ? 'running' : 'idle', at: Date.now() })
      }
    } catch {
      // Never surface into the agent loop.
    }
  })

  // --- Routes. --------------------------------------------------------------
  ctx.inject(['webServer'], (scoped) => {
    scoped.effect(
      () =>
        scoped.webServer.register({
          kind: 'exact',
          path: ROUTE_EVENTS,
          handler: (request, response) => {
            try {
              response.writeHead(200, {
                'content-type': 'text/event-stream; charset=utf-8',
                'cache-control': 'no-store, no-transform',
                connection: 'keep-alive',
                'x-accel-buffering': 'no',
              })
              // Comment frame: flushes headers so the client's `open` fires now.
              response.write(': bonk-pet ready\n\n')
            } catch {
              // The socket died before we could greet it; nothing to clean up.
              return
            }
            listeners.add(response)

            // Replay the current status so a client that reconnects mid-task
            // learns the pet should already be singing.
            if (lastStatus !== null) send(response, lastStatus)

            const keepalive = setInterval(() => {
              try {
                response.write(': ka\n\n')
              } catch {
                clearInterval(keepalive)
                listeners.delete(response)
              }
            }, KEEPALIVE_MS)

            const close = () => {
              clearInterval(keepalive)
              listeners.delete(response)
            }
            request.on('close', close)
            request.on('error', close)
          },
        }),
      'bonk-pet: activity relay route',
    )

    // Lists the user's audio: the songs it may sing, and the named effects.
    scoped.effect(
      () =>
        scoped.webServer.register({
          kind: 'exact',
          path: ROUTE_TRACKS,
          handler: async (_request, response) => {
            try {
              const { tracks, effects } = await listAudio()
              sendJson(response, 200, { dir: assetDir(), tracks, effects })
            } catch {
              sendJson(response, 200, { dir: assetDir(), tracks: [], effects: {} })
            }
          },
        }),
      'bonk-pet: audio listing route',
    )

    // Streams exactly one audio file out of the asset directory.
    scoped.effect(
      () =>
        scoped.webServer.register({
          kind: 'exact',
          path: ROUTE_ASSET,
          handler: async (request, response) => {
            try {
              await streamAsset(request, response)
            } catch {
              try {
                sendJson(response, 500, { error: 'failed' })
              } catch {
                // headers already sent
              }
            }
          },
        }),
      'bonk-pet: asset route',
    )

    // Reports which artwork slots the user supplied. The client asks once on
    // mount; an absent file is the normal state for every slot, not an error.
    scoped.effect(
      () =>
        scoped.webServer.register({
          kind: 'exact',
          path: ROUTE_SKIN,
          handler: async (_request, response) => {
            try {
              sendJson(response, 200, {
                slots: await findArt(),
                dir: assetDir(),
                accepted: ART_SLOTS.flatMap((slot) => ART_EXTENSIONS.map((ext) => slot + ext)),
              })
            } catch {
              sendJson(response, 200, { slots: {}, dir: assetDir(), accepted: [] })
            }
          },
        }),
      'bonk-pet: artwork probe route',
    )

    // Volume. GET reports the current levels; POST is the one write path, used
    // by the sliders in Settings → Plugins. The browser keeps its own copy in
    // localStorage and applies it locally first, so a failed POST costs the
    // user nothing beyond this host's copy being stale.
    scoped.effect(
      () =>
        scoped.webServer.register({
          kind: 'exact',
          path: ROUTE_VOLUME,
          handler: async (request, response) => {
            if (request.method === 'POST' || request.method === 'PUT') {
              const raw = await readBody(request, MAX_BODY_BYTES).catch(() => null)
              if (raw === null) {
                sendJson(response, 413, { ok: false, error: 'body too large' })
                return
              }
              let parsed
              try {
                parsed = JSON.parse(raw)
              } catch {
                sendJson(response, 400, { ok: false, error: 'invalid JSON' })
                return
              }
              if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                sendJson(response, 400, { ok: false, error: 'expected an object' })
                return
              }
              // Normalised through the same helper the reads use, so anything
              // the browser sends gets clamped into 0–1 and missing fields fall
              // back to the defaults rather than to `undefined`.
              volumes = resolveVolumes(parsed)
              saveVolumes(volumes)
              sendJson(response, 200, { ok: true, volumes })
              return
            }
            sendJson(response, 200, volumes)
          },
        }),
      'bonk-pet: volume route',
    )
  })

  // Drop every stream when the plugin unloads.
  ctx.effect(() => () => {
    for (const response of listeners) {
      try {
        response.end()
      } catch {
        // already gone
      }
    }
    listeners.clear()
  }, 'bonk-pet: relay teardown')
}
