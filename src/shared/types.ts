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

export type WebRtcMode = 'auto' | 'block' | 'tcp_only'
export type NoiseVector = 'canvas' | 'webgl' | 'audio' | 'client_rects' | 'sensors' | 'fonts'

export interface Fingerprint {
  deviceId: string            // id of the entry in ShardX's device library
  platform: 'windows' | 'macos' | 'linux'
  userAgent: string           // read-only — the engine normalizes this itself
  hardwareConcurrency: number
  deviceMemory: number
  screen: { width: number; height: number }
  webgl: { vendor: string; renderer: string }
  language: string
  languages: string[]
  timezone: string            // IANA, or "auto"
  webrtc: WebRtcMode
  noise: NoiseVector[]        // which vectors have noise enabled; empty = all left at Real
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
  shardProfileId: string | null // ShardX-side profile id (null = not created yet)
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
    devices: (platform: string) => Promise<string[]>
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
    setFollowing: (id: string, following: boolean) => Promise<void>
    update: (id: string) => Promise<GvCrawlResult> // backfill 1 channel qua yt-dlp
    getSettings: () => Promise<GvSettings>
    saveSettings: (s: GvSettings) => Promise<GvSettings>
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
  }
  onProfileStatus: (cb: (id: string, status: ProfileStatus) => void) => () => void
  onLoginProgress: (cb: (id: string, msg: string) => void) => () => void
  onGetVideoUpdate: (cb: () => void) => () => void
  onGetVideoLog: (cb: (line: string) => void) => () => void
  onAnalyticsProgress: (cb: (msg: string) => void) => () => void
  onScheduleFired: (cb: (scheduleId: string, name: string) => void) => () => void
  onQueueUpdate: (cb: () => void) => () => void
  onJobLog: (cb: (jobId: string, line: string) => void) => () => void
}
