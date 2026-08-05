import { useMemo, useState } from 'react'
import { Avatar } from '../../components/Avatar'
import { Cb } from '../../components/Cb'
import { GROUP_COLORS, GROUP_ICONS } from '../../components/groupStyle'
import { showToast } from '../../components/uiDialogs'
import type { Group, Profile } from '@shared/types'

/**
 * Hộp thoại cài đặt nhóm — tên, icon, màu, và danh sách thành viên.
 *
 * `group = null` là chế độ tạo nhóm mới; các trường bắt đầu rỗng.
 *
 * Danh sách bên dưới liệt kê TẤT CẢ profile, không chỉ profile trong nhóm: tích
 * vào là thêm, bỏ tích là đưa về "Không nhóm". Một profile chỉ thuộc một nhóm
 * (schema chỉ có `profiles.group_id`), nên tích một profile đang ở nhóm khác sẽ
 * kéo nó sang đây — dòng chú thích dưới danh sách nói rõ điều đó.
 */
export function GroupDialog({
  group,
  profiles,
  onClose,
  onSaved
}: {
  group: Group | null
  profiles: Profile[]
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const [name, setName] = useState(group?.name ?? '')
  const [color, setColor] = useState(group?.color ?? GROUP_COLORS[0])
  const [icon, setIcon] = useState(group?.icon ?? '')
  const [members, setMembers] = useState<Set<string>>(
    () => new Set(profiles.filter((p) => p.groupId === group?.id).map((p) => p.id))
  )
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? profiles.filter((p) => p.name.toLowerCase().includes(t)) : profiles
  }, [profiles, q])

  const toggle = (id: string): void =>
    setMembers((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const save = async (): Promise<void> => {
    if (!name.trim()) {
      showToast('Nhóm cần có tên', 'error')
      return
    }
    setSaving(true)
    try {
      // Tạo trước rồi mới đặt thành viên: setMembers cần một id có thật.
      const id = group
        ? (await window.hnv.groups.update({ ...group, name: name.trim(), color, icon })).id
        : (await window.hnv.groups.create(name.trim(), color, icon)).id
      await window.hnv.groups.setMembers(id, [...members])
      onSaved()
    } catch (e: any) {
      showToast(e?.message ?? 'Không lưu được nhóm', 'error')
      setSaving(false)
    }
  }

  const doDelete = async (deleteProfiles: boolean): Promise<void> => {
    if (!group) return
    setSaving(true)
    try {
      await window.hnv.groups.remove(group.id, deleteProfiles)
      onSaved()
    } catch (e: any) {
      showToast(e?.message ?? 'Không xóa được nhóm', 'error')
      setSaving(false)
    }
  }

  const memberCount = profiles.filter((p) => p.groupId === group?.id).length

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-[470px] max-h-[88vh] flex flex-col bg-[#0b0c12] border border-border rounded-[14px] shadow-2xl overflow-hidden">
        <div className="px-[18px] py-3.5 border-b border-borderSoft flex items-center">
          <span className="text-[16px] font-bold">{group ? 'Cài đặt nhóm' : 'Nhóm mới'}</span>
          <button onClick={onClose} className="ml-auto text-muted hover:text-white px-1">
            ✕
          </button>
        </div>

        <div className="px-[18px] py-3.5 overflow-auto hv-scroll">
          <div className="text-[11px] text-muted font-bold uppercase tracking-wide mb-1.5">Tên nhóm</div>
          <input
            className="inp mb-3"
            placeholder="Tên nhóm…"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />

          <div className="text-[11px] text-muted font-bold uppercase tracking-wide mb-1.5">Icon</div>
          <div className="grid grid-cols-12 gap-[5px] mb-3">
            {GROUP_ICONS.map((ic) => (
              <button
                key={ic}
                type="button"
                onClick={() => setIcon(icon === ic ? '' : ic)}
                title={icon === ic ? 'Bấm lại để bỏ icon' : undefined}
                className={
                  'aspect-square rounded-[7px] bg-surface flex items-center justify-center text-[14px] border ' +
                  (icon === ic ? 'border-accent' : 'border-border hover:border-[#3a3d6b]')
                }
              >
                {ic}
              </button>
            ))}
          </div>

          <div className="text-[11px] text-muted font-bold uppercase tracking-wide mb-1.5">Màu</div>
          {/* 14 cột — Tailwind chỉ có sẵn tới grid-cols-12 nên đặt thẳng ở đây. */}
          <div className="grid gap-[5px] mb-3" style={{ gridTemplateColumns: 'repeat(14, 1fr)' }}>
            {GROUP_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className="aspect-square rounded-[6px]"
                style={{ background: c, boxShadow: c === color ? '0 0 0 2px #e7e7ee' : undefined }}
              />
            ))}
          </div>

          <div className="flex items-center mb-1.5">
            <span className="text-[11px] text-muted font-bold uppercase tracking-wide">Profile trong nhóm</span>
            <span className="ml-auto text-[11px] text-subtle">
              đã chọn {members.size} / {profiles.length}
            </span>
          </div>

          <div className="bg-[#101117] border border-border rounded-[10px] overflow-hidden">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="🔍 Lọc profile…"
              className="w-full bg-transparent border-0 border-b border-borderSoft px-2.5 py-2 text-[13px] outline-none"
            />
            <div className="max-h-[210px] overflow-auto hv-scroll">
              {shown.length === 0 ? (
                <div className="px-2.5 py-4 text-[13px] text-muted text-center">Không có profile nào khớp.</div>
              ) : (
                shown.map((p, i) => (
                  <div
                    key={p.id}
                    onClick={() => toggle(p.id)}
                    className={
                      'px-2.5 py-2 flex items-center gap-2 cursor-pointer hover:bg-surface ' +
                      (i % 2 === 1 ? 'bg-[#0e0f15]' : '')
                    }
                  >
                    <Cb on={members.has(p.id)} onClick={() => toggle(p.id)} />
                    <Avatar src={p.avatar} name={p.name} size={24} />
                    <span className={'text-[13px] truncate ' + (members.has(p.id) ? '' : 'text-subtle')}>
                      {p.name}
                    </span>
                    <span className="ml-auto shrink-0">
                      {p.status === 'running' ? (
                        <span className="rounded-full border border-[#2c5443] bg-[rgba(52,211,153,.12)] px-2 py-[1px] text-[11px] text-ok">
                          Đang chạy
                        </span>
                      ) : p.groupId && p.groupId !== group?.id ? (
                        <span className="text-[11px] text-muted">
                          {profiles.find((x) => x.id === p.id)?.groupName ?? ''}
                        </span>
                      ) : (
                        <span className="rounded-full border border-border bg-[#101117] px-2 py-[1px] text-[11px] text-subtle">
                          Nghỉ
                        </span>
                      )}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="text-[11px] text-muted mt-1.5">
            Tích một profile đang thuộc nhóm khác sẽ chuyển nó sang nhóm này.
          </div>
        </div>

        <div className="px-[18px] py-3 border-t border-borderSoft flex items-center gap-2">
          {group && (
            <button
              onClick={() => setConfirmingDelete(true)}
              disabled={saving}
              className="font-semibold text-[13px] rounded-[9px] px-3 py-2 bg-[#3a1f1f] text-[#f87171] border border-[#542c2c] hover:border-[#7a3c3c] disabled:opacity-40"
            >
              🗑 Xóa nhóm
            </button>
          )}
          <button
            onClick={onClose}
            className="ml-auto bg-surface text-[#c7c8d4] border border-border rounded-[9px] px-4 py-2 text-[13px]"
          >
            Hủy
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="accent-grad text-[#0a0b10] font-bold rounded-[9px] px-5 py-2 text-[13px] disabled:opacity-50"
          >
            {saving ? '…' : 'Lưu'}
          </button>
        </div>
      </div>

      {/* Xóa nhóm cần BA lựa chọn nên không dùng lại ConfirmDialog (chỉ có hai).
          Mặc định phải là lựa chọn giữ profile: nhánh còn lại xóa cả tài khoản
          đã đăng nhập, không hồi lại được. */}
      {confirmingDelete && group && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55">
          <div className="w-[430px] bg-[#0d0e14] border border-border rounded-[14px] shadow-2xl overflow-hidden">
            <div className="px-[22px] py-4 border-b border-borderSoft text-[16px] font-bold">
              Xóa nhóm &quot;{group.name}&quot;
            </div>
            <div className="px-[22px] py-5 text-[14px] text-subtle leading-relaxed">
              {memberCount === 0
                ? 'Nhóm này không có profile nào.'
                : `Nhóm này đang có ${memberCount} profile. Bạn muốn làm gì với chúng?`}
            </div>
            <div className="px-[22px] py-3.5 border-t border-borderSoft flex flex-col gap-2">
              <button
                onClick={() => doDelete(false)}
                disabled={saving}
                className="accent-grad text-[#0a0b10] font-bold rounded-[9px] px-4 py-2.5 text-[14px] disabled:opacity-50"
              >
                Xóa nhóm, giữ profile (về &quot;Không nhóm&quot;)
              </button>
              {memberCount > 0 && (
                <button
                  onClick={() => doDelete(true)}
                  disabled={saving}
                  className="rounded-[9px] px-4 py-2.5 text-[14px] font-bold text-danger border border-[#5a2c33] bg-[rgba(251,113,133,.12)] disabled:opacity-50"
                >
                  🗑 Xóa nhóm và xóa luôn {memberCount} profile
                </button>
              )}
              <button
                onClick={() => setConfirmingDelete(false)}
                className="bg-surface text-[#c7c8d4] border border-border rounded-[9px] px-4 py-2.5 text-[14px]"
              >
                Hủy
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
