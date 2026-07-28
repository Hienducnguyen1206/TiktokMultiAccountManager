import { useState } from 'react'
import { Flag } from '../../components/Flag'
import { GroupSelect } from './GroupSelect'
import { showToast } from '../../components/uiDialogs'
import type { Group, MachineIp } from '@shared/types'

export function NewProfileDialog({
  groups,
  machineIp,
  onClose,
  onCreated
}: {
  groups: Group[]
  machineIp: MachineIp | null
  onClose: () => void
  onCreated: () => void
}): JSX.Element {
  const [mode, setMode] = useState<'manual' | 'txt'>('manual')

  // Manual mode state
  const [name, setName] = useState('Profile_')
  const [qty, setQty] = useState(1)
  const [groupId, setGroupId] = useState<string | null>(null)
  const [homepageUrl, setHomepageUrl] = useState('https://www.tiktok.com')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (): Promise<void> => {
    if (!name.trim()) return
    setSaving(true)
    try {
      await window.hnv.profiles.create({ namePrefix: name.trim(), quantity: qty, groupId, homepageUrl, notes })
      onCreated()
    } finally {
      setSaving(false)
    }
  }

  const importTxt = async (): Promise<void> => {
    setSaving(true)
    try {
      const res = await window.hnv.profiles.importTxt()
      if (res === null) return // user cancelled
      showToast(`Đã tạo ${res.created} profile${res.failed > 0 ? `, ${res.failed} dòng lỗi/bỏ qua` : ''}`, 'success')
      onCreated()
    } catch (e: any) {
      showToast(`Lỗi: ${e?.message ?? String(e)}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Overlay onClose={onClose}>
      <div className="w-[560px] bg-[#0d0e14] border border-border rounded-[14px] shadow-2xl overflow-hidden">
        <div className="px-[22px] py-[18px] border-b border-borderSoft flex items-center">
          <div className="text-[18px] font-bold">Tạo Profile mới</div>
          <button onClick={onClose} className="ml-auto text-muted text-lg">✕</button>
        </div>

        {/* Mode toggle */}
        <div className="px-[22px] pt-[18px] flex gap-2.5">
          <button
            onClick={() => setMode('manual')}
            className={'flex-1 rounded-[10px] px-3.5 py-2.5 text-[14px] border ' + (mode === 'manual' ? 'text-white font-semibold border-[#3a3d6b] bg-[linear-gradient(100deg,rgba(99,102,241,.2),rgba(34,211,238,.08))]' : 'text-subtle border-border bg-[#101117]')}
          >
            ✏️ Thủ công
          </button>
          <button
            onClick={() => setMode('txt')}
            className={'flex-1 rounded-[10px] px-3.5 py-2.5 text-[14px] border ' + (mode === 'txt' ? 'text-white font-semibold border-[#3a3d6b] bg-[linear-gradient(100deg,rgba(99,102,241,.2),rgba(34,211,238,.08))]' : 'text-subtle border-border bg-[#101117]')}
          >
            📁 Từ file .txt
          </button>
        </div>

        {mode === 'manual' ? (
          <>
            <div className="hv-scroll px-[22px] py-[22px] max-h-[420px] overflow-y-auto">
              <Field label="Tên profile (tiền tố khi tạo nhiều)">
                <input className="inp" value={name} onChange={(e) => setName(e.target.value)} />
                {qty > 1 && (
                  <div className="text-[12px] text-muted mt-1.5">
                    Sẽ tạo: {name}1, {name}2, … {name}{qty}
                  </div>
                )}
              </Field>

              <div className="bg-card border border-borderSoft rounded-[11px] p-4 mb-4">
                <div className="flex items-center mb-3">
                  <div className="text-[14px] font-semibold">Số lượng profile</div>
                  <div className="ml-auto min-w-[46px] text-center accent-grad text-[#0a0b10] font-extrabold text-[16px] px-3 py-1 rounded-[9px]">
                    {qty}
                  </div>
                </div>
                <input type="range" min={1} max={50} value={qty} onChange={(e) => setQty(Number(e.target.value))} className="hv-range" />
                <div className="flex justify-between text-[11px] text-muted mt-1.5">
                  <span>1</span>
                  <span>50</span>
                </div>
              </div>

              <Field label="Nhóm">
                <GroupSelect groups={groups} value={groupId} onChange={setGroupId} />
              </Field>

              <Field label="Trang chủ mặc định (mở khi Run)">
                <input className="inp" value={homepageUrl} onChange={(e) => setHomepageUrl(e.target.value)} placeholder="vd: https://www.tiktok.com — để trống = tab mới" />
              </Field>

              <Field label="Proxy">
                <div className="inp flex items-center">
                  <Flag code={machineIp?.countryCode} w={20} />
                  <b>Dùng IP máy của bạn</b>
                  <span className="text-subtle ml-2">{machineIp?.ip ?? ''} · không proxy</span>
                  <span className="text-ok ml-auto">● mặc định</span>
                </div>
                <div className="text-[12px] text-muted mt-1.5">ℹ️ Gán proxy riêng cho từng profile sau, trong ⚙️ Cài đặt.</div>
              </Field>

              <div className="bg-card border border-borderSoft rounded-[11px] p-3.5 mb-4">
                <div className="text-[14px] font-semibold">
                  🫆 Fingerprint <span className="text-[12px] text-ok font-normal ml-1.5">tự sinh ngẫu nhiên</span>
                </div>
                <div className="text-[12px] text-muted mt-2">
                  OS / trình duyệt / màn hình / WebGL / canvas… random độc lập cho từng profile.
                </div>
              </div>

              <Field label="Ghi chú">
                <textarea className="inp h-[54px] resize-none" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="vd: email, ghi chú riêng..." />
              </Field>
            </div>

            <div className="px-[22px] py-4 border-t border-borderSoft flex gap-2.5 justify-end items-center">
              <div className="mr-auto text-[13px] text-muted">Sẽ tạo <b className="text-accent2">{qty}</b> profile</div>
              <button onClick={onClose} className="bg-surface text-[#c7c8d4] border border-border rounded-[9px] px-[18px] py-2.5 text-[14px]">Hủy</button>
              <button onClick={submit} disabled={saving} className="accent-grad text-[#0a0b10] font-bold rounded-[9px] px-[22px] py-2.5 text-[14px] disabled:opacity-50">
                {saving ? 'Đang tạo…' : `Tạo ${qty} profile`}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="px-[22px] py-[22px]">
              <div className="bg-card border border-borderSoft rounded-[11px] p-4 mb-4">
                <div className="text-[14px] font-semibold mb-2">Định dạng file .txt</div>
                <div className="font-mono text-[13px] text-accent2 bg-[#0a0b10] rounded-lg px-3 py-2 mb-3">
                  username|password|2fa_secret
                </div>
                <div className="text-[12px] text-muted space-y-1">
                  <div>• Mỗi dòng = 1 account = 1 profile</div>
                  <div>• Tên profile = username</div>
                  <div>• Dòng sai định dạng sẽ bị bỏ qua</div>
                </div>
              </div>
            </div>

            <div className="px-[22px] py-4 border-t border-borderSoft flex gap-2.5 justify-end items-center">
              <button onClick={onClose} className="bg-surface text-[#c7c8d4] border border-border rounded-[9px] px-[18px] py-2.5 text-[14px]">Hủy</button>
              <button onClick={importTxt} disabled={saving} className="accent-grad text-[#0a0b10] font-bold rounded-[9px] px-[22px] py-2.5 text-[14px] disabled:opacity-50">
                {saving ? 'Đang nhập…' : '📁 Chọn file .txt'}
              </button>
            </div>
          </>
        )}
      </div>
    </Overlay>
  )
}

export function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }): JSX.Element {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      {children}
    </div>
  )
}

export function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="mb-4">
      <div className="text-[13px] text-subtle mb-1.5">{label}</div>
      {children}
    </div>
  )
}
