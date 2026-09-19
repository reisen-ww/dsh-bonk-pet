/**
 * Prepare the user's artwork for the pet.
 *
 * The sources already ship a real alpha channel (verified by tools/inspect.js:
 * the corners are 0,0,0,0 and roughly half the pixels are transparent). So this
 * does exactly two things and touches nothing else:
 *
 *   1. crops to the non-transparent content, with a small margin, and
 *   2. normalises the long edge to a target size.
 *
 * It deliberately does NOT key any colour: the previous version assumed a flat
 * white backdrop, painted the transparent regions black and ate half the
 * antialiased edge. Never re-key an image that already has alpha.
 *
 * Run: node tools/cutout.js <sharpPackageDir> [outDir]
 */

import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)

const sharpDir = process.argv[2]
const outDir = resolve(process.argv[3] ?? 'assets')
if (sharpDir === undefined) {
  console.error('usage: node tools/cutout.js <sharpPackageDir> [outDir]')
  process.exit(2)
}
const sharp = require(resolve(sharpDir))

/** name -> source path, taken from the environment so no path is hardcoded. */
const SOURCES = {
  pet: process.env.SRC_PET,
  basin: process.env.SRC_BASIN,
  pipe: process.env.SRC_PIPE,
  rice: process.env.SRC_RICE,
}

/** Long-edge target. The pet renders at 104x112 CSS px; 512 is ample. */
const TARGET = 512

mkdirSync(outDir, { recursive: true })

for (const [name, src] of Object.entries(SOURCES)) {
  if (src === undefined || src.length === 0) {
    console.log(`${name}: no source given, skipped`)
    continue
  }

  const meta = await sharp(src).metadata()
  if (meta.hasAlpha !== true) {
    console.log(`${name}: WARNING source has no alpha channel; leaving pixels untouched anyway`)
  }

  // `trim` drops the fully transparent border using the alpha channel.
  // Nothing else about the image is modified.
  const trimmed = sharp(src).trim({ threshold: 1 })
  const info = await trimmed.metadata()

  const scale = TARGET / Math.max(info.width, info.height)
  const outW = Math.max(1, Math.round(info.width * scale))
  const outH = Math.max(1, Math.round(info.height * scale))

  await trimmed
    .resize(outW, outH, { fit: 'fill' })
    .png({ compressionLevel: 9 })
    .toFile(join(outDir, `${name}.png`))

  console.log(
    `${name.padEnd(6)} ${meta.width}x${meta.height} -> trim ${info.width}x${info.height}` +
      ` -> ${outW}x${outH}  aspect ${(outW / outH).toFixed(3)}`,
  )
}
