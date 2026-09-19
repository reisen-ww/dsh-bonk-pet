/**
 * Render layout previews of the pet with its props, at 4x, from the real art.
 *
 * Written because the prop positions are a judgement call that is cheap to
 * check by eye and expensive to discover after install. Renders every
 * candidate so the choice is made from pixels, not from a guess.
 *
 * Run: node tools/preview.js <sharpPackageDir>
 */

import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const sharp = require(resolve(process.argv[2]))

const SCALE = 4
const BG = { r: 15, g: 17, b: 23, alpha: 1 }

async function load(name, width) {
  const buf = await sharp(`assets/${name}.png`)
    .resize({ width: Math.round(width * SCALE), fit: 'inside' })
    .toBuffer()
  const meta = await sharp(buf).metadata()
  return { buf, w: meta.width, h: meta.height }
}

const pet = await load('pet', 104)
const basin = await load('basin', 78)

/** Compose one candidate layout. */
async function render(file, place) {
  const canvasW = Math.max(pet.w, basin.w) + 80
  const canvasH = pet.h + basin.h + 80
  const layers = []

  for (const item of place(pet, basin, canvasW, canvasH)) {
    layers.push({
      input: item.img.buf,
      left: Math.round(item.x),
      top: Math.round(item.y),
    })
  }

  await sharp({
    create: { width: canvasW, height: canvasH, channels: 4, background: BG },
  })
    .composite(layers)
    .png()
    .toFile(resolve(`assets/${file}`))

  console.log(`${file}  canvas ${canvasW}x${canvasH}`)
}

// A: the basin caps the pet's head, like a helmet — what the user described.
await render('preview-A-on-head.png', (p, b, cw) => [
  { img: p, x: (cw - p.w) / 2, y: 30 + b.h * 0.55 },
  { img: b, x: (cw - b.w) / 2, y: 30 },
])

// B: the pet sits inside the basin.
await render('preview-B-sitting.png', (p, b, cw, ch) => [
  { img: b, x: (cw - b.w) / 2, y: 30 + p.h - b.h * 0.35 },
  { img: p, x: (cw - p.w) / 2, y: 30 },
])
