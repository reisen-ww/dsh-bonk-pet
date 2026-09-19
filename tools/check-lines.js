/**
 * Report the shape of the `LINES` table.
 *
 * The table is the one part of the browser half that is edited as prose, so it
 * is where a stray apostrophe (which terminates a single-quoted string) or an
 * accidentally short list (which makes the pet repeat itself within a few
 * turns) is most likely. The parse itself lives in `parse-lines.js` so the e2e
 * suite reads the SAME table rather than keeping a copy that goes stale.
 *
 * Run: node tools/check-lines.js
 */

import { readFileSync } from 'node:fs'
import { parseLines } from './parse-lines.js'

const table = parseLines()
const source = readFileSync('lib/client.js', 'utf8')

// ---- per-situation counts --------------------------------------------------
console.log('lines per situation:')
let total = 0
let short = 0
for (const [name, list] of table) {
  total += list.length
  if (list.length < 3) short += 1
  const flag = list.length < 3 ? '  <-- short, will repeat' : ''
  console.log(`  ${name.padEnd(10)} ${String(list.length).padStart(2)}${flag}`)
}
console.log(`  ${'TOTAL'.padEnd(10)} ${String(total).padStart(2)}`)

// `pick()` is uniform, so duplicates in one list mean the pet says the same
// thing more often than the other lines in that list, silently.
//
// Checked ACROSS situations too. The same sentence in two lists is invisible when
// each list is reviewed on its own, but a player meets it in both places and it
// reads as a bug — "已老实，求放过" was in both `hit` and `knockNag`, so being
// crushed and being nagged produced identical dialogue.
let duplicates = 0
const owner = new Map()
for (const [name, list] of table) {
  const seen = new Set()
  for (const line of list) {
    if (seen.has(line)) {
      console.log(`  duplicate within ${name}: ${line}`)
      duplicates += 1
    }
    seen.add(line)
    const first = owner.get(line)
    if (first !== undefined && first !== name) {
      console.log(`  duplicate across situations: "${line}" in ${first} AND ${name}`)
      duplicates += 1
    } else if (first === undefined) {
      owner.set(line, name)
    }
  }
}

// ---- the pairing the lyrics depend on --------------------------------------
// A single-quoted entry containing an apostrophe would have ended the string
// early, so the parse above would already have failed — but an ESCAPED one
// still changes what the user reads, so check for it explicitly.
const escaped = (source.match(/\\'/g) ?? []).length

const sing = table.get('sing') ?? []
const hasCjk = (s) => /[\u4e00-\u9fff]/.test(s)
let alternationBreaks = 0
for (let i = 1; i < sing.length; i += 1) {
  if (hasCjk(sing[i]) === hasCjk(sing[i - 1])) alternationBreaks += 1
}
console.log(
  `\nsing alternation: ${sing.length} lines, ${alternationBreaks} place(s) where two ` +
    `consecutive lines are both Chinese or both English`,
)
if (alternationBreaks > 0) {
  for (let i = 1; i < sing.length; i += 1) {
    if (hasCjk(sing[i]) === hasCjk(sing[i - 1])) {
      console.log(`  ${i}: "${sing[i - 1]}" then "${sing[i]}"`)
    }
  }
}

if (escaped > 0) console.log(`\nescaped apostrophes in the file: ${escaped}`)

process.exit(short === 0 && duplicates === 0 && alternationBreaks === 0 ? 0 : 1)
