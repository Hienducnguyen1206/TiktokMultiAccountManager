import type { Fingerprint, NoiseVector } from '@shared/types'

const ALL_VECTORS: NoiseVector[] = ['canvas', 'webgl', 'audio', 'client_rects', 'sensors', 'fonts']

/**
 * Map the UI-facing Fingerprint onto the override object ShardX stores verbatim.
 *
 * NOTE: `noise` is intentionally NOT included here. ShardX exposes noise vectors
 * through a dedicated `Profile.setNoise(...vectors)` method (see
 * node_modules/@proxyshard/shardx/dist/profile.js), not as a plain key consumed
 * by `withOverride()`. Applying `fp.noise` is ShardEngine's job (Task 4): after
 * writing these overrides it should call `profile.setNoise(...fp.noise)`.
 */
export function toShardOverrides(fp: Fingerprint): Record<string, unknown> {
  return {
    navigator: {
      hardware_concurrency: fp.hardwareConcurrency,
      device_memory: fp.deviceMemory,
      language: fp.language
    },
    screen: { width: fp.screen.width, height: fp.screen.height },
    webgl: { unmasked_vendor: fp.webgl.vendor, unmasked_renderer: fp.webgl.renderer },
    timezone: fp.timezone
  }
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

/** Read a ShardX profile config back into the UI-facing shape. */
export function fromShardConfig(cfg: Record<string, unknown>): Fingerprint {
  const nav = (cfg.navigator ?? {}) as Record<string, any>
  const scr = (cfg.screen ?? {}) as Record<string, any>
  const gl = (cfg.webgl ?? {}) as Record<string, any>
  const noise = (cfg.noise ?? {}) as Record<string, any>
  const lang = String(nav.language ?? 'vi-VN')
  return {
    deviceId: String(cfg.id ?? ''),
    platform: detectPlatform(String(nav.platform ?? 'Windows')),
    userAgent: String(nav.user_agent ?? ''),
    hardwareConcurrency: Number(nav.hardware_concurrency ?? 12),
    deviceMemory: Number(nav.device_memory ?? 8),
    screen: { width: Number(scr.width ?? 1920), height: Number(scr.height ?? 1080) },
    webgl: { vendor: String(gl.unmasked_vendor ?? ''), renderer: String(gl.unmasked_renderer ?? '') },
    language: lang,
    languages: [lang, lang.split('-')[0]],
    timezone: String(cfg.timezone ?? 'auto'),
    webrtc: 'auto',
    // Each vector in ShardX's `config.noise` is an object like
    // `{ enabled, seed, ... }`, not a boolean — confirmed by reading
    // `dist/profile.js`'s `setNoise()`. Read `.enabled`, not truthiness of the
    // object itself (a `{ enabled: false }` object is still truthy in JS).
    noise: ALL_VECTORS.filter((v) => Boolean(noise[v]?.enabled))
  }
}

export function defaultFingerprint(): Fingerprint {
  return {
    deviceId: '',
    platform: 'windows',
    userAgent: '',
    hardwareConcurrency: 12,
    deviceMemory: 8,
    screen: { width: 1920, height: 1080 },
    webgl: { vendor: '', renderer: '' },
    language: 'vi-VN',
    languages: ['vi-VN', 'vi'],
    timezone: 'auto',
    webrtc: 'block',   // preserves old behavior: blockWebRTC defaulted to true
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
