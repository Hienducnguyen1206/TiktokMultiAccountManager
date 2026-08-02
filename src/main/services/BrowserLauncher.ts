import { EventEmitter } from 'events'
import { openBrowsing, closeSession, engineEvents } from './ShardEngine'
import { ProfileStore } from './ProfileStore'
import { getRelayPort } from './ProxyRelay'
import { cleanProfileCache } from './cacheCleaner'
import { trackProc } from './EngineProcs'
import type { Profile } from '@shared/types'

export const launcherEvents = new EventEmitter()

/**
 * Build CLI args for the LEGACY fingerprint-chromium engine.
 *
 * NOTE(Task 5): `runProfile`/`stopProfile` below no longer call this —
 * manual browsing now goes through ShardEngine, which builds its own args
 * internally. This function stays only because AutomationRunner, TikTokLogin
 * and TikTokSync (Task 6 scope, not touched here) still spawn the legacy
 * engine directly and `import { buildArgs } from './BrowserLauncher'`.
 * Delete this function (and the `getRelayPort` import it needs) once Task 6
 * migrates those three files to ShardEngine.
 */
export function buildArgs(profile: Profile): string[] {
  const { fingerprint: fp, proxy } = profile
  const args = [
    `--user-data-dir=${profile.userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    // Native fingerprint (patched at C++ level — no JS injection, no automation traces)
    // NOTE(Task 3): `seed`/`brand` no longer exist on the new Fingerprint (ShardX
    // manages the device/UA itself) — use deviceId instead, leave brand empty.
    `--fingerprint=${fp.deviceId}`,
    `--fingerprint-platform=${fp.platform}`,
    '--fingerprint-brand=',
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
  if (fp.webrtc === 'block') {
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
 * Launch a profile for manual browsing via ShardEngine. No CDP is enabled so
 * there is no automation footprint.
 */
export async function runProfile(id: string): Promise<void> {
  const profile = ProfileStore.get(id)
  if (!profile) throw new Error('Không tìm thấy profile')

  // ShardEngine.launch() already guards against opening the same profile
  // twice — it checks its internal sessions/launching maps synchronously
  // (before any await) and throws a Vietnamese error if the profile is
  // already open. Do NOT re-check isRunning() here: that would just be a
  // second place holding the same condition, which can drift out of sync
  // with the first. Let the error from ShardEngine propagate to the caller.
  const session = await openBrowsing(profile)
  trackProc(session.process)

  ProfileStore.setRunning(id, true)
  ProfileStore.markLastUsed(id)
  launcherEvents.emit('status', id, 'running')

  // Reset back to idle exactly once, however the session ends: a normal
  // 'exit' on session.process, OR ShardEngine's 'process-error' signal (its
  // own launch() emits this when session.process gets an 'error' instead of
  // — or possibly in addition to, Node does not guarantee otherwise — 'exit'
  // when spawn fails at the OS level; see ShardEngine.ts for the full
  // explanation). Without also handling the second case, this profile would
  // stay stuck showing "running" forever with no way to recover except
  // restarting the app, since nothing would ever call setRunning(false).
  let settled = false
  const resetToIdle = (): void => {
    if (settled) return
    settled = true
    engineEvents.off('process-error', onProcessError)
    ProfileStore.setRunning(id, false)
    launcherEvents.emit('status', id, 'idle')
    // Browser thủ công đã đóng → dọn cache profile (giữ cookie/login).
    cleanProfileCache(session.userDataDir)
  }
  // engineEvents is shared by every profile session, not scoped to this one
  // — filter by id, and unsubscribe in resetToIdle() above so this listener
  // doesn't accumulate forever across many opens over the app's lifetime.
  function onProcessError(profileId: string): void {
    if (profileId === id) resetToIdle()
  }
  engineEvents.on('process-error', onProcessError)

  session.process.on('exit', resetToIdle)
}

export async function stopProfile(id: string): Promise<void> {
  await closeSession(id)
}
