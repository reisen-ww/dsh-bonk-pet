/**
 * Print the LINES table as readable text, grouped by situation.
 *
 * The console here is GBK, so Chinese printed from a shell comes out as mojibake
 * and is useless for reviewing copy. This writes UTF-8 to a file instead, which
 * any editor shows correctly, and also reports each situation's phrasing so
 * repetition and tone drift are visible when reading the whole set at once.
 *
 * Run: node tools/dump-lines.js [outPath]
 */

import { writeFileSync } from 'node:fs'
import { parseLines } from './parse-lines.js'

const out = process.argv[2] ?? 'lines-dump.txt'
const table = parseLines()

/** Human label per situation, so the file reads as a script rather than a map. */
const LABELS = {
  hit: '被钢管砸（agent 报错时）',
  knock: '被敲盆',
  knockNag: '被连敲很多下',
  beg: '饿了，想去讨饭',
  noFood: '找不到饭',
  spotted: '看见饭了',
  eat: '吃到了',
  greet: '刚上线',
  sing: '干活时哼歌（英文/中文交替）',
}

const lines = []
for (const [name, list] of table) {
  lines.push(`\n### ${name} — ${LABELS[name] ?? '(未命名)'}  [${list.length} 条]\n`)
  for (const [i, text] of list.entries()) {
    lines.push(`${String(i + 1).padStart(2)}. ${text}`)
  }
}

writeFileSync(out, lines.join('\n'), 'utf8')
console.log(`wrote ${out} (${table.size} situations, ${[...table.values()].reduce((n, l) => n + l.length, 0)} lines)`)

// Duplicate detection ACROSS situations: the same sentence in two places reads
// as a bug to a player ("it just said that"), and is invisible when each list is
// reviewed on its own.
const seen = new Map()
const crossDupes = []
for (const [name, list] of table) {
  for (const text of list) {
    if (seen.has(text)) crossDupes.push(`"${text}" in ${seen.get(text)} AND ${name}`)
    else seen.set(text, name)
  }
}
console.log(crossDupes.length === 0 ? 'no cross-situation duplicates' : `cross-situation duplicates:\n  ${crossDupes.join('\n  ')}`)
