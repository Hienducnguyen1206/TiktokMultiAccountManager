import { useEffect, useRef, useState } from 'react'
import { confirmDialog, showToast } from '../../components/uiDialogs'
import type { GvChannel, GvSettings } from '@shared/types'

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <button
      onClick={() => onChange(!on)}
      className={'w-[42px] h-[24px] rounded-full relative transition shrink-0 ' + (on ? 'accent-grad' : 'bg-border')}
    >
      <span className={'absolute top-[3px] w-[18px] h-[18px] rounded-full transition-all ' + (on ? 'right-[3px] bg-white' : 'left-[3px] bg-muted')} />
    </button>
  )
}

function timeAgo(ts: number | null): string {
  if (!ts) return 'chưa crawl'
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s trước`
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`
  return `${Math.floor(s / 86400)} ngày trước`
}

function SettingsDialog({
  settings,
  onClose,
  onSaved
}: {
  settings: GvSettings
  onClose: () => void
  onSaved: (s: GvSettings) => void
}): JSX.Element {
  const [s, setS] = useState<GvSettings>(settings)
  const patch = (p: Partial<GvSettings>): void => setS((cur) => ({ ...cur, ...p }))

  const pickDir = async (): Promise<void> => {
    const dir = await window.hnv.system.pickFolder()
    if (dir) patch({ pendingDir: dir })
  }
  const save = async (): Promise<void> => {
    const saved = await window.hnv.getvideo.saveSettings(s)
    onSaved(saved)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-[560px] bg-[#0d0e14] border border-border rounded-[14px] shadow-2xl overflow-hidden">
        <div className="px-[22px] py-[16px] border-b border-borderSoft flex items-center">
          <div className="text-[17px] font-bold">⚙️ Cài đặt Get Video</div>
          <button onClick={onClose} className="ml-auto text-muted text-lg">✕</button>
        </div>

        <div className="p-5 space-y-4 h-[60vh] overflow-y-auto hv-scroll">
          {/* pending dir */}
          <div>
            <div className="text-[13px] text-subtle mb-1.5">Thư mục Pending (nơi lưu video)</div>
            <div className="flex gap-2">
              <input className="inp" readOnly value={s.pendingDir} placeholder="(chưa chọn)" />
              <button onClick={pickDir} className="bg-surface text-[#c7c8d4] border border-border rounded-[9px] px-4 text-[14px] shrink-0">Chọn…</button>
            </div>
          </div>

          {/* backfill mode */}
          <div>
            <div className="text-[13px] text-subtle mb-1.5">Chế độ Update (lấy video hiện có)</div>
            <div className="flex gap-2 mb-2">
              {(['hours', 'count', 'all'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => patch({ backfillMode: m })}
                  className={
                    'rounded-lg px-3.5 py-2 text-[13px] border ' +
                    (s.backfillMode === m
                      ? 'text-white font-semibold border-[#3a3d6b] bg-[linear-gradient(100deg,rgba(99,102,241,.2),rgba(34,211,238,.08))]'
                      : 'text-subtle border-border bg-[#101117]')
                  }
                >
                  {m === 'hours' ? 'Theo giờ đổ lại' : m === 'count' ? 'Theo số lượng' : 'Toàn bộ'}
                </button>
              ))}
            </div>
            {s.backfillMode === 'hours' ? (
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-muted">Lấy video trong</span>
                <input inputMode="numeric" className="inp w-[80px]" value={s.backfillHours} onChange={(e) => patch({ backfillHours: Number(e.target.value.replace(/\D/g, '')) })} />
                <span className="text-[13px] text-muted">giờ đổ lại</span>
              </div>
            ) : s.backfillMode === 'count' ? (
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-muted">Quét tối đa</span>
                <input inputMode="numeric" className="inp w-[80px]" value={s.backfillCount} onChange={(e) => patch({ backfillCount: Number(e.target.value.replace(/\D/g, '')) })} />
                <span className="text-[13px] text-muted">bài gần nhất</span>
              </div>
            ) : (
              <div className="text-[13px] text-muted">Lấy <b className="text-subtle">toàn bộ</b> video của channel, bỏ qua những video đã lấy ở các lần trước.</div>
            )}
          </div>

          {/* max duration */}
          <div className="flex items-center">
            <div>
              <div className="text-[14px]">Thời lượng tối đa (giây)</div>
              <div className="text-[12px] text-muted mt-0.5">Chỉ lấy short — bỏ video dài hơn</div>
            </div>
            <input type="number" min={1} className="inp w-[80px] ml-auto" value={s.maxDuration} onChange={(e) => patch({ maxDuration: Number(e.target.value) })} />
          </div>

          {/* concurrency */}
          <div className="flex items-center">
            <div>
              <div className="text-[14px]">Số tải song song</div>
              <div className="text-[12px] text-muted mt-0.5">Nhiều hơn = nhanh hơn nhưng nặng máy</div>
            </div>
            <input type="number" min={1} max={10} className="inp w-[80px] ml-auto" value={s.concurrency} onChange={(e) => patch({ concurrency: Number(e.target.value) })} />
          </div>

          {/* name by title */}
          <div className="flex items-center">
            <div>
              <div className="text-[14px]">Đặt tên file theo tiêu đề video</div>
              <div className="text-[12px] text-muted mt-0.5">Để Template lấy làm caption khi upload</div>
            </div>
            <div className="ml-auto"><Toggle on={s.nameByTitle} onChange={(v) => patch({ nameByTitle: v })} /></div>
          </div>

          {/* cookie browser (chống bot YouTube) */}
          <div className="flex items-center">
            <div>
              <div className="text-[14px]">Cookie trình duyệt (chống bot)</div>
              <div className="text-[12px] text-muted mt-0.5">Dùng khi gặp lỗi "Sign in to confirm you're not a bot". Nên ĐÓNG trình duyệt đó khi tải.</div>
            </div>
            <select
              className="inp w-[150px] ml-auto"
              value={s.cookieBrowser ?? ''}
              onChange={(e) => patch({ cookieBrowser: e.target.value })}
            >
              <option value="">Không dùng</option>
              <option value="chrome">Chrome</option>
              <option value="edge">Edge</option>
              <option value="firefox">Firefox</option>
              <option value="brave">Brave</option>
              <option value="chromium">Chromium</option>
              <option value="opera">Opera</option>
              <option value="vivaldi">Vivaldi</option>
            </select>
          </div>
        </div>

        <div className="px-[22px] py-3.5 border-t border-borderSoft flex gap-2.5 items-center">
          <button onClick={onClose} className="ml-auto bg-surface text-[#c7c8d4] border border-border rounded-[9px] px-[18px] py-2.5 text-[14px]">Hủy</button>
          <button onClick={save} className="accent-grad text-[#0a0b10] font-bold rounded-[9px] px-[22px] py-2.5 text-[14px]">Lưu</button>
        </div>
      </div>
    </div>
  )
}

export function GetVideoTab(): JSX.Element {
  const [channels, setChannels] = useState<GvChannel[]>([])
  const [settings, setSettings] = useState<GvSettings | null>(null)
  const [newUrl, setNewUrl] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const logRef = useRef<HTMLDivElement>(null)

  const reload = async (): Promise<void> => {
    setChannels(await window.hnv.getvideo.listChannels())
  }

  useEffect(() => {
    reload()
    window.hnv.getvideo.getSettings().then(setSettings)
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
    if (!(await confirmDialog({ title: 'Xóa channel', message: `Xóa channel "${c.name || c.url}"?`, confirmText: '🗑 Xóa' }))) return
    await window.hnv.getvideo.removeChannel(c.id)
    reload()
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* header */}
      <div className="px-[22px] pt-[18px] pb-3.5 flex items-center gap-3">
        <div className="text-[21px] font-bold">🎬 Get Video</div>
        <span className="text-[12px] text-muted bg-[#101117] border border-border rounded-full px-2.5 py-0.5">YouTube Shorts → Pending</span>
        <button
          onClick={() => setShowSettings(true)}
          className="ml-auto bg-surface text-[#c7c8d4] border border-border rounded-[10px] px-4 py-2.5 text-[14px] font-semibold"
        >
          ⚙️ Cài đặt
        </button>
      </div>

      <div className="flex-1 overflow-y-auto hv-scroll px-[22px] pb-5">
        {/* add channel */}
        <div className="bg-card border border-borderSoft rounded-[12px] p-4 mb-4 flex items-center gap-2.5">
          <input
            className="inp flex-1"
            placeholder="Dán link channel hoặc @handle… (vd: @MrBeast)"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button onClick={add} className="accent-grad text-[#0a0b10] font-bold rounded-[9px] px-4 py-2.5 text-[14px] whitespace-nowrap">+ Thêm channel</button>
        </div>

        {/* channel list */}
        <div className="flex items-center mb-2.5">
          <div className="text-[12px] uppercase tracking-wide text-muted font-bold">Channel theo dõi</div>
          <span className="ml-2 text-[12px] text-muted">{channels.length} channel</span>
        </div>
        <div className="bg-card border border-borderSoft rounded-[14px] overflow-hidden mb-4">
          {channels.length === 0 && <div className="text-muted text-[13px] px-4 py-5">Chưa có channel. Thêm ở trên.</div>}
          {channels.map((c, i) => (
            <div key={c.id} className={'flex items-center px-4 py-3 ' + (i > 0 ? 'border-t border-borderSoft' : '')}>
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
                  {busy === c.id ? '⏳ Đang tải…' : '🔄 Update'}
                </button>
                <button onClick={() => remove(c)} className="text-danger opacity-70 hover:opacity-100">✕</button>
              </div>
            </div>
          ))}
        </div>

        {/* log */}
        <div className="text-[12px] uppercase tracking-wide text-muted font-bold mb-2.5">Hoạt động</div>
        <div ref={logRef} className="bg-[#08090d] border border-borderSoft rounded-[12px] p-4 font-mono text-[12px] leading-relaxed text-[#9aa] h-[180px] overflow-y-auto hv-scroll">
          {logs.length === 0 ? <div className="text-muted">Chưa có hoạt động.</div> : logs.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      </div>

      {showSettings && settings && (
        <SettingsDialog
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSaved={(s) => {
            setSettings(s)
            setShowSettings(false)
          }}
        />
      )}
    </div>
  )
}
