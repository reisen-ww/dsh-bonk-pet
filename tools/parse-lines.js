/**
 * Parse the `LINES` table out of the browser half.
 *
 * This is the single source of truth for that table. It exists because the
 * table has TWO consumers that must agree with it but cannot import it: the
 * checks in `tools/check-lines.js` and the assertions in `test/e2e.js`. Before
 * this, e2e kept its own hardcoded copy of the knock lines — so editing the copy
 * in `lib/client.js` (a pure content change, no logic) broke the end-to-end
 * suite and looked like a regression.
 *
 * Parsed rather than imported because `lib/client.js` is a browser bundle: it
 * registers itself with `window.__ModuleLoader__` at load time and cannot be
 * `import`ed in Node.
 *
 * @returns a map of situation name to its array of lines, in source order.
 */

import { readFileSync } from 'node:fs'

/**
 * @param path - path to the browser half; defaults to the shipped location.
 * @returns {Map<string, string[]>} situation -> lines.
 */
export function parseLines(path = 'lib/client.js') {
  const lines = readFileSync(path, 'utf8').split('\n')

  const startAt = lines.findIndex((l) => l.includes('const LINES = {'))
  if (startAt < 0) throw new Error(`${path}: could not find the LINES table`)

  /** @type {Map<string, string[]>} */
  const table = new Map()
  let current = null

  for (let i = startAt + 1; i < lines.length; i += 1) {
    const line = lines[i]
    // The table closes with a 4-space-indented brace.
    if (/^ {4}\}/.test(line)) break

    const open = line.match(/^ {6}(\w+): \[$/)
    if (open !== null) {
      current = open[1]
      table.set(current, [])
      continue
    }
    if (/^ {6}\],$/.test(line)) {
      current = null
      continue
    }
    if (current === null) continue

    const entry = line.match(/^ {8}(['"])(.*)\1,$/)
    if (entry !== null) table.get(current).push(entry[2])
  }

  if (table.size === 0) throw new Error(`${path}: the LINES table parsed empty`)
  return table
}
