import { EventEmitter } from 'events'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import puppeteer, { type Browser } from 'puppeteer-core'
import { dataRoot } from '../db'
import { ProfileStore } from './ProfileStore'
import { ProxyStore } from './ProxyStore'
import { toShardOverrides, mergeShardDeviceInfo } from './FingerprintEngine'
import type { Profile } from '@shared/types'

export const engineEvents = new EventEmitter()

// SDK is ESM-only; the main process bundle is CJS. A static import would be
// downlevelled to require() and throw ERR_REQUIRE_ESM at runtime.
type ShardXModule = typeof import('@proxyshard/shardx')
let modPromise: Promise<ShardXModule> | null = null
function loadModule(): Promise<ShardXModule> {
  if (!modPromise) modPromise = import('@proxyshard/shardx')
  return modPromise
}

let sdk: any = null
// Memoise the WHOLE init, not just the module load: two concurrent callers
// would otherwise both construct ShardX and both run runtime.install() into
// the same cacheDir, which races on file locks while extracting on Windows.
let initPromise: Promise<void> | null = null

export function shardCacheDir(): string {
  return join(dataRoot(), 'shardx')
}

export function ensureRuntime(): Promise<void> {
  if (!initPromise) {
    initPromise = initRuntime().catch((e) => {
      // Let a failed install be retried instead of caching the rejection.
      initPromise = null
      throw e
    })
  }
  return initPromise
}

async function initRuntime(): Promise<void> {
  const { ShardX } = await loadModule()
  sdk = new ShardX({
    cacheDir: shardCacheDir(),
    // Deliberately NOT the legacy `profiles/` folder: old dirs belong to the
    // previous engine and are being abandoned (REUSE_USER_DATA_DIR = false),
    // so keeping them separate makes cleanup a single folder delete.
    profilesDir: join(dataRoot(), 'shard-profiles'),
    progress: (label: string, received: number, total: number) => {
      const pct = total ? Math.round((received / total) * 100) : 0
      engineEvents.emit('progress', { phase: label, pct })
    }
  })
  await sdk.runtime.install()
  engineEvents.emit('progress', { phase: 'done', pct: 100 })
}

async function getSdk(): Promise<any> {
  await ensureRuntime()
  return sdk
}

export async function listDevices(platform: string): Promise<string[]> {
  const s = await getSdk()
  return s.listProfiles({ platform })
}

export async function createShardProfile(platform: string): Promise<string> {
  const s = await getSdk()
  const profile = await s.createProfile(undefined, { platform })
  return profile.id
}

export async function deleteShardProfile(shardId: string): Promise<void> {
  const s = await getSdk()
  s.deleteProfile(shardId)
}

export function readShardConfig(shardId: string): Record<string, unknown> {
  if (!sdk) throw new Error('ShardX chưa khởi tạo — gọi ensureRuntime() trước')
  return sdk.openProfile(shardId).config
}

export function writeShardConfig(shardId: string, overrides: Record<string, unknown>): void {
  if (!sdk) throw new Error('ShardX chưa khởi tạo — gọi ensureRuntime() trước')
  const profile = sdk.openProfile(shardId).withOverride(overrides)
  sdk.saveProfile(profile)
}

export const ANTI_THROTTLE = [
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-features=CalculateNativeWinOcclusion'
]

const sessions = new Map<string, any>()
// A profile counts as "busy" from the moment launch() passes its synchronous
// guard until sessions.set() runs. Everything in between is awaited
// (getSdk(), ensureShardId(), s.launch() — which can wait up to 15s for
// readCdpEndpoint when cdp:true) — without this second set, two
// near-simultaneous calls for the same profile both read
// sessions.has()===false before either one writes to it, and both proceed to
// launch a second Chromium against the same user-data-dir (or, for a profile
// with no shardProfileId yet, both call createShardProfile() and create two
// separate ShardX profiles).
const launching = new Set<string>()

// Set by launch()'s 'error' handler below when session.process fails to
// spawn at the OS level (binary quarantined by antivirus, deleted by hand,
// disk full while extracting, ...). Consumed (thrown + cleared) the next
// time launch() runs for that profile — a one-shot notification so the
// failure reaches the user via the existing run()/catch → toast path in the
// renderer, instead of only ever reaching a console.error line that a
// packaged build writes to no file anyone can read.
const lastError = new Map<string, Error>()

export function isRunning(profileId: string): boolean {
  return sessions.has(profileId) || launching.has(profileId)
}

function proxyUrl(profile: Profile): string | undefined {
  const p = profile.proxy
  if (!p.useProxy || !p.host) return undefined
  const scheme = p.type === 'socks5' ? 'socks5' : 'http'
  const auth = p.username ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password)}@` : ''
  return `${scheme}://${auth}${p.host}:${p.port}`
}

/** Ensure the profile has a ShardX counterpart; create lazily for legacy rows. */
async function ensureShardId(profile: Profile): Promise<string> {
  if (profile.shardProfileId) return profile.shardProfileId
  // NOTE: no rollback if setShardProfileId() throws after createShardProfile()
  // already succeeded — that would leave an orphaned ShardX profile on disk
  // (created but never linked back to a DB row). Accepted risk: this is a
  // local SQLite write, which essentially never fails; a rollback path here
  // isn't worth the added complexity.
  const shardId = await createShardProfile(profile.fingerprint.platform)
  writeShardConfig(shardId, toShardOverrides(profile.fingerprint))
  ProfileStore.setShardProfileId(profile.id, shardId)
  // Read the device info ShardX actually assigned/kept (real deviceId, GPU,
  // user-agent, screen, deviceMemory) back and persist it — only the
  // ShardX-sourced fields; webrtc/noise/timezone/language/platform/
  // hardwareConcurrency stay whatever `profile.fingerprint` already has (see
  // mergeShardDeviceInfo() doc comment). Only reachable once per profile:
  // this whole function returns early above when `shardProfileId` is already
  // set, so this never re-runs for an existing profile and never clobbers a
  // later edit made from the Settings dialog.
  const merged = mergeShardDeviceInfo(profile.fingerprint, readShardConfig(shardId))
  ProfileStore.updateFingerprint(profile.id, merged)
  return shardId
}

async function launch(profile: Profile, cdp: boolean, extra: string[]): Promise<any> {
  // Check-and-mark must be synchronous (no await between them): that's what
  // makes two concurrent calls for the same profile.id mutually exclusive —
  // see the comment on `launching` above.
  if (sessions.has(profile.id) || launching.has(profile.id)) {
    throw new Error('Profile đang mở')
  }
  const prevError = lastError.get(profile.id)
  if (prevError) {
    lastError.delete(profile.id)
    throw new Error('Lần mở trước bị lỗi khi khởi động trình duyệt. Thử mở lại.')
  }
  launching.add(profile.id)
  try {
    const s = await getSdk()
    const shardId = await ensureShardId(profile)
    const shardProfile = s.openProfile(shardId)
    // Noise deliberately lives outside toShardOverrides(): the SDK stores each
    // vector as { enabled, seed, ... }, and setNoise() is the API that builds
    // that shape. It is declarative — passing an empty list turns every vector
    // off, which is the default (each profile gets a distinct real device, so
    // per-vector noise is not needed to keep profiles apart).
    shardProfile.setNoise(...profile.fingerprint.noise)
    const session = await s.launch(shardProfile, {
      proxy: proxyUrl(profile),
      cdp,
      // Never rely on the SDK default: it is "use_host" on Windows, which leaks
      // the real monitor size and makes every profile look identical.
      screenMode: 'profile',
      webrtc: profile.fingerprint.webrtc,
      extraArgs: [...ANTI_THROTTLE, ...extra]
    })
    sessions.set(profile.id, session)
    session.process.on('exit', () => sessions.delete(profile.id))
    // spawn() can fail at the OS level AFTER already returning a
    // ChildProcess (binary quarantined by antivirus, deleted by hand, disk
    // full while extracting, ...) — confirmed empirically on this exact
    // Windows setup: spawning a missing binary fires 'error' and 'exit'
    // does NOT follow. Per Node's own docs, 'exit' "may or may not" fire
    // after 'error', so code that only listens for 'exit' (BrowserLauncher's
    // own cleanup, EngineProcs' trackProc, this very function's line above)
    // cannot be relied on to ever run. Without this handler the profile
    // stays wedged in `sessions`/`launching` (isRunning() reports true
    // forever) and, one layer up, ProfileStore keeps `running=true` forever
    // too — the UI shows the profile as running with nothing left alive,
    // recoverable only by restarting the app.
    session.process.on('error', (err: Error) => {
      sessions.delete(profile.id)
      launching.delete(profile.id)
      lastError.set(profile.id, err)
      console.error(`[ShardEngine] process error for profile ${profile.id}:`, err)
      engineEvents.emit('process-error', profile.id)
    })
    // Chỉ ghi khi profile THẬT SỰ gắn proxy (proxyId != null) và ShardX đo được
    // geo — profile chạy bằng IP máy không có proxy nào trong pool để ghi vào.
    if (profile.proxyId && session.geo) {
      // Probe caching is best-effort only — sessions.set() above already ran,
      // so the browser is live at this point. A DB write failure here (locked
      // sqlite file, disk full, ...) must NEVER reject this launch(): if it
      // did, this call would throw despite Chromium actually running, so
      // BrowserLauncher's trackProc()/setRunning(true) would never fire (UI
      // shows the profile as idle) while `sessions` still holds it (the next
      // open attempt hits 'Profile đang mở' above) — an orphaned browser,
      // unrecoverable from the UI, fixable only by restarting the app. Same
      // stuck-state class the session.process 'error' listener above already
      // guards against, just reached from a different path. Swallow and log
      // instead.
      try {
        ProxyStore.saveProbe(profile.proxyId, {
          timezone: session.geo.timezone ?? null,
          latitude: session.geo.latitude ?? null,
          longitude: session.geo.longitude ?? null,
          udpMs: session.proxyUdpMs ?? null,
          quicOk: Boolean(session.quicEnabled)
        })
      } catch (e) {
        console.error(`[ShardEngine] saveProbe failed for profile ${profile.id}:`, e)
      }
    }
    return session
  } finally {
    launching.delete(profile.id)
  }
}

export async function openBrowsing(profile: Profile): Promise<any> {
  const home = (profile.homepageUrl ?? '').trim()
  const extra = ['--start-maximized']
  if (home) extra.push(/^https?:\/\//i.test(home) ? home : `https://${home}`)
  return launch(profile, false, extra)
}

export async function openAutomation(
  profile: Profile
): Promise<{ browser: Browser; session: any }> {
  const session = await launch(profile, true, ['--window-position=-32000,-32000'])
  if (!session.cdpUrl) {
    await session.stop()
    sessions.delete(profile.id)
    throw new Error('ShardX không trả về CDP endpoint')
  }
  try {
    const browser = await puppeteer.connect({
      browserWSEndpoint: session.cdpUrl,
      defaultViewport: null
    })
    return { browser, session }
  } catch (e) {
    // puppeteer.connect() can reject (WS handshake failure, timeout) even
    // though the Chromium process itself started fine. Without this cleanup
    // the process would keep running off-screen (--window-position pushes it
    // out of view, so the user can't see it to close it manually) and its
    // `sessions` entry would never clear — isRunning() would report true
    // forever and every later open attempt for this profile would throw.
    await session.stop()
    sessions.delete(profile.id)
    throw e
  }
}

export async function closeSession(profileId: string): Promise<void> {
  const session = sessions.get(profileId)
  if (!session) return
  sessions.delete(profileId)
  await session.stop()
}

// ---- Shared reader session (AnalyticsService: reading PUBLIC follower counts) ----
//
// Not tied to any real Profile: TikTok follower counts are public data and
// (per the original AnalyticsService.ts, confirmed by re-reading git history —
// see task-6-report.md Fix round 1, Finding 2) were never routed through any
// profile's own fingerprint/proxy/userDataDir. Deliberately kept OUT of the
// `sessions`/`launching` maps above, which are keyed by `profile.id` and exist
// to stop a REAL profile from being opened twice — conflating a synthetic
// reader identity with them would let closeSession(profileId) reach into this
// session (or vice versa) on any accidental id collision. Own minimal state
// instead: one dedicated shard profile, its id cached in a tiny JSON file so
// the SAME reader (and its warm TikTok cookies) survives app restarts —
// re-created automatically if that file is ever missing or stale.

const READER_ID_FILE = join(dataRoot(), 'analytics-reader.json')

function readReaderShardId(): string | null {
  try {
    const id = (JSON.parse(readFileSync(READER_ID_FILE, 'utf8')) as { shardProfileId?: unknown })?.shardProfileId
    return typeof id === 'string' && id ? id : null
  } catch {
    return null // chưa tạo lần nào, hoặc file hỏng → openReader() tạo mới
  }
}

function writeReaderShardId(id: string): void {
  try {
    writeFileSync(READER_ID_FILE, JSON.stringify({ shardProfileId: id }))
  } catch {
    /* mất cache id thì lần sau tạo profile mới — không hỏng chức năng đọc follower */
  }
}

let readerSession: any = null

/**
 * Mở (hoặc mở lại) MỘT phiên đọc dùng chung cho toàn bộ mẻ thu thập follower.
 * cdp bật để Puppeteer điều khiển được, headless để nhẹ/vô hình, KHÔNG truyền
 * proxy (follower TikTok là dữ liệu công khai — xem comment ở trên). Gọi
 * closeReader() khi xong.
 */
export async function openReader(): Promise<{ browser: Browser; session: any }> {
  const s = await getSdk()
  let shardId = readReaderShardId()
  let shardProfile: any = null
  if (shardId) {
    try {
      shardProfile = s.openProfile(shardId)
    } catch {
      shardProfile = null // record cũ trỏ tới profile đã mất/hỏng trên đĩa → tạo lại
    }
  }
  if (!shardProfile) {
    shardProfile = await s.createProfile()
    shardId = shardProfile.id
    writeReaderShardId(shardId as string)
  }
  const session = await s.launch(shardProfile, { cdp: true, headless: true })
  readerSession = session
  if (!session.cdpUrl) {
    await session.stop()
    readerSession = null
    throw new Error('ShardX không trả về CDP endpoint cho reader')
  }
  try {
    const browser = await puppeteer.connect({
      browserWSEndpoint: session.cdpUrl,
      defaultViewport: null
    })
    return { browser, session }
  } catch (e) {
    await session.stop()
    readerSession = null
    throw e
  }
}

/**
 * Đóng phiên reader dùng chung hiện tại (nếu có). An toàn khi gọi dù reader
 * chưa từng mở hoặc đã đóng rồi.
 */
export async function closeReader(): Promise<void> {
  const s = readerSession
  if (!s) return
  readerSession = null
  await s.stop()
}
