import { Fragment, useEffect, useRef, useState } from 'react'
import { confirmDialog, showToast } from '../../components/uiDialogs'
import type { CsCandidate, CsStatus } from '@shared/types'

const STATUS: { key: CsStatus; label: string; cls: string }[] = [
  { key: 'new', label: '🆕 Chưa check', cls: 'text-subtle border-border' },
  { key: 'good', label: '✅ Đáng làm', cls: 'text-ok border-[#1f4d35]' },
  { key: 'own_tiktok', label: '🎭 Có TikTok riêng', cls: 'text-[#e8c96a] border-[#5a4a1a]' },
  { key: 'reupped', label: '♻️ Đã có người reup', cls: 'text-[#f0955a] border-[#5a3a1a]' },
  { key: 'skip', label: '⏭️ Bỏ qua', cls: 'text-muted border-border' },
  { key: 'in_use', label: '▶️ Đang dùng', cls: 'text-[#818cf8] border-[#3a3d6b]' }
]

function fmt(n: number | null): string {
  if (n === null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function timeAgo(ts: number | null): string {
  if (!ts) return 'chưa check'
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s trước`
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`
  return `${Math.floor(s / 86400)} ngày trước`
}

export function CandidatesPanel(): JSX.Element {
  const [cands, setCands] = useState<CsCandidate[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [checking, setChecking] = useState<string | null>(null) // id đang check
  const [checkingAll, setCheckingAll] = useState(false)
  const [logLine, setLogLine] = useState('')
  const stopAll = useRef(false)

  const reload = (): Promise<void> => window.hnv.channelSearch.listCandidates().then(setCands)

  useEffect(() => {
    reload()
    return window.hnv.onChannelSearchLog(setLogLine)
  }, [])

  const checkOne = async (id: string): Promise<boolean> => {
    setChecking(id)
    try {
      await window.hnv.channelSearch.checkTiktok(id)
      await reload()
      return true
    } catch (e) {
      showToast((e as Error).message, 'error')
      return false
    } finally {
      setChecking(null)
    }
  }

  const checkAll = async (): Promise<void> => {
    const targets = cands.filter((c) => c.tiktokCheckedAt === null)
    if (!targets.length) {
      showToast('Không còn ứng viên chưa check')
      return
    }
    setCheckingAll(true)
    stopAll.current = false
    let fails = 0
    for (const c of targets) {
      if (stopAll.current) break
      const ok = await checkOne(c.id)
      fails = ok ? 0 : fails + 1
      if (fails >= 3) {
        showToast('Dừng: lỗi 3 lần liên tiếp')
        break
      }
      // nghỉ ngẫu nhiên 3–6s giữa các kênh — tránh spam search TikTok
      await new Promise((r) => setTimeout(r, 3000 + Math.random() * 3000))
    }
    setCheckingAll(false)
  }

  const setStatus = async (id: string, st: CsStatus): Promise<void> => {
    await window.hnv.channelSearch.setStatus(id, st)
    await reload()
  }

  const addToGetVideo = async (c: CsCandidate): Promise<void> => {
    await window.hnv.getvideo.addChannel(c.url)
    await setStatus(c.id, 'in_use')
    showToast(`Đã thêm "${c.name}" vào Get Video`)
  }

  const remove = async (c: CsCandidate): Promise<void> => {
    const ok = await confirmDialog({ message: `Xóa ứng viên "${c.name}"?` })
    if (!ok) return
    await window.hnv.channelSearch.removeCandidate(c.id)
    await reload()
  }

  const toggle = (id: string): void =>
    setExpanded((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center mb-3">
        <div className="text-[13px] text-muted">{cands.length} ứng viên</div>
        <button
          onClick={checkingAll ? () => (stopAll.current = true) : checkAll}
          disabled={checking !== null && !checkingAll}
          className="ml-auto bg-surface text-[#c7c8d4] border border-border rounded-[9px] px-4 py-2 text-[14px] disabled:opacity-40"
        >
          {checkingAll ? '⏹ Dừng check' : '🔎 Check tất cả'}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto hv-scroll rounded-[12px] border border-border">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-[#101117] text-subtle">
            <tr>
              {['Kênh YouTube', 'Sub', 'Trạng thái', 'Kết quả TikTok', 'Hành động'].map((h) => (
                <th key={h} className="text-left px-3 py-2.5 font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cands.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-muted">
                  Chưa có ứng viên — sang khu Tìm kiếm để lưu kênh
                </td>
              </tr>
            )}
            {cands.map((c) => {
              const st = STATUS.find((s) => s.key === c.status) ?? STATUS[0]
              return (
                <Fragment key={c.id}>
                  <tr className="border-t border-borderSoft hover:bg-surface/50">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2 min-w-[200px]">
                        {c.thumbnail && <img src={c.thumbnail} className="w-7 h-7 rounded-full" />}
                        <div>
                          <a className="text-white hover:underline cursor-pointer" onClick={() => window.open(c.url, '_blank')}>
                            {c.name || c.ytChannelId}
                          </a>
                          <div className="text-[11px] text-muted">{c.handle}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">{fmt(c.subs)}</td>
                    <td className="px-3 py-2">
                      <select
                        value={c.status}
                        onChange={(e) => setStatus(c.id, e.target.value as CsStatus)}
                        className={`bg-[#101117] border rounded-[8px] px-2 py-1.5 text-[12px] ${st.cls}`}
                      >
                        {STATUS.map((s) => (
                          <option key={s.key} value={s.key}>{s.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {c.matches.length > 0 ? (
                        <button className="text-[#818cf8] hover:underline" onClick={() => toggle(c.id)}>
                          {expanded.has(c.id) ? '▾' : '▸'} {c.matches.length} account giống · {timeAgo(c.tiktokCheckedAt)}
                        </button>
                      ) : (
                        <span className="text-muted">{c.tiktokCheckedAt ? `0 account · ${timeAgo(c.tiktokCheckedAt)}` : 'chưa check'}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1.5 whitespace-nowrap">
                        <button
                          onClick={() => checkOne(c.id)}
                          disabled={checking !== null || checkingAll}
                          className="bg-surface text-[#c7c8d4] border border-border rounded-[8px] px-3 py-1.5 text-[12px] disabled:opacity-40"
                        >
                          {checking === c.id ? '⏳…' : '🔎 Check TikTok'}
                        </button>
                        <button
                          onClick={() => addToGetVideo(c)}
                          disabled={c.status === 'in_use'}
                          className="bg-surface text-[#c7c8d4] border border-border rounded-[8px] px-3 py-1.5 text-[12px] disabled:opacity-40"
                        >
                          ▶️ Get Video
                        </button>
                        <button
                          onClick={() => remove(c)}
                          className="bg-surface text-danger border border-border rounded-[8px] px-2.5 py-1.5 text-[12px]"
                        >
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expanded.has(c.id) &&
                    c.matches.map((m) => (
                      <tr key={m.id} className="bg-[#0d0e14]">
                        <td colSpan={5} className="px-3 py-1.5">
                          <div className="flex items-center gap-3 pl-9 text-[12px]">
                            {m.avatarUrl && <img src={m.avatarUrl} className="w-6 h-6 rounded-full" />}
                            <a
                              className="text-white hover:underline cursor-pointer"
                              onClick={() => window.open(`https://www.tiktok.com/@${m.username}`, '_blank')}
                            >
                              @{m.username}
                            </a>
                            <span className="text-subtle">{m.nickname}</span>
                            <span className="text-muted ml-auto">{fmt(m.followers)} follower · {m.videoCount === null ? '—' : fmt(m.videoCount)} video</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {logLine && <div className="mt-2 text-[12px] text-muted truncate">{logLine}</div>}
    </div>
  )
}
