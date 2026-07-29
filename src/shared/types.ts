// Shared types between main (backend) and renderer (UI).

// Sentinel proxyId đại diện "IP máy thật (không proxy)". Gán id này cho profile
// nghĩa là xóa proxy → dùng thẳng mạng của máy.
export const MACHINE_PROXY_ID = '__machine__'

export type ProxyType = 'http' | 'https' | 'socks5'

export interface ProxyConfig {
  /** When false, the profile connects directly using the host machine IP. */
  useProxy: boolean
  type: ProxyType
  host: string
  port: string
  username: string
  password: string
}

export interface Fingerprint {
  /** 32-bit seed driving native fingerprint generation in fingerprint-chromium. */
  seed: number
  platform: 'windows' | 'macos' | 'linux'
  brand: string // browser brand for UA, e.g. "Chrome"
  browserVersion: string // display only; engine derives the real UA
  language: string // e.g. "en-US"
  languages: string[]
  timezone: string // IANA, or "auto" to follow proxy / system
  hardwareConcurrency: number
  blockWebRTC: boolean
}

export type ProfileStatus = 'idle' | 'running'

export interface Group {
  id: string
  name: string
  color: string
}

export interface Profile {
  id: string
  name: string
  groupId: string | null
  proxy: ProxyConfig
  fingerprint: Fingerprint
  userDataDir: string
  homepageUrl: string // website opened when launching the profile (manual Run)
  notes: string
  warningLevel: number // 0..5 (business meaning TBD)
  status: ProfileStatus
  lastUsedAt: number | null
  createdAt: number
  tiktokUsername: string
  tiktokPassword: string
  tiktok2fa: string
  loggedIn: boolean
  proxyId: string | null // id proxy trong pool (nếu gán từ tab Proxy)
  // joined / runtime fields
  groupName?: string | null
  groupColor?: string | null
  proxyCountry?: string | null
  proxyCountryCode?: string | null
  proxyIp?: string | null
}

/** Payload to create one or many profiles at once. */
export interface CreateProfileInput {
  namePrefix: string
  quantity: number
  groupId: string | null
  homepageUrl: string
  notes: string
}

// ---- Templates (automation jobs: pre-coded script + config form) ----

export type CaptionMode = 'filename' | 'empty' | 'custom'
export type VideoOrder = 'oldest' | 'newest' | 'random' | 'name'

export interface HashtagItem {
  tag: string // includes leading '#'
  color: string // hex, for UI display
}

export interface UploadVideoConfig {
  pendingDir: string
  uploadedDir: string
  errorDir: string
  videoOrder: VideoOrder
  captionMode: CaptionMode
  captionCustom: string // used when captionMode === 'custom'; supports {filename}
  hashtags: HashtagItem[] // pool
  hashtagCount: number // how many random tags from the pool per video (0..N)
  // When enabled and TikTok flags a violation for that check, the video is NOT
  // posted: it is logged and moved to the Error folder.
  checkCopyright: boolean
  checkContent: boolean
}

export interface Template {
  id: string
  name: string
  type: 'upload-video'
  platform: 'tiktok'
  config: UploadVideoConfig
  scriptCode: string
  concurrency: number
  retry: number
  createdAt: number
  updatedAt: number
}

// ---- Schedule (timeline of timed runs) ----

export type ScheduleRepeat = 'once' | 'weekly'

export interface Schedule {
  id: string
  name: string
  time: string // "HH:MM" (local)
  date: string // "YYYY-MM-DD": ngày chạy (once) hoặc ngày bắt đầu (weekly); '' = chưa đặt
  repeat: ScheduleRepeat
  weekdays: number[] // chỉ dùng khi repeat='weekly'. getDay(): 0=CN,1=T2,…,6=T7. Đủ 7 = hàng ngày
  templateId: string | null
  profileIds: string[]
  enabled: boolean
  lastRunAt: number | null
  createdAt: number
}

// ---- Queue (live job queue + automation execution) ----

export type JobStatus = 'queued' | 'running' | 'done' | 'error'

export interface Job {
  id: string
  templateId: string
  templateName: string
  profileId: string
  profileName: string
  status: JobStatus
  error: string | null
  progress: number // 0..100 (best-effort)
  /** Current step index for running jobs, inferred from logs: 0=Mở 1=Chọn video 2=Upload 3=Check 4=Đăng. */
  stage: number
  /** Tên video đang xử lý (suy từ log), null nếu chưa có. */
  currentVideo: string | null
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
}

/** Nhãn các bước upload, theo thứ tự — dùng chung cho thanh tiến trình ở Queue. */
export const JOB_STAGES = ['Mở', 'Chọn video', 'Upload', 'Check', 'Đăng'] as const

/** Kết quả dọn dữ liệu profile (cache Chromium + nháp upload TikTok). */
export interface CleanResult {
  freedBytes: number
  profiles: number // số profile thực sự giải phóng được byte nào
}

export interface QueueState {
  paused: boolean
  maxConcurrency: number
}

export interface MachineIp {
  ip: string
  country: string // full name, e.g. "Vietnam"
  countryCode: string // lowercase ISO, e.g. "vn"
}

export interface ProxyCheckResult {
  alive: boolean
  ip: string | null
  country: string | null
  countryCode: string | null
  pingMs: number | null
  error?: string
}

export interface TiktokSyncResult {
  ok: boolean
  username?: string
  reason?: string
}

export interface LoginResult {
  ok: boolean
  reason?: string
}

export interface UploadLogEntry {
  videoName: string
  status: 'done' | 'error' | string
  note: string
  at: number
}

// IPC channel contract — keep in sync with preload bridge.
export interface ImportTxtResult {
  created: number
  failed: number
}

// ---- Analytics (follower theo ngày) ----

export interface AnalyticsPoint {
  date: string // 'YYYY-MM-DD'
  followers: number
}

export interface AnalyticsProfile {
  profileId: string
  name: string
  groupName?: string | null
  groupColor?: string | null
  points: AnalyticsPoint[]
}

export interface AnalyticsData {
  dates: string[] // tất cả ngày có dữ liệu, tăng dần
  profiles: AnalyticsProfile[]
}

export interface CollectResult {
  ok: number
  failed: number
}

// ---- Pool proxy ----

export interface Proxy {
  id: string
  type: ProxyType
  host: string
  port: string
  username: string
  password: string
  alive: boolean | null // null = chưa check
  ip: string | null // IP công khai khi đi qua proxy (điền sau khi check)
  country: string | null
  countryCode: string | null
  ping: number | null
  checkedAt: number | null
  createdAt: number
  usedBy: number // số profile đang gán proxy này
}

// ---- Get Video (crawl YouTube Shorts) ----

export interface GvChannel {
  id: string
  url: string
  name: string
  avatar: string // URL ảnh đại diện; '' = chưa lấy được
  following: boolean
  lastCrawl: number | null
  fetched: number
  createdAt: number
}

export type BackfillMode = 'hours' | 'count' | 'all'

export interface GvSettings {
  pendingDir: string
  backfillMode: BackfillMode
  backfillHours: number
  backfillCount: number
  maxDuration: number
  nameByTitle: boolean
  concurrency: number
  wsPort: number
  /** Trình duyệt lấy cookie cho yt-dlp (qua bot check). '' = không dùng. */
  cookieBrowser: string
}

export interface GvCrawlResult {
  downloaded: number
  skipped: number
  failed: number
}

// ---- Channel Search (tab Search Kênh: tìm kênh YouTube + check trùng TikTok) ----

export type CsStatus = 'new' | 'good' | 'own_tiktok' | 'reupped' | 'skip' | 'in_use'

export interface CsLangPct {
  lang: string // mã 2 chữ ('en','vi'…) hoặc ISO639-3 nếu không map được
  pct: number // 0..100
}

/** Video mẫu hiện trong khu chi tiết của 1 dòng kết quả — xem nhanh kênh làm nội dung gì. */
export interface CsSampleVideo {
  title: string
  views: number
  durationSec: number
  thumbnail: string
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
  momentumPct: number | null // view TB 10 video mới so với 20 video trước đó, % (+/-)
  viewConsistency: number | null // median/mean view của mẫu 30 video gần nhất, 0..1
  shortsCount: number | null // số Shorts thật của kênh — playlist_count tab /shorts qua yt-dlp (cả 2 nhánh có/không API key)
  topics: string[] | null // từ topicDetails, ví dụ ["Gaming"]
  audienceLangs: CsLangPct[] | null // phân bố ngôn ngữ ~50 comment + tiêu đề mẫu video
  /** Các Short mới nhất trong mẫu (tối đa 12). Chỉ có ở kết quả tìm kiếm — không lưu DB. */
  sampleVideos: CsSampleVideo[] | null
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
  limit: number // số kênh tối đa lấy về mỗi lần tìm, 1..50 (trần cứng của search.list)
  subsMin: number | null
  subsMax: number | null
  /** ISO hoa, null = mọi quốc gia. Chỉ MỘT nước: search.list nhận đúng một
   *  regionCode (gửi "KR,JP" bị API trả 400 invalidRegionCode), mà lọc nhiều nước
   *  ở phía sau thì phải gọi search.list mỗi nước một lần — đắt gấp bội quota. */
  country: string | null
  ageMinDays: number | null // kênh tạo tối thiểu X ngày trước
  ageMaxDays: number | null // kênh tạo trong vòng X ngày
  /** Match không phân biệt hoa thường, substring; [] = mọi chủ đề. Tên phải đúng
   *  tên topic thật YouTube trả về ('Film', 'Sport'… — không phải 'Movies'/'Sports').
   *  Không có keyword thì các tên này được ghép thành câu tìm ("Film | Sport"). */
  topicsAny: string[]
  uploadsPerWeekMin: number | null
  lastUploadWithinDays: number | null
  shortsCountMin: number | null
  durationMaxSec: number | null // median duration của mẫu 30 video gần nhất ≤ X
  avgViewsMin: number | null
  likeViewPctMin: number | null
  commentViewPctMin: number | null
  viewSubRatioMin: number | null
  momentumPctMin: number | null
  viewConsistencyMin: number | null // 0..1
  audienceLang: string | null // mã 2 chữ
  audienceLangPctMin: number // mặc định 50, chỉ dùng khi audienceLang != null
}

export interface CsSettings {
  apiKey: string // '' = dùng fallback yt-dlp
  checkProfileId: string // profile antidetect dùng search TikTok
  topN: number // số account TikTok lưu mỗi lần check, mặc định 5
}

/** Quota YouTube Data API v3 trong ngày. Google KHÔNG có endpoint đọc quota còn lại,
 *  nên app tự cộng dồn theo bảng giá từng endpoint → đây là ước tính, không phải số
 *  chính thức (gọi API bằng cùng key ở nơi khác thì app không đếm được). */
export interface CsQuota {
  used: number
  limit: number // cố định 10000 unit/ngày — hạn mức mặc định Google cấp
  resetAt: number // epoch ms mốc reset kế tiếp (0h múi giờ Thái Bình Dương)
  hasKey: boolean // false = đang chạy yt-dlp, không tiêu quota
}

export interface HnvApi {
  profiles: {
    list: () => Promise<Profile[]>
    create: (input: CreateProfileInput) => Promise<Profile[]>
    update: (profile: Profile) => Promise<Profile>
    remove: (id: string) => Promise<void>
    removeAll: () => Promise<number>
    run: (id: string) => Promise<void>
    stop: (id: string) => Promise<void>
    checkProxy: (proxy: ProxyConfig) => Promise<ProxyCheckResult>
    syncTiktok: (id: string) => Promise<TiktokSyncResult>
    importTxt: () => Promise<ImportTxtResult | null>
    setLoggedIn: (id: string, loggedIn: boolean) => Promise<void>
    login: (id: string) => Promise<LoginResult>
    uploadHistory: (id: string) => Promise<UploadLogEntry[]>
  }
  groups: {
    list: () => Promise<Group[]>
    create: (name: string, color: string) => Promise<Group>
    update: (group: Group) => Promise<Group>
    remove: (id: string) => Promise<void>
  }
  analytics: {
    collect: () => Promise<CollectResult>
    data: () => Promise<AnalyticsData>
  }
  proxies: {
    list: () => Promise<Proxy[]>
    addMany: (text: string, type: ProxyType) => Promise<number>
    remove: (id: string) => Promise<void>
    check: (id: string) => Promise<ProxyCheckResult>
    assign: (proxyId: string, profileIds: string[]) => Promise<void>
  }
  getvideo: {
    listChannels: () => Promise<GvChannel[]>
    addChannel: (url: string) => Promise<GvChannel>
    removeChannel: (id: string) => Promise<void>
    refreshMeta: () => Promise<void> // lấy tên + avatar cho channel còn thiếu
    setFollowing: (id: string, following: boolean) => Promise<void>
    update: (id: string) => Promise<GvCrawlResult> // backfill 1 channel qua yt-dlp
    getSettings: () => Promise<GvSettings>
    saveSettings: (s: GvSettings) => Promise<GvSettings>
  }
  channelSearch: {
    search: (params: CsSearchParams) => Promise<CsSearchResult[]>
    listCandidates: () => Promise<CsCandidate[]>
    addCandidate: (r: CsSearchResult) => Promise<{ candidate: CsCandidate; existed: boolean }>
    removeCandidate: (id: string) => Promise<void>
    setStatus: (id: string, status: CsStatus) => Promise<void>
    checkTiktok: (id: string) => Promise<CsTiktokMatch[]>
    getSettings: () => Promise<CsSettings>
    saveSettings: (s: CsSettings) => Promise<CsSettings>
    getQuota: () => Promise<CsQuota>
  }
  templates: {
    list: () => Promise<Template[]>
    create: (type: Template['type']) => Promise<Template>
    save: (template: Template) => Promise<Template>
    remove: (id: string) => Promise<void>
    defaultScript: (type: Template['type']) => Promise<string>
  }
  schedules: {
    list: () => Promise<Schedule[]>
    create: () => Promise<Schedule>
    save: (schedule: Schedule) => Promise<Schedule>
    remove: (id: string) => Promise<void>
  }
  queue: {
    list: () => Promise<Job[]>
    state: () => Promise<QueueState>
    enqueue: (templateId: string, profileIds: string[]) => Promise<void>
    jobLog: (jobId: string) => Promise<string[]>
    cancel: (jobId: string) => Promise<void>
    retry: (jobId: string) => Promise<void>
    clearDone: () => Promise<void>
    setPaused: (paused: boolean) => Promise<void>
  }
  system: {
    machineIp: () => Promise<MachineIp>
    pickFolder: () => Promise<string | null>
    openFolder: (dir: string) => Promise<boolean>
    countVideos: (dir: string) => Promise<number>
    /** Dọn cache Chromium của mọi profile; drafts=true xóa thêm kho nháp upload TikTok. */
    cleanData: (drafts: boolean) => Promise<CleanResult>
  }
  onProfileStatus: (cb: (id: string, status: ProfileStatus) => void) => () => void
  onLoginProgress: (cb: (id: string, msg: string) => void) => () => void
  onProfilesChanged: (cb: () => void) => () => void // main tự sửa profile (vd. job phát hiện đăng xuất)
  onGetVideoUpdate: (cb: () => void) => () => void
  onGetVideoLog: (cb: (line: string) => void) => () => void
  onChannelSearchLog: (cb: (line: string) => void) => () => void
  onChannelSearchQuota: (cb: (q: CsQuota) => void) => () => void
  onAnalyticsProgress: (cb: (msg: string) => void) => () => void
  onScheduleFired: (cb: (scheduleId: string, name: string) => void) => () => void
  onQueueUpdate: (cb: () => void) => () => void
  onJobLog: (cb: (jobId: string, line: string) => void) => () => void
}
