// Run with: node scripts/verify/03-migrate-fp.mjs
//
// Verifies the review findings on src/main/services/FingerprintEngine.ts:
//  - Finding 1: upgradeFingerprint() preserves platform/language/languages/
//    timezone/hardwareConcurrency from a legacy fingerprint instead of wiping
//    them via defaultFingerprint(); blockWebRTC:boolean is mapped correctly
//    onto the webrtc enum.
//  - Finding 2: fromShardConfig() correctly detects 'macos' from ShardX's real
//    navigator.platform convention (value "macOS" — confirmed by reading
//    node_modules/@proxyshard/shardx/dist/randomize.js lines 73-75, where the
//    SDK itself compares plat === "macOS" / "Windows" / "Linux").
//  - Finding 3: fromShardConfig() reads noise[v].enabled (each vector is an
//    OBJECT), not the truthiness of the noise[v] object itself — confirmed by
//    reading node_modules/@proxyshard/shardx/dist/profile.js's setNoise(),
//    where each vector is written as { enabled, seed, ...knob }.
//  - Fix round 2 finding: upgradeFingerprint() must not throw on null/
//    undefined/non-object input. A DB row whose `fingerprint` column happens
//    to contain the literal string "null" parses to the JS value null, which
//    used to reach `old.languages` unguarded and throw a TypeError, breaking
//    ProfileStore.list()'s .map() for every profile, not just the bad row.
//
// This does NOT hand-reproduce the logic: it uses esbuild (already present in
// node_modules via vite) to compile the REAL
// src/main/services/FingerprintEngine.ts to a temp .mjs and imports the
// compiled output directly. That source file has no runtime dependency on
// Electron (only an `import type` from @shared/types, erased at compile
// time), so esbuild can compile it standalone — unlike src/main/db.ts, which
// needs Electron's app.getPath() and can't be imported directly (see
// scripts/verify/02b-race.mjs and task-3-report.md section 4).

import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')
const SRC = join(ROOT, 'src', 'main', 'services', 'FingerprintEngine.ts')

const tmpDir = mkdtempSync(join(tmpdir(), 'fp-verify-'))
const outFile = join(tmpDir, 'FingerprintEngine.compiled.mjs')
const esbuildBin = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild')

execFileSync(esbuildBin, [SRC, '--format=esm', `--outfile=${outFile}`], { stdio: 'inherit' })

const { upgradeFingerprint, fromShardConfig, defaultFingerprint } = await import(pathToFileURL(outFile).href)

let failures = 0
function check(name, cond) {
  if (cond) {
    console.log(`  OK   - ${name}`)
  } else {
    failures++
    console.error(`  FAIL - ${name}`)
  }
}

// ===== Finding 1 =====
console.log('[1] upgradeFingerprint() on a legacy (seed-based) fingerprint...')
const legacy = {
  seed: 123456789,
  platform: 'windows',
  brand: 'Chrome',
  browserVersion: '144.0.0.0',
  language: 'en-US',
  languages: ['en-US', 'en'],
  timezone: 'America/New_York',
  hardwareConcurrency: 16,
  blockWebRTC: true
}
const upgraded = upgradeFingerprint(legacy)
console.log('  result:', JSON.stringify(upgraded))
check('timezone preserved (America/New_York)', upgraded.timezone === 'America/New_York')
check('language preserved (en-US)', upgraded.language === 'en-US')
check('hardwareConcurrency preserved (16)', upgraded.hardwareConcurrency === 16)
check("blockWebRTC:true -> webrtc === 'block'", upgraded.webrtc === 'block')
check('platform preserved (windows)', upgraded.platform === 'windows')
check('languages preserved', JSON.stringify(upgraded.languages) === JSON.stringify(['en-US', 'en']))
check('deviceId (no legacy equivalent) taken from defaultFingerprint = empty string', upgraded.deviceId === '')
check('no seed/brand/browserVersion left on the result', !('seed' in upgraded) && !('brand' in upgraded) && !('browserVersion' in upgraded))

check("blockWebRTC:false -> webrtc === 'auto'", upgradeFingerprint({ ...legacy, blockWebRTC: false }).webrtc === 'auto')

const emptyOldFp = upgradeFingerprint({})
const def = defaultFingerprint()
check('old = {} (nothing to preserve) -> identical to defaultFingerprint()', JSON.stringify(emptyOldFp) === JSON.stringify(def))

// ===== Finding 2 =====
console.log("\n[2] fromShardConfig() detects platform using the SDK's real navigator.platform convention...")
check("navigator.platform='macOS' -> 'macos'", fromShardConfig({ navigator: { platform: 'macOS' } }).platform === 'macos')
check("navigator.platform='Windows' -> 'windows'", fromShardConfig({ navigator: { platform: 'Windows' } }).platform === 'windows')
check("navigator.platform='Linux' -> 'linux'", fromShardConfig({ navigator: { platform: 'Linux' } }).platform === 'linux')

// ===== Finding 3 =====
console.log('\n[3] fromShardConfig() reads noise[v].enabled (an object), not the truthiness of noise[v]...')
const noiseAllDisabled = {
  noise: {
    canvas: { enabled: false, seed: 0 },
    webgl: { enabled: false, seed: 0, intensity: 0.0005 },
    audio: { enabled: false, seed: 0 },
    client_rects: { enabled: false, seed: 0 },
    sensors: { enabled: false, seed: 0 },
    fonts: { enabled: false, seed: 0 }
  }
}
check(
  'all 6 vectors enabled:false -> noise=[] (not all 6)',
  fromShardConfig(noiseAllDisabled).noise.length === 0
)

const noiseMixed = {
  noise: {
    canvas: { enabled: true, seed: 42 },
    webgl: { enabled: false, seed: 0 },
    audio: { enabled: true, seed: 7 },
    client_rects: { enabled: false, seed: 0 },
    sensors: { enabled: false, seed: 0 },
    fonts: { enabled: false, seed: 0 }
  }
}
check(
  'only canvas+audio enabled:true -> noise=["canvas","audio"]',
  JSON.stringify(fromShardConfig(noiseMixed).noise) === JSON.stringify(['canvas', 'audio'])
)

// ===== Fix round 2 finding: upgradeFingerprint() must not throw on garbage input =====
console.log('\n[4] upgradeFingerprint() with garbage input must not throw and must return a valid Fingerprint...')
// null/undefined are the concrete regression (JSON.parse('null') === null, and
// the old code did `old.languages` unguarded). {}/string/number/array are
// included for broader coverage of "any JSON.parse() result", since the
// `fingerprint` column's declared type (TEXT NOT NULL) does not guarantee the
// parsed value is a plain object.
const garbageInputs = [
  ['null', null],
  ['undefined', undefined],
  ['{} (empty object)', {}],
  ['string', 'not-an-object'],
  ['number', 42],
  ['array', [1, 2, 3]]
]
const expectedDefaultJson = JSON.stringify(defaultFingerprint())
for (const [label, input] of garbageInputs) {
  try {
    const result = upgradeFingerprint(input)
    check(
      `upgradeFingerprint(${label}) does not throw, returns a defaultFingerprint()-shaped result`,
      JSON.stringify(result) === expectedDefaultJson
    )
  } catch (e) {
    failures++
    console.error(`  FAIL - upgradeFingerprint(${label}) threw: ${e.constructor.name}: ${e.message}`)
  }
}

if (failures > 0) {
  console.error(`\nFAIL - ${failures} check(s) did not pass.`)
  process.exit(1)
}
console.log('\nPASS - upgradeFingerprint() preserves compatible fields (Finding 1) and never throws on garbage input (Fix round 2); fromShardConfig() detects macos correctly (Finding 2) and reads noise.enabled correctly (Finding 3).')
