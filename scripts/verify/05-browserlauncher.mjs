// Run with: node scripts/verify/05-browserlauncher.mjs
//
// INDIRECT verification for Task 5 (src/main/services/BrowserLauncher.ts).
// Cannot import BrowserLauncher.ts or ShardEngine.ts directly: both pull in
// ../db's dataRoot(), which calls Electron's app.getPath() and only works
// inside a real Electron main process — not under plain `node` (same reason
// scripts 01/02/02b/04 in this folder also avoid importing them; see their
// header comments).
//
// Instead this script drives the raw @proxyshard/shardx SDK with the SAME
// call shape ShardEngine.openBrowsing()/closeSession() use internally
// (ShardX.launch() delegates straight to Browser.launch(), and
// ShardEngine's `s` is a ShardX instance too — see node_modules/@proxyshard/
// shardx/dist/index.js, ShardX.launch()), to prove the two mechanics
// BrowserLauncher.runProfile()/stopProfile() now depend on actually hold:
//
//   (a) the resolved session exposes a real ChildProcess at `.process`, and
//       ITS 'exit' event fires once session.stop() runs — this is exactly
//       the hook runProfile() attaches to update ProfileStore.setRunning(
//       false) + emit 'idle' + cleanProfileCache() (BrowserLauncher.ts,
//       inside the `session.process.on('exit', ...)` callback).
//   (b) after stop() resolves, no Chromium process is left alive for that
//       profile (clean shutdown, no orphan).
//
// Deviation from the real openBrowsing() call: this script passes
// --window-position=-32000,-32000 instead of --start-maximized, so no
// visible window flashes on screen during an unattended run. That only
// affects window placement, not process/session lifecycle — irrelevant to
// what is being checked here.
//
// This does NOT replace the manual "click Mo in the running app" step —
// see task-5-report.md for that checklist.

import { ShardX } from '@proxyshard/shardx'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'

let failures = 0
function check(name, cond) {
  if (cond) {
    console.log(`  PASS: ${name}`)
  } else {
    failures++
    console.log(`  FAIL: ${name}`)
  }
}

// Force-exit safety net in case something in the SDK hangs (e.g. stop()
// never resolves) — this script runs unattended, nobody is here to Ctrl+C.
const watchdog = setTimeout(() => {
  console.error('WATCHDOG: script hung past 45s — forcing exit')
  process.exit(1)
}, 45000)

const ANTI_THROTTLE = [
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-features=CalculateNativeWinOcclusion'
]

// Reuse the same cache dir Task 4's spike scripts already populated (~585MB
// of runtime + bundled fingerprints) so this run does not re-download.
const sdk = new ShardX({ cacheDir: resolve('./.spike-cache') })

console.log('[1] Creating a throwaway profile...')
const profile = await sdk.createProfile(undefined, { platform: 'windows' })
console.log('    id =', profile.id)

console.log('[2] openBrowsing-equivalent: sdk.launch(cdp:false, screenMode:profile)...')
const session = await sdk.launch(profile, {
  cdp: false,
  screenMode: 'profile',
  webrtc: 'auto',
  extraArgs: [...ANTI_THROTTLE, '--window-position=-32000,-32000']
})

check('session has a numeric pid', typeof session.pid === 'number' && session.pid > 0)
check('session.process is a real ChildProcess (has .kill)', typeof session.process?.kill === 'function')
check('session.userDataDir exists on disk', existsSync(session.userDataDir))
check('no cdpUrl (matches openBrowsing — CDP not enabled)', !session.cdpUrl)

console.log('[3] Registering an exit listener, mirroring BrowserLauncher.runProfile()...')
let exitFired = false
session.process.on('exit', () => {
  exitFired = true
})

console.log('[4] closeSession-equivalent: calling session.stop()...')
await session.stop()

check('the "exit" event on session.process already fired once stop() resolved', exitFired)
check('process is really gone (no pid alive)', !isAlive(session.pid))

console.log('[5] Cleaning up the throwaway profile...')
sdk.deleteProfile(profile.id)
check('deleteProfile removed it from disk', !sdk.listSavedProfiles().includes(profile.id))

clearTimeout(watchdog)
console.log('')
if (failures > 0) {
  console.log(`FAIL - ${failures} check(s) did not pass.`)
  process.exit(1)
}
console.log(
  'PASS - launch(cdp:false) + stop() behave the way runProfile()/stopProfile() assume:\n' +
    'a real ChildProcess is returned, its "exit" event fires once stop() resolves, and no\n' +
    'process is left running afterwards.'
)

function isAlive(pid) {
  try {
    // signal 0: no-op existence probe, throws if the pid is gone.
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
