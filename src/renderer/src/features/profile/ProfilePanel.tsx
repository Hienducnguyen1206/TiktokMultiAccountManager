import { useEffect, useState } from 'react'
import { GroupSelect } from './GroupSelect'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Flag } from '../../components/Flag'
import { Select } from '../../components/Select'
import { Segmented } from '../../components/Segmented'
import { showToast } from '../../components/uiDialogs'
import type { Group, NoiseVector, Profile, Proxy } from '@shared/types'

// Group title, matches mockups/profile.html `.grp` / `.grp.late`.
function Grp({ children, late }: { children: React.ReactNode; late?: boolean }): JSX.Element {
  return (
    <div
      className={`text-[11.5px] uppercase tracking-[.06em] font-bold text-[#818cf8] mb-3 flex items-center gap-[7px] ${late ? 'mt-[22px]' : ''}`}
    >
      <span className="text-[9px]">◆</span>
      {children}
    </div>
  )
}

// Field label, matches mockups/profile.html `.f > label`.
function Lbl({ children }: { children: React.ReactNode }): JSX.Element {
  return <label className="block text-[12.5px] text-muted mb-1.5">{children}</label>
}

// Small muted hint line under a field, matches mockups/profile.html `.note`.
function Note({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="text-[12px] text-muted mt-[5px] leading-relaxed">{children}</div>
}

const WARNING_OPTIONS = [0, 1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))

const LANGUAGE_OPTIONS = [
  { value: 'auto', label: 'Tự động (theo proxy)' },
  { value: 'vi-VN', label: 'vi-VN' },
  { value: 'en-US', label: 'en-US' }
]

// Fixed timezone presets shown in the dropdown. 'auto' means "let ShardX derive
// the timezone from the proxy's country"; the rest are common IANA zones. Any
// other IANA string is entered by hand through the input revealed below (see
// TIMEZONE_CUSTOM / tzManual state) — the underlying field is a free-form
// string, we're just giving the common cases a themed dropdown.
const TIMEZONE_PRESETS = [
  { value: 'auto', label: 'Tự động (theo proxy)' },
  { value: 'Asia/Ho_Chi_Minh', label: 'Asia/Ho_Chi_Minh' },
  { value: 'America/New_York', label: 'America/New_York' }
]
const TIMEZONE_CUSTOM = '__custom__'

// Shared by the initial useState and the profile-switch useEffect below, so the
// "is this a preset or a hand-typed zone" check can't drift between the two.
function computeTzManual(timezone: string): boolean {
  return !TIMEZONE_PRESETS.some((o) => o.value === timezone)
}

const WEBRTC_OPTIONS = [
  { value: 'auto', label: 'Tự động — qua proxy, giữ QUIC' },
  { value: 'tcp_only', label: 'Chỉ TCP' },
  { value: 'block', label: 'Chặn hoàn toàn' }
]

const NOISE_OPTIONS = [
  { value: 'real', label: 'Thật' },
  { value: 'noise', label: 'Nhiễu' }
]

const VECTORS: { key: NoiseVector; label: string }[] = [
  { key: 'canvas', label: 'Canvas' },
  { key: 'webgl', label: 'WebGL' },
  { key: 'audio', label: 'Audio' },
  { key: 'client_rects', label: 'Client rects' },
  { key: 'sensors', label: 'Cảm biến' },
  { key: 'fonts', label: 'Font' }
]

function toggleNoise(cur: NoiseVector[], v: NoiseVector, on: boolean): NoiseVector[] {
  const next = cur.filter((x) => x !== v)
  return on ? [...next, v] : next
}

// Proxy dropdown with a real flag image — the shared `Select` only renders plain
// text labels, so it can't show the country flag. Copied from
// ProfileSettingsDialog.tsx (same window.hnv calls, same state shape).
function ProxySelect({
  proxies,
  value,
  onChange
}: {
  proxies: Proxy[]
  value: string | null // selected proxyId, null = machine IP
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
      <button type="button" onClick={() => setOpen((o) => !o)} className="inp flex items-center text-left w-full">
        {sel ? <Row p={sel} /> : <span className="text-subtle">Dùng IP máy thật (không proxy)</span>}
        <span className="ml-auto text-muted">▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 mt-1 w-full max-h-[260px] overflow-y-auto hv-scroll bg-[#0d0e14] border border-border rounded-[10px] shadow-2xl">
            <button
              type="button"
              onClick={() => {
                onChange('')
                setOpen(false)
              }}
              className="w-full text-left px-3 py-2.5 text-[14px] text-subtle hover:bg-surface"
            >
              Dùng IP máy thật (không proxy)
            </button>
            {proxies.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onChange(p.id)
                  setOpen(false)
                }}
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

export function ProfilePanel({
  profile,
  groups,
  proxies,
  onSaved,
  onClose
}: {
  profile: Profile
  groups: Group[]
  proxies: Proxy[]
  onSaved: () => void
  onClose: () => void
}): JSX.Element {
  const [p, setP] = useState<Profile>(structuredClone(profile))
  const [saving, setSaving] = useState(false)
  const [confirmingDel, setConfirmingDel] = useState(false)
  // UI-only: whether the timezone field is in "type it yourself" mode. Derived
  // once from the initial value so an existing custom IANA string opens already
  // expanded; after that it only changes when the user picks it explicitly.
  const [tzManual, setTzManual] = useState(() => computeTzManual(profile.fingerprint.timezone))

  // ProfilePanel is a shared component — whoever mounts it may reuse the same
  // instance for a different profile instead of remounting (e.g. no `key` on
  // the wrapper). Without this, switching from profile A to profile B while A
  // has unsaved edits would keep showing A's edited fields, and "Lưu thay đổi"
  // would silently call profiles.update() with B's id but A's stale data.
  // Re-sync every piece of local state whenever the profile identity changes.
  // Depends on `profile.id` only (not the whole `profile` object) so a parent
  // re-render that hands down a new-but-equal profile object doesn't wipe
  // in-progress edits on every keystroke elsewhere in the app.
  useEffect(() => {
    setP(structuredClone(profile))
    setSaving(false)
    setConfirmingDel(false)
    setTzManual(computeTzManual(profile.fingerprint.timezone))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id])

  const px = p.proxy
  const fp = p.fingerprint
  const setFp = (patch: Partial<typeof fp>): void => setP({ ...p, fingerprint: { ...fp, ...patch } })

  // Pick a proxy from the pool: copies its config into profile.proxy + stores proxyId.
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
  const selectedProxy = px.useProxy && p.proxyId ? (proxies.find((x) => x.id === p.proxyId) ?? null) : null

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await window.hnv.profiles.update(p)
      onSaved()
    } catch (e) {
      // An IPC error here (e.g. the group got deleted elsewhere while this panel
      // was open) must not fail silently — otherwise the user has no idea why
      // "Lưu thay đổi" did nothing.
      showToast((e as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  // No dedicated onDeleted callback in this component's props (only onSaved /
  // onClose) — reuse onSaved so the caller reloads its profile list, which
  // makes the now-deleted row disappear.
  const del = async (): Promise<void> => {
    setConfirmingDel(false)
    await window.hnv.profiles.remove(p.id)
    onSaved()
  }

  return (
    <>
      <div className="p-[18px_20px_16px] border-t border-borderSoft">
        <div className="grid grid-cols-3 gap-[26px]">
          {/* ===== Cột 1 — Danh tính ===== */}
          <div>
            <Grp>Danh tính</Grp>

            <div className="mb-3">
              <Lbl>Tên profile</Lbl>
              <input className="inp" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <Lbl>Nhóm</Lbl>
                <GroupSelect groups={groups} value={p.groupId} onChange={(id) => setP({ ...p, groupId: id })} />
              </div>
              <div>
                <Lbl>Cảnh báo</Lbl>
                <Segmented
                  value={String(p.warningLevel)}
                  options={WARNING_OPTIONS}
                  onChange={(v) => setP({ ...p, warningLevel: Number(v) })}
                  tone="soft"
                  size="sm"
                />
              </div>
            </div>

            {/* Read-only: switching Windows <-> macOS <-> Linux means swapping the
                ENTIRE ShardX device template (user-agent, client hints, GPU, screen,
                fonts) — not just this one string. Making it clickable would let the
                UI claim a platform the running browser doesn't actually have. */}
            <div className="mb-3">
              <Lbl>Hệ điều hành</Lbl>
              <div className="inp text-[13px] opacity-70">
                {fp.platform === 'macos' ? 'macOS' : fp.platform === 'linux' ? 'Linux' : 'Windows'}
              </div>
              <Note>Do ShardX quản lý theo thiết bị thật — không đổi tay được ở đây.</Note>
            </div>

            {/* Read-only: chosen from the ShardX device library when the profile was
                created, tied 1:1 to the platform above. */}
            <div className="mb-3">
              <Lbl>
                Thiết bị / GPU <span className="text-[#54556a]">(từ thư viện)</span>
              </Lbl>
              <div className="inp font-mono text-[12px] truncate opacity-70" title={fp.webgl.renderer || fp.deviceId}>
                {fp.webgl.renderer || fp.deviceId || '—'}
              </div>
            </div>

            {/* Read-only: the engine normalizes this itself from the device template. */}
            <div className="mb-3">
              <Lbl>User-Agent</Lbl>
              <div className="inp font-mono text-[12px] truncate opacity-70" title={fp.userAgent}>
                {fp.userAgent || '—'}
              </div>
            </div>

            {/* Read-only: ShardX pairs these to the real host (randomizeHardware —
                core count stays close to the host CPU, RAM has a floor tied to core
                count). Letting the user pick freely could produce an impossible
                combo like 16 cores / 8 GB. */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <Lbl>CPU cores / RAM</Lbl>
                <div className="inp text-[13px] opacity-70">
                  {fp.hardwareConcurrency} nhân · {fp.deviceMemory} GB
                </div>
              </div>
              <div>
                <Lbl>Màn hình</Lbl>
                <div className="inp text-[13px] opacity-70">
                  {fp.screen.width} × {fp.screen.height}
                </div>
              </div>
            </div>

            <div>
              <Lbl>Proxy</Lbl>
              <ProxySelect proxies={proxies} value={px.useProxy ? (p.proxyId ?? null) : null} onChange={selectProxy} />
              {selectedProxy &&
                (selectedProxy.udpMs == null ? (
                  <Note>Chưa đo UDP/QUIC — mở profile một lần để đo.</Note>
                ) : (
                  <Note>
                    {selectedProxy.quicOk ? 'QUIC bật' : 'Chỉ TCP'} · {selectedProxy.udpMs} ms
                  </Note>
                ))}
            </div>
          </div>

          {/* ===== Cột 2 — Khu vực + Nhiễu ===== */}
          <div>
            <Grp>Khu vực</Grp>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <Lbl>Múi giờ</Lbl>
                <Select
                  value={tzManual ? TIMEZONE_CUSTOM : fp.timezone}
                  options={[...TIMEZONE_PRESETS, { value: TIMEZONE_CUSTOM, label: 'Nhập tay…' }]}
                  onChange={(v) => {
                    if (v === TIMEZONE_CUSTOM) {
                      setTzManual(true)
                    } else {
                      setTzManual(false)
                      setFp({ timezone: v })
                    }
                  }}
                />
                {tzManual && (
                  <input
                    className="inp mt-1.5"
                    value={fp.timezone}
                    onChange={(e) => setFp({ timezone: e.target.value })}
                    placeholder="vd: Asia/Ho_Chi_Minh"
                  />
                )}
              </div>
              <div>
                <Lbl>Ngôn ngữ</Lbl>
                <Select
                  value={fp.language}
                  options={LANGUAGE_OPTIONS}
                  onChange={(v) => {
                    // 'auto' = let ShardX derive the locale from the proxy's IP when
                    // it launches (it keeps language/languages/accept_language/
                    // icu_locale in sync itself). A specific tag writes all four too.
                    setFp({ language: v, languages: v === 'auto' ? [] : [v, v.split('-')[0]] })
                  }}
                />
              </div>
            </div>

            <Grp late>Nhiễu</Grp>
            <div className="text-[12px] text-muted mb-3 leading-relaxed">
              Để <b>Thật</b> khi mỗi profile dùng một thiết bị khác nhau. Chỉ bật nhiễu khi nhiều profile chung một thiết bị.
            </div>

            {[0, 2, 4].map((i) => (
              <div key={i} className="grid grid-cols-2 gap-3 mb-3">
                {VECTORS.slice(i, i + 2).map((v) => (
                  <div key={v.key}>
                    <Lbl>{v.label}</Lbl>
                    <Segmented
                      value={fp.noise.includes(v.key) ? 'noise' : 'real'}
                      options={NOISE_OPTIONS}
                      onChange={(val) => setFp({ noise: toggleNoise(fp.noise, v.key, val === 'noise') })}
                      tone="soft"
                      size="sm"
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* ===== Cột 3 — Riêng tư + TikTok ===== */}
          <div>
            <Grp>Riêng tư</Grp>

            <div className="mb-3">
              <Lbl>WebRTC</Lbl>
              <Select
                value={fp.webrtc}
                options={WEBRTC_OPTIONS}
                onChange={(v) => setFp({ webrtc: v as Profile['fingerprint']['webrtc'] })}
              />
            </div>

            <Grp late>TikTok</Grp>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <Lbl>Tài khoản</Lbl>
                <input
                  className="inp"
                  value={p.tiktokUsername}
                  onChange={(e) => setP({ ...p, tiktokUsername: e.target.value })}
                  placeholder="vd: kiu.quc.my8"
                />
              </div>
              <div>
                <Lbl>Mật khẩu</Lbl>
                <input
                  className="inp"
                  type="password"
                  value={p.tiktokPassword}
                  onChange={(e) => setP({ ...p, tiktokPassword: e.target.value })}
                  placeholder="Mật khẩu"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <Lbl>Mã 2FA</Lbl>
                <input
                  className="inp font-mono"
                  value={p.tiktok2fa}
                  onChange={(e) => setP({ ...p, tiktok2fa: e.target.value })}
                  placeholder="vd: ES766LWTJU5DOQ3Z…"
                />
              </div>
              <div>
                <Lbl>Trang chủ</Lbl>
                <input
                  className="inp"
                  value={p.homepageUrl}
                  onChange={(e) => setP({ ...p, homepageUrl: e.target.value })}
                  placeholder="vd: https://www.tiktok.com — để trống = tab mới"
                />
              </div>
            </div>

            <div>
              <Lbl>Ghi chú</Lbl>
              <textarea
                className="inp resize-none h-[74px]"
                value={p.notes}
                onChange={(e) => setP({ ...p, notes: e.target.value })}
                placeholder="Ghi chú tự do…"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2.5 px-5 py-4 border-t border-borderSoft">
        <button
          onClick={() => setConfirmingDel(true)}
          className="mr-auto text-danger border border-[#5a2c33] bg-[rgba(251,113,133,.10)] rounded-[9px] px-[22px] py-2.5 text-[14px] font-semibold"
        >
          🗑 Xóa profile
        </button>
        <button onClick={onClose} className="bg-surface text-[#c7c8d4] border border-border rounded-[9px] px-[18px] py-2.5 text-[14px]">
          Hủy
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="accent-grad text-[#0a0b10] font-bold rounded-[9px] px-[22px] py-2.5 text-[14px] disabled:opacity-50"
        >
          {saving ? 'Đang lưu…' : '◆ Lưu thay đổi'}
        </button>
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
    </>
  )
}
