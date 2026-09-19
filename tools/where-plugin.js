/**
 * Report where an installed plugin hooks into the UI, and the label of the
 * control it adds.
 *
 * The question this answers: the user sees a green "免费模型" button on the
 * right of the DSH composer, and wants to know which plugin owns it. Finding the
 * string is not enough — a plugin can be installed and still contribute nothing,
 * so this prints the slot it registers into and the label it renders, which is
 * what actually identifies the button.
 *
 * Run: node tools/where-plugin.js dsh-opencode-free-models [needle]
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const pkgName = process.argv[2] ?? 'dsh-opencode-free-models'
const needle = process.argv[3] ?? '免费模型'
const root = join(process.env.USERPROFILE ?? '.', '.dsh', 'profiles', 'desktop', 'node_modules')
const dir = join(root, pkgName)

if (!existsSync(dir)) {
  console.error(`not installed: ${dir}`)
  process.exit(2)
}

const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
console.log(`${pkg.name} v${pkg.version}`)
console.log(`  ${pkg.description ?? '(no description)'}\n`)

const files = []
const walk = (d, depth) => {
  if (depth > 3) return
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name)
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') walk(p, depth + 1)
    } else if (/\.(js|cjs|mjs)$/.test(e.name)) {
      files.push(p)
    }
  }
}
walk(join(dir, 'lib'), 0)

for (const file of files) {
  const src = readFileSync(file, 'utf8')
  const rel = file.slice(dir.length)

  // Slots it contributes to.
  const slots = new Set()
  for (const re of [
    /slots\s*\.\s*(?:register|inject)\s*\(\s*['"]([^'"]+)['"]/g,
    /name\s*:\s*['"]([a-zA-Z][\w.-]*\.[\w.-]+)['"]/g,
    /register\s*\(\s*\{\s*name\s*:\s*['"]([^'"]+)['"]/g,
  ]) {
    for (const m of src.matchAll(re)) slots.add(m[1])
  }

  // Labels near the needle, which is what the user actually sees rendered.
  const labels = new Set()
  for (const m of src.matchAll(/(\w+)\s*:\s*'([^'\n]{1,40})'/g)) {
    if (m[2].includes(needle) || /模型|model/i.test(m[2])) labels.add(`${m[1]} = ${m[2]}`)
  }

  const hitsNeedle = src.includes(needle)

  if (slots.size === 0 && labels.size === 0 && !hitsNeedle) continue

  console.log(`${rel}`)
  if (slots.size > 0) console.log(`  registers into: ${[...slots].slice(0, 12).join(', ')}`)
  if (labels.size > 0) {
    console.log('  labels:')
    for (const l of [...labels].slice(0, 12)) console.log(`    ${l}`)
  }
  if (hitsNeedle) {
    const at = src.indexOf(needle)
    console.log(`  contains ${JSON.stringify(needle)}: ...${src.slice(Math.max(0, at - 90), at + 60).replace(/\s+/g, ' ')}...`)
  }
  console.log()
}
