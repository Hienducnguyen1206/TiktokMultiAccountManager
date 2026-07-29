import { randomUUID } from 'crypto'
import { getDb } from '../db'
import type { GvChannel, GvSettings } from '@shared/types'

interface ChannelRow {
  id: string
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
  listChannels(): GvChannel[] {
    const rows = getDb().prepare('SELECT * FROM gv_channels ORDER BY created_at DESC').all() as ChannelRow[]
    return rows.map(rowToChannel)
  },

  getChannel(id: string): GvChannel | null {
    const r = getDb().prepare('SELECT * FROM gv_channels WHERE id = ?').get(id) as ChannelRow | undefined
    return r ? rowToChannel(r) : null
  },

  addChannel(url: string): GvChannel {
    const id = randomUUID()
    getDb()
      .prepare('INSERT INTO gv_channels (id, url, name, following, fetched, created_at) VALUES (?, ?, ?, 0, 0, ?)')
      .run(id, url.trim(), '', Date.now())
    return this.getChannel(id)!
  },

  removeChannel(id: string): void {
    getDb().prepare('DELETE FROM gv_channels WHERE id = ?').run(id)
  },

  setFollowing(id: string, following: boolean): void {
    getDb().prepare('UPDATE gv_channels SET following = ? WHERE id = ?').run(following ? 1 : 0, id)
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

  /** Channel đang theo dõi realtime — dùng để lọc push (whitelist). */
  followingChannels(): GvChannel[] {
    const rows = getDb().prepare('SELECT * FROM gv_channels WHERE following = 1').all() as ChannelRow[]
    return rows.map(rowToChannel)
  },

  // ---- downloaded (chống trùng) ----
  isDownloaded(videoId: string): boolean {
    return !!getDb().prepare('SELECT 1 FROM gv_downloaded WHERE video_id = ?').get(videoId)
  },

  markDownloaded(videoId: string, channelId: string | null, title: string): void {
    getDb()
      .prepare('INSERT OR IGNORE INTO gv_downloaded (video_id, channel_id, title, downloaded_at) VALUES (?, ?, ?, ?)')
      .run(videoId, channelId, title, Date.now())
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
      cookieBrowser: r.cookie_browser ?? ''
    }
  },

  saveSettings(s: GvSettings): GvSettings {
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
           cookie_browser = @cookie_browser
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
        cookie_browser: s.cookieBrowser ?? ''
      })
    return this.getSettings()
  }
}
