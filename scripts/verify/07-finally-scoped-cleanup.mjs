// Run with: node scripts/verify/07-finally-scoped-cleanup.mjs
//
// Verifies the Task 6 review Fix round 1 (Critical, Finding 1) on
// src/main/services/AutomationRunner.ts's runJob(), src/main/services/
// TikTokLogin.ts's loginProfile(), and src/main/services/TikTokSync.ts's
// syncTiktokName().
//
// Bug: openAutomation(profile) can reject WITHOUT this call ever having
// opened anything — ShardEngine.launch() checks `sessions.has(profile.id) ||
// launching.has(profile.id)` SYNCHRONOUSLY and throws 'Profile dang mo'
// before touching anything if the profile is already open (manual browsing
// via BrowserLauncher, a queue job via AutomationRunner, or another
// automation flow for the SAME profile.id). The pre-fix `finally` blocks in
// these 3 files called closeSession(profile.id) and
// ProfileStore.setRunning(profile.id, false) UNCONDITIONALLY. closeSession()
// looks the session up by profile.id in ShardEngine's single SHARED
// `sessions` map — it has no notion of "who owns this call" — so a REJECTED
// call's finally block would still reach in and .stop() whatever live
// session is CURRENTLY sitting under that profile.id, silently killing a
// different, unrelated, still-in-use browser window.
//
// Fix: gate closeSession()/setRunning(false) behind `if (browser)` — browser
// is only ever non-null when THIS call's own openAutomation() resolved.
//
// This also covers a scenario the original review finding did not: it
// described the collision as "user manually opened profile P" (the only flow
// that calls ProfileStore.setRunning(true), so profile.status === 'running'
// happens to also guard TikTokLogin/TikTokSync against THAT specific
// collision). But `grep -rn "setRunning(" src/` confirms
// BrowserLauncher.runProfile() is the ONLY caller of setRunning(id, true) —
// AutomationRunner's queue jobs and AnalyticsService's follower reads never
// call it. So a queue job holding profile P open, with a login/sync attempt
// on the SAME profile P racing in, is NOT caught by that guard, and TikTokLogin.ts /
// TikTokSync.ts need the identical `if (browser)` fix. Scenario [A2] below
// reproduces exactly that case.
//
// Cannot import the real .ts files directly — ShardEngine.ts pulls in ../db's
// dataRoot(), which needs Electron's app.getPath() and does not run under
// plain `node` (same constraint noted in every other script in this folder).
// Reimplements the exact shape of ShardEngine's shared `sessions` map +
// closeSession(), and the exact shape of the fixed vs. pre-fix finally-block
// pattern, instead.

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
// Reimplementation of ShardEngine's shared session map, matching
// src/main/services/ShardEngine.ts's launch()/closeSession() exactly:
// launch() throws synchronously if the profile is already open (BEFORE
// touching anything), closeSession() looks the session up by id only.
// ---------------------------------------------------------------------------
function makeEngine() {
  const sessions = new Map()
  return {
    sessions,
    openAutomation(profileId) {
      if (sessions.has(profileId)) throw new Error('Profile dang mo')
      const session = { stopped: false, stop: async () => { session.stopped = true } }
      sessions.set(profileId, session)
      const browser = { closed: false, close: async () => { browser.closed = true } }
      return { browser, session }
    },
    async closeSession(profileId) {
      const session = sessions.get(profileId)
      if (!session) return
      sessions.delete(profileId)
      await session.stop()
    }
  }
}

function makeProfileStore() {
  const runningIds = new Set()
  return {
    runningIds,
    setRunning(id, running) {
      if (running) runningIds.add(id)
      else runningIds.delete(id)
    }
  }
}

// ---------------------------------------------------------------------------
// Fixed pattern (current code, after Fix round 1): closeSession/setRunning
// only run when THIS call's own browser is non-null.
// ---------------------------------------------------------------------------
async function fixedFinally(engine, store, profileId, browser) {
  if (browser) {
    await engine.closeSession(profileId)
    store.setRunning(profileId, false)
  }
}

// ---------------------------------------------------------------------------
// Pre-fix pattern (Task 6 as first submitted, before review): unconditional.
// ---------------------------------------------------------------------------
async function unfixedFinally(engine, store, profileId) {
  await engine.closeSession(profileId)
  store.setRunning(profileId, false)
}

// ---------------------------------------------------------------------------
// [A] Fixed pattern: a rejected second call (colliding with MANUAL browsing,
//     the case the review finding described) must not touch the live session.
// ---------------------------------------------------------------------------
console.log('[A] Rejected call vs. manual browsing: fixed pattern leaves the live session alone...')
{
  const engine = makeEngine()
  const store = makeProfileStore()

  // "User manually opened profile P" via BrowserLauncher.runProfile().
  const { session: session1 } = engine.openAutomation('P')
  store.setRunning('P', true)

  // e.g. TikTokLogin.loginProfile('P') fires while it's still open.
  let browser2 = null
  try {
    const opened = engine.openAutomation('P')
    browser2 = opened.browser
  } catch {
    browser2 = null // openAutomation threw -> browser2 stays null, exactly like the real code
  }
  check('second call actually got rejected (browser2 is still null)', browser2 === null)

  await fixedFinally(engine, store, 'P', browser2)

  check('session1 was NOT stopped', session1.stopped === false)
  check("ShardEngine's sessions map still holds session1 for P", engine.sessions.get('P') === session1)
  check("ProfileStore still reports P as running (rejected caller's finally didn't touch it)", store.runningIds.has('P') === true)
}

// ---------------------------------------------------------------------------
// [A2] Fixed pattern: a rejected second call vs. ANOTHER AUTOMATION flow
//      (no ProfileStore.setRunning(true) involved at all) — the case the
//      review finding's "TikTokLogin/TikTokSync are immune" reasoning misses.
// ---------------------------------------------------------------------------
console.log('[A2] Rejected call vs. a queue job (setRunning(true) never called): still leaves it alone...')
{
  const engine = makeEngine()
  const store = makeProfileStore()

  // e.g. AutomationRunner.runJob() opens profile P for an upload job. It
  // never calls store.setRunning('P', true) — confirmed by
  // `grep -rn "setRunning(" src/`, only BrowserLauncher.runProfile() does.
  const { session: session1 } = engine.openAutomation('P')

  // e.g. TikTokLogin.loginProfile('P') fires while the job is running. Its
  // own `if (profile.status === 'running') return` guard does NOT catch
  // this, because ProfileStore never heard about session1.
  let browser2 = null
  try {
    const opened = engine.openAutomation('P')
    browser2 = opened.browser
  } catch {
    browser2 = null
  }
  check('second call actually got rejected (browser2 is still null)', browser2 === null)

  await fixedFinally(engine, store, 'P', browser2)

  check('session1 (the queue job) was NOT stopped by the rejected login attempt', session1.stopped === false)
  check("ShardEngine's sessions map still holds session1 for P", engine.sessions.get('P') === session1)
}

// ---------------------------------------------------------------------------
// [B] Sanity check: WITHOUT the `if (browser)` guard, the same scenario
//     kills the live session -> proves this test would catch the regression.
// ---------------------------------------------------------------------------
console.log('[B] Sanity check: removing the `if (browser)` guard reproduces the bug...')
{
  const engine = makeEngine()
  const store = makeProfileStore()

  const { session: session1 } = engine.openAutomation('P')
  store.setRunning('P', true)

  try {
    engine.openAutomation('P')
  } catch {
    /* expected */
  }

  await unfixedFinally(engine, store, 'P')

  check('BUG REPRODUCED: session1 got stopped by the rejected caller', session1.stopped === true)
  check('BUG REPRODUCED: sessions map no longer has P', engine.sessions.has('P') === false)
  check('BUG REPRODUCED: ProfileStore no longer reports P as running', store.runningIds.has('P') === false)
}

// ---------------------------------------------------------------------------
// [C] Fixed pattern still cleans up correctly on the SUCCESS path (the fix
//     must not just turn cleanup off entirely).
// ---------------------------------------------------------------------------
console.log('[C] Fixed pattern still closes its OWN session on the success path...')
{
  const engine = makeEngine()
  const store = makeProfileStore()

  const { browser, session } = engine.openAutomation('Q')
  store.setRunning('Q', true)

  await fixedFinally(engine, store, 'Q', browser)

  check('own session WAS stopped', session.stopped === true)
  check('sessions map no longer has Q', engine.sessions.has('Q') === false)
  check('ProfileStore no longer reports Q as running', store.runningIds.has('Q') === false)
}

console.log('')
if (failures > 0) {
  console.log(`FAIL - ${failures} check(s) did not pass.`)
  process.exit(1)
}
console.log(
  'PASS - a rejected openAutomation() call (profile already open elsewhere, whether manual\n' +
    'browsing or another automation flow) no longer reaches into ShardEngine\'s shared session\n' +
    "map and stops a different, unrelated, still-live session; the fixed pattern still fully\n" +
    'cleans up its own session on the success path; and removing the `if (browser)` guard\n' +
    'reproduces the original bug, confirming this test would catch a regression.'
)
