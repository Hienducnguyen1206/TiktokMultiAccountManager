import { EventEmitter } from 'events'
import { franc } from 'franc-min'
import { spawn } from 'child_process'
import { ChannelSearchStore } from './ChannelSearchStore'
import { ensureYtDlp } from './YtDlpManager'
import { GetVideoStore } from './GetVideoStore'
import type { CsSearchParams, CsSearchResult } from '@shared/types'
import type { CsLangPct } from '@shared/types'

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

export async function searchChannels(params: CsSearchParams): Promise<CsSearchResult[]> {
  const s = ChannelSearchStore.getSettings()
  if (!s.apiKey) return ytDlpSearch(params)
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
