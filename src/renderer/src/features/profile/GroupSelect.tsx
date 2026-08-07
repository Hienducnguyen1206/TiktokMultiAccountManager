import { useEffect, useRef, useState } from 'react'
import { GroupMark } from '../../components/GroupMark'
import { Icon } from '../../components/Icon'
import type { Group } from '@shared/types'

export function GroupSelect({
  groups,
  value,
  onChange,
}: {
  groups: Group[]
  value: string | null
  onChange: (id: string | null) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Danh sách nhóm KHÔNG được sao vào state cục bộ ở đây. Nguồn duy nhất là
  // App.tsx, và GroupStore phát 'changed' sau mỗi lần tạo/sửa/xóa nên prop luôn
  // tới nơi. Bản sao cũ khiến hộp thoại cài đặt nhóm và dropdown này có thể hiện
  // hai danh sách khác nhau cùng lúc.
  useEffect(() => {
    const h = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const selected = groups.find((g) => g.id === value) ?? null

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="inp flex items-center w-full text-left">
        {selected ? (
          <>
            <GroupMark icon={selected.icon} color={selected.color} />
            <span className="ml-2">{selected.name}</span>
          </>
        ) : (
          <span className="text-muted">— Không nhóm —</span>
        )}
        <span className="ml-auto text-muted">▾</span>
      </button>

      {open && (
        <div className="absolute z-10 mt-1.5 w-full bg-[#0d0e14] border border-border rounded-[11px] shadow-2xl overflow-hidden">
          <div className="p-2 max-h-[180px] overflow-auto hv-scroll">
            <div
              onClick={() => {
                onChange(null)
                setOpen(false)
              }}
              className="px-3 py-2 rounded-lg hover:bg-surface cursor-pointer text-muted text-[14px]"
            >
              — Không nhóm —
            </div>
            {groups.map((g) => (
              <div
                key={g.id}
                onClick={() => {
                  onChange(g.id)
                  setOpen(false)
                }}
                className="px-3 py-2 rounded-lg hover:bg-surface cursor-pointer text-[14px] flex items-center"
              >
                <GroupMark icon={g.icon} color={g.color} />
                <span className="ml-2">{g.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
