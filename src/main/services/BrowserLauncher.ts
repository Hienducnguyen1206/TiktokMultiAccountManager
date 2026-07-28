import { spawn, type ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { ensureEngine } from './EngineManager'
import { ProfileStore } from './ProfileStore'
import { ensureRelay, getRelayPort } from './ProxyRelay'
import { cleanProfileCache } from './cacheCleaner'
import { trackProc } from './EngineProcs'
import type { Profile } from '@shared/types'

export const launcherEvents = new EventEmitter()

const openProcs = new Map<string, ChildProcess>()

export function buildArgs(profile: Profile): string[] {
  const { fingerprint: fp, proxy } = profile
  const args = [
    `--user-data-dir=${profile.userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    // Native fingerprint (patched at C++ level — no JS injection, no automation traces)
    `--fingerprint=${fp.seed}`,
    `--fingerprint-platform=${fp.platform}`,
    `--fingerprint-brand=${fp.brand}`,
    `--fingerprint-hardware-concurrency=${fp.hardwareConcurrency}`,
    `--lang=${fp.language}`,
    `--accept-lang=${fp.languages.join(',')}`,
    // Không bóp cửa sổ/tab ở nền hoặc bị che → chạy nhiều profile song song vẫn
    // load & upload full tốc, không cần click focus từng cái.
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=CalculateNativeWinOcclusion'
  ]
  if (fp.timezone && fp.timezone !== 'auto') args.push(`--timezone=${fp.timezone}`)
  if (fp.blockWebRTC) {
    // Chặn UDP không qua proxy để không lộ IP thật qua WebRTC. Vì UDP bị chặn,
    // QUIC/HTTP3 sẽ treo chờ timeout → tắt luôn QUIC, ép về TCP.
    args.push('--disable-non-proxied-udp', '--disable-quic')
  }
  // Khi KHÔNG chặn WebRTC: để QUIC/HTTP3 hoạt động → upload nhanh như Chrome thật.
  if (proxy.useProxy && proxy.host) {
    const scheme = proxy.type === 'socks5' ? 'socks5' : 'http'
    if (proxy.username && scheme !== 'socks5') {
      // Proxy HTTP có auth: trỏ Chrome vào local relay (không auth) — relay tự
      // thêm Proxy-Authorization. Cần gọi ensureRelay(profile) TRƯỚC khi spawn.
      const relayPort = getRelayPort(profile.id)
      if (relayPort) {
        args.push(`--proxy-server=http://127.0.0.1:${relayPort}`)
      } else {
        // fallback nếu relay chưa sẵn sàng (có thể vẫn hỏi auth)
        args.push(`--proxy-server=${scheme}://${proxy.host}:${proxy.port}`)
      }
    } else {
      args.push(`--proxy-server=${scheme}://${proxy.host}:${proxy.port}`)
    }
  }
  return args
}

/**
 * Launch a profile for manual browsing in fingerprint-chromium as a normal
 * process (NOT via CDP/puppeteer) so there is no automation footprint.
 */
export async function runProfile(id: string): Promise<void> {
  if (openProcs.has(id)) return
  const profile = ProfileStore.get(id)
  if (!profile) throw new Error('Không tìm thấy profile')

  const enginePath = await ensureEngine()
  await ensureRelay(profile) // proxy HTTP có auth → bật relay local trước khi mở

  // Open the profile's homepage as a positional arg (manual browsing only).
  const args = buildArgs(profile)
  args.push('--start-maximized') // mở cửa sổ chiếm toàn màn hình
  const home = (profile.homepageUrl ?? '').trim()
  if (home) args.push(/^https?:\/\//i.test(home) ? home : `https://${home}`)

  const child = spawn(enginePath, args, {
    detached: false,
    stdio: 'ignore'
  })
  trackProc(child)

  openProcs.set(id, child)
  ProfileStore.setRunning(id, true)
  ProfileStore.markLastUsed(id)
  launcherEvents.emit('status', id, 'running')

  child.on('error', () => {
    openProcs.delete(id)
    ProfileStore.setRunning(id, false)
    launcherEvents.emit('status', id, 'idle')
  })
  child.on('exit', () => {
    openProcs.delete(id)
    ProfileStore.setRunning(id, false)
    launcherEvents.emit('status', id, 'idle')
    // Browser thủ công đã đóng → dọn cache profile (giữ cookie/login).
    cleanProfileCache(profile.userDataDir)
  })
}

export function stopProfile(id: string): void {
  const child = openProcs.get(id)
  if (child) child.kill()
}
