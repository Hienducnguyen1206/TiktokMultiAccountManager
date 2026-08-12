import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import { getDb } from '../db'
import { ProfileStore } from './ProfileStore'
import { TemplateStore } from './TemplateStore'
import { runJob, type RunHandle } from './AutomationRunner'
import { JOB_STAGES, type Job, type JobStatus, type QueueState } from '@shared/types'

export const queueEvents = new EventEmitter()

/** Giới hạn cứng của ô chỉnh số luồng. Trên 10 thì mấy Chromium tranh CPU tới
 *  mức trang tải chậm hơn cả chạy ít luồng — và với warmup thì nick lướt giật
 *  cục, đúng thứ đang muốn tránh. */
export const MIN_CONCURRENCY = 1
export const MAX_CONCURRENCY_LIMIT = 10

/** Số luồng đang dùng. Nạp từ DB trong init(), sửa qua setMaxConcurrency(). */
let maxConcurrency = 5

interface JobInternal {
  job: Job
  log: string[]
  handle?: RunHandle
}

const jobs = new Map<string, JobInternal>()
let paused = false

function errStr(e: unknown): string {
  if (e instanceof Error) return e.message || e.name
  if (typeof e === 'string') return e
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>
    if (typeof o.message === 'string' && o.message) return o.message
    if (typeof o.type === 'string') return `lỗi kết nối (${o.type})`
    try {
      const s = JSON.stringify(e)
      if (s && s !== '{}') return s
    } catch {
      /* ignore */
    }
  }
  return String(e)
}

function persist(j: Job, log: string[]): void {
  getDb()
    .prepare(`
      INSERT INTO jobs (id, template_id, profile_id, status, error, log, created_at, started_at, finished_at)
      VALUES (@id, @templateId, @profileId, @status, @error, @log, @createdAt, @startedAt, @finishedAt)
      ON CONFLICT(id) DO UPDATE SET status=@status, error=@error, log=@log, started_at=@startedAt, finished_at=@finishedAt
    `)
    .run({
      id: j.id,
      templateId: j.templateId,
      profileId: j.profileId,
      status: j.status,
      error: j.error,
      log: log.join('\n'),
      createdAt: j.createdAt,
      startedAt: j.startedAt,
      finishedAt: j.finishedAt
    })
}

function emitUpdate(): void {
  queueEvents.emit('update')
}

function setStatus(ji: JobInternal, status: JobStatus, error: string | null = null): void {
  ji.job.status = status
  ji.job.error = error
  if (status === 'running' && !ji.job.startedAt) ji.job.startedAt = Date.now()
  if (status === 'done' || status === 'error') ji.job.finishedAt = Date.now()
  persist(ji.job, ji.log)
  emitUpdate()
}

// Suy "bước hiện tại" từ nội dung dòng log. Khớp với log của script TikTok mặc định.
// 0=Mở 1=Chọn video 2=Upload 3=Check 4=Đăng
const STAGE_PATTERNS: Array<[RegExp, number]> = [
  [/Khởi động trình duyệt/i, 0],
  [/Video:/i, 1],
  [/tải.*lên/i, 2],
  [/Kiểm tra/i, 3],
  [/Đăng xong/i, 4]
]

/** Cập nhật stage + currentVideo của job từ 1 dòng log. Trả về true nếu có thay đổi. */
function applyStage(ji: JobInternal, line: string): boolean {
  let changed = false
  const m = line.match(/Video:\s*(.+?)\s*$/i)
  if (m && ji.job.currentVideo !== m[1]) {
    ji.job.currentVideo = m[1]
    changed = true
  }
  let stage: number | null = null
  for (const [re, idx] of STAGE_PATTERNS) {
    if (re.test(line)) stage = stage === null ? idx : Math.max(stage, idx)
  }
  if (stage !== null && stage !== ji.job.stage) {
    ji.job.stage = stage
    changed = true
  }
  return changed
}

function appendLog(ji: JobInternal, line: string): void {
  const stamped = `[${new Date().toLocaleTimeString()}] ${line}`
  ji.log.push(stamped)
  queueEvents.emit('log', ji.job.id, stamped)
  if (applyStage(ji, line)) emitUpdate()
}

function clampConcurrency(n: unknown): number {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return 5
  return Math.min(MAX_CONCURRENCY_LIMIT, Math.max(MIN_CONCURRENCY, v))
}

function runningCount(): number {
  return [...jobs.values()].filter((j) => j.job.status === 'running').length
}

function pump(): void {
  if (paused) return
  while (runningCount() < maxConcurrency) {
    const next = [...jobs.values()].find((j) => j.job.status === 'queued')
    if (!next) break
    start(next)
  }
}

function start(ji: JobInternal): void {
  const profile = ProfileStore.get(ji.job.profileId)
  const template = TemplateStore.get(ji.job.templateId)
  if (!profile || !template) {
    setStatus(ji, 'error', 'Thiếu profile hoặc template')
    return
  }
  ji.job.stage = 0
  ji.job.currentVideo = null
  setStatus(ji, 'running')
  const { promise, handle } = runJob(
    profile,
    template,
    (line) => appendLog(ji, line),
    (pct) => {
      ji.job.progress = pct
      emitUpdate()
    }
  )
  ji.handle = handle
  promise
    .then(() => {
      ji.job.progress = 100
      setStatus(ji, 'done')
    })
    .catch((e: unknown) => {
      const msg = errStr(e)
      appendLog(ji, '✕ ' + msg)
      setStatus(ji, 'error', msg)
    })
    .finally(() => {
      ji.handle = undefined
      pump()
    })
}

export const QueueManager = {
  init(): void {
    const s = getDb().prepare('SELECT max_concurrency FROM queue_settings WHERE id = 1').get() as
      | { max_concurrency: number }
      | undefined
    if (s) maxConcurrency = clampConcurrency(s.max_concurrency)

    // Load persisted jobs; mark interrupted 'running' as error.
    const rows = getDb().prepare('SELECT * FROM jobs ORDER BY created_at').all() as any[]
    for (const r of rows) {
      const job: Job = {
        id: r.id,
        templateId: r.template_id,
        templateName: TemplateStore.get(r.template_id)?.name ?? '(đã xóa)',
        profileId: r.profile_id,
        profileName: ProfileStore.get(r.profile_id)?.name ?? '(đã xóa)',
        status: r.status === 'running' ? 'error' : r.status,
        error: r.status === 'running' ? 'gián đoạn khi tắt app' : r.error,
        progress: r.status === 'done' ? 100 : 0,
        stage: r.status === 'done' ? JOB_STAGES.length - 1 : 0,
        currentVideo: null,
        createdAt: r.created_at,
        startedAt: r.started_at,
        finishedAt: r.finished_at
      }
      jobs.set(job.id, { job, log: r.log ? String(r.log).split('\n') : [] })
    }
  },

  list(): Job[] {
    return [...jobs.values()].map((j) => j.job).sort((a, b) => b.createdAt - a.createdAt)
  },

  state(): QueueState {
    return { paused, maxConcurrency, maxConcurrencyLimit: MAX_CONCURRENCY_LIMIT }
  },

  /**
   * Đổi số luồng. Kẹp vào [1, 10] ngay tại đây chứ không tin giao diện — IPC là
   * ranh giới, và một số 0 lọt qua sẽ làm hàng đợi đứng im mà không báo gì.
   *
   * HẠ số luồng KHÔNG dừng job đang chạy: dừng giữa chừng là bỏ dở một phiên
   * trình duyệt đã mở, tốn công hơn là để nó chạy nốt. Số dư sẽ tự về đúng khi
   * mấy job đó xong, vì pump() chỉ khởi động thêm khi còn chỗ trống.
   */
  setMaxConcurrency(n: number): number {
    maxConcurrency = clampConcurrency(n)
    getDb().prepare('UPDATE queue_settings SET max_concurrency = ? WHERE id = 1').run(maxConcurrency)
    emitUpdate()
    pump() // nới số luồng thì job đang chờ được chạy ngay, khỏi đợi job nào xong
    return maxConcurrency
  },

  enqueue(templateId: string, profileIds: string[]): void {
    const template = TemplateStore.get(templateId)
    for (const profileId of profileIds) {
      const profile = ProfileStore.get(profileId)
      const job: Job = {
        id: randomUUID(),
        templateId,
        templateName: template?.name ?? '(đã xóa)',
        profileId,
        profileName: profile?.name ?? '(đã xóa)',
        status: 'queued',
        error: null,
        progress: 0,
        stage: 0,
        currentVideo: null,
        createdAt: Date.now(),
        startedAt: null,
        finishedAt: null
      }
      const ji: JobInternal = { job, log: [] }
      jobs.set(job.id, ji)
      persist(job, [])
    }
    emitUpdate()
    pump()
  },

  jobLog(id: string): string[] {
    return jobs.get(id)?.log ?? []
  },

  cancel(id: string): void {
    const ji = jobs.get(id)
    if (!ji) return
    if (ji.job.status === 'running') {
      appendLog(ji, '⏹ Đã yêu cầu dừng')
      ji.handle?.cancel()
    } else if (ji.job.status === 'queued') {
      jobs.delete(id)
      getDb().prepare('DELETE FROM jobs WHERE id = ?').run(id)
      emitUpdate()
    }
  },

  retry(id: string): void {
    const ji = jobs.get(id)
    if (!ji || ji.job.status === 'running') return
    ji.job.error = null
    ji.job.progress = 0
    ji.job.startedAt = null
    ji.job.finishedAt = null
    ji.log = []
    setStatus(ji, 'queued')
    pump()
  },

  /**
   * Đưa MỌI job đang lỗi về hàng chờ. Trả về số job đã đưa về.
   *
   * Gom thành một lệnh thay vì để giao diện gọi retry() từng cái: retry() kết
   * thúc bằng pump(), nên n job lỗi thành n lượt pump và n lần đẩy sự kiện về
   * renderer — bảng nháy liên tục, và với vài chục job thì thấy rõ giật. Ở đây
   * đổi trạng thái hết rồi mới pump đúng một lần.
   *
   * Bỏ qua job đang chạy, giống retry(): job đang chạy không phải job lỗi, và
   * dựng lại trạng thái của nó giữa chừng sẽ đá nó ra khỏi vòng đang xử lý.
   */
  retryErrors(): number {
    let n = 0
    for (const ji of jobs.values()) {
      if (ji.job.status !== 'error') continue
      ji.job.error = null
      ji.job.progress = 0
      ji.job.startedAt = null
      ji.job.finishedAt = null
      ji.log = []
      setStatus(ji, 'queued')
      n++
    }
    if (n) pump()
    return n
  },

  clearDone(): void {
    for (const [id, ji] of jobs) {
      if (ji.job.status === 'done' || ji.job.status === 'error') {
        jobs.delete(id)
        getDb().prepare('DELETE FROM jobs WHERE id = ?').run(id)
      }
    }
    emitUpdate()
  },

  setPaused(p: boolean): void {
    paused = p
    emitUpdate()
    if (!p) pump()
  }
}
