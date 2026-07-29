import { randomUUID } from 'crypto'
import { getDb } from '../db'
import type { CsCandidate, CsQuota, CsSearchResult, CsSettings, CsStatus, CsTiktokMatch } from '@shared/types'

/** Hạn mức quota YouTube Data API v3 mỗi ngày — mặc định Google cấp cho project mới. */
const DAILY_QUOTA = 10000

/** Ngày hiện tại theo múi giờ Thái Bình Dương — mốc Google dùng để reset quota.
 *  'en-CA' cho ra sẵn định dạng YYYY-MM-DD. */
function ptDay(at = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(at)
}

/** Epoch ms của 0h Thái Bình Dương kế tiếp. Ngày đổi giờ DST lệch ±1h — chấp nhận được
 *  vì chỗ này chỉ để hiện "reset sau bao lâu". */
function ptResetAt(at = Date.now()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(at)
  const [h, m, s] = parts.split(':').map(Number)
  // hour12:false vẫn trả "24" cho nửa đêm ở một số bản ICU → %24.
  const elapsed = ((h % 24) * 3600 + m * 60 + s) * 1000
  return at + (86_400_000 - elapsed)
}

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
    shortsCount: r.shorts_count,
    topics: r.topics ? (JSON.parse(r.topics) as string[]) : null,
    audienceLangs: r.audience_langs ? JSON.parse(r.audience_langs) : null,
    sampleVideos: null, // chỉ có ở kết quả tìm kiếm, không lưu DB
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
           shorts_count, topics, audience_langs, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`
      )
      .run(
        id, r.ytChannelId, r.url, r.name, r.handle, r.thumbnail,
        r.subs, r.videoCount, r.avgViews, r.lastUploadAt, r.uploadsPerWeek, r.country, r.ytCreatedAt,
        r.likeViewPct, r.commentViewPct, r.viewSubRatio, r.momentumPct, r.viewConsistency,
        r.shortsCount,
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
  },

  getQuota(): CsQuota {
    const r = getDb().prepare('SELECT units FROM cs_quota WHERE day = ?').get(ptDay()) as
      | { units: number }
      | undefined
    return {
      used: r?.units ?? 0,
      limit: DAILY_QUOTA,
      resetAt: ptResetAt(),
      hasKey: !!this.getSettings().apiKey
    }
  },

  /** Cộng số unit vừa tiêu vào ngày hiện tại. Giữ lại lịch sử các ngày trước (1 dòng/ngày). */
  addQuota(units: number): void {
    if (units <= 0) return
    getDb()
      .prepare(
        `INSERT INTO cs_quota (day, units) VALUES (?, ?)
         ON CONFLICT(day) DO UPDATE SET units = units + excluded.units`
      )
      .run(ptDay(), units)
  }
}
