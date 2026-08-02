// Run with: node scripts/verify/06-process-error-guard.mjs
//
// Verifies the Task 5 review fix (Important finding) on
// src/main/services/ShardEngine.ts's launch() and
// src/main/services/BrowserLauncher.ts's runProfile():
//
// When spawn() fails at the OS level (binary quarantined by antivirus,
// deleted by hand, disk full while extracting, ...), session.process emits
// 'error'. Empirically confirmed on this exact Windows setup (see
// task-5-report.md "Fix round 1"): spawning a missing binary fires 'error'
// and 'exit' does NOT follow. Node's own docs say 'exit' "may or may not"
// fire after 'error' — so any cleanup that only runs on 'exit' (ShardEngine's
// own sessions.delete(), BrowserLauncher's ProfileStore.setRunning(false) +
// cleanProfileCache()) could never run, leaving the profile stuck showing
// "running" forever with nothing left alive.
//
// Cannot import ShardEngine.ts/BrowserLauncher.ts directly — both pull in
// ../db's dataRoot(), which needs Electron's app.getPath() and does not work
// under plain `node` (same reason scripts 01/02/02b/04/05 in this folder
// avoid importing them; see their header comments). Instead this
// reimplements the EXACT listener pattern added to both files, using a plain
// EventEmitter standing in for a ChildProcess (Node's ChildProcess is itself
// just an EventEmitter with extra methods bolted on, so this is a faithful
// stand-in for 'error'/'exit' dispatch) and drives it by emitting 'error'
// WITHOUT ever emitting 'exit' — the exact scenario the finding describes.

import { EventEmitter } from 'node:events'

let failures = 0
function check(name, cond) {
  if (cond) {
    console.log(`  PASS: ${name}`)
  } else {
    failures++
    console.log(`  FAIL: ${name}`)
  }
}

// ---------------------------------------------------------------------------
// Reimplementation of the exact pattern added to ShardEngine.ts's launch()
// ---------------------------------------------------------------------------
function makeEngine() {
  const sessions = new Map()
  const launching = new Set()
  const lastError = new Map()
  const loggedErrors = []

  function attachLifecycle(profileId, fakeProcess) {
    fakeProcess.on('exit', () => sessions.delete(profileId))
    fakeProcess.on('error', (err) => {
      sessions.delete(profileId)
      launching.delete(profileId)
      lastError.set(profileId, err)
      loggedErrors.push({ profileId, err })
    })
  }

  // Mirrors the new guard at the top of launch(): throw the stored error
  // once, then clear it, instead of blocking the profile forever.
  function tryLaunchAgain(profileId) {
    const prev = lastError.get(profileId)
    if (prev) {
      lastError.delete(profileId)
      throw new Error('Lan mo truoc bi loi khi khoi dong trinh duyet. Thu mo lai.')
    }
    return 'launched'
  }

  return { sessions, launching, lastError, loggedErrors, attachLifecycle, tryLaunchAgain }
}

// ---------------------------------------------------------------------------
// [A] Pattern MOI: 'error' fires, 'exit' never does -> entry van bi xoa
// ---------------------------------------------------------------------------
console.log("[A] 'error' without a matching 'exit' still clears the session entry...")
{
  const engine = makeEngine()
  const fakeProcess = new EventEmitter()
  engine.sessions.set('p1', { process: fakeProcess })
  engine.attachLifecycle('p1', fakeProcess)

  const err = new Error('spawn E:\\fake\\chrome.exe ENOENT')
  fakeProcess.emit('error', err)
  // Deliberately do NOT emit 'exit' - that omission is the whole point.

  check('sessions no longer has the profile', !engine.sessions.has('p1'))
  check('launching no longer has the profile', !engine.launching.has('p1'))
  check('the error was recorded for the next launch() to consume', engine.lastError.get('p1') === err)
  check(
    'exactly 1 error logged, carrying the profile id',
    engine.loggedErrors.length === 1 && engine.loggedErrors[0].profileId === 'p1'
  )
}

// ---------------------------------------------------------------------------
// [A2] Sanity check: bo listener 'error' (pattern CU) -> entry bi ket that
// ---------------------------------------------------------------------------
console.log("[A2] Sanity check: without the 'error' listener (old pattern), the entry gets stuck...")
{
  const sessions = new Map()
  const fakeProcess = new EventEmitter()
  sessions.set('p1', { process: fakeProcess })
  fakeProcess.on('exit', () => sessions.delete('p1')) // ONLY 'exit' - matches pre-fix code

  // With zero 'error' listeners, Node's EventEmitter special-cases 'error'
  // and throws synchronously instead of silently dropping it (confirmed by
  // this script itself: the first version of this file crashed right here
  // before this try/catch was added). In the real app that throw becomes an
  // uncaughtException, caught by src/main/index.ts's safety net
  // (`process.on('uncaughtException', ...)`) and reduced to a single
  // console.error line - it does NOT crash the app (correcting my earlier,
  // wrong claim that it would), but it also does not run any cleanup.
  // Reproduce that same "thrown, then swallowed by something upstream"
  // shape here with a try/catch, then confirm nothing got cleaned up.
  let threwAsExpected = false
  try {
    fakeProcess.emit('error', new Error('spawn ENOENT'))
  } catch {
    threwAsExpected = true
  }
  // Deliberately never emit 'exit'.

  check(
    "old pattern: emit('error') with zero listeners throws (EventEmitter's default 'error' behavior)",
    threwAsExpected === true
  )
  check(
    'old pattern: entry STAYS stuck in sessions (the bug really exists pre-fix)',
    sessions.has('p1') === true
  )
}

// ---------------------------------------------------------------------------
// [B] launch() tu choi lan mo tiep theo bang loi da luu, roi tu xoa (one-shot)
// ---------------------------------------------------------------------------
console.log('[B] launch() throws the stored error exactly once, then clears it...')
{
  const engine = makeEngine()
  const fakeProcess = new EventEmitter()
  engine.sessions.set('p2', { process: fakeProcess })
  engine.attachLifecycle('p2', fakeProcess)
  fakeProcess.emit('error', new Error('spawn ENOENT'))

  let firstThrew = false
  try {
    engine.tryLaunchAgain('p2')
  } catch {
    firstThrew = true
  }
  check('first call after the failure throws (reaches the user)', firstThrew === true)

  let secondThrew = false
  let secondResult = null
  try {
    secondResult = engine.tryLaunchAgain('p2')
  } catch {
    secondThrew = true
  }
  check(
    'second call does NOT throw again (consumed, not stuck forever)',
    secondThrew === false && secondResult === 'launched'
  )
}

// ---------------------------------------------------------------------------
// [C] Pattern MOI trong BrowserLauncher.runProfile(): dang ky theo id, tu go
//     bo listener (khong leak), va chi chay dung 1 lan du ca hai su kien no.
// ---------------------------------------------------------------------------
console.log("[C] BrowserLauncher-side 'process-error' listener resets state exactly once...")
{
  const engineEvents = new EventEmitter()
  const fakeProcess = new EventEmitter()
  let cleanupCount = 0

  let settled = false
  const resetToIdle = () => {
    if (settled) return
    settled = true
    engineEvents.off('process-error', onProcessError)
    cleanupCount++
  }
  function onProcessError(profileId) {
    if (profileId === 'p3') resetToIdle()
  }
  engineEvents.on('process-error', onProcessError)
  fakeProcess.on('exit', resetToIdle)

  check('exactly 1 listener registered on process-error before anything fires', engineEvents.listenerCount('process-error') === 1)

  // A DIFFERENT profile's error must not affect this one.
  engineEvents.emit('process-error', 'someone-elses-profile')
  check('an unrelated profile id does not trigger cleanup', cleanupCount === 0)

  engineEvents.emit('process-error', 'p3')
  check('cleanup ran exactly once for the matching id', cleanupCount === 1)
  check('the process-error listener was removed (no leak across many opens)', engineEvents.listenerCount('process-error') === 0)

  // Node does not guarantee 'exit' stays silent after 'error' already fired
  // (see the header comment) - if it does fire anyway, cleanup must NOT run
  // a second time.
  fakeProcess.emit('exit')
  check("a later 'exit' does not run cleanup a second time", cleanupCount === 1)
}

console.log('')
if (failures > 0) {
  console.log(`FAIL - ${failures} check(s) did not pass.`)
  process.exit(1)
}
console.log(
  "PASS - 'error' on session.process (without a matching 'exit') still clears ShardEngine's\n" +
    "sessions/launching, records the failure for the next launch() call to surface exactly\n" +
    'once, and BrowserLauncher.runProfile() resets its own state exactly once without leaking\n' +
    'its engineEvents listener.'
)
