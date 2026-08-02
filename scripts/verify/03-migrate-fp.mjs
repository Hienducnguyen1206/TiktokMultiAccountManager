// Chay bang: node scripts/verify/03-migrate-fp.mjs
//
// Kiem chung 3 finding cua vong review Task 3 tren
// src/main/services/FingerprintEngine.ts:
//  - Finding 1: upgradeFingerprint() giu lai platform/language/languages/
//    timezone/hardwareConcurrency tu fingerprint kieu CU thay vi xoa sach bang
//    defaultFingerprint(); blockWebRTC:boolean duoc anh xa dung sang webrtc enum.
//  - Finding 2: fromShardConfig() nhan dung 'macos' tu quy uoc navigator.platform
//    THAT cua ShardX (gia tri "macOS" - da xac nhan bang cach doc
//    node_modules/@proxyshard/shardx/dist/randomize.js dong 73-75, noi SDK tu so
//    sanh chinh xac plat === "macOS" / "Windows" / "Linux").
//  - Finding 3: fromShardConfig() doc dung noise[v].enabled (moi vector la MOT
//    OBJECT), khong phai truthiness cua chinh object noise[v] - da xac nhan bang
//    cach doc node_modules/@proxyshard/shardx/dist/profile.js ham setNoise(),
//    noi moi vector duoc ghi thanh { enabled, seed, ...knob }.
//
// KHONG TAI HIEN logic bang tay: script nay dung esbuild (co san trong
// node_modules qua vite) de bien dich THAT src/main/services/FingerprintEngine.ts
// roi import thang ket qua bien dich - dung nguyen ham that, khong phai ban chep
// lai. File nguon nay khong phu thuoc Electron (chi `import type` tu
// @shared/types, bi xoa luc bien dich), nen esbuild bien dich duoc doc lap,
// khac voi src/main/db.ts (can app.getPath() cua Electron nen khong the import
// truc tiep - xem scripts/verify/02b-race.mjs va task-3-report.md muc 4).

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
console.log("[1] upgradeFingerprint() tren fingerprint kieu CU (seed-based, dung dung du lieu reviewer yeu cau)...")
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
console.log('  ket qua:', JSON.stringify(upgraded))
check('timezone giu nguyen (America/New_York)', upgraded.timezone === 'America/New_York')
check('language giu nguyen (en-US)', upgraded.language === 'en-US')
check('hardwareConcurrency giu nguyen (16)', upgraded.hardwareConcurrency === 16)
check("blockWebRTC:true -> webrtc === 'block'", upgraded.webrtc === 'block')
check('platform giu nguyen (windows)', upgraded.platform === 'windows')
check('languages giu nguyen', JSON.stringify(upgraded.languages) === JSON.stringify(['en-US', 'en']))
check('deviceId (khong co tuong duong cu) lay tu defaultFingerprint = rong', upgraded.deviceId === '')
check('khong con seed/brand/browserVersion tren ket qua', !('seed' in upgraded) && !('brand' in upgraded) && !('browserVersion' in upgraded))

check("blockWebRTC:false -> webrtc === 'auto'", upgradeFingerprint({ ...legacy, blockWebRTC: false }).webrtc === 'auto')

const empty = upgradeFingerprint({})
const def = defaultFingerprint()
check('old = {} (khong co gi de giu) -> giong het defaultFingerprint()', JSON.stringify(empty) === JSON.stringify(def))

// ===== Finding 2 =====
console.log('\n[2] fromShardConfig() nhan dung platform tu dung quy uoc navigator.platform that cua SDK...')
check("navigator.platform='macOS' -> 'macos'", fromShardConfig({ navigator: { platform: 'macOS' } }).platform === 'macos')
check("navigator.platform='Windows' -> 'windows'", fromShardConfig({ navigator: { platform: 'Windows' } }).platform === 'windows')
check("navigator.platform='Linux' -> 'linux'", fromShardConfig({ navigator: { platform: 'Linux' } }).platform === 'linux')

// ===== Finding 3 =====
console.log('\n[3] fromShardConfig() doc dung noise[v].enabled (object), khong phai truthiness cua noise[v]...')
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
  'tat ca 6 vector enabled:false -> noise=[] (khong phai ca 6)',
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
  'chi canvas+audio enabled:true -> noise=["canvas","audio"]',
  JSON.stringify(fromShardConfig(noiseMixed).noise) === JSON.stringify(['canvas', 'audio'])
)

if (failures > 0) {
  console.error(`\nFAIL - ${failures} kiem tra khong dat.`)
  process.exit(1)
}
console.log('\nPASS - upgradeFingerprint() giu dung field tuong thich (Finding 1); fromShardConfig() nhan dung macos (Finding 2) va doc dung noise.enabled (Finding 3).')
