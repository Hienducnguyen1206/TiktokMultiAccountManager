import { EventEmitter } from 'events'
import { join } from 'path'
import puppeteer, { type Browser } from 'puppeteer-core'
import { dataRoot } from '../db'
import { ProfileStore } from './ProfileStore'
import { toShardOverrides } from './FingerprintEngine'
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

export function isRunning(profileId: string): boolean {
  return sessions.has(profileId)
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
  const shardId = await createShardProfile(profile.fingerprint.platform)
  writeShardConfig(shardId, toShardOverrides(profile.fingerprint))
  ProfileStore.setShardProfileId(profile.id, shardId)
  return shardId
}

async function launch(profile: Profile, cdp: boolean, extra: string[]): Promise<any> {
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
  return session
}

export async function openBrowsing(profile: Profile): Promise<any> {
  if (sessions.has(profile.id)) throw new Error('Profile đang mở')
  const home = (profile.homepageUrl ?? '').trim()
  const extra = ['--start-maximized']
  if (home) extra.push(/^https?:\/\//i.test(home) ? home : `https://${home}`)
  return launch(profile, false, extra)
}

export async function openAutomation(
  profile: Profile
): Promise<{ browser: Browser; session: any }> {
  if (sessions.has(profile.id)) throw new Error('Profile đang mở ở nơi khác')
  const session = await launch(profile, true, ['--window-position=-32000,-32000'])
  if (!session.cdpUrl) {
    await session.stop()
    sessions.delete(profile.id)
    throw new Error('ShardX không trả về CDP endpoint')
  }
  const browser = await puppeteer.connect({
    browserWSEndpoint: session.cdpUrl,
    defaultViewport: null
  })
  return { browser, session }
}

export async function closeSession(profileId: string): Promise<void> {
  const session = sessions.get(profileId)
  if (!session) return
  sessions.delete(profileId)
  await session.stop()
}
