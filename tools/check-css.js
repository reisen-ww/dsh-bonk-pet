/**
 * Report stray backticks inside the CSS template literal.
 *
 * The CSS block is a template literal, so any backtick inside its comments
 * terminates it early and the file stops parsing. Notes that quote CSS values
 * are the usual culprit. This checks rather than assumes.
 *
 * Run: node tools/check-css.js
 */

import { readFileSync } from 'node:fs'

const lines = readFileSync('lib/client.js', 'utf8').split('\n')

let start = -1
let end = -1
for (let i = 0; i < lines.length; i += 1) {
  if (start < 0 && lines[i].includes('const CSS = ')) {
    start = i
    continue
  }
  if (start >= 0 && lines[i].trim() === '`') {
    end = i
    break
  }
}

if (start < 0 || end < 0) {
  console.error('could not locate the CSS template literal')
  process.exit(2)
}

console.log(`CSS block: lines ${start + 1}..${end + 1}`)

// The opening line ends with the backtick that STARTS the literal, and the
// closing line is nothing but the backtick that ends it. Both are expected;
// only backticks strictly between them are faults.
let found = 0
for (let i = start; i < end; i += 1) {
  const line = lines[i]
  let text = line
  if (i === start) {
    const open = line.indexOf('`')
    text = open < 0 ? line : line.slice(0, open) + line.slice(open + 1)
  }
  const count = (text.match(/`/g) ?? []).length
  if (count > 0) {
    console.log(`  L${i + 1}: ${count} backtick(s) -> ${line.trim()}`)
    found += count
  }
}

console.log(found === 0 ? 'clean' : `${found} to remove (a backtick ends the literal early)`)
process.exit(found === 0 ? 0 : 1)
