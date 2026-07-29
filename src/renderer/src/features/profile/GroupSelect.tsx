import { useEffect, useRef, useState } from 'react'
import { confirmDialog } from '../../components/uiDialogs'
import type { Group } from '@shared/types'

const COLORS = ['#818cf8', '#c084fc', '#fb923c', '#f43f5e', '#34d399', '#22d3ee', '#facc15']

export function GroupSelect({
  groups: initial,
  value,
  onChange
}: {
  groups: Group[]
  value: string | null
  onChange: (id: string | null) => void
}): JSX.Element {
  const [groups, setGroups] = useState<Group[]>(initial)
  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => setGroups(initial), [initial])
  useEffect(() => {
    const h = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const selected = groups.find((g) => g.id === value) ?? null

  const create = async (): Promise<void> => {
    if (!newName.trim()) return
    const g = await window.hnv.groups.create(newName.trim(), color)
    setGroups((prev) => [...prev, g])
    onChange(g.id)
    setNewName('')
    setOpen(false)
  }

  const removeGroup = async (g: Group, e: React.MouseEvent): Promise<void> => {
    e.stopPropagation() // đừng để nảy sang onClick chọn nhóm của dòng cha
    if (
      !(await confirmDialog({
        title: 'Xóa nhóm',
        message: `Xóa nhóm "${g.name}"? Profile trong nhóm sẽ chuyển về "Không nhóm", không bị xóa.`,
        confirmText: '🗑 Xóa'
      }))
    ) {
      return
    }
    await window.hnv.groups.remove(g.id)
    setGroups((prev) => prev.filter((x) => x.id !== g.id))
    if (value === g.id) onChange(null) // đang chọn đúng nhóm vừa xóa → về "Không nhóm"
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inp flex items-center w-full text-left"
      >
        {selected ? (
          <>
            <span style={{ color: selected.color }}>●</span>
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
                <span style={{ color: g.color }}>●</span>
                <span className="ml-2">{g.name}</span>
                <span
                  onClick={(e) => removeGroup(g, e)}
                  className="ml-auto text-danger opacity-60 hover:opacity-100 px-1.5"
                  title="Xóa nhóm"
                >
                  ✕
                </span>
              </div>
            ))}
          </div>
          <div className="border-t border-borderSoft p-3 bg-card">
            <div className="text-[12px] text-muted font-bold uppercase tracking-wide mb-2">+ Tạo nhóm mới</div>
            <input
              className="inp mb-2.5"
              placeholder="Tên nhóm…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && create()}
            />
            <div className="flex items-center gap-2 mb-3">
              {COLORS.map((c) => (
                <span
                  key={c}
                  onClick={() => setColor(c)}
                  className={'w-[22px] h-[22px] rounded-[7px] cursor-pointer border-2 ' + (c === color ? 'border-white' : 'border-transparent')}
                  style={{ background: c }}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={create}
              className="w-full accent-grad text-[#0a0b10] font-bold rounded-[9px] py-2.5 text-[14px]"
            >
              Tạo nhóm{newName.trim() ? ` "${newName.trim()}"` : ''}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
