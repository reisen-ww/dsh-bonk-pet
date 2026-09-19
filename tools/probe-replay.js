/**
 * Does a fresh SSE subscriber get a frame it never asked for?
 *
 * The host intentionally replays "the most recent activity frame" to every new
 * subscriber so a reconnect does not lose a still-running status. The question
 * here is what else that replay can deliver: if a stale ERROR frame is replayed,
 * the pet drops a pipe on page load for no reason, and any test asserting "the
 * pet is idle before X" races against it.
 *
 * Run: node tools/probe-replay.js <origin> <token>
 */

const base = process.argv[2] ?? 'http://127.0.0.1:43894'
const token = process.argv[3] ?? ''

const url = `${base}/api/bonk-pet/events${token === '' ? '' : `?token=${token}`}`

const controller = new AbortController()
const timer = setTimeout(() => controller.abort(), 6000)

const frames = []
try {
  const response = await fetch(url, {
    headers: { accept: 'text/event-stream' },
    signal: controller.signal,
  })
  console.log(`status  : ${response.status} ${response.headers.get('content-type')}`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const { value, done } = await reader.read()
    if (done) break
    for (const line of decoder.decode(value).split('\n')) {
      if (line.startsWith(':')) frames.push(`comment: ${line.slice(0, 60)}`)
      if (line.startsWith('data: ')) frames.push(`data: ${line.slice(6, 200)}`)
    }
    if (frames.some((f) => f.startsWith('data: '))) break
  }
  reader.cancel().catch(() => {})
} catch (error) {
  if (error?.name !== 'AbortError') console.log(`error   : ${error?.message ?? error}`)
} finally {
  clearTimeout(timer)
}

console.log(`\nframes received in the first 5s (${frames.length}):`)
for (const f of frames) console.log(`  ${f}`)
if (!frames.some((f) => f.startsWith('data: '))) {
  console.log('  (no data frame — a fresh subscriber is silent until a real event)')
}
