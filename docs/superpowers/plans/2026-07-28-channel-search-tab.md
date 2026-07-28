# Tab "Search Kênh" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tab mới tìm & lọc kênh YouTube theo 18 tiêu chí + check trùng trên TikTok qua profile antidetect, lưu danh sách ứng viên có trạng thái, tích hợp 1-click sang tab Get Video.

**Architecture:** Electron (main/preload/renderer). Main: 3 service mới (`ChannelSearchService` — YouTube Data API v3 + fallback yt-dlp; `TikTokSearch` — spawn fingerprint-chromium off-screen + CDP theo pattern `TikTokSync.ts`; `ChannelSearchStore` — SQLite). Renderer: feature `search/` gồm 3 file (shell + khu Tìm kiếm + khu Ứng viên). Spec: `docs/superpowers/specs/2026-07-28-channel-search-design.md`.

**Tech Stack:** TypeScript, React 18, Tailwind, better-sqlite3, puppeteer-core, yt-dlp (đã có `YtDlpManager`), YouTube Data API v3 (fetch), `franc-min` (dependency MỚI duy nhất — detect ngôn ngữ).

## Global Constraints

- **Không có git repo** (E:\Tool2 chưa `git init`) → bỏ qua mọi bước commit. Nếu người dùng muốn, hỏi trước khi `git init`.
- **Không có test framework** — codebase 0 test, spec quy định kiểm thử thủ công. Mỗi task kết thúc bằng: `npx tsc --noEmit` (phải sạch lỗi trong phạm vi file mình sửa) + bước verify thủ công ghi rõ trong task. KHÔNG tự thêm test framework.
- UI copy tiếng Việt; code/comment tiếng Anh hoặc Việt theo file xung quanh (codebase dùng lẫn — giữ nguyên phong cách file đang sửa).
- Theo convention codebase: DB cột `snake_case`, types `camelCase`, store là object literal export (xem `GetVideoStore.ts`), service export function + `EventEmitter` cho log.
- KHÔNG bật `PRAGMA foreign_keys` (codebase không bật — FK hiện không enforce). Xóa liên đới phải làm thủ công trong store.
- Không dùng `FindObjectOfType`-kiểu anti-pattern React: reference trực tiếp, không polling.
- Chạy dev để verify UI: `npm run dev` (electron-vite).

---

### Task 1: Types + DB migration

**Files:**
- Modify: `src/shared/types.ts` (thêm section Channel Search trước `export interface HnvApi`, và thêm namespace vào `HnvApi`)
- Modify: `src/main/db.ts` (thêm 3 bảng vào `migrate()`)

**Interfaces:**
- Consumes: —
- Produces: toàn bộ types `Cs*` + 3 bảng SQLite mà mọi task sau dùng. Chữ ký chính xác ở Step 1–2.

- [ ] **Step 1: Thêm types vào `src/shared/types.ts`**

Chèn NGAY TRƯỚC dòng `export interface HnvApi {`:

```ts
// ---- Channel Search (tab Search Kênh: tìm kênh YouTube + check trùng TikTok) ----

export type CsStatus = 'new' | 'good' | 'own_tiktok' | 'reupped' | 'skip' | 'in_use'

export interface CsLangPct {
  lang: string // mã 2 chữ ('en','vi'…) hoặc ISO639-3 nếu không map được
  pct: number // 0..100
}

/** Chỉ số kênh. Trường nào không lấy được (fallback yt-dlp / kênh tắt comment) = null → UI hiện "—". */
export interface CsChannelMetrics {
  subs: number | null
  videoCount: number | null
  avgViews: number | null
  lastUploadAt: number | null // epoch ms
  uploadsPerWeek: number | null
  country: string | null // ISO hoa, ví dụ 'US'
  ytCreatedAt: number | null // epoch ms
  likeViewPct: number | null
  commentViewPct: number | null
  viewSubRatio: number | null
  momentumPct: number | null // view TB 5 video mới so với 15 video trước, % (+/-)
  viewConsistency: number | null // median/mean view của 20 video gần nhất, 0..1
  shortsPct: number | null // % video ≤180s trong 20 video gần nhất
  shortsCount: number | null // API: ước tính videoCount×shortsPct; yt-dlp: playlist_count tab Shorts
  topics: string[] | null // từ topicDetails, ví dụ ["Gaming"]
  audienceLangs: CsLangPct[] | null // phân bố ngôn ngữ ~50 comment + 20 tiêu đề
}

export interface CsSearchResult extends CsChannelMetrics {
  ytChannelId: string
  url: string
  name: string
  handle: string // '@abc' hoặc ''
  thumbnail: string
}

export interface CsTiktokMatch {
  id: string
  candidateId: string
  username: string // unique_id TikTok, không có '@'
  nickname: string
  followers: number | null
  videoCount: number | null
  avatarUrl: string
  fetchedAt: number
}

export interface CsCandidate extends CsSearchResult {
  id: string
  status: CsStatus
  tiktokCheckedAt: number | null
  createdAt: number
  matches: CsTiktokMatch[]
}

/** Filter nào = null / [] nghĩa là không áp dụng. */
export interface CsSearchParams {
  keyword: string
  subsMin: number | null
  subsMax: number | null
  countries: string[] // ISO hoa; [] = mọi quốc gia
  ageMinDays: number | null // kênh tạo tối thiểu X ngày trước
  ageMaxDays: number | null // kênh tạo trong vòng X ngày
  topicsAny: string[] // match không phân biệt hoa thường, substring; [] = mọi chủ đề
  uploadsPerWeekMin: number | null
  lastUploadWithinDays: number | null
  shortsCountMin: number | null
  durationMaxSec: number | null // median duration 20 video gần nhất ≤ X
  avgViewsMin: number | null
  likeViewPctMin: number | null
  commentViewPctMin: number | null
  viewSubRatioMin: number | null
  momentumPctMin: number | null
  viewConsistencyMin: number | null // 0..1
  shortsPctMin: number | null
  audienceLang: string | null // mã 2 chữ
  audienceLangPctMin: number // mặc định 50, chỉ dùng khi audienceLang != null
}

export interface CsSettings {
  apiKey: string // '' = dùng fallback yt-dlp
  checkProfileId: string // profile antidetect dùng search TikTok
  topN: number // số account TikTok lưu mỗi lần check, mặc định 5
}
```

- [ ] **Step 2: Thêm namespace vào `HnvApi` trong `src/shared/types.ts`**

Trong `export interface HnvApi`, thêm sau block `getvideo: {...}`:

```ts
  channelSearch: {
    search: (params: CsSearchParams) => Promise<CsSearchResult[]>
    listCandidates: () => Promise<CsCandidate[]>
    addCandidate: (r: CsSearchResult) => Promise<{ candidate: CsCandidate; existed: boolean }>
    removeCandidate: (id: string) => Promise<void>
    setStatus: (id: string, status: CsStatus) => Promise<void>
    checkTiktok: (id: string) => Promise<CsTiktokMatch[]>
    getSettings: () => Promise<CsSettings>
    saveSettings: (s: CsSettings) => Promise<CsSettings>
  }
```

Và thêm cạnh `onGetVideoLog`:

```ts
  onChannelSearchLog: (cb: (line: string) => void) => () => void
```

- [ ] **Step 3: Thêm 3 bảng vào `src/main/db.ts`**

Trong `migrate()`, sau lệnh `d.exec(...)` lớn hiện có (trước các dòng `addColumn`), thêm:

```ts
  // ===== Channel Search (tab Search Kênh) =====
  d.exec(`
    CREATE TABLE IF NOT EXISTS cs_candidates (
      id                TEXT PRIMARY KEY,
      yt_channel_id     TEXT NOT NULL UNIQUE,
      url               TEXT NOT NULL,
      name              TEXT NOT NULL DEFAULT '',
      handle            TEXT NOT NULL DEFAULT '',
      thumbnail         TEXT NOT NULL DEFAULT '',
      subs              INTEGER,
      video_count       INTEGER,
      avg_views         REAL,
      last_upload_at    INTEGER,
      uploads_per_week  REAL,
      country           TEXT,
      yt_created_at     INTEGER,
      like_view_pct     REAL,
      comment_view_pct  REAL,
      view_sub_ratio    REAL,
      momentum_pct      REAL,
      view_consistency  REAL,
      shorts_pct        REAL,
      shorts_count      INTEGER,
      topics            TEXT,   -- JSON string[]
      audience_langs    TEXT,   -- JSON CsLangPct[]
      status            TEXT NOT NULL DEFAULT 'new',
      tiktok_checked_at INTEGER,
      created_at        INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cs_tiktok_matches (
      id           TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,  -- FK logic tới cs_candidates; xóa liên đới làm trong store (app không bật PRAGMA foreign_keys)
      username     TEXT NOT NULL,
      nickname     TEXT NOT NULL DEFAULT '',
      followers    INTEGER,
      video_count  INTEGER,
      avatar_url   TEXT NOT NULL DEFAULT '',
      fetched_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cs_matches_candidate ON cs_tiktok_matches(candidate_id);

    CREATE TABLE IF NOT EXISTS cs_settings (
      id               INTEGER PRIMARY KEY CHECK (id = 1),
      api_key          TEXT NOT NULL DEFAULT '',
      check_profile_id TEXT NOT NULL DEFAULT '',
      top_n            INTEGER NOT NULL DEFAULT 5
    );
    INSERT OR IGNORE INTO cs_settings (id) VALUES (1);
  `)
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: không có lỗi mới (lỗi pre-existing nếu có thì ghi nhận, không sửa). Sau đó `npm run dev`, app mở bình thường (migration chạy không lỗi), đóng app.

---

### Task 2: ChannelSearchStore

**Files:**
- Create: `src/main/services/ChannelSearchStore.ts`

**Interfaces:**
- Consumes: `getDb()` từ `../db`; types Task 1.
- Produces (Task 3, 4, 7 dùng):
  - `ChannelSearchStore.listCandidates(): CsCandidate[]`
  - `ChannelSearchStore.getCandidate(id: string): CsCandidate | null`
  - `ChannelSearchStore.addCandidate(r: CsSearchResult): { candidate: CsCandidate; existed: boolean }`
  - `ChannelSearchStore.removeCandidate(id: string): void`
  - `ChannelSearchStore.setStatus(id: string, status: CsStatus): void`
  - `ChannelSearchStore.setMatches(candidateId: string, ms: Omit<CsTiktokMatch, 'id' | 'candidateId' | 'fetchedAt'>[]): CsTiktokMatch[]`
  - `ChannelSearchStore.getSettings(): CsSettings`
  - `ChannelSearchStore.saveSettings(s: CsSettings): CsSettings`

- [ ] **Step 1: Viết file**

```ts
import { randomUUID } from 'crypto'
import { getDb } from '../db'
import type { CsCandidate, CsSearchResult, CsSettings, CsStatus, CsTiktokMatch } from '@shared/types'

interface CandidateRow {
  id: string
  yt_channel_id: string
  url: string
  name: string
  handle: string
  thumbnail: string
  subs: number | null
  video_count: number | null
  avg_views: number | null
  last_upload_at: number | null
  uploads_per_week: number | null
  country: string | null
  yt_created_at: number | null
  like_view_pct: number | null
  comment_view_pct: number | null
  view_sub_ratio: number | null
  momentum_pct: number | null
  view_consistency: number | null
  shorts_pct: number | null
  shorts_count: number | null
  topics: string | null
  audience_langs: string | null
  status: string
  tiktok_checked_at: number | null
  created_at: number
}

interface MatchRow {
  id: string
  candidate_id: string
  username: string
  nickname: string
  followers: number | null
  video_count: number | null
  avatar_url: string
  fetched_at: number
}

function rowToMatch(r: MatchRow): CsTiktokMatch {
  return {
    id: r.id,
    candidateId: r.candidate_id,
    username: r.username,
    nickname: r.nickname,
    followers: r.followers,
    videoCount: r.video_count,
    avatarUrl: r.avatar_url,
    fetchedAt: r.fetched_at
  }
}

function rowToCandidate(r: CandidateRow, matches: CsTiktokMatch[]): CsCandidate {
  return {
    id: r.id,
    ytChannelId: r.yt_channel_id,
    url: r.url,
    name: r.name,
    handle: r.handle,
    thumbnail: r.thumbnail,
    subs: r.subs,
    videoCount: r.video_count,
    avgViews: r.avg_views,
    lastUploadAt: r.last_upload_at,
    uploadsPerWeek: r.uploads_per_week,
    country: r.country,
    ytCreatedAt: r.yt_created_at,
    likeViewPct: r.like_view_pct,
    commentViewPct: r.comment_view_pct,
    viewSubRatio: r.view_sub_ratio,
    momentumPct: r.momentum_pct,
    viewConsistency: r.view_consistency,
    shortsPct: r.shorts_pct,
    shortsCount: r.shorts_count,
    topics: r.topics ? (JSON.parse(r.topics) as string[]) : null,
    audienceLangs: r.audience_langs ? JSON.parse(r.audience_langs) : null,
    status: r.status as CsStatus,
    tiktokCheckedAt: r.tiktok_checked_at,
    createdAt: r.created_at,
    matches
  }
}

export const ChannelSearchStore = {
  listCandidates(): CsCandidate[] {
    const rows = getDb().prepare('SELECT * FROM cs_candidates ORDER BY created_at DESC').all() as CandidateRow[]
    const mrows = getDb()
      .prepare('SELECT * FROM cs_tiktok_matches ORDER BY followers DESC')
      .all() as MatchRow[]
    const byCand = new Map<string, CsTiktokMatch[]>()
    for (const m of mrows) {
      const list = byCand.get(m.candidate_id) ?? []
      list.push(rowToMatch(m))
      byCand.set(m.candidate_id, list)
    }
    return rows.map((r) => rowToCandidate(r, byCand.get(r.id) ?? []))
  },

  getCandidate(id: string): CsCandidate | null {
    const r = getDb().prepare('SELECT * FROM cs_candidates WHERE id = ?').get(id) as CandidateRow | undefined
    if (!r) return null
    const ms = getDb()
      .prepare('SELECT * FROM cs_tiktok_matches WHERE candidate_id = ? ORDER BY followers DESC')
      .all(id) as MatchRow[]
    return rowToCandidate(r, ms.map(rowToMatch))
  },

  addCandidate(r: CsSearchResult): { candidate: CsCandidate; existed: boolean } {
    const dup = getDb()
      .prepare('SELECT id FROM cs_candidates WHERE yt_channel_id = ?')
      .get(r.ytChannelId) as { id: string } | undefined
    if (dup) return { candidate: this.getCandidate(dup.id)!, existed: true }
    const id = randomUUID()
    getDb()
      .prepare(
        `INSERT INTO cs_candidates (
           id, yt_channel_id, url, name, handle, thumbnail,
           subs, video_count, avg_views, last_upload_at, uploads_per_week, country, yt_created_at,
           like_view_pct, comment_view_pct, view_sub_ratio, momentum_pct, view_consistency,
           shorts_pct, shorts_count, topics, audience_langs, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`
      )
      .run(
        id, r.ytChannelId, r.url, r.name, r.handle, r.thumbnail,
        r.subs, r.videoCount, r.avgViews, r.lastUploadAt, r.uploadsPerWeek, r.country, r.ytCreatedAt,
        r.likeViewPct, r.commentViewPct, r.viewSubRatio, r.momentumPct, r.viewConsistency,
        r.shortsPct, r.shortsCount,
        r.topics ? JSON.stringify(r.topics) : null,
        r.audienceLangs ? JSON.stringify(r.audienceLangs) : null,
        Date.now()
      )
    return { candidate: this.getCandidate(id)!, existed: false }
  },

  removeCandidate(id: string): void {
    // Xóa matches thủ công — app không bật PRAGMA foreign_keys nên CASCADE không chạy.
    const del = getDb().transaction((cid: string) => {
      getDb().prepare('DELETE FROM cs_tiktok_matches WHERE candidate_id = ?').run(cid)
      getDb().prepare('DELETE FROM cs_candidates WHERE id = ?').run(cid)
    })
    del(id)
  },

  setStatus(id: string, status: CsStatus): void {
    getDb().prepare('UPDATE cs_candidates SET status = ? WHERE id = ?').run(status, id)
  },

  /** Ghi đè toàn bộ kết quả check TikTok của 1 candidate (atomic). */
  setMatches(candidateId: string, ms: Omit<CsTiktokMatch, 'id' | 'candidateId' | 'fetchedAt'>[]): CsTiktokMatch[] {
    const now = Date.now()
    const tx = getDb().transaction(() => {
      getDb().prepare('DELETE FROM cs_tiktok_matches WHERE candidate_id = ?').run(candidateId)
      const ins = getDb().prepare(
        `INSERT INTO cs_tiktok_matches (id, candidate_id, username, nickname, followers, video_count, avatar_url, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      for (const m of ms) {
        ins.run(randomUUID(), candidateId, m.username, m.nickname, m.followers, m.videoCount, m.avatarUrl, now)
      }
      getDb().prepare('UPDATE cs_candidates SET tiktok_checked_at = ? WHERE id = ?').run(now, candidateId)
    })
    tx()
    return this.getCandidate(candidateId)?.matches ?? []
  },

  getSettings(): CsSettings {
    const r = getDb().prepare('SELECT * FROM cs_settings WHERE id = 1').get() as {
      api_key: string
      check_profile_id: string
      top_n: number
    }
    return { apiKey: r.api_key, checkProfileId: r.check_profile_id, topN: r.top_n }
  },

  saveSettings(s: CsSettings): CsSettings {
    getDb()
      .prepare('UPDATE cs_settings SET api_key = ?, check_profile_id = ?, top_n = ? WHERE id = 1')
      .run(s.apiKey.trim(), s.checkProfileId, Math.max(1, Math.min(20, s.topN || 5)))
    return this.getSettings()
  }
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: sạch lỗi.

---

### Task 3: Preload bridge + IPC handlers (store ops)

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/main/ipc.ts`

**Interfaces:**
- Consumes: `ChannelSearchStore` (Task 2), types (Task 1).
- Produces: `window.hnv.channelSearch.*` + `window.hnv.onChannelSearchLog` cho renderer. Kênh IPC: `channelSearch:search`, `channelSearch:listCandidates`, `channelSearch:addCandidate`, `channelSearch:removeCandidate`, `channelSearch:setStatus`, `channelSearch:checkTiktok`, `channelSearch:getSettings`, `channelSearch:saveSettings`, event `channelsearch:log`. (Handler cho `search` đăng ký ở Task 4, `checkTiktok` ở Task 7 — preload khai đủ ngay từ giờ.)

- [ ] **Step 1: Preload — thêm vào object `api` trong `src/preload/index.ts`**

Thêm import type: `CsSearchParams, CsSearchResult, CsSettings, CsStatus` vào block import từ `../shared/types`. Thêm sau `getvideo: {...}`:

```ts
  channelSearch: {
    search: (params: CsSearchParams) => ipcRenderer.invoke('channelSearch:search', params),
    listCandidates: () => ipcRenderer.invoke('channelSearch:listCandidates'),
    addCandidate: (r: CsSearchResult) => ipcRenderer.invoke('channelSearch:addCandidate', r),
    removeCandidate: (id: string) => ipcRenderer.invoke('channelSearch:removeCandidate', id),
    setStatus: (id: string, status: CsStatus) => ipcRenderer.invoke('channelSearch:setStatus', id, status),
    checkTiktok: (id: string) => ipcRenderer.invoke('channelSearch:checkTiktok', id),
    getSettings: () => ipcRenderer.invoke('channelSearch:getSettings'),
    saveSettings: (s: CsSettings) => ipcRenderer.invoke('channelSearch:saveSettings', s)
  },
```

Thêm cạnh `onGetVideoLog`:

```ts
  onChannelSearchLog: (cb: (line: string) => void) => {
    const handler = (_e: unknown, line: string): void => cb(line)
    ipcRenderer.on('channelsearch:log', handler)
    return () => ipcRenderer.removeListener('channelsearch:log', handler)
  },
```

- [ ] **Step 2: IPC — thêm vào `registerIpc` trong `src/main/ipc.ts`**

Thêm import: `import { ChannelSearchStore } from './services/ChannelSearchStore'` và thêm `CsSearchResult, CsSettings, CsStatus` vào import type từ `@shared/types`. Sau block `// get video`:

```ts
  // channel search (tab Search Kênh)
  ipcMain.handle('channelSearch:listCandidates', () => ChannelSearchStore.listCandidates())
  ipcMain.handle('channelSearch:addCandidate', (_e, r: CsSearchResult) => ChannelSearchStore.addCandidate(r))
  ipcMain.handle('channelSearch:removeCandidate', (_e, id: string) => ChannelSearchStore.removeCandidate(id))
  ipcMain.handle('channelSearch:setStatus', (_e, id: string, st: CsStatus) => ChannelSearchStore.setStatus(id, st))
  ipcMain.handle('channelSearch:getSettings', () => ChannelSearchStore.getSettings())
  ipcMain.handle('channelSearch:saveSettings', (_e, s: CsSettings) => ChannelSearchStore.saveSettings(s))
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: sạch. `npm run dev` → mở DevTools console của renderer, chạy `await window.hnv.channelSearch.getSettings()` → trả `{apiKey:'', checkProfileId:'', topN:5}`; `await window.hnv.channelSearch.listCandidates()` → `[]`.

---

### Task 4: ChannelSearchService — YouTube Data API (search cơ bản)

**Files:**
- Create: `src/main/services/ChannelSearchService.ts`
- Modify: `src/main/ipc.ts` (handler `channelSearch:search` + wire log event)

**Interfaces:**
- Consumes: `ChannelSearchStore.getSettings()`; types Task 1.
- Produces (Task 5/6 mở rộng, Task 9 gọi qua IPC):
  - `searchChannels(params: CsSearchParams): Promise<CsSearchResult[]>`
  - `channelSearchEvents: EventEmitter` — emit `('log', line: string)`
  - nội bộ: `ytGet(path, query, key): Promise<any>`, `isoDur(iso: string): number`, `applyBasicFilters(list, params): CsSearchResult[]`, `uploadsPlaylistOf: Map<string, string>` trả về từ `apiSearch` (Task 5 dùng)

- [ ] **Step 1: Viết `src/main/services/ChannelSearchService.ts`**

```ts
import { EventEmitter } from 'events'
import { ChannelSearchStore } from './ChannelSearchStore'
import type { CsSearchParams, CsSearchResult } from '@shared/types'

export const channelSearchEvents = new EventEmitter()

function log(msg: string): void {
  channelSearchEvents.emit('log', msg)
}

const YT = 'https://www.googleapis.com/youtube/v3'

/** GET YouTube Data API v3. Ném Error với message từ Google khi lỗi (key sai, hết quota…). */
async function ytGet(path: string, query: Record<string, string>, key: string): Promise<any> {
  const qs = new URLSearchParams({ ...query, key })
  const res = await fetch(`${YT}/${path}?${qs}`)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = json?.error?.message || `HTTP ${res.status}`
    throw new Error(`YouTube API: ${msg}`)
  }
  return json
}

/** ISO8601 duration (PT1M30S) → giây. */
export function isoDur(iso: string): number {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || '')
  if (!m) return 0
  return (parseInt(m[1] || '0') * 3600) + (parseInt(m[2] || '0') * 60) + parseInt(m[3] || '0')
}

/** topicCategories là URL Wikipedia → lấy tên cuối, bỏ gạch dưới. */
function topicNames(topicCategories: string[] | undefined): string[] | null {
  if (!topicCategories?.length) return null
  const names = topicCategories
    .map((u) => decodeURIComponent(u.split('/').pop() || '').replace(/_/g, ' '))
    .filter(Boolean)
  return names.length ? [...new Set(names)] : null
}

interface ApiSearchOut {
  results: CsSearchResult[]
  uploadsPlaylistOf: Map<string, string> // ytChannelId → uploads playlist id (Task 5 fetch sâu)
}

async function apiSearch(params: CsSearchParams, apiKey: string): Promise<ApiSearchOut> {
  log(`Search YouTube: "${params.keyword}"…`)
  const sr = await ytGet(
    'search',
    { part: 'snippet', type: 'channel', q: params.keyword, maxResults: '50' },
    apiKey
  )
  const ids = (sr.items ?? [])
    .map((it: any) => it?.snippet?.channelId || it?.id?.channelId)
    .filter(Boolean)
  if (!ids.length) return { results: [], uploadsPlaylistOf: new Map() }

  const cr = await ytGet(
    'channels',
    { part: 'snippet,statistics,topicDetails,contentDetails', id: ids.join(','), maxResults: '50' },
    apiKey
  )
  const uploadsPlaylistOf = new Map<string, string>()
  const results: CsSearchResult[] = (cr.items ?? []).map((c: any) => {
    const stats = c.statistics ?? {}
    const sn = c.snippet ?? {}
    const uploads = c.contentDetails?.relatedPlaylists?.uploads
    if (uploads) uploadsPlaylistOf.set(c.id, uploads)
    const handle: string = sn.customUrl && sn.customUrl.startsWith('@') ? sn.customUrl : ''
    return {
      ytChannelId: c.id,
      url: handle ? `https://www.youtube.com/${handle}` : `https://www.youtube.com/channel/${c.id}`,
      name: sn.title ?? '',
      handle,
      thumbnail: sn.thumbnails?.default?.url ?? '',
      subs: stats.hiddenSubscriberCount ? null : parseInt(stats.subscriberCount ?? '') || null,
      videoCount: parseInt(stats.videoCount ?? '') || null,
      country: sn.country ?? null,
      ytCreatedAt: sn.publishedAt ? Date.parse(sn.publishedAt) : null,
      topics: topicNames(c.topicDetails?.topicCategories),
      // Các chỉ số sâu — Task 5 điền:
      avgViews: null,
      lastUploadAt: null,
      uploadsPerWeek: null,
      likeViewPct: null,
      commentViewPct: null,
      viewSubRatio: null,
      momentumPct: null,
      viewConsistency: null,
      shortsPct: null,
      shortsCount: null,
      audienceLangs: null
    }
  })
  return { results, uploadsPlaylistOf }
}

/** Lọc bằng dữ liệu rẻ (channels.list) TRƯỚC khi fetch sâu — tiết kiệm quota.
 *  Kênh thiếu dữ liệu của một filter đang bật → loại (không xác minh được). */
export function applyBasicFilters(list: CsSearchResult[], p: CsSearchParams): CsSearchResult[] {
  const now = Date.now()
  const day = 86_400_000
  return list.filter((c) => {
    if (p.subsMin !== null && (c.subs === null || c.subs < p.subsMin)) return false
    if (p.subsMax !== null && (c.subs === null || c.subs > p.subsMax)) return false
    if (p.countries.length && (!c.country || !p.countries.includes(c.country))) return false
    if (p.ageMinDays !== null && (c.ytCreatedAt === null || now - c.ytCreatedAt < p.ageMinDays * day)) return false
    if (p.ageMaxDays !== null && (c.ytCreatedAt === null || now - c.ytCreatedAt > p.ageMaxDays * day)) return false
    if (p.topicsAny.length) {
      const topics = (c.topics ?? []).map((t) => t.toLowerCase())
      const ok = p.topicsAny.some((q) => topics.some((t) => t.includes(q.toLowerCase())))
      if (!ok) return false
    }
    return true
  })
}

export async function searchChannels(params: CsSearchParams): Promise<CsSearchResult[]> {
  const s = ChannelSearchStore.getSettings()
  if (!s.apiKey) {
    // Task 6 thay dòng này bằng fallback yt-dlp.
    throw new Error('Chưa cấu hình YouTube API key (vào ⚙️ Cài đặt)')
  }
  const { results } = await apiSearch(params, s.apiKey)
  const basic = applyBasicFilters(results, params)
  log(`Tìm thấy ${results.length} kênh, ${basic.length} qua lọc sơ bộ`)
  return basic
}
```

- [ ] **Step 2: Đăng ký handler + wire log trong `src/main/ipc.ts`**

Thêm import: `import { searchChannels, channelSearchEvents } from './services/ChannelSearchService'` và `CsSearchParams` vào import type. Cạnh các handler channelSearch:

```ts
  ipcMain.handle('channelSearch:search', (_e, p: CsSearchParams) => searchChannels(p))
```

Cạnh `getVideoEvents.on('log', ...)`:

```ts
  channelSearchEvents.on('log', (line: string) => sendToRenderer('channelsearch:log', line))
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → sạch. `npm run dev` → DevTools console:
`await window.hnv.channelSearch.saveSettings({apiKey:'<KEY THẬT NẾU CÓ>', checkProfileId:'', topN:5})` rồi
`await window.hnv.channelSearch.search({keyword:'funny cat', subsMin:null, subsMax:null, countries:[], ageMinDays:null, ageMaxDays:null, topicsAny:[], uploadsPerWeekMin:null, lastUploadWithinDays:null, shortsCountMin:null, durationMaxSec:null, avgViewsMin:null, likeViewPctMin:null, commentViewPctMin:null, viewSubRatioMin:null, momentumPctMin:null, viewConsistencyMin:null, shortsPctMin:null, audienceLang:null, audienceLangPctMin:50})`
Expected: có key → mảng kênh với name/subs/country/topics; không key → Error message "Chưa cấu hình YouTube API key". Key sai → Error "YouTube API: API key not valid…".

---

### Task 5: Fetch sâu + toàn bộ chỉ số + ngôn ngữ khán giả

**Files:**
- Modify: `src/main/services/ChannelSearchService.ts`
- Modify: `package.json` (thêm dep `franc-min`)

**Interfaces:**
- Consumes: `apiSearch`, `applyBasicFilters`, `isoDur`, `ytGet`, `log` (Task 4).
- Produces: `searchChannels` trả kết quả đã điền đủ `CsChannelMetrics` + đã áp toàn bộ filter. Nội bộ: `fetchDeep(c, uploadsPlaylist, key): Promise<void>` (mutate), `applyDeepFilters(list, p): CsSearchResult[]`, `detectLangs(samples: string[]): CsLangPct[] | null`.

- [ ] **Step 1: Cài dependency**

Run: `npm i franc-min`
Expected: vào `dependencies` trong package.json, không lỗi (postinstall rebuild better-sqlite3 chạy lại — bình thường).

- [ ] **Step 2: Thêm code vào `ChannelSearchService.ts`**

Thêm import đầu file:

```ts
import { franc } from 'franc-min'
import type { CsLangPct } from '@shared/types'
```

Thêm sau `applyBasicFilters`:

```ts
/** ISO639-3 (franc) → mã 2 chữ quen thuộc; không có trong map thì giữ mã 3 chữ. */
const LANG_2: Record<string, string> = {
  eng: 'en', vie: 'vi', spa: 'es', por: 'pt', ind: 'id', tha: 'th', kor: 'ko',
  jpn: 'ja', cmn: 'zh', hin: 'hi', arb: 'ar', rus: 'ru', fra: 'fr', deu: 'de',
  ita: 'it', tur: 'tr', pol: 'pl', nld: 'nl', fil: 'tl', mya: 'my', khm: 'km'
}

/** Detect ngôn ngữ từng mẫu text → phân bố %. null nếu không đủ mẫu. */
export function detectLangs(samples: string[]): CsLangPct[] | null {
  const counts = new Map<string, number>()
  let total = 0
  for (const s of samples) {
    const text = (s || '').trim()
    if (text.length < 6) continue
    const code = franc(text)
    if (code === 'und') continue
    const lang = LANG_2[code] ?? code
    counts.set(lang, (counts.get(lang) ?? 0) + 1)
    total++
  }
  if (total < 5) return null
  return [...counts.entries()]
    .map(([lang, n]) => ({ lang, pct: Math.round((n / total) * 100) }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 5)
}

function median(nums: number[]): number {
  if (!nums.length) return 0
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

const SHORT_MAX_SEC = 180 // chuẩn Shorts hiện tại của YouTube

/** Điền các chỉ số sâu cho 1 kênh (mutate). Lỗi lẻ (comment tắt…) → để null, không ném. */
async function fetchDeep(c: CsSearchResult, uploadsPlaylist: string | undefined, apiKey: string): Promise<void> {
  if (!uploadsPlaylist) return
  // 20 video mới nhất
  const pl = await ytGet(
    'playlistItems',
    { part: 'contentDetails', playlistId: uploadsPlaylist, maxResults: '20' },
    apiKey
  ).catch(() => null)
  const videoIds: string[] = (pl?.items ?? [])
    .map((it: any) => it?.contentDetails?.videoId)
    .filter(Boolean)
  if (!videoIds.length) return

  const vr = await ytGet(
    'videos',
    { part: 'contentDetails,statistics,snippet', id: videoIds.join(','), maxResults: '50' },
    apiKey
  ).catch(() => null)
  const vids = (vr?.items ?? []).map((v: any) => ({
    views: parseInt(v?.statistics?.viewCount ?? '') || 0,
    likes: parseInt(v?.statistics?.likeCount ?? '') || 0,
    comments: parseInt(v?.statistics?.commentCount ?? '') || 0,
    dur: isoDur(v?.contentDetails?.duration ?? ''),
    at: v?.snippet?.publishedAt ? Date.parse(v.snippet.publishedAt) : 0,
    title: v?.snippet?.title ?? ''
  }))
  if (!vids.length) return
  vids.sort((a: { at: number }, b: { at: number }) => b.at - a.at) // mới nhất trước

  const views = vids.map((v: { views: number }) => v.views)
  const sumViews = views.reduce((a: number, b: number) => a + b, 0)
  const sumLikes = vids.reduce((a: number, v: { likes: number }) => a + v.likes, 0)
  const sumComments = vids.reduce((a: number, v: { comments: number }) => a + v.comments, 0)
  const mean = sumViews / vids.length

  c.avgViews = Math.round(mean)
  c.lastUploadAt = vids[0].at || null
  const oldest = vids[vids.length - 1].at
  if (vids.length >= 2 && vids[0].at > oldest) {
    c.uploadsPerWeek = Math.round(((vids.length - 1) / ((vids[0].at - oldest) / 604_800_000)) * 10) / 10
  }
  c.likeViewPct = sumViews > 0 ? Math.round((sumLikes / sumViews) * 10000) / 100 : null
  c.commentViewPct = sumViews > 0 ? Math.round((sumComments / sumViews) * 10000) / 100 : null
  c.viewSubRatio = c.subs ? Math.round((mean / c.subs) * 100) / 100 : null
  if (vids.length >= 10) {
    const newAvg = views.slice(0, 5).reduce((a: number, b: number) => a + b, 0) / 5
    const oldViews = views.slice(5)
    const oldAvg = oldViews.reduce((a: number, b: number) => a + b, 0) / oldViews.length
    c.momentumPct = oldAvg > 0 ? Math.round((newAvg / oldAvg - 1) * 100) : null
  }
  c.viewConsistency = mean > 0 ? Math.round((median(views) / mean) * 100) / 100 : null
  const shorts = vids.filter((v: { dur: number }) => v.dur > 0 && v.dur <= SHORT_MAX_SEC).length
  c.shortsPct = Math.round((shorts / vids.length) * 100)
  // Ước tính tổng Shorts từ tỉ lệ trong 20 video gần nhất (không có API đếm trực tiếp).
  c.shortsCount = c.videoCount !== null ? Math.round((c.videoCount * c.shortsPct) / 100) : null

  // Ngôn ngữ khán giả: ~50 comment gần nhất + 20 tiêu đề. Kênh tắt comment → chỉ dùng tiêu đề.
  const cm = await ytGet(
    'commentThreads',
    {
      part: 'snippet',
      allThreadsRelatedToChannelId: c.ytChannelId,
      maxResults: '50',
      textFormat: 'plainText'
    },
    apiKey
  ).catch(() => null)
  const commentTexts: string[] = (cm?.items ?? [])
    .map((it: any) => it?.snippet?.topLevelComment?.snippet?.textDisplay ?? '')
    .filter(Boolean)
  c.audienceLangs = detectLangs([...commentTexts, ...vids.map((v: { title: string }) => v.title)])

  // Lưu median duration tạm vào field dùng cho filter durationMaxSec (không persist).
  ;(c as any).__medianDur = median(vids.map((v: { dur: number }) => v.dur).filter((d: number) => d > 0))
}

/** Áp filter cần dữ liệu sâu. Kênh thiếu dữ liệu của filter đang bật → loại. */
export function applyDeepFilters(list: CsSearchResult[], p: CsSearchParams): CsSearchResult[] {
  const now = Date.now()
  const day = 86_400_000
  return list.filter((c) => {
    if (p.avgViewsMin !== null && (c.avgViews === null || c.avgViews < p.avgViewsMin)) return false
    if (p.uploadsPerWeekMin !== null && (c.uploadsPerWeek === null || c.uploadsPerWeek < p.uploadsPerWeekMin)) return false
    if (p.lastUploadWithinDays !== null && (c.lastUploadAt === null || now - c.lastUploadAt > p.lastUploadWithinDays * day)) return false
    if (p.shortsCountMin !== null && (c.shortsCount === null || c.shortsCount < p.shortsCountMin)) return false
    if (p.durationMaxSec !== null) {
      const md = (c as any).__medianDur as number | undefined
      if (md === undefined || md === 0 || md > p.durationMaxSec) return false
    }
    if (p.likeViewPctMin !== null && (c.likeViewPct === null || c.likeViewPct < p.likeViewPctMin)) return false
    if (p.commentViewPctMin !== null && (c.commentViewPct === null || c.commentViewPct < p.commentViewPctMin)) return false
    if (p.viewSubRatioMin !== null && (c.viewSubRatio === null || c.viewSubRatio < p.viewSubRatioMin)) return false
    if (p.momentumPctMin !== null && (c.momentumPct === null || c.momentumPct < p.momentumPctMin)) return false
    if (p.viewConsistencyMin !== null && (c.viewConsistency === null || c.viewConsistency < p.viewConsistencyMin)) return false
    if (p.shortsPctMin !== null && (c.shortsPct === null || c.shortsPct < p.shortsPctMin)) return false
    if (p.audienceLang !== null) {
      const hit = (c.audienceLangs ?? []).find((l) => l.lang === p.audienceLang)
      if (!hit || hit.pct < p.audienceLangPctMin) return false
    }
    return true
  })
}
```

Sửa `searchChannels` thành:

```ts
export async function searchChannels(params: CsSearchParams): Promise<CsSearchResult[]> {
  const s = ChannelSearchStore.getSettings()
  if (!s.apiKey) {
    // Task 6 thay dòng này bằng fallback yt-dlp.
    throw new Error('Chưa cấu hình YouTube API key (vào ⚙️ Cài đặt)')
  }
  const { results, uploadsPlaylistOf } = await apiSearch(params, s.apiKey)
  const basic = applyBasicFilters(results, params)
  log(`Tìm thấy ${results.length} kênh, ${basic.length} qua lọc sơ bộ — đang lấy chi tiết…`)

  // Pool 4 kênh song song — mỗi kênh tốn ~3 unit quota (playlistItems + videos + commentThreads).
  const queue = [...basic]
  const workers: Promise<void>[] = []
  for (let i = 0; i < 4; i++) {
    workers.push(
      (async () => {
        for (;;) {
          const c = queue.shift()
          if (!c) break
          await fetchDeep(c, uploadsPlaylistOf.get(c.ytChannelId), s.apiKey)
        }
      })()
    )
  }
  await Promise.all(workers)

  const final = applyDeepFilters(basic, params)
  for (const c of final) delete (c as any).__medianDur
  log(`Xong: ${final.length} kênh khớp toàn bộ tiêu chí`)
  return final
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → sạch. `npm run dev` → console chạy lại lệnh search Task 4 Step 3 (có key). Expected: kết quả có `avgViews`, `likeViewPct`, `momentumPct`, `viewConsistency`, `shortsPct`, `audienceLangs` khác null với đa số kênh. Thử thêm `likeViewPctMin: 3` → danh sách ngắn lại. Thử `audienceLang:'en', audienceLangPctMin:50` → chỉ còn kênh khán giả tiếng Anh.

---

### Task 6: Fallback yt-dlp (không có API key)

**Files:**
- Modify: `src/main/services/ChannelSearchService.ts`

**Interfaces:**
- Consumes: `ensureYtDlp` từ `./YtDlpManager`; `GetVideoStore.getSettings()` (lấy `cookieBrowser`); `runYtDlp`-tương-đương viết nội bộ.
- Produces: `searchChannels` tự fallback khi `apiKey === ''`. Nội bộ: `ytDlpSearch(params): Promise<CsSearchResult[]>`.

- [ ] **Step 1: Thêm code vào `ChannelSearchService.ts`**

Thêm import:

```ts
import { spawn } from 'child_process'
import { ensureYtDlp } from './YtDlpManager'
import { GetVideoStore } from './GetVideoStore'
```

Thêm sau `applyDeepFilters`:

```ts
function runYtDlp(exe: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { windowsHide: true })
    let out = ''
    child.stdout.on('data', (d) => (out += d.toString()))
    child.stderr.on('data', (d) => (out += d.toString()))
    child.on('error', () => resolve({ code: -1, out }))
    child.on('exit', (code) => resolve({ code: code ?? -1, out }))
  })
}

/** Fallback không API key: dữ liệu rút gọn (name/handle/subs/shortsCount), các chỉ số sâu = null. */
async function ytDlpSearch(params: CsSearchParams): Promise<CsSearchResult[]> {
  const exe = await ensureYtDlp()
  const cookieBrowser = GetVideoStore.getSettings().cookieBrowser
  const cookieArgs = cookieBrowser ? ['--cookies-from-browser', cookieBrowser] : []

  log(`Search yt-dlp (không API key): "${params.keyword}"…`)
  const sr = await runYtDlp(exe, [
    `ytsearch50:${params.keyword}`,
    '--flat-playlist', '--no-warnings', '--sleep-requests', '1',
    ...cookieArgs,
    '--print', '%(channel_id)s\t%(channel)s\t%(uploader_id)s'
  ])
  if (sr.code !== 0) {
    throw new Error(`yt-dlp lỗi search: ${sr.out.split('\n').filter(Boolean).slice(-2).join(' ')}`)
  }
  const seen = new Map<string, { name: string; handle: string }>()
  for (const line of sr.out.split('\n')) {
    const [id, name, uploader] = line.trim().split('\t')
    if (id && id !== 'NA' && !seen.has(id)) {
      seen.set(id, { name: name === 'NA' ? '' : name, handle: uploader?.startsWith('@') ? uploader : '' })
    }
  }
  const channels = [...seen.entries()].slice(0, 15) // giới hạn 15 kênh cho đỡ chậm/bot-check
  log(`${seen.size} kênh từ search, lấy chi tiết ${channels.length} kênh đầu…`)

  const results: CsSearchResult[] = []
  const queue = [...channels]
  const workers: Promise<void>[] = []
  for (let i = 0; i < 3; i++) {
    workers.push(
      (async () => {
        for (;;) {
          const item = queue.shift()
          if (!item) break
          const [id, meta] = item
          const r = await runYtDlp(exe, [
            `https://www.youtube.com/channel/${id}/shorts`,
            '-J', '--flat-playlist', '--playlist-end', '1',
            '--no-warnings', '--sleep-requests', '1',
            ...cookieArgs
          ])
          if (r.code !== 0) continue // kênh không có tab Shorts / lỗi lẻ → bỏ qua
          try {
            // stdout có thể lẫn dòng log → lấy dòng JSON (bắt đầu bằng '{')
            const jsonLine = r.out.split('\n').find((l) => l.trim().startsWith('{'))
            if (!jsonLine) continue
            const j = JSON.parse(jsonLine)
            const handle: string = meta.handle || (j.uploader_id?.startsWith('@') ? j.uploader_id : '')
            results.push({
              ytChannelId: id,
              url: handle ? `https://www.youtube.com/${handle}` : `https://www.youtube.com/channel/${id}`,
              name: meta.name || j.channel || '',
              handle,
              thumbnail: '',
              subs: typeof j.channel_follower_count === 'number' ? j.channel_follower_count : null,
              videoCount: null,
              shortsCount: typeof j.playlist_count === 'number' ? j.playlist_count : null,
              country: null, ytCreatedAt: null, topics: null,
              avgViews: null, lastUploadAt: null, uploadsPerWeek: null,
              likeViewPct: null, commentViewPct: null, viewSubRatio: null,
              momentumPct: null, viewConsistency: null, shortsPct: null, audienceLangs: null
            })
          } catch {
            /* JSON hỏng → bỏ qua kênh */
          }
        }
      })()
    )
  }
  await Promise.all(workers)

  // Fallback chỉ áp được: subs + shortsCount (kênh thiếu dữ liệu của filter đang bật → loại)
  const filtered = results.filter((c) => {
    if (params.subsMin !== null && (c.subs === null || c.subs < params.subsMin)) return false
    if (params.subsMax !== null && (c.subs === null || c.subs > params.subsMax)) return false
    if (params.shortsCountMin !== null && (c.shortsCount === null || c.shortsCount < params.shortsCountMin)) return false
    return true
  })
  log(`Xong (fallback): ${filtered.length} kênh. Thêm API key để lọc đầy đủ tiêu chí.`)
  return filtered
}
```

Trong `searchChannels`, thay 3 dòng:

```ts
  if (!s.apiKey) {
    // Task 6 thay dòng này bằng fallback yt-dlp.
    throw new Error('Chưa cấu hình YouTube API key (vào ⚙️ Cài đặt)')
  }
```

bằng:

```ts
  if (!s.apiKey) return ytDlpSearch(params)
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` → sạch. `npm run dev` → console: `await window.hnv.channelSearch.saveSettings({apiKey:'', checkProfileId:'', topN:5})` rồi chạy search như Task 4 Step 3. Expected: trả kênh với `name`, `handle`, `subs` (đa số), `shortsCount`; các trường sâu null. Nếu dính bot-check → error message chứa gợi ý từ yt-dlp (UI Task 9 sẽ hiện hướng dẫn cookie browser).

---

### Task 7: TikTokSearch — check trùng qua profile antidetect

**Files:**
- Create: `src/main/services/TikTokSearch.ts`
- Modify: `src/main/ipc.ts` (handler `channelSearch:checkTiktok`)

**Interfaces:**
- Consumes: `ChannelSearchStore` (getCandidate, setMatches, getSettings), `ProfileStore.get`, `ensureEngine`, `buildArgs`, `ensureRelay`, `waitForWsEndpoint`, `trackProc`, `channelSearchEvents` (log).
- Produces: `checkTiktok(candidateId: string): Promise<CsTiktokMatch[]>` — Task 10 gọi qua IPC.

- [ ] **Step 1: Viết `src/main/services/TikTokSearch.ts`**

Pattern giống hệt `TikTokSync.ts` (spawn off-screen + CDP). Điểm khác: bắt JSON từ response `/api/search/` của TikTok thay vì đọc DOM (ổn định hơn khi TikTok đổi class).

```ts
import { spawn } from 'child_process'
import { rmSync } from 'fs'
import { join } from 'path'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { ensureEngine } from './EngineManager'
import { buildArgs } from './BrowserLauncher'
import { ensureRelay } from './ProxyRelay'
import { waitForWsEndpoint } from './AutomationRunner'
import { trackProc } from './EngineProcs'
import { ProfileStore } from './ProfileStore'
import { ChannelSearchStore } from './ChannelSearchStore'
import { channelSearchEvents } from './ChannelSearchService'
import type { CsTiktokMatch } from '@shared/types'

function log(msg: string): void {
  channelSearchEvents.emit('log', msg)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

interface RawUser {
  username: string
  nickname: string
  followers: number | null
  avatarUrl: string
}

/** Mở trang search user TikTok, gom kết quả từ JSON của XHR /api/search/. */
async function collectSearchUsers(page: Page, query: string): Promise<RawUser[]> {
  const users: RawUser[] = []
  const onResponse = async (res: any): Promise<void> => {
    if (!/\/api\/search\/(user|general)\//.test(res.url())) return
    try {
      const j = await res.json()
      const list = j?.user_list ?? []
      for (const u of list) {
        const info = u?.user_info
        if (info?.unique_id) {
          users.push({
            username: String(info.unique_id),
            nickname: String(info.nickname ?? ''),
            followers: typeof info.follower_count === 'number' ? info.follower_count : null,
            avatarUrl: info.avatar_thumb?.url_list?.[0] ?? ''
          })
        }
      }
    } catch {
      /* body không phải JSON → bỏ qua */
    }
  }
  page.on('response', onResponse)
  try {
    await page.goto(`https://www.tiktok.com/search/user?q=${encodeURIComponent(query)}`, {
      waitUntil: 'domcontentloaded'
    })
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      if (users.length > 0) break
      // TikTok hiện captcha → dừng sớm với lỗi rõ ràng
      const captcha = await page
        .$('#captcha_container, .captcha_verify_container, [class*="captcha"]')
        .catch(() => null)
      if (captcha) throw new Error('TikTok hiện captcha — mở profile thủ công giải captcha rồi thử lại')
      await sleep(800)
    }
  } finally {
    page.off('response', onResponse)
  }
  return users
}

/**
 * Check 1 candidate: search TikTok theo tên kênh (+ handle nếu khác) qua profile
 * antidetect đã cấu hình, lưu top-N account giống nhất. Ném Error với message
 * tiếng Việt rõ ràng khi không chạy được.
 */
export async function checkTiktok(candidateId: string): Promise<CsTiktokMatch[]> {
  const cand = ChannelSearchStore.getCandidate(candidateId)
  if (!cand) throw new Error('Không tìm thấy ứng viên')
  const s = ChannelSearchStore.getSettings()
  if (!s.checkProfileId) throw new Error('Chưa chọn profile check TikTok (vào ⚙️ Cài đặt)')
  const profile = ProfileStore.get(s.checkProfileId)
  if (!profile) throw new Error('Profile check TikTok không còn tồn tại — chọn lại trong ⚙️ Cài đặt')
  if (!profile.loggedIn) throw new Error(`Profile "${profile.name}" chưa đăng nhập TikTok`)
  if (profile.status === 'running') throw new Error(`Profile "${profile.name}" đang chạy — đóng trước khi check`)

  const enginePath = await ensureEngine()
  await ensureRelay(profile)
  try {
    rmSync(join(profile.userDataDir, 'DevToolsActivePort'), { force: true })
  } catch {
    /* ignore */
  }

  const child = spawn(
    enginePath,
    [
      ...buildArgs(profile),
      '--remote-debugging-port=0',
      '--remote-allow-origins=*',
      '--window-position=-32000,-32000'
    ],
    { stdio: 'ignore' }
  )
  trackProc(child)
  child.on('error', () => { /* nuốt lỗi engine — không crash app */ })

  let browser: Browser | null = null
  try {
    const ws = await waitForWsEndpoint(profile.userDataDir)
    browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null })
    const pages = await browser.pages()
    const page = pages[0] ?? (await browser.newPage())

    log(`[${cand.name}] Search TikTok: "${cand.name}"…`)
    const byName = await collectSearchUsers(page, cand.name)
    let all = byName
    const handleQ = cand.handle.replace(/^@/, '')
    if (handleQ && handleQ.toLowerCase() !== cand.name.toLowerCase()) {
      log(`[${cand.name}] Search TikTok: "${handleQ}"…`)
      const byHandle = await collectSearchUsers(page, handleQ)
      all = [...byName, ...byHandle]
    }

    // Dedupe theo username; ưu tiên trùng handle chính xác, sau đó follower giảm dần.
    const uniq = new Map<string, RawUser>()
    for (const u of all) if (!uniq.has(u.username)) uniq.set(u.username, u)
    const sorted = [...uniq.values()].sort((a, b) => {
      const aExact = a.username.toLowerCase() === handleQ.toLowerCase() ? 1 : 0
      const bExact = b.username.toLowerCase() === handleQ.toLowerCase() ? 1 : 0
      if (aExact !== bExact) return bExact - aExact
      return (b.followers ?? 0) - (a.followers ?? 0)
    })
    const top = sorted.slice(0, s.topN).map((u) => ({
      username: u.username,
      nickname: u.nickname,
      followers: u.followers,
      videoCount: null as number | null, // search API không trả số video — để null, UI hiện "—"
      avatarUrl: u.avatarUrl
    }))

    const matches = ChannelSearchStore.setMatches(candidateId, top)
    log(`[${cand.name}] Xong: ${matches.length} account giống nhất`)
    return matches
  } finally {
    try {
      if (browser) await browser.close()
    } catch {
      /* ignore */
    }
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.killed) return resolve()
      const t = setTimeout(() => {
        try {
          child.kill()
        } catch {
          /* ignore */
        }
        resolve()
      }, 6000)
      child.once('exit', () => {
        clearTimeout(t)
        resolve()
      })
    })
  }
}
```

- [ ] **Step 2: Đăng ký handler trong `src/main/ipc.ts`**

Thêm import `import { checkTiktok } from './services/TikTokSearch'` và cạnh các handler channelSearch:

```ts
  ipcMain.handle('channelSearch:checkTiktok', (_e, id: string) => checkTiktok(id))
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → sạch. `npm run dev` → console:
1. Lưu 1 candidate giả: `await window.hnv.channelSearch.addCandidate({ytChannelId:'test1', url:'https://youtube.com/@mrbeast', name:'MrBeast', handle:'@mrbeast', thumbnail:'', subs:null, videoCount:null, avgViews:null, lastUploadAt:null, uploadsPerWeek:null, country:null, ytCreatedAt:null, likeViewPct:null, commentViewPct:null, viewSubRatio:null, momentumPct:null, viewConsistency:null, shortsPct:null, shortsCount:null, topics:null, audienceLangs:null})`
2. Cấu hình profile đã login: `await window.hnv.channelSearch.saveSettings({apiKey:'', checkProfileId:'<ID PROFILE ĐÃ LOGIN>', topN:5})` (lấy id từ `await window.hnv.profiles.list()`)
3. `await window.hnv.channelSearch.checkTiktok('<candidate id từ bước 1>')`
Expected: trả mảng matches có username/nickname/followers; candidate trong `listCandidates()` có `matches` + `tiktokCheckedAt`. Case lỗi: chưa set profile → Error "Chưa chọn profile…"; profile đang mở → Error "…đang chạy".

---

### Task 8: Sidebar + App wiring + SearchTab shell + SettingsDialog

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Modify: `src/renderer/src/App.tsx`
- Create: `src/renderer/src/features/search/SearchTab.tsx`

**Interfaces:**
- Consumes: `window.hnv.channelSearch.getSettings/saveSettings`, `window.hnv.profiles.list`, `showToast` từ `uiDialogs`.
- Produces: tab `search` hoạt động; `SearchTab` render 2 khu vực bằng components `SearchPanel` (Task 9) và `CandidatesPanel` (Task 10) — Task 8 tạm render placeholder text cho 2 khu, Task 9/10 thay thế. Export nội bộ: `CsSettingsDialog({ settings, profiles, onClose, onSaved })`.

- [ ] **Step 1: Sidebar — thêm tab**

Trong `src/renderer/src/components/Sidebar.tsx`:
- Sửa `TabKey`: thêm `'search'` → `export type TabKey = 'profile' | 'template' | 'getvideo' | 'search' | 'queue' | 'schedule' | 'analytics' | 'proxy' | 'setting'`
- Thêm vào mảng `TABS` sau dòng getvideo: `{ key: 'search', icon: '🔍', label: 'Search Kênh' },`

- [ ] **Step 2: App — render tab**

Trong `src/renderer/src/App.tsx`: thêm `import { SearchTab } from './features/search/SearchTab'` và thêm nhánh sau `getvideo`:

```tsx
        ) : tab === 'search' ? (
          <SearchTab />
```

- [ ] **Step 3: Viết `src/renderer/src/features/search/SearchTab.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { showToast } from '../../components/uiDialogs'
import type { CsSettings, Profile } from '@shared/types'

export function CsSettingsDialog({
  settings,
  profiles,
  onClose,
  onSaved
}: {
  settings: CsSettings
  profiles: Profile[]
  onClose: () => void
  onSaved: (s: CsSettings) => void
}): JSX.Element {
  const [s, setS] = useState<CsSettings>(settings)
  const loggedIn = profiles.filter((p) => p.loggedIn)

  const save = async (): Promise<void> => {
    const saved = await window.hnv.channelSearch.saveSettings(s)
    onSaved(saved)
    showToast('Đã lưu cài đặt')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-[520px] bg-[#0d0e14] border border-border rounded-[14px] shadow-2xl overflow-hidden">
        <div className="px-[22px] py-[16px] border-b border-borderSoft flex items-center">
          <div className="text-[17px] font-bold">⚙️ Cài đặt Search Kênh</div>
          <button onClick={onClose} className="ml-auto text-muted text-lg">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <div className="text-[13px] text-subtle mb-1.5">YouTube Data API v3 key (bỏ trống = dùng yt-dlp, lọc rút gọn)</div>
            <input className="inp" value={s.apiKey} onChange={(e) => setS({ ...s, apiKey: e.target.value })} placeholder="AIza…" />
          </div>
          <div>
            <div className="text-[13px] text-subtle mb-1.5">Profile check TikTok (phải đã đăng nhập)</div>
            <select className="inp" value={s.checkProfileId} onChange={(e) => setS({ ...s, checkProfileId: e.target.value })}>
              <option value="">— Chưa chọn —</option>
              {loggedIn.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {loggedIn.length === 0 && (
              <div className="text-[12px] text-warn mt-1">Chưa có profile nào đăng nhập TikTok — vào tab Profile đăng nhập trước.</div>
            )}
          </div>
          <div>
            <div className="text-[13px] text-subtle mb-1.5">Số account TikTok lưu mỗi lần check (top N)</div>
            <input className="inp w-[120px]" type="number" min={1} max={20} value={s.topN} onChange={(e) => setS({ ...s, topN: parseInt(e.target.value) || 5 })} />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-borderSoft flex justify-end gap-2">
          <button onClick={onClose} className="bg-surface text-[#c7c8d4] border border-border rounded-[9px] px-4 py-2 text-[14px]">Hủy</button>
          <button onClick={save} className="accent-grad text-white font-semibold rounded-[9px] px-4 py-2 text-[14px]">Lưu</button>
        </div>
      </div>
    </div>
  )
}

type View = 'find' | 'candidates'

export function SearchTab(): JSX.Element {
  const [view, setView] = useState<View>('find')
  const [settings, setSettings] = useState<CsSettings | null>(null)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    window.hnv.channelSearch.getSettings().then(setSettings)
    window.hnv.profiles.list().then(setProfiles)
  }, [])

  return (
    <div className="flex-1 flex flex-col min-w-0 p-5">
      <div className="flex items-center mb-4">
        <div className="text-[20px] font-bold">🔍 Search Kênh</div>
        <div className="ml-5 flex gap-1 bg-[#101117] border border-border rounded-[10px] p-1">
          {(['find', 'candidates'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={
                'px-3.5 py-1.5 rounded-[8px] text-[13px] transition ' +
                (view === v ? 'text-white font-semibold bg-[linear-gradient(100deg,rgba(129,140,248,.25),rgba(34,211,238,.12))]' : 'text-subtle')
              }
            >
              {v === 'find' ? 'Tìm kiếm' : 'Ứng viên'}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowSettings(true)}
          className="ml-auto bg-surface text-[#c7c8d4] border border-border rounded-[9px] px-4 py-2 text-[14px]"
        >
          ⚙️ Cài đặt
        </button>
      </div>

      {/* Task 9 thay bằng <SearchPanel …/>, Task 10 thay bằng <CandidatesPanel …/> */}
      {view === 'find' ? (
        <div className="flex-1 flex items-center justify-center text-muted">Khu Tìm kiếm (Task 9)</div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted">Khu Ứng viên (Task 10)</div>
      )}

      {showSettings && settings && (
        <CsSettingsDialog
          settings={settings}
          profiles={profiles}
          onClose={() => setShowSettings(false)}
          onSaved={setSettings}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → sạch. `npm run dev` → sidebar có "🔍 Search Kênh" sau Get Video; bấm vào thấy header + 2 nút chuyển khu + placeholder; ⚙️ mở dialog, lưu API key + chọn profile + topN, đóng mở lại còn nguyên (persist SQLite).

---

### Task 9: SearchPanel — khu Tìm kiếm

**Files:**
- Create: `src/renderer/src/features/search/SearchPanel.tsx`
- Modify: `src/renderer/src/features/search/SearchTab.tsx` (thay placeholder `find`)

**Interfaces:**
- Consumes: `window.hnv.channelSearch.search/addCandidate`, `showToast`, types Task 1.
- Produces: `SearchPanel({ hasApiKey }: { hasApiKey: boolean })`.

- [ ] **Step 1: Viết `src/renderer/src/features/search/SearchPanel.tsx`**

```tsx
import { useState } from 'react'
import { showToast } from '../../components/uiDialogs'
import type { CsSearchParams, CsSearchResult } from '@shared/types'

const EMPTY_PARAMS: CsSearchParams = {
  keyword: '',
  subsMin: null, subsMax: null, countries: [], ageMinDays: null, ageMaxDays: null,
  topicsAny: [], uploadsPerWeekMin: null, lastUploadWithinDays: null, shortsCountMin: null,
  durationMaxSec: null, avgViewsMin: null, likeViewPctMin: null, commentViewPctMin: null,
  viewSubRatioMin: null, momentumPctMin: null, viewConsistencyMin: null, shortsPctMin: null,
  audienceLang: null, audienceLangPctMin: 50
}

function fmt(n: number | null): string {
  if (n === null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function fmtDate(ts: number | null): string {
  return ts === null ? '—' : new Date(ts).toLocaleDateString('vi-VN')
}

/** Input số cho filter: rỗng = null (không áp dụng). */
function NumInput({
  label, value, onChange, step
}: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
  step?: string
}): JSX.Element {
  return (
    <label className="block">
      <div className="text-[12px] text-subtle mb-1">{label}</div>
      <input
        className="inp"
        type="number"
        step={step ?? '1'}
        value={value ?? ''}
        placeholder="—"
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    </label>
  )
}

export function SearchPanel({ hasApiKey }: { hasApiKey: boolean }): JSX.Element {
  const [params, setParams] = useState<CsSearchParams>(EMPTY_PARAMS)
  const [showFilters, setShowFilters] = useState(false)
  const [results, setResults] = useState<CsSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  const patch = (p: Partial<CsSearchParams>): void => setParams((c) => ({ ...c, ...p }))

  const search = async (): Promise<void> => {
    if (!params.keyword.trim()) {
      showToast('Nhập keyword trước')
      return
    }
    setLoading(true)
    try {
      setResults(await window.hnv.channelSearch.search(params))
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const save = async (r: CsSearchResult): Promise<void> => {
    const { existed } = await window.hnv.channelSearch.addCandidate(r)
    setSavedIds((s) => new Set(s).add(r.ytChannelId))
    showToast(existed ? 'Kênh đã có trong danh sách ứng viên' : `Đã lưu "${r.name}"`)
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {!hasApiKey && (
        <div className="mb-3 px-4 py-2.5 rounded-[10px] border border-[#5a4a1a] bg-[#2a2410] text-[13px] text-[#e8c96a]">
          Chưa có API key — đang dùng yt-dlp: chỉ lọc được keyword / sub / số Shorts. Thêm YouTube API key trong ⚙️ Cài đặt để lọc đầy đủ.
        </div>
      )}
      <div className="flex gap-2 mb-3">
        <input
          className="inp flex-1"
          placeholder='Keyword, ví dụ: "funny cat", "satisfying slime"…'
          value={params.keyword}
          onChange={(e) => patch({ keyword: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && search()}
        />
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="bg-surface text-[#c7c8d4] border border-border rounded-[9px] px-4 text-[14px] shrink-0"
        >
          {showFilters ? '▲' : '▼'} Bộ lọc
        </button>
        <button
          onClick={search}
          disabled={loading}
          className="accent-grad text-white font-semibold rounded-[9px] px-5 text-[14px] shrink-0 disabled:opacity-50"
        >
          {loading ? 'Đang tìm…' : 'Tìm'}
        </button>
      </div>

      {showFilters && (
        <div className="mb-3 p-4 rounded-[12px] border border-border bg-[#0d0e14] grid grid-cols-4 gap-3">
          <NumInput label="Sub tối thiểu" value={params.subsMin} onChange={(v) => patch({ subsMin: v })} />
          <NumInput label="Sub tối đa" value={params.subsMax} onChange={(v) => patch({ subsMax: v })} />
          <label className="block">
            <div className="text-[12px] text-subtle mb-1">Quốc gia (ISO, phẩy: US,VN)</div>
            <input
              className="inp"
              value={params.countries.join(',')}
              placeholder="—"
              onChange={(e) =>
                patch({ countries: e.target.value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) })
              }
            />
          </label>
          <label className="block">
            <div className="text-[12px] text-subtle mb-1">Chủ đề (phẩy: Gaming,Pets)</div>
            <input
              className="inp"
              value={params.topicsAny.join(',')}
              placeholder="—"
              onChange={(e) => patch({ topicsAny: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
            />
          </label>
          <NumInput label="Tuổi kênh tối thiểu (ngày)" value={params.ageMinDays} onChange={(v) => patch({ ageMinDays: v })} />
          <NumInput label="Tuổi kênh tối đa (ngày)" value={params.ageMaxDays} onChange={(v) => patch({ ageMaxDays: v })} />
          <NumInput label="Video/tuần tối thiểu" value={params.uploadsPerWeekMin} onChange={(v) => patch({ uploadsPerWeekMin: v })} step="0.1" />
          <NumInput label="Đăng gần nhất trong (ngày)" value={params.lastUploadWithinDays} onChange={(v) => patch({ lastUploadWithinDays: v })} />
          <NumInput label="Số Shorts tối thiểu" value={params.shortsCountMin} onChange={(v) => patch({ shortsCountMin: v })} />
          <NumInput label="Thời lượng ≤ (giây)" value={params.durationMaxSec} onChange={(v) => patch({ durationMaxSec: v })} />
          <NumInput label="View TB tối thiểu" value={params.avgViewsMin} onChange={(v) => patch({ avgViewsMin: v })} />
          <NumInput label="Like/view % tối thiểu" value={params.likeViewPctMin} onChange={(v) => patch({ likeViewPctMin: v })} step="0.1" />
          <NumInput label="Comment/view % tối thiểu" value={params.commentViewPctMin} onChange={(v) => patch({ commentViewPctMin: v })} step="0.01" />
          <NumInput label="View/sub tối thiểu" value={params.viewSubRatioMin} onChange={(v) => patch({ viewSubRatioMin: v })} step="0.1" />
          <NumInput label="Momentum % tối thiểu" value={params.momentumPctMin} onChange={(v) => patch({ momentumPctMin: v })} />
          <NumInput label="Độ ổn định ≥ (0–1)" value={params.viewConsistencyMin} onChange={(v) => patch({ viewConsistencyMin: v })} step="0.05" />
          <NumInput label="% Shorts tối thiểu" value={params.shortsPctMin} onChange={(v) => patch({ shortsPctMin: v })} />
          <label className="block">
            <div className="text-[12px] text-subtle mb-1">Ngôn ngữ khán giả (en, vi…)</div>
            <input
              className="inp"
              value={params.audienceLang ?? ''}
              placeholder="—"
              onChange={(e) => patch({ audienceLang: e.target.value.trim().toLowerCase() || null })}
            />
          </label>
          <NumInput label="Ngôn ngữ đó ≥ %" value={params.audienceLangPctMin} onChange={(v) => patch({ audienceLangPctMin: v ?? 50 })} />
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto hv-scroll rounded-[12px] border border-border">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-[#101117] text-subtle">
            <tr>
              {['Kênh', 'Sub', 'Video', 'View TB', 'Like/view', 'Momentum', 'Ổn định', '%Shorts', 'Đăng cuối', 'QG', 'Ngôn ngữ KG', 'Tạo kênh', ''].map((h) => (
                <th key={h} className="text-left px-3 py-2.5 font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.length === 0 && (
              <tr>
                <td colSpan={13} className="px-3 py-10 text-center text-muted">
                  {loading ? 'Đang tìm kiếm…' : 'Nhập keyword và bấm Tìm'}
                </td>
              </tr>
            )}
            {results.map((r) => (
              <tr key={r.ytChannelId} className="border-t border-borderSoft hover:bg-surface/50">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2 min-w-[180px]">
                    {r.thumbnail && <img src={r.thumbnail} className="w-7 h-7 rounded-full" />}
                    <div>
                      <a
                        className="text-white hover:underline cursor-pointer"
                        onClick={() => window.open(r.url, '_blank')}
                      >
                        {r.name || r.ytChannelId}
                      </a>
                      <div className="text-[11px] text-muted">{r.handle}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2">{fmt(r.subs)}</td>
                <td className="px-3 py-2">{fmt(r.videoCount)}</td>
                <td className="px-3 py-2">{fmt(r.avgViews)}</td>
                <td className="px-3 py-2">{r.likeViewPct === null ? '—' : `${r.likeViewPct}%`}</td>
                <td className="px-3 py-2">
                  {r.momentumPct === null ? '—' : (
                    <span className={r.momentumPct >= 0 ? 'text-ok' : 'text-danger'}>
                      {r.momentumPct >= 0 ? '📈 +' : '📉 '}{r.momentumPct}%
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">{r.viewConsistency === null ? '—' : r.viewConsistency.toFixed(2)}</td>
                <td className="px-3 py-2">{r.shortsPct === null ? '—' : `${r.shortsPct}%`}</td>
                <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.lastUploadAt)}</td>
                <td className="px-3 py-2">{r.country ?? '—'}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {r.audienceLangs === null ? '—' : r.audienceLangs.slice(0, 2).map((l) => `${l.lang} ${l.pct}%`).join(' · ')}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.ytCreatedAt)}</td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => save(r)}
                    disabled={savedIds.has(r.ytChannelId)}
                    className="bg-surface text-[#c7c8d4] border border-border rounded-[8px] px-3 py-1.5 text-[12px] whitespace-nowrap disabled:opacity-40"
                  >
                    {savedIds.has(r.ytChannelId) ? '✓ Đã lưu' : '➕ Lưu ứng viên'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Nối vào `SearchTab.tsx`**

Thêm `import { SearchPanel } from './SearchPanel'`. Thay placeholder khu `find`:

```tsx
      {view === 'find' ? (
        <SearchPanel hasApiKey={!!settings?.apiKey} />
      ) : (
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → sạch. `npm run dev`:
1. Không API key: banner vàng hiện; search → kết quả cột thiếu hiện "—".
2. Có API key: search "funny cat" → bảng đầy đủ; mở Bộ lọc đặt `Sub tối thiểu 10000` → kết quả ít lại.
3. Bấm "➕ Lưu ứng viên" → toast, nút thành "✓ Đã lưu"; lưu lần 2 kênh khác rồi kiểm tra `await window.hnv.channelSearch.listCandidates()` trong console có 2 kênh.

---

### Task 10: CandidatesPanel — khu Ứng viên

**Files:**
- Create: `src/renderer/src/features/search/CandidatesPanel.tsx`
- Modify: `src/renderer/src/features/search/SearchTab.tsx` (thay placeholder `candidates`)

**Interfaces:**
- Consumes: `window.hnv.channelSearch.listCandidates/checkTiktok/setStatus/removeCandidate`, `window.hnv.getvideo.addChannel`, `window.hnv.onChannelSearchLog`, `confirmDialog`, `showToast`.
- Produces: `CandidatesPanel(): JSX.Element`.

- [ ] **Step 1: Viết `src/renderer/src/features/search/CandidatesPanel.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import { confirmDialog, showToast } from '../../components/uiDialogs'
import type { CsCandidate, CsStatus } from '@shared/types'

const STATUS: { key: CsStatus; label: string; cls: string }[] = [
  { key: 'new', label: '🆕 Chưa check', cls: 'text-subtle border-border' },
  { key: 'good', label: '✅ Đáng làm', cls: 'text-ok border-[#1f4d35]' },
  { key: 'own_tiktok', label: '🎭 Có TikTok riêng', cls: 'text-[#e8c96a] border-[#5a4a1a]' },
  { key: 'reupped', label: '♻️ Đã có người reup', cls: 'text-[#f0955a] border-[#5a3a1a]' },
  { key: 'skip', label: '⏭️ Bỏ qua', cls: 'text-muted border-border' },
  { key: 'in_use', label: '▶️ Đang dùng', cls: 'text-[#818cf8] border-[#3a3d6b]' }
]

function fmt(n: number | null): string {
  if (n === null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function timeAgo(ts: number | null): string {
  if (!ts) return 'chưa check'
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s trước`
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`
  return `${Math.floor(s / 86400)} ngày trước`
}

export function CandidatesPanel(): JSX.Element {
  const [cands, setCands] = useState<CsCandidate[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [checking, setChecking] = useState<string | null>(null) // id đang check
  const [checkingAll, setCheckingAll] = useState(false)
  const [logLine, setLogLine] = useState('')
  const stopAll = useRef(false)

  const reload = (): Promise<void> => window.hnv.channelSearch.listCandidates().then(setCands)

  useEffect(() => {
    reload()
    return window.hnv.onChannelSearchLog(setLogLine)
  }, [])

  const checkOne = async (id: string): Promise<boolean> => {
    setChecking(id)
    try {
      await window.hnv.channelSearch.checkTiktok(id)
      await reload()
      return true
    } catch (e) {
      showToast((e as Error).message)
      return false
    } finally {
      setChecking(null)
    }
  }

  const checkAll = async (): Promise<void> => {
    const targets = cands.filter((c) => c.tiktokCheckedAt === null)
    if (!targets.length) {
      showToast('Không còn ứng viên chưa check')
      return
    }
    setCheckingAll(true)
    stopAll.current = false
    let fails = 0
    for (const c of targets) {
      if (stopAll.current) break
      const ok = await checkOne(c.id)
      fails = ok ? 0 : fails + 1
      if (fails >= 3) {
        showToast('Dừng: lỗi 3 lần liên tiếp')
        break
      }
      // nghỉ ngẫu nhiên 3–6s giữa các kênh — tránh spam search TikTok
      await new Promise((r) => setTimeout(r, 3000 + Math.random() * 3000))
    }
    setCheckingAll(false)
  }

  const setStatus = async (id: string, st: CsStatus): Promise<void> => {
    await window.hnv.channelSearch.setStatus(id, st)
    await reload()
  }

  const addToGetVideo = async (c: CsCandidate): Promise<void> => {
    await window.hnv.getvideo.addChannel(c.url)
    await setStatus(c.id, 'in_use')
    showToast(`Đã thêm "${c.name}" vào Get Video`)
  }

  const remove = async (c: CsCandidate): Promise<void> => {
    const ok = await confirmDialog(`Xóa ứng viên "${c.name}"?`)
    if (!ok) return
    await window.hnv.channelSearch.removeCandidate(c.id)
    await reload()
  }

  const toggle = (id: string): void =>
    setExpanded((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center mb-3">
        <div className="text-[13px] text-muted">{cands.length} ứng viên</div>
        <button
          onClick={checkingAll ? () => (stopAll.current = true) : checkAll}
          className="ml-auto bg-surface text-[#c7c8d4] border border-border rounded-[9px] px-4 py-2 text-[14px]"
        >
          {checkingAll ? '⏹ Dừng check' : '🔎 Check tất cả'}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto hv-scroll rounded-[12px] border border-border">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-[#101117] text-subtle">
            <tr>
              {['Kênh YouTube', 'Sub', 'Trạng thái', 'Kết quả TikTok', 'Hành động'].map((h) => (
                <th key={h} className="text-left px-3 py-2.5 font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cands.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-muted">
                  Chưa có ứng viên — sang khu Tìm kiếm để lưu kênh
                </td>
              </tr>
            )}
            {cands.map((c) => {
              const st = STATUS.find((s) => s.key === c.status) ?? STATUS[0]
              return (
                <>
                  <tr key={c.id} className="border-t border-borderSoft hover:bg-surface/50">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2 min-w-[200px]">
                        {c.thumbnail && <img src={c.thumbnail} className="w-7 h-7 rounded-full" />}
                        <div>
                          <a className="text-white hover:underline cursor-pointer" onClick={() => window.open(c.url, '_blank')}>
                            {c.name || c.ytChannelId}
                          </a>
                          <div className="text-[11px] text-muted">{c.handle}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">{fmt(c.subs)}</td>
                    <td className="px-3 py-2">
                      <select
                        value={c.status}
                        onChange={(e) => setStatus(c.id, e.target.value as CsStatus)}
                        className={`bg-[#101117] border rounded-[8px] px-2 py-1.5 text-[12px] ${st.cls}`}
                      >
                        {STATUS.map((s) => (
                          <option key={s.key} value={s.key}>{s.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {c.matches.length > 0 ? (
                        <button className="text-[#818cf8] hover:underline" onClick={() => toggle(c.id)}>
                          {expanded.has(c.id) ? '▾' : '▸'} {c.matches.length} account giống · {timeAgo(c.tiktokCheckedAt)}
                        </button>
                      ) : (
                        <span className="text-muted">{c.tiktokCheckedAt ? `0 account · ${timeAgo(c.tiktokCheckedAt)}` : 'chưa check'}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1.5 whitespace-nowrap">
                        <button
                          onClick={() => checkOne(c.id)}
                          disabled={checking !== null || checkingAll}
                          className="bg-surface text-[#c7c8d4] border border-border rounded-[8px] px-3 py-1.5 text-[12px] disabled:opacity-40"
                        >
                          {checking === c.id ? '⏳…' : '🔎 Check TikTok'}
                        </button>
                        <button
                          onClick={() => addToGetVideo(c)}
                          disabled={c.status === 'in_use'}
                          className="bg-surface text-[#c7c8d4] border border-border rounded-[8px] px-3 py-1.5 text-[12px] disabled:opacity-40"
                        >
                          ▶️ Get Video
                        </button>
                        <button
                          onClick={() => remove(c)}
                          className="bg-surface text-danger border border-border rounded-[8px] px-2.5 py-1.5 text-[12px]"
                        >
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expanded.has(c.id) &&
                    c.matches.map((m) => (
                      <tr key={m.id} className="bg-[#0d0e14]">
                        <td colSpan={5} className="px-3 py-1.5">
                          <div className="flex items-center gap-3 pl-9 text-[12px]">
                            {m.avatarUrl && <img src={m.avatarUrl} className="w-6 h-6 rounded-full" />}
                            <a
                              className="text-white hover:underline cursor-pointer"
                              onClick={() => window.open(`https://www.tiktok.com/@${m.username}`, '_blank')}
                            >
                              @{m.username}
                            </a>
                            <span className="text-subtle">{m.nickname}</span>
                            <span className="text-muted ml-auto">{fmt(m.followers)} follower · {m.videoCount === null ? '—' : fmt(m.videoCount)} video</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                </>
              )
            })}
          </tbody>
        </table>
      </div>

      {logLine && <div className="mt-2 text-[12px] text-muted truncate">{logLine}</div>}
    </div>
  )
}
```

- [ ] **Step 2: Nối vào `SearchTab.tsx`**

Thêm `import { CandidatesPanel } from './CandidatesPanel'`, thay placeholder khu `candidates`:

```tsx
      ) : (
        <CandidatesPanel />
      )}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → sạch. `npm run dev`:
1. Khu Ứng viên hiện các kênh đã lưu ở Task 9.
2. "🔎 Check TikTok" 1 kênh (profile đã cấu hình + login) → hiện "N account giống"; expand thấy avatar/username/follower; link mở TikTok.
3. Đổi trạng thái qua dropdown → reload tab vẫn giữ.
4. "▶️ Get Video" → toast, trạng thái thành Đang dùng, kênh xuất hiện trong tab Get Video.
5. "Check tất cả" với ≥2 kênh chưa check → chạy tuần tự, log line dưới bảng, nút thành "⏹ Dừng check".
6. 🗑 → confirm dialog → mất khỏi danh sách.

---

### Task 11: Kiểm thử end-to-end theo checklist spec

**Files:** không sửa code — chỉ chạy checklist mục 7 của spec; phát hiện bug thì sửa tại file liên quan.

- [ ] **Step 1:** Search với API key hợp lệ — đủ cột, thử từng filter một (đặt 1 filter, các filter khác để trống) xác nhận kết quả thu hẹp đúng.
- [ ] **Step 2:** Search không key — fallback chạy, "—" đúng chỗ, banner hiện.
- [ ] **Step 3:** Search key sai — toast lỗi Google, app không crash.
- [ ] **Step 4:** Lưu/lưu trùng/xóa/đổi trạng thái ứng viên — restart app còn nguyên.
- [ ] **Step 5:** Check TikTok đủ 4 case: profile OK / chưa login / đang chạy / captcha (nếu gặp) — message đúng như spec mục 6.
- [ ] **Step 6:** Check tất cả — tuần tự, delay, dừng sau 3 lỗi liên tiếp (giả lập bằng cách chọn profile chưa login).
- [ ] **Step 7:** Thêm vào Get Video — kênh sang tab Get Video crawl được bằng nút Update.
- [ ] **Step 8:** Kênh tắt comment (ví dụ kênh kids) — ngôn ngữ khán giả "—", không lỗi.
- [ ] **Step 9:** `npm run build` — build production sạch lỗi.

---

## Self-review (đã chạy)

- **Spec coverage:** 18 tiêu chí → Task 4 (cơ bản) + 5 (sâu) + 6 (fallback); UI 2 khu + 6 trạng thái → Task 8–10; check TikTok qua profile → Task 7; tích hợp Get Video → Task 10; error handling spec mục 6 → Task 4 (ytGet), 6 (bot-check), 7 (validate + captcha), 10 (stop sau 3 lỗi); checklist kiểm thử spec mục 7 → Task 11. Không còn gap.
- **Placeholder scan:** sạch — mọi bước có code đầy đủ; 2 chỗ "Task N thay thế" là code thật chạy được tại thời điểm đó, có ghi rõ task nào thay.
- **Type consistency:** `CsSearchResult`/`CsCandidate`/`CsTiktokMatch`/`CsSearchParams`/`CsSettings`/`CsStatus` dùng thống nhất Task 1→10; kênh IPC `channelSearch:*` + event `channelsearch:log` khớp giữa preload (Task 3) và ipc.ts (Task 3/4/7); `ChannelSearchStore.setMatches` nhận `Omit<CsTiktokMatch,'id'|'candidateId'|'fetchedAt'>[]` khớp cách gọi ở Task 7.
