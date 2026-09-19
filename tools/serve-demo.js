/**
 * Stand-alone preview server: the plugin's real client bundle, driven by the
 * user's real files, without DSH.
 *
 * Why this exists: installing into a profile needs a DSH restart, and the
 * demo page alone shows only the drawn artwork. This serves the SAME routes
 * the host half registers — tracks, skin, asset — off the real asset
 * directory, so the pet renders from `pet.png` / `pipe.png` / `rice.png` and
 * plays the real audio. What you see here is what the plugin will do; the only
 * thing missing is the harness feeding it live events.
 *
 * It is a PREVIEW, not a second plugin host. The routes below are a HAND COPY
 * of the host half's, not an import — an earlier version of this comment
 * claimed the two "cannot drift apart", which was simply false: this file
 * imports nothing from `lib/index.js`. It has in fact drifted, and knowingly:
 *
 *   - no `realpath` re-check, so a symlink inside the asset directory IS
 *     served here while the real host refuses it (the host's guard is the one
 *     that matters; do not use this preview to validate that guarantee);
 *   - unknown extensions fall back to `application/octet-stream` instead of
 *     the host's 415;
 *   - `/skin` returns `{ name }` without `type`, and `accepted: []`.
 *
 * Those differences are acceptable for a preview whose job is "does the pet
 * look and behave right with MY files". They are NOT acceptable to leave
 * undocumented, because a green run here has twice been mistaken for proof
 * about the real server.
 *
 * Run: node tools/serve-demo.js [port]
 */

import { createServer } from 'node:http'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, join, resolve } from 'node:path'

const port = Number(process.argv[2] ?? 43900)
const root = resolve(import.meta.dirname, '..')
const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const assets = process.env.BONK_ASSET_DIR ?? join(home, 'bonk-pet')

/** MIME types for the files this preview may serve. */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
}

const AUDIO = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.flac', '.webm'])
const ART_SLOTS = ['pet', 'basin', 'pipe', 'rice']
const ART_EXT = ['.png', '.webp', '.jpg', '.jpeg', '.gif', '.svg']

/** Sound-effect stems, matching the host half's table. */
const EFFECTS = {
  knock: ['敲盆', 'bonk', 'knock'],
  clang: ['钢管落地', '钢管', 'clang', 'pipe'],
}

/**
 * Read the asset directory the same way the host half does.
 * @returns `{ tracks, effects }`.
 */
function listAudio() {
  let names
  try {
    names = readdirSync(assets).filter((n) => statSync(join(assets, n)).isFile())
  } catch {
    return { tracks: [], effects: {} }
  }
  const audio = names.filter((n) => AUDIO.has(extname(n).toLowerCase())).sort()
  const effects = {}
  const claimed = new Set()
  for (const [effect, stems] of Object.entries(EFFECTS)) {
    for (const stem of stems) {
      const hit = audio.find((f) => {
        const base = f.slice(0, f.length - extname(f).length)
        return !claimed.has(f) && base.toLowerCase() === stem.toLowerCase()
      })
      if (hit !== undefined) {
        effects[effect] = hit
        claimed.add(hit)
        break
      }
    }
  }
  return { tracks: audio.filter((f) => !claimed.has(f)), effects }
}

/** Which artwork slots exist. */
function findArt() {
  const slots = {}
  for (const slot of ART_SLOTS) {
    for (const ext of ART_EXT) {
      try {
        if (statSync(join(assets, `${slot}${ext}`)).isFile()) {
          slots[slot] = { name: `${slot}${ext}` }
          break
        }
      } catch {
        // not present
      }
    }
  }
  return slots
}

function send(res, code, body, type) {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://preview.invalid')

  // ---- the same three routes the host half registers --------------------
  if (url.pathname === '/api/bonk-pet/tracks') {
    const { tracks, effects } = listAudio()
    return send(res, 200, JSON.stringify({ dir: assets, tracks, effects }), TYPES['.json'])
  }
  if (url.pathname === '/api/bonk-pet/skin') {
    return send(
      res,
      200,
      JSON.stringify({ slots: findArt(), dir: assets, accepted: [] }),
      TYPES['.json'],
    )
  }
  if (url.pathname === '/api/bonk-pet/asset') {
    const name = url.searchParams.get('name') ?? ''
    // Same guard as the host half: a plain file name inside one directory.
    if (name.includes('/') || name.includes('\\') || name.includes('..') || name.startsWith('.')) {
      return send(res, 400, 'bad name', 'text/plain')
    }
    const file = join(assets, name)
    try {
      const body = readFileSync(file)
      const type = TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream'
      return send(res, 200, body, type)
    } catch {
      return send(res, 404, 'not found', 'text/plain')
    }
  }
  // A relay that does nothing: the preview drives events by hand.
  if (url.pathname === '/api/bonk-pet/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
    res.write(': preview\n\n')
    return
  }

  // ---- static: the demo page and the real client bundle -----------------
  const rel = url.pathname === '/' ? '/demo.html' : url.pathname
  const file = join(root, rel.replace(/^\/+/, ''))
  if (!file.startsWith(root)) return send(res, 403, 'forbidden', 'text/plain')
  try {
    const body = readFileSync(file)
    return send(res, 200, body, TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream')
  } catch {
    return send(res, 404, 'not found', 'text/plain')
  }
})

server.listen(port, '127.0.0.1', () => {
  const { tracks, effects } = listAudio()
  const art = Object.keys(findArt())
  console.log(`preview: http://127.0.0.1:${port}/`)
  console.log(`assets : ${assets}`)
  console.log(`  art   : ${art.length > 0 ? art.join(', ') : '(none — using the drawn artwork)'}`)
  console.log(`  songs : ${tracks.length > 0 ? tracks.join(', ') : '(none)'}`)
  console.log(
    `  effect: ${Object.entries(effects)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ') || '(none)'}`,
  )
  console.log('\nCtrl-C to stop. This is a preview; DSH itself is untouched.')
})
