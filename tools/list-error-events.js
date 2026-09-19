/**
 * List the DSH events that represent a failure.
 *
 * Written because the plugin originally subscribed to three signals and two
 * real ones were missed (`agent/request-error`, `api-session/error`). Reading
 * the machine-readable event registry is more reliable than grepping prose.
 *
 * Run: node tools/list-error-events.js <dsh-tool-cordis/lib/index.js>
 */

import { readFileSync } from 'node:fs'

const file = process.argv[2]
if (file === undefined) {
  console.error('usage: node tools/list-error-events.js <path to dsh-tool-cordis index.js>')
  process.exit(2)
}

const src = readFileSync(file, 'utf8')

// Each registry entry is `name: "x/y",` optionally followed by `mode: "z",`.
const entry = /name:\s*"([a-z0-9-]+\/[a-z0-9-]+)"[^]*?mode:\s*"(\w+)"/g
const signature = /signature:\s*"([^"]+)"/g

/** Collect name + mode pairs in source order. */
function collect(re) {
  const out = []
  let m
  while ((m = re.exec(src)) !== null) out.push(m.slice(1))
  return out
}

const events = collect(entry)
const signatures = new Map()
{
  const re = /name:\s*"([a-z0-9-]+\/[a-z0-9-]+)"[^]*?signature:\s*"([^"]+)"/g
  let m
  while ((m = re.exec(src)) !== null) signatures.set(m[1], m[2])
}

console.log(`registry entries: ${events.length}\n`)
console.log('=== failure-related events ===')
const failure = events.filter(([name]) => /error|fail|abort|cancel|reject/i.test(name))
for (const [name, mode] of failure) {
  console.log(`  ${mode.padEnd(10)} ${name}`)
  const sig = signatures.get(name)
  if (sig !== undefined) console.log(`             ${sig}`)
}

console.log('\n=== every event, for reference ===')
console.log(events.map(([n]) => n).sort().join('\n'))
