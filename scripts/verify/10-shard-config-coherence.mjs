// Run with: node scripts/verify/10-shard-config-coherence.mjs
//
// The verification layer this branch was missing — and the exact gap all three
// whole-branch Critical findings slipped through. Every earlier script checked
// one function against hand-built inputs; none ever asked the question that
// matters: "after the app writes its overrides onto a REAL ShardX profile, is
// the resulting config still a config a real machine could produce?"
//
// It creates real profiles through the SDK, applies the REAL compiled
// toShardOverrides() exactly the way production does (ensureShardId() writes it
// once at creation, ShardEngine.launch() re-applies it on every launch — both
// go through Profile.withOverride() + saveProfile()), reads the saved JSON back
// and asserts three families of invariants:
//
//   [1] LOCALE COHERENCE. A ShardX config carries the locale in four
//       independent places (navigator.language / navigator.languages /
//       navigator.accept_language / icu_locale) and withOverride() merges only
//       one level deep, so writing just `navigator.language` left the other
//       three at the template value. All 170 bundled templates are pl-PL, so
//       every profile shipped navigator.language "vi-VN" next to
//       languages[0] "pl-PL" and an Accept-Language header of pl-PL —
//       `navigator.language !== navigator.languages[0]` is about the cheapest
//       bot check in existence.
//
//   [2] SCREEN GEOMETRY COHERENCE. The old override sent
//       `screen: {width, height}` from defaultFingerprint() (1920x1080). Merged
//       one level deep, that replaced two of ten screen keys and left
//       avail_width/avail_height and the whole window.* block at the template's
//       numbers, e.g. width=1920 with availWidth=2560 — geometry no display can
//       produce.
//
//   [3] PER-PROFILE VARIETY. screen / hardware_concurrency / webgl.renderer
//       must differ between profiles. The old override pinned all three to the
//       same app-level defaults on every profile (1920x1080 / 12 cores / 8 GB),
//       which is a linkability signal across all 109 real accounts and destroys
//       the primary goal of the whole ShardX integration.
//
// Every assertion is paired with a sanity check that restores the PREVIOUS
// behaviour and proves the assertion actually fails on it — a green test that
// cannot go red proves nothing.
//
// Uses esbuild (already present via vite) to compile the REAL
// src/main/services/FingerprintEngine.ts, same technique as 03/08 — no
// hand-reproduced logic. cacheDir is absolute (Task 1 finding: the SDK does not
// resolve() it, and a relative one desynchronises chrome.exe from the SDK).

import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ShardX, resolveAutoFields } from '@proxyshard/shardx'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')
const SRC = join(ROOT, 'src', 'main', 'services', 'FingerprintEngine.ts')

const tmpDir = mkdtempSync(join(tmpdir(), 'shard-coherence-'))
const outFile = join(tmpDir, 'FingerprintEngine.compiled.mjs')
const esbuildBin = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild')
execFileSync(esbuildBin, [SRC, '--format=esm', `--outfile=${outFile}`], { stdio: 'inherit' })

const { toShardOverrides, defaultFingerprint } = await import(pathToFileURL(outFile).href)

let failures = 0
function check(name, cond, detail) {
  if (cond) {
    console.log(`  OK   - ${name}`)
  } else {
    failures++
    console.error(`  FAIL - ${name}${detail ? `\n         ${detail}` : ''}`)
  }
}

// cacheDir MUST be absolute. Reuse .spike-cache so the engine + fingerprint
// library installed by earlier verify scripts are not re-downloaded.
const sdk = new ShardX({ cacheDir: resolve(ROOT, '.spike-cache') })
const createdIds = []

/** Create a profile and apply overrides exactly the way production does. */
async function makeProfile(fp, template) {
  const created = await sdk.createProfile(template, template ? {} : { platform: 'windows' })
  createdIds.push(created.id)
  const assigned = JSON.parse(JSON.stringify(created.config)) // before any override
  if (fp) {
    // Same two calls ensureShardId()/launch() make: withOverride + saveProfile.
    sdk.saveProfile(sdk.openProfile(created.id).withOverride(toShardOverrides(fp)))
  }
  return { id: created.id, assigned, config: sdk.openProfile(created.id).config }
}

/** Apply a RAW override object (used only by the sanity checks that replay the
 *  previous, buggy override shapes). */
function applyRaw(id, raw) {
  sdk.saveProfile(sdk.openProfile(id).withOverride(raw))
  return sdk.openProfile(id).config
}

function localeCoherent(cfg) {
  const nav = cfg.navigator ?? {}
  const langs = Array.isArray(nav.languages) ? nav.languages : []
  const problems = []
  if (!nav.language) problems.push('navigator.language missing')
  if (langs[0] !== nav.language) problems.push(`languages[0]=${JSON.stringify(langs[0])} !== language=${JSON.stringify(nav.language)}`)
  if (cfg.icu_locale !== nav.language) problems.push(`icu_locale=${JSON.stringify(cfg.icu_locale)} !== language=${JSON.stringify(nav.language)}`)
  if (typeof nav.accept_language !== 'string' || !nav.accept_language.startsWith(String(nav.language))) {
    problems.push(`accept_language=${JSON.stringify(nav.accept_language)} does not lead with language=${JSON.stringify(nav.language)}`)
  }
  return problems
}

function geometryProblems(cfg) {
  const s = cfg.screen ?? {}
  const w = cfg.window ?? {}
  const problems = []
  const rule = (name, cond, got) => { if (!cond) problems.push(`${name} (${got})`) }
  rule('avail_width <= width', s.avail_width <= s.width, `${s.avail_width} vs ${s.width}`)
  rule('avail_height <= height', s.avail_height <= s.height, `${s.avail_height} vs ${s.height}`)
  rule('window.outer_width <= screen.avail_width', w.outer_width <= s.avail_width, `${w.outer_width} vs ${s.avail_width}`)
  rule('window.outer_height <= screen.avail_height', w.outer_height <= s.avail_height, `${w.outer_height} vs ${s.avail_height}`)
  rule('window.inner_width <= window.outer_width', w.inner_width <= w.outer_width, `${w.inner_width} vs ${w.outer_width}`)
  rule('window.inner_height <= window.outer_height', w.inner_height <= w.outer_height, `${w.inner_height} vs ${w.outer_height}`)
  return problems
}

try {
  // =====================================================================
  // [1] LOCALE COHERENCE
  // =====================================================================
  console.log('[1] Locale: all four fields must agree after the app writes its overrides...')

  // 1a. A concrete tag — what the 109 migrated profiles carry (upgradeFingerprint
  //     keeps their old "vi-VN"). toShardOverrides() must write all four fields.
  const concreteFp = { ...defaultFingerprint(), language: 'vi-VN' }
  const p1 = await makeProfile(concreteFp)
  console.log(`  template locale before override: ${JSON.stringify(p1.assigned.navigator.language)} / ${JSON.stringify(p1.assigned.navigator.languages)} / icu ${JSON.stringify(p1.assigned.icu_locale)}`)
  check('template really did ship pl-PL (premise of the whole finding)', p1.assigned.navigator.language === 'pl-PL')
  const probs1 = localeCoherent(p1.config)
  check('concrete locale "vi-VN": language / languages[0] / accept_language / icu_locale all agree', probs1.length === 0, probs1.join('; '))
  check('navigator.language is the requested tag', p1.config.navigator.language === 'vi-VN')
  check('icu_locale followed it', p1.config.icu_locale === 'vi-VN')
  check(
    'accept_language is a real header, not the template one',
    p1.config.navigator.accept_language === 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    `got ${JSON.stringify(p1.config.navigator.accept_language)}`
  )

  // 1b. The 'auto' sentinel — the default for new profiles. The saved config
  //     keeps the sentinel; the SDK resolves it at launch time. Run the SDK's
  //     own resolveAutoFields() (what Browser.launch does, dist/browser.js:107)
  //     and assert the result is coherent too. Works offline: with no reachable
  //     geo provider it falls back to the host locale and still writes all four.
  const autoFp = defaultFingerprint()
  check("defaultFingerprint() uses the 'auto' sentinel for language", autoFp.language === 'auto')
  const p2 = await makeProfile(autoFp)
  check("saved config keeps navigator.language === 'auto' (resolved per launch, not frozen)", p2.config.navigator.language === 'auto')
  const autoCfg = JSON.parse(JSON.stringify(p2.config))
  await resolveAutoFields(autoCfg, null) // same call the SDK makes before spawning
  console.log(`  resolved at "launch": ${JSON.stringify(autoCfg.navigator.language)} / ${JSON.stringify(autoCfg.navigator.languages)} / icu ${JSON.stringify(autoCfg.icu_locale)}`)
  const probs2 = localeCoherent(autoCfg)
  check("'auto' resolves to a coherent set of all four locale fields", probs2.length === 0, probs2.join('; '))
  check("'auto' also overwrote the template's pl-PL leftovers", autoCfg.navigator.language !== 'pl-PL' || autoCfg.navigator.languages[0] === 'pl-PL')

  // ---- sanity: replay the PREVIOUS override shape (only navigator.language) ----
  console.log('\n  Sanity 1: the old override wrote only navigator.language — the check must catch it...')
  const pOld = await makeProfile(null)
  const oldCfg = applyRaw(pOld.id, { navigator: { language: 'vi-VN' } }) // literal previous behaviour
  const probsOld = localeCoherent(oldCfg)
  console.log(`  old behaviour produced: language=${JSON.stringify(oldCfg.navigator.language)} languages=${JSON.stringify(oldCfg.navigator.languages)} accept=${JSON.stringify(oldCfg.navigator.accept_language)} icu=${JSON.stringify(oldCfg.icu_locale)}`)
  check(
    'sanity: old shape leaves language !== languages[0] and a stale accept_language/icu_locale (proves check [1] is load-bearing)',
    probsOld.length >= 3,
    `only ${probsOld.length} problem(s) detected: ${probsOld.join('; ')}`
  )

  // =====================================================================
  // [2] SCREEN GEOMETRY COHERENCE
  // =====================================================================
  console.log('\n[2] Screen geometry: screen.* and window.* must stay internally consistent...')
  const geoProfiles = [p1, p2]
  for (const [i, p] of geoProfiles.entries()) {
    const probs = geometryProblems(p.config)
    check(
      `profile ${i + 1} (${p.config.screen.width}x${p.config.screen.height}) geometry consistent`,
      probs.length === 0,
      probs.join('; ')
    )
  }
  check("toShardOverrides() no longer sends 'screen' at all", !('screen' in toShardOverrides(concreteFp)))
  check(
    'screen survived the override byte-for-byte (SDK stays the source of truth)',
    JSON.stringify(p1.config.screen) === JSON.stringify(p1.assigned.screen)
  )

  // ---- sanity: replay the old `screen: {width,height}` override on a template
  // whose real screen is BIGGER than the hardcoded 1920x1080 ----
  console.log('\n  Sanity 2: the old override pinned screen to 1920x1080 — the check must catch the impossible geometry...')
  const pBig = await makeProfile(null, 'win-rx7800xt') // known 2560x1440 template
  check('sanity premise: template really is bigger than 1920x1080', pBig.assigned.screen.width === 2560)
  const bigCfg = applyRaw(pBig.id, { screen: { width: 1920, height: 1080 } }) // literal previous behaviour
  const probsBig = geometryProblems(bigCfg)
  console.log(`  old behaviour produced: screen=${bigCfg.screen.width}x${bigCfg.screen.height} avail=${bigCfg.screen.avail_width}x${bigCfg.screen.avail_height} window.outer=${bigCfg.window.outer_width}x${bigCfg.window.outer_height}`)
  check(
    'sanity: old shape yields avail/window larger than the screen itself (proves check [2] is load-bearing)',
    probsBig.length > 0,
    'no geometry problem detected'
  )

  // =====================================================================
  // [3] PER-PROFILE VARIETY
  // =====================================================================
  //
  // Expressed over a batch rather than over exactly two consecutive profiles on
  // purpose. `randomizeHardware()` brackets the core count to the HOST cpu
  // count ([host-4, host+2] out of X86_CORES), so on a 16-core machine the pool
  // is only {12, 16}: demanding that two consecutive profiles differ would fail
  // ~50% of the time by chance and say nothing about the bug. The property the
  // fix is actually about is "not every profile is identical", so the batch is
  // asserted to contain more than one distinct value per field. With N below,
  // a false failure needs every draw to land on the same value.
  const N = 12
  console.log(`\n[3] Variety across ${N} profiles created back-to-back (screen / hardware_concurrency / webgl.renderer)...`)
  const batch = []
  for (let i = 0; i < N; i++) batch.push(await makeProfile(defaultFingerprint()))

  const screens = new Set(batch.map((p) => `${p.config.screen.width}x${p.config.screen.height}`))
  const cores = new Set(batch.map((p) => p.config.navigator.hardware_concurrency))
  const renderers = new Set(batch.map((p) => p.config.webgl.renderer))
  const mems = new Set(batch.map((p) => p.config.navigator.device_memory))
  console.log(`  distinct screens: ${screens.size} -> ${[...screens].join(', ')}`)
  console.log(`  distinct hardware_concurrency: ${cores.size} -> ${[...cores].join(', ')}`)
  console.log(`  distinct device_memory: ${mems.size} -> ${[...mems].join(', ')} (host-capped by the SDK; may legitimately be 1)`)
  console.log(`  distinct webgl.renderer: ${renderers.size}`)
  check('screens differ between profiles', screens.size > 1)
  check('hardware_concurrency differs between profiles', cores.size > 1)
  check('webgl.renderer differs between profiles', renderers.size > 1)

  const overrideKeys = toShardOverrides(defaultFingerprint())
  const navKeys = Object.keys(overrideKeys.navigator ?? {})
  check("toShardOverrides() sends no 'hardware_concurrency'", !navKeys.includes('hardware_concurrency'), `nav keys: ${navKeys.join(', ')}`)
  check("toShardOverrides() sends no 'device_memory'", !navKeys.includes('device_memory'), `nav keys: ${navKeys.join(', ')}`)
  check(
    'every profile kept the hardware the SDK assigned it',
    batch.every((p) => p.config.navigator.hardware_concurrency === p.assigned.navigator.hardware_concurrency
      && p.config.navigator.device_memory === p.assigned.navigator.device_memory)
  )

  // ---- sanity: replay the old override on the same batch ----
  console.log('\n  Sanity 3: the old override pinned screen/cores/memory to app defaults — the check must catch the uniformity...')
  const fp = defaultFingerprint()
  const oldShape = {
    navigator: { hardware_concurrency: fp.hardwareConcurrency, device_memory: fp.deviceMemory, language: fp.language },
    screen: { width: fp.screen.width, height: fp.screen.height },
    timezone: fp.timezone
  }
  const oldBatch = batch.map((p) => applyRaw(p.id, oldShape))
  const oldScreens = new Set(oldBatch.map((c) => `${c.screen.width}x${c.screen.height}`))
  const oldCores = new Set(oldBatch.map((c) => c.navigator.hardware_concurrency))
  const oldMems = new Set(oldBatch.map((c) => c.navigator.device_memory))
  console.log(`  old behaviour: ${oldScreens.size} distinct screen(s) -> ${[...oldScreens].join(', ')}; ${oldCores.size} distinct core count(s) -> ${[...oldCores].join(', ')}`)
  check(
    'sanity: old shape collapses ALL profiles onto one screen / core count / memory (proves check [3] is load-bearing)',
    oldScreens.size === 1 && oldCores.size === 1 && oldMems.size === 1
  )
  check(
    'sanity: and the collapsed values are this app\'s placeholders, not anything the SDK picked',
    [...oldScreens][0] === '1920x1080' && [...oldCores][0] === 12 && [...oldMems][0] === 8
  )
} finally {
  for (const id of createdIds) {
    try { sdk.deleteProfile(id) } catch { /* best-effort */ }
  }
}

if (failures > 0) {
  console.error(`\nFAIL - ${failures} check(s) did not pass.`)
  process.exit(1)
}
console.log('\nPASS - profiles written through toShardOverrides() stay internally coherent: one locale across all four')
console.log('locale fields (concrete tag and the "auto" sentinel alike), screen/window geometry a real display could')
console.log('produce, and screen / CPU cores / GPU that differ from profile to profile instead of collapsing onto')
console.log("this app's placeholder values. All three checks were shown to fail on the previous behaviour.")
