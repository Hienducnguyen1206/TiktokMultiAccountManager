import { useEffect, useMemo, useState } from 'react'
import { showToast } from '../../components/uiDialogs'
import type { AnalyticsData } from '@shared/types'

function fmt(n: number): string {
  return n.toLocaleString('en-US')
}

type SortKey = 'followers' | 'today' | 'all' | 'name'

export function AnalyticsTab(): JSX.Element {
  const [data, setData] = useState<AnalyticsData>({ dates: [], profiles: [] })
  const [collecting, setCollecting] = useState(false)
  const [progress, setProgress] = useState('')
  const [q, setQ] = useState('')
  const [sortBy, setSortBy] = useState<SortKey>('followers')

  const reload = async (): Promise<void> => setData(await window.hnv.analytics.data())
  useEffect(() => {
    reload()
    return window.hnv.onAnalyticsProgress((msg) => {
      setProgress(msg)
      // Thu thập nền (tự động khi mở app) xong → nạp lại bảng.
      if (msg.startsWith('Xong:')) reload()
    })
  }, [])

  const collect = async (): Promise<void> => {
    setCollecting(true)
    setProgress('Đang chuẩn bị…')
    try {
      const r = await window.hnv.analytics.collect()
      await reload()
      setProgress(`Xong: ${r.ok} thành công, ${r.failed} lỗi`)
    } catch (e: any) {
      showToast(e?.message ?? 'Lỗi thu thập', 'error')
    } finally {
      setCollecting(false)
    }
  }

  // bảng
  const rows = useMemo(() => {
    const arr = data.profiles.map((p) => {
      const pts = p.points
      const last = pts[pts.length - 1]
      const prev = pts[pts.length - 2]
      const first = pts[0]
      return {
        profileId: p.profileId,
        name: p.name,
        groupName: p.groupName ?? null,
        groupColor: p.groupColor ?? null,
        latest: last?.followers ?? 0,
        dToday: last && prev ? last.followers - prev.followers : 0,
        dAll: last && first ? last.followers - first.followers : 0,
        has: pts.length > 0
      }
    })
    const cmp: Record<SortKey, (a: typeof arr[0], b: typeof arr[0]) => number> = {
      followers: (a, b) => b.latest - a.latest,
      today: (a, b) => b.dToday - a.dToday,
      all: (a, b) => b.dAll - a.dAll,
      name: (a, b) => a.name.localeCompare(b.name, 'vi')
    }
    arr.sort(cmp[sortBy])
    const t = q.trim().toLowerCase()
    return t ? arr.filter((r) => r.name.toLowerCase().includes(t)) : arr
  }, [data, sortBy, q])

  // Số thay đổi có màu: tăng = xanh, giảm = đỏ, không đổi = trắng.
  const deltaNum = (v: number): JSX.Element =>
    <span className={v > 0 ? 'text-ok' : v < 0 ? 'text-danger' : 'text-white'}>
      {v > 0 ? '+' : ''}{fmt(v)}
    </span>

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="px-[22px] pt-[18px] pb-3.5 flex items-center gap-2.5">
        <div className="text-[21px] font-bold">📈 Analytics</div>
        {collecting && <span className="text-[13px] text-accent2">⏳ {progress}</span>}
        {!collecting && progress && <span className="text-[13px] text-muted">{progress}</span>}
        <button
          onClick={collect}
          disabled={collecting}
          className="ml-auto accent-grad text-[#0a0b10] font-bold text-[14px] rounded-[10px] px-4 py-2.5 disabled:opacity-50"
        >
          {collecting ? 'Đang thu thập…' : '⟳ Thu thập ngay'}
        </button>
      </div>

      <div className="flex-1 overflow-auto hv-scroll px-[22px] pb-5">
        {/* bảng từng profile */}
        <div className="flex items-center mb-2.5">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="ml-auto bg-[#101117] border border-border rounded-[10px] px-3 py-2 text-[14px] text-[#c7c8d4] outline-none"
          >
            <option value="followers">Follower cao → thấp</option>
            <option value="today">Tăng hôm nay nhiều nhất</option>
            <option value="all">Tăng nhiều nhất (toàn kỳ)</option>
            <option value="name">Tên A → Z</option>
          </select>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="🔍 Tìm profile…"
            className="ml-2.5 bg-[#101117] border border-border rounded-[10px] px-3 py-2 text-[14px] outline-none focus:border-[#3a3d6b] w-[220px]"
          />
        </div>
        <div className="bg-card border border-borderSoft rounded-[14px] overflow-hidden">
          {rows.length === 0 ? (
            <div className="text-muted text-[15px] px-5 py-6">Chưa có dữ liệu.</div>
          ) : (
            <table className="w-full text-[16px]">
              <thead className="text-muted text-left">
                <tr>
                  <th className="px-5 py-3.5 font-semibold text-[13px] uppercase tracking-wide w-[44px] text-center">#</th>
                  <th className="px-5 py-3.5 font-semibold text-[13px] uppercase tracking-wide">Profile</th>
                  <th className="px-5 py-3.5 font-semibold text-[13px] uppercase tracking-wide">Nhóm</th>
                  <th className="px-5 py-3.5 font-semibold text-[13px] uppercase tracking-wide text-center">Follower</th>
                  <th className="px-5 py-3.5 font-semibold text-[13px] uppercase tracking-wide text-center">Hôm nay</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.profileId} className={i % 2 === 0 ? 'bg-[#0e0f15]' : ''}>
                    <td className="px-5 py-4 text-center text-muted">{i + 1}</td>
                    <td className="px-5 py-4 font-semibold">{r.name}</td>
                    <td className="px-5 py-4">
                      {r.groupName ? (
                        <span className="text-[13px]"><span style={{ color: r.groupColor ?? '#818cf8' }}>●</span> {r.groupName}</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-center">{r.has ? fmt(r.latest) : '—'}</td>
                    <td className="px-5 py-4 text-center">{deltaNum(r.dToday)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
