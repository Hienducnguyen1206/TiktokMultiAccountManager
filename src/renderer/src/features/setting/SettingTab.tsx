import { useEffect, useState } from 'react'
import { showToast } from '../../components/uiDialogs'
import { Select } from '../../components/Select'
import type { CsQuota, CsSettings, Profile } from '@shared/types'

/**
 * Một nhóm cài đặt. Không bọc khung — chỉ tách nhau bằng tiêu đề và đường kẻ mảnh,
 * cho trang thoáng và mắt đi thẳng xuống nội dung.
 */
function Section({
  icon,
  title,
  children,
  footer
}: {
  icon: string
  title: string
  children: React.ReactNode
  footer?: React.ReactNode
}): JSX.Element {
  return (
    <section className="flex flex-col">
      <header className="flex items-center gap-3 pb-4 border-b border-borderSoft">
        <span className="w-9 h-9 shrink-0 rounded-[10px] grid place-items-center text-[17px] bg-[rgba(99,102,241,.14)]">
          {icon}
        </span>
        <h2 className="text-[15px] font-bold leading-tight min-w-0">{title}</h2>
      </header>
      <div className="py-6 flex flex-col gap-6">{children}</div>
      {footer && <footer className="flex items-center gap-3 pt-1">{footer}</footer>}
    </section>
  )
}

/** Một dòng cài đặt: nhãn bên trái, control bên phải, thẳng cột với nhau. */
function Row({
  label,
  children,
  below
}: {
  label: string
  children: React.ReactNode
  below?: React.ReactNode
}): JSX.Element {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-x-8 gap-y-2 items-center">
      <div className="min-w-0 text-[13.5px] text-text">{label}</div>
      <div className="min-w-0">{children}</div>
      {below && <div className="col-span-2">{below}</div>}
    </div>
  )
}

/** Thời gian còn lại tới mốc reset, luôn 5 ký tự ("23h58", "00h42") cho khỏi co giãn. */
function fmtLeft(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000))
  return `${String(Math.floor(m / 60)).padStart(2, '0')}h${String(m % 60).padStart(2, '0')}`
}

/**
 * Thanh quota YouTube Data API trong ngày. Luôn hiện, kể cả chưa có key (khi đó app chạy
 * bằng yt-dlp nên không tiêu unit nào — thanh đứng ở 0).
 *
 * Google KHÔNG có endpoint đọc quota còn lại → main tự cộng dồn theo bảng giá từng
 * endpoint mỗi lần gọi, nên đây là ƯỚC TÍNH: dùng chung API key ở app/script khác thì
 * phần đó không đếm được. Mốc reset là 0h múi giờ Thái Bình Dương, không phải 0h máy.
 */
function QuotaMeter(): JSX.Element {
  const [q, setQ] = useState<CsQuota | null>(null)

  useEffect(() => {
    let alive = true
    const load = (): void => {
      window.hnv.channelSearch.getQuota().then((v) => alive && setQ(v))
    }
    load()
    // Đang tìm kênh thì main đẩy quota về (gộp 800ms/lần) → số chạy realtime.
    const off = window.hnv.onChannelSearchQuota((v) => alive && setQ(v))
    // Nhịp 60s để đồng hồ đếm lùi tự chạy và bắt được lúc qua mốc reset.
    const id = setInterval(load, 60_000)
    return () => {
      alive = false
      off()
      clearInterval(id)
    }
  }, [])

  const used = q?.used ?? 0
  const limit = q?.limit ?? 10000
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0
  const n = (v: number): string => v.toLocaleString('vi-VN')
  // Dưới 10% hiện 1 số lẻ, không thì làm tròn — 161/10000 mà ghi "0%" thì vô nghĩa.
  const pctLabel = `${pct.toFixed(pct < 10 && pct > 0 ? 1 : 0).replace('.', ',')}%`

  const hot = pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : ''
  const numColor = hot === 'danger' ? 'text-danger' : hot === 'warn' ? 'text-warn' : 'text-text'
  const fill =
    hot === 'danger' ? '#fb7185' : hot === 'warn' ? '#fb923c' : 'linear-gradient(90deg,#6366f1,#22d3ee)'

  return (
    <div
      className="flex flex-col gap-2.5 pt-6 border-t border-borderSoft"
      title={
        'App tự cộng dồn theo bảng giá của Google (1 lượt tìm ≈ 101 unit + 3 unit mỗi kênh ' +
        'qua lọc sơ bộ) — không phải số đọc từ Google, nên dùng chung API key với chỗ khác ' +
        'thì phần đó không được tính.\nHạn mức mặc định 10.000 unit/ngày, reset lúc 0h múi ' +
        'giờ Thái Bình Dương.'
      }
    >
      <div className="flex items-baseline gap-3">
        <span className="text-[13.5px] text-text">Quota API hôm nay</span>
        <span className={`ml-auto text-[13.5px] font-bold tabular-nums ${numColor}`}>{pctLabel}</span>
      </div>

      <div className="h-2 rounded-full bg-borderSoft border border-border overflow-hidden">
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{ width: `${pct}%`, background: fill }}
        />
      </div>

      <div className="text-[12px] text-muted tabular-nums">
        {n(used)} / {n(limit)} unit đã dùng · còn {n(Math.max(0, limit - used))}
        {q && ` · reset sau ${fmtLeft(q.resetAt - Date.now())}`}
        {q && !q.hasKey && ' · chưa có API key nên chưa tiêu unit nào'}
      </div>
    </div>
  )
}

function Warn({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="mt-1 px-3.5 py-2.5 rounded-[9px] border border-[#5a4a1a] bg-[#231e0e] text-[12.5px] text-[#e8c96a] leading-snug">
      {children}
    </div>
  )
}

/** Cài đặt tab Search Kênh. */
function ChannelSearchSection(): JSX.Element {
  const [s, setS] = useState<CsSettings | null>(null)
  const [saved, setSaved] = useState<CsSettings | null>(null)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.hnv.channelSearch.getSettings().then((v) => {
      setS(v)
      setSaved(v)
    })
    window.hnv.profiles.list().then(setProfiles)
  }, [])

  if (!s || !saved) {
    return (
      <Section icon="🔍" title="Search Kênh">
        <div className="text-[13px] text-muted">Đang tải…</div>
      </Section>
    )
  }

  const loggedIn = profiles.filter((p) => p.loggedIn)
  const dirty =
    s.apiKey !== saved.apiKey || s.checkProfileId !== saved.checkProfileId || s.topN !== saved.topN

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const v = await window.hnv.channelSearch.saveSettings(s)
      setS(v)
      setSaved(v)
      showToast('Đã lưu cài đặt Search Kênh')
    } catch (e) {
      showToast((e as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section
      icon="🔍"
      title="Search Kênh"
      footer={
        <>
          <span className="text-[12.5px] text-muted mr-auto">
            {dirty ? 'Có thay đổi chưa lưu' : 'Đã lưu'}
          </span>
          <button
            onClick={() => setS(saved)}
            disabled={!dirty || saving}
            className="bg-surface text-[#c7c8d4] border border-border rounded-[9px] px-4 h-9 text-[13.5px] disabled:opacity-40"
          >
            Hoàn tác
          </button>
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="accent-grad text-[#0a0b10] font-bold rounded-[9px] px-5 h-9 text-[13.5px] disabled:opacity-40"
          >
            {saving ? 'Đang lưu…' : 'Lưu'}
          </button>
        </>
      }
    >
      <Row
        label="YouTube Data API v3 key"
        below={
          !s.apiKey.trim() && (
            <Warn>
              Chưa có key — toàn bộ nhóm lọc Chất lượng view, Khán giả, Chủ đề và Quy mô sẽ không có dữ liệu để lọc.
            </Warn>
          )
        }
      >
        <input
          className="inp !py-0 h-10"
          value={s.apiKey}
          onChange={(e) => setS({ ...s, apiKey: e.target.value })}
          placeholder="AIza…"
          spellCheck={false}
        />
      </Row>

      <Row
        label="Profile check TikTok"
        below={
          loggedIn.length === 0 && (
            <Warn>Chưa có profile nào đăng nhập TikTok — vào tab Profile đăng nhập trước.</Warn>
          )
        }
      >
        <Select
          value={s.checkProfileId}
          onChange={(v) => setS({ ...s, checkProfileId: v })}
          placeholder="— Chưa chọn —"
          disabled={loggedIn.length === 0}
          options={loggedIn.map((p) => ({
            value: p.id,
            label: p.name,
            hint: p.tiktokUsername ? `@${p.tiktokUsername}` : undefined
          }))}
        />
      </Row>

      <Row label="Số account TikTok lưu mỗi lần check">
        <input
          className="inp !py-0 h-10 !w-[110px]"
          type="number"
          min={1}
          max={20}
          value={s.topN}
          onChange={(e) => setS({ ...s, topN: Math.max(1, Math.min(20, parseInt(e.target.value) || 5)) })}
        />
      </Row>

      <QuotaMeter />
    </Section>
  )
}

function fmtBytes(n: number): string {
  if (n >= 1 << 30) return (n / (1 << 30)).toFixed(2).replace('.', ',') + ' GB'
  if (n >= 1 << 20) return Math.round(n / (1 << 20)).toLocaleString('vi-VN') + ' MB'
  return Math.round(n / 1024).toLocaleString('vi-VN') + ' KB'
}

/**
 * Dọn dữ liệu profile thủ công. App đã tự dọn lúc khởi động và sau mỗi job, nút này
 * để dọn ngay mà không phải khởi động lại.
 *
 * Nháp upload là bản sao NGUYÊN file MP4 mà TikTok Studio để lại trong IndexedDB sau
 * mỗi lần đăng — phần phình nhanh nhất sau cache. Tách công tắc riêng vì nó là dữ
 * liệu site chứ không phải cache thuần.
 */
function CleanSection(): JSX.Element {
  const [drafts, setDrafts] = useState(true)
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<{ freedBytes: number; profiles: number } | null>(null)

  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await window.hnv.system.cleanData(drafts)
      setLast(r)
      showToast(
        r.freedBytes > 0
          ? `Đã dọn ${fmtBytes(r.freedBytes)} từ ${r.profiles} profile`
          : 'Không có gì để dọn'
      )
    } catch (e) {
      showToast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section icon="🧹" title="Dọn dữ liệu">
      <Row label="Cache trình duyệt của profile">
        <span className="text-[12.5px] text-muted">Luôn dọn · không mất đăng nhập</span>
      </Row>

      <Row label="Nháp upload TikTok (file video còn sót trong profile)">
        <button
          onClick={() => setDrafts(!drafts)}
          className={
            'w-[42px] h-[24px] rounded-full relative transition shrink-0 ' + (drafts ? 'accent-grad' : 'bg-border')
          }
        >
          <span
            className={
              'absolute top-[3px] w-[18px] h-[18px] rounded-full transition-all ' +
              (drafts ? 'right-[3px] bg-white' : 'left-[3px] bg-muted')
            }
          />
        </button>
      </Row>

      <div className="flex items-center gap-3 pt-1">
        <span className="text-[12.5px] text-muted mr-auto">
          {last ? `Lần dọn gần nhất: ${fmtBytes(last.freedBytes)} từ ${last.profiles} profile` : 'Chưa dọn lần nào'}
        </span>
        <button
          onClick={run}
          disabled={busy}
          className="accent-grad text-[#0a0b10] font-bold rounded-[9px] px-5 h-9 text-[13.5px] disabled:opacity-40"
        >
          {busy ? 'Đang dọn…' : 'Dọn ngay'}
        </button>
      </div>
    </Section>
  )
}

export function SettingTab(): JSX.Element {
  return (
    <div className="flex-1 flex flex-col min-w-0 cs-tabscroll hv-scroll">
      {/* Tiêu đề tab bám góc trên trái, trải hết bề ngang — giống mọi tab khác */}
      <div className="px-[22px] pt-[18px] pb-3.5 text-[21px] font-bold shrink-0">⚙️ Setting</div>

      {/* Chỉ phần nội dung mới căn giữa */}
      <div className="w-full max-w-[780px] mx-auto px-[22px] pb-8 flex flex-col gap-8">
        <ChannelSearchSection />
        <CleanSection />
      </div>
    </div>
  )
}
