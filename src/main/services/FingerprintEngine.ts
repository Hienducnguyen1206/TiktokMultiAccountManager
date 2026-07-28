import type { Fingerprint } from '@shared/types'

// With fingerprint-chromium, a single 32-bit seed deterministically drives the
// whole native fingerprint (canvas / WebGL / audio / fonts / GPU). We only pick
// the seed plus a few high-level overrides; the engine does the rest natively.

const CHROME_VERSIONS = ['142.0.0.0', '143.0.0.0', '144.0.0.0']
// Không dùng 4: TikTok Studio chia/hash/preview video trong Web Worker theo
// navigator.hardwareConcurrency → 4 nhân làm khâu upload nghẽn CPU, chậm hẳn.
// 8 nhân trở lên vừa nhanh vừa phổ biến trên máy Windows thật.
const CORES = [8, 12, 16]

// Default UI/browser language for new profiles (overridable per profile).
const DEFAULT_LANGUAGE = 'vi-VN'

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff)
}

export function generateFingerprint(): Fingerprint {
  const lang = DEFAULT_LANGUAGE
  return {
    seed: randomSeed(),
    platform: 'windows',
    brand: 'Chrome',
    browserVersion: pick(CHROME_VERSIONS),
    language: lang,
    languages: [lang, lang.split('-')[0]],
    timezone: 'auto',
    hardwareConcurrency: pick(CORES),
    blockWebRTC: true
  }
}
