/**
 * Prove a probe can actually FAIL, by breaking the thing it claims to test.
 *
 * An always-passing test is more dangerous than no test: it manufactures
 * confidence. This project has now shipped THREE probes that could never fail —
 * one measured `root` while the transform lived on a child, one asserted only
 * "moved more than 60px", and one measured the root during a drag for the same
 * reason as the first. Each looked green while measuring nothing.
 *
 * So sensitivity is checked by editing the plugin on disk, running the probe, and
 * requiring a non-zero exit. The file is always restored, including on failure.
 *
 * Run: node tools/check-sensitivity.js
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const FILE = 'lib/client.js'
const original = readFileSync(FILE, 'utf8')

/** Each case: a name, the exact text to replace, its replacement, and the probe. */
const CASES = [
  {
    name: 'drag-time viewport clamp',
    probe: 'test/probe-fit.js',
    // Removing the clamp is what the un-fixed plugin did, so the "never leaves
    // the viewport WHILE being dragged" assertion must start failing.
    from: `        const fitted = fitToViewport(baseLeft + dx, baseTop + dy)`,
    to: `        const fitted = { left: baseLeft + dx, top: baseTop + dy }`,
  },
]

let failed = 0

for (const c of CASES) {
  if (!original.includes(c.from)) {
    console.log(`SKIP  ${c.name}: anchor not found in ${FILE} — the probe's claim is stale`)
    failed += 1
    continue
  }

  writeFileSync(FILE, original.replace(c.from, c.to))
  let result
  try {
    result = spawnSync(process.execPath, [c.probe, process.env.PROBE_BASE ?? 'http://127.0.0.1:43900'], {
      encoding: 'utf8',
      timeout: 180_000,
    })
  } finally {
    writeFileSync(FILE, original)
  }

  const ok = result.status !== 0
  const detail = ok
    ? 'probe failed as required'
    : 'probe PASSED with the fix removed — it measures nothing'
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}: ${detail}`)
  if (!ok) {
    const tail = (result.stdout ?? '').trim().split('\n').slice(-6).join('\n      ')
    console.log(`      last output:\n      ${tail}`)
    failed += 1
  }
}

// The file must be byte-identical afterwards, or a failed run has corrupted the
// plugin while appearing to succeed.
const restored = readFileSync(FILE, 'utf8') === original
console.log(`${restored ? 'PASS' : 'FAIL'}  ${FILE} restored byte-for-byte`)
if (!restored) failed += 1

console.log(`\n${CASES.length + 1 - failed}/${CASES.length + 1} passed`)
process.exit(failed === 0 ? 0 : 1)
