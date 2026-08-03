import { EventEmitter } from 'events'
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import puppeteer, { type Browser } from 'puppeteer-core'
import { dataRoot } from '../db'
import { ProfileStore } from './ProfileStore'
import { ProxyStore } from './ProxyStore'
import { toShardOverrides, mergeShardDeviceInfo } from './FingerprintEngine'
import type { Fingerprint, Profile } from '@shared/types'

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
let lastProgressKey = ''

export function shardCacheDir(): string {
  return join(dataRoot(), 'shardx')
}

/**
 * Root holding one folder per ShardX profile. That folder is BOTH the profile's
 * `profile.json` and its browser user-data-dir (cookies, cache, IndexedDB) —
 * `Runtime.profilesRoot` and `userDataDir()` resolve to the same place (see
 * dist/runtime.js:95 and dist/profile.js:168). Deliberately NOT the legacy
 * `profiles/` folder: those dirs belong to the previous engine and are being
 * abandoned (REUSE_USER_DATA_DIR = false), so cleanup is a single folder delete.
 */
export function shardProfilesDir(): string {
  return join(dataRoot(), 'shard-profiles')
}

/** On-disk dir of one ShardX profile (config + browser state). */
export function shardUserDataDir(shardProfileId: string): string {
  return join(shardProfilesDir(), shardProfileId)
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
    profilesDir: shardProfilesDir(),
    progress: (label: string, received: number, total: number) => {
      const pct = total ? Math.round((received / total) * 100) : 0
      // The SDK fires this on EVERY stream chunk (dist/runtime.js:248). Emit
      // only when the rounded percentage actually moves, so forwarding it over
      // IPC to the renderer costs at most ~101 messages per archive instead of
      // one per network packet.
      const key = `${label}:${pct}`
      if (key === lastProgressKey) return
      lastProgressKey = key
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

/**
 * Delete a ShardX profile's folder — its fingerprint config AND all its browser
 * state (cookies, cache, IndexedDB), which live in the same directory.
 *
 * Synchronous and SDK-free ON PURPOSE, although `sdk.deleteProfile(id)` exists:
 *  - going through the SDK means `getSdk()` → `ensureRuntime()` →
 *    `runtime.install()`, so deleting a profile before the engine has ever been
 *    installed would kick off a several-hundred-MB download just to remove a
 *    folder;
 *  - `sdk.deleteProfile()` IS exactly this rmSync (dist/index.js:84-88) against
 *    `profilesRoot`, and `profilesRoot` is a path this app itself supplies —
 *    nothing SDK-internal is being reimplemented;
 *  - staying synchronous lets `ProfileStore.remove()` / `removeAll()` (plain
 *    sync functions in the main process) call it without turning profile
 *    deletion into an async operation.
 * Never throws: a locked/absent folder must not abort the DB row deletion.
 */
export function deleteShardProfile(shardId: string): void {
  try {
    rmSync(shardUserDataDir(shardId), { recursive: true, force: true })
  } catch (e) {
    console.error(`[ShardEngine] failed to delete shard profile ${shardId}:`, e)
  }
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
  // Also update the caller's in-memory copy, not just the DB row. launch()
  // immediately feeds `profile.fingerprint` to toShardOverrides(), which now
  // sends hardware_concurrency / device_memory — so leaving the stale object in
  // place would push defaultFingerprint()'s 12 cores / 8 GB straight back over
  // the per-profile roll the SDK just made, on every profile's FIRST launch.
  profile.fingerprint = merged
  return shardId
}

/**
 * Move an existing profile onto a different device from ShardX's fingerprint
 * library, KEEPING its browser state (cookies, logged-in sessions).
 *
 * Mirrors what `sdk.createProfile()` does — load the template, deep-clone it
 * under an id, re-roll hardware and platform_version seeded by that id — with
 * one deliberate difference: the id reused is the profile's EXISTING one, so
 * `saveProfile()` rewrites `<profilesRoot>/<id>/profile.json` in place and the
 * sibling cookie/cache directories are untouched. Creating a new profile
 * instead would abandon them and log the account out.
 *
 * The user-owned settings (timezone, locale, geolocation, CPU/RAM, noise) are
 * NOT carried over onto the new config here, and don't need to be: every
 * launch re-applies them from the DB row through `toShardOverrides()` +
 * `setNoise()`. What DOES have to happen here is the reverse direction — the
 * new template's device identity is read back into the row, so the panel stops
 * showing the old GPU and user-agent.
 *
 * Returns the updated fingerprint so the caller can refresh whatever copy it is
 * holding. The settings panel edits a CLONE of the profile and writes the whole
 * thing back through `profiles.update()` — including `fingerprint` — so a panel
 * left holding the pre-swap clone would silently undo this the next time the
 * user pressed "Lưu thay đổi".
 */
export async function changeDevice(profile: Profile, deviceId: string): Promise<Fingerprint> {
  if (isRunning(profile.id)) throw new Error('Profile đang mở — đóng trước khi đổi thiết bị')
  const s = await getSdk()
  const { Profile: ShardProfile, randomizeHardware, randomizePlatformVersion } = await loadModule()
  const shardId = await ensureShardId(profile)
  // Throws a helpful "not found" listing sample ids if deviceId is bogus.
  const template = s.library.load(deviceId)
  const next = new ShardProfile(template.config, shardId) // ctor deep-clones
  // Seeded by the profile id, exactly as createProfile() does, so the pick is
  // stable across reopens instead of drifting on every launch.
  randomizeHardware(next.config, shardId)
  randomizePlatformVersion(next.config)
  s.saveProfile(next)
  const merged = mergeShardDeviceInfo(profile.fingerprint, next.config)
  ProfileStore.updateFingerprint(profile.id, merged)
  return merged
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
    // Re-apply the user-owned settings on EVERY launch, not just at creation.
    // The DB row is what the Settings dialog reads and writes, so without this
    // the dialog was lying: `ensureShardId()` returns early once
    // `shardProfileId` exists, so a timezone or language the user changed and
    // saved was shown as active in the UI while the browser kept running the
    // value captured the very first time the profile was opened — forever.
    // `toShardOverrides()` is deliberately narrow (timezone + locale, see its
    // doc comment), so this cannot clobber the device identity ShardX owns.
    // Persisted too, so the on-disk profile.json matches what actually ran.
    const shardProfile = s.openProfile(shardId).withOverride(toShardOverrides(profile.fingerprint))
    // `config.name` is what the engine prints in its own toolbar badge. Left
    // alone it keeps the fingerprint template id ("win-rtx3080ti"), which tells
    // the user nothing about which of their profiles is on screen. Assigned
    // here rather than through withOverride(): that helper ends with
    // `new Profile(out, overrides["name"] ?? this.id)`, so passing `name` would
    // REPLACE the profile id, and saveProfile() writes to
    // <profilesRoot>/<id>/profile.json — every launch would spawn a folder
    // named after the profile and abandon the UUID folder holding the cookies.
    // Re-applied every launch so a rename propagates on the next open.
    shardProfile.config.name = profile.name
    // Noise deliberately lives outside toShardOverrides(): the SDK stores each
    // vector as { enabled, seed, ... }, and setNoise() is the API that builds
    // that shape. It is declarative — passing an empty list turns every vector
    // off, which is the default (each profile gets a distinct real device, so
    // per-vector noise is not needed to keep profiles apart).
    shardProfile.setNoise(...profile.fingerprint.noise)
    s.saveProfile(shardProfile)
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
    // Only record when the profile really is bound to a pool proxy
    // (proxyId != null) AND ShardX measured a geo — a profile running on the
    // host IP has no proxy row to write the probe result into.
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

/**
 * Has Chromium left a restorable session in this profile's dir?
 *
 * The SDK adds `--restore-last-session` to every non-headless, non-cdp launch —
 * i.e. exactly the manual "Mở" path below — so on the second and later opens
 * Chromium reopens the tabs the user had last time, entirely on its own.
 */
function hasRestorableSession(shardId: string): boolean {
  try {
    return readdirSync(join(shardUserDataDir(shardId), 'Default', 'Sessions')).length > 0
  } catch {
    return false // no such dir = profile has never been opened
  }
}

export async function openBrowsing(profile: Profile): Promise<any> {
  const home = (profile.homepageUrl ?? '').trim()
  const extra = ['--start-maximized']
  // Append the homepage ONLY when there is no session to restore.
  //
  // Passing it unconditionally made the tab count grow by one on every single
  // open: Chromium restores the previous session (which already contains the
  // homepage tab from last time) and this argument then adds another copy,
  // which next time gets restored too. Measured: a profile closed with 3 tabs
  // reopened with 4, the homepage appearing twice. With a proxy bound, every
  // one of those duplicates reloads through it at once — the window appears
  // promptly and then the pages crawl, which is exactly the symptom reported.
  //
  // Skipping it here loses nothing: the tab the user actually wants is the one
  // they left open, and session restore brings it back.
  if (home && (!profile.shardProfileId || !hasRestorableSession(profile.shardProfileId))) {
    extra.push(/^https?:\/\//i.test(home) ? home : `https://${home}`)
  }
  return launch(profile, false, extra)
}

export async function openAutomation(
  profile: Profile
): Promise<{ browser: Browser; session: any }> {
  const session = await launch(profile, true, ['--window-position=-32000,-32000'])
  if (!session.cdpUrl) {
    // Drop the map entry BEFORE stopping, the same order closeSession() uses:
    // if stop() throws, the entry must not be left behind or isRunning()
    // reports this profile as busy forever and no later open can succeed.
    sessions.delete(profile.id)
    await session.stop()
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
    sessions.delete(profile.id)
    await session.stop()
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

/** Id of the shared reader's ShardX profile, or null if it was never created. */
export function readerShardId(): string | null {
  try {
    const id = (JSON.parse(readFileSync(READER_ID_FILE, 'utf8')) as { shardProfileId?: unknown })?.shardProfileId
    return typeof id === 'string' && id ? id : null
  } catch {
    return null // never created, or the file is corrupt → openReader() makes a new one
  }
}

function writeReaderShardId(id: string): void {
  try {
    writeFileSync(READER_ID_FILE, JSON.stringify({ shardProfileId: id }))
  } catch {
    /* losing the cached id only costs a fresh profile next time — follower
       reading still works */
  }
}

let readerSession: any = null

/**
 * Open (or reopen) THE ONE shared reader session used for a whole follower
 * collection run. cdp is on so Puppeteer can drive it and NO proxy is passed
 * (TikTok follower counts are public data — see the block comment above).
 * Call closeReader() when done.
 *
 * @param headless `true` (default) runs with no window at all. Pass `false` to
 *   fall back to a real window pushed off-screen: TikTok's anti-bot wall has
 *   historically refused headless outright, and when it does, every profile
 *   reads back `null` — see AnalyticsService.collectAll(), which retries once
 *   in this mode when the very first profile fails.
 */
export async function openReader(headless = true): Promise<{ browser: Browser; session: any }> {
  const s = await getSdk()
  let shardId = readerShardId()
  let shardProfile: any = null
  if (shardId) {
    try {
      shardProfile = s.openProfile(shardId)
    } catch {
      shardProfile = null // cached id points at a profile lost/corrupt on disk → recreate
    }
  }
  if (!shardProfile) {
    shardProfile = await s.createProfile()
    shardId = shardProfile.id
    writeReaderShardId(shardId as string)
  }
  const session = await s.launch(shardProfile, {
    cdp: true,
    headless,
    // Never rely on the SDK default: it is "use_host" on Windows, which
    // rewrites screen.*/window.* with this machine's real monitor size and
    // adds --shardx-real-screen. Same rule as launch() above.
    screenMode: 'profile',
    // A real window would otherwise be visible on screen; keep it out of view.
    extraArgs: headless ? [] : ['--window-position=-32000,-32000']
  })
  readerSession = session
  if (!session.cdpUrl) {
    readerSession = null
    await session.stop()
    throw new Error('ShardX không trả về CDP endpoint cho reader')
  }
  try {
    const browser = await puppeteer.connect({
      browserWSEndpoint: session.cdpUrl,
      defaultViewport: null
    })
    return { browser, session }
  } catch (e) {
    readerSession = null
    await session.stop()
    throw e
  }
}

/**
 * Close the current shared reader session, if any. Safe to call whether or not
 * a reader was ever opened, and safe to call twice.
 */
export async function closeReader(): Promise<void> {
  const s = readerSession
  if (!s) return
  readerSession = null
  await s.stop()
}
