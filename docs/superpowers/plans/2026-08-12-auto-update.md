# Auto-update qua GitHub Releases — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Người dùng bấm một nút trong tab Cài đặt là app tải và cài được bản mới nhất từ GitHub Releases.

**Architecture:** `electron-updater` đọc `latest.yml` trên GitHub Releases, so với `app.getVersion()`. Một service ở main process (`UpdateService`) bọc toàn bộ tương tác với thư viện và phát trạng thái qua `EventEmitter` — đúng pattern các service sẵn có trong repo. IPC + preload đưa trạng thái đó ra renderer; renderer hiển thị một khối "Phiên bản" trong `SettingTab`. Đóng gói chuyển từ target `dir` sang `nsis` vì `electron-updater` cần installer để cài đè.

**Tech Stack:** Electron 30, electron-builder 24.13.3, electron-updater 6.x, electron-vite 2, React 18, TypeScript 5, Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-12-auto-update-design.md`

## Global Constraints

- **Không có test framework trong repo này.** Không có vitest/jest, không có file `*.test.*`. Đừng dựng framework mới — kiểm chứng bằng `npx tsc --noEmit`, `npm run build`, chạy app thật và quan sát. Task 7 là bước kiểm chứng end-to-end bắt buộc.
- **`tsc` sạch và build sạch KHÔNG phải bằng chứng tính năng chạy.** Mọi tuyên bố "xong" phải kèm kết quả quan sát được từ app đang chạy.
- **Toàn bộ chuỗi hiển thị cho người dùng phải là tiếng Việt.** Comment trong code cũng viết tiếng Việt theo đúng phong cách các file hiện có (giải thích *tại sao*, không mô tả lại code).
- **Không dùng control mặc định của browser** (`<select>`, `<progress>`, `<input type=checkbox>` trần…). Tự dựng bằng div + Tailwind, theo đúng style sẵn có trong `SettingTab.tsx`.
- **`electron-updater` phải nằm trong `dependencies`, KHÔNG phải `devDependencies`.** electron-builder chỉ đóng gói production dependencies; để nhầm chỗ thì bản cài đặt thiếu module và app chết ngay khi khởi động.
- **Repo phát hành:** `Hienducnguyen1206/TiktokMultiAccountManager` (public, nhánh mặc định `main`).
- **Token GitHub** đọc từ biến môi trường `GH_TOKEN`. Không ghi token vào bất kỳ file nào trong repo.
- **Version hiện tại là `1.0.0`** trong `package.json`.
- Sau mỗi task: commit. Message tiếng Việt không dấu, theo đúng kiểu các commit hiện có (`feat:`, `fix:`, `docs:`).

---

## File Structure

**Tạo mới:**
- `build/afterPack.js` — hook electron-builder, gắn icon vào exe đúng thời điểm (trước khi đóng gói installer).
- `src/main/services/UpdateService.ts` — toàn bộ logic auto-update ở main. Không file nào khác được import `electron-updater`.
- `src/renderer/src/features/setting/settingUi.tsx` — `Section`, `Row`, `Warn` chuyển từ `SettingTab.tsx` sang. Lý do: `UpdateSection` cần dùng ba component này, mà để chúng nằm trong `SettingTab.tsx` thì `SettingTab → UpdateSection → SettingTab` thành import vòng.
- `src/renderer/src/features/setting/UpdateSection.tsx` — khối UI "Phiên bản". Tách file riêng vì `SettingTab.tsx` đã 441 dòng và mỗi section trong đó là một khối độc lập.

**Sửa:**
- `package.json` — dependency, target `nsis`, `publish`, `nsis`, `afterPack`, script `release`.
- `scripts/set-exe-icon.ps1` — nhận tham số `-AppDir` thay vì đường dẫn ghi cứng.
- `src/shared/types.ts` — kiểu `UpdateState`, `UpdateInfo`, nhánh `update` trong `HnvApi`, `onUpdateState`.
- `src/main/ipc.ts` — 5 IPC handler + cầu nối sự kiện.
- `src/preload/index.ts` — nhánh `update` + `onUpdateState`.
- `src/renderer/src/features/setting/SettingTab.tsx` — import và đặt `<UpdateSection />`.
- `src/main/index.ts` — kiểm tra nền khi mở app.
- `docs/dong-goi.md` — mục "Bản build ra cái gì" đã lỗi thời.

**Thứ tự phụ thuộc:** Task 1 (đóng gói) độc lập. Task 2 → 3 → 4 → 5 nối tiếp nhau. Task 6, 7 cuối.

---

### Task 1: Chuyển đóng gói sang NSIS và sửa thời điểm gắn icon

**Files:**
- Modify: `package.json:7-40`
- Create: `build/afterPack.js`
- Modify: `scripts/set-exe-icon.ps1:11-17`

**Interfaces:**
- Consumes: không có.
- Produces: `npm run dist` sinh `release/HienNVAuto Setup 1.0.0.exe`; `npm run release` thêm bước upload. Cấu hình `publish` là thứ Task 2 dựa vào để `autoUpdater` biết hỏi ở đâu.

**Bối cảnh bắt buộc đọc trước:** `docs/dong-goi.md` giải thích vì sao `signAndEditExecutable` phải để `false` và vì sao icon được gắn bằng script PowerShell riêng. Đừng "sửa" chỗ đó — bật cờ lên là hỏng build trên máy chưa bật Developer Mode.

- [ ] **Step 1: Cài electron-updater vào dependencies**

```bash
npm install --save electron-updater@^6.3.9
```

Mở `package.json` xác nhận nó nằm trong `"dependencies"`, không phải `"devDependencies"`. Nếu npm đặt sai chỗ, tự chuyển sang `dependencies`.

- [ ] **Step 2: Sửa `scripts/set-exe-icon.ps1` để nhận thư mục app từ ngoài**

Thêm `param` ở đầu file (ngay dưới khối comment, trước `$ErrorActionPreference`), và đổi cách tính `$exe`:

```powershell
# Nhận thư mục app từ hook afterPack của electron-builder. Gọi tay không tham số
# thì rơi về đường dẫn cũ, để script vẫn chạy độc lập được khi cần soi.
param([string]$AppDir = '')

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe  = if ($AppDir) { Join-Path $AppDir 'HienNVAuto.exe' } else { Join-Path $root 'release\win-unpacked\HienNVAuto.exe' }
$icon = Join-Path $root 'build\icon.ico'
```

Phần còn lại của file giữ nguyên.

- [ ] **Step 3: Tạo `build/afterPack.js`**

```js
// Gắn icon + thông tin phiên bản vào HienNVAuto.exe NGAY SAU khi electron-builder
// pack xong thư mục app, TRƯỚC khi nó đóng gói thành installer.
//
// Trước đây `npm run dist` gọi scripts/set-exe-icon.ps1 ở bước cuối. Với target
// `dir` thì đúng — thư mục win-unpacked chính là sản phẩm cuối. Với `nsis` thì
// SAI: electron-builder pack thư mục rồi đóng gói installer ngay trong cùng một
// lệnh, nên khi script chạy thì installer đã ôm sẵn bản .exe chưa có icon. Hook
// này chạy đúng khe giữa hai bước đó.
const { execFileSync } = require('child_process')
const { join } = require('path')

exports.default = async function afterPack(context) {
  if (process.platform !== 'win32') return
  const script = join(context.packager.projectDir, 'scripts', 'set-exe-icon.ps1')
  execFileSync(
    'powershell',
    ['-ExecutionPolicy', 'Bypass', '-File', script, '-AppDir', context.appOutDir],
    { stdio: 'inherit' }
  )
}
```

- [ ] **Step 4: Sửa khối `build` và `scripts` trong `package.json`**

Trong `"scripts"`, thay dòng `dist` và thêm `release` (bỏ lời gọi PowerShell — hook lo rồi):

```json
"dist": "electron-vite build && electron-builder --win",
"release": "electron-vite build && electron-builder --win --publish always"
```

Trong `"build"`, đổi `win.target` và thêm ba khoá `nsis`, `publish`, `afterPack`:

```json
"afterPack": "build/afterPack.js",
"publish": [
  {
    "provider": "github",
    "owner": "Hienducnguyen1206",
    "repo": "TiktokMultiAccountManager"
  }
],
"win": {
  "target": [
    "nsis"
  ],
  "icon": "build/icon.ico",
  "signAndEditExecutable": false
},
"nsis": {
  "oneClick": true,
  "perMachine": false,
  "allowToChangeInstallationDirectory": false,
  "deleteAppDataOnUninstall": false
}
```

`deleteAppDataOnUninstall: false` là cố ý: gỡ app không được xóa profile, cookie và database của người dùng.

- [ ] **Step 5: Build thử và kiểm chứng bằng mắt**

```bash
npm run dist
```

Phải thấy:
1. File `release/HienNVAuto Setup 1.0.0.exe` tồn tại.
2. File `release/latest.yml` tồn tại — không có file này thì auto-update không hoạt động.
3. Dòng `Da gan icon vao ...` xuất hiện trong log build (chứng tỏ hook chạy).

Mở `release/win-unpacked/` trong Explorer, xác nhận `HienNVAuto.exe` hiện icon chứ không phải icon Electron mặc định.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json build/afterPack.js scripts/set-exe-icon.ps1
git commit -m "feat(build): dong goi NSIS, gan icon qua hook afterPack"
```

---

### Task 2: UpdateService ở main process

**Files:**
- Create: `src/main/services/UpdateService.ts`
- Modify: `src/shared/types.ts` (thêm `UpdateState`, `UpdateInfo` vào phần khai báo kiểu, đặt cạnh các kiểu khác trước `HnvApi`)

**Interfaces:**
- Consumes: cấu hình `build.publish` từ Task 1.
- Produces:
  - `updateEvents: EventEmitter` — phát sự kiện `'state'` với một `UpdateState`.
  - `currentInfo(): UpdateInfo`
  - `checkForUpdate(): Promise<UpdateState>`
  - `downloadUpdate(): Promise<UpdateState>`
  - `installNow(): void`
  - `canInstall(): boolean`
  - `checkInBackground(): Promise<void>`

- [ ] **Step 1: Thêm kiểu vào `src/shared/types.ts`**

Đặt ngay trước `export interface HnvApi {`:

```ts
// ---- Auto-update ----

/** Trạng thái của tiến trình cập nhật app. `kind` quyết định UI hiện gì. */
export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'latest' }
  | { kind: 'available'; newVersion: string }
  | { kind: 'downloading'; percent: number }
  | { kind: 'downloaded'; newVersion: string }
  | { kind: 'error'; message: string }
  /** Bản dev, hoặc build chưa qua installer — electron-updater không chạy được. */
  | { kind: 'unsupported'; note: string }

export interface UpdateInfo {
  /** Phiên bản đang chạy, từ package.json. */
  current: string
  state: UpdateState
  /** false khi hàng đợi còn job chạy/chờ — khởi động lại lúc này là hỏng việc. */
  canInstall: boolean
}
```

- [ ] **Step 2: Viết `src/main/services/UpdateService.ts`**

```ts
import { app } from 'electron'
import { EventEmitter } from 'events'
import { autoUpdater } from 'electron-updater'
import type { UpdateInfo, UpdateState } from '@shared/types'
import { QueueManager } from './QueueManager'

export const updateEvents = new EventEmitter()

// Không tự tải: người dùng bấm mới tải. Tải ngầm vài trăm MB trên máy đang chạy
// automation là thứ không ai xin.
autoUpdater.autoDownload = false
// Không tự cài lúc thoát: app này thường bị tắt giữa chừng một phiên làm việc,
// cài đè đúng lúc đó là thay file dưới chân tiến trình đang dọn dẹp.
autoUpdater.autoInstallOnAppQuit = false

let state: UpdateState = { kind: 'idle' }

function setState(s: UpdateState): void {
  state = s
  updateEvents.emit('state', s)
}

/** Bản dev không có installer nên electron-updater không có gì để so. */
function unsupported(): UpdateState {
  return {
    kind: 'unsupported',
    note: 'Cập nhật chỉ hoạt động ở bản đã cài đặt, không chạy ở bản dev'
  }
}

autoUpdater.on('checking-for-update', () => setState({ kind: 'checking' }))
autoUpdater.on('update-available', (info) =>
  setState({ kind: 'available', newVersion: info.version })
)
autoUpdater.on('update-not-available', () => setState({ kind: 'latest' }))
autoUpdater.on('download-progress', (p) =>
  setState({ kind: 'downloading', percent: Math.round(p.percent) })
)
autoUpdater.on('update-downloaded', (info) =>
  setState({ kind: 'downloaded', newVersion: info.version })
)
autoUpdater.on('error', (e) => setState({ kind: 'error', message: viError(e) }))

/**
 * Lỗi của electron-updater là tiếng Anh và hay lộ cả URL. Dịch sang câu người
 * dùng hiểu được.
 *
 * Trường hợp 404 KHÔNG phải lỗi: repo chưa có release nào thì đúng là chưa có
 * bản mới. Báo đỏ ở đây chỉ dọa người dùng vì một tình huống bình thường.
 */
function viError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  if (/404/.test(raw)) return ''
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|network/i.test(raw)) {
    return 'Không kết nối được máy chủ cập nhật. Kiểm tra mạng rồi thử lại.'
  }
  return `Lỗi cập nhật: ${raw}`
}

export function canInstall(): boolean {
  return !QueueManager.list().some((j) => j.status === 'running' || j.status === 'queued')
}

export function currentInfo(): UpdateInfo {
  return {
    current: app.getVersion(),
    state: app.isPackaged ? state : unsupported(),
    canInstall: canInstall()
  }
}

export async function checkForUpdate(): Promise<UpdateState> {
  if (!app.isPackaged) {
    setState(unsupported())
    return state
  }
  try {
    await autoUpdater.checkForUpdates()
  } catch (e) {
    const msg = viError(e)
    // Chuỗi rỗng = 404 = chưa có release nào. Coi như đang dùng bản mới nhất.
    setState(msg ? { kind: 'error', message: msg } : { kind: 'latest' })
  }
  return state
}

export async function downloadUpdate(): Promise<UpdateState> {
  if (!app.isPackaged) {
    setState(unsupported())
    return state
  }
  try {
    await autoUpdater.downloadUpdate()
  } catch (e) {
    const msg = viError(e)
    setState({ kind: 'error', message: msg || 'Tải bản cập nhật thất bại' })
  }
  return state
}

export function installNow(): void {
  if (!app.isPackaged) return
  // isSilent = false để người dùng thấy trình cài chạy; isForceRunAfter = true
  // để app tự mở lại — không thì họ tưởng app biến mất.
  autoUpdater.quitAndInstall(false, true)
}

/**
 * Kiểm tra lúc mở app. Nuốt lỗi hoàn toàn: không có mạng là chuyện thường, và
 * đây không phải thứ đáng để một cửa sổ vừa mở đã ném thông báo đỏ vào mặt.
 */
export async function checkInBackground(): Promise<void> {
  if (!app.isPackaged) return
  try {
    await checkForUpdate()
  } catch {
    /* im lặng — trạng thái đã được set trong checkForUpdate */
  }
}
```

- [ ] **Step 3: Kiểm tra biên dịch**

```bash
npx tsc --noEmit
```

Expected: không lỗi. Nếu báo không tìm thấy kiểu của `electron-updater`, kiểm tra lại nó đã được cài ở Step 1 của Task 1 chưa.

- [ ] **Step 4: Kiểm tra app vẫn khởi động được**

```bash
npm run dev
```

App phải mở bình thường. Service chưa được nối vào đâu nên chưa có gì mới trên giao diện — điều cần xác nhận ở bước này là việc `import { autoUpdater }` ở tầng module không làm chết main process. Xem terminal, không được có lỗi liên quan tới `electron-updater`. Tắt app.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/UpdateService.ts src/shared/types.ts
git commit -m "feat(update): service auto-update o main process"
```

---

### Task 3: IPC, preload và kiểu API

**Files:**
- Modify: `src/main/ipc.ts` (import ở đầu file; handler đặt cạnh nhóm `getvideo:`; cầu nối sự kiện đặt cạnh các dòng `*.on(...)` quanh dòng 275-290)
- Modify: `src/preload/index.ts`
- Modify: `src/shared/types.ts` (nhánh `update` trong `HnvApi`)

**Interfaces:**
- Consumes: `updateEvents`, `currentInfo`, `checkForUpdate`, `downloadUpdate`, `installNow` từ Task 2.
- Produces: `window.hnv.update.{info,check,download,install}` và `window.hnv.onUpdateState(cb)` — Task 4 dùng đúng những tên này.

- [ ] **Step 1: Thêm nhánh `update` vào `HnvApi` trong `src/shared/types.ts`**

Đặt sau nhánh `queue`, trước `system`:

```ts
  update: {
    info: () => Promise<UpdateInfo>
    check: () => Promise<UpdateState>
    download: () => Promise<UpdateState>
    install: () => Promise<void>
  }
```

Và thêm dòng này cạnh các `on*` khác ở cuối `HnvApi` (cạnh `onQueueUpdate`):

```ts
  onUpdateState: (cb: (s: UpdateState) => void) => () => void
```

- [ ] **Step 2: Thêm handler vào `src/main/ipc.ts`**

Thêm import cạnh các import service khác ở đầu file:

```ts
import {
  checkForUpdate,
  currentInfo,
  downloadUpdate,
  installNow,
  updateEvents
} from './services/UpdateService'
```

Bổ sung `UpdateState` vào khối `import type { ... } from '@shared/types'` đã có ở đầu file.

Thêm bốn handler, đặt ngay sau nhóm `getvideo:` (quanh dòng 182):

```ts
  // update
  ipcMain.handle('update:info', () => currentInfo())
  ipcMain.handle('update:check', () => checkForUpdate())
  ipcMain.handle('update:download', () => downloadUpdate())
  ipcMain.handle('update:install', () => installNow())
```

- [ ] **Step 3: Nối sự kiện về renderer**

Thêm vào cụm cầu nối sự kiện (sau dòng `analyticsEvents.on('progress', ...)`):

```ts
  updateEvents.on('state', (s: UpdateState) => sendToRenderer('update:state', s))
```

- [ ] **Step 4: Thêm vào `src/preload/index.ts`**

Bổ sung `UpdateInfo` và `UpdateState` vào khối `import type` ở đầu file.

Thêm nhánh `update` vào object `api`, đặt sau nhánh `queue`:

```ts
  update: {
    info: (): Promise<UpdateInfo> => ipcRenderer.invoke('update:info'),
    check: (): Promise<UpdateState> => ipcRenderer.invoke('update:check'),
    download: (): Promise<UpdateState> => ipcRenderer.invoke('update:download'),
    install: (): Promise<void> => ipcRenderer.invoke('update:install')
  },
```

Thêm listener ngay trước `onJobLog` (giữ đúng kiểu trả về hàm huỷ đăng ký như mọi listener khác):

```ts
  onUpdateState: (cb: (s: UpdateState) => void) => {
    const handler = (_e: unknown, s: UpdateState): void => cb(s)
    ipcRenderer.on('update:state', handler)
    return () => ipcRenderer.removeListener('update:state', handler)
  },
```

- [ ] **Step 5: Kiểm tra biên dịch**

```bash
npx tsc --noEmit
```

Expected: không lỗi. `HnvApi` là kiểu chung nên nếu preload thiếu hàm nào so với khai báo, TypeScript sẽ báo ngay tại `const api: HnvApi = {`.

- [ ] **Step 6: Kiểm chứng cầu IPC thật sự thông**

```bash
npm run dev
```

Mở DevTools của app (F12), gõ vào Console:

```js
await window.hnv.update.info()
```

Expected: trả về object dạng `{ current: '1.0.0', state: { kind: 'unsupported', note: '...' }, canInstall: true }`. `unsupported` ở bản dev là đúng — đó chính là nhánh `!app.isPackaged`. Nếu trả về `undefined` hoặc ném lỗi thì preload chưa nối đúng.

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc.ts src/preload/index.ts src/shared/types.ts
git commit -m "feat(update): cau IPC va preload cho auto-update"
```

---

### Task 4: Khối "Phiên bản" trong tab Cài đặt

**Files:**
- Create: `src/renderer/src/features/setting/settingUi.tsx`
- Create: `src/renderer/src/features/setting/UpdateSection.tsx`
- Modify: `src/renderer/src/features/setting/SettingTab.tsx:11-53,131-137` (bỏ ba component, import từ file mới, đặt `<UpdateSection />`)

**Interfaces:**
- Consumes: `window.hnv.update.*`, `window.hnv.onUpdateState` từ Task 3; `window.hnv.onQueueUpdate` đã có sẵn.
- Produces: component `UpdateSection`; `Section`/`Row`/`Warn` từ `settingUi.tsx`.

**Lưu ý decomposition:** `Section`, `Row`, `Warn` hiện là hàm private trong `SettingTab.tsx`. Đừng chỉ thêm `export` cho chúng rồi để `UpdateSection` import ngược từ `SettingTab` — `SettingTab` cũng phải import `UpdateSection`, thành import vòng. Chuyển hẳn ba component sang file riêng, cả hai bên cùng import từ đó. Cũng đừng chép lại chúng — hai bản sao sẽ lệch nhau ngay lần chỉnh style đầu tiên.

- [ ] **Step 1: Tạo `src/renderer/src/features/setting/settingUi.tsx`**

Cắt nguyên văn ba hàm `Section` (dòng 11-34), `Row` (dòng 37-53) và `Warn` (dòng 131-137) từ `SettingTab.tsx` sang file mới, giữ nguyên cả khối comment tiếng Việt phía trên mỗi hàm, và thêm `export` cho cả ba. File mới cần import:

```tsx
import { Icon, type IconName } from '../../components/Icon'
```

- [ ] **Step 2: Sửa `SettingTab.tsx` dùng file mới**

Xóa ba hàm vừa cắt khỏi `SettingTab.tsx`, thêm import:

```tsx
import { Row, Section, Warn } from './settingUi'
```

Nếu sau khi xóa mà `IconName` không còn được dùng trong `SettingTab.tsx`, bỏ nó khỏi dòng import `Icon` — không thì `tsc` sẽ than biến không dùng.

- [ ] **Step 3: Viết `src/renderer/src/features/setting/UpdateSection.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { showToast } from '../../components/uiDialogs'
import type { UpdateInfo, UpdateState } from '@shared/types'
import { Row, Section, Warn } from './settingUi'

/** Câu mô tả trạng thái, hiện ở cột trái cạnh nút. */
function label(s: UpdateState): string {
  switch (s.kind) {
    case 'idle':
      return 'Chưa kiểm tra lần nào trong phiên này'
    case 'checking':
      return 'Đang kiểm tra…'
    case 'latest':
      return 'Bạn đang dùng bản mới nhất'
    case 'available':
      return `Đã có bản ${s.newVersion}`
    case 'downloading':
      return `Đang tải… ${s.percent}%`
    case 'downloaded':
      return `Đã tải xong bản ${s.newVersion}`
    case 'error':
      return s.message
    case 'unsupported':
      return s.note
  }
}

/**
 * Thanh tiến trình tải. Tự dựng bằng div chứ không dùng <progress> — thẻ mặc
 * định của browser không theo được theme và mỗi hệ điều hành vẽ một kiểu.
 */
function Bar({ percent }: { percent: number }): JSX.Element {
  return (
    <div className="h-[6px] rounded-full bg-[rgba(255,255,255,.07)] overflow-hidden">
      <div
        className="h-full accent-grad transition-[width] duration-200"
        style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
      />
    </div>
  )
}

/**
 * Cập nhật app.
 *
 * App tự kiểm tra lúc khởi động; mục này để ép kiểm ngay và để thao tác tải/cài.
 * Nút cài bị khóa khi hàng đợi còn việc: quitAndInstall() đóng app ngay lập tức,
 * làm thế giữa một phiên upload là mất trắng công đang chạy.
 */
export function UpdateSection(): JSX.Element {
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    const load = (): void => {
      window.hnv.update.info().then((v) => alive && setInfo(v))
    }
    load()
    // Trạng thái do main đẩy sang (tiến trình tải, kết quả kiểm tra nền).
    const offState = window.hnv.onUpdateState((s) =>
      setInfo((prev) => (prev ? { ...prev, state: s } : prev))
    )
    // Hàng đợi đổi → canInstall có thể đổi theo.
    const offQueue = window.hnv.onQueueUpdate(load)
    return () => {
      alive = false
      offState()
      offQueue()
    }
  }, [])

  const check = async (): Promise<void> => {
    setBusy(true)
    try {
      const s = await window.hnv.update.check()
      if (s.kind === 'latest') showToast('Bạn đang dùng bản mới nhất', 'success')
      if (s.kind === 'available') showToast(`Đã có bản ${s.newVersion}`, 'success')
      if (s.kind === 'error') showToast(s.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const download = async (): Promise<void> => {
    setBusy(true)
    try {
      const s = await window.hnv.update.download()
      if (s.kind === 'error') showToast(s.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const install = async (): Promise<void> => {
    await window.hnv.update.install()
  }

  const state: UpdateState = info?.state ?? { kind: 'idle' }
  const checking = busy || state.kind === 'checking'
  const downloading = state.kind === 'downloading'

  return (
    <Section icon="sync" title="Phiên bản">
      <Row label="Phiên bản đang chạy">
        <span className="text-[12.5px] text-muted">{info?.current ?? '…'}</span>
      </Row>

      <Row label="Tự kiểm tra bản mới">
        <span className="text-[12.5px] text-muted">Mỗi lần mở app</span>
      </Row>

      {downloading && <Bar percent={state.percent} />}

      {state.kind === 'downloaded' && !info?.canInstall && (
        <Warn>
          Hàng đợi đang có việc chạy. Đợi chạy xong rồi hãy cài — khởi động lại lúc này
          sẽ làm hỏng phiên đang chạy.
        </Warn>
      )}

      <div className="flex items-center gap-3 pt-1">
        <span
          className={
            'text-[12.5px] mr-auto ' +
            (state.kind === 'error' ? 'text-warn' : 'text-muted')
          }
        >
          {label(state)}
        </span>

        {state.kind === 'downloaded' ? (
          <button
            onClick={install}
            disabled={!info?.canInstall}
            className="accent-grad text-[#0a0b10] font-bold rounded-[9px] px-5 h-9 text-[13.5px] disabled:opacity-40"
          >
            Cài đặt & khởi động lại
          </button>
        ) : state.kind === 'available' ? (
          <button
            onClick={download}
            disabled={downloading}
            className="accent-grad text-[#0a0b10] font-bold rounded-[9px] px-5 h-9 text-[13.5px] disabled:opacity-40"
          >
            {downloading ? 'Đang tải…' : 'Tải về'}
          </button>
        ) : (
          <button
            onClick={check}
            disabled={checking || state.kind === 'unsupported'}
            className="accent-grad text-[#0a0b10] font-bold rounded-[9px] px-5 h-9 text-[13.5px] disabled:opacity-40"
          >
            {checking ? 'Đang kiểm tra…' : 'Kiểm tra cập nhật'}
          </button>
        )}
      </div>
    </Section>
  )
}
```

- [ ] **Step 4: Đặt khối vào tab Cài đặt**

Trong `SettingTab.tsx`, thêm import:

```tsx
import { UpdateSection } from './UpdateSection'
```

Và đặt `<UpdateSection />` vào cuối danh sách section, sau `<CleanSection />`:

```tsx
        <ChannelSearchSection />
        <YtDlpSection />
        <CleanSection />
        <UpdateSection />
```

- [ ] **Step 5: Kiểm tra biên dịch**

```bash
npx tsc --noEmit
```

Expected: không lỗi. Đặc biệt chú ý lỗi import vòng hoặc "cannot find module './settingUi'" — nghĩa là Step 1 chưa xong.

- [ ] **Step 6: Kiểm chứng bằng mắt trên app đang chạy**

```bash
npm run dev
```

Mở tab **Cài đặt**, cuộn xuống cuối. Phải thấy:
1. Khối "Phiên bản" với icon, tiêu đề, và đường kẻ dưới — trông đồng bộ với ba khối phía trên, không lệch khoảng cách.
2. Dòng "Phiên bản đang chạy" hiện `1.0.0`.
3. Câu trạng thái là "Cập nhật chỉ hoạt động ở bản đã cài đặt, không chạy ở bản dev" và nút **Kiểm tra cập nhật** bị làm mờ (disabled). Đây là hành vi đúng ở bản dev.

4. Ba khối phía trên (Tìm kênh, yt-dlp, Dọn dẹp) vẫn hiển thị y hệt trước đây — đây là bằng chứng việc tách `settingUi.tsx` ở Step 1 không làm vỡ gì.

Chụp lại màn hình hoặc mô tả cụ thể những gì thấy khi báo cáo. "Biên dịch sạch" không thay được bước này.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/features/setting/
git commit -m "feat(update): khoi Phien ban trong tab Cai dat"
```

---

### Task 5: Tự kiểm tra khi mở app

**Files:**
- Modify: `src/main/index.ts:72` (thêm ngay dưới `void autoUpdateYtDlp()`)
- Modify: `src/renderer/src/App.tsx:34-47` (thêm listener vào `useEffect` đã có)

**Interfaces:**
- Consumes: `checkInBackground()` từ Task 2; `window.hnv.onUpdateState` từ Task 3.
- Produces: không có API mới.

**Vì sao toast nằm ở `App.tsx` chứ không phải trong `UpdateSection`:** `App.tsx:71-90` render tab bằng chuỗi ternary, nên tab nào không được chọn thì bị unmount hoàn toàn. `UpdateSection` chỉ sống khi người dùng đang đứng ở tab Cài đặt — mà lúc app vừa mở thì tab mặc định là `profile`. Đặt listener trong `UpdateSection` thì đúng lúc kiểm tra nền trả kết quả, chẳng có ai nghe. `App.tsx` luôn sống.

- [ ] **Step 1: Gọi kiểm tra nền trong `src/main/index.ts`**

Thêm import cạnh các import service khác:

```ts
import { checkInBackground } from './services/UpdateService'
```

Thêm ngay sau `void autoUpdateYtDlp()` (dòng 72):

```ts
  // Kiểm tra bản mới của chính app, chạy nền sau khi cửa sổ đã load. Không chờ:
  // mạng chậm không được phép làm app mở chậm. Có bản mới thì khối "Phiên bản"
  // trong tab Cài đặt tự đổi trạng thái qua sự kiện update:state.
  setTimeout(() => { void checkInBackground() }, 6000)
```

- [ ] **Step 2: Hiện toast khi phát hiện bản mới, trong `src/renderer/src/App.tsx`**

Thêm `showToast` vào import đã có ở dòng 13:

```tsx
import { showToast, UiDialogsHost } from './components/uiDialogs'
```

Trong `useEffect` ở dòng 34-47, thêm listener thứ ba và huỷ nó ở hàm cleanup:

```tsx
    // Kiểm tra nền lúc mở app trả kết quả về đây. Toast đặt ở App chứ không ở
    // tab Cài đặt: lúc app vừa mở người dùng đang đứng ở tab Profile, mà các tab
    // không được chọn thì bị unmount hẳn — để trong tab thì không ai nghe.
    const offUpdate = window.hnv.onUpdateState((s) => {
      if (s.kind === 'available') {
        showToast(`Đã có bản ${s.newVersion} — vào Cài đặt để cập nhật`, 'success')
      }
    })
    return () => {
      off()
      offChanged()
      offUpdate()
    }
```

Bổ sung `UpdateState` vào khối `import type` ở dòng 15 nếu TypeScript cần.

- [ ] **Step 3: Kiểm tra biên dịch và chạy**

```bash
npx tsc --noEmit
```

```bash
npm run dev
```

Ở bản dev, `checkInBackground()` thoát ngay vì `!app.isPackaged` — không có gì xảy ra, và đó là đúng. Điều cần xác nhận: app vẫn khởi động bình thường, không có lỗi mới trong terminal. Việc kiểm chứng thật nằm ở Task 7.

- [ ] **Step 4: Kiểm chứng toast thật sự bắn được**

Không đợi tới Task 7 mới biết listener có hoạt động không. Mở DevTools của app đang chạy (F12) và giả lập một sự kiện từ main — chạy trong Console:

```js
await window.hnv.update.check()
```

Ở bản dev việc này trả `unsupported` nên chưa bắn toast. Để kiểm chính đường dây, tạm sửa `checkInBackground()` trong `UpdateService.ts`: bỏ dòng `if (!app.isPackaged) return` và thay thân hàm bằng `setState({ kind: 'available', newVersion: '9.9.9' })`. Chạy lại `npm run dev` — sau 6 giây phải thấy toast "Đã có bản 9.9.9 — vào Cài đặt để cập nhật" ở tab Profile.

**Hoàn nguyên `checkInBackground()` về đúng bản gốc sau khi kiểm xong.** Chạy `git diff src/main/services/UpdateService.ts` để chắc chắn không còn sót đoạn giả lập nào trước khi commit.

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts src/renderer/src/App.tsx
git commit -m "feat(update): tu kiem tra ban moi khi mo app"
```

---

### Task 6: Cập nhật tài liệu đóng gói

**Files:**
- Modify: `docs/dong-goi.md` (mục "Bản build ra cái gì")

**Interfaces:** không có.

- [ ] **Step 1: Thay mục "Bản build ra cái gì"**

Mục hiện tại mô tả `win.target = dir` và việc `set-exe-icon.ps1` chạy ở bước cuối — cả hai đều sai sau Task 1. Thay bằng:

````markdown
## Bản build ra cái gì

`win.target` là `nsis`, nên `npm run dist` tạo trình cài đặt:

```
release/HienNVAuto Setup <version>.exe
release/latest.yml
```

`latest.yml` là thứ `electron-updater` đọc để biết có bản mới — thiếu file này
thì auto-update im lặng không hoạt động. Thư mục `release/win-unpacked/` vẫn
được sinh ra như bước trung gian, chạy trực tiếp được, nhưng không phải sản phẩm
để phát hành.

## Icon được gắn lúc nào

`scripts/set-exe-icon.ps1` KHÔNG còn chạy ở bước cuối của `npm run dist` nữa. Nó
được gọi từ hook `afterPack` (`build/afterPack.js`), tức là sau khi electron-builder
pack xong thư mục app và trước khi đóng gói installer.

Thứ tự này là bắt buộc, không phải sở thích: với target `nsis`, electron-builder
pack rồi đóng gói ngay trong cùng một lệnh. Chạy script sau đó thì icon chỉ vào
được thư mục `win-unpacked`, còn bản `.exe` nằm trong installer vẫn trắng trơn.

## Phát hành bản mới

1. Sửa `version` trong `package.json`.
2. `npm run release`

Lệnh này build, tạo installer + `latest.yml`, rồi upload lên GitHub Releases của
`Hienducnguyen1206/TiktokMultiAccountManager`. Token đọc từ biến môi trường
`GH_TOKEN` — không nằm trong repo.
````

- [ ] **Step 2: Commit**

```bash
git add docs/dong-goi.md
git commit -m "docs: cap nhat ghi chu dong goi cho NSIS va auto-update"
```

---

### Task 7: Kiểm chứng end-to-end trên bản cài đặt thật

**Files:** không sửa file nào (trừ `version` trong `package.json` khi lên bản thử).

**Interfaces:** không có.

Đây là task quan trọng nhất và không được bỏ. Mọi task trước chỉ chứng minh code biên dịch được và giao diện hiện đúng ở bản dev — nơi auto-update bị tắt theo thiết kế. Đường đi thật chưa từng chạy lần nào cho tới bước này.

**Điều kiện tiên quyết:** biến môi trường `GH_TOKEN` đã được đặt trên máy (do tác giả tự làm, xem spec mục 2.1). Kiểm tra bằng `$env:GH_TOKEN` trong PowerShell — rỗng thì dừng lại và báo, đừng đoán.

- [ ] **Step 1: Phát hành bản 1.0.0**

```bash
npm run release
```

Vào https://github.com/Hienducnguyen1206/TiktokMultiAccountManager/releases xác nhận có release `v1.0.0` kèm hai file: `HienNVAuto Setup 1.0.0.exe` và `latest.yml`.

Nếu release ở trạng thái **draft**, bấm publish — `electron-updater` không nhìn thấy draft.

- [ ] **Step 2: Cài bản 1.0.0 lên máy**

Chạy `HienNVAuto Setup 1.0.0.exe` tải từ GitHub (không dùng file local — mục đích là kiểm chứng đúng thứ người dùng nhận được).

Mở app từ shortcut. Vào tab Cài đặt → khối Phiên bản phải hiện `1.0.0` và nút **Kiểm tra cập nhật** giờ đã bấm được (không còn `unsupported` như bản dev). Bấm thử: phải ra "Bạn đang dùng bản mới nhất".

- [ ] **Step 3: Phát hành bản 1.0.1**

Sửa `version` trong `package.json` thành `1.0.1`, rồi:

```bash
npm run release
```

Xác nhận release `v1.0.1` đã publish trên GitHub.

- [ ] **Step 4: Kiểm chứng luồng cập nhật**

Mở lại app **1.0.0** đã cài ở Step 2 (không phải bản dev). Theo thứ tự:

1. Chờ khoảng 10 giây sau khi app mở → toast báo có bản 1.0.1 phải hiện.
2. Vào Cài đặt → khối Phiên bản hiện "Đã có bản 1.0.1" + nút **Tải về**.
3. Bấm **Tải về** → thanh tiến trình chạy từ 0 lên 100.
4. Nút đổi thành **Cài đặt & khởi động lại** → bấm.
5. App đóng, trình cài chạy, app tự mở lại.
6. Vào Cài đặt → "Phiên bản đang chạy" hiện `1.0.1`.

Ghi lại kết quả từng bước. Bước nào không đúng thì dừng và báo, đừng bỏ qua.

- [ ] **Step 5: Kiểm chứng dữ liệu còn nguyên sau cập nhật**

Trên bản 1.0.1 vừa cập nhật:

1. Tab Profile — danh sách profile còn đủ, đúng số lượng như trước khi cập nhật.
2. Tab Cài đặt — API key YouTube đã nhập vẫn còn.
3. Tab Get Video — trạng thái Deno và yt-dlp vẫn hiện "đã có", không phải tải lại từ đầu.

Đây là điều spec dựa vào (dữ liệu nằm ở `userData` ngoài thư mục cài đặt). Phải xác nhận bằng quan sát, không suy luận.

- [ ] **Step 6: Kiểm chứng khóa nút khi hàng đợi bận**

Trên bản đã cài: đưa một job vào hàng đợi và cho chạy. Trong lúc job đang chạy, vào tab Cài đặt. Nếu đang ở trạng thái đã tải xong bản mới, nút **Cài đặt & khởi động lại** phải bị làm mờ kèm ô cảnh báo vàng.

Nếu lúc kiểm chứng không còn bản mới nào để tải (đã cập nhật lên 1.0.1 rồi), phát hành thêm bản `1.0.2` để dựng lại tình huống.

- [ ] **Step 7: Kiểm chứng icon**

Mở thư mục cài đặt (`%LOCALAPPDATA%\Programs\HienNVAuto` với `perMachine: false`), xác nhận `HienNVAuto.exe` có icon đúng. Kiểm cả shortcut ngoài Desktop / Start Menu.

Đây là bằng chứng hook `afterPack` ở Task 1 chạy đúng khe — thứ mà bản build target `dir` không kiểm được.

- [ ] **Step 8: Commit version cuối**

```bash
git add package.json
git commit -m "chore: bump version sau kiem chung auto-update"
```

---

## Ghi chú cho người thực hiện

**SmartScreen.** Lần cài đầu tiên Windows sẽ cảnh báo "Nhà phát hành không xác định" vì app không ký số. Bấm "More info → Run anyway". Đây là điều đã biết và chấp nhận (spec mục 8), không phải lỗi cần sửa.

**Đừng bật `signAndEditExecutable`.** Nó làm hỏng build trên máy chưa bật Developer Mode. Lý do đầy đủ nằm trong `docs/dong-goi.md`.

**Đừng loại `patchright` khỏi bundle** để giảm dung lượng installer. `@proxyshard/shardx` phụ thuộc cứng vào nó ở tầng module. Đã có người thử và ghi lại trong `docs/dong-goi.md`.
