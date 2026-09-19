/**
 * Inspect what the source images actually contain.
 *
 * Written because the first cutout pass assumed a flat white backdrop; if the
 * artwork already ships an alpha channel, keying it again corrupts the edges.
 * Guessing is what caused that, so this reports the facts instead.
 *
 * Run: node tools/inspect.js <sharpPackageDir> <file...>
 */

import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const sharp = require(resolve(process.argv[2]))
const files = process.argv.slice(3)

for (const file of files) {
  const meta = await sharp(file).metadata()
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })

  let opaque = 0
  let clear = 0
  let partial = 0
  let clearRgb = null
  const alphaHistogram = new Map()

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a === 255) opaque += 1
    else if (a === 0) {
      clear += 1
      // Remember what colour the fully transparent pixels carry.
      if (clearRgb === null) clearRgb = [data[i], data[i + 1], data[i + 2]]
    } else partial += 1
    alphaHistogram.set(a, (alphaHistogram.get(a) ?? 0) + 1)
  }

  const total = info.width * info.height
  const corner = (x, y) => {
    const i = (y * info.width + x) * 4
    return [data[i], data[i + 1], data[i + 2], data[i + 3]]
  }

  const hasAlpha = meta.hasAlpha === true
  const realTransparency = clear > total * 0.02

  console.log(`\n=== ${file}`)
  console.log(`  size          ${info.width}x${info.height}   channels ${meta.channels}  hasAlpha ${hasAlpha}`)
  console.log(`  opaque        ${((opaque / total) * 100).toFixed(1)}%`)
  console.log(`  fully clear   ${((clear / total) * 100).toFixed(1)}%`)
  console.log(`  partial       ${((partial / total) * 100).toFixed(2)}%`)
  console.log(`  transparent RGB sample  ${clearRgb === null ? 'n/a' : clearRgb.join(',')}`)
  console.log(`  corner TL     ${corner(0, 0).join(',')}`)
  console.log(`  corner TR     ${corner(info.width - 1, 0).join(',')}`)
  console.log(`  corner BL     ${corner(0, info.height - 1).join(',')}`)
  console.log(`  corner BR     ${corner(info.width - 1, info.height - 1).join(',')}`)
  console.log(
    `  VERDICT       ${realTransparency ? 'ALREADY TRANSPARENT — do not key it' : 'flat backdrop — keying is appropriate'}`,
  )
}
