/**
 * Report whether the bonk-pet plugin is actually live in the running DSH host.
 *
 * Written because "I restarted, did it work?" should be answerable in one
 * command rather than by squinting at the corner of the window.
 *
 * HTTP probes alone CANNOT answer it: this plugin's routes sit behind the
 * Desktop renderer fence, which answers 403 identically whether a route exists
 * or not. So the load-bearing evidence is the mount receipt the plugin itself
 * writes on startup — its word that it started, with a timestamp to compare
 * against when DSH was launched.
 *
 * Run: node tools/check-live.js [origin]
 */

import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const origin = process.argv[2] ?? 'http://127.0.0.1:43120'
const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const receipt = join(home, 'bonk-pet', 'loaded.txt')

console.log(`dsh home : ${home}`)
console.log(`origin   : ${origin}\n`)

// ---- 1. the plugin's own mount receipt --------------------------------
console.log('mount receipt')
try {
  const text = readFileSync(receipt, 'utf8').trim()
  for (const line of text.split('\n')) console.log(`  ${line}`)
  const age = Date.now() - statSync(receipt).mtimeMs
  console.log(`  (written ${Math.round(age / 1000)}s ago)`)
  console.log('\n  => the plugin has mounted at least once.')
} catch {
  console.log(`  ${receipt}`)
  console.log('  not found => the plugin has NEVER mounted in this dsh home.')

  // Distinguish "never installed" from "installed but not loaded".
  try {
    const pkg = JSON.parse(readFileSync(join(home, 'profiles', 'desktop', 'package.json'), 'utf8'))
    const dep = pkg.dependencies?.['dsh-bonk-pet']
    const patch = readFileSync(join(home, 'profiles', 'desktop', 'cordis.patch.yml'), 'utf8')
    console.log('\n  install state:')
    console.log(`    dependency : ${dep ?? '(missing!)'}`)
    console.log(`    in patch   : ${patch.includes('bonk-pet') ? 'yes' : 'NO — it will not load'}`)
    if (dep !== undefined && patch.includes('bonk-pet')) {
      console.log('\n  => installed correctly but not loaded yet: DSH needs a restart.')
    }
  } catch (error) {
    console.log(`  (could not read the desktop profile: ${String(error?.message ?? error)})`)
  }
}

// ---- 2. the routes, for what they are worth ---------------------------
console.log('\nhttp probes (informational — see the note below)')
for (const path of ['/api/bonk-pet/tracks', '/api/bonk-pet/skin', '/api/bonk-pet/events']) {
  try {
    const response = await fetch(origin + path, { redirect: 'manual' })
    const note =
      response.status === 200
        ? 'LIVE'
        : response.status === 403
          ? 'fenced (inconclusive)'
          : response.status === 404
            ? 'NOT MOUNTED'
            : `status ${response.status}`
    console.log(`  ${path.padEnd(28)} ${String(response.status).padStart(3)}  ${note}`)
  } catch (error) {
    console.log(`  ${path.padEnd(28)}   -  no answer (${String(error?.message ?? error)})`)
  }
}

console.log(
  [
    '',
    'A 403 on every route is the DESKTOP RENDERER FENCE, not a missing plugin:',
    'the Electron shell only serves /api to requests carrying a header its own',
    'window sends, so an outside probe can never distinguish the two.',
    'Trust the receipt above instead.',
  ].join('\n'),
)

