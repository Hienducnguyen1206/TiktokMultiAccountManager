import { useEffect, useState } from 'react'
import { RunPickerDialog } from './RunPickerDialog'
import { confirmDialog, showToast } from '../../components/uiDialogs'
import type { Template, UploadVideoConfig, CaptionMode, VideoOrder } from '@shared/types'

const TAG_PALETTE = ['#818cf8', '#22d3ee', '#fb923c', '#34d399', '#f43f5e', '#c084fc', '#facc15']

function Seg<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { v: T; label: string }[]
  onChange: (v: T) => void
}): JSX.Element {
  return (
    <div className="flex gap-2 flex-wrap">
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={
            'rounded-lg px-3.5 py-2 text-[13px] border ' +
            (o.v === value
              ? 'text-white font-semibold border-[#3a3d6b] bg-[linear-gradient(100deg,rgba(99,102,241,.2),rgba(34,211,238,.08))]'
              : 'text-subtle border-border bg-[#101117]')
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <button
      onClick={() => onChange(!on)}
      className={'w-[42px] h-[24px] rounded-full relative transition ' + (on ? 'accent-grad' : 'bg-border')}
    >
      <span
        className={'absolute top-[3px] w-[18px] h-[18px] rounded-full transition-all ' + (on ? 'right-[3px] bg-white' : 'left-[3px] bg-muted')}
      />
    </button>
  )
}

function FolderCard({
  icon,
  label,
  hint,
  value,
  count,
  countColor,
  onPick,
  onOpen
}: {
  icon: string
  label: string
  hint?: string
  value: string
  count: number
  countColor: string
  onPick: () => void
  onOpen: () => void
}): JSX.Element {
  return (
    <div className="bg-card border border-borderSoft rounded-[12px] p-4">
      <div className="flex items-center mb-3">
        <div className="text-[15px] font-semibold">
          {icon} {label}
        </div>
        {hint && <span className="text-[12px] text-muted ml-2">{hint}</span>}
        <span
          className="ml-auto text-[13px] font-bold rounded-full px-3 py-1 border"
          style={{ color: countColor, borderColor: countColor + '55', background: countColor + '1a' }}
        >
          {count} video
        </span>
      </div>
      <div className="flex gap-2">
        <input className="inp" readOnly value={value} placeholder="(chưa chọn thư mục)" />
        <button onClick={onPick} className="bg-surface text-[#c7c8d4] border border-border rounded-[9px] px-4 text-[14px] shrink-0">
          Chọn…
        </button>
        <button
          onClick={onOpen}
          disabled={!value}
          title="Mở thư mục"
          className="bg-surface text-[#c7c8d4] border border-border rounded-[9px] px-4 text-[14px] shrink-0 disabled:opacity-40"
        >
          📂 Open
        </button>
      </div>
    </div>
  )
}

function CodeEditor({
  code,
  onClose,
  onSave
}: {
  code: string
  onClose: () => void
  onSave: (c: string) => void
}): JSX.Element {
  const [c, setC] = useState(code)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-[760px] bg-[#0d0e14] border border-border rounded-[14px] shadow-2xl overflow-hidden">
        <div className="px-[22px] py-[16px] border-b border-borderSoft flex items-center">
          <div className="text-[17px] font-bold">{'</>'} Code editor — script TikTok</div>
          <button onClick={onClose} className="ml-auto text-muted text-lg">✕</button>
        </div>
        <textarea
          value={c}
          onChange={(e) => setC(e.target.value)}
          spellCheck={false}
          className="hv-scroll w-full h-[420px] bg-[#08090d] text-[#e7e7ee] font-mono text-[13px] leading-relaxed p-4 outline-none resize-none"
        />
        <div className="px-[22px] py-3.5 border-t border-borderSoft flex gap-2.5 items-center">
          <button
            onClick={async () => {
              if (await confirmDialog({ title: 'Khôi phục script', message: 'Khôi phục script về bản mặc định mới nhất? Code hiện tại sẽ bị thay thế.', confirmText: 'Khôi phục', danger: false })) {
                setC(await window.hnv.templates.defaultScript('upload-video'))
              }
            }}
            className="text-[#c084fc] text-[13px]"
          >
            ↺ Khôi phục mặc định
          </button>
          <button onClick={onClose} className="ml-auto bg-surface text-[#c7c8d4] border border-border rounded-[9px] px-[18px] py-2.5 text-[14px]">Hủy</button>
          <button onClick={() => onSave(c)} className="accent-grad text-[#0a0b10] font-bold rounded-[9px] px-[22px] py-2.5 text-[14px]">Lưu code</button>
        </div>
      </div>
    </div>
  )
}

export function TemplateTab(): JSX.Element {
  const [list, setList] = useState<Template[]>([])
  const [sel, setSel] = useState<Template | null>(null)
  const [dirty, setDirty] = useState(false)
  const [showCode, setShowCode] = useState(false)
  const [showRun, setShowRun] = useState(false)
  const [ranMsg, setRanMsg] = useState<string | null>(null)
  const [newTag, setNewTag] = useState('')
  const [newColor, setNewColor] = useState(TAG_PALETTE[0])
  const [counts, setCounts] = useState({ pending: 0, uploaded: 0, error: 0 })

  const refreshCounts = async (): Promise<void> => {
    const c = sel?.config as UploadVideoConfig | undefined
    if (!c) return
    const [p, u, e] = await Promise.all([
      window.hnv.system.countVideos(c.pendingDir),
      window.hnv.system.countVideos(c.uploadedDir),
      window.hnv.system.countVideos(c.errorDir)
    ])
    setCounts({ pending: p, uploaded: u, error: e })
  }

  const load = async (): Promise<void> => {
    const ts = await window.hnv.templates.list()
    setList(ts)
    setSel((cur) => ts.find((t) => t.id === cur?.id) ?? ts[0] ?? null)
  }
  useEffect(() => {
    load()
  }, [])

  // Đếm số video trong 3 thư mục khi đổi template hoặc đổi đường dẫn.
  useEffect(() => {
    refreshCounts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel?.id, (sel?.config as UploadVideoConfig | undefined)?.pendingDir, (sel?.config as UploadVideoConfig | undefined)?.uploadedDir, (sel?.config as UploadVideoConfig | undefined)?.errorDir])

  const cfg = sel?.config as UploadVideoConfig | undefined
  const patchCfg = (p: Partial<UploadVideoConfig>): void => {
    if (!sel) return
    setSel({ ...sel, config: { ...(sel.config as UploadVideoConfig), ...p } })
    setDirty(true)
  }

  /** Rời template đang mở khi còn thay đổi chưa lưu. Trước đây mọi nơi gọi setSel()
   *  thẳng: thay đổi bị bỏ ÂM THẦM (không hỏi gì) và cờ dirty còn nguyên → nút footer
   *  hiện "Lưu" bấm được cho template MỚI dù nó chưa hề bị sửa; bấm vào là ghi đè
   *  template mới trong khi người dùng tưởng vừa lưu template cũ. */
  const confirmLeaveDirty = async (): Promise<boolean> => {
    if (!dirty) return true
    return confirmDialog({
      title: 'Bỏ thay đổi chưa lưu?',
      message: `"${sel?.name}" đang có thay đổi chưa lưu. Rời khỏi nó sẽ mất các thay đổi này.`,
      confirmText: 'Bỏ thay đổi'
    })
  }

  const selectTemplate = async (t: Template): Promise<void> => {
    if (t.id === sel?.id) return
    if (!(await confirmLeaveDirty())) return
    setSel(t)
    setDirty(false)
  }

  const createNew = async (): Promise<void> => {
    if (!(await confirmLeaveDirty())) return
    const t = await window.hnv.templates.create('upload-video')
    await load()
    setSel(t)
    setDirty(false)
  }
  const save = async (): Promise<void> => {
    if (!sel) return
    await window.hnv.templates.save(sel)
    setDirty(false)
    await load()
  }
  const del = async (): Promise<void> => {
    if (!sel) return
    if (!(await confirmDialog({ title: 'Xóa template', message: `Xóa template "${sel.name}"?`, confirmText: '🗑 Xóa' }))) return
    await window.hnv.templates.remove(sel.id)
    setSel(null)
    setDirty(false) // template vừa xóa có thể đang dirty — đừng để cờ dính sang cái kế
    await load()
  }
  const pick = async (key: 'pendingDir' | 'uploadedDir' | 'errorDir'): Promise<void> => {
    const dir = await window.hnv.system.pickFolder()
    if (dir) patchCfg({ [key]: dir } as Partial<UploadVideoConfig>)
  }
  const openDir = async (dir: string): Promise<void> => {
    if (!dir) return
    const ok = await window.hnv.system.openFolder(dir)
    if (!ok) showToast('Không mở được thư mục (đường dẫn không tồn tại?)', 'error')
  }
  const addTag = (): void => {
    const t = newTag.trim().replace(/^#?/, '#')
    if (!cfg || t === '#') return
    if (!cfg.hashtags.some((h) => h.tag === t)) patchCfg({ hashtags: [...cfg.hashtags, { tag: t, color: newColor }] })
    setNewTag('')
  }
  const removeTag = (tag: string): void => {
    if (!cfg) return
    const hashtags = cfg.hashtags.filter((h) => h.tag !== tag)
    patchCfg({ hashtags, hashtagCount: Math.min(cfg.hashtagCount, hashtags.length) })
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Tiêu đề tab nằm trên cùng, trải hết bề ngang — giống mọi tab khác */}
      <div className="px-[22px] pt-[18px] pb-3.5 text-[21px] font-bold shrink-0">📋 Template</div>

      {/* min-h-0: flex-1 mặc định min-height:auto nên hàng này phình theo nội dung,
          làm overflow-auto bên trong không bao giờ có chiều cao giới hạn → mất cuộn. */}
      <div className="flex-1 flex min-w-0 min-h-0">
        {/* list */}
      <div className="w-[210px] shrink-0 border-r border-borderSoft flex flex-col">
        <div className="px-4 pt-1 pb-3 flex items-center">
          <div className="text-[12px] uppercase tracking-wider text-muted font-semibold">Danh sách</div>
          <button onClick={createNew} className="ml-auto accent-grad text-[#0a0b10] font-bold rounded-lg px-3 py-1.5 text-[13px]">+ Mới</button>
        </div>
        <div className="flex-1 overflow-auto hv-scroll px-2.5">
          {list.map((t) => (
            <div
              key={t.id}
              onClick={() => selectTemplate(t)}
              className={
                'my-1 px-3 py-2.5 rounded-[9px] cursor-pointer ' +
                (t.id === sel?.id ? 'border border-[#3a3d6b] bg-[linear-gradient(100deg,rgba(129,140,248,.16),transparent)]' : 'text-[#c7c8d4] hover:bg-surface')
              }
            >
              <div className="font-bold">{t.name}</div>
              <div className="text-[12px] text-muted mt-0.5">📹 TikTok · code sẵn</div>
            </div>
          ))}
          {list.length === 0 && <div className="text-muted text-[13px] px-2 mt-3">Chưa có template. Bấm + Mới.</div>}
        </div>
      </div>

      {/* config */}
      {sel && cfg ? (
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-5 py-3.5 border-b border-borderSoft flex items-center gap-2.5">
            <input
              value={sel.name}
              onChange={(e) => {
                setSel({ ...sel, name: e.target.value })
                setDirty(true)
              }}
              className="bg-[#101117] border border-border rounded-lg px-3 py-2 text-[16px] font-bold outline-none w-[220px]"
            />
            <button onClick={() => setShowCode(true)} className="ml-auto bg-surface text-[#c084fc] border border-border rounded-lg px-3.5 py-2 text-[13px] font-semibold">
              {'</>'} Code editor
            </button>
            <button
              onClick={() => setShowRun(true)}
              className="bg-[#1f3a2e] text-ok border border-[#2c5443] rounded-lg px-4 py-2 text-[13px] font-semibold"
            >
              ▶ Chạy…
            </button>
          </div>

          <div className="flex-1 overflow-y-auto hv-scroll px-5 py-4">
            {/* THƯ MỤC */}
            <div className="flex items-center mb-2.5">
              <div className="text-[12px] uppercase tracking-wide text-muted font-bold">
                Thư mục <span className="normal-case font-normal text-ok">· dùng chung mọi profile</span>
              </div>
              <button onClick={refreshCounts} className="ml-auto text-[12px] text-accent2 border border-border rounded-md px-2.5 py-1">
                🔄 Cập nhật số
              </button>
            </div>
            <div className="space-y-3 mb-4">
              <FolderCard icon="📂" label="Pending" hint="video chờ upload" value={cfg.pendingDir} count={counts.pending} countColor="#22d3ee" onPick={() => pick('pendingDir')} onOpen={() => openDir(cfg.pendingDir)} />
              <FolderCard icon="✅" label="Uploaded" hint="đăng xong" value={cfg.uploadedDir} count={counts.uploaded} countColor="#34d399" onPick={() => pick('uploadedDir')} onOpen={() => openDir(cfg.uploadedDir)} />
              <FolderCard icon="❌" label="Error" hint="lỗi / vi phạm" value={cfg.errorDir} count={counts.error} countColor="#fb7185" onPick={() => pick('errorDir')} onOpen={() => openDir(cfg.errorDir)} />
            </div>

            {/* THỨ TỰ */}
            <div className="text-[12px] uppercase tracking-wide text-muted font-bold mb-2.5">Thứ tự lấy video</div>
            <div className="bg-card border border-borderSoft rounded-[12px] p-4 mb-4">
              <Seg<VideoOrder>
                value={cfg.videoOrder}
                onChange={(v) => patchCfg({ videoOrder: v })}
                options={[
                  { v: 'oldest', label: 'Cũ nhất trước' },
                  { v: 'newest', label: 'Mới nhất trước' },
                  { v: 'random', label: 'Ngẫu nhiên' },
                  { v: 'name', label: 'Tên A→Z' }
                ]}
              />
            </div>

            {/* CAPTION */}
            <div className="text-[12px] uppercase tracking-wide text-muted font-bold mb-2.5">Caption</div>
            <div className="bg-card border border-borderSoft rounded-[12px] p-4 mb-4">
              <Seg<CaptionMode>
                value={cfg.captionMode}
                onChange={(v) => patchCfg({ captionMode: v })}
                options={[
                  { v: 'filename', label: 'Lấy tên file video' },
                  { v: 'empty', label: 'Để trống' },
                  { v: 'custom', label: 'Tùy chỉnh ✨' }
                ]}
              />
              {cfg.captionMode === 'custom' && (
                <input
                  className="inp mt-3"
                  placeholder="Caption mẫu, dùng {filename} để chèn tên file…"
                  value={cfg.captionCustom}
                  onChange={(e) => patchCfg({ captionCustom: e.target.value })}
                />
              )}
              {cfg.captionMode === 'filename' && (
                <div className="text-[12px] text-muted mt-2">vd "dancing_clip.mp4" → caption "dancing clip"</div>
              )}
            </div>

            {/* KIỂM TRA TRƯỚC KHI ĐĂNG */}
            <div className="text-[12px] uppercase tracking-wide text-muted font-bold mb-2.5">Kiểm tra trước khi đăng</div>
            <div className="bg-card border border-borderSoft rounded-[12px] p-4 mb-4">
              <div className="flex items-center mb-3.5">
                <div>
                  <div className="text-[14px]">🎵 Kiểm tra bản quyền nhạc</div>
                  <div className="text-[12px] text-muted mt-0.5">Bật: nếu vi phạm bản quyền → không đăng, chuyển sang Error</div>
                </div>
                <div className="ml-auto">
                  <Toggle on={cfg.checkCopyright} onChange={(v) => patchCfg({ checkCopyright: v })} />
                </div>
              </div>
              <div className="flex items-center">
                <div>
                  <div className="text-[14px]">🛡️ Kiểm tra nội dung</div>
                  <div className="text-[12px] text-muted mt-0.5">Bật: nếu vi phạm nội dung → không đăng, chuyển sang Error</div>
                </div>
                <div className="ml-auto">
                  <Toggle on={cfg.checkContent} onChange={(v) => patchCfg({ checkContent: v })} />
                </div>
              </div>
            </div>

            {/* HASHTAG */}
            <div className="text-[12px] uppercase tracking-wide text-muted font-bold mb-2.5">Hashtag</div>
            <div className="bg-card border border-borderSoft rounded-[14px] overflow-hidden">
              {/* pool header */}
              <div className="flex items-center px-4 py-3.5 border-b border-borderSoft">
                <div className="text-[14px] font-bold">🏷️ Pool hashtag</div>
                <span className="ml-2.5 text-[12px] text-muted bg-[#101117] border border-border rounded-full px-2.5 py-0.5">
                  {cfg.hashtags.length} tag
                </span>
                <span className="ml-auto text-[12px] text-ok">luôn lấy ngẫu nhiên từ pool</span>
              </div>
              {/* chips */}
              <div className="p-4 flex flex-wrap gap-2.5 min-h-[60px]">
                {cfg.hashtags.length === 0 && <span className="text-muted text-[13px]">Chưa có tag — thêm bên dưới.</span>}
                {cfg.hashtags.map((h) => (
                  <span
                    key={h.tag}
                    className="text-[13px] px-2.5 py-1.5 rounded-full font-semibold inline-flex items-center gap-1.5 border"
                    style={{ background: h.color + '26', color: h.color, borderColor: h.color + '66' }}
                  >
                    {h.tag}
                    <span className="opacity-60 cursor-pointer" onClick={() => removeTag(h.tag)}>
                      ✕
                    </span>
                  </span>
                ))}
              </div>
              {/* add row */}
              <div className="px-4 py-3.5 border-t border-borderSoft bg-bg">
                <div className="text-[12px] text-muted mb-2">Thêm hashtag vào pool</div>
                <div className="flex items-center gap-2.5">
                  <input
                    className="inp flex-1"
                    placeholder="nhập hashtag… (vd: viral)"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addTag()}
                  />
                  <div className="flex items-center gap-1.5">
                    {TAG_PALETTE.map((c) => (
                      <span
                        key={c}
                        onClick={() => setNewColor(c)}
                        className={'w-[22px] h-[22px] rounded-full cursor-pointer border-2 ' + (c === newColor ? 'border-white' : 'border-transparent')}
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                  <button onClick={addTag} className="accent-grad text-[#0a0b10] font-bold rounded-[9px] px-4 py-2.5 text-[14px] whitespace-nowrap">
                    + Thêm
                  </button>
                </div>
              </div>
            </div>

            {/* count */}
            <div className="mt-4">
              <div className="flex items-center mb-2">
                <div className="text-[13px] text-subtle">Số hashtag thêm vào mỗi video</div>
                <div className="ml-auto min-w-[40px] text-center accent-grad text-[#0a0b10] font-extrabold px-2.5 py-0.5 rounded-lg">
                  {cfg.hashtagCount}
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(0, cfg.hashtags.length)}
                value={cfg.hashtagCount}
                onChange={(e) => patchCfg({ hashtagCount: Number(e.target.value) })}
                className="hv-range"
              />
              <div className="flex justify-between text-[11px] text-muted mt-1.5">
                <span>0</span>
                <span>{cfg.hashtags.length} (tối đa)</span>
              </div>
            </div>
          </div>

          <div className="px-5 py-3.5 border-t border-borderSoft flex items-center gap-2.5">
            <button onClick={del} className="text-danger border border-[#5a2c33] bg-[rgba(251,113,133,.10)] rounded-[9px] px-[22px] py-2.5 text-[14px] font-semibold">🗑 Xóa template</button>
            <button onClick={save} disabled={!dirty} className="ml-auto accent-grad text-[#0a0b10] font-bold rounded-[9px] px-[22px] py-2.5 text-[14px] disabled:opacity-40">
              {dirty ? 'Lưu' : 'Đã lưu'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted">
          <div className="text-center">
            <div className="text-xl font-bold mb-2">Chưa có template</div>
            <div>Bấm <b className="text-accent2">+ Mới</b> để tạo "Upload video".</div>
          </div>
        </div>
      )}
      </div>

      {showCode && sel && (
        <CodeEditor
          code={sel.scriptCode}
          onClose={() => setShowCode(false)}
          onSave={(c) => {
            setSel({ ...sel, scriptCode: c })
            setDirty(true)
            setShowCode(false)
          }}
        />
      )}

      {showRun && sel && (
        <RunPickerDialog
          templateId={sel.id}
          templateName={sel.name}
          onClose={() => setShowRun(false)}
          onRan={() => {
            setShowRun(false)
            setRanMsg('Đã thêm vào Queue — mở tab Queue để xem.')
            setTimeout(() => setRanMsg(null), 5000)
          }}
        />
      )}

      {ranMsg && (
        <div className="fixed bottom-5 right-5 z-50 bg-[#10231b] border border-[#2c5443] text-ok rounded-xl px-4 py-3 text-[14px] shadow-2xl">
          ✓ {ranMsg}
        </div>
      )}
    </div>
  )
}
