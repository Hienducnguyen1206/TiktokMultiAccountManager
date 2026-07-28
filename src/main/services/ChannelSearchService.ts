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
      subs: stats.hiddenSubscriberCount ? null : (stats.subscriberCount != null ? parseInt(stats.subscriberCount) || 0 : null),
      videoCount: stats.videoCount != null ? parseInt(stats.videoCount) || 0 : null,
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
