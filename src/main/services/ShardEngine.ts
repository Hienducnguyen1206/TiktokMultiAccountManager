import { screen as electronScreen } from 'electron'
import { EventEmitter } from 'events'
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import puppeteer, { type Browser } from 'puppeteer-core'
import { dataRoot } from '../db'
import { ProfileStore } from './ProfileStore'
import { ProxyStore } from './ProxyStore'
import { toShardOverrides, mergeShardDeviceInfo, TEMPLATE_ID_KEY } from './FingerprintEngine'
import type { DeviceList, Fingerprint, Profile } from '@shared/types'

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

/**
 * ShardX's device library for one platform, plus the real display.
 *
 * The device decides GPU, user-agent and fonts — deliberately NOT the screen:
 * every launch runs in 'use_host' (see SCREEN_MODE), which rewrites screen.*
 * and window.* with the host display, so a template's own claimed resolution
 * never reaches a page. `host` is what the settings panel shows instead.
 */
// The bundled library only changes when the engine is (re)installed, which
// cannot happen without restarting this process — so one read per platform is
// enough. Without this, every open of the settings panel re-ran the whole scan
// below.
const deviceCache = new Map<string, string[]>()

export async function listDevices(platform: string): Promise<DeviceList> {
  let items = deviceCache.get(platform)
  if (!items) {
    // `listProfiles({ platform })` is not a directory listing: the SDK has no
    // index, so its filter opens and JSON.parses all 170 template files to read
    // each one's navigator.platform (dist/profile.js, FingerprintLibrary.filter).
    const s = await getSdk()
    items = (await s.listProfiles({ platform })) as string[]
    deviceCache.set(platform, items)
  }
  // Electron's own display info, NOT the SDK's hostScreenSize(). That helper
  // shells out to `powershell -NoProfile -Command ...` through execSync
  // (dist/host.js, windowsScreenSize) — a synchronous subprocess that blocks
  // this whole process for as long as PowerShell takes to start, every single
  // call. Electron already knows the display, for free and without blocking.
  // Both report the same scaled DIP size (verified: 1536x864 either way).
  let host: DeviceList['host'] = null
  try {
    const size = electronScreen.getPrimaryDisplay().size
    if (size.width > 0 && size.height > 0) host = { width: size.width, height: size.height }
  } catch (e) {
    // No display info (headless CI, display disconnected) — the panel just
    // falls back to showing the profile's own screen values.
    console.error('[ShardEngine] could not read primary display size:', e)
  }
  return { items, host }
}

export async function createShardProfile(platform: string, template?: string): Promise<string> {
  const s = await getSdk()
  // `template` undefined => the SDK picks at random.
  const profile = await s.createProfile(template, { platform })
  return profile.id
}

/**
 * A library template for this platform that no existing profile is already
 * using, or null when they are all taken.
 *
 * The SDK picks at random, and random repeats: across 20 profiles drawn from
 * the 120 Windows devices, one pair came back sharing a GPU string — which is
 * exactly the cross-profile link this integration exists to remove, since a GPU
 * is the strongest per-device signal in the whole fingerprint. With 120
 * templates and 20 draws a collision is closer to certain than to unlikely.
 */
async function unusedTemplate(platform: string): Promise<string | null> {
  const { items } = await listDevices(platform)
  const taken = new Set(ProfileStore.list().map((p) => p.fingerprint.deviceId).filter(Boolean))
  const free = items.filter((id) => !taken.has(id))
  if (free.length === 0) return null
  // Still random among what is left, so profiles don't march down the library in
  // alphabetical order — that would be its own pattern.
  return free[Math.floor(Math.random() * free.length)]
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

/**
 * Screen strategy for EVERY launch path — manual, automation and the shared
 * reader alike. One constant on purpose: a profile that reported a 1920x1080
 * screen when opened by hand and the host's 1536x864 when opened by a job would
 * be two different machines to the site looking at it.
 *
 * 'use_host' rewrites screen.* and window.* with the real display. That is the
 * SDK's own default on Windows and what ShardX's desktop app does.
 *
 * This used to be 'profile' (keep whatever the template claims), for a real
 * reason: 'use_host' makes every profile on this machine report the same
 * screen. But measured on fresh profiles, twice per case, 'profile' means the
 * window opens at exactly the size the fingerprint claims, at (10,10), in the
 * `normal` state — so a template claiming 1067x600 opens a small window with
 * desktop showing around it, one claiming 5120x1440 hangs off the screen edge,
 * and `--start-maximized` changes NOTHING (with and without the flag the bounds
 * came back identical to the pixel). The only combination that actually fills
 * the monitor is this one:
 *     use_host + --start-maximized -> 1552x832 maximized, page told 1536x864.
 *
 * The cost is accepted deliberately: screen resolution is among the weakest
 * signals there is — 1536x864 is a top-5 real-world resolution (a 1920x1080
 * monitor at 125% Windows scaling, which is exactly this host) — while the
 * per-profile GPU, fonts, canvas, audio and TLS all stay distinct. The bundled
 * library has no two devices sharing a GPU string, in any resolution group.
 */
const SCREEN_MODE = 'use_host'

/**
 * Pin `screen.device_pixel_ratio` to the host's real scale factor.
 *
 * Required BECAUSE of SCREEN_MODE. The SDK's `useHost()` rewrites width /
 * height / avail_* / window.* with the host display but deliberately leaves DPR
 * alone ("All modes leave DPR / color_depth / orientation / etc. untouched",
 * dist/screen.js) — so it ends up pairing the host's resolution with whatever
 * DPR the device template happened to ship.
 *
 * That pairing is exactly what must not be broken. Resolution and DPR together
 * imply a physical panel, and the bundled library is coherent about it:
 * 1920x1080@1 -> a 1920x1080 panel, 1536x864@1.25 -> a 1920x1080 panel at 125%,
 * 2560x1440@1.5 -> a 4K panel at 150%. Every one of the 170 templates maps to a
 * panel that exists. Mixing this host's 1536x864 with a template's DPR 1.5
 * implies a 2304x1296 panel, and with DPR 1 a native 1536x864 panel — neither is
 * a real product, and an impossible panel is a far louder signal than a common
 * one shared between profiles.
 *
 * Electron's scaleFactor is the authoritative source (verified against Windows:
 * AppliedDPI 120 = 125%, and 1536 x 1.25 = 1920). Writing it here restores the
 * same coherent pair 14 of the bundled devices already ship.
 */
function applyHostDpr(config: Record<string, unknown>): void {
  try {
    const factor = electronScreen.getPrimaryDisplay().scaleFactor
    if (!Number.isFinite(factor) || factor <= 0) return
    const scr = (config.screen ??= {}) as Record<string, unknown>
    scr.device_pixel_ratio = factor
  } catch (e) {
    // No display info (headless CI, display disconnected). Leaving the
    // template's own DPR is the safe fallback: it is at least coherent with the
    // resolution the template shipped with.
    console.error('[ShardEngine] could not read host scaleFactor:', e)
  }
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
/**
 * Give freshly created profiles their ShardX device up front, instead of
 * leaving them blank until someone opens them.
 *
 * Without this, a profile carries `deviceId: ''` with no user-agent, GPU, screen
 * or core count until its first launch, because `ensureShardId()` only runs
 * inside `launch()`. The settings panel then has nothing to show — the device
 * dropdown falls back to "ShardX tự chọn khi mở lần đầu" and the read-only
 * fields sit empty — and after importing 50 accounts from a txt file, the only
 * way to populate them was to open all 50 by hand.
 *
 * Best-effort on purpose: a failure here (no engine installed yet and offline,
 * disk full) must not fail profile creation. The old lazy path still runs at
 * first launch, so the profile is merely blank for a while, exactly as before.
 *
 * Cost: the first call in a process pays for `ensureRuntime()` (~1.7s measured,
 * mostly the engine manifest check); the rest are a template read plus a small
 * JSON write. Sequential rather than parallel — `createProfile()` writes into a
 * shared directory and the SDK does its own install check per call.
 */
export async function assignDevices(profiles: Profile[]): Promise<void> {
  for (const p of profiles) {
    try {
      if (!p.shardProfileId) {
        await ensureShardId(p) // creates the shard profile and reads it back
        continue
      }
      if (p.fingerprint.deviceId) continue // already knows its device
      // Has a shard profile but no device info in the row. Two ways to get
      // here: the row predates the read-back in ensureShardId(), or it was
      // launched back when `config.name` doubled as the device id and got
      // overwritten with the profile's display name (see TEMPLATE_ID_KEY).
      await ensureRuntime()
      const cfg = readShardConfig(p.shardProfileId)
      if (!cfg[TEMPLATE_ID_KEY]) {
        const recovered = await findTemplateByGpu(
          String((cfg.webgl as Record<string, unknown> | undefined)?.renderer ?? ''),
          p.fingerprint.platform
        )
        if (recovered) stampTemplateId(p.shardProfileId, recovered)
      }
      const merged = mergeShardDeviceInfo(p.fingerprint, readShardConfig(p.shardProfileId))
      ProfileStore.updateFingerprint(p.id, merged)
    } catch (e) {
      console.error(`[ShardEngine] could not assign a device to profile ${p.id}:`, e)
    }
  }
}

/**
 * Recover which library template a config came from, by its GPU string.
 *
 * Exact, not a guess: no two devices in the bundled library share a
 * `webgl.renderer` (checked across all 170 — 47 Windows devices at 1920x1080,
 * 47 distinct GPUs, and the same in every other resolution group). Only used to
 * repair rows whose template id was destroyed, so the cost of reading the
 * templates is paid once per broken profile.
 */
async function findTemplateByGpu(renderer: string, platform: string): Promise<string | null> {
  if (!renderer) return null
  const s = await getSdk()
  const { items } = await listDevices(platform)
  for (const id of items) {
    try {
      const cfg = s.library.load(id).config as Record<string, any>
      if (String(cfg.webgl?.renderer ?? '') === renderer) return id
    } catch {
      /* unreadable template — keep looking */
    }
  }
  return null
}

/** Record which library template a shard profile came from, reading it out of
 *  `config.name` before anything overwrites that. See TEMPLATE_ID_KEY. */
function stampTemplateId(shardId: string, templateId?: string): void {
  if (!sdk) return
  const profile = sdk.openProfile(shardId)
  const id = templateId ?? String(profile.config.name ?? '')
  if (!id) return
  profile.config[TEMPLATE_ID_KEY] = id
  sdk.saveProfile(profile)
}

async function ensureShardId(profile: Profile): Promise<string> {
  if (profile.shardProfileId) return profile.shardProfileId
  // NOTE: no rollback if setShardProfileId() throws after createShardProfile()
  // already succeeded — that would leave an orphaned ShardX profile on disk
  // (created but never linked back to a DB row). Accepted risk: this is a
  // local SQLite write, which essentially never fails; a rollback path here
  // isn't worth the added complexity.
  // Prefer a device no other profile has. Falls back to the SDK's own random
  // pick when the library runs out, or when the lookup fails for any reason —
  // a repeated device is worse than nothing, but no profile at all is worse
  // than a repeated device.
  let template: string | undefined
  try {
    template = (await unusedTemplate(profile.fingerprint.platform)) ?? undefined
  } catch (e) {
    console.error('[ShardEngine] could not pick an unused device, falling back to random:', e)
  }
  const shardId = await createShardProfile(profile.fingerprint.platform, template)
  // Pin the template id under our own key while `config.name` still holds it.
  // launch() overwrites `name` with the profile's display name for the engine's
  // toolbar badge, so this is the only moment it can be captured.
  stampTemplateId(shardId)
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
  next.config[TEMPLATE_ID_KEY] = deviceId // survives launch()'s rewrite of `name`
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
    // After the overrides, before saving: applyScreenStrategy() runs later,
    // inside s.launch(), and does not touch DPR — so this value survives.
    applyHostDpr(shardProfile.config)
    s.saveProfile(shardProfile)
    const session = await s.launch(shardProfile, {
      proxy: proxyUrl(profile),
      cdp,
      screenMode: SCREEN_MODE,
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
  // Same reason as launch(): use_host rewrites the resolution but not the DPR,
  // and the pair has to keep implying a panel that exists. See applyHostDpr().
  applyHostDpr(shardProfile.config)
  s.saveProfile(shardProfile)
  const session = await s.launch(shardProfile, {
    cdp: true,
    headless,
    // Same strategy as launch() — see SCREEN_MODE.
    screenMode: SCREEN_MODE,
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
