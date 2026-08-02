import { EventEmitter } from 'events'
import { join } from 'path'
import { dataRoot } from '../db'

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
