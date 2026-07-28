import { useEffect, useMemo, useState } from 'react'
import type { Profile } from '@shared/types'

const PAGE = 8

export function RunPickerDialog({
  templateId,
  templateName,
  onClose,
  onRan
}: {
  templateId: string
  templateName: string
  onClose: () => void
  onRan: () => void
}): JSX.Element {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)

  useEffect(() => {
    // Chỉ hiện profile đã đăng nhập TikTok
    window.hnv.profiles.list().then((ps) => setProfiles(ps.filter((p) => p.loggedIn)))
  }, [])

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? profiles.filter((p) => p.name.toLowerCase().includes(t)) : profiles
  }, [profiles, q])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE))
  const items = filtered.slice(page * PAGE, page * PAGE + PAGE)

  const toggle = (id: string): void => {
    const s = new Set(picked)
    s.has(id) ? s.delete(id) : s.add(id)
    setPicked(s)
  }

  const run = async (): Promise<void> => {
    await window.hnv.queue.enqueue(templateId, [...picked])
    onRan()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-[520px] bg-[#0d0e14] border border-border rounded-[14px] shadow-2xl overflow-hidden">
        <div className="px-[22px] py-4 border-b border-borderSoft flex items-center">
          <div className="text-[17px] font-bold">Chạy <span className="text-accent2">{templateName}</span> — chọn profile</div>
          <button onClick={onClose} className="ml-auto text-muted text-lg">✕</button>
        </div>
        <div className="px-[22px] py-4">
          <div className="flex gap-2.5 mb-2.5">
            <button onClick={() => setPicked(new Set(profiles.map((p) => p.id)))} className="flex-1 rounded-lg px-3.5 py-2 text-[13px] font-semibold text-accent2 border border-[#3a3d6b] bg-[linear-gradient(100deg,rgba(99,102,241,.18),rgba(34,211,238,.10))]">
              Chọn tất cả
            </button>
            <button onClick={() => setPicked(new Set())} className="flex-1 rounded-lg px-3.5 py-2 text-[13px] font-semibold text-warn border border-[#6b4422] bg-[rgba(251,146,60,.12)]">
              Bỏ chọn tất cả
            </button>
          </div>
          <input className="inp mb-2" placeholder="🔍 Tìm profile..." value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} />
          <div className="text-[13px] h-[260px] overflow-y-auto hv-scroll">
            {items.map((p) => {
              const on = picked.has(p.id)
              return (
                <div key={p.id} onClick={() => toggle(p.id)} className="flex items-center py-2 px-2 rounded-lg hover:bg-[#101117] cursor-pointer">
                  <span className={'w-[18px] h-[18px] rounded-[5px] inline-flex items-center justify-center text-[12px] font-black ' + (on ? 'accent-grad text-[#0a0b10]' : 'border-[1.5px] border-[#3b3d4f]')}>
                    {on ? '✓' : ''}
                  </span>
                  <span className="ml-2.5">{p.name}</span>
                  {p.groupName && <span className="ml-auto text-muted text-[12px]"><span style={{ color: p.groupColor ?? '#818cf8' }}>●</span> {p.groupName}</span>}
                </div>
              )
            })}
            {filtered.length === 0 && <div className="text-muted py-2 px-2">Chưa có profile.</div>}
          </div>
          {pageCount > 1 && (
            <div className="flex items-center justify-between border-t border-borderSoft mt-2 pt-2.5 text-[12px] text-muted">
              <span>Hiện {page * PAGE + 1}–{Math.min((page + 1) * PAGE, filtered.length)} / {filtered.length}</span>
              <div className="flex items-center gap-1.5">
                <button disabled={page === 0} onClick={() => setPage(page - 1)} className="px-2.5 py-1 border border-border rounded-md disabled:opacity-30">‹</button>
                <span className="px-2.5 py-1 border border-[#3a3d6b] rounded-md text-white bg-[linear-gradient(100deg,rgba(99,102,241,.2),rgba(34,211,238,.08))]">{page + 1}</span>
                <button disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)} className="px-2.5 py-1 border border-border rounded-md disabled:opacity-30">›</button>
              </div>
            </div>
          )}
        </div>
        <div className="px-[22px] py-3.5 border-t border-borderSoft flex gap-2.5 justify-end items-center">
          <div className="mr-auto text-[13px] text-muted">Đã chọn <b className="text-accent2">{picked.size}</b></div>
          <button onClick={onClose} className="bg-surface text-[#c7c8d4] border border-border rounded-[9px] px-[18px] py-2.5 text-[14px]">Hủy</button>
          <button onClick={run} disabled={picked.size === 0} className="bg-[#1f3a2e] text-ok border border-[#2c5443] font-bold rounded-[9px] px-[22px] py-2.5 text-[14px] disabled:opacity-40">
            ▶ Chạy {picked.size} profile
          </button>
        </div>
      </div>
    </div>
  )
}
