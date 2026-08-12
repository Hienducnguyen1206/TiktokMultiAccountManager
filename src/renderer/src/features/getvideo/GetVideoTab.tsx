import { useEffect, useRef, useState } from 'react'
import { Icon, type IconName } from '../../components/Icon'
import { NumInput } from '../../components/NumInput'
import { Toggle } from '../../components/Toggle'
import { SearchPanel } from '../search/SearchPanel'
import { confirmDialog, showToast } from '../../components/uiDialogs'
import type { GvChannel, GvFileNamePart, GvSettings, GvSource } from '@shared/types'

function timeAgo(ts: number | null): string {
  if (!ts) return 'chưa crawl'
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s trước`
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`
  return `${Math.floor(s / 86400)} ngày trước`
}

/** Ảnh đại diện channel. Chưa lấy được (hoặc URL hỏng) thì rơi về chữ cái đầu — luôn
 *  chiếm đúng 38px nên danh sách không nhảy dòng lúc ảnh tải xong. */
function Avatar({ c }: { c: GvChannel }): JSX.Element {
  const [broken, setBroken] = useState(false)
  const letter = (c.name || c.url.replace(/^.*[@/]/, '') || '?').trim().charAt(0).toUpperCase()
  if (!c.avatar || broken) {
    return (
      <div className="w-[38px] h-[38px] rounded-full shrink-0 grid place-items-center bg-[#1b1c25] border border-border text-[15px] font-bold text-subtle">
        {letter}
      </div>
    )
  }
  return (
    <img
      src={c.avatar}
      alt=""
      onError={() => setBroken(true)}
      className="w-[38px] h-[38px] rounded-full shrink-0 object-cover border border-border bg-[#1b1c25]"
    />
  )
}

/** Nhóm cài đặt ở cột phải: nhãn trên, control dưới — cột hẹp nên không xếp ngang. */
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[13px] text-subtle">{label}</div>
      {children}
      {hint && <div className="text-[11.5px] text-muted leading-snug">{hint}</div>}
    </div>
  )
}

/** Dòng cài đặt bật/tắt hoặc số: nhãn trái, control phải. */
function FieldRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0">
        <div className="text-[13px] text-subtle">{label}</div>
        {hint && <div className="text-[11.5px] text-muted mt-0.5 leading-snug">{hint}</div>}
      </div>
      <div className="ml-auto shrink-0">{children}</div>
    </div>
  )
}

/**
 * Các mảnh ghép tên file, đúng bốn thứ extension nhận. Thứ tự ở đây cũng là thứ
 * tự ghép — phải khớp với FILE_NAME_PARTS bên GetVideoStore.
 *
 * Hai mảnh đầu không tắt được. 'title' vì Template lấy chính tên file làm
 * caption lúc đăng; 'id' vì tên file là chỗ duy nhất còn mang mã video sau khi
 * extension tải xong — bỏ đi thì app không biết video nào đã lấy rồi, và hai
 * video khác nhau trùng tiêu đề sẽ bị coi là một.
 */
const FILE_NAME_PARTS: { key: GvFileNamePart; label: string; locked?: boolean }[] = [
  { key: 'title', label: 'Tiêu đề', locked: true },
  { key: 'id', label: 'Mã video', locked: true },
  { key: 'timestamp', label: 'Thời điểm đăng' },
  { key: 'numericalOrder', label: 'Số thứ tự' }
]

/** Cột cài đặt bên phải — thay cho dialog cũ, sửa tại chỗ rồi bấm Lưu. */
function SettingsPane({
  settings,
  source,
  onSaved
}: {
  settings: GvSettings
  source: GvSource
  onSaved: (s: GvSettings) => void
}): JSX.Element {
  const [s, setS] = useState<GvSettings>(settings)
  const [saving, setSaving] = useState(false)
  const patch = (p: Partial<GvSettings>): void => setS((cur) => ({ ...cur, ...p }))

  // Settings từ ngoài đổi (lần load đầu) → đồng bộ lại bản nháp.
  useEffect(() => setS(settings), [settings])

  const dirty = JSON.stringify(s) !== JSON.stringify(settings)
  // Ba nguồn chạy bằng extension: các ô của yt-dlp không còn tác dụng, thay bằng
  // đúng bộ tuỳ chọn của form "Tải hàng loạt" bên đó.
  const viaExt = source !== 'youtube'

  const togglePart = (k: GvFileNamePart): void => {
    if (FILE_NAME_PARTS.find((p) => p.key === k)?.locked) return // xem chú thích ở FILE_NAME_PARTS
    const has = s.extFileNameFormat.includes(k)
    patch({
      extFileNameFormat: FILE_NAME_PARTS.map((p) => p.key).filter((p) =>
        p === k ? !has : s.extFileNameFormat.includes(p)
      )
    })
  }

  const pickDir = async (): Promise<void> => {
    const dir = await window.hnv.system.pickFolder()
    if (dir) patch({ pendingDir: dir })
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      // CHỈ gửi mấy khoá cột này sở hữu. Hai khoá cookie nằm ở tab Cài đặt và
      // cùng lưu vào gv_settings — gửi cả cụm thì bản chụp lúc mở của cột này
      // sẽ đè lên thứ vừa đổi bên kia.
      onSaved(
        await window.hnv.getvideo.saveSettings(
          viaExt
            ? {
                pendingDir: s.pendingDir,
                extFileNameFormat: s.extFileNameFormat,
                extConcurrency: s.extConcurrency,
                extDelaySeconds: s.extDelaySeconds
              }
            : {
                pendingDir: s.pendingDir,
                backfillMode: s.backfillMode,
                backfillHours: s.backfillHours,
                backfillCount: s.backfillCount,
                maxDuration: s.maxDuration,
                nameByTitle: s.nameByTitle,
                concurrency: s.concurrency
              }
        )
      )
      showToast('Đã lưu cài đặt Tải video')
    } catch (e) {
      showToast((e as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="w-[380px] shrink-0 border-l border-borderSoft flex flex-col min-h-0">
      <div className="px-[18px] py-3 border-b border-borderSoft flex items-center shrink-0">
        <div className="text-[12px] uppercase tracking-wider text-muted font-semibold flex items-center gap-1.5">
          <Icon name="setting" filled size={14} />
          Cài đặt
        </div>
      </div>

      <div className="flex-1 overflow-y-auto hv-scroll px-[18px] py-5 flex flex-col gap-5">
        <Field
          label="Thư mục Pending (nơi lưu video)"
          hint={viaExt ? 'Video tải về rơi thẳng vào đây — app trỏ luôn thư mục tải của hồ sơ vào chỗ này.' : undefined}
        >
          <div className="flex gap-2">
            <input className="inp min-w-0" readOnly value={s.pendingDir} placeholder="(chưa chọn)" />
            <button
              onClick={pickDir}
              className="bg-surface text-[#c7c8d4] border border-border rounded-[9px] px-3.5 text-[13px] shrink-0"
            >
              Chọn…
            </button>
          </div>
        </Field>

        {viaExt && (
          <>
            {/* Bộ tuỳ chọn này ánh xạ 1-1 sang form "Tải hàng loạt" của
                extension Social Bulk Downloader. Không có ô "loại tải": app
                luôn chọn dạng video của từng nền tảng. */}
            <Field
              label="Cấu hình tên file"
              hint="Ghép theo thứ tự này. Tiêu đề luôn đứng đầu; mã video luôn có để khỏi tải lại video cũ."
            >
              <div className="flex flex-wrap gap-1.5">
                {FILE_NAME_PARTS.map((p) => {
                  const on = s.extFileNameFormat.includes(p.key)
                  const locked = !!p.locked
                  return (
                    <button
                      key={p.key}
                      onClick={() => togglePart(p.key)}
                      title={
                        locked
                          ? p.key === 'title'
                            ? 'Bắt buộc — Template lấy tên file làm caption lúc đăng'
                            : 'Bắt buộc — app cần mã video để chống tải trùng'
                          : undefined
                      }
                      className={
                        'rounded-lg px-2.5 py-1.5 text-[12.5px] border ' +
                        (locked ? 'cursor-default ' : '') +
                        (on
                          ? 'text-white font-semibold border-[#3a3d6b] bg-[linear-gradient(100deg,rgba(99,102,241,.2),rgba(34,211,238,.08))]'
                          : 'text-subtle border-border bg-[#101117]')
                      }
                    >
                      {p.label}
                    </button>
                  )
                })}
              </div>
            </Field>

            <div className="border-t border-borderSoft" />

            <FieldRow label="Số lượng đồng thời" hint="Nhiều quá dễ bị chặn — gặp lỗi thì giảm xuống">
              <NumInput
                value={s.extConcurrency}
                min={1}
                max={20}
                width="w-[80px]"
                onChange={(extConcurrency) => patch({ extConcurrency })}
              />
            </FieldRow>

            <FieldRow label="Thời gian chờ (giây)" hint="Giãn giữa hai lượt lấy dữ liệu">
              <NumInput
                value={s.extDelaySeconds}
                min={0}
                max={600}
                width="w-[80px]"
                onChange={(extDelaySeconds) => patch({ extDelaySeconds })}
              />
            </FieldRow>
          </>
        )}

        {!viaExt && (
        <Field
          label="Chế độ Update (lấy video hiện có)"
          hint={
            s.backfillMode === 'all'
              ? 'Lấy toàn bộ video của channel, bỏ qua những video đã lấy ở các lần trước.'
              : undefined
          }
        >
          <div className="flex gap-1.5">
            {(['hours', 'count', 'all'] as const).map((m) => (
              <button
                key={m}
                onClick={() => patch({ backfillMode: m })}
                className={
                  'flex-1 rounded-lg px-2 py-2 text-[12.5px] border whitespace-nowrap ' +
                  (s.backfillMode === m
                    ? 'text-white font-semibold border-[#3a3d6b] bg-[linear-gradient(100deg,rgba(99,102,241,.2),rgba(34,211,238,.08))]'
                    : 'text-subtle border-border bg-[#101117]')
                }
              >
                {m === 'hours' ? 'Theo giờ' : m === 'count' ? 'Theo số lượng' : 'Toàn bộ'}
              </button>
            ))}
          </div>
          {s.backfillMode === 'hours' && (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[12.5px] text-muted">Lấy video trong</span>
              <input
                inputMode="numeric"
                className="inp !w-[70px] !py-0 h-9"
                value={s.backfillHours}
                onChange={(e) =>
                  patch({
                    backfillHours: Number(e.target.value.replace(/\D/g, '')),
                  })
                }
              />
              <span className="text-[12.5px] text-muted">giờ đổ lại</span>
            </div>
          )}
          {s.backfillMode === 'count' && (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[12.5px] text-muted">Quét tối đa</span>
              <input
                inputMode="numeric"
                className="inp !w-[70px] !py-0 h-9"
                value={s.backfillCount}
                onChange={(e) =>
                  patch({
                    backfillCount: Number(e.target.value.replace(/\D/g, '')),
                  })
                }
              />
              <span className="text-[12.5px] text-muted">bài</span>
            </div>
          )}
        </Field>
        )}

        {!viaExt && (
          <>
            <div className="border-t border-borderSoft" />

            <FieldRow label="Thời lượng tối đa (giây)" hint="Chỉ lấy short — bỏ video dài hơn">
              <NumInput value={s.maxDuration} min={1} width="w-[80px]" onChange={(maxDuration) => patch({ maxDuration })} />
            </FieldRow>

            <FieldRow label="Số tải song song" hint="Nhiều hơn = nhanh hơn nhưng nặng máy">
              <NumInput
                value={s.concurrency}
                min={1}
                max={10}
                width="w-[80px]"
                onChange={(concurrency) => patch({ concurrency })}
              />
            </FieldRow>

            <FieldRow label="Đặt tên file theo tiêu đề video" hint="Để Template lấy làm caption khi upload">
              <Toggle on={s.nameByTitle} onChange={(v) => patch({ nameByTitle: v })} />
            </FieldRow>
          </>
        )}

        {/* Hai ô Cookie đã chuyển sang tab Cài đặt (mục "Cookie cho tải video").
            Chúng vẫn lưu vào cùng bảng gv_settings, nên cột này CHỈ được gửi đi
            đúng mấy khoá của nó — xem hàm save() ở trên. */}
      </div>

      <div className="px-[18px] py-3 border-t border-borderSoft flex gap-2.5 items-center shrink-0">
        <span className="text-[12px] text-muted mr-auto">{dirty ? 'Có thay đổi chưa lưu' : 'Đã lưu'}</span>
        <button
          onClick={() => setS(settings)}
          disabled={!dirty || saving}
          className="bg-surface text-[#c7c8d4] border border-border rounded-[9px] px-3.5 h-9 text-[13px] disabled:opacity-40"
        >
          Hoàn tác
        </button>
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="accent-grad text-[#0a0b10] font-bold rounded-[9px] px-4 h-9 text-[13px] disabled:opacity-40"
        >
          {saving ? 'Đang lưu…' : 'Lưu'}
        </button>
      </div>
    </div>
  )
}

/**
 * Bốn nguồn tải video. Mỗi nguồn có danh sách kênh và khu làm việc RIÊNG — bấm
 * tab nào mới dựng khung của tab đó.
 *
 * Cả bốn dùng CHUNG một khung: cùng danh sách kênh, cùng đường crawl, chỉ khác
 * cột  trong DB và cách dựng URL (xem toChannelUrl/toListUrl bên main).
 *
 * Lưu ý khi đọc kết quả test: đo trên chính bản yt-dlp app dùng (2026.07.04,
 * --list-extractors) thì Douyin và Facebook KHÔNG có extractor liệt kê video
 * theo tài khoản, còn  bị chính yt-dlp đánh dấu CURRENTLY
 * BROKEN. Tức khâu LIỆT KÊ nhiều khả năng không ra gì; khâu TẢI thì cả ba đều
 * làm được. Không chặn trước để còn đo thật — nhật ký sẽ nói rõ hỏng ở đâu.
 */
// GvSource dùng chung với main, khai ở @shared/types — bản chép cục bộ trước đây
// đã bỏ vì dễ lệch khi thêm nguồn mới.

/** `color` là màu thương hiệu, tô cho logo ở MỌI tab. Tab đang mở vẫn phân biệt
 *  được bằng nền sáng hơn, chữ trắng và gạch chân — không phải nhờ màu logo. */
const SOURCES: { key: GvSource; label: string; icon: IconName; color: string; hint: string }[] = [
  // YouTube/Facebook/Instagram: nhận URL TRANG, app tự liệt kê video.
  //   - YouTube do yt-dlp liệt kê.
  //   - Facebook/Instagram phải mở trình duyệt hồ sơ ra cuộn và bới link, vì
  //     yt-dlp không liệt kê được (xem HARVEST_SPEC bên GetVideoService).
  //   - Douyin cũng phải bới bằng trình duyệt, và còn cần cookie phiên kể cả để
  //     tải một video công khai.
  { key: 'youtube', label: 'YouTube', icon: 'youtube', color: '#ff0033', hint: 'Dán link channel hoặc @handle… (vd: @MrBeast)' },
  { key: 'facebook', label: 'Facebook', icon: 'facebook', color: '#0866ff', hint: 'Dán link TRANG Facebook (vd: facebook.com/tenTrang)…' },
  { key: 'instagram', label: 'Instagram', icon: 'instagram', color: '#e1306c', hint: 'Dán link TÀI KHOẢN Instagram (vd: instagram.com/tenNick)…' },
  { key: 'douyin', label: 'Douyin', icon: 'douyin', color: '#00f2ea', hint: 'Dán link TRANG người dùng Douyin (vd: douyin.com/user/…)…' },
]

export function GetVideoTab(): JSX.Element {
  const [source, setSource] = useState<GvSource>('youtube')
  /** Khu làm việc của tab YouTube: danh sách channel đang theo dõi, hay đi tìm
   *  channel mới. Tìm kênh trước đây là một tab riêng ngoài sidebar — nó thuộc
   *  về đây, vì thứ tìm được rốt cuộc là để thêm vào chính danh sách này. */
  const [view, setView] = useState<'channels' | 'search'>('channels')
  const [channels, setChannels] = useState<GvChannel[]>([])
  const [settings, setSettings] = useState<GvSettings | null>(null)
  const [newUrl, setNewUrl] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  /** Đã bấm Dừng và đang đợi lượt chạy khép lại. */
  const [stopping, setStopping] = useState(false)
  /** Đang đọc lại tên + ảnh cho cả danh sách. */
  const [syncing, setSyncing] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const logRef = useRef<HTMLDivElement>(null)

  // Nguồn đang xem, giữ thêm trong ref. Bộ nghe sự kiện bên dưới đăng ký MỘT lần
  // ([] deps) nên nó đóng gói giá trị `source` của lần dựng đầu — không có ref thì
  // sau khi đổi tab, mỗi lần main báo "có cập nhật" là danh sách bị nạp lại theo
  // nguồn CŨ, tức bấm Update ở Douyin xong lại thấy danh sách YouTube.
  const sourceRef = useRef(source)
  sourceRef.current = source

  const reload = async (): Promise<void> => {
    setChannels(await window.hnv.getvideo.listChannels(sourceRef.current))
  }

  // Đổi nguồn thì nạp lại danh sách của nguồn đó.
  useEffect(() => {
    reload()
  }, [source])

  useEffect(() => {
    window.hnv.getvideo.getSettings().then(setSettings)
    // Đọc lại log đã đệm ở main: quay lại tab thì thấy nguyên phần đã chạy lúc
    // mình đang ở tab khác, thay vì khung trống.
    window.hnv.getvideo.logs().then(setLogs)
    // Channel thêm từ trước khi có avatar → lấy bổ sung, xong main bắn 'update' về.
    window.hnv.getvideo.refreshMeta()
    const offUpd = window.hnv.onGetVideoUpdate(() => reload())
    const offLog = window.hnv.onGetVideoLog((line) => setLogs((p) => [...p.slice(-200), line]))
    return () => {
      offUpd()
      offLog()
    }
  }, [])

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight)
  }, [logs])

  const add = async (): Promise<void> => {
    const u = newUrl.trim()
    if (!u) return
    await window.hnv.getvideo.addChannel(source, u)
    setNewUrl('')
    reload()
  }

  const update = async (c: GvChannel): Promise<void> => {
    // Chặn NGAY tại đây thay vì để main ném lỗi: Facebook cần một hồ sơ để mở
    // trang, mà main chỉ phát hiện sau khi đã chuẩn bị yt-dlp/ffmpeg — người
    // dùng ngồi chờ vài giây rồi mới biết là thiếu cấu hình. Main vẫn giữ đúng
    // phép kiểm này làm lưới chắn cho các đường gọi khác (schedule, hàng đợi).
    if (c.source !== 'youtube' && !settings?.cookieProfileId) {
      const label = SOURCES.find((x) => x.key === c.source)?.label
      showToast(`${label} cần một hồ sơ để mở trang — vào Cài đặt chọn "Cookie từ hồ sơ ảo"`, 'error')
      return
    }
    setBusy(c.id)
    setStopping(false)
    try {
      const r = await window.hnv.getvideo.update(c.id)
      setLogs((p) => [...p, `✓ ${c.name || c.url}: ${r.downloaded} tải, ${r.skipped} bỏ qua, ${r.failed} lỗi`])
    } catch (e: any) {
      showToast(e?.message ?? 'Lỗi crawl', 'error')
    } finally {
      setBusy(null)
      setStopping(false)
      reload()
    }
  }

  /**
   * Yêu cầu dừng lượt đang chạy.
   *
   * Chỉ đặt cờ ở main chứ không giết tiến trình: video đang tải dở được chạy
   * nốt, còn video sau thì không bắt đầu nữa. Nút tự tắt khi lượt kết thúc —
   * `busy` về null ở finally của update().
   */
  const stop = async (): Promise<void> => {
    setStopping(true)
    try {
      await window.hnv.getvideo.stop()
    } catch (e: any) {
      showToast(e?.message ?? 'Không dừng được', 'error')
      setStopping(false)
    }
  }

  /**
   * Đọc lại tên + ảnh đại diện cho mọi kênh của nguồn đang xem.
   *
   * Ba nguồn ngoài YouTube sẽ MỞ trình duyệt hồ sơ tải: yt-dlp không có bộ đọc
   * meta cho chúng, phải vào tận trang mới lấy được thẻ Open Graph.
   */
  const syncMeta = async (): Promise<void> => {
    setSyncing(true)
    try {
      const r = await window.hnv.getvideo.syncMeta(source)
      showToast(`Đồng bộ xong: ${r.ok} kênh${r.failed ? `, ${r.failed} không đọc được` : ''}`)
      reload()
    } catch (e: any) {
      showToast(e?.message ?? 'Không đồng bộ được', 'error')
    } finally {
      setSyncing(false)
    }
  }

  const remove = async (c: GvChannel): Promise<void> => {
    if (
      !(await confirmDialog({
        title: 'Xóa channel',
        message: `Xóa channel "${c.name || c.url}"?`,
        confirmText: 'Xóa',
      }))
    )
      return
    await window.hnv.getvideo.removeChannel(c.id)
    reload()
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Tiêu đề tab nằm trên cùng, trải hết bề ngang — giống mọi tab khác */}
      <div className="px-[22px] pt-[18px] pb-3.5 flex items-center gap-3 shrink-0">
        <div className="text-[21px] font-bold text-grad flex items-center gap-2">
          <Icon name="getvideo" filled size={24} className="icon-grad" />
          Tải video
        </div>
        {source === 'youtube' && (
          <span className="text-[12px] text-muted bg-[#101117] border border-border rounded-full px-2.5 py-0.5">
            YouTube Shorts → Pending
          </span>
        )}
      </div>

      {/* Thanh nav ngang chọn nguồn. Viền dưới trải hết bề ngang để nó đọc thành
          một hàng tab, không phải bốn cái nút rời. */}
      <div className="px-[22px] flex items-end gap-1 shrink-0 border-b border-borderSoft">
        {SOURCES.map((s) => {
          const on = s.key === source
          return (
            <button
              key={s.key}
              onClick={() => setSource(s.key)}
              className={
                'relative flex items-center gap-2 px-4 py-2.5 text-[14px] font-semibold rounded-t-[9px] transition ' +
                (on ? 'text-white bg-[#12131b]' : 'text-subtle hover:text-[#c7c8d4]')
              }
            >
              {/* Icon vẽ bằng currentColor nên tô màu qua thẻ bọc, khỏi phải thêm
                  prop style cho Icon (nó là file sinh tự động, sửa tay là mất).
                  Tab chưa mở giảm độ đậm thay vì bỏ màu — vẫn nhận ra logo ngay,
                  mà tab đang mở vẫn nổi hơn. */}
              <span
                style={{ color: s.color }}
                className={'inline-flex shrink-0 transition-opacity ' + (on ? '' : 'opacity-60')}
              >
                <Icon name={s.icon} size={18} />
              </span>
              {s.label}
              {/* Gạch chân màu thương hiệu cho tab đang mở, đè lên viền dưới của hàng. */}
              {on && (
                <span
                  style={{ background: s.color }}
                  className="absolute left-3 right-3 -bottom-px h-[2px] rounded-full"
                />
              )}
            </button>
          )
        })}
      </div>

      {view === 'search' ? (
        /* Tìm kênh chiếm trọn khu làm việc: nó vốn là cả một tab, nhét vào cột
           380px bên phải thì không đủ chỗ cho bảng kết quả và bộ lọc. */
        <div className="flex-1 flex flex-col min-w-0 p-5 cs-tabscroll hv-scroll">
          <div className="flex items-center gap-2.5 mb-3 shrink-0">
            <button
              onClick={() => setView('channels')}
              className="bg-surface text-[#c7c8d4] border border-border hover:border-[#3a3d6b] rounded-[9px] px-3.5 h-9 text-[13.5px] font-semibold inline-flex items-center gap-1.5 shrink-0"
            >
              <Icon name="undo" filled size={16} />
              Danh sách channel
            </button>
            <div className="text-[15px] font-bold text-grad flex items-center gap-2">
              <Icon name="search" filled size={19} className="icon-grad" />
              Tìm kênh
            </div>
          </div>
          <SearchPanel />
        </div>
      ) : (
      /* min-h-0: thiếu thì hàng này phình theo nội dung, overflow bên trong mất cuộn */
      <div className="flex-1 flex min-w-0 min-h-0">
        {/* TRÁI: danh sách channel theo dõi */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-[22px] pt-1 pb-3 flex items-center gap-2.5 shrink-0">
            <input
              className="inp flex-1"
              placeholder={SOURCES.find((x) => x.key === source)?.hint}
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
            <button
              onClick={add}
              title={
                source === 'youtube'
                  ? undefined
                  : 'Nguồn này chạy bằng extension Social Bulk Downloader trong hồ sơ tải — hồ sơ đó phải đã cài extension và đã đăng nhập'
              }
              className="accent-grad text-[#0a0b10] font-bold rounded-[9px] px-4 py-2.5 text-[14px] whitespace-nowrap shrink-0"
            >
              + Thêm channel
            </button>
            {/* Biết sẵn channel thì dán vào ô bên trái; chưa biết thì bấm đây.
                Hai việc nối tiếp nhau nên đứng cạnh nhau. */}
            {source === 'youtube' && (
            <button
              onClick={() => setView('search')}
              className="bg-surface text-[#c7c8d4] border border-border hover:border-[#3a3d6b] rounded-[9px] px-4 py-2.5 text-[14px] font-semibold whitespace-nowrap shrink-0 inline-flex items-center gap-1.5"
            >
              <Icon name="search" filled size={17} />
              Tìm kênh
            </button>
            )}
          </div>

          <div className="px-[22px] pb-2 flex items-center shrink-0">
            <div className="text-[12px] uppercase tracking-wider text-muted font-semibold">Channel theo dõi</div>
            <span className="ml-2 text-[12px] text-muted">{channels.length} channel</span>
            {/* Mở trình duyệt hồ sơ để đọc tên + ảnh của cả danh sách, nên chỉ
                chạy khi người dùng tự bấm — không làm ngầm lúc mở tab. */}
            {channels.length > 0 && (
              <button
                onClick={syncMeta}
                disabled={syncing || !!busy}
                title={
                  source === 'youtube'
                    ? 'Đọc lại tên và ảnh của mọi kênh'
                    : 'Mở hồ sơ tải, vào từng trang để đọc tên và ảnh đại diện'
                }
                className="ml-auto flex items-center gap-1.5 rounded-lg px-3 h-8 text-[12.5px] font-semibold bg-surface text-[#c7c8d4] border border-border hover:border-[#3a3d6b] disabled:opacity-40"
              >
                <Icon name="refresh" filled size={14} />
                {syncing ? 'Đang đồng bộ…' : 'Đồng bộ tên & ảnh'}
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto hv-scroll px-[22px] min-h-0">
            <div className="bg-card border border-borderSoft rounded-[14px] overflow-hidden">
              {channels.length === 0 && (
                <div className="text-muted text-[13px] px-4 py-5">Chưa có channel. Thêm ở trên.</div>
              )}
              {channels.map((c, i) => (
                <div
                  key={c.id}
                  className={'flex items-center gap-3 px-4 py-3 ' + (i > 0 ? 'border-t border-borderSoft' : '')}
                >
                  <Avatar c={c} />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-[14px] truncate">{c.name || c.url}</div>
                    <div className="text-[12px] text-muted truncate">{c.url}</div>
                  </div>
                  <div className="flex items-center gap-5 text-[12px] text-muted shrink-0">
                    <div className="text-right">
                      <div className="text-[13px] text-accent2 font-semibold">{c.fetched}</div>
                      <div>đã tải</div>
                    </div>
                    <div className="text-right w-[90px]">
                      <div className="text-[12px]">{timeAgo(c.lastCrawl)}</div>
                    </div>
                    {/* Update (backfill) */}
                    <button
                      onClick={() => update(c)}
                      disabled={busy === c.id}
                      className="bg-surface text-[#c7c8d4] border border-border rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-40"
                      title="Crawl video hiện có của channel"
                    >
                      {busy === c.id ? (
                        <>
                          <Icon name="hourglass" filled size={15} className="inline align-[-3px] mr-1" />
                          Đang tải…
                        </>
                      ) : (
                        <>
                          <Icon name="refresh" filled size={15} className="inline align-[-3px] mr-1" />
                          Update
                        </>
                      )}
                    </button>
                    <button onClick={() => remove(c)} className="text-danger opacity-70 hover:opacity-100">
                      <Icon name="close" filled size={15} className="inline align-[-3px]" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* log */}
          <div className="px-[22px] pt-4 pb-5 shrink-0">
            <div className="flex items-center mb-2">
              <div className="text-[12px] uppercase tracking-wider text-muted font-semibold">Hoạt động</div>
              {/* Chỉ hiện khi đang có lượt chạy: nút bấm được lúc chẳng có gì
                  chạy chỉ khiến người dùng tưởng vừa dừng được cái gì đó. */}
              {busy && (
                <button
                  onClick={stop}
                  disabled={stopping}
                  className="ml-auto flex items-center gap-1.5 rounded-lg px-3 h-8 text-[12.5px] font-semibold border border-[#5b2330] bg-[#2a1119] text-danger disabled:opacity-40"
                >
                  <Icon name="stop" filled size={14} />
                  {stopping ? 'Đang dừng…' : 'Dừng'}
                </button>
              )}
            </div>
            <div
              ref={logRef}
              className="bg-[#08090d] border border-borderSoft rounded-[12px] p-4 font-mono text-[12px] leading-relaxed text-[#9aa] h-[150px] overflow-y-auto hv-scroll"
            >
              {logs.length === 0 ? (
                <div className="text-muted">Chưa có hoạt động.</div>
              ) : (
                logs.map((l, i) => <div key={i}>{l}</div>)
              )}
            </div>
          </div>
        </div>

        {/* PHẢI: cài đặt */}
        {settings && <SettingsPane settings={settings} source={source} onSaved={setSettings} />}
      </div>
      )}
    </div>
  )
}
