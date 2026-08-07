import { useEffect, useState } from 'react'
import { GroupSelect } from './GroupSelect'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Flag } from '../../components/Flag'
import { Icon } from '../../components/Icon'
import { Select } from '../../components/Select'
import { Segmented } from '../../components/Segmented'
import { Toggle } from '../../components/Toggle'
import { showToast } from '../../components/uiDialogs'
import type { DeviceList, Fingerprint, Group, NoiseVector, Profile, Proxy } from '@shared/types'

// Tiêu đề nhóm, theo mockups/profile.html `.grp`.
// Bỏ biến thể `.grp.late` (thêm mt-22px): nó dùng cho nhóm thứ hai nằm chung
// một cột với nhóm khác. Giờ mỗi nhóm là một khối riêng có khung, khoảng cách
// do mb-4 của khối lo, nên không còn chỗ nào cần nó.
function Grp({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    // text-grad: cùng dải gradient với chữ "HienNVAuto" ở sidebar (xem index.css).
    <div className="text-[11.5px] uppercase tracking-[.06em] font-bold text-grad mb-3 flex items-center gap-[7px]">
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

const WARNING_OPTIONS = [0, 1, 2, 3, 4, 5].map((n) => ({
  value: String(n),
  label: String(n),
}))

// Fixed timezone presets shown in the dropdown. 'auto' means "let ShardX derive
// the timezone from the proxy's country"; the rest are common IANA zones. Any
// other IANA string is entered by hand through the input revealed below (see
// TIMEZONE_CUSTOM / tzManual state) — the underlying field is a free-form
// string, we're just giving the common cases a themed dropdown.
const TIMEZONE_PRESETS = [
  { value: 'auto', label: 'Tự động (theo proxy)' },
  { value: 'Asia/Ho_Chi_Minh', label: 'Asia/Ho_Chi_Minh' },
  { value: 'America/New_York', label: 'America/New_York' },
]
const TIMEZONE_CUSTOM = '__custom__'

// Shared by the initial useState and the profile-switch useEffect below, so the
// "is this a preset or a hand-typed zone" check can't drift between the two.
function computeTzManual(timezone: string): boolean {
  return !TIMEZONE_PRESETS.some((o) => o.value === timezone)
}

// Same idea as TIMEZONE_PRESETS above: 'auto' lets ShardX derive the locale from
// the proxy's IP, the rest are common BCP-47 tags. Any other tag (e.g. an
// existing profile with 'en-GB' or 'ja-JP') is entered by hand through the
// input revealed below (see LANGUAGE_CUSTOM / languageManual state) — same
// preset+manual pattern as the timezone field, so a value the dropdown doesn't
// recognize never gets silently shown as "not set" while still being saved.
const LANGUAGE_PRESETS = [
  { value: 'auto', label: 'Tự động (theo proxy)' },
  { value: 'vi-VN', label: 'vi-VN' },
  { value: 'en-US', label: 'en-US' },
]
const LANGUAGE_CUSTOM = '__custom__'

function computeLanguageManual(language: string): boolean {
  return !LANGUAGE_PRESETS.some((o) => o.value === language)
}

const WEBRTC_OPTIONS = [
  { value: 'auto', label: 'Tự động — qua proxy, giữ QUIC' },
  { value: 'tcp_only', label: 'Chỉ TCP' },
  { value: 'block', label: 'Chặn hoàn toàn' },
]

const OS_OPTIONS: { value: Fingerprint['platform']; label: string }[] = [
  { value: 'macos', label: 'macOS' },
  { value: 'windows', label: 'Windows' },
  { value: 'linux', label: 'Linux' },
]

// Values actually present across ShardX's 170 bundled templates (surveyed by
// reading every navigator.hardware_concurrency / device_memory in the library),
// so a hand-picked pair still looks like a machine that exists. The engine
// really does honour these: a profile set to 12 cores reports 12 to the page on
// a 16-core host — measured, not assumed.
const CORE_OPTIONS = [2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32].map((n) => ({
  value: String(n),
  label: `${n} nhân`,
}))
const RAM_OPTIONS = [4, 8, 16, 32].map((n) => ({
  value: String(n),
  label: `${n} GB`,
}))

// Device lists already fetched this session, by platform. ProfilePanel is
// remounted from scratch every time a row is expanded (ProfileTab gives it
// key={profile.id} and only mounts it while open), so without this every open
// paid for another IPC round trip and flashed "Đang tải danh sách thiết bị…"
// over a list that had not changed. The main process caches it too — this saves
// the round trip and the flash, that saves the work.
const deviceCache = new Map<string, DeviceList>()

const GEO_OPTIONS = [
  { value: 'auto', label: 'Theo proxy' },
  { value: 'manual', label: 'Toạ độ tay' },
]

const VECTORS: { key: NoiseVector; label: string }[] = [
  { key: 'canvas', label: 'Canvas' },
  { key: 'webgl', label: 'WebGL' },
  { key: 'audio', label: 'Audio' },
  { key: 'client_rects', label: 'Client rects' },
  { key: 'sensors', label: 'Cảm biến' },
  { key: 'fonts', label: 'Font' },
]

function toggleNoise(cur: NoiseVector[], v: NoiseVector, on: boolean): NoiseVector[] {
  const next = cur.filter((x) => x !== v)
  return on ? [...next, v] : next
}

// Proxy dropdown with a real flag image — the shared `Select` only renders plain
// text labels, so it can't show the country flag. Uses same window.hnv calls and
// state shape as the old modal that was replaced by this inline panel.
function ProxySelect({
  proxies,
  value,
  rawProxy,
  onChange,
}: {
  proxies: Proxy[]
  value: string | null // selected proxyId, null = machine IP
  rawProxy: Profile['proxy'] // fallback source when useProxy=true but the pool has no matching entry
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
        {sel ? (
          <Row p={sel} />
        ) : rawProxy.useProxy ? (
          // useProxy=true but no pool entry matched value (pool still loading,
          // proxies.list() failed, or this profile's proxy was hand-configured
          // before proxyId existed) — show the profile's own host:port instead
          // of falsely claiming "no proxy".
          <span className="font-mono text-subtle">
            {rawProxy.host}:{rawProxy.port}
          </span>
        ) : (
          <span className="text-subtle">Dùng IP máy thật (không proxy)</span>
        )}
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
                className={
                  'w-full text-left px-3 py-2.5 text-[14px] hover:bg-surface ' + (p.id === value ? 'bg-surface' : '')
                }
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
  onClose,
}: {
  profile: Profile
  groups: Group[]
  proxies: Proxy[]
  onSaved: () => void
  onClose: () => void
}): JSX.Element {
  const [p, setP] = useState<Profile>(() => structuredClone(profile))
  const [saving, setSaving] = useState(false)
  const [confirmingDel, setConfirmingDel] = useState(false)
  // UI-only: whether the timezone field is in "type it yourself" mode. Derived
  // once from the initial value so an existing custom IANA string opens already
  // expanded; after that it only changes when the user picks it explicitly.
  const [tzManual, setTzManual] = useState(() => computeTzManual(profile.fingerprint.timezone))
  // Same "type it yourself" concept as tzManual, for the language field.
  const [languageManual, setLanguageManual] = useState(() => computeLanguageManual(profile.fingerprint.language))
  // Which platform's device list the dropdown below is showing. Starts at the
  // profile's real platform; switching it only re-filters the list — nothing is
  // applied until "Lưu thay đổi", same as every other field in this panel.
  const [deviceOs, setDeviceOs] = useState<Fingerprint['platform']>(profile.fingerprint.platform)
  const [deviceId, setDeviceId] = useState(profile.fingerprint.deviceId)
  const [devices, setDevices] = useState<DeviceList>({ items: [], host: null })
  const [devicesMsg, setDevicesMsg] = useState('Đang tải danh sách thiết bị…')
  const [confirmingDevice, setConfirmingDevice] = useState(false)
  // Latitude/longitude are held as raw text, not numbers: a controlled
  // number input can't hold the intermediate states of typing ("-", "10.",
  // "") without them parsing to NaN and snapping the value back.
  const [latText, setLatText] = useState(() => String(profile.fingerprint.geolocation.latitude))
  const [lngText, setLngText] = useState(() => String(profile.fingerprint.geolocation.longitude))

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
    setConfirmingDevice(false)
    setTzManual(computeTzManual(profile.fingerprint.timezone))
    setLanguageManual(computeLanguageManual(profile.fingerprint.language))
    setDeviceOs(profile.fingerprint.platform)
    setDeviceId(profile.fingerprint.deviceId)
    setLatText(String(profile.fingerprint.geolocation.latitude))
    setLngText(String(profile.fingerprint.geolocation.longitude))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id])

  // Load the device list for whichever platform the segmented control shows.
  //
  // On a cache miss this reaches the SDK (`sdk.listProfiles()`), which
  // auto-installs the engine on first call — so on a machine that has never
  // launched a profile, opening this panel can start the engine download.
  // That's the same download "Mở" triggers, ProfileTab already renders a
  // progress bar for it, and the SDK memoises the check per process.
  useEffect(() => {
    let cancelled = false
    const cached = deviceCache.get(deviceOs)
    if (cached) {
      // Synchronous: no loading message, no flash, no round trip.
      setDevices(cached)
      setDevicesMsg(cached.items.length ? '' : 'Thư viện không có thiết bị nào cho hệ điều hành này')
      setDeviceId((cur) => (cur === '' || cached.items.includes(cur) ? cur : (cached.items[0] ?? '')))
      return
    }
    setDevices({ items: [], host: null })
    setDevicesMsg('Đang tải danh sách thiết bị…')
    window.hnv.profiles
      .devices(deviceOs)
      .then((list) => {
        if (cancelled) return
        const ids = list.items
        if (ids.length) deviceCache.set(deviceOs, list)
        setDevices(list)
        setDevicesMsg(ids.length ? '' : 'Thư viện không có thiết bị nào cho hệ điều hành này')
        // Keep the current pick when it belongs to this platform. When it
        // doesn't — the user just switched OS — move to the first device of the
        // new one, so the dropdown can never show a Windows device while the
        // segmented control says Linux.
        //
        // An empty deviceId is left alone on purpose: that means the profile has
        // never been launched and ShardX hasn't assigned it a device yet.
        // Auto-filling it here would make every fresh profile save the SAME
        // first template id — the cross-profile linkage this whole integration
        // exists to avoid.
        setDeviceId((cur) => (cur === '' || ids.includes(cur) ? cur : (ids[0] ?? '')))
      })
      .catch((e) => {
        // Offline, or the engine failed to install. The panel must stay usable
        // for every other field.
        if (!cancelled) setDevicesMsg(`Không tải được danh sách: ${(e as Error).message}`)
      })
    return () => {
      cancelled = true
    }
  }, [deviceOs])

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
      proxy: {
        useProxy: true,
        type: pr.type,
        host: pr.host,
        port: pr.port,
        username: pr.username,
        password: pr.password,
      },
    })
  }
  const selectedProxy = px.useProxy && p.proxyId ? (proxies.find((x) => x.id === p.proxyId) ?? null) : null

  // A device swap is a real backend operation (it rewrites the ShardX config and
  // re-rolls the hardware), not just a field on the row — so it is detected
  // against the SAVED profile, never against the local clone.
  const deviceChanged = deviceId !== '' && deviceId !== profile.fingerprint.deviceId

  const doSave = async (): Promise<void> => {
    setSaving(true)
    try {
      let next = p
      if (deviceChanged) {
        // Must run BEFORE update(). It rewrites the profile's fingerprint row,
        // and update() below writes `fingerprint` too — so doing it after would
        // let this panel's pre-swap clone overwrite the new device identity.
        const swapped = await window.hnv.profiles.changeDevice(p.id, deviceId)
        // `swapped` carries the new device identity (deviceId, platform,
        // user-agent, GPU, screen) plus the fresh hardware roll that came with
        // it. It was built in the main process from the SAVED row, so it knows
        // nothing about edits still sitting unsaved in this panel — carry those
        // over by hand. CPU/RAM deliberately are NOT carried over: they belong
        // to the device that was just swapped in.
        next = {
          ...p,
          fingerprint: {
            ...swapped,
            language: fp.language,
            languages: fp.languages,
            timezone: fp.timezone,
            webrtc: fp.webrtc,
            geolocation: fp.geolocation,
            noise: fp.noise,
          },
        }
        // Adopt it locally too: the panel stays open after saving, and its
        // useEffect only re-syncs when the profile *id* changes, so without this
        // the CPU/RAM/GPU fields would keep showing the old device.
        setP(next)
      }
      await window.hnv.profiles.update(next)
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

  const save = (): void => {
    // Swapping the device of a logged-in account changes user-agent, GPU, screen
    // and CPU all at once, mid-session — one of the loudest signals there is.
    // Worth one confirmation; harmless on a profile that isn't logged in.
    if (deviceChanged && profile.loggedIn) {
      setConfirmingDevice(true)
      return
    }
    void doSave()
  }

  // No dedicated onDeleted callback in this component's props (only onSaved /
  // onClose) — reuse onSaved so the caller reloads its profile list, which
  // makes the now-deleted row disappear.
  const del = async (): Promise<void> => {
    setConfirmingDel(false)
    try {
      await window.hnv.profiles.remove(p.id)
      onSaved()
    } catch (e) {
      // Same reasoning as save(): ConfirmDialog.onConfirm calls this without
      // await, so an unhandled IPC error here would otherwise become a silent
      // unhandled rejection — the panel just sits there with no explanation.
      showToast((e as Error).message, 'error')
    }
  }

  return (
    <>
      <div className="p-[18px_20px_16px] border-t border-borderSoft">
        {/* Ba cột grid, mỗi cột ôm hai nhóm. KHÔNG dùng column-count dù nó tự
            cân được: panel này render trong một <td> đặt width:0 (thủ thuật giữ
            ô colSpan ngoài phép tính bề rộng cột của bảng), mà column-count lấy
            bề rộng cột từ chính containing block đó nên tính ra 0 và tràn ngang.
            Đo thủ công: cân bằng bằng cách xếp nhóm dài với nhóm ngắn — số dòng
            mỗi cột là 148 / 135 / 137. */}
        <div className="grid grid-cols-3 gap-4 items-start">
          {/* ── Cột 1 ── */}
          <div className="flex flex-col gap-4">
            {/* ===== Thiết bị =====
              Tách khỏi "Danh tính" vì nhóm đó gộp hai thứ khác hẳn nhau: bên trên
              là hồ sơ của mình (tên, nhóm, cảnh báo, proxy), từ đây xuống là
              thông số máy giả lập. Gộp lại thì nhóm dài gấp đôi mọi nhóm khác —
              column-count không chia nhỏ được một khối, nên cột ôm nó luôn thừa. */}
            <div className="bg-card border border-borderSoft rounded-[12px] p-4">
              <Grp>Thiết bị</Grp>

              {/* Picking an OS here only re-filters the device list below — the two
                are one setting, because a platform IS a device template
                (user-agent, client hints, GPU, screen, fonts all travel together).
                Nothing is applied until "Lưu thay đổi". */}
              <div className="mb-3">
                <Lbl>Hệ điều hành</Lbl>
                <Segmented
                  value={deviceOs}
                  options={OS_OPTIONS}
                  onChange={(v) => setDeviceOs(v as Fingerprint['platform'])}
                  tone="soft"
                />
              </div>

              <div className="mb-3">
                <Lbl>Thiết bị / GPU</Lbl>
                <Select
                  value={deviceId}
                  // Deliberately no screen size in the hint: the engine now runs
                  // every profile on the host display (see SCREEN_MODE in
                  // ShardEngine), so a template's own claimed resolution is
                  // overwritten at launch and printing it here would mislead.
                  // What the device still decides is GPU, user-agent and fonts.
                  options={devices.items.map((d) => ({ value: d, label: d }))}
                  onChange={setDeviceId}
                  placeholder={devicesMsg || '— ShardX tự chọn khi mở lần đầu —'}
                />
                {deviceChanged && (
                  <Note>
                    <span className="text-[#f0b429]">
                      Đổi thiết bị sẽ thay toàn bộ vân tay (User-Agent, GPU, màn hình, CPU). Cookie đăng nhập vẫn giữ.
                    </span>
                  </Note>
                )}
                {!deviceChanged && fp.webgl.renderer && (
                  <Note>
                    <span className="font-mono text-[11.5px]">{fp.webgl.renderer}</span>
                  </Note>
                )}
              </div>

              {/* Read-only: the engine normalizes this itself from the device template. */}
              <div className="mb-3">
                <Lbl>User-Agent</Lbl>
                <div className="inp font-mono text-[12px] truncate opacity-70" title={fp.userAgent}>
                  {fp.userAgent || '—'}
                </div>
              </div>

              {/* ShardX seeds these per profile (randomizeHardware: cores bracket the
                real host CPU, RAM has a floor tied to core count) — so the values
                shown are already varied and believable. Editable because ShardX's
                own settings panel allows it, but the pairing is worth respecting:
                a machine with 24 cores and 4 GB doesn't exist. */}
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <Lbl>CPU cores</Lbl>
                  <Select
                    value={String(fp.hardwareConcurrency)}
                    options={CORE_OPTIONS}
                    onChange={(v) => setFp({ hardwareConcurrency: Number(v) })}
                  />
                </div>
                <div>
                  <Lbl>RAM</Lbl>
                  <Select
                    value={String(fp.deviceMemory)}
                    options={RAM_OPTIONS}
                    onChange={(v) => setFp({ deviceMemory: Number(v) })}
                  />
                </div>
              </div>

              {/* Read-only, and it shows the HOST display rather than the device
                template's own screen: every launch runs in 'use_host' (see
                SCREEN_MODE in ShardEngine), which rewrites screen.* and window.*
                with the real monitor so the window can open maximized while the
                page is told the same numbers. Printing the template's claimed
                screen here would name a resolution no launch ever reports. */}
              <div className="mb-3">
                <Lbl>Màn hình</Lbl>
                <div className="inp text-[13px] opacity-70">
                  {devices.host
                    ? `${devices.host.width} × ${devices.host.height}`
                    : `${fp.screen.width} × ${fp.screen.height}`}
                </div>
              </div>

              <div>
                <Lbl>Proxy</Lbl>
                <ProxySelect
                  proxies={proxies}
                  value={px.useProxy ? (p.proxyId ?? null) : null}
                  rawProxy={px}
                  onChange={selectProxy}
                />
                {selectedProxy &&
                  (selectedProxy.udpMs == null ? (
                    <Note>Chưa đo UDP/QUIC — mở hồ sơ một lần để đo.</Note>
                  ) : (
                    <Note>
                      {selectedProxy.quicOk ? 'QUIC bật' : 'Chỉ TCP'} · {selectedProxy.udpMs} ms
                    </Note>
                  ))}
              </div>
            </div>
          </div>

          {/* ── Cột 2 ── */}
          <div className="flex flex-col gap-4">
            {/* ===== Danh tính ===== */}
            <div className="bg-card border border-borderSoft rounded-[12px] p-4">
              <Grp>Danh tính</Grp>

              <div className="mb-3">
                <Lbl>Tên hồ sơ</Lbl>
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
            </div>

            {/* ===== Khu vực ===== */}
            <div className="bg-card border border-borderSoft rounded-[12px] p-4">
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
                    value={languageManual ? LANGUAGE_CUSTOM : fp.language}
                    options={[...LANGUAGE_PRESETS, { value: LANGUAGE_CUSTOM, label: 'Nhập tay…' }]}
                    onChange={(v) => {
                      if (v === LANGUAGE_CUSTOM) {
                        setLanguageManual(true)
                        return
                      }
                      setLanguageManual(false)
                      // 'auto' = let ShardX derive the locale from the proxy's IP when
                      // it launches (it keeps language/languages/accept_language/
                      // icu_locale in sync itself). A specific tag writes all four too.
                      setFp({
                        language: v,
                        languages: v === 'auto' ? [] : [v, v.split('-')[0]],
                      })
                    }}
                  />
                  {languageManual && (
                    <input
                      className="inp mt-1.5"
                      value={fp.language}
                      onChange={(e) => {
                        const v = e.target.value
                        setFp({
                          language: v,
                          languages: v ? [v, v.split('-')[0]] : [],
                        })
                      }}
                      placeholder="vd: ja-JP"
                    />
                  )}
                </div>
              </div>
            </div>

            {/* ===== Riêng tư ===== */}
            <div className="bg-card border border-borderSoft rounded-[12px] p-4">
              <Grp>Riêng tư</Grp>

              <div className="mb-3">
                <Lbl>WebRTC</Lbl>
                <Select
                  value={fp.webrtc}
                  options={WEBRTC_OPTIONS}
                  onChange={(v) => setFp({ webrtc: v as Profile['fingerprint']['webrtc'] })}
                />
              </div>

              <div className="mb-3">
                <Lbl>Vị trí</Lbl>
                <Segmented
                  value={fp.geolocation.mode}
                  options={GEO_OPTIONS}
                  onChange={(v) =>
                    setFp({
                      geolocation: {
                        ...fp.geolocation,
                        mode: v as 'auto' | 'manual',
                      },
                    })
                  }
                  tone="soft"
                />
                {fp.geolocation.mode === 'manual' ? (
                  <div className="grid grid-cols-2 gap-3 mt-2">
                    <input
                      className="inp font-mono text-[13px]"
                      inputMode="decimal"
                      value={latText}
                      onChange={(e) => {
                        setLatText(e.target.value)
                        const n = Number(e.target.value)
                        // Only commit a parseable number; the text box keeps the
                        // half-typed value either way.
                        if (Number.isFinite(n))
                          setFp({
                            geolocation: { ...fp.geolocation, latitude: n },
                          })
                      }}
                      placeholder="Vĩ độ, vd: 21.0278"
                    />
                    <input
                      className="inp font-mono text-[13px]"
                      inputMode="decimal"
                      value={lngText}
                      onChange={(e) => {
                        setLngText(e.target.value)
                        const n = Number(e.target.value)
                        if (Number.isFinite(n))
                          setFp({
                            geolocation: { ...fp.geolocation, longitude: n },
                          })
                      }}
                      placeholder="Kinh độ, vd: 105.8342"
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {/* ── Cột 3 ── */}
          <div className="flex flex-col gap-4">
            {/* ===== Nhiễu ===== */}
            <div className="bg-card border border-borderSoft rounded-[12px] p-4">
              <Grp>Nhiễu</Grp>

              {/* Công tắc thay cho cặp Thật|Nhiễu: mỗi vector chỉ có hai trạng
                  thái và tắt là mặc định — đúng thứ công tắc diễn đạt. Cùng lối
                  với các mục kiểm tra ở tab Template.
                  Hai cột: sáu hàng dọc kéo khung cao gấp đôi mọi khung khác. */}
              <div className="grid grid-cols-2 gap-x-4">
                {VECTORS.map((v) => (
                  <div key={v.key} className="flex items-center py-[7px]">
                    <div className="text-[13.5px]">{v.label}</div>
                    <div className="ml-auto">
                      <Toggle
                        on={fp.noise.includes(v.key)}
                        onChange={(on) => setFp({ noise: toggleNoise(fp.noise, v.key, on) })}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ===== TikTok ===== */}
            <div className="bg-card border border-borderSoft rounded-[12px] p-4">
              <Grp>TikTok</Grp>
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
      </div>

      <div className="flex justify-end gap-2.5 px-5 py-4 border-t border-borderSoft">
        <button
          onClick={() => setConfirmingDel(true)}
          // Cùng khuôn với nút "Xóa tất cả" ở thanh công cụ tab Profile: cùng
          // gradient đỏ, cùng cao 40px, cùng quầng sáng. Hai nút làm cùng một
          // việc ở hai mức phạm vi, nên trông phải cùng một loại.
          className="mr-auto h-10 inline-flex items-center gap-1.5 danger-grad text-[#2a0d12] font-bold text-[14px] rounded-[10px] px-4 shadow-[0_0_18px_rgba(244,63,94,.26)]"
        >
          <Icon name="trash" filled size={17} className="shrink-0" />
          Xóa hồ sơ
        </button>
        <button
          onClick={onClose}
          className="bg-surface text-[#c7c8d4] border border-border rounded-[9px] px-[18px] py-2.5 text-[14px]"
        >
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

      {confirmingDevice && (
        <ConfirmDialog
          title="Đổi thiết bị của hồ sơ đã đăng nhập"
          message={`Hồ sơ "${p.name}" đang đăng nhập TikTok.\nĐổi sang "${deviceId}" sẽ thay User-Agent, GPU, màn hình và CPU cùng lúc — TikTok có thể coi đây là đăng nhập từ máy lạ.\nCookie phiên đăng nhập vẫn được giữ.`}
          confirmText="Đổi thiết bị"
          onConfirm={() => {
            setConfirmingDevice(false)
            void doSave()
          }}
          onCancel={() => setConfirmingDevice(false)}
        />
      )}

      {confirmingDel && (
        <ConfirmDialog
          title="Xóa hồ sơ"
          message={`Xóa hồ sơ "${p.name}"?\nThư mục dữ liệu (session, cookie…) cũng bị xóa. Không thể hoàn tác.`}
          confirmText="Xóa"
          onConfirm={del}
          onCancel={() => setConfirmingDel(false)}
        />
      )}
    </>
  )
}
