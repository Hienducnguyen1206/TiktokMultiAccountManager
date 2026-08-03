import type { Fingerprint, GeoConfig, NoiseVector } from '@shared/types'

const ALL_VECTORS: NoiseVector[] = ['canvas', 'webgl', 'audio', 'client_rects', 'sensors', 'fonts']

/** `Number(undefined)`/`Number('')`/`Number('abc')` all produce NaN or 0, which
 *  would silently become a fingerprint value no real machine reports. */
function numOr(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function readGeo(raw: unknown): GeoConfig {
  const g = (raw ?? {}) as Record<string, unknown>
  return {
    mode: g.mode === 'manual' ? 'manual' : 'auto',
    latitude: numOr(g.latitude, 0),
    longitude: numOr(g.longitude, 0),
    accuracy: numOr(g.accuracy, 50)
  }
}

/**
 * Fill in fields added to `Fingerprint` after a row was written.
 *
 * `ProfileStore.rowToProfile()` trusts any parsed blob that carries a string
 * `deviceId` and uses it VERBATIM — it does not run `upgradeFingerprint()` on
 * it (that one is for pre-ShardX rows and deliberately discards deviceId /
 * userAgent / webgl / screen, so running it here would wipe the real device
 * identity). That trust is what lets a row written before `geolocation`
 * existed flow through typed as a `Fingerprint` while actually missing the
 * key, so `fp.geolocation.mode` throws on the first read. Patch only what is
 * absent; never touch what the row already has.
 */
export function withDefaults(fp: Fingerprint): Fingerprint {
  const base = defaultFingerprint()
  return {
    ...base,
    ...fp,
    screen: fp.screen ?? base.screen,
    webgl: fp.webgl ?? base.webgl,
    geolocation: readGeo(fp.geolocation),
    noise: Array.isArray(fp.noise) ? fp.noise : base.noise
  }
}

/**
 * Build the four locale fields ShardX keeps for a profile, from ONE BCP-47 tag.
 *
 * A ShardX config stores the locale in four independent places:
 *   navigator.language        "pl-PL"
 *   navigator.languages       ["pl-PL","pl","en-US","en"]
 *   navigator.accept_language "pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7"
 *   icu_locale                "pl-PL"          (top-level, NOT under navigator)
 * Every bundled template ships pl-PL, so writing only `navigator.language`
 * leaves the other three at the template value: `navigator.language !==
 * navigator.languages[0]` and a mismatched `Accept-Language` header are two of
 * the cheapest bot checks there are — a fingerprint hole of our own making.
 * `Profile.withOverride()` merges one level deep (dist/profile.js:25-37), so
 * the sibling keys survive unless we send them too.
 *
 * The derivation below is a 1:1 port of the SDK's own `resolveAutoFields()`
 * (dist/autoResolve.js) so a hand-picked locale ends up byte-identical to what
 * the SDK writes for `"auto"` — keep the two in sync if the SDK's ever changes.
 */
function localeFields(locale: string): { navigator: Record<string, unknown>; icu_locale: string } {
  const base = locale.split('-', 1)[0]
  return {
    navigator: {
      language: locale,
      languages: locale === 'en-US' ? ['en-US', 'en'] : [locale, base, 'en-US', 'en'],
      accept_language:
        locale === 'en-US' ? 'en-US,en;q=0.9' : `${locale},${base};q=0.9,en-US;q=0.8,en;q=0.7`
    },
    icu_locale: locale
  }
}

/**
 * Map the UI-facing Fingerprint onto the override object ShardX stores verbatim.
 *
 * Deliberately narrow: it carries only the fields the USER actually owns
 * (timezone, locale, geolocation, CPU cores, RAM). Everything else in a profile
 * config — screen geometry, GPU, fonts, TLS — belongs to the device template
 * ShardX picked at `createProfile()` time plus its own `randomizeHardware()`
 * roll, and must not be overwritten with this app's own defaults.
 *
 * Why `screen` is NOT sent (it used to be, straight from
 * defaultFingerprint()'s 1920x1080): `withOverride()` merges one level deep, so
 * `screen: { width, height }` replaced only two of the ten `screen.*` keys and
 * left `avail_width` / `avail_height` (and the sibling `window.*` block) at the
 * template's values — a 1366x768 template became `screen.width = 1920` with
 * `availWidth = 1366`, geometry no real display can produce.
 *
 * `hardware_concurrency` / `device_memory` ARE sent, but only because the DB
 * value they come from now always ORIGINATES with the SDK: `ensureShardId()`
 * copies the SDK's per-profile `randomizeHardware()` roll into the row (and
 * into the in-memory fingerprint, so this function sees it on the very first
 * launch too), and `changeDevice()` does the same after a device swap. So the
 * round-trip is a no-op unless the user deliberately edited the value in the
 * settings panel. What must never come back is the old behaviour of sending
 * defaultFingerprint()'s hardcoded 12 cores / 8 GB for every profile: that made
 * every account on this machine report identical hardware and linked them to
 * each other — the exact signal the ShardX integration exists to remove.
 *
 * NOTE: `noise` is intentionally NOT included here. ShardX exposes noise vectors
 * through a dedicated `Profile.setNoise(...vectors)` method (see
 * node_modules/@proxyshard/shardx/dist/profile.js), not as a plain key consumed
 * by `withOverride()`. Applying `fp.noise` is ShardEngine's job (Task 4): after
 * writing these overrides it should call `profile.setNoise(...fp.noise)`.
 *
 * `webgl` is included ONLY when at least one of vendor/renderer is non-empty.
 * A freshly-created profile's `fp.webgl` is still blank (see
 * defaultFingerprint()) until ShardEngine reads ShardX's own randomly-assigned
 * GPU back via mergeShardDeviceInfo(). `Profile.withOverride()` merges each
 * top-level key shallow-but-whole (`out[k] = { ...out[k], ...v }` — see
 * node_modules/@proxyshard/shardx/dist/profile.js:25-37), so sending
 * `webgl: { vendor: '', renderer: '' }` would stomp both fields at once and
 * blank out the GPU string ShardX just picked at createProfile() time.
 *
 * Key names are `vendor`/`renderer` (matching what ShardX's own bundled
 * fingerprint templates use, e.g. .spike-cache/fingerprints/*.json, and what a
 * launched profile's page actually reports via
 * `WEBGL_debug_renderer_info`'s UNMASKED_VENDOR_WEBGL/UNMASKED_RENDERER_WEBGL —
 * confirmed by reading a template file and by launching a real profile and
 * reading gl.getExtension('WEBGL_debug_renderer_info') from the page). An
 * earlier version of this function used `unmasked_vendor`/`unmasked_renderer`,
 * which do not exist anywhere in ShardX's schema (0 of 170 bundled templates
 * contain that string) and were silently ignored by the engine — see
 * task-8-report.md "Fix round 1" for how that was found and why it made the
 * bug harmless in practice (until now, when the key names are corrected).
 */
export function toShardOverrides(fp: Fingerprint): Record<string, unknown> {
  const overrides: Record<string, unknown> = { timezone: fp.timezone }
  // ONE navigator object for both the hardware keys and the locale keys below.
  // `withOverride()` merges each top-level key shallow-but-whole, so assigning
  // `overrides.navigator` twice would silently drop whichever set was written
  // first — the locale keys and the hardware keys have to travel together.
  const nav: Record<string, unknown> = {
    hardware_concurrency: fp.hardwareConcurrency,
    device_memory: fp.deviceMemory
  }
  // All four keys every time, never a partial object: `withOverride()` merges
  // one level deep, so sending `{ mode: 'auto' }` alone would leave a previous
  // manual run's latitude/longitude sitting in the saved config.
  overrides.geolocation = {
    mode: fp.geolocation.mode,
    latitude: fp.geolocation.latitude,
    longitude: fp.geolocation.longitude,
    accuracy: fp.geolocation.accuracy
  }
  // Anything that is not a usable BCP-47 tag means "auto". Matching the literal
  // string 'auto' was not enough: a row carrying '' (or whitespace) fell into
  // the concrete branch below, where localeFields('') emits
  // languages: ['', '', 'en-US', 'en'] and accept_language: ',;q=0.9,...' —
  // a worse fingerprint than either real option, and it silently stopped the
  // locale from following the proxy.
  const tag = (fp.language ?? '').trim()
  const wantsAuto =
    tag === '' || tag.toLowerCase() === 'auto' || !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(tag)
  if (wantsAuto) {
    // Hand the whole locale question to the SDK: `hasAutoFields()` sees this
    // sentinel and `resolveAutoFields()` then rewrites ALL FOUR fields together
    // from the live geo of the bound proxy (falling back to a direct probe,
    // then to the host locale) — so the locale matches the exit IP instead of
    // being frozen at whatever this app hardcoded. Sending the three sibling
    // keys here would be pointless: the resolver replaces them at launch.
    nav.language = 'auto'
  } else {
    const loc = localeFields(fp.language)
    Object.assign(nav, loc.navigator)
    overrides.icu_locale = loc.icu_locale
  }
  overrides.navigator = nav
  if (fp.webgl.vendor || fp.webgl.renderer) {
    overrides.webgl = { vendor: fp.webgl.vendor, renderer: fp.webgl.renderer }
  }
  return overrides
}

/** ShardX's `navigator.platform` is the OS family name ("Windows" / "macOS" /
 *  "Linux" — confirmed by reading `dist/randomize.js`'s `platformOf()` checks),
 *  not the legacy browser-style string ("Win32" / "MacIntel"). Match
 *  case-insensitively so casing quirks in the SDK's data don't silently fall
 *  through to the "linux" default. */
function detectPlatform(rawPlatform: string): Fingerprint['platform'] {
  const p = rawPlatform.toLowerCase()
  if (p.startsWith('mac')) return 'macos'
  if (p.startsWith('win')) return 'windows'
  return 'linux'
}

/**
 * Read a ShardX profile config back into the UI-facing shape.
 *
 * `deviceId` reads `cfg.name`, NOT `cfg.id` — a saved profile's config (what
 * `ShardEngine.readShardConfig()` / `sdk.openProfile(id).config` returns) has
 * no `id` key at all; the id only exists as the `Profile` wrapper's own
 * property (the profile's folder name on disk), never serialized into the
 * JSON (confirmed by reading node_modules/@proxyshard/shardx/dist/index.js:
 * `saveProfile()` writes `JSON.stringify(profile.config, ...)` only). What
 * DOES survive inside `.config` is `name` — the id of the library template
 * `createProfile()` cloned from (e.g. "win-rx7800xt"), matching what
 * `listDevices()`/`sdk.listProfiles()` enumerate and what the `deviceId`
 * field's own doc comment describes ("id of the entry in ShardX's device
 * library"). Confirmed empirically: created a real profile, read
 * `profile.config.name` back — it's the original template id, distinct from
 * `profile.id` (the random per-save UUID this app stores as
 * `shardProfileId`).
 *
 * `webgl` reads `gl.vendor`/`gl.renderer` — see the matching note on
 * `toShardOverrides()` above for why (`unmasked_vendor`/`unmasked_renderer`,
 * used here previously, are not real schema keys).
 */
export function fromShardConfig(cfg: Record<string, unknown>): Fingerprint {
  const nav = (cfg.navigator ?? {}) as Record<string, any>
  const scr = (cfg.screen ?? {}) as Record<string, any>
  const gl = (cfg.webgl ?? {}) as Record<string, any>
  const noise = (cfg.noise ?? {}) as Record<string, any>
  const lang = String(nav.language ?? 'vi-VN')
  return {
    deviceId: String(cfg.name ?? ''),
    platform: detectPlatform(String(nav.platform ?? 'Windows')),
    userAgent: String(nav.user_agent ?? ''),
    hardwareConcurrency: numOr(nav.hardware_concurrency, 12),
    deviceMemory: numOr(nav.device_memory, 8),
    screen: { width: numOr(scr.width, 1920), height: numOr(scr.height, 1080) },
    webgl: { vendor: String(gl.vendor ?? ''), renderer: String(gl.renderer ?? '') },
    language: lang,
    languages: [lang, lang.split('-')[0]],
    timezone: String(cfg.timezone ?? 'auto'),
    webrtc: 'auto',
    // A template straight from the library has no `geolocation` key at all, so
    // this reads as 'auto' — the right default, and the one every profile
    // created from here on gets.
    geolocation: readGeo(cfg.geolocation),
    // Each vector in ShardX's `config.noise` is an object like
    // `{ enabled, seed, ... }`, not a boolean — confirmed by reading
    // `dist/profile.js`'s `setNoise()`. Read `.enabled`, not truthiness of the
    // object itself (a `{ enabled: false }` object is still truthy in JS).
    noise: ALL_VECTORS.filter((v) => Boolean(noise[v]?.enabled))
  }
}

/**
 * Merge ShardX-sourced device info into an existing Fingerprint, WITHOUT
 * touching the fields the user (or the app's own defaults) owns.
 *
 * Called once, right after a profile's ShardX counterpart is first created
 * (see ShardEngine.ensureShardId()), to persist the real deviceId/userAgent/
 * webgl/screen/deviceMemory/hardwareConcurrency ShardX assigned — otherwise
 * those stay at defaultFingerprint()'s blank placeholders forever (nothing else
 * in the pipeline ever reads them back).
 *
 * `hardwareConcurrency` joined that list when `toShardOverrides()` stopped
 * sending it: the SDK's `randomizeHardware()` is now the only thing that picks
 * it, and it deliberately couples the pick to `device_memory` and to the host
 * core count, so the DB has to follow the SDK rather than the other way round.
 * Without this the dialog would keep showing the placeholder 12 while the
 * browser ran the SDK's real value.
 *
 * Deliberately NOT `{ ...current, ...fromShardConfig(cfg) }` and deliberately
 * NOT `fromShardConfig(cfg)` wholesale: `fromShardConfig()` hardcodes
 * `webrtc: 'auto'` and can't know the user's `noise` selection (ShardX stores
 * noise via `Profile.setNoise()`, not as plain config `fromShardConfig()`
 * reads generically the same way it reads e.g. `webgl` — see the doc comment
 * on `toShardOverrides()`). Overwriting wholesale would silently discard
 * whatever the user (or defaultFingerprint()) already set for webrtc/noise/
 * timezone/language/languages/platform. Only the six fields ShardX is the
 * actual source of truth for — and the UI never lets the user edit directly —
 * are taken from `cfg`.
 */
export function mergeShardDeviceInfo(current: Fingerprint, shardConfig: Record<string, unknown>): Fingerprint {
  const fromShard = fromShardConfig(shardConfig)
  return {
    ...current,
    deviceId: fromShard.deviceId,
    // `platform` belongs on this list now that ShardEngine.changeDevice() can
    // swap a profile onto a template from a DIFFERENT OS family. On the
    // creation path it stays a no-op: ensureShardId() asks createProfile() for
    // the platform the row already claims, so the template it picks reports
    // that same platform back.
    platform: fromShard.platform,
    userAgent: fromShard.userAgent,
    webgl: fromShard.webgl,
    screen: fromShard.screen,
    deviceMemory: fromShard.deviceMemory,
    hardwareConcurrency: fromShard.hardwareConcurrency
  }
}

/**
 * Placeholder fingerprint for a brand-new DB row. Almost every field here is a
 * stand-in that ShardX overwrites the first time the profile is launched:
 * `ensureShardId()` creates the ShardX-side profile (random device template +
 * randomized hardware) and immediately reads deviceId/userAgent/webgl/screen/
 * deviceMemory/hardwareConcurrency back through `mergeShardDeviceInfo()`.
 *
 * `language: 'auto'` matches `timezone: 'auto'` and the design spec, whose very
 * first listed defect was "timezone / locale / geolocation không khớp proxy".
 * A hardcoded tag would reintroduce exactly that: vi-VN behind a US exit IP.
 * With the sentinel, the SDK resolves the locale from the bound proxy's geo at
 * launch and writes all four locale fields coherently (see localeFields()).
 * `languages` stays empty for the same reason — it is derived at launch, never
 * sent from here. Profiles migrated from the pre-ShardX schema keep whatever
 * concrete tag they already had (see upgradeFingerprint()).
 */
export function defaultFingerprint(): Fingerprint {
  return {
    deviceId: '',
    platform: 'windows',
    userAgent: '',
    hardwareConcurrency: 12,
    deviceMemory: 8,
    screen: { width: 1920, height: 1080 },
    webgl: { vendor: '', renderer: '' },
    language: 'auto',
    languages: [],
    timezone: 'auto',
    webrtc: 'block',   // preserves old behavior: blockWebRTC defaulted to true
    // Same reasoning as `timezone`/`language` above: let the position follow
    // the proxy's exit IP instead of freezing it. Note this is a real change of
    // behaviour, not just a default — before this field existed no profile sent
    // any geolocation key at all, so `getCurrentPosition()` simply never
    // resolved for a site that asked.
    geolocation: { mode: 'auto', latitude: 0, longitude: 0, accuracy: 50 },
    noise: []
  }
}

/**
 * Upgrade a fingerprint JSON blob of unknown (possibly legacy, pre-ShardX) shape
 * into the current Fingerprint. Fields that share the same name and type across
 * the legacy seed-based schema and the current schema are preserved verbatim
 * (platform, language, languages, timezone, hardwareConcurrency) instead of
 * being discarded — these were often hand-tuned per profile (e.g. timezone/
 * language matched to a proxy's country). The legacy `blockWebRTC: boolean` is
 * mapped onto the new `webrtc` enum. Fields with no legacy equivalent
 * (deviceId, userAgent, screen, webgl, deviceMemory, noise) fall back to
 * `defaultFingerprint()` — ShardX assigns deviceId/userAgent for real once the
 * profile's shard device is created.
 */
export function upgradeFingerprint(old: Record<string, unknown>): Fingerprint {
  // Callers pass whatever JSON.parse() returned for a DB row, which can be
  // null/undefined/a primitive/an array despite the declared parameter type
  // (the `fingerprint` column is TEXT NOT NULL, but a row could still contain
  // the literal string "null", which JSON.parse turns into the value null).
  // Normalize once, up front, then leave the rest of the logic untouched.
  old = old && typeof old === 'object' ? old : {}
  const base = defaultFingerprint()
  const languages = old.languages

  return {
    ...base,
    platform: old.platform === 'windows' || old.platform === 'macos' || old.platform === 'linux' ? old.platform : base.platform,
    language: typeof old.language === 'string' && old.language ? old.language : base.language,
    languages: Array.isArray(languages) && languages.length > 0 && languages.every((l) => typeof l === 'string')
      ? (languages as string[])
      : base.languages,
    timezone: typeof old.timezone === 'string' && old.timezone ? old.timezone : base.timezone,
    hardwareConcurrency:
      typeof old.hardwareConcurrency === 'number' && Number.isFinite(old.hardwareConcurrency) && old.hardwareConcurrency > 0
        ? old.hardwareConcurrency
        : base.hardwareConcurrency,
    webrtc: typeof old.blockWebRTC === 'boolean' ? (old.blockWebRTC ? 'block' : 'auto') : base.webrtc
  }
}
