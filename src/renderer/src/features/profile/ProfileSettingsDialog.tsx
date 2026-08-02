import { useEffect, useState } from 'react'
import { Overlay } from './NewProfileDialog'
import { GroupSelect } from './GroupSelect'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Flag } from '../../components/Flag'
import type { Group, Profile, Proxy, UploadLogEntry } from '@shared/types'

function fmtTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })
}

function Sec({ title }: { title: string }): JSX.Element {
  return <div className="text-[12px] uppercase tracking-wide text-muted font-bold mb-2.5">{title}</div>
}
function L({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="text-[13px] text-subtle mb-1.5">{children}</div>
}

// Dropdown chọn proxy có Flag thật (native <option> không render được ảnh).
function ProxySelect({
  proxies,
  value,
  onChange
}: {
  proxies: Proxy[]
  value: string | null // proxyId đang chọn, null = IP máy
  onChange: (proxyId: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const sel = value ? proxies.find((p) => p.id === value) : null

  const Row = ({ p }: { p: Proxy }): JSX.Element => (
    <span className="inline-flex items-center">
      <Flag code={p.countryCode} w={20} />
      <span className="font-mono">{p.ip ?? `${p.host}:${p.port}`}</span>
      {p.alive === false ? (
        <span className="text-danger ml-2 text-[12px]">● chết</span>
      ) : p.alive === true ? (
        <span className="text-ok ml-2 text-[12px]">● sống</span>
      ) : null}
    </span>
  )

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inp flex items-center text-left w-full"
      >
        {sel ? <Row p={sel} /> : <span className="text-subtle">Dùng IP máy thật (không proxy)</span>}
        <span className="ml-auto text-muted">▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 mt-1 w-full max-h-[260px] overflow-y-auto hv-scroll bg-[#0d0e14] border border-border rounded-[10px] shadow-2xl">
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false) }}
              className="w-full text-left px-3 py-2.5 text-[14px] text-subtle hover:bg-surface"
            >
              Dùng IP máy thật (không proxy)
            </button>
            {proxies.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => { onChange(p.id); setOpen(false) }}
                className={'w-full text-left px-3 py-2.5 text-[14px] hover:bg-surface ' + (p.id === value ? 'bg-surface' : '')}
              >
                <Row p={p} />
              </button>
            ))}
            {proxies.length === 0 && <div className="px-3 py-2.5 text-[13px] text-muted">Chưa có proxy.</div>}
          </div>
        </>
      )}
    </div>
  )
}

export function ProfileSettingsDialog({
  profile,
  groups,
  onClose,
  onSaved,
  onDeleted
}: {
  profile: Profile
  groups: Group[]
  onClose: () => void
  onSaved: () => void
  onDeleted: () => void
}): JSX.Element {
  const [p, setP] = useState<Profile>(structuredClone(profile))
  const [saving, setSaving] = useState(false)
  const [history, setHistory] = useState<UploadLogEntry[]>([])
  const [proxies, setProxies] = useState<Proxy[]>([])
  const [confirmingDel, setConfirmingDel] = useState(false)

  useEffect(() => {
    window.hnv.profiles.uploadHistory(profile.id).then(setHistory)
    window.hnv.proxies.list().then(setProxies)
  }, [profile.id])

  const px = p.proxy
  const fp = p.fingerprint
  const setProxy = (patch: Partial<typeof px>): void => setP({ ...p, proxy: { ...px, ...patch } })
  const setFp = (patch: Partial<typeof fp>): void => setP({ ...p, fingerprint: { ...fp, ...patch } })

  // Chọn proxy từ pool: copy config vào profile.proxy + lưu proxyId.
  const selectProxy = (proxyId: string): void => {
    if (!proxyId) {
      setP({ ...p, proxyId: null, proxy: { ...px, useProxy: false } })
      return
    }
    const pr = proxies.find((x) => x.id === proxyId)
    if (!pr) return
    setP({
      ...p,
      proxyId: pr.id,
      proxy: { useProxy: true, type: pr.type, host: pr.host, port: pr.port, username: pr.username, password: pr.password }
    })
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await window.hnv.profiles.update(p)
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  const del = async (): Promise<void> => {
    setConfirmingDel(false)
    await window.hnv.profiles.remove(p.id)
    onDeleted()
  }

  return (
    <Overlay onClose={onClose}>
      <div className="w-[620px] bg-[#0d0e14] border border-border rounded-[14px] shadow-2xl overflow-hidden">
        <div className="px-[22px] py-[18px] border-b border-borderSoft flex items-center">
          <div className="text-[18px] font-bold">
            Cài đặt — <span className="text-accent2">{p.name}</span>
          </div>
          <button onClick={onClose} className="ml-auto text-muted text-lg">✕</button>
        </div>

        <div className="hv-scroll px-[22px] py-5 h-[400px] overflow-y-auto">
          {/* CHUNG */}
          <Sec title="Chung" />
          <div className="bg-card border border-borderSoft rounded-[12px] p-4 mb-4">
            <div className="mb-3.5">
              <L>Tên profile</L>
              <input className="inp" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
            </div>
            <div className="mb-3.5">
              <L>Nhóm</L>
              <GroupSelect groups={groups} value={p.groupId} onChange={(id) => setP({ ...p, groupId: id })} />
            </div>
            <div className="mb-3.5">
              <L>Trang chủ mặc định (mở khi Run)</L>
              <input
                className="inp"
                value={p.homepageUrl}
                onChange={(e) => setP({ ...p, homepageUrl: e.target.value })}
                placeholder="vd: https://www.tiktok.com — để trống = tab mới"
              />
            </div>
            <div>
              <L>Ghi chú</L>
              <textarea className="inp h-[50px] resize-none" value={p.notes} onChange={(e) => setP({ ...p, notes: e.target.value })} />
            </div>
          </div>

          {/* TIKTOK ACCOUNT */}
          <Sec title="Tài khoản TikTok" />
          <div className="bg-card border border-borderSoft rounded-[12px] p-4 mb-4">
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <L>Username</L>
                <input className="inp" value={p.tiktokUsername} onChange={(e) => setP({ ...p, tiktokUsername: e.target.value })} placeholder="vd: kiu.quc.my8" />
              </div>
              <div>
                <L>Password</L>
                <input className="inp" type="password" value={p.tiktokPassword} onChange={(e) => setP({ ...p, tiktokPassword: e.target.value })} placeholder="Mật khẩu" />
              </div>
            </div>
            <div>
              <L>2FA Secret (chuỗi base32)</L>
              <input className="inp font-mono" value={p.tiktok2fa} onChange={(e) => setP({ ...p, tiktok2fa: e.target.value })} placeholder="vd: ES766LWTJU5DOQ3Z…" />
            </div>
          </div>

          {/* LỊCH SỬ UPLOAD */}
          <Sec title="Lịch sử upload" />
          <div className="bg-card border border-borderSoft rounded-[12px] p-4 mb-4">
            <div className="flex items-center mb-3">
              <div className="text-[13px] text-subtle">
                {history.length > 0 ? (
                  <>Lần cuối: <b className="text-accent2">{fmtTime(history[0].at)}</b> · tổng {history.length} video</>
                ) : (
                  'Chưa upload video nào'
                )}
              </div>
            </div>
            {history.length > 0 && (
              <div className="max-h-[160px] overflow-y-auto hv-scroll space-y-1.5">
                {history.map((h, i) => (
                  <div key={i} className="flex items-center text-[13px] gap-2">
                    <span className={h.status === 'done' ? 'text-ok' : 'text-danger'}>{h.status === 'done' ? '✓' : '✗'}</span>
                    <span className="truncate flex-1" title={h.videoName}>{h.videoName}</span>
                    <span className="text-muted text-[12px] shrink-0">{fmtTime(h.at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* PROXY */}
          <Sec title="Proxy" />
          <div className="bg-card border border-borderSoft rounded-[12px] p-4 mb-4">
            <L>Chọn proxy (từ pool đã cấu hình ở tab Proxy)</L>
            <ProxySelect proxies={proxies} value={px.useProxy ? (p.proxyId ?? null) : null} onChange={selectProxy} />
            {proxies.length === 0 && (
              <div className="mt-2 text-[12px] text-muted">
                Chưa có proxy nào — thêm ở tab <b className="text-accent2">🌐 Proxy</b>.
              </div>
            )}
          </div>

          {/* FINGERPRINT */}
          <Sec title="Fingerprint (ShardX)" />
          <div className="bg-card border border-borderSoft rounded-[12px] p-4">
            <div className="flex items-center mb-3.5">
              <div className="text-[13px] text-subtle">
                Thiết bị (GPU, màn hình, CPU, RAM, font, TLS) do ShardX chọn tự động khi tạo profile —
                các ô mờ là giá trị thật đang chạy, chỉ để xem.
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><L>Thiết bị / GPU</L><div className="inp font-mono text-[12px] truncate" title={fp.webgl.renderer || fp.deviceId}>{fp.webgl.renderer || fp.deviceId || '—'}</div></div>
              {/* Nền tảng chỉ để xem: đổi Windows→macOS phải đổi CẢ template thiết bị
                  (user-agent, client hints, GPU, màn hình, font), không phải đổi một
                  chuỗi. Trước đây ô này chỉ đổi chữ trên UI còn trình duyệt vẫn chạy
                  template Windows — UI nói dối. */}
              <div>
                <L>Nền tảng</L>
                <div className="inp text-[13px] opacity-70">
                  {fp.platform === 'macos' ? 'macOS' : fp.platform === 'linux' ? 'Linux' : 'Windows'}
                </div>
              </div>
              <div><L>Trình duyệt</L><div className="inp text-[12px] truncate" title={fp.userAgent}>{fp.userAgent || '—'}</div></div>
              {/* CPU cores / RAM cũng chỉ để xem: ShardX gán cặp này theo máy thật
                  (randomizeHardware — số nhân bám quanh CPU host, RAM có sàn theo số
                  nhân). Cho sửa tay sẽ tạo ra cấu hình bất khả thi kiểu 16 nhân/8 GB. */}
              <div>
                <L>CPU cores / RAM</L>
                <div className="inp text-[13px] opacity-70">
                  {fp.hardwareConcurrency} nhân · {fp.deviceMemory} GB
                </div>
              </div>
              <div><L>Màn hình</L><div className="inp text-[13px] opacity-70">{fp.screen.width} × {fp.screen.height}</div></div>
              <div>
                <L>WebRTC</L>
                <select
                  className="inp"
                  value={fp.webrtc}
                  onChange={(e) => setFp({ webrtc: e.target.value as Profile['fingerprint']['webrtc'] })}
                >
                  <option value="auto">Tự động — đi qua proxy, giữ QUIC</option>
                  <option value="tcp_only">Chỉ TCP</option>
                  <option value="block">Chặn hoàn toàn</option>
                </select>
              </div>
              <div>
                <L>Ngôn ngữ</L>
                <input
                  className="inp"
                  value={fp.language}
                  onChange={(e) => {
                    const v = e.target.value
                    // 'auto' = để ShardX suy ra locale từ IP của proxy lúc mở
                    // (nó tự ghi đồng bộ cả language/languages/accept_language/
                    // icu_locale). Nhập tay một tag cụ thể thì cũng ghi đủ bốn.
                    setFp({ language: v, languages: v === 'auto' ? [] : [v, v.split('-')[0]] })
                  }}
                  placeholder="auto = theo quốc gia của proxy, hoặc vd: vi-VN"
                />
              </div>
              <div>
                <L>Múi giờ</L>
                <input
                  className="inp"
                  value={fp.timezone}
                  onChange={(e) => setFp({ timezone: e.target.value })}
                  placeholder="auto = theo quốc gia của proxy, hoặc vd: Asia/Ho_Chi_Minh"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="px-[22px] py-4 border-t border-borderSoft flex gap-2.5 justify-end items-center">
          <button onClick={() => setConfirmingDel(true)} className="mr-auto text-danger border border-[#5a2c33] bg-[rgba(251,113,133,.10)] rounded-[9px] px-[22px] py-2.5 text-[14px] font-semibold">🗑 Xóa profile</button>
          <button onClick={onClose} className="bg-surface text-[#c7c8d4] border border-border rounded-[9px] px-[18px] py-2.5 text-[14px]">Hủy</button>
          <button onClick={save} disabled={saving} className="accent-grad text-[#0a0b10] font-bold rounded-[9px] px-[22px] py-2.5 text-[14px] disabled:opacity-50">
            {saving ? 'Đang lưu…' : 'Lưu'}
          </button>
        </div>
      </div>
      {confirmingDel && (
        <ConfirmDialog
          title="Xóa profile"
          message={`Xóa profile "${p.name}"?\nThư mục dữ liệu (session, cookie…) cũng bị xóa. Không thể hoàn tác.`}
          confirmText="🗑 Xóa"
          onConfirm={del}
          onCancel={() => setConfirmingDel(false)}
        />
      )}
    </Overlay>
  )
}
