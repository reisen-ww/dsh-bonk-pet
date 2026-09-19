/**
 * Report what an audio file already knows about itself.
 *
 * The question this answers: does `letmego.mp3` carry a lyric timeline? A
 * karaoke timesheet can live INSIDE the file as an ID3 `SYLT` (synchronised
 * lyrics) frame — if it is there, no guessing and no re-timing is needed.
 * `USLT` is the plain-text fallback, and the MPEG header gives the duration any
 * timeline has to fit inside.
 *
 * Run: node tools/read-song.js [path]
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

const file =
  process.argv[2] ?? join(process.env.USERPROFILE ?? '.', '.dsh', 'bonk-pet', 'letmego.mp3')

if (!existsSync(file)) {
  console.error(`not found: ${file}`)
  process.exit(2)
}

const buf = readFileSync(file)
console.log(`file  : ${file}`)
console.log(`bytes : ${buf.length}`)

const syncsafe = (b, o) =>
  ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f)
const be32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0

/** Decode a byte range using an ID3 text encoding byte. */
function decodeWith(enc, b, start, end) {
  const body = b.subarray(start, end)
  if (enc === 0) return body.toString('latin1')
  if (enc === 1) return body.toString('utf16le').replace(/^\uFEFF/, '')
  if (enc === 2) {
    const swapped = Buffer.from(body)
    for (let i = 0; i + 1 < swapped.length; i += 2) {
      const t = swapped[i]
      swapped[i] = swapped[i + 1]
      swapped[i + 1] = t
    }
    return swapped.toString('utf16le')
  }
  return body.toString('utf8')
}

/** Decode a whole text frame (leading encoding byte included). */
const decodeText = (b, start, end) => decodeWith(b[start], b, start + 1, end)

let audioStart = 0
let tagEnd = 0

// ---- ID3v2 ----------------------------------------------------------------
if (buf.length > 10 && buf.toString('latin1', 0, 3) === 'ID3') {
  const major = buf[3]
  const flags = buf[5]
  const size = syncsafe(buf, 6)
  tagEnd = 10 + size
  console.log(`ID3v2.${major}  tag=${10 + size} bytes  flags=0x${flags.toString(16)}`)
  if ((flags & 0x80) !== 0) console.log('  (unsynchronised tag — frame offsets may shift)')

  let o = 10
  const frames = []
  while (o + 10 <= tagEnd) {
    const id = buf.toString('latin1', o, o + 4)
    if (!/^[A-Z0-9]{4}$/.test(id)) break
    const fsize = major >= 4 ? syncsafe(buf, o + 4) : be32(buf, o + 4)
    if (fsize <= 0 || o + 10 + fsize > buf.length) break
    frames.push({ id, size: fsize, at: o + 10 })
    o += 10 + fsize
  }
  console.log(`frames: ${frames.map((f) => `${f.id}(${f.size})`).join(' ')}`)

  for (const f of frames) {
    if (['TIT2', 'TPE1', 'TALB', 'TCON', 'TSSE', 'COMM', 'TXXX'].includes(f.id)) {
      const text = decodeText(buf, f.at, f.at + f.size).replace(/\0/g, ' | ').trim()
      console.log(`  ${f.id}: ${text.slice(0, 200)}`)
    }
  }

  const sylt = frames.find((f) => f.id === 'SYLT')
  const uslt = frames.find((f) => f.id === 'USLT')
  console.log(`SYLT (timed lyrics)  : ${sylt === undefined ? 'ABSENT' : `PRESENT, ${sylt.size} bytes`}`)
  console.log(`USLT (plain lyrics)  : ${uslt === undefined ? 'ABSENT' : `PRESENT, ${uslt.size} bytes`}`)

  if (uslt !== undefined) {
    const text = decodeText(buf, uslt.at + 4, uslt.at + uslt.size)
    console.log('--- USLT ---')
    console.log(text.slice(0, 4000))
    console.log('--- /USLT ---')
  }

  if (sylt !== undefined) {
    const enc = buf[sylt.at]
    let p = sylt.at + 1 + 3 // skip encoding + language
    const tsFormat = buf[p]
    p += 2 // timestamp format + content type
    const term = enc === 1 || enc === 2 ? Buffer.from([0, 0]) : Buffer.from([0])
    const dEnd = buf.indexOf(term, p)
    p = dEnd < 0 ? p : dEnd + term.length
    const end = sylt.at + sylt.size
    const entries = []
    while (p + 4 <= end) {
      const t = buf.readUInt32BE(p)
      p += 4
      const tEnd = buf.indexOf(term, p)
      const stop = tEnd < 0 || tEnd > end ? end : tEnd
      entries.push({ t, text: decodeWith(enc, buf, p, stop) })
      p = stop + term.length
    }
    console.log(`SYLT tsFormat=${tsFormat} entries=${entries.length}`)
    for (const e of entries.slice(0, 100)) console.log(`  ${e.t}  ${e.text}`)
  }

  audioStart = tagEnd
} else {
  console.log('ID3v2: none')
}

// ---- MPEG audio header + duration -----------------------------------------
const rateTable = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
const srTable = [44100, 48000, 32000, 0]

const i = audioStart
if (buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0) {
  const b1 = buf[i + 1]
  const b2 = buf[i + 2]
  const verBits = (b1 >> 3) & 0x03
  const layerBits = (b1 >> 1) & 0x03
  const brIdx = (b2 >> 4) & 0x0f
  const srIdx = (b2 >> 2) & 0x03
  const chMode = (b2 >> 6) & 0x03
  const version = verBits === 3 ? 1 : verBits === 2 ? 2 : 2.5
  const layer = 4 - layerBits
  const bitrate = rateTable[brIdx] * 1000
  const rate = srTable[srIdx] / (version === 1 ? 1 : version === 2 ? 2 : 4)
  console.log(
    `MPEG: v${version} layer${layer} ${bitrate / 1000}kbps ${rate}Hz ${chMode === 3 ? 'mono' : 'stereo'}`,
  )

  const xingOff = version === 1 ? (chMode === 3 ? 21 : 36) : chMode === 3 ? 13 : 21
  const xtag = buf.toString('latin1', i + 4 + xingOff, i + 4 + xingOff + 4)
  const samplesPerFrame = layer === 1 ? 384 : version === 1 ? 1152 : 576

  if (xtag === 'Xing' || xtag === 'Info') {
    const flags = buf.readUInt32BE(i + 4 + xingOff + 4)
    const p = i + 4 + xingOff + 8
    const frames = (flags & 1) !== 0 ? buf.readUInt32BE(p) : null
    console.log(`VBR header: ${xtag} frames=${frames}`)
    if (frames !== null) {
      const seconds = (frames * samplesPerFrame) / rate
      console.log(
        `duration: ${seconds.toFixed(2)}s = ${Math.floor(seconds / 60)}m${String(Math.round(seconds % 60)).padStart(2, '0')}s (exact)`,
      )
      console.log(`lines provided: count them against the timeline below`)
    }
  } else {
    const seconds = ((buf.length - audioStart) * 8) / bitrate
    console.log(`duration: ~${seconds.toFixed(1)}s (CBR estimate; drifts if VBR)`)
  }
} else {
  console.log('MPEG: no frame sync where audio should start')
}

// ---- ID3v1 + sibling lyric files ------------------------------------------
const tail = buf.toString('latin1', Math.max(0, buf.length - 128), buf.length - 125)
console.log(`ID3v1: ${tail === 'TAG' ? 'present' : 'none'}`)

const dir = dirname(file)
const sibs = readdirSync(dir).filter((n) => /\.(lrc|txt|srt|vtt|json)$/i.test(n))
console.log(`lyric-ish files in ${dir}: ${sibs.length === 0 ? '(none)' : sibs.join(', ')}`)
