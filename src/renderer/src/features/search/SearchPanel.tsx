import { useEffect, useMemo, useState } from 'react'
import { showToast } from '../../components/uiDialogs'
import { CsSprite, Ic, Flag } from './CsIcons'
import type { CsSearchParams, CsSearchResult } from '@shared/types'

const EMPTY_PARAMS: CsSearchParams = {
  keyword: '', limit: 20,
  subsMin: null, subsMax: null, country: null, ageMinDays: null, ageMaxDays: null,
  topicsAny: [], uploadsPerWeekMin: null, lastUploadWithinDays: null, shortsCountMin: null,
  durationMaxSec: null, avgViewsMin: null, likeViewPctMin: null, commentViewPctMin: null,
  viewSubRatioMin: null, momentumPctMin: null, viewConsistencyMin: null,
  audienceLang: null, audienceLangPctMin: 50
}

/** Chủ đề: tên chip PHẢI đúng từng chữ với tên topic thật YouTube trả về (URL Wikipedia
 * trong topicDetails decode ra) — vd 'Film' chứ không phải 'Movies', 'Sport' chứ không
 * 'Sports', 'Pet'/'Vehicle' số ít. Sai một chữ là chip đó KHÔNG BAO GIỜ khớp kênh nào
 * (đã dính: 6 chip chết vì đặt tên theo cảm tính). Kiểm bằng kênh thật trước khi thêm. */
const TOPIC_GROUPS: { label: string; items: { name: string; c: string; icon: string }[] }[] = [
  {
    label: '🎵 Music',
    items: [
      { name: 'Music', c: '#e879f9', icon: 'i-music' },
      { name: 'Pop music', c: '#f472b6', icon: 'i-music' },
      { name: 'Rock music', c: '#f87171', icon: 'i-music' },
      { name: 'Hip hop music', c: '#818cf8', icon: 'i-music' },
      { name: 'Electronic music', c: '#22d3ee', icon: 'i-music' }
    ]
  },
  {
    label: '🎮 Gaming',
    items: [
      { name: 'Video game culture', c: '#818cf8', icon: 'i-gamepad' },
      { name: 'Action game', c: '#60a5fa', icon: 'i-gamepad' },
      { name: 'Role-playing video game', c: '#a78bfa', icon: 'i-gamepad' },
      { name: 'Strategy video game', c: '#38bdf8', icon: 'i-gamepad' }
    ]
  },
  {
    label: '⚽ Sports',
    items: [
      { name: 'Sport', c: '#a3e635', icon: 'i-ball' },
      { name: 'Football', c: '#34d399', icon: 'i-ball' },
      { name: 'Basketball', c: '#fb923c', icon: 'i-ball' },
      { name: 'American football', c: '#f87171', icon: 'i-ball' }
    ]
  },
  {
    label: '🎭 Entertainment',
    items: [
      { name: 'Entertainment', c: '#c084fc', icon: 'i-tv' },
      { name: 'Humour', c: '#fbbf24', icon: 'i-laugh' },
      { name: 'Film', c: '#a78bfa', icon: 'i-clap' },
      { name: 'Television program', c: '#22d3ee', icon: 'i-tv' }
    ]
  },
  {
    label: '🌿 Lifestyle',
    items: [
      { name: 'Fashion', c: '#fb7185', icon: 'i-flower' },
      { name: 'Food', c: '#fb923c', icon: 'i-food' },
      { name: 'Fitness', c: '#f87171', icon: 'i-dumbbell' },
      { name: 'Pet', c: '#34d399', icon: 'i-paw' },
      { name: 'Vehicle', c: '#60a5fa', icon: 'i-car' },
      { name: 'Technology', c: '#22d3ee', icon: 'i-cpu' },
      { name: 'Tourism', c: '#2dd4bf', icon: 'i-plane' }
    ]
  },
  {
    label: '🏛️ Society',
    items: [
      { name: 'Politics', c: '#94a3b8', icon: 'i-landmark' },
      { name: 'Business', c: '#60a5fa', icon: 'i-briefcase' },
      { name: 'Health', c: '#fb7185', icon: 'i-heart' },
      { name: 'Knowledge', c: '#60a5fa', icon: 'i-grad' }
    ]
  }
]

const TP_COLORS = ['#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#38bdf8', '#a3e635', '#e879f9', '#fb923c', '#22d3ee', '#2dd4bf', '#60a5fa', '#c084fc']

/** Icon chọn được cho chủ đề tự thêm (bỏ các icon chỉ dùng cho giao diện). */
const TOPIC_ICONS = [
  'i-tag', 'i-music', 'i-gamepad', 'i-ball', 'i-tv', 'i-laugh', 'i-clap', 'i-flower',
  'i-food', 'i-dumbbell', 'i-paw', 'i-car', 'i-cpu', 'i-plane', 'i-landmark',
  'i-briefcase', 'i-heart', 'i-grad', 'i-globe', 'i-zap', 'i-trend'
]

const COUNTRIES = ['US', 'GB', 'VN', 'JP', 'KR', 'IN', 'BR', 'ID', 'TH', 'PH', 'MX', 'DE', 'FR']

/** Ngôn ngữ khán giả — `flag` chỉ để nhận diện nhanh, không phải "ngôn ngữ của nước đó". */
const LANGS = [
  { code: 'en', label: 'EN', flag: 'US' }, { code: 'vi', label: 'VI', flag: 'VN' },
  { code: 'es', label: 'ES', flag: 'ES' }, { code: 'pt', label: 'PT', flag: 'PT' },
  { code: 'ja', label: 'JA', flag: 'JP' }, { code: 'ko', label: 'KO', flag: 'KR' },
  { code: 'th', label: 'TH', flag: 'TH' }, { code: 'id', label: 'ID', flag: 'ID' },
  { code: 'de', label: 'DE', flag: 'DE' }, { code: 'fr', label: 'FR', flag: 'FR' },
  { code: 'ru', label: 'RU', flag: 'RU' }
]

function fmt(n: number | null): string {
  if (n === null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

/** Như fmt nhưng bỏ đuôi ".0" — để ô đã nhập "10K" hiện lại đúng "10K", không thành "10.0K". */
function fmtShort(n: number): string {
  return fmt(n).replace('.0', '')
}

/** Nhập được cả "10K" / "1.5M" như hiển thị trên thiết kế, lẫn số thường. */
function parseNum(s: string): number | null {
  const t = s.trim().toUpperCase()
  if (!t) return null
  const m = /^([\d.]+)\s*([KM]?)$/.exec(t)
  if (!m) return null
  const n = parseFloat(m[1])
  if (!isFinite(n)) return null
  return Math.round(n * (m[2] === 'M' ? 1_000_000 : m[2] === 'K' ? 1_000 : 1))
}

function fmtDate(ts: number | null): string {
  return ts === null ? '—' : new Date(ts).toLocaleDateString('vi-VN', { month: '2-digit', year: 'numeric' })
}

function daysSince(ts: number | null): number | null {
  return ts === null ? null : Math.floor((Date.now() - ts) / 86_400_000)
}

/** "Hôm nay" / "Hôm qua" / "N ngày" — đúng như thiết kế. */
function fmtLastUpload(ts: number | null): string {
  const d = daysSince(ts)
  if (d === null) return '—'
  if (d <= 0) return 'Hôm nay'
  if (d === 1) return 'Hôm qua'
  return `${d} ngày`
}

function fmtDur(sec: number): string {
  const m = Math.floor(sec / 60)
  return `${m}:${String(sec % 60).padStart(2, '0')}`
}

/**
 * Điểm đáng làm (0–100): tổng hợp momentum + độ ổn định + số Shorts + tần suất đăng,
 * đúng 4 yếu tố thiết kế ghi trên cột "Điểm". Chỉ số nào thiếu thì bỏ khỏi phép tính
 * và chia lại theo trọng số còn lại, để kênh thiếu dữ liệu không bị dìm điểm oan.
 */
function scoreOf(r: CsSearchResult): number | null {
  const parts: { v: number; w: number }[] = []
  const clamp01 = (x: number): number => Math.max(0, Math.min(1, x))
  if (r.momentumPct !== null) parts.push({ v: clamp01((r.momentumPct + 50) / 200), w: 35 })
  if (r.viewConsistency !== null) parts.push({ v: clamp01(r.viewConsistency), w: 25 })
  if (r.shortsCount !== null) parts.push({ v: clamp01(r.shortsCount / 300), w: 20 })
  if (r.uploadsPerWeek !== null) parts.push({ v: clamp01(r.uploadsPerWeek / 7), w: 20 })
  if (!parts.length) return null
  const totalW = parts.reduce((a, p) => a + p.w, 0)
  return Math.round((parts.reduce((a, p) => a + p.v * p.w, 0) / totalW) * 100)
}

function scoreClass(s: number): string {
  return s >= 80 ? 's-hi' : s >= 55 ? 's-mid' : 's-lo'
}

type SortKey = 'score' | 'subs' | 'views' | 'momentum' | 'shorts' | 'days'
type SortDir = 'asc' | 'desc'

const SORT_DEFAULT_DIR: Record<SortKey, SortDir> = {
  score: 'desc', subs: 'desc', views: 'desc', momentum: 'desc', shorts: 'desc', days: 'asc'
}
const SORT_COLS: { key: SortKey; label: string }[] = [
  { key: 'score', label: 'Điểm' },
  { key: 'subs', label: 'Sub' },
  { key: 'views', label: 'View TB' },
  { key: 'momentum', label: 'Momentum' },
  { key: 'shorts', label: 'Short' },
  { key: 'days', label: 'Đăng cuối' }
]

interface Row extends CsSearchResult {
  _score: number | null
  _days: number | null
}

function sortValue(r: Row, k: SortKey): number | null {
  switch (k) {
    case 'score': return r._score
    case 'subs': return r.subs
    case 'views': return r.avgViews
    case 'momentum': return r.momentumPct
    case 'shorts': return r.shortsCount
    case 'days': return r._days
  }
}

/** Kết quả check TikTok của 1 dòng: null = chưa check. */
interface TkState {
  found: boolean
  username: string
}

/** Ô nhập số trong panel bộ lọc — rỗng = không áp dụng. */
function FInput({
  value, onChange, width, asText
}: {
  value: number | null
  onChange: (v: number | null) => void
  width?: number
  asText?: boolean
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (value === null ? '' : asText ? fmtShort(value) : String(value))
  return (
    <input
      className={value !== null ? 'on' : ''}
      style={width ? { width } : undefined}
      placeholder="—"
      value={shown}
      onChange={(e) => {
        setDraft(e.target.value)
        onChange(asText ? parseNum(e.target.value) : e.target.value === '' ? null : Number(e.target.value))
      }}
      onBlur={() => setDraft(null)}
    />
  )
}

/**
 * Trạng thái tab, giữ đến lần tìm kế tiếp hoặc khi đóng app.
 *
 * Phải để ở cấp module chứ không phải state React: App.tsx bọc tab bằng key={tab}
 * để chạy lại animation, nên mỗi lần đổi tab là SearchPanel bị unmount và state
 * biến mất. Biến module sống theo vòng đời renderer → đúng "mất khi đóng app".
 * Cố ý KHÔNG ghi DB: yêu cầu là không giữ qua các lần mở app.
 */
interface SessionState {
  params: CsSearchParams
  results: CsSearchResult[]
  searched: boolean
  showFilters: boolean
  sortState: { key: SortKey; dir: SortDir }[]
  openRows: Set<string>
  tk: Map<string, TkState>
  added: Set<string>
  customTopics: { name: string; c: string; icon: string }[]
}

const session: SessionState = {
  params: EMPTY_PARAMS,
  results: [],
  searched: false,
  showFilters: true,
  sortState: [{ key: 'score', dir: 'desc' }],
  openRows: new Set(),
  tk: new Map(),
  added: new Set(),
  customTopics: []
}

/**
 * Lượt tìm đang chạy. Việc tìm nằm ở main nên đổi tab không hề hủy nó; thứ hỏng là
 * phía renderer — component unmount thì setState thành no-op và quay lại tab sẽ thấy
 * màn hình trống như chưa từng bấm tìm. Giữ promise ở cấp module để lần mount sau
 * bám tiếp vào đúng lượt đó.
 */
let inFlight: Promise<void> | null = null
/** Lỗi của lượt tìm vừa xong, để chỗ nào mount cũng báo được đúng một lần. */
let lastError: string | null = null

export function SearchPanel(): JSX.Element {
  const [params, setParams] = useState<CsSearchParams>(session.params)
  const [showFilters, setShowFilters] = useState(session.showFilters)
  const [results, setResults] = useState<CsSearchResult[]>(session.results)
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(session.searched)
  const [openRows, setOpenRows] = useState<Set<string>>(session.openRows)
  const [tk, setTk] = useState<Map<string, TkState>>(session.tk)
  const [checking, setChecking] = useState<string | null>(null)
  const [added, setAdded] = useState<Set<string>>(session.added)
  const [sortState, setSortState] = useState<{ key: SortKey; dir: SortDir }[]>(session.sortState)
  const [customTopics, setCustomTopics] = useState<{ name: string; c: string; icon: string }[]>(session.customTopics)
  const [addTopicOpen, setAddTopicOpen] = useState(false)
  const [newTopicName, setNewTopicName] = useState('')
  const [newTopicIcon, setNewTopicIcon] = useState('i-tag')
  const [addCountryOpen, setAddCountryOpen] = useState(false)

  // Quay lại tab giữa lúc đang tìm → bám tiếp vào lượt đang chạy: hiện lại spinner
  // và đổ kết quả khi nó xong, thay vì đứng im ở màn hình trống.
  useEffect(() => {
    if (!inFlight) return
    setLoading(true)
    inFlight.then(syncAfterSearch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Ghi ngược ra biến module sau mỗi lần đổi để lần mount sau đọc lại được.
  // `loading` không lưu vào session: nó suy từ inFlight ở effect trên, lưu thêm chỉ
  // tổ kẹt spinner nếu lượt tìm kết thúc lúc component đang unmount.
  useEffect(() => {
    session.params = params
    session.results = results
    session.searched = searched
    session.showFilters = showFilters
    session.sortState = sortState
    session.openRows = openRows
    session.tk = tk
    session.added = added
    session.customTopics = customTopics
  }, [params, results, searched, showFilters, sortState, openRows, tk, added, customTopics])

  const patch = (p: Partial<CsSearchParams>): void => setParams((c) => ({ ...c, ...p }))

  const toggleIn = (list: string[], v: string): string[] =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v]

  // ── số filter đang bật (hiện trên nút Bộ lọc nâng cao) ──
  const activeCount = useMemo(() => {
    let n = 0
    const p = params
    if (p.topicsAny.length) n++
    if (p.subsMin !== null || p.subsMax !== null) n++
    if (p.ageMinDays !== null || p.ageMaxDays !== null) n++
    if (p.country) n++
    if (p.uploadsPerWeekMin !== null) n++
    if (p.lastUploadWithinDays !== null) n++
    if (p.shortsCountMin !== null) n++
    if (p.durationMaxSec !== null) n++
    if (p.avgViewsMin !== null) n++
    if (p.likeViewPctMin !== null) n++
    if (p.viewSubRatioMin !== null) n++
    if (p.momentumPctMin !== null) n++
    if (p.viewConsistencyMin !== null) n++
    if (p.audienceLang !== null) n++
    if (p.commentViewPctMin !== null) n++
    return n
  }, [params])

  // ── chip tóm tắt filter đang bật ──
  const chips = useMemo(() => {
    const p = params
    const out: { label: React.ReactNode; clear: Partial<CsSearchParams> }[] = []
    if (p.topicsAny.length) out.push({ label: p.topicsAny.join(' · '), clear: { topicsAny: [] } })
    if (p.subsMin !== null || p.subsMax !== null) {
      out.push({ label: `Sub ${p.subsMin === null ? '—' : fmt(p.subsMin)}–${p.subsMax === null ? '—' : fmt(p.subsMax)}`, clear: { subsMin: null, subsMax: null } })
    }
    if (p.ageMinDays !== null || p.ageMaxDays !== null) {
      out.push({ label: `Tuổi kênh ${p.ageMinDays ?? '—'}–${p.ageMaxDays ?? '—'} ngày`, clear: { ageMinDays: null, ageMaxDays: null } })
    }
    if (p.country) {
      out.push({
        label: (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Flag code={p.country} style={{ width: 16, height: 11 }} />
            {p.country}
          </span>
        ),
        clear: { country: null }
      })
    }
    if (p.uploadsPerWeekMin !== null) out.push({ label: `Video/tuần ≥ ${p.uploadsPerWeekMin}`, clear: { uploadsPerWeekMin: null } })
    if (p.lastUploadWithinDays !== null) out.push({ label: `Đăng ≤ ${p.lastUploadWithinDays} ngày`, clear: { lastUploadWithinDays: null } })
    if (p.shortsCountMin !== null) out.push({ label: `Số Shorts ≥ ${p.shortsCountMin}`, clear: { shortsCountMin: null } })
    if (p.durationMaxSec !== null) out.push({ label: `Thời lượng ≤ ${p.durationMaxSec}s`, clear: { durationMaxSec: null } })
    if (p.avgViewsMin !== null) out.push({ label: `View TB ≥ ${fmt(p.avgViewsMin)}`, clear: { avgViewsMin: null } })
    if (p.likeViewPctMin !== null) out.push({ label: `Like/view ≥ ${p.likeViewPctMin}%`, clear: { likeViewPctMin: null } })
    if (p.viewSubRatioMin !== null) out.push({ label: `View/sub ≥ ${p.viewSubRatioMin}`, clear: { viewSubRatioMin: null } })
    if (p.momentumPctMin !== null) out.push({ label: `Momentum ≥ ${p.momentumPctMin}%`, clear: { momentumPctMin: null } })
    if (p.viewConsistencyMin !== null) out.push({ label: `Ổn định ≥ ${p.viewConsistencyMin}`, clear: { viewConsistencyMin: null } })
    if (p.audienceLang !== null) out.push({ label: `Khán giả ${p.audienceLang.toUpperCase()} ≥ ${p.audienceLangPctMin}%`, clear: { audienceLang: null } })
    if (p.commentViewPctMin !== null) out.push({ label: `Comment/view ≥ ${p.commentViewPctMin}%`, clear: { commentViewPctMin: null } })
    return out
  }, [params])

  const rows = useMemo<Row[]>(
    () => results.map((r) => ({ ...r, _score: scoreOf(r), _days: daysSince(r.lastUploadAt) })),
    [results]
  )

  const sorted = useMemo(() => {
    const list = [...rows]
    list.sort((a, b) => {
      for (const s of sortState) {
        const va = sortValue(a, s.key)
        const vb = sortValue(b, s.key)
        // Kênh thiếu chỉ số luôn nằm cuối, bất kể đang sắp xếp chiều nào.
        if (va === null && vb === null) continue
        if (va === null) return 1
        if (vb === null) return -1
        if (va === vb) continue
        return s.dir === 'asc' ? va - vb : vb - va
      }
      return 0
    })
    return list
  }, [rows, sortState])

  /** Bấm cột: chưa sắp xếp → thêm (thành tiêu chí phụ) · đang chiều mặc định → đảo chiều · còn lại → bỏ. */
  const onSortClick = (key: SortKey): void => {
    setSortState((cur) => {
      const i = cur.findIndex((s) => s.key === key)
      if (i < 0) return [...cur, { key, dir: SORT_DEFAULT_DIR[key] }]
      if (cur[i].dir === SORT_DEFAULT_DIR[key]) {
        const next = [...cur]
        next[i] = { key, dir: SORT_DEFAULT_DIR[key] === 'desc' ? 'asc' : 'desc' }
        return next
      }
      return cur.filter((s) => s.key !== key)
    })
  }

  const search = async (): Promise<void> => {
    // Chặn theo inFlight chứ không theo `loading`: `loading` chết theo mount, bấm
    // Tìm lần nữa sau khi đổi tab sẽ chạy chồng 2 lượt và tiêu quota gấp đôi.
    if (inFlight) return
    // Không cần từ khóa nếu đã chọn chủ đề — main sẽ ghép chủ đề thành câu tìm.
    if (!params.keyword.trim() && params.topicsAny.length === 0) {
      showToast('Nhập từ khóa hoặc chọn ít nhất 1 chủ đề')
      return
    }
    setShowFilters(false)
    // Tìm lần mới → dọn kết quả lượt trước (đây là mốc "đến lần tìm kiếm tiếp theo").
    setSearched(true)
    setOpenRows(new Set())
    setTk(new Map())
    session.searched = true
    session.openRows = new Set()
    session.tk = new Map()
    lastError = null

    // Promise sống ở cấp module, chỉ ghi vào session — chạy tiếp bình thường dù
    // component đã unmount vì đổi tab.
    const job = window.hnv.channelSearch
      .search(params)
      .then((rows) => {
        session.results = rows
      })
      .catch((e: Error) => {
        session.results = []
        lastError = e.message
      })
    inFlight = job
    setLoading(true)
    await job
    inFlight = null
    syncAfterSearch()
  }

  /** Đổ kết quả từ session ra state + báo lỗi (nếu có). Dùng cho cả lượt tìm vừa
   *  xong lẫn lúc mount lại giữa chừng. */
  function syncAfterSearch(): void {
    setResults(session.results)
    setLoading(false)
    if (lastError) {
      showToast(lastError, 'error')
      lastError = null
    }
  }

  const toggleRow = (id: string): void =>
    setOpenRows((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  /** Check nhanh TikTok ngay trên dòng: nút xanh nếu có kênh trùng tên, đỏ nếu không. */
  const checkTikTok = async (r: CsSearchResult): Promise<void> => {
    if (checking || tk.has(r.ytChannelId)) return
    setChecking(r.ytChannelId)
    try {
      // checkTiktok nhận id ứng viên → lưu kênh trước (idempotent, trùng thì trả bản cũ).
      const { candidate } = await window.hnv.channelSearch.addCandidate(r)
      const matches = await window.hnv.channelSearch.checkTiktok(candidate.id)
      setTk((m) => new Map(m).set(r.ytChannelId, { found: matches.length > 0, username: matches[0]?.username ?? '' }))
      setOpenRows((s) => new Set(s).add(r.ytChannelId))
    } catch (e) {
      showToast((e as Error).message, 'error')
    } finally {
      setChecking(null)
    }
  }

  const addToGetVideo = async (r: CsSearchResult): Promise<void> => {
    if (added.has(r.ytChannelId)) return
    try {
      await window.hnv.getvideo.addChannel(r.url)
      setAdded((s) => new Set(s).add(r.ytChannelId))
      showToast(`Đã thêm "${r.name || r.ytChannelId}" vào Get Video`)
    } catch (e) {
      showToast((e as Error).message, 'error')
    }
  }

  /** Màu tự gán cho chủ đề sắp thêm — hiện luôn ở ô xem trước. */
  const nextTopicColor = TP_COLORS[customTopics.length % TP_COLORS.length]

  const closeAddTopic = (): void => {
    setAddTopicOpen(false)
    setNewTopicName('')
    setNewTopicIcon('i-tag')
  }

  const addTopic = (): void => {
    const name = newTopicName.trim()
    if (!name) return
    if (!customTopics.some((t) => t.name === name)) {
      setCustomTopics((c) => [...c, { name, c: TP_COLORS[c.length % TP_COLORS.length], icon: newTopicIcon }])
    }
    patch({ topicsAny: params.topicsAny.includes(name) ? params.topicsAny : [...params.topicsAny, name] })
    closeAddTopic()
  }

  const addCountry = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    const inp = e.currentTarget
    if (e.key === 'Escape') {
      setAddCountryOpen(false)
      return
    }
    if (e.key !== 'Enter' || !inp.value.trim()) return
    const code = inp.value.trim().toUpperCase()
    patch({ country: code })
    inp.value = ''
    setAddCountryOpen(false)
  }

  /** Xóa hẳn 1 chủ đề tự thêm (khác với bỏ chọn) — gỡ khỏi cả danh sách thẻ lẫn filter. */
  const removeCustomTopic = (name: string): void => {
    setCustomTopics((c) => c.filter((t) => t.name !== name))
    patch({ topicsAny: params.topicsAny.filter((t) => t !== name) })
  }

  const topicChip = (t: { name: string; c: string; icon?: string }, custom = false): JSX.Element => {
    const on = params.topicsAny.includes(t.name)
    return (
      <span
        key={t.name}
        className={`cs-tp${on ? ' on' : ''}`}
        style={{ ['--c' as string]: t.c } as React.CSSProperties}
        onClick={() => patch({ topicsAny: toggleIn(params.topicsAny, t.name) })}
      >
        <Ic id={t.icon ?? 'i-tag'} />
        {t.name}
        {custom && (
          <b
            className="cs-tpx"
            title="Xóa chủ đề này"
            onClick={(e) => { e.stopPropagation(); removeCustomTopic(t.name) }}
          >
            ✕
          </b>
        )}
      </span>
    )
  }

  return (
    <div className="cs-app">
      <CsSprite />

      {/* THANH SEARCH: keyword + số kết quả + toggle bộ lọc + nút Tìm — tất cả 1 hàng */}
      <div className="cs-searchrow">
        <input
          className="cs-kw"
          placeholder="Từ khóa / #hashtag — khớp TIÊU ĐỀ VIDEO, nhiều biến thể cách nhau dấu phẩy (bỏ trống nếu đã chọn chủ đề)"
          value={params.keyword}
          onChange={(e) => patch({ keyword: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && search()}
        />
        {/* >50 = lật thêm trang search.list, mỗi trang 100 unit — ghi rõ ở title */}
        <div className="cs-limitbox" title="Tối đa 200. Mỗi 50 = 1 trang video search.list = 100 unit. Tìm theo VIDEO rồi gom kênh nên số kênh cuối thường ít hơn (kênh khỏe chiếm nhiều video/trang).">
          <input
            className="cs-limitinp"
            type="number"
            min={1}
            max={200}
            value={params.limit}
            onChange={(e) => patch({ limit: Math.max(1, Math.min(200, Number(e.target.value) || 1)) })}
          />
          <span className="cs-limitlbl">Kết quả</span>
        </div>
        <button className="cs-ftoggle" onClick={() => setShowFilters(!showFilters)}>
          <span className={`cs-caret${showFilters ? '' : ' collapsed'}`}>▾</span> Bộ lọc nâng cao
          <span className={`n${activeCount === 0 ? ' empty' : ''}`}>{activeCount || 0}</span>
        </button>
        <button className="cs-btn-primary" onClick={search} disabled={loading}>
          Tìm kiếm
        </button>
      </div>

      {/* Chip tóm tắt filter đang bật */}
      <div className="cs-fbar">
        {chips.map((c, i) => (
          <span className="cs-chip" key={i}>
            {c.label} <b onClick={() => patch(c.clear)}>✕</b>
          </span>
        ))}
        {chips.length > 0 && (
          <span className="cs-clearall" onClick={() => setParams({ ...EMPTY_PARAMS, keyword: params.keyword, limit: params.limit })}>
            Xóa hết
          </span>
        )}
      </div>

      {/* FILTER PANEL — animation mở/đóng bằng grid-rows 0fr↔1fr */}
      <div className={`cs-fcollapse${showFilters ? ' open' : ''}`}>
        <div className="cs-fcollapse-inner">
          <div className="cs-fpanel">

            {/* Chủ đề: dùng đúng tên topic chính thức YouTube trả về */}
            <div className="cs-ftop">
              <div className="cs-ftophead">
                <h4 style={{ marginBottom: 0 }}>
                  <span className="cs-gico"><Ic id="i-tags" className="" /></span>
                  Chủ đề{' '}
                  <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400, color: '#7c7d8c' }}>
                    · topic chính thức YouTube
                  </span>
                </h4>
                <div className="cs-tpaddwrap">
                  <button className="cs-tpaddbtn" onClick={() => setAddTopicOpen(!addTopicOpen)}>
                    <Ic id="i-plus" style={{ width: 12, height: 12 }} />
                    Thêm chủ đề
                  </button>
                  {addTopicOpen && (
                    <div className="cs-tpadd">
                      <input
                        className="cs-tpadd-name"
                        autoFocus
                        placeholder="Tên chủ đề"
                        value={newTopicName}
                        onChange={(e) => setNewTopicName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') addTopic()
                          if (e.key === 'Escape') closeAddTopic()
                        }}
                      />
                      <div className="cs-tpadd-lbl">Chọn icon</div>
                      <div className="cs-tpadd-grid">
                        {TOPIC_ICONS.map((id) => (
                          <button
                            key={id}
                            className={`cs-tpadd-ic${newTopicIcon === id ? ' on' : ''}`}
                            title={id.slice(2)}
                            onClick={() => setNewTopicIcon(id)}
                          >
                            <Ic id={id} style={{ width: 17, height: 17 }} />
                          </button>
                        ))}
                      </div>
                      <div className="cs-tpadd-foot">
                        <span className="cs-tpadd-prev">
                          <span
                            className="cs-tp on"
                            style={{ ['--c' as string]: nextTopicColor } as React.CSSProperties}
                          >
                            <Ic id={newTopicIcon} />
                            {newTopicName.trim() || 'Xem trước'}
                          </span>
                        </span>
                        <button className="cs-tpadd-cancel" onClick={closeAddTopic}>Hủy</button>
                        <button className="cs-tpadd-ok" onClick={addTopic} disabled={!newTopicName.trim()}>Thêm</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="cs-tpgrid">
                {TOPIC_GROUPS.map((g) => (
                  <div className="cs-tpgroup" key={g.label}>
                    <div className="cs-tpglabel">{g.label}</div>
                    <div className="cs-topics">{g.items.map((t) => topicChip(t))}</div>
                  </div>
                ))}
                {customTopics.length > 0 && (
                  <div className="cs-tpgroup">
                    <div className="cs-tpglabel">➕ Tùy chỉnh</div>
                    <div className="cs-topics">{customTopics.map((t) => topicChip(t, true))}</div>
                  </div>
                )}
              </div>
            </div>

            <div className="cs-fgrid">
              {/* Quy mô */}
              <div className="cs-fg">
                <h4><span className="cs-gico"><Ic id="i-ruler" className="" /></span>Quy mô</h4>
                <div className="cs-fr">
                  <label>Subscriber</label>
                  <FInput value={params.subsMin} onChange={(v) => patch({ subsMin: v })} asText />
                  <span className="sep">–</span>
                  <FInput value={params.subsMax} onChange={(v) => patch({ subsMax: v })} asText />
                </div>
                <div className="cs-fr">
                  <label>Tuổi kênh (ngày)</label>
                  <FInput value={params.ageMinDays} onChange={(v) => patch({ ageMinDays: v })} />
                  <span className="sep">–</span>
                  <FInput value={params.ageMaxDays} onChange={(v) => patch({ ageMaxDays: v })} />
                </div>
                {/* Chọn MỘT nước: bấm nước khác là đổi, bấm lại nước đang chọn là bỏ.
                    API chỉ nhận 1 regionCode nên nhiều nước sẽ phải gọi search.list
                    mỗi nước một lần — đắt gấp bội quota. */}
                <div className="cs-fr"><label>Quốc gia (chọn 1)</label></div>
                <div className="cs-mtags">
                  {COUNTRIES.map((c) => (
                    <span
                      key={c}
                      className={`cs-mt${params.country === c ? ' on' : ''}`}
                      onClick={() => patch({ country: params.country === c ? null : c })}
                    >
                      <Flag code={c} />{c}
                    </span>
                  ))}
                  {params.country && !COUNTRIES.includes(params.country) && (
                    <span className="cs-mt on" onClick={() => patch({ country: null })}>
                      <Flag code={params.country} />{params.country}
                    </span>
                  )}
                  {/* Popover thay vì đổi chỗ chip ＋ thành ô nhập — đổi tại chỗ sẽ làm cả
                      hàng thẻ dồn lại / xuống dòng. */}
                  <span className="cs-addwrap">
                    <span className="cs-mt" onClick={() => setAddCountryOpen(!addCountryOpen)}>＋</span>
                    {addCountryOpen && (
                      <span className="cs-addpop">
                        <input
                          autoFocus
                          placeholder="Mã ISO + Enter"
                          onKeyDown={addCountry}
                          onBlur={() => setAddCountryOpen(false)}
                        />
                      </span>
                    )}
                  </span>
                </div>
              </div>

              {/* Hoạt động */}
              <div className="cs-fg">
                <h4><span className="cs-gico"><Ic id="i-zap" className="" /></span>Hoạt động</h4>
                <div className="cs-fr"><label>Video/tuần ≥</label><FInput value={params.uploadsPerWeekMin} onChange={(v) => patch({ uploadsPerWeekMin: v })} /></div>
                <div className="cs-fr"><label>Đăng gần nhất ≤ (ngày)</label><FInput value={params.lastUploadWithinDays} onChange={(v) => patch({ lastUploadWithinDays: v })} /></div>
                <div className="cs-fr"><label>Số Shorts ≥</label><FInput value={params.shortsCountMin} onChange={(v) => patch({ shortsCountMin: v })} /></div>
                <div className="cs-fr"><label>Thời lượng ≤ (giây)</label><FInput value={params.durationMaxSec} onChange={(v) => patch({ durationMaxSec: v })} /></div>
              </div>

              {/* Chất lượng view */}
              <div className="cs-fg">
                <h4><span className="cs-gico"><Ic id="i-trend" className="" /></span>Chất lượng view</h4>
                <div className="cs-fr"><label>View TB ≥</label><FInput value={params.avgViewsMin} onChange={(v) => patch({ avgViewsMin: v })} asText /></div>
                <div className="cs-fr"><label>Like/view % ≥</label><FInput value={params.likeViewPctMin} onChange={(v) => patch({ likeViewPctMin: v })} /></div>
                <div className="cs-fr"><label>View/sub ≥</label><FInput value={params.viewSubRatioMin} onChange={(v) => patch({ viewSubRatioMin: v })} /></div>
                <div className="cs-fr"><label>Momentum % ≥</label><FInput value={params.momentumPctMin} onChange={(v) => patch({ momentumPctMin: v })} /></div>
                <div className="cs-fr"><label>Ổn định (0–1) ≥</label><FInput value={params.viewConsistencyMin} onChange={(v) => patch({ viewConsistencyMin: v })} /></div>
              </div>

              {/* Khán giả */}
              <div className="cs-fg">
                <h4><span className="cs-gico"><Ic id="i-globe" className="" /></span>Khán giả</h4>
                <div className="cs-fr"><label>Ngôn ngữ chính</label></div>
                <div className="cs-mtags" style={{ marginBottom: 10 }}>
                  {LANGS.map((l) => (
                    <span
                      key={l.code}
                      className={`cs-mt${params.audienceLang === l.code ? ' on' : ''}`}
                      onClick={() => patch({ audienceLang: params.audienceLang === l.code ? null : l.code })}
                    >
                      <Flag code={l.flag} />{l.label}
                    </span>
                  ))}
                </div>
                <div className="cs-fr">
                  <label>Chiếm ≥ %</label>
                  <FInput value={params.audienceLangPctMin} onChange={(v) => patch({ audienceLangPctMin: v ?? 50 })} />
                </div>
                <div className="cs-fr"><label>Comment/view % ≥</label><FInput value={params.commentViewPctMin} onChange={(v) => patch({ commentViewPctMin: v })} /></div>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* KẾT QUẢ */}
      <div className="cs-body">
        <div className="cs-left">
          <div className="cs-lhead">
            <b>{sorted.length} kênh</b>&nbsp;khớp tiêu chí · bấm dòng để xem đầy đủ chỉ số
            <span style={{ marginLeft: 'auto', color: '#7c7d8c', fontSize: 12 }}>
              Bấm tên cột để sắp xếp (bấm tiếp để đổi chiều / bỏ) · bấm nhiều cột để sắp xếp đa tiêu chí
            </span>
          </div>
          <div className="cs-scroll hv-scroll">
            <div className={`cs-loading-ov${loading ? ' show' : ''}`}><div className="cs-loading-spin" /></div>
            <table className="cs-table">
              <colgroup>
                {/* % tính sao cho ở min-width 960px mỗi cột vẫn đủ chỗ cho tiêu đề + badge sắp xếp */}
                <col style={{ width: '21%' }} /><col style={{ width: '9%' }} /><col style={{ width: '8.5%' }} />
                <col style={{ width: '11%' }} /><col style={{ width: '13.5%' }} /><col style={{ width: '10%' }} />
                <col style={{ width: '13%' }} /><col style={{ width: '14%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Kênh</th>
                  {SORT_COLS.map((c) => {
                    const i = sortState.findIndex((s) => s.key === c.key)
                    return (
                      <th
                        key={c.key}
                        className={`sortable${i >= 0 ? ' sorted' : ''}`}
                        onClick={() => onSortClick(c.key)}
                      >
                        <span className="cs-thc">
                          {c.label}
                          <span className={`cs-sort-ind${i >= 0 ? ' active' : ''}`}>
                            {i >= 0 && `${sortState.length > 1 ? i + 1 : ''}${sortState[i].dir === 'asc' ? '↑' : '↓'}`}
                          </span>
                        </span>
                      </th>
                    )
                  })}
                  <th>Hành động</th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ padding: '40px 12px', color: '#7c7d8c', textAlign: 'center' }}>
                      {loading ? 'Đang tìm kiếm…' : searched ? 'Không có kênh nào khớp tiêu chí' : 'Nhập từ khóa và bấm Tìm kiếm'}
                    </td>
                  </tr>
                )}
                {sorted.map((r) => {
                  const open = openRows.has(r.ytChannelId)
                  const t = tk.get(r.ytChannelId)
                  const isAdded = added.has(r.ytChannelId)
                  return [
                    <tr
                      key={r.ytChannelId}
                      className={`row${open ? ' open' : ''}${isAdded ? ' saved-row' : ''}`}
                      onClick={() => toggleRow(r.ytChannelId)}
                    >
                      <td>
                        <div className="cs-ch">
                          <span className="cs-rowcaret">▶</span>
                          {r.thumbnail
                            ? <img className="cs-ava" src={r.thumbnail} alt="" />
                            : <div className="cs-ava">📺</div>}
                          <div>
                            <div className="nm">{r.name || r.ytChannelId}</div>
                            <div className="hd">{r.handle}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        {r._score === null
                          ? '—'
                          : <span className={`cs-score ${scoreClass(r._score)}`}>{r._score}</span>}
                      </td>
                      <td className="cs-num">{fmt(r.subs)}</td>
                      <td className="cs-num">{fmt(r.avgViews)}</td>
                      <td>
                        {r.momentumPct === null ? '—' : (
                          <span className={r.momentumPct >= 0 ? 'cs-up' : 'cs-down'}>
                            {r.momentumPct >= 0 ? '📈 +' : '📉 '}{r.momentumPct}%
                          </span>
                        )}
                      </td>
                      <td className="cs-num">{fmt(r.shortsCount)}</td>
                      <td>{fmtLastUpload(r.lastUploadAt)}</td>
                      <td>
                        <div className="cs-rowacts">
                          <button
                            className={`cs-addbtn cs-checkbtn${t ? (t.found ? ' checked' : ' checked-none') : ''}`}
                            onClick={(e) => { e.stopPropagation(); checkTikTok(r) }}
                            disabled={checking !== null || !!t}
                            title={t ? (t.found ? 'Đã check TikTok — trùng tên' : 'Đã check TikTok — không trùng') : 'Check TikTok'}
                          >
                            <Ic id="i-scancheck" />
                          </button>
                          <button
                            className="cs-addbtn"
                            onClick={(e) => { e.stopPropagation(); window.open(r.url, '_blank') }}
                            title="Mở kênh YouTube"
                          >
                            <Ic id="i-external" />
                          </button>
                          <button
                            className={`cs-addbtn${isAdded ? ' saved' : ''}`}
                            onClick={(e) => { e.stopPropagation(); addToGetVideo(r) }}
                            disabled={isAdded}
                            title={isAdded ? 'Đã thêm vào Get Video' : 'Thêm vào Get Video'}
                          >
                            {isAdded ? '✓' : '➕'}
                          </button>
                        </div>
                      </td>
                    </tr>,
                    <tr className="detail" key={`${r.ytChannelId}-d`}>
                      <td colSpan={8}>
                        <div className={`cs-drow${open ? ' open' : ''}`}>
                          <div className="cs-drow-inner">
                            <div className="cs-drow-content">
                              {t && (
                                t.found ? (
                                  <div className="cs-tkresult found">
                                    <Ic id="i-tag" style={{ width: 13, height: 13 }} />
                                    Trùng tên:{' '}
                                    <a onClick={() => window.open(`https://www.tiktok.com/@${t.username}`, '_blank')}>
                                      @{t.username}
                                    </a>{' '}
                                    ↗
                                  </div>
                                ) : (
                                  <div className="cs-tkresult none">— Không thấy kênh TikTok trùng tên</div>
                                )
                              )}
                              {r.sampleVideos && r.sampleVideos.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
                                  {r.sampleVideos.map((v, i) => (
                                    <div key={i} style={{ width: 104, flexShrink: 0 }}>
                                      <div style={{ width: 104, height: 138, borderRadius: 9, border: '1px solid #1b1c25', position: 'relative', overflow: 'hidden', background: 'linear-gradient(160deg,#20243f,#0f1524)' }}>
                                        {v.thumbnail && <img src={v.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                                        <span style={{ position: 'absolute', left: 7, bottom: 6, fontSize: 11, fontWeight: 700, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,.9)' }}>
                                          {fmt(v.views)} view
                                        </span>
                                        <span style={{ position: 'absolute', right: 6, bottom: 6, fontSize: 10, color: '#fff', background: 'rgba(0,0,0,.6)', borderRadius: 4, padding: '1px 4px' }}>
                                          {fmtDur(v.durationSec)}
                                        </span>
                                      </div>
                                      <div style={{ fontSize: 11, color: '#7c7d8c', marginTop: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {v.title}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <div className="cs-dgrid">
                                <div className="cs-d"><div className="k">Tổng video</div><div className="v cs-num">{fmt(r.videoCount)}</div></div>
                                <div className="cs-d"><div className="k">Like/view</div><div className="v cs-num">{r.likeViewPct === null ? '—' : `${r.likeViewPct}%`}</div></div>
                                <div className="cs-d"><div className="k">Comment/view</div><div className="v cs-num">{r.commentViewPct === null ? '—' : `${r.commentViewPct}%`}</div></div>
                                <div className="cs-d"><div className="k">View/sub</div><div className="v cs-num">{r.viewSubRatio ?? '—'}</div></div>
                                <div className="cs-d"><div className="k">Độ ổn định view</div><div className="v cs-num">{r.viewConsistency === null ? '—' : r.viewConsistency.toFixed(2)}</div></div>
                                <div className="cs-d"><div className="k">Video/tuần</div><div className="v cs-num">{r.uploadsPerWeek ?? '—'}</div></div>
                                <div className="cs-d"><div className="k">Số Shorts</div><div className="v cs-num">{fmt(r.shortsCount)}</div></div>
                                <div className="cs-d"><div className="k">Quốc gia</div><div className="v">{r.country ?? '—'}</div></div>
                                <div className="cs-d"><div className="k">Tạo kênh</div><div className="v">{fmtDate(r.ytCreatedAt)}</div></div>
                                <div className="cs-d">
                                  <div className="k">Ngôn ngữ khán giả</div>
                                  <div className="v">
                                    {r.audienceLangs === null ? '—' : r.audienceLangs.slice(0, 2).map((l) => `${l.lang} ${l.pct}%`).join(' · ')}
                                  </div>
                                </div>
                              </div>
                              <div className="cs-dfoot">
                                <div className="cs-tags">
                                  {(r.topics ?? []).slice(0, 4).map((tp) => <span key={tp}>{tp}</span>)}
                                </div>
                                <span className="cs-dlink" onClick={() => window.open(r.url, '_blank')}>Mở kênh YouTube ↗</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ]
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
