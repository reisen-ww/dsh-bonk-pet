/**
 * Identify which installed plugin owns the green "免费模型" button.
 *
 * Why a script: the label is Chinese, so grepping for it from a shell invites
 * quoting/encoding failures, and the bundles are one-line minified files where
 * a match is useless without context. This reads every installed plugin's client
 * half, looks for the label (raw and \u-escaped) and for the slot it registers
 * into, and reports the surrounding evidence.
 *
 * Run: node tools/find-plugin.js "免费模型"
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const needle = process.argv[2] ?? '免费模型'
const root = join(process.env.USERPROFILE ?? '.', '.dsh', 'profiles', 'desktop', 'node_modules')

/** Every candidate client bundle under one package directory. */
function clientFiles(dir) {
  const out = []
  const walk = (d, depth) => {
    if (depth > 3) return
    let entries
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(d, e.name)
      if (e.isDirectory()) {
        if (e.name === 'node_modules') continue
        walk(p, depth + 1)
      } else if (/\.(js|cjs|mjs)$/.test(e.name)) {
        out.push(p)
      }
    }
  }
  walk(join(dir, 'lib'), 0)
  if (!existsSync(join(dir, 'lib'))) walk(dir, 0)
  return out
}

/** The \uXXXX form of a string, which is how minified bundles usually carry it. */
const escaped = (s) =>
  [...s].map((c) => (c.codePointAt(0) > 127 ? `\\u${c.codePointAt(0).toString(16)}` : c)).join('')

const forms = [
  { label: 'raw', text: needle },
  { label: 'escaped-lower', text: escaped(needle) },
  { label: 'escaped-upper', text: escaped(needle).toUpperCase().replace(/\\U/g, '\\u') },
]

const packages = readdirSync(root, { withFileTypes: true })
  .filter((e) => e.isDirectory() && (e.name.startsWith('dsh') || e.name.startsWith('@')))
  .map((e) => join(root, e.name))

console.log(`searching ${packages.length} package dirs for ${JSON.stringify(needle)}\n`)

for (const dir of packages) {
  let pkg = {}
  try {
    pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  } catch {
    continue
  }
  for (const file of clientFiles(dir)) {
    let source
    try {
      if (statSync(file).size > 8_000_000) continue
      source = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const form of forms) {
      const at = source.indexOf(form.text)
      if (at < 0) continue
      const ctx = source.slice(Math.max(0, at - 260), at + 260).replace(/\s+/g, ' ')
      console.log(`HIT  ${pkg.name ?? dir}  (${form.label})`)
      console.log(`     ${file.replace(root, '')}`)
      console.log(`     ...${ctx}...`)
      const slots = [...source.matchAll(/name:\s*["']([a-z][a-z0-9.-]*\.[a-z0-9.-]+)["']/g)]
        .map((m) => m[1])
      if (slots.length > 0) console.log(`     slots seen: ${JSON.stringify([...new Set(slots)].slice(0, 8))}`)
      console.log()
      break
    }
  }
}
