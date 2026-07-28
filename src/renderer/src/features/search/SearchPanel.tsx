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
          className="accent-grad text-[#0a0b10] font-bold rounded-[9px] px-5 text-[14px] shrink-0 disabled:opacity-50"
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
