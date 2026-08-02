// Run with: node scripts/verify/08-webgl-override-and-readback.mjs
//
// Verifies "Fix round 1" on src/main/services/FingerprintEngine.ts +
// src/main/services/ShardEngine.ts (see task-8-report.md):
//
//  - Bug 1 (as reported): toShardOverrides() was suspected of wiping the
//    real GPU ShardX randomly assigns a new profile, because it always sends
//    `webgl` even when fp.webgl is still blank (a fresh profile's
//    defaultFingerprint()), and Profile.withOverride() merges shallow-but-
//    whole per top-level key (dist/profile.js:25-37: `out[k] = {...out[k],
//    ...v}`), so `webgl: { vendor: '', renderer: '' }` would stomp both
//    fields at once.
//
//    ACTUAL finding (empirically verified before fixing, see task-8-report.md):
//    the PREVIOUS code sent `{ unmasked_vendor, unmasked_renderer }` — keys
//    that do not exist anywhere in ShardX's schema (0 of 170 bundled
//    fingerprint templates contain that string; the README's own
//    "Override fingerprint fields" example and the `webgl.renderer` read
//    example never use it either). That means the previous code's write was
//    a silent no-op for the real fingerprint — confirmed by actually
//    launching a profile and reading gl.getExtension('WEBGL_debug_renderer_info')
//    from a real page: it reported the SDK's real per-profile GPU either way.
//    So the wipe described in the bug report was NOT happening today.
//
//    However, fixing the key names to the real ones (`vendor`/`renderer`) —
//    which is required for fromShardConfig() to ever read anything back (see
//    Bug 2 below) — would, BY ITSELF, introduce exactly the wipe the report
//    described, because a fresh profile's fp.webgl really is blank. So the
//    complete fix is both at once: correct key names AND the empty-guard.
//    Test 1 below proves the real (fixed) function doesn't wipe; the round-1
//    sanity check proves the guard is load-bearing (removing it reproduces a
//    real wipe under the corrected key names); a second, separate sanity
//    check reproduces the historical (wrong-key-name) code to document why
//    it happened to be harmless.
//
//  - Bug 2 (as reported): nothing ever read ShardX's assigned device info
//    (deviceId/userAgent/webgl/screen/deviceMemory) back into the DB row —
//    ShardEngine.ensureShardId() now does, via the new
//    mergeShardDeviceInfo(current, shardConfig), which must update ONLY
//    those five ShardX-sourced fields and leave webrtc/noise/timezone/
//    language/languages/platform/hardwareConcurrency exactly as they were.
//
//    Extra findings made while wiring this up (fromShardConfig() was already
//    broken for two of those five fields, independently of Bug 1):
//     - `deviceId: String(cfg.id ?? '')` — a saved profile's `.config` has NO
//       `id` key at all (id lives only as the Profile wrapper's own property,
//       the folder name — confirmed by reading dist/index.js: saveProfile()
//       serializes `profile.config` only). The real "library entry id" that
//       DOES survive inside `.config` is `name` (e.g. "win-rx7800xt") —
//       confirmed by creating a real profile and reading `.config.name` back.
//     - `webgl: { vendor: gl.unmasked_vendor, renderer: gl.unmasked_renderer }`
//       — same wrong-key-name issue as Bug 1's write side.
//    Both are fixed in fromShardConfig() and covered by Test 3 below. Without
//    these two fixes, Bug 2's whole point (show real device info in the UI)
//    would silently keep failing even after wiring up the readback call.
//
// Uses esbuild (already in node_modules via vite) to compile the REAL
// src/main/services/FingerprintEngine.ts to a temp .mjs, same technique as
// scripts/verify/03-migrate-fp.mjs — no hand-reproduction of the logic under
// test. Creates real ShardX profiles via the SDK (reusing the .spike-cache/
// runtime + fingerprint library already installed from Task 1/2's spikes) to
// test against real bundled fingerprint templates, not hand-built fixtures.

import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ShardX } from '@proxyshard/shardx'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')
const SRC = join(ROOT, 'src', 'main', 'services', 'FingerprintEngine.ts')

const tmpDir = mkdtempSync(join(tmpdir(), 'fp-webgl-verify-'))
const outFile = join(tmpDir, 'FingerprintEngine.compiled.mjs')
const esbuildBin = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild')

execFileSync(esbuildBin, [SRC, '--format=esm', `--outfile=${outFile}`], { stdio: 'inherit' })

const { toShardOverrides, fromShardConfig, defaultFingerprint, mergeShardDeviceInfo } =
  await import(pathToFileURL(outFile).href)

let failures = 0
function check(name, cond) {
  if (cond) {
    console.log(`  OK   - ${name}`)
  } else {
    failures++
    console.error(`  FAIL - ${name}`)
  }
}

// cacheDir MUST be absolute (SDK does not resolve() it — Task 1 finding).
// Reuse .spike-cache: runtime + fingerprint library already installed there
// by earlier verify scripts, avoids a multi-hundred-MB re-download.
const sdk = new ShardX({ cacheDir: resolve(ROOT, '.spike-cache') })
const createdIds = []
async function freshProfile() {
  const p = await sdk.createProfile(undefined, { platform: 'windows' })
  createdIds.push(p.id)
  return p
}
function cleanup() {
  for (const id of createdIds) {
    try { sdk.deleteProfile(id) } catch { /* best-effort */ }
  }
}

try {
  // ===== Test 1: toShardOverrides() no longer wipes the SDK's real GPU =====
  console.log('[1] toShardOverrides(defaultFingerprint()) must not wipe the GPU ShardX just assigned...')
  const p1 = await freshProfile()
  const originalWebgl = { ...p1.config.webgl }
  console.log('  ShardX-assigned GPU:', JSON.stringify(originalWebgl.vendor), JSON.stringify(originalWebgl.renderer))
  check('SDK assigned a non-empty vendor/renderer at createProfile()', !!originalWebgl.vendor && !!originalWebgl.renderer)

  const overrides = toShardOverrides(defaultFingerprint())
  check("toShardOverrides(defaultFingerprint()) omits 'webgl' entirely (fp.webgl is blank)", !('webgl' in overrides))

  const merged1 = sdk.openProfile(p1.id).withOverride(overrides)
  sdk.saveProfile(merged1)
  const reread1 = sdk.openProfile(p1.id).config
  check('vendor unchanged after real write/read round-trip', reread1.webgl.vendor === originalWebgl.vendor)
  check('renderer unchanged after real write/read round-trip', reread1.webgl.renderer === originalWebgl.renderer)
  check('renderer still non-empty (not wiped)', reread1.webgl.renderer !== '')

  // ---- sanity check A: the guard is load-bearing under the CORRECTED key
  // names (proves Test 1 isn't passing "by accident" the same way the old
  // code accidentally didn't wipe anything — see sanity check B below) ----
  console.log('\n  Sanity A: correct key names WITHOUT the empty-guard DOES wipe the GPU (proves the guard matters)...')
  const p2 = await freshProfile()
  const originalWebgl2 = { ...p2.config.webgl }
  const naiveOverrideCorrectKeys = { webgl: { vendor: '', renderer: '' } } // what a fix WITHOUT the guard would send
  const merged2 = sdk.openProfile(p2.id).withOverride(naiveOverrideCorrectKeys)
  sdk.saveProfile(merged2)
  const reread2 = sdk.openProfile(p2.id).config
  check(
    'sanity: unconditional correct-key-name override DOES wipe vendor/renderer to "" (confirms guard is necessary, not decorative)',
    reread2.webgl.vendor === '' && reread2.webgl.renderer === '' && originalWebgl2.vendor !== ''
  )

  // ---- sanity check B: informational only — reproduces the exact PREVIOUS
  // (pre-fix) code's override shape, to document why no live leak existed in
  // production before this fix. Not a pass/fail assertion: "harmless" here
  // is a historical accident (wrong key name), not a guarantee. ----
  console.log('\n  Sanity B (informational): historical unmasked_vendor/unmasked_renderer keys were a no-op...')
  const p3 = await freshProfile()
  const originalWebgl3 = { ...p3.config.webgl }
  const historicalOverride = { webgl: { unmasked_vendor: '', unmasked_renderer: '' } } // literal previous code
  const merged3 = sdk.openProfile(p3.id).withOverride(historicalOverride)
  sdk.saveProfile(merged3)
  const reread3 = sdk.openProfile(p3.id).config
  console.log(
    '  historical code left vendor/renderer untouched:',
    reread3.webgl.vendor === originalWebgl3.vendor && reread3.webgl.renderer === originalWebgl3.renderer
  )
  console.log('  (and added two unused keys instead):', JSON.stringify({ unmasked_vendor: reread3.webgl.unmasked_vendor, unmasked_renderer: reread3.webgl.unmasked_renderer }))

  // ===== Test 2: mergeShardDeviceInfo() updates only ShardX-owned fields =====
  console.log('\n[2] mergeShardDeviceInfo() must preserve user/app fields and update only ShardX-sourced ones...')
  const shardCfg = sdk.openProfile(p1.id).config // reuse Test 1's real, saved config
  const current = {
    deviceId: 'stale-placeholder',
    platform: 'macos',
    userAgent: 'stale-ua',
    // Deliberately 3: not a member of the SDK's X86_CORES pool, so the
    // "differs from the stale value" assertion below can never pass by
    // coincidence on a host whose core bracket happens to contain this number.
    hardwareConcurrency: 3,
    deviceMemory: 32,
    screen: { width: 1234, height: 999 },
    webgl: { vendor: 'stale-vendor', renderer: 'stale-renderer' },
    language: 'en-US',
    languages: ['en-US', 'en'],
    timezone: 'Asia/Ho_Chi_Minh',
    webrtc: 'tcp_only',
    noise: ['canvas', 'audio']
  }
  const mergedFp = mergeShardDeviceInfo(current, shardCfg)
  const fromShard = fromShardConfig(shardCfg)

  // preserved (user/app-owned) fields — must be byte-identical to `current`
  check('webrtc preserved', mergedFp.webrtc === current.webrtc)
  check('noise preserved', JSON.stringify(mergedFp.noise) === JSON.stringify(current.noise))
  check('timezone preserved', mergedFp.timezone === current.timezone)
  check('language preserved', mergedFp.language === current.language)
  check('languages preserved', JSON.stringify(mergedFp.languages) === JSON.stringify(current.languages))
  check('platform preserved', mergedFp.platform === current.platform)

  // updated (ShardX-owned) fields — must match fromShardConfig(shardCfg), and
  // must differ from the stale placeholders in `current` (proves they moved)
  check('deviceId updated to ShardX value', mergedFp.deviceId === fromShard.deviceId && mergedFp.deviceId !== current.deviceId)
  check('userAgent updated to ShardX value', mergedFp.userAgent === fromShard.userAgent && mergedFp.userAgent !== current.userAgent)
  check('webgl updated to ShardX value', JSON.stringify(mergedFp.webgl) === JSON.stringify(fromShard.webgl) && JSON.stringify(mergedFp.webgl) !== JSON.stringify(current.webgl))
  check('screen updated to ShardX value', JSON.stringify(mergedFp.screen) === JSON.stringify(fromShard.screen) && JSON.stringify(mergedFp.screen) !== JSON.stringify(current.screen))
  check('deviceMemory updated to ShardX value', mergedFp.deviceMemory === fromShard.deviceMemory && mergedFp.deviceMemory !== current.deviceMemory)
  // hardwareConcurrency moved from the "preserved" list to this one when
  // toShardOverrides() stopped sending it (whole-branch review, Critical 2):
  // randomizeHardware() is now the only thing that picks it, so the DB has to
  // follow the SDK or the dialog would keep displaying the placeholder 12.
  check(
    'hardwareConcurrency updated to ShardX value',
    mergedFp.hardwareConcurrency === fromShard.hardwareConcurrency && mergedFp.hardwareConcurrency !== current.hardwareConcurrency
  )
  check('deviceId actually looks like a library template id (non-empty, matches config.name)', mergedFp.deviceId === shardCfg.name && mergedFp.deviceId !== '')
  check('webgl.renderer round-tripped from the real SDK-assigned GPU', mergedFp.webgl.renderer === originalWebgl.renderer)

  // ---- sanity check: a naive wholesale overwrite (what mergeShardDeviceInfo
  // deliberately does NOT do) would lose webrtc/noise — proves the narrow
  // merge is necessary, not just a stylistic choice ----
  console.log('\n  Sanity: naive `{ ...current, ...fromShardConfig(cfg) }` / wholesale fromShardConfig(cfg) WOULD lose webrtc/noise...')
  const naiveSpread = { ...current, ...fromShard }
  const naiveWholesale = fromShard
  check(
    'sanity: naive spread overwrites webrtc with fromShardConfig\'s hardcoded "auto" (loses the tcp_only the user/app had)',
    naiveSpread.webrtc === 'auto' && naiveSpread.webrtc !== current.webrtc
  )
  check(
    'sanity: wholesale fromShardConfig(cfg) loses the noise vectors current had set',
    JSON.stringify(naiveWholesale.noise) !== JSON.stringify(current.noise)
  )

  // ===== Test 3: fromShardConfig() key-name fixes, isolated =====
  console.log('\n[3] fromShardConfig() reads deviceId from cfg.name (not the nonexistent cfg.id) and webgl from gl.vendor/gl.renderer...')
  const realisticCfg = {
    name: 'win-rx7800xt', // real saved-profile configs have `name`, never `id`
    navigator: { platform: 'Windows', user_agent: 'Mozilla/5.0 fake-ua', hardware_concurrency: 12, device_memory: 8, language: 'vi-VN' },
    screen: { width: 2560, height: 1440 },
    webgl: { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 7800 XT, D3D11)' },
    timezone: 'auto'
  }
  const parsed = fromShardConfig(realisticCfg)
  check("deviceId reads cfg.name ('win-rx7800xt')", parsed.deviceId === 'win-rx7800xt')
  check('webgl.vendor reads gl.vendor', parsed.webgl.vendor === 'Google Inc. (AMD)')
  check('webgl.renderer reads gl.renderer', parsed.webgl.renderer === 'ANGLE (AMD, AMD Radeon RX 7800 XT, D3D11)')
  check(
    'sanity: this realistic cfg has no top-level `id` key at all (the old cfg.id read was always undefined)',
    !('id' in realisticCfg)
  )
  check(
    'sanity: this realistic cfg.webgl has no unmasked_vendor/unmasked_renderer keys (the old read was always undefined)',
    !('unmasked_vendor' in realisticCfg.webgl) && !('unmasked_renderer' in realisticCfg.webgl)
  )
} finally {
  cleanup()
}

if (failures > 0) {
  console.error(`\nFAIL - ${failures} check(s) did not pass.`)
  process.exit(1)
}
console.log('\nPASS - toShardOverrides() no longer risks wiping ShardX-assigned GPU (Bug 1, fixed together with the')
console.log('previously-inert unmasked_vendor/unmasked_renderer key names); mergeShardDeviceInfo() updates only')
console.log('ShardX-owned fields and preserves user/app-owned ones (Bug 2); fromShardConfig() reads deviceId/webgl')
console.log('from the real schema keys (cfg.name / gl.vendor / gl.renderer) instead of the previous dead keys.')
