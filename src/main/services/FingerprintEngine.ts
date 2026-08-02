import type { Fingerprint, NoiseVector } from '@shared/types'

const ALL_VECTORS: NoiseVector[] = ['canvas', 'webgl', 'audio', 'client_rects', 'sensors', 'fonts']

/** Map the UI-facing Fingerprint onto the override object ShardX stores verbatim. */
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

/** Read a ShardX profile config back into the UI-facing shape. */
export function fromShardConfig(cfg: Record<string, unknown>): Fingerprint {
  const nav = (cfg.navigator ?? {}) as Record<string, any>
  const scr = (cfg.screen ?? {}) as Record<string, any>
  const gl = (cfg.webgl ?? {}) as Record<string, any>
  const noise = (cfg.noise ?? {}) as Record<string, any>
  const lang = String(nav.language ?? 'vi-VN')
  return {
    deviceId: String(cfg.id ?? ''),
    platform: (String(nav.platform ?? 'Win32').startsWith('Win') ? 'windows' : 'linux') as Fingerprint['platform'],
    userAgent: String(nav.user_agent ?? ''),
    hardwareConcurrency: Number(nav.hardware_concurrency ?? 12),
    deviceMemory: Number(nav.device_memory ?? 8),
    screen: { width: Number(scr.width ?? 1920), height: Number(scr.height ?? 1080) },
    webgl: { vendor: String(gl.unmasked_vendor ?? ''), renderer: String(gl.unmasked_renderer ?? '') },
    language: lang,
    languages: [lang, lang.split('-')[0]],
    timezone: String(cfg.timezone ?? 'auto'),
    webrtc: 'auto',
    noise: ALL_VECTORS.filter((v) => Boolean(noise[v]))
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
    webrtc: 'block',   // giữ hành vi cũ: blockWebRTC mặc định bật
    noise: []
  }
}
