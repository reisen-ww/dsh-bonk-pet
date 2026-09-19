/**
 * Run every browser probe in sequence and summarise.
 *
 * Exists so the whole suite can be launched with one command (and one sandbox
 * escalation on Windows, where headless Chromium needs to open named-pipe IPC
 * that the restricted sandbox refuses). Running them one at a time also means a
 * crash in one probe does not hide the results of the others.
 *
 * Run: node tools/serve-demo.js   (terminal 1)
 *      node tools/run-probes.js [baseUrl]
 */

import { spawnSync } from 'node:child_process'

const base = process.argv[2] ?? 'http://127.0.0.1:43900'

/** Probe file (without `.js`) and a label for the summary. */
const PROBES = [
  ['probe-fit', '视口适配 / 拖动边界'],
  ['probe-drag', '拖动松手抽搐'],
  ['probe-eat-flash', '吃饭后闪一下'],
  ['probe-dash', '冲过去吃米的精度'],
  ['probe-bubble', '气泡对齐头部'],
  ['probe-struggle', '抓饭时挣扎'],
  ['probe-gameplay', '玩法全链路'],
  ['probe-lyrics', '歌词轮播'],
  ['probe-preview', '素材加载'],
]

const rows = []
for (const [name, label] of PROBES) {
  const r = spawnSync(process.execPath, [`test/${name}.js`, base], {
    encoding: 'utf8',
    timeout: 240_000,
  })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const summary = out.match(/(\d+)\/(\d+) passed/)?.[0] ?? null
  const fails = [...out.matchAll(/^ {2}FAIL {2}(.+?)(?: {2}::.*)?$/gm)].map((m) => m[1].trim())
  const crashed = r.status !== 0 && summary === null
  rows.push({ label, name, summary, fails, crashed, tail: out.trim().split('\n').slice(-3).join(' | ') })

  const status = crashed ? 'CRASH' : (summary ?? 'no summary')
  console.log(`${crashed ? 'FAIL ' : '     '}${label.padEnd(22)} ${status}`)
  for (const f of fails) console.log(`         - ${f}`)
  if (crashed) console.log(`         ${rows.at(-1).tail}`)
}

const bad = rows.filter((r) => {
  if (r.crashed) return true
  if (r.summary === null) return true
  const [passed, total] = r.summary.split('/').map((n) => Number.parseInt(n, 10))
  return passed !== total
})
console.log(`\n${rows.length - bad.length}/${rows.length} probes fully green`)
process.exit(bad.length === 0 ? 0 : 1)
