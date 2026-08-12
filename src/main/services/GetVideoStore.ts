import { randomUUID } from 'crypto'
import { getDb } from '../db'
import type { GvChannel, GvFileNamePart, GvSettings, GvSource } from '@shared/types'

/**
 * Đúng bốn mảnh mà extension nhận. Thứ tự ở đây CŨNG LÀ thứ tự ghép tên file:
 * app bấm chọn theo đúng dãy này, mà ô đó là dropdown chọn-nhiều nên giá trị
 * xếp theo thứ tự bấm.
 *
 * 'title' đứng đầu vì tên file phải đọc ra được nội dung video — Template lấy
 * chính tên file làm caption lúc đăng.
 */
const FILE_NAME_PARTS: GvFileNamePart[] = ['title', 'id', 'timestamp', 'numericalOrder']

/** Hai mảnh bắt buộc, người dùng không tắt được. */
const REQUIRED_PARTS: GvFileNamePart[] = ['title', 'id']

/**
 * Đọc cấu hình tên file từ DB và ép về dạng hợp lệ.
 *
 * Luôn có 'title' và 'id'. Tiêu đề vì đó là thứ Template đọc làm caption; mã
 * video vì tên file là chỗ DUY NHẤT còn mang mã sau khi extension tải xong —
 * bỏ đi thì app không biết video nào đã lấy rồi, lần sau tải lại từ đầu, và hai
 * video khác nhau trùng tiêu đề sẽ bị coi là một.
 */
function normalizeFileNameFormat(raw: unknown): GvFileNamePart[] {
  const want = String(raw ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter((x): x is GvFileNamePart => (FILE_NAME_PARTS as string[]).includes(x))
  for (const need of REQUIRED_PARTS) if (!want.includes(need)) want.push(need)
  // Giữ theo thứ tự chuẩn để tên file của hai lượt chạy không đảo mảnh.
  return FILE_NAME_PARTS.filter((p) => want.includes(p))
}

interface ChannelRow {
  id: string
  source: string
  url: string
  name: string
  avatar: string
  following: number
  last_crawl: number | null
  fetched: number
  created_at: number
}

function rowToChannel(r: ChannelRow): GvChannel {
  return {
    id: r.id,
    // Hang tao truoc khi co cot nay deu la YouTube — cot co DEFAULT 'youtube'
    // nen thuc te khong bao gio rong, van do mot lan cho chac.
    source: (r.source || 'youtube') as GvSource,
    url: r.url,
    name: r.name,
    avatar: r.avatar,
    following: r.following === 1,
    lastCrawl: r.last_crawl,
    fetched: r.fetched,
    createdAt: r.created_at
  }
}

export const GetVideoStore = {
  /** Danh sach channel cua MOT nguon. Bon tab khong bao gio thay danh sach cua nhau. */
  listChannels(source: GvSource): GvChannel[] {
    const rows = getDb()
      .prepare('SELECT * FROM gv_channels WHERE source = ? ORDER BY created_at DESC')
      .all(source) as ChannelRow[]
    return rows.map(rowToChannel)
  },

  getChannel(id: string): GvChannel | null {
    const r = getDb().prepare('SELECT * FROM gv_channels WHERE id = ?').get(id) as ChannelRow | undefined
    return r ? rowToChannel(r) : null
  },

  addChannel(source: GvSource, url: string): GvChannel {
    const id = randomUUID()
    getDb()
      .prepare(
        'INSERT INTO gv_channels (id, source, url, name, following, fetched, created_at) VALUES (?, ?, ?, ?, 0, 0, ?)'
      )
      .run(id, source, url.trim(), '', Date.now())
    return this.getChannel(id)!
  },

  removeChannel(id: string): void {
    getDb().prepare('DELETE FROM gv_channels WHERE id = ?').run(id)
  },

  setName(id: string, name: string): void {
    getDb().prepare('UPDATE gv_channels SET name = ? WHERE id = ?').run(name, id)
  },

  /** Ghi tên + avatar lấy từ yt-dlp. Field rỗng thì giữ giá trị cũ, không xóa đè. */
  setMeta(id: string, name: string, avatar: string): void {
    getDb()
      .prepare(
        `UPDATE gv_channels
         SET name = CASE WHEN ? <> '' THEN ? ELSE name END,
             avatar = CASE WHEN ? <> '' THEN ? ELSE avatar END
         WHERE id = ?`
      )
      .run(name, name, avatar, avatar, id)
  },

  /** Channel chưa có avatar — dùng để bổ sung dần cho dữ liệu tạo trước khi có cột này. */
  channelsMissingAvatar(): GvChannel[] {
    const rows = getDb()
      .prepare("SELECT * FROM gv_channels WHERE avatar = '' ORDER BY created_at DESC")
      .all() as ChannelRow[]
    return rows.map(rowToChannel)
  },

  markCrawled(id: string, addedCount: number): void {
    getDb()
      .prepare('UPDATE gv_channels SET last_crawl = ?, fetched = fetched + ? WHERE id = ?')
      .run(Date.now(), addedCount, id)
  },

  // ---- downloaded (chống trùng) ----
  isDownloaded(videoId: string): boolean {
    return !!getDb().prepare('SELECT 1 FROM gv_downloaded WHERE video_id = ?').get(videoId)
  },

  markDownloaded(videoId: string, channelId: string | null, title: string, url = ''): void {
    getDb()
      .prepare(
        'INSERT OR IGNORE INTO gv_downloaded (video_id, channel_id, title, url, downloaded_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(videoId, channelId, title, url, Date.now())
  },

  // ---- settings ----
  getSettings(): GvSettings {
    const r = getDb().prepare('SELECT * FROM gv_settings WHERE id = 1').get() as any
    return {
      pendingDir: r.pending_dir,
      backfillMode: r.backfill_mode,
      backfillHours: r.backfill_hours,
      backfillCount: r.backfill_count,
      maxDuration: r.max_duration,
      nameByTitle: r.name_by_title === 1,
      concurrency: r.concurrency,
      wsPort: r.ws_port,
      cookieBrowser: r.cookie_browser ?? '',
      cookieProfileId: r.cookie_profile_id ?? '',
      extFileNameFormat: normalizeFileNameFormat(r.ext_file_name_format),
      extConcurrency: r.ext_concurrency ?? 5,
      extDelaySeconds: r.ext_delay_seconds ?? 5
    }
  },

  /**
   * Ghi cài đặt. Nhận VÁ TỪNG PHẦN: khoá nào không có thì giữ nguyên giá trị
   * trong DB.
   *
   * Cần merge chứ không ghi đè cả cụm vì hai màn hình cùng sửa bảng này — cột
   * Cài đặt trong tab Tải video, và mục Cookie trong tab Cài đặt. Mỗi bên đọc
   * một bản chụp lúc mở; ghi nguyên cụm thì bên bấm Lưu sau sẽ đè giá trị cũ nó
   * đang cầm lên thứ bên kia vừa đổi.
   */
  saveSettings(patch: Partial<GvSettings>): GvSettings {
    const s: GvSettings = { ...this.getSettings(), ...patch }
    getDb()
      .prepare(
        `UPDATE gv_settings SET
           pending_dir = @pending_dir,
           backfill_mode = @backfill_mode,
           backfill_hours = @backfill_hours,
           backfill_count = @backfill_count,
           max_duration = @max_duration,
           name_by_title = @name_by_title,
           concurrency = @concurrency,
           ws_port = @ws_port,
           cookie_browser = @cookie_browser,
           cookie_profile_id = @cookie_profile_id,
           ext_file_name_format = @ext_file_name_format,
           ext_concurrency = @ext_concurrency,
           ext_delay_seconds = @ext_delay_seconds
         WHERE id = 1`
      )
      .run({
        pending_dir: s.pendingDir,
        backfill_mode: s.backfillMode,
        backfill_hours: s.backfillHours,
        backfill_count: s.backfillCount,
        max_duration: s.maxDuration,
        name_by_title: s.nameByTitle ? 1 : 0,
        concurrency: s.concurrency,
        ws_port: s.wsPort,
        cookie_browser: s.cookieBrowser ?? '',
        cookie_profile_id: s.cookieProfileId ?? '',
        ext_file_name_format: normalizeFileNameFormat(s.extFileNameFormat?.join(',')).join(','),
        // Chặn số vô lý ngay ở cửa DB: extension nhận InputNumber min=1, đưa 0
        // hay số âm sang là form của nó báo lỗi và không chạy.
        ext_concurrency: Math.max(1, Math.min(20, Number(s.extConcurrency) || 5)),
        ext_delay_seconds: Math.max(0, Math.min(600, Number(s.extDelaySeconds) || 0))
      })
    return this.getSettings()
  }
}
