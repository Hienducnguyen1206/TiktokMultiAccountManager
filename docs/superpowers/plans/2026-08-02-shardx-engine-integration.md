# ShardX Engine Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay `fingerprint-chromium` bằng ShardX Node SDK làm engine trình duyệt, giữ nguyên toàn bộ logic automation phía sau `puppeteer.connect()`.

**Architecture:** Thêm một module `ShardEngine.ts` là lớp duy nhất chạm `@proxyshard/shardx`. Bốn điểm automation và một điểm mở thủ công gọi qua nó. Xoá `EngineManager.ts` và `ProxyRelay.ts`. Fingerprint chuyển sang file profile của SDK làm nguồn sự thật; sqlite giữ phần nghiệp vụ.

**Tech Stack:** Electron 30 (Node 20), electron-vite, TypeScript, better-sqlite3, puppeteer-core 23, `@proxyshard/shardx` 0.1.11.

**Spec:** `docs/superpowers/specs/2026-08-02-shardx-integration-design.md`

## Global Constraints

- Pin `"@proxyshard/shardx": "0.1.11"` — chính xác, **không** dùng `^`. Package đang pre-1.0.
- SDK là **ESM-only** (`"type": "module"`). Main process build ra CJS. Mọi lần nạp phải qua dynamic `import()`, không được `import` tĩnh ở đầu file.
- Luôn truyền `screenMode: 'profile'` tường minh. Mặc định của SDK trên Windows là `'use_host'` — lộ màn hình máy thật.
- Không đóng gói binary engine vào bản build. SDK tự tải về `cacheDir` lúc chạy.
- `cacheDir` phải nằm trong `dataRoot()` để `backup-data.bat` bao được.
- **`cacheDir` bắt buộc là đường dẫn TUYỆT ĐỐI.** `@proxyshard/shardx@0.1.11`
  không gọi `resolve()` cho `cacheDir` (khác `profilesDir`), nên với đường dẫn
  tương đối thì `chrome.exe` con phân giải `--user-data-dir` theo thư mục chứa
  nó, còn SDK poll `DevToolsActivePort` theo cwd của Node — hai chỗ khác nhau,
  `cdpUrl` luôn trả về `null`. Đã đo được ở Task 1. `dataRoot()` dựng từ
  `app.getPath('userData')` nên luôn tuyệt đối, code sản phẩm an toàn.
- Chuỗi hiển thị cho người dùng viết tiếng Việt; tên biến, hàm, comment viết tiếng Anh.
- Dự án **không có test framework**. Mỗi task kiểm chứng bằng script Node độc lập trong `scripts/verify/` chạy bằng `node`, hoặc bằng cách chạy app thật. Script verify là ESM (`.mjs`) để `import` thẳng SDK.

---

### Task 1: Spike — xác minh SDK và khả năng tái dùng user-data-dir

Nhiệm vụ này chưa sửa code sản phẩm. Nó trả lời ba câu còn nghi trong spec trước khi viết `ShardEngine`.

**Files:**
- Modify: `package.json` (thêm dependency)
- Create: `scripts/verify/01-spike.mjs`
- Create: `docs/superpowers/plans/notes-spike.md`

**Interfaces:**
- Consumes: không có.
- Produces: kết luận ghi trong `notes-spike.md` — quyết định `REUSE_USER_DATA_DIR` (true/false) mà Task 5 sẽ dùng.

- [ ] **Step 1: Cài SDK pin cứng**

```bash
npm install --save-exact @proxyshard/shardx@0.1.11
```

Mở `package.json` kiểm tra dòng dependency phải là `"@proxyshard/shardx": "0.1.11"` (không có `^`).

- [ ] **Step 2: Viết script spike**

Tạo `scripts/verify/01-spike.mjs`:

```js
import { ShardX } from '@proxyshard/shardx'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const PROXY = process.env.SHARDX_PROXY || null   // vd: socks5://user:pass@host:1080
const OLD_UDD = process.env.OLD_USER_DATA_DIR || null

// cacheDir MUST be absolute: the SDK does not resolve() it, and a relative
// path makes chrome.exe and the SDK disagree on where user-data-dir lives,
// which makes readCdpEndpoint() time out and return null.
const sdk = new ShardX({
  cacheDir: resolve('./.spike-cache'),
  progress: (label, got, total) => {
    if (total) process.stdout.write(`\r${label}: ${Math.round((got / total) * 100)}%   `)
  }
})

console.log('\n[1] Tao profile tu thu vien...')
const profile = await sdk.createProfile(undefined, { platform: 'windows' })
console.log('    id =', profile.id)
console.log('    platform =', profile.platform, '| hasWebGPU =', profile.hasWebGPU)

console.log('[2] Launch voi cdp + extraArgs...')
const session = await sdk.launch(profile, {
  proxy: PROXY ?? undefined,
  cdp: true,
  screenMode: 'profile',
  webrtc: 'auto',
  userDataDir: OLD_UDD ?? undefined,
  extraArgs: [
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=CalculateNativeWinOcclusion',
    '--window-position=-32000,-32000'
  ]
})

console.log('    cdpUrl      =', session.cdpUrl)
console.log('    userDataDir =', session.userDataDir)
console.log('    quicEnabled =', session.quicEnabled, '| proxyUdpMs =', session.proxyUdpMs)
console.log('    webrtcMode  =', session.webrtcMode)
console.log('    geo         =', session.geo ? `${session.geo.countryCode} ${session.geo.timezone}` : null)
console.log('    pid         =', session.pid, '| co ChildProcess =', !!session.process?.kill)

console.log('[3] Kiem tra cookie cu con khong...')
if (OLD_UDD) {
  console.log('    Cookies file ton tai =', existsSync(`${OLD_UDD}/Default/Network/Cookies`))
  console.log('    => Mo tay trinh duyet, vao tiktok.com xem con dang nhap khong.')
}

console.log('\nDe cua so mo 30s de ban kiem tra. Ctrl+C de dung som.')
await new Promise((r) => setTimeout(r, 30000))
await session.stop()
console.log('[4] Da dung.')
```

- [ ] **Step 3: Chạy lần 1 — không proxy, không tái dùng thư mục cũ**

```bash
node scripts/verify/01-spike.mjs
```

Kỳ vọng: tải engine + Widevine + thư viện fingerprint (**~511MB** đo thực tế, không phải 150MB như tài liệu của họ gợi ý), in ra `cdpUrl` dạng `ws://127.0.0.1:.../devtools/browser/...`, `userDataDir` có đường dẫn tuyệt đối, `co ChildProcess = true`. Cửa sổ mở ngoài màn hình (không thấy) — đó là dấu hiệu `extraArgs` được nhận.

Nếu `cdpUrl` là `null`, kiểm tra trước khi kết luận: tìm file `DevToolsActivePort` dưới `.spike-cache` bằng
`find .spike-cache -name DevToolsActivePort`. Nếu file **có tồn tại** ở một
đường dẫn khác `session.userDataDir` thì đó là lỗi đường dẫn tương đối — kiểm
tra lại `cacheDir` đã dùng `resolve()` chưa. Nếu file **không tồn tại ở đâu cả**
thì `cdp: true` thật sự vô tác dụng → **dừng lại và báo**, cả kế hoạch phụ
thuộc điều này.

- [ ] **Step 4: Chạy lần 2 — có proxy nước ngoài**

```bash
SHARDX_PROXY="socks5://user:pass@host:1080" node scripts/verify/01-spike.mjs
```

Kỳ vọng: `geo` in ra mã nước và IANA timezone của nước proxy (không phải `Asia/Ho_Chi_Minh`). Ghi lại `quicEnabled` — proxy HTTP sẽ là `false`, SOCKS5 có UDP sẽ là `true`.

- [ ] **Step 5: ~~Chạy lần 3 — trỏ vào user-data-dir cũ~~ ĐÃ HUỶ**

Chủ dự án chốt ngày 2026-08-02: bỏ hoàn toàn các phiên đăng nhập cũ, tự tạo lại
danh sách profile và đăng nhập lại từ đầu. `REUSE_USER_DATA_DIR = false` là
quyết định, không phải kết quả đo. Bỏ qua bước này.

- [ ] **Step 6: Ghi kết luận**

Tạo `docs/superpowers/plans/notes-spike.md` ghi rõ:

```markdown
# Kết quả spike 2026-08-02

- cdpUrl trả về: <có/không> — giá trị mẫu
- extraArgs có tác dụng: <có/không> — bằng chứng: cửa sổ có bị đẩy ra ngoài màn hình không
- userDataDir do SDK trả về: <đường dẫn>
- geo qua proxy: <countryCode> <timezone> — có khớp nước proxy không
- quicEnabled với proxy đang dùng: <true/false>
- session.process là ChildProcess: <có/không>
- REUSE_USER_DATA_DIR = <true/false>  ← Task 5 dùng giá trị này
  Lý do: <cookie TikTok còn / mất>
- deleteProfile có xoá user-data-dir không: <có/không>
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json scripts/verify/01-spike.mjs docs/superpowers/plans/notes-spike.md
git commit -m "chore: spike xac minh ShardX SDK truoc khi tich hop"
```

---

### Task 2: ShardEngine — nạp runtime và vòng đời profile

**Files:**
- Create: `src/main/services/ShardEngine.ts`
- Create: `scripts/verify/02-shardengine.mjs`

**Interfaces:**
- Consumes: `dataRoot()` từ `src/main/db.ts`.
- Produces:
  - `ensureRuntime(): Promise<void>`
  - `createShardProfile(platform: string): Promise<string>` — trả về shard profile id
  - `deleteShardProfile(shardId: string): Promise<void>`
  - `readShardConfig(shardId: string): Record<string, unknown>`
  - `writeShardConfig(shardId: string, overrides: Record<string, unknown>): void`
  - `listDevices(platform: string): Promise<string[]>`
  - `engineEvents: EventEmitter` — phát `('progress', { phase, pct })` giống `EngineManager` cũ

- [ ] **Step 1: Viết script verify (sẽ fail vì chưa có file)**

Tạo `scripts/verify/02-shardengine.mjs`:

```js
// Chay bang: node scripts/verify/02-shardengine.mjs
// Import truc tiep file TS da build khong kha thi -> ta test lai logic bang SDK tho,
// va doi chieu ket qua voi ShardEngine khi chay app that.
import { ShardX } from '@proxyshard/shardx'

const sdk = new ShardX({ cacheDir: './.spike-cache' })

const devices = await sdk.listProfiles({ platform: 'windows' })
console.log('so thiet bi windows:', devices.length)
if (devices.length === 0) throw new Error('FAIL: thu vien rong')

const p1 = await sdk.createProfile(undefined, { platform: 'windows' })
const p2 = await sdk.createProfile(undefined, { platform: 'windows' })
console.log('p1:', p1.id, '| p2:', p2.id)
if (p1.id === p2.id) throw new Error('FAIL: hai profile trung id')

const gpu1 = JSON.stringify(p1.config.webgl)
const gpu2 = JSON.stringify(p2.config.webgl)
console.log('gpu1:', gpu1)
console.log('gpu2:', gpu2)
if (gpu1 === gpu2) console.warn('CANH BAO: hai profile trung GPU — chay lai vai lan de xac nhan')

const saved = sdk.listSavedProfiles()
if (!saved.includes(p1.id)) throw new Error('FAIL: createProfile khong luu xuong dia')

sdk.deleteProfile(p1.id)
sdk.deleteProfile(p2.id)
if (sdk.listSavedProfiles().includes(p1.id)) throw new Error('FAIL: deleteProfile khong xoa')

console.log('PASS')
```

- [ ] **Step 2: Chạy để thấy nó pass ở tầng SDK**

```bash
node scripts/verify/02-shardengine.mjs
```

Kỳ vọng: in `PASS`. Nếu `CANH BAO` xuất hiện nhiều lần liên tiếp thì `createProfile` không đa dạng thiết bị — ghi lại, Task 3 sẽ phải tự bốc thiết bị bằng `library.filter()`.

- [ ] **Step 3: Viết `ShardEngine.ts`**

```ts
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
```

- [ ] **Step 4: Build và kiểm tra dynamic import sống sót**

```bash
npm run build
```

```bash
grep -c "import(" out/main/index.js
```

Kỳ vọng: số đếm ≥ 1. Nếu bằng 0 thì rollup đã hạ `import()` thành `require()` — sửa bằng cách thay `import('@proxyshard/shardx')` thành:

```ts
const dynamicImport = new Function('s', 'return import(s)') as (s: string) => Promise<any>
modPromise = dynamicImport('@proxyshard/shardx')
```

rồi build lại và kiểm tra lại.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/ShardEngine.ts scripts/verify/02-shardengine.mjs
git commit -m "feat: them ShardEngine boc ShardX SDK"
```

---

### Task 3: Kiểu Fingerprint mới, migration DB, lớp dịch

**Files:**
- Modify: `src/shared/types.ts` (kiểu `Fingerprint`)
- Modify: `src/main/db.ts:166` (thêm `addColumn`)
- Modify: `src/main/services/FingerprintEngine.ts` (viết lại)
- Modify: `src/main/services/ProfileStore.ts` (đọc/ghi cột mới)

**Interfaces:**
- Consumes: `readShardConfig`, `writeShardConfig`, `listDevices` từ Task 2.
- Produces:
  - `toShardOverrides(fp: Fingerprint): Record<string, unknown>`
  - `fromShardConfig(cfg: Record<string, unknown>): Fingerprint`
  - `defaultFingerprint(): Fingerprint`

- [ ] **Step 1: Đổi kiểu `Fingerprint`**

Trong `src/shared/types.ts`, thay khối `Fingerprint` hiện tại bằng:

```ts
export type WebRtcMode = 'auto' | 'block' | 'tcp_only'
export type NoiseVector = 'canvas' | 'webgl' | 'audio' | 'client_rects' | 'sensors' | 'fonts'

export interface Fingerprint {
  deviceId: string            // id entry trong thư viện ShardX
  platform: 'windows' | 'macos' | 'linux'
  userAgent: string           // chỉ đọc — engine tự chuẩn hoá
  hardwareConcurrency: number
  deviceMemory: number
  screen: { width: number; height: number }
  webgl: { vendor: string; renderer: string }
  language: string
  languages: string[]
  timezone: string            // IANA hoặc "auto"
  webrtc: WebRtcMode
  noise: NoiseVector[]        // vector nào bật nhiễu; rỗng = tất cả để Thật
}
```

Xoá `seed`, `brand`, `browserVersion`, `blockWebRTC`.

- [ ] **Step 2: Thêm migration**

Trong `src/main/db.ts`, ngay dưới dòng `addColumn(d, 'profiles', 'proxy_id', \`TEXT\`)`:

```ts
addColumn(d, 'profiles', 'shard_profile_id', `TEXT`)
addColumn(d, 'proxies', 'timezone', `TEXT`)
addColumn(d, 'proxies', 'latitude', `REAL`)
addColumn(d, 'proxies', 'longitude', `REAL`)
addColumn(d, 'proxies', 'udp_ms', `INTEGER`)
addColumn(d, 'proxies', 'quic_ok', `INTEGER`)
```

Xoá khối `UPDATE profiles SET fingerprint = json_set(...)` ở cuối `migrate()` — nó thao tác trên khoá `hardwareConcurrency` của định dạng cũ, không còn ý nghĩa.

- [ ] **Step 3: Viết lại `FingerprintEngine.ts`**

```ts
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
```

- [ ] **Step 4: Thêm cột vào `ProfileStore`**

Trong `src/main/services/ProfileStore.ts`, thêm `shard_profile_id` vào interface hàng, vào câu `SELECT`, và vào hàm map:

```ts
shard_profile_id: string | null
```

```ts
shardProfileId: r.shard_profile_id,
```

Thêm hàm:

```ts
setShardProfileId(id: string, shardId: string): void {
  getDb().prepare('UPDATE profiles SET shard_profile_id = ? WHERE id = ?').run(shardId, id)
}
```

Khai báo `shardProfileId: string | null` trong kiểu `Profile` ở `src/shared/types.ts`.

- [ ] **Step 5: Kiểm tra migration chạy được**

```bash
npm run build
```

Chạy app một lần rồi kiểm tra cột đã có:

```bash
node -e "const D=require('better-sqlite3');const p=process.env.APPDATA+'/hiennvauto/data/hiennvauto.db';const d=new D(p);console.log(d.prepare('PRAGMA table_info(profiles)').all().map(c=>c.name).join(', '))"
```

Kỳ vọng: danh sách cột có `shard_profile_id`.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/db.ts src/main/services/FingerprintEngine.ts src/main/services/ProfileStore.ts
git commit -m "feat: kieu Fingerprint moi theo ShardX + migration shard_profile_id"
```

---

### Task 4: Hàm launch dùng chung trong ShardEngine

**Files:**
- Modify: `src/main/services/ShardEngine.ts`

**Interfaces:**
- Consumes: `getSdk()` nội bộ, `toShardOverrides` từ Task 3, `ProfileStore` để lấy proxy.
- Produces:
  - `ANTI_THROTTLE: string[]`
  - `openBrowsing(profile: Profile): Promise<Session>`
  - `openAutomation(profile: Profile): Promise<{ browser: Browser; session: Session }>`
  - `closeSession(profileId: string): Promise<void>`
  - `isRunning(profileId: string): boolean`

  `Session` là `BrowserSession` của SDK: có `cdpUrl`, `userDataDir`, `pid`, `process`, `quicEnabled`, `proxyUdpMs`, `webrtcMode`, `geo`, `stop()`.

- [ ] **Step 1: Thêm phần launch vào `ShardEngine.ts`**

```ts
import puppeteer, { type Browser } from 'puppeteer-core'
import { ProfileStore } from './ProfileStore'
import { toShardOverrides } from './FingerprintEngine'
import type { Profile } from '@shared/types'

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
```

- [ ] **Step 2: Kiểm tra URL trang chủ mở được khi `cdp: false`**

Đây là điểm nghi ngờ ghi trong spec. Sửa tạm `scripts/verify/01-spike.mjs` bỏ `--window-position` và thêm `'https://tiktok.com'` vào cuối `extraArgs`, rồi chạy:

```bash
node scripts/verify/01-spike.mjs
```

Kỳ vọng: cửa sổ mở thẳng vào tiktok.com. Nếu không, ghi vào `notes-spike.md` và đổi `openBrowsing` sang bật `cdp: true` rồi `page.goto(home)` sau khi connect.

- [ ] **Step 3: Build kiểm tra không lỗi kiểu**

```bash
npm run build
```

Kỳ vọng: build thành công.

- [ ] **Step 4: Commit**

```bash
git add src/main/services/ShardEngine.ts
git commit -m "feat: openBrowsing va openAutomation trong ShardEngine"
```

---

### Task 5: Chuyển `BrowserLauncher` sang ShardEngine

**Files:**
- Modify: `src/main/services/BrowserLauncher.ts` (viết lại toàn bộ)

**Interfaces:**
- Consumes: `openBrowsing`, `closeSession`, `isRunning` từ Task 4.
- Produces: `launcherEvents`, `runProfile(id)`, `stopProfile(id)` — giữ nguyên chữ ký cũ để `ipc.ts` không phải sửa.

- [ ] **Step 1: Viết lại file**

```ts
import { EventEmitter } from 'events'
import { openBrowsing, closeSession, isRunning } from './ShardEngine'
import { ProfileStore } from './ProfileStore'
import { cleanProfileCache } from './cacheCleaner'
import { trackProc } from './EngineProcs'

export const launcherEvents = new EventEmitter()

/**
 * Launch a profile for manual browsing. No CDP is enabled so there is no
 * automation footprint.
 */
export async function runProfile(id: string): Promise<void> {
  if (isRunning(id)) return
  const profile = ProfileStore.get(id)
  if (!profile) throw new Error('Không tìm thấy profile')

  const session = await openBrowsing(profile)
  trackProc(session.process)

  ProfileStore.setRunning(id, true)
  ProfileStore.markLastUsed(id)
  launcherEvents.emit('status', id, 'running')

  session.process.on('exit', () => {
    ProfileStore.setRunning(id, false)
    launcherEvents.emit('status', id, 'idle')
    cleanProfileCache(session.userDataDir)
  })
}

export async function stopProfile(id: string): Promise<void> {
  await closeSession(id)
}
```

Xoá `buildArgs` và mọi import của `ensureEngine` / `ensureRelay` / `getRelayPort`.

- [ ] **Step 2: Sửa `ipc.ts` nếu `stopProfile` đổi sang async**

```bash
grep -n "stopProfile" src/main/ipc.ts
```

Nếu handler gọi không `await` thì thêm `await`.

- [ ] **Step 3: Chạy app và mở một profile bằng tay**

```bash
npm run dev
```

Bấm "Mở" trên một profile. Kỳ vọng: trình duyệt mở, trạng thái đổi sang "Đang chạy", đóng lại thì trạng thái về "Nghỉ".

- [ ] **Step 4: Commit**

```bash
git add src/main/services/BrowserLauncher.ts src/main/ipc.ts
git commit -m "refactor: BrowserLauncher dung ShardEngine"
```

---

### Task 6: Chuyển bốn điểm automation

**Files:**
- Modify: `src/main/services/AutomationRunner.ts:152-184`
- Modify: `src/main/services/TikTokLogin.ts:364-390`
- Modify: `src/main/services/TikTokSync.ts:32-56`
- Modify: `src/main/services/AnalyticsService.ts:51-69`

**Interfaces:**
- Consumes: `openAutomation`, `closeSession` từ Task 4.
- Produces: không có API mới.

- [ ] **Step 1: Sửa `AutomationRunner.ts`**

Xoá các import `ensureEngine`, `ensureRelay`, `buildArgs`, `spawn`, `waitForWsEndpoint`, `rmSync`, `join`. Thay khối từ `const enginePath = await ensureEngine()` tới dòng `puppeteer.connect(...)` bằng:

```ts
    log('Khởi động trình duyệt…')
    const { browser: b, session: s } = await openAutomation(profile)
    browser = b
    session = s
    trackProc(session.process)
    ProfileStore.markLastUsed(profile.id)
```

Khai báo `let session: any = null` cạnh `let browser`. Trong khối `finally` của hàm, thay chỗ `child?.kill()` bằng `await closeSession(profile.id)`.

- [ ] **Step 2: Sửa `TikTokLogin.ts`**

Thay khối từ `const enginePath = await ensureEngine()` tới `puppeteer.connect(...)` bằng:

```ts
  const { browser: b, session } = await openAutomation(profile)
  browser = b
  trackProc(session.process)
```

Trong `finally`, thay `child?.kill()` bằng `await closeSession(profile.id)`.

- [ ] **Step 3: Sửa `TikTokSync.ts`**

```ts
  const { browser: b, session } = await openAutomation(profile)
  browser = b
  trackProc(session.process)
```

Trong `finally`, thay `child?.kill()` bằng `await closeSession(profile.id)`.

- [ ] **Step 4: Sửa `AnalyticsService.ts`**

```ts
  const { browser: b, session } = await openAutomation(profile)
  browser = b
  trackProc(session.process)
```

Trong `finally`, thay `child?.kill()` bằng `await closeSession(profile.id)`.

Lưu ý: file này trước đây **không** gọi `ensureRelay`, nên profile dùng proxy HTTP có mật khẩu đang hỏng. Sau khi sửa thì hết, vì SDK tự lo auth.

- [ ] **Step 5: Bảo đảm luôn nhả trạng thái khi lỗi**

Trong cả bốn file, khối `finally` phải có:

```ts
    ProfileStore.setRunning(profile.id, false)
```

- [ ] **Step 6: Chạy thử một job upload thật**

```bash
npm run dev
```

Đưa một video vào queue cho một profile, chạy. Kỳ vọng: cửa sổ mở ngoài màn hình, log chạy qua các bước, video lên thành công.

- [ ] **Step 7: Commit**

```bash
git add src/main/services/AutomationRunner.ts src/main/services/TikTokLogin.ts src/main/services/TikTokSync.ts src/main/services/AnalyticsService.ts
git commit -m "refactor: bon diem automation dung ShardEngine"
```

---

### Task 7: Xoá engine cũ

**Files:**
- Delete: `src/main/services/EngineManager.ts`
- Delete: `src/main/services/ProxyRelay.ts`
- Modify: `src/main/ipc.ts` (nếu có handler tiến trình tải engine)

**Interfaces:**
- Consumes: `engineEvents` từ `ShardEngine` thay cho `engineEvents` của `EngineManager`.
- Produces: không có.

- [ ] **Step 1: Tìm mọi chỗ còn tham chiếu**

```bash
grep -rn "EngineManager\|ProxyRelay\|ensureEngine\|ensureRelay\|getRelayPort\|findEngine\|engineDir" src/
```

Kỳ vọng sau khi Task 5 và 6 xong: chỉ còn dòng import `engineEvents` (nếu có) trong `ipc.ts` hoặc `index.ts`.

- [ ] **Step 2: Trỏ `engineEvents` sang ShardEngine**

Ở mọi nơi còn `import { engineEvents } from './services/EngineManager'`, đổi thành:

```ts
import { engineEvents } from './services/ShardEngine'
```

- [ ] **Step 3: Xoá hai file**

```bash
git rm src/main/services/EngineManager.ts src/main/services/ProxyRelay.ts
```

- [ ] **Step 4: Build kiểm tra sạch**

```bash
npm run build
```

```bash
grep -rn "EngineManager\|ProxyRelay" src/ || echo "sach"
```

Kỳ vọng: build thành công, grep in `sach`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: xoa EngineManager va ProxyRelay"
```

---

### Task 8: Sửa UI tối thiểu cho khớp kiểu mới

Đây là mức tối thiểu để app chạy được. Thiết kế lại toàn bộ tab Profile là plan riêng (`docs/superpowers/specs/2026-08-02-profile-tab-redesign-design.md`).

**Files:**
- Modify: `src/renderer/src/features/profile/ProfileSettingsDialog.tsx:248-289`
- Modify: `src/renderer/src/features/profile/NewProfileDialog.tsx`
- Modify: `src/main/ipc.ts` (thêm handler `profiles:devices`)

**Interfaces:**
- Consumes: `listDevices` từ Task 2, kiểu `Fingerprint` từ Task 3.
- Produces: không có.

Lưu ý: task này vẫn dùng `<select>` gốc của trình duyệt vì đang bám theo code
hiện có. Nguyên tắc "không dùng control mặc định" được thực thi ở plan thiết kế
lại tab Profile, nơi mọi `<select>` bị thay bằng dropdown tự vẽ. Đừng sửa
sang dropdown tự vẽ trong task này — sẽ trùng việc.

- [ ] **Step 1: Thêm IPC trả danh sách thiết bị**

Trong `src/main/ipc.ts`:

```ts
ipcMain.handle('profiles:devices', async (_e, platform: string) => listDevices(platform))
```

Trong `src/preload/index.ts`, thêm vào nhóm `profiles`:

```ts
devices: (platform: string): Promise<string[]> => ipcRenderer.invoke('profiles:devices', platform)
```

- [ ] **Step 2: Thay ô Seed bằng ô thiết bị**

Trong `ProfileSettingsDialog.tsx`, thay nút "🎲 Đổi seed" và ô hiển thị Seed bằng:

```tsx
<div>
  <L>Thiết bị / GPU</L>
  <div className="inp">{fp.webgl.renderer || fp.deviceId || '—'}</div>
</div>
```

- [ ] **Step 3: Đổi ô WebRTC từ 2 sang 3 lựa chọn**

```tsx
<div>
  <L>WebRTC</L>
  <select
    className="inp"
    value={fp.webrtc}
    onChange={(e) => setFp({ webrtc: e.target.value as Fingerprint['webrtc'] })}
  >
    <option value="auto">Tự động — đi qua proxy, giữ QUIC</option>
    <option value="tcp_only">Chỉ TCP</option>
    <option value="block">Chặn hoàn toàn</option>
  </select>
</div>
```

Text cũ "(tắt QUIC → upload chậm hơn)" phải bỏ — không còn đúng vì ShardX giữ QUIC qua SOCKS5.

- [ ] **Step 4: Sửa ô Trình duyệt cho hiển thị đúng**

```tsx
<div><L>Trình duyệt</L><div className="inp ro">{fp.userAgent || '—'}</div></div>
```

- [ ] **Step 5: Sửa `NewProfileDialog.tsx`**

Thay lời gọi `generateFingerprint()` bằng `defaultFingerprint()`. Việc tạo profile bên ShardX do `ensureShardId()` lo lazy ở lần mở đầu tiên, dialog không cần gọi gì thêm.

- [ ] **Step 6: Chạy app kiểm tra**

```bash
npm run dev
```

Mở cài đặt một profile. Kỳ vọng: ô Thiết bị hiện tên GPU, ô Trình duyệt hiện User-Agent thật, WebRTC có ba lựa chọn, lưu được và mở lại thấy đúng giá trị vừa lưu.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/features/profile/ProfileSettingsDialog.tsx src/renderer/src/features/profile/NewProfileDialog.tsx src/main/ipc.ts src/preload/index.ts
git commit -m "feat: UI profile khop kieu Fingerprint moi"
```

---

### Task 9: Cache geo và hiển thị QUIC

**Files:**
- Modify: `src/main/services/ShardEngine.ts` (ghi kết quả session vào proxies)
- Modify: `src/main/services/ProxyStore.ts` (hàm ghi)
- Modify: `src/renderer/src/features/proxy/ProxyTab.tsx` (hiển thị)

**Interfaces:**
- Consumes: `session.geo`, `session.quicEnabled`, `session.proxyUdpMs` từ Task 4.
- Produces: `ProxyStore.saveProbe(proxyId, { timezone, latitude, longitude, udpMs, quicOk })`

- [ ] **Step 1: Thêm hàm ghi vào `ProxyStore.ts`**

```ts
saveProbe(
  id: string,
  d: { timezone: string | null; latitude: number | null; longitude: number | null; udpMs: number | null; quicOk: boolean }
): void {
  getDb()
    .prepare('UPDATE proxies SET timezone = ?, latitude = ?, longitude = ?, udp_ms = ?, quic_ok = ? WHERE id = ?')
    .run(d.timezone, d.latitude, d.longitude, d.udpMs, d.quicOk ? 1 : 0, id)
}
```

- [ ] **Step 2: Bảo đảm `Profile` có `proxyId`**

```bash
grep -n "proxyId\|proxy_id" src/main/services/ProfileStore.ts src/shared/types.ts
```

Cột `proxy_id` đã có trong DB từ migration cũ. Nếu `ProfileStore` chưa map ra
`proxyId` thì thêm vào interface hàng, vào câu `SELECT`, vào hàm map, và khai
`proxyId: string | null` trong kiểu `Profile`.

- [ ] **Step 3: Ghi lại sau mỗi lần launch**

Cuối hàm `launch()` trong `ShardEngine.ts`, trước `return session`:

```ts
  if (profile.proxyId && session.geo) {
    ProxyStore.saveProbe(profile.proxyId, {
      timezone: session.geo.timezone ?? null,
      latitude: session.geo.latitude ?? null,
      longitude: session.geo.longitude ?? null,
      udpMs: session.proxyUdpMs ?? null,
      quicOk: Boolean(session.quicEnabled)
    })
  }
```

- [ ] **Step 4: Hiển thị trong `ProxyTab`**

Thêm cột "UDP / QUIC" vào bảng proxy:

```tsx
<td className="px-3 py-3">
  {p.udpMs == null ? (
    <span className="text-muted">—</span>
  ) : (
    <span>
      <b className={p.quicOk ? 'text-ok' : 'text-muted'}>{p.quicOk ? 'QUIC' : 'TCP'}</b>{' '}
      <span className="text-subtle">{p.udpMs} ms</span>
    </span>
  )}
</td>
```

Thêm `udpMs` và `quicOk` vào kiểu proxy trong `types.ts` và vào câu `SELECT` của `ProxyStore`.

- [ ] **Step 5: Chạy app, mở một profile có proxy**

```bash
npm run dev
```

Mở profile, đóng, sang tab Proxy. Kỳ vọng: cột mới hiện `QUIC 42 ms` hoặc `TCP —`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: luu ket qua geo/UDP tu session vao proxies va hien trong ProxyTab"
```

---

### Task 10: Kiểm chứng cuối

**Files:**
- Create: `docs/superpowers/plans/notes-verify.md`

**Interfaces:**
- Consumes: toàn bộ các task trên.
- Produces: kết quả đo, quyết định có giữ thay đổi hay revert.

- [ ] **Step 1: Đo khác biệt giữa hai profile**

Tạo hai profile mới, mở từng cái, vào `https://browserleaks.com/webgl` ghi lại `WebGL Renderer` và `Canvas Hash`; vào `https://webgpureport.org` ghi lại adapter.

Kỳ vọng: hai profile khác GPU, khác canvas hash, khác độ phân giải.

- [ ] **Step 2: Đo timezone theo proxy**

Mở một profile gán proxy nước ngoài, vào `https://browserleaks.com/javascript`, đọc `Time Zone`.

Kỳ vọng: khớp nước của proxy, **không** phải `Asia/Ho_Chi_Minh`.

- [ ] **Step 3: Đo throttle khi chạy song song**

Chạy queue với 4 profile cùng lúc, cửa sổ đẩy ngoài màn hình. Bấm giờ tổng thời gian upload, so với số liệu trước khi đổi engine.

Kỳ vọng: chênh lệch dưới 20%. Nếu chậm hơn nhiều, kiểm tra `extraArgs` có thật sự tới engine không bằng cách mở `chrome://version` trong profile và đọc Command Line.

- [ ] **Step 4: Ghi kết quả**

```markdown
# Kết quả kiểm chứng 2026-08-02

| Phép đo | Trước | Sau | Đạt |
|---|---|---|---|
| GPU khác nhau giữa 2 profile | không | ? | |
| Canvas hash khác nhau | không | ? | |
| Screen khác nhau | không | ? | |
| Timezone khớp proxy | không | ? | |
| Thời gian upload 4 profile song song | ? phút | ? phút | |
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/notes-verify.md
git commit -m "docs: ket qua kiem chung sau khi doi engine"
```

---

## Ngoài phạm vi plan này

- **Tab Settings** (chọn nhà cung cấp geo, `probeTimeoutMs`, sao lưu engine).
  Spec có nêu, nhưng `cacheDir` — mục quan trọng nhất — đã được đặt cứng đúng chỗ
  trong Task 2, nên phần còn lại để plan sau. Không chặn việc đổi engine.
- **Thiết kế lại tab Profile.** Plan riêng, dựa trên
  `docs/superpowers/specs/2026-08-02-profile-tab-redesign-design.md` và
  `mockups/profile.html`. Chạy sau khi plan này xong, vì panel mới hiển thị các
  trường chỉ tồn tại sau khi đổi engine.
- **Giảm dấu vết hành vi** (jitter cho `sleep`, `delay` gõ phím, giãn lịch chạy).
  Độc lập với engine, rủi ro lớn hơn fingerprint, nhưng là việc riêng.

## Ghi chú rủi ro khi thực thi

- **Nếu Task 1 Step 3 cho `cdpUrl = null`** thì dừng toàn bộ plan. Không có CDP thì không có automation.
- **Nếu Task 2 Step 4 cho `grep -c "import("` = 0** thì phải dùng cách `new Function` trước khi đi tiếp, nếu không app sẽ chết lúc chạy với `ERR_REQUIRE_ESM`.
- **Engine tự cập nhật.** Sau khi Task 10 đạt, sao lưu thư mục `<userData>/data/shardx` để có bản engine đã kiểm chứng mà quay về.
- **Geo rate limit.** Task 9 mới chỉ lưu kết quả, chưa dùng cache để tránh gọi lại. Nếu chạy queue lớn mà thấy lỗi geo, thêm bước đọc cache trước khi launch.
