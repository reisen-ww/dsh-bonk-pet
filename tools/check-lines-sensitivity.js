/**
 * Prove `check-lines.js` fails when it should.
 *
 * The duplicate gate was just added, and a gate that cannot fail is worse than no
 * gate — this project has already shipped three probes that could never fail. This
 * plants a duplicate, runs the checker, and requires a non-zero exit, then
 * restores the file byte-for-byte.
 *
 * Run: node tools/check-lines-sensitivity.js
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const FILE = 'lib/client.js'
const original = readFileSync(FILE, 'utf8')

/** Each case mutates the source, then requires the checker to reject it. */
const CASES = [
  {
    name: 'cross-situation duplicate',
    // Copy a `knock` line into `hit`, which is exactly the mistake that shipped.
    // Anchors on the entry itself, not on the line after `hit: [`, because that
    // line is now a comment and a text anchor there silently stops matching.
    apply: (src) => src.replace(`        '啊！我的头！',`, `        '啊！我的头！',\n        '别敲了！',`),
  },
  {
    name: 'duplicate within one situation',
    apply: (src) => src.replace(`        '啊！我的头！',`, `        '啊！我的头！',\n        '啊！我的头！',`),
  },
  {
    name: 'sing alternation broken',
    // Two Chinese lines in a row breaks the EN/ZH pairing the lyrics rely on.
    apply: (src) => src.replace(`        '♪ 让我来~',`, `        '♪ 让我来~',\n        '♪ 我再来~',`),
  },
]

let failed = 0
for (const c of CASES) {
  const mutated = c.apply(original)
  if (mutated === original) {
    console.log(`SKIP  ${c.name}: anchor not found — the check's claim is stale`)
    failed += 1
    continue
  }
  writeFileSync(FILE, mutated)
  let result
  try {
    result = spawnSync(process.execPath, ['tools/check-lines.js'], { encoding: 'utf8', timeout: 60_000 })
  } finally {
    writeFileSync(FILE, original)
  }
  const caught = result.status !== 0
  console.log(`${caught ? 'PASS' : 'FAIL'}  ${c.name}: ${caught ? 'checker rejected it' : 'checker PASSED a broken table'}`)
  if (!caught) failed += 1
}

const restored = readFileSync(FILE, 'utf8') === original
console.log(`${restored ? 'PASS' : 'FAIL'}  ${FILE} restored byte-for-byte`)
if (!restored) failed += 1

console.log(`\n${CASES.length + 1 - failed}/${CASES.length + 1} passed`)
process.exit(failed === 0 ? 0 : 1)
