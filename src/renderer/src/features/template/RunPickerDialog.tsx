import { useEffect, useMemo, useState } from 'react'
import { GroupMark } from '../../components/GroupMark'
import { NO_GROUP } from '../../components/groupStyle'
import type { Profile } from '@shared/types'

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

  useEffect(() => {
    // Chỉ hiện profile đã đăng nhập TikTok
    window.hnv.profiles.list().then((ps) => setProfiles(ps.filter((p) => p.loggedIn)))
  }, [])

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? profiles.filter((p) => p.name.toLowerCase().includes(t)) : profiles
  }, [profiles, q])

  /** Gom theo nhóm, "Không nhóm" xuống cuối — cùng cách sắp xếp với tab Profile
   *  và bảng chọn của tab Schedule, để ba nơi đọc như nhau. */
  const sections = useMemo(() => {
    const byGroup = new Map<string, Profile[]>()
    for (const p of filtered) {
      const key = p.groupId ?? NO_GROUP
      if (!byGroup.has(key)) byGroup.set(key, [])
      byGroup.get(key)!.push(p)
    }
    const named = [...byGroup.entries()]
      .filter(([k]) => k !== NO_GROUP)
      .sort((a, b) => (a[1][0].groupName ?? '').localeCompare(b[1][0].groupName ?? '', 'vi'))
    const loose = byGroup.get(NO_GROUP)
    return [
      ...named.map(([key, items]) => ({ key, items, head: items[0] as Profile | null })),
      ...(loose ? [{ key: NO_GROUP, items: loose, head: null }] : [])
    ]
  }, [filtered])

  const toggle = (id: string): void => {
    const s = new Set(picked)
    s.has(id) ? s.delete(id) : s.add(id)
    setPicked(s)
  }

  /** Bấm vào nhóm: còn thiếu ai thì chọn hết, đủ cả rồi thì bỏ hết. */
  const toggleGroup = (items: Profile[]): void => {
    const ids = items.map((p) => p.id)
    const all = ids.every((id) => picked.has(id))
    const s = new Set(picked)
    for (const id of ids) (all ? s.delete(id) : s.add(id))
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
          <input className="inp mb-2" placeholder="🔍 Tìm profile..." value={q} onChange={(e) => setQ(e.target.value)} />
          {/* Bỏ phân trang 8 dòng: gom nhóm rồi mà còn cắt trang thì một nhóm bị
              xẻ đôi qua hai trang, chọn cả nhóm xong lật trang lại thấy thiếu. */}
          <div className="text-[13px] h-[300px] overflow-y-auto hv-scroll">
            {sections.map((sec) => {
              const ids = sec.items.map((p) => p.id)
              const onCount = ids.filter((id) => picked.has(id)).length
              const all = onCount === ids.length && ids.length > 0
              const some = onCount > 0 && !all
              return (
                <div key={sec.key} className="mb-1">
                  <div
                    onClick={() => toggleGroup(sec.items)}
                    className="flex items-center py-2 px-2 rounded-lg cursor-pointer bg-[#12131b] hover:bg-[#161822]"
                  >
                    <span
                      className={
                        'w-[18px] h-[18px] rounded-[5px] inline-flex items-center justify-center text-[12px] font-black ' +
                        (all || some ? 'accent-grad text-[#0a0b10]' : 'border-[1.5px] border-[#3b3d4f]')
                      }
                    >
                      {all ? '✓' : some ? '–' : ''}
                    </span>
                    <span className="ml-2.5 flex items-center gap-1.5 font-semibold">
                      <GroupMark icon={sec.head?.groupIcon} color={sec.head?.groupColor} />
                      <span className={sec.head ? '' : 'text-subtle'}>{sec.head?.groupName ?? 'Không nhóm'}</span>
                    </span>
                    <span className="ml-auto text-[12px] text-muted">
                      {onCount}/{ids.length}
                    </span>
                  </div>
                  {sec.items.map((p) => {
                    const on = picked.has(p.id)
                    return (
                      <div
                        key={p.id}
                        onClick={() => toggle(p.id)}
                        className="flex items-center py-2 pl-6 pr-2 rounded-lg hover:bg-[#101117] cursor-pointer"
                      >
                        <span
                          className={
                            'w-[18px] h-[18px] rounded-[5px] inline-flex items-center justify-center text-[12px] font-black ' +
                            (on ? 'accent-grad text-[#0a0b10]' : 'border-[1.5px] border-[#3b3d4f]')
                          }
                        >
                          {on ? '✓' : ''}
                        </span>
                        <span className={'ml-2.5 ' + (on ? '' : 'text-subtle')}>{p.name}</span>
                      </div>
                    )
                  })}
                </div>
              )
            })}
            {filtered.length === 0 && <div className="text-muted py-2 px-2">Chưa có profile.</div>}
          </div>
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
