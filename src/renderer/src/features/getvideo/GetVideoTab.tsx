import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { Select } from '../../components/Select'
import { Toggle } from '../../components/Toggle'
import { confirmDialog, showToast } from '../../components/uiDialogs'
import type { GvChannel, GvSettings, Profile } from '@shared/types'

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

/** Cột cài đặt bên phải — thay cho dialog cũ, sửa tại chỗ rồi bấm Lưu. */
function SettingsPane({ settings, onSaved }: { settings: GvSettings; onSaved: (s: GvSettings) => void }): JSX.Element {
  const [s, setS] = useState<GvSettings>(settings)
  const [saving, setSaving] = useState(false)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const patch = (p: Partial<GvSettings>): void => setS((cur) => ({ ...cur, ...p }))

  // Settings từ ngoài đổi (lần load đầu) → đồng bộ lại bản nháp.
  useEffect(() => setS(settings), [settings])

  useEffect(() => {
    window.hnv.profiles.list().then(setProfiles)
  }, [])

  const dirty = JSON.stringify(s) !== JSON.stringify(settings)

  const pickDir = async (): Promise<void> => {
    const dir = await window.hnv.system.pickFolder()
    if (dir) patch({ pendingDir: dir })
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      onSaved(await window.hnv.getvideo.saveSettings(s))
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
        <Field label="Thư mục Pending (nơi lưu video)">
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

        <div className="border-t border-borderSoft" />

        <FieldRow label="Thời lượng tối đa (giây)" hint="Chỉ lấy short — bỏ video dài hơn">
          <input
            type="number"
            min={1}
            className="inp !w-[80px] !py-0 h-9"
            value={s.maxDuration}
            onChange={(e) => patch({ maxDuration: Number(e.target.value) })}
          />
        </FieldRow>

        <FieldRow label="Số tải song song" hint="Nhiều hơn = nhanh hơn nhưng nặng máy">
          <input
            type="number"
            min={1}
            max={10}
            className="inp !w-[80px] !py-0 h-9"
            value={s.concurrency}
            onChange={(e) => patch({ concurrency: Number(e.target.value) })}
          />
        </FieldRow>

        <FieldRow label="Đặt tên file theo tiêu đề video" hint="Để Template lấy làm caption khi upload">
          <Toggle on={s.nameByTitle} onChange={(v) => patch({ nameByTitle: v })} />
        </FieldRow>

        <div className="border-t border-borderSoft" />

        {/* Nhãn nói thẳng cái nào dùng được. Đo trên máy thật: Chrome 150 tắt
            hẳn vẫn lỗi "Failed to decrypt with DPAPI" — từ bản 127 các trình
            duyệt nhân Chromium mã hoá cookie bằng App-Bound Encryption nên
            yt-dlp không đọc được, và ĐÓNG TRÌNH DUYỆT KHÔNG GIÚP GÌ. Chỉ Firefox
            còn chạy. Gợi ý cũ ghi "nên đóng trình duyệt" là chỉ sai cách sửa. */}
        {/* Đường vòng cho chuyện Chrome/Edge mã hoá cookie: Chromium của ShardX
            không có App-Bound Encryption nên yt-dlp đọc được cookie của nó. Đo
            thật trên một hồ sơ có sẵn: "Extracted 7 cookies from chrome". */}
        <Field
          label="Cookie từ hồ sơ ảo (khuyên dùng)"
          hint="Mở hồ sơ, đăng nhập một tài khoản Google phụ, đóng lại rồi chọn ở đây. Đừng mở hồ sơ đó lướt YouTube nữa — cookie sẽ bị xoay và hỏng."
        >
          <Select
            value={s.cookieProfileId ?? ''}
            onChange={(v) => patch({ cookieProfileId: v })}
            options={[{ value: '', label: 'Không dùng' }, ...profiles.map((p) => ({ value: p.id, label: p.name }))]}
          />
        </Field>

        <Field
          label="Cookie trình duyệt (chống bot)"
          hint={
            'Chỉ dùng khi để trống ô trên. ' +
            'Chrome/Edge/Brave từ bản 127 mã hoá cookie nên yt-dlp KHÔNG đọc được (đóng trình duyệt cũng vô ích) — hãy dùng Firefox.'
          }
        >
          <Select
            value={s.cookieBrowser ?? ''}
            onChange={(v) => patch({ cookieBrowser: v })}
            options={[
              { value: '', label: 'Không dùng' },
              { value: 'firefox', label: 'Firefox — dùng được' },
              { value: 'chrome', label: 'Chrome — bị mã hoá, không đọc được' },
              { value: 'edge', label: 'Edge — bị mã hoá, không đọc được' },
              { value: 'brave', label: 'Brave — bị mã hoá, không đọc được' },
              {
                value: 'chromium',
                label: 'Chromium — bị mã hoá, không đọc được',
              },
              { value: 'opera', label: 'Opera — bị mã hoá, không đọc được' },
              {
                value: 'vivaldi',
                label: 'Vivaldi — bị mã hoá, không đọc được',
              },
            ]}
          />
        </Field>
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

export function GetVideoTab(): JSX.Element {
  const [channels, setChannels] = useState<GvChannel[]>([])
  const [settings, setSettings] = useState<GvSettings | null>(null)
  const [newUrl, setNewUrl] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const logRef = useRef<HTMLDivElement>(null)

  const reload = async (): Promise<void> => {
    setChannels(await window.hnv.getvideo.listChannels())
  }

  useEffect(() => {
    reload()
    window.hnv.getvideo.getSettings().then(setSettings)
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
    await window.hnv.getvideo.addChannel(u)
    setNewUrl('')
    reload()
  }

  const update = async (c: GvChannel): Promise<void> => {
    setBusy(c.id)
    try {
      const r = await window.hnv.getvideo.update(c.id)
      setLogs((p) => [...p, `✓ ${c.name || c.url}: ${r.downloaded} tải, ${r.skipped} bỏ qua, ${r.failed} lỗi`])
    } catch (e: any) {
      showToast(e?.message ?? 'Lỗi crawl', 'error')
    } finally {
      setBusy(null)
      reload()
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
        <span className="text-[12px] text-muted bg-[#101117] border border-border rounded-full px-2.5 py-0.5">
          YouTube Shorts → Pending
        </span>
      </div>

      {/* min-h-0: thiếu thì hàng này phình theo nội dung, overflow bên trong mất cuộn */}
      <div className="flex-1 flex min-w-0 min-h-0">
        {/* TRÁI: danh sách channel theo dõi */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-[22px] pt-1 pb-3 flex items-center gap-2.5 shrink-0">
            <input
              className="inp flex-1"
              placeholder="Dán link channel hoặc @handle… (vd: @MrBeast)"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
            <button
              onClick={add}
              className="accent-grad text-[#0a0b10] font-bold rounded-[9px] px-4 py-2.5 text-[14px] whitespace-nowrap shrink-0"
            >
              + Thêm channel
            </button>
          </div>

          <div className="px-[22px] pb-2 flex items-center shrink-0">
            <div className="text-[12px] uppercase tracking-wider text-muted font-semibold">Channel theo dõi</div>
            <span className="ml-2 text-[12px] text-muted">{channels.length} channel</span>
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
            <div className="text-[12px] uppercase tracking-wider text-muted font-semibold mb-2">Hoạt động</div>
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
        {settings && <SettingsPane settings={settings} onSaved={setSettings} />}
      </div>
    </div>
  )
}
