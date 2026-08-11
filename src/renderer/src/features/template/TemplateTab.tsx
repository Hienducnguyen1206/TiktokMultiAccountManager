import { useEffect, useState } from 'react'
import { Icon, type IconName } from '../../components/Icon'
import { RunPickerDialog } from './RunPickerDialog'
import { WarmupConfigForm } from './WarmupConfigForm'
import { BulkVideoConfigForm } from './BulkVideoConfigForm'
import { TypeBadge, TYPE_STYLE } from './TypeBadge'
import { Toggle } from '../../components/Toggle'
import { confirmDialog, showToast } from '../../components/uiDialogs'
import type {
  Template,
  TemplateType,
  UploadVideoConfig,
  WarmupConfig,
  BulkVideoConfig,
  CaptionMode,
  VideoOrder,
} from '@shared/types'

const TAG_PALETTE = ['#818cf8', '#22d3ee', '#fb923c', '#34d399', '#f43f5e', '#c084fc', '#facc15']

function Seg<T extends string>({
  value,
  options,
  onChange,
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

/** Nút chỉ-biểu-tượng trong thẻ thư mục. 40px = đúng chiều cao ô nhập bên cạnh. */
const FOLDER_BTN =
  'w-10 h-10 shrink-0 inline-flex items-center justify-center rounded-[9px] font-bold disabled:opacity-40'

function FolderCard({
  icon,
  label,
  hint,
  value,
  count,
  countColor,
  onPick,
  onOpen,
  onClear,
}: {
  icon: IconName
  label: string
  hint?: string
  value: string
  count: number
  countColor: string
  onPick: () => void
  onOpen: () => void
  onClear: () => void
}): JSX.Element {
  return (
    <div className="bg-card border border-borderSoft rounded-[12px] p-4">
      <div className="flex items-center mb-3">
        {/* Tiêu đề ăn theo ĐÚNG màu của viên đếm bên phải — một màu cho cả thẻ:
            vàng = đang chờ, xanh lá = xong, đỏ = lỗi. Trước đây tiêu đề trắng
            trơn nên phải đọc chữ mới biết đang xem thư mục nào. */}
        <div className="text-[15px] font-semibold" style={{ color: countColor }}>
          <Icon name={icon} filled size={16} className="inline align-[-3px] mr-1" />
          {label}
        </div>
        {hint && <span className="text-[12px] text-muted ml-2">{hint}</span>}
        <span
          className="ml-auto text-[13px] font-bold rounded-full px-3 py-1 border"
          style={{
            color: countColor,
            borderColor: countColor + '55',
            background: countColor + '1a',
          }}
        >
          {count} video
        </span>
      </div>
      <div className="flex gap-2">
        <input className="inp" readOnly value={value} placeholder="(chưa chọn thư mục)" />
        <button
          onClick={onPick}
          className="bg-surface text-[#c7c8d4] border border-border rounded-[9px] px-4 text-[14px] shrink-0"
        >
          Chọn…
        </button>
        {/* Open và Dọn dẹp rút còn biểu tượng: hai chữ đó chiếm gần 200px của hàng
            mà ô đường dẫn — thứ thật sự cần bề ngang — thì đang bị bóp. Chữ chuyển
            hết vào tooltip. Nút ô vuông 40px cho bằng chiều cao ô nhập.

            Dọn dẹp giữ tông VÀNG chứ không đỏ: đỏ để dành cho nút xóa template ở
            chân trang, và cây chổi vàng là thứ đã chọn từ trước. Việc xóa vĩnh
            viễn vẫn được chặn bằng hộp xác nhận nêu rõ số lượng + đường dẫn. */}
        <button
          onClick={onOpen}
          disabled={!value}
          title="Mở thư mục"
          aria-label="Mở thư mục"
          className={FOLDER_BTN + ' accent-grad text-[#0a0b10]'}
        >
          <Icon name="folderOpen" filled size={18} />
        </button>
        {/* Vô hiệu khi count === 0: không có gì để xóa thì đừng mời người dùng bấm rồi
            hiện popup xác nhận "xóa 0 video". */}
        <button
          onClick={onClear}
          disabled={!value || count === 0}
          title={
            !value
              ? 'Chưa chọn thư mục'
              : count === 0
                ? 'Không có video nào để xóa'
                : `Dọn dẹp: xóa ${count} video trong ${label}`
          }
          aria-label="Dọn dẹp thư mục"
          className={FOLDER_BTN + ' warn-grad text-[#2a1608]'}
        >
          <Icon name="clean" filled size={18} />
        </button>
      </div>
    </div>
  )
}

function CodeEditor({
  code,
  type,
  onClose,
  onSave,
}: {
  code: string
  /** Loại của template đang mở — quyết định lấy script mặc định nào. */
  type: Template['type']
  onClose: () => void
  onSave: (c: string) => void
}): JSX.Element {
  const [c, setC] = useState(code)
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-[760px] bg-[#0d0e14] border border-border rounded-[14px] shadow-2xl overflow-hidden">
        <div className="px-[22px] py-[16px] border-b border-borderSoft flex items-center">
          <div className="text-[17px] font-bold">{'</>'} Code editor — script TikTok</div>
          <button onClick={onClose} className="ml-auto text-muted text-lg">
            <Icon name="close" filled size={18} className="inline align-[-3px]" />
          </button>
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
              if (
                await confirmDialog({
                  title: 'Khôi phục script',
                  message: 'Khôi phục script về bản mặc định mới nhất? Code hiện tại sẽ bị thay thế.',
                  confirmText: 'Khôi phục',
                  danger: false,
                })
              ) {
                setC(await window.hnv.templates.defaultScript(type))
              }
            }}
            className="text-[#c084fc] text-[13px]"
          >
            ↺ Khôi phục mặc định
          </button>
          <button
            onClick={onClose}
            className="ml-auto bg-surface text-[#c7c8d4] border border-border rounded-[9px] px-[18px] py-2.5 text-[14px]"
          >
            Hủy
          </button>
          <button
            onClick={() => onSave(c)}
            className="accent-grad text-[#0a0b10] font-bold rounded-[9px] px-[22px] py-2.5 text-[14px]"
          >
            Lưu code
          </button>
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
  /** Menu chọn loại khi bấm "+ Mới". */
  const [adding, setAdding] = useState(false)
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
      window.hnv.system.countVideos(c.errorDir),
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
  }, [
    sel?.id,
    (sel?.config as UploadVideoConfig | undefined)?.pendingDir,
    (sel?.config as UploadVideoConfig | undefined)?.uploadedDir,
    (sel?.config as UploadVideoConfig | undefined)?.errorDir,
  ])

  // Mỗi loại template một khuôn cấu hình khác hẳn — chỉ đúng một biến có giá trị.
  const cfg = sel?.type === 'upload-video' ? (sel.config as UploadVideoConfig) : undefined
  const wcfg = sel?.type === 'warmup' ? (sel.config as WarmupConfig) : undefined
  const bcfg = sel?.type === 'bulk-video' ? (sel.config as BulkVideoConfig) : undefined
  const patchCfg = (p: Partial<UploadVideoConfig>): void => {
    if (!sel) return
    setSel({ ...sel, config: { ...(sel.config as UploadVideoConfig), ...p } })
    setDirty(true)
  }
  const patchW = (p: Partial<WarmupConfig>): void => {
    if (!sel) return
    setSel({ ...sel, config: { ...(sel.config as WarmupConfig), ...p } })
    setDirty(true)
  }
  const patchB = (p: Partial<BulkVideoConfig>): void => {
    if (!sel) return
    setSel({ ...sel, config: { ...(sel.config as BulkVideoConfig), ...p } })
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
      confirmText: 'Bỏ thay đổi',
    })
  }

  const selectTemplate = async (t: Template): Promise<void> => {
    if (t.id === sel?.id) return
    if (!(await confirmLeaveDirty())) return
    setSel(t)
    setDirty(false)
  }

  /** Hai loại template dùng chung mọi thứ trừ khuôn cấu hình và script mặc định. */
  const createNew = async (type: TemplateType): Promise<void> => {
    if (!(await confirmLeaveDirty())) return
    setAdding(false)
    const t = await window.hnv.templates.create(type)
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
    if (
      !(await confirmDialog({
        title: 'Xóa template',
        message: `Xóa template "${sel.name}"?`,
        confirmText: 'Xóa',
      }))
    )
      return
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

  /** Xóa video trong 1 thư mục. XÓA THẬT khỏi ổ đĩa (không vào Thùng rác) nên bắt buộc
   *  xác nhận trước, và nêu rõ số lượng + đường dẫn để người dùng biết mình đang xóa cái gì. */
  const clearDir = async (dir: string, label: string, count: number): Promise<void> => {
    if (!dir || count === 0) return
    const ok = await confirmDialog({
      title: `Dọn dẹp ${label}?`,
      message: (
        <>
          Xóa <b className="text-danger">{count} video</b> trong thư mục:
          <div className="mt-1.5 font-mono text-[12px] text-subtle break-all">{dir}</div>
          <div className="mt-2.5">Xóa vĩnh viễn khỏi ổ đĩa, KHÔNG vào Thùng rác. Không thể hoàn tác.</div>
        </>
      ),
      confirmText: `Xóa ${count} video`,
    })
    if (!ok) return
    const { deleted, failed } = await window.hnv.system.clearVideos(dir)
    await refreshCounts()
    if (failed > 0) showToast(`Đã xóa ${deleted} video, ${failed} file không xóa được (đang mở ở nơi khác?)`, 'error')
    else showToast(`Đã xóa ${deleted} video trong ${label}`, 'success')
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
    patchCfg({
      hashtags,
      hashtagCount: Math.min(cfg.hashtagCount, hashtags.length),
    })
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Tiêu đề tab nằm trên cùng, trải hết bề ngang — giống mọi tab khác */}
      <div className="px-[22px] pt-[18px] pb-3.5 text-[21px] font-bold text-grad shrink-0 flex items-center gap-2">
        <Icon name="template" filled size={24} className="icon-grad" />
        Kịch bản
      </div>

      {/* min-h-0: flex-1 mặc định min-height:auto nên hàng này phình theo nội dung,
          làm overflow-auto bên trong không bao giờ có chiều cao giới hạn → mất cuộn. */}
      <div className="flex-1 flex min-w-0 min-h-0">
        {/* list */}
        <div className="w-[210px] shrink-0 border-r border-borderSoft flex flex-col">
          <div className="px-4 pt-1 pb-3 flex items-center">
            <div className="text-[12px] uppercase tracking-wider text-muted font-semibold">Danh sách</div>
            {/* Nhiều loại template nên "+ Mới" phải hỏi loại nào. Menu nhỏ ngay
              dưới nút, không dựng dialog cho một câu hỏi chọn một trong ba. */}
            <div className="ml-auto relative">
              <button
                onClick={() => setAdding((v) => !v)}
                className="accent-grad text-[#0a0b10] font-bold rounded-lg px-3 py-1.5 text-[13px]"
              >
                + Mới
              </button>
              {adding && (
                <>
                  <div className="fixed inset-0 z-[60]" onClick={() => setAdding(false)} />
                  <div className="absolute right-0 top-[34px] z-[61] w-[196px] bg-[#0d0e14] border border-border rounded-[10px] shadow-2xl overflow-hidden">
                    {(['upload-video', 'warmup', 'bulk-video'] as TemplateType[]).map((t, i) => (
                      <button
                        key={t}
                        onClick={() => createNew(t)}
                        className={
                          'w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-surface ' +
                          (i < 2 ? 'border-b border-borderSoft' : '')
                        }
                      >
                        {/* Vạch gradient dựng đứng: nhìn cột màu là ra loại, kể cả
                          khi mắt chưa kịp đọc chữ. */}
                        <span style={{ background: TYPE_STYLE[t].grad }} className="w-1 h-6 rounded-full shrink-0" />
                        {/* .icon là TÊN icon (chuỗi), phải dựng qua <Icon>. Trước
                            đây nó là emoji nên in thẳng ra được; sau khi đổi sang
                            bộ icon Google thì dòng này hiện "upload Upload". */}
                        <span className="text-[13.5px] font-semibold inline-flex items-center gap-1.5">
                          <Icon name={TYPE_STYLE[t].icon} filled size={15} />
                          {TYPE_STYLE[t].label}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-auto hv-scroll px-2.5">
            {/* Cả ô tô nguyên dải gradient của loại, chữ dùng sắc đậm cùng tông —
                đúng lối viên nhãn TypeBadge, chỉ phóng to ra cả dòng. Vì thế bỏ
                luôn vạch màu mép trái và viên nhãn bên trong: cả hai nói lại đúng
                thứ mà nền đã nói, mà lại là màu trùng màu nên chìm nghỉm.

                Dòng đang chọn phân biệt bằng viền sáng + đầy màu, dòng khác dịu
                đi. Không thể đổi nền để đánh dấu như trước, vì nền giờ là thứ
                mang thông tin loại. */}
            {list.map((t) => {
              const s = TYPE_STYLE[t.type]
              const on = t.id === sel?.id
              return (
                <div
                  key={t.id}
                  onClick={() => selectTemplate(t)}
                  style={{ background: s.grad, color: s.ink }}
                  className={
                    'my-1 px-3.5 py-2.5 rounded-[9px] cursor-pointer overflow-hidden transition ' +
                    (on ? 'ring-2 ring-white/80 shadow-lg' : 'opacity-[.72] hover:opacity-100')
                  }
                >
                  <div className="font-bold truncate">{t.name}</div>
                  <div className="mt-0.5 flex items-center gap-1 text-[11.5px] font-bold opacity-90">
                    <Icon name={s.icon} filled size={13} />
                    {s.label}
                  </div>
                </div>
              )
            })}
            {list.length === 0 && <div className="text-muted text-[13px] px-2 mt-3">Chưa có template. Bấm + Mới.</div>}
          </div>
        </div>

        {/* config */}
        {sel ? (
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
              <TypeBadge type={sel.type} />
              {/* Nút "Code editor" đã gỡ theo yêu cầu. Hộp thoại của nó (showCode)
                  vẫn còn nguyên bên dưới, chỉ là không còn chỗ nào mở ra — muốn
                  bật lại thì cắm lại một nút gọi setShowCode(true) là xong. */}
              <button
                onClick={() => setShowRun(true)}
                className="ml-auto bg-[#1f3a2e] text-ok border border-[#2c5443] rounded-lg px-4 py-2 text-[13px] font-semibold"
              >
                <Icon name="play" filled size={15} className="inline align-[-3px] mr-1" />
                Chạy…
              </button>
            </div>

            <div className="flex-1 overflow-y-auto hv-scroll px-5 py-4">
              {wcfg && <WarmupConfigForm cfg={wcfg} onPatch={patchW} />}
              {bcfg && <BulkVideoConfigForm cfg={bcfg} onPatch={patchB} />}
              {cfg && (
                <>
                  {/* THƯ MỤC */}
                  <div className="flex items-center mb-2.5">
                    <div className="text-[12px] uppercase tracking-wide text-muted font-bold">
                      Thư mục
                    </div>
                    <button
                      onClick={refreshCounts}
                      className="ml-auto text-[12px] text-accent2 border border-border rounded-md px-2.5 py-1"
                    >
                      <Icon name="refresh" filled size={15} className="inline align-[-3px] mr-1" />
                      Cập nhật số
                    </button>
                  </div>
                  <div className="space-y-3 mb-4">
                    <FolderCard
                      icon="folderOpen"
                      label="Chờ đăng"
                      hint="video chờ upload"
                      value={cfg.pendingDir}
                      count={counts.pending}
                      // Vàng chứ không xanh cyan như trước: ba thẻ giờ là bộ ba
                      // vàng / xanh lá / đỏ — chờ, xong, lỗi. Cyan trùng với dải
                      // thương hiệu nên đọc thành "bình thường", không phải "đang chờ".
                      countColor="#fbbf24"
                      onPick={() => pick('pendingDir')}
                      onOpen={() => openDir(cfg.pendingDir)}
                      onClear={() => clearDir(cfg.pendingDir, 'Chờ đăng', counts.pending)}
                    />
                    <FolderCard
                      icon="checkCircle"
                      label="Đã đăng"
                      hint="đăng xong"
                      value={cfg.uploadedDir}
                      count={counts.uploaded}
                      countColor="#34d399"
                      onPick={() => pick('uploadedDir')}
                      onOpen={() => openDir(cfg.uploadedDir)}
                      onClear={() => clearDir(cfg.uploadedDir, 'Đã đăng', counts.uploaded)}
                    />
                    <FolderCard
                      icon="cancel"
                      label="Lỗi"
                      hint="lỗi / vi phạm"
                      value={cfg.errorDir}
                      count={counts.error}
                      countColor="#fb7185"
                      onPick={() => pick('errorDir')}
                      onOpen={() => openDir(cfg.errorDir)}
                      onClear={() => clearDir(cfg.errorDir, 'Lỗi', counts.error)}
                    />
                  </div>

                  {/* THỨ TỰ */}
                  <div className="text-[12px] uppercase tracking-wide text-muted font-bold mb-2.5">
                    Thứ tự lấy video
                  </div>
                  <div className="bg-card border border-borderSoft rounded-[12px] p-4 mb-4">
                    <Seg<VideoOrder>
                      value={cfg.videoOrder}
                      onChange={(v) => patchCfg({ videoOrder: v })}
                      options={[
                        { v: 'oldest', label: 'Cũ nhất trước' },
                        { v: 'newest', label: 'Mới nhất trước' },
                        { v: 'random', label: 'Ngẫu nhiên' },
                        { v: 'name', label: 'Tên A→Z' },
                      ]}
                    />
                  </div>

                  {/* CAPTION */}
                  <div className="text-[12px] uppercase tracking-wide text-muted font-bold mb-2.5">Chú thích</div>
                  <div className="bg-card border border-borderSoft rounded-[12px] p-4 mb-4">
                    <Seg<CaptionMode>
                      value={cfg.captionMode}
                      onChange={(v) => patchCfg({ captionMode: v })}
                      options={[
                        { v: 'filename', label: 'Lấy tên file video' },
                        { v: 'empty', label: 'Để trống' },
                        { v: 'custom', label: 'Tùy chỉnh' },
                      ]}
                    />
                    {cfg.captionMode === 'custom' && (
                      <input
                        className="inp mt-3"
                        placeholder="Chú thích mẫu, dùng {filename} để chèn tên file…"
                        value={cfg.captionCustom}
                        onChange={(e) => patchCfg({ captionCustom: e.target.value })}
                      />
                    )}
                    {cfg.captionMode === 'filename' && (
                      <div className="text-[12px] text-muted mt-2">vd "dancing_clip.mp4" → chú thích "dancing clip"</div>
                    )}
                  </div>

                  {/* KIỂM TRA TRƯỚC KHI ĐĂNG */}
                  <div className="text-[12px] uppercase tracking-wide text-muted font-bold mb-2.5">
                    Kiểm tra trước khi đăng
                  </div>
                  <div className="bg-card border border-borderSoft rounded-[12px] p-4 mb-4">
                    <div className="flex items-center mb-3.5">
                      <div>
                        <div className="text-[14px]">
                          <Icon name="music" filled size={15} className="inline align-[-3px] mr-1" />
                          Kiểm tra bản quyền nhạc
                        </div>
                        <div className="text-[12px] text-muted mt-0.5">
                          Bật: nếu vi phạm bản quyền → không đăng, chuyển sang Error
                        </div>
                      </div>
                      <div className="ml-auto">
                        <Toggle on={cfg.checkCopyright} onChange={(v) => patchCfg({ checkCopyright: v })} />
                      </div>
                    </div>
                    <div className="flex items-center">
                      <div>
                        <div className="text-[14px]">
                          <Icon name="shield" filled size={15} className="inline align-[-3px] mr-1" />
                          Kiểm tra nội dung
                        </div>
                        <div className="text-[12px] text-muted mt-0.5">
                          Bật: nếu vi phạm nội dung → không đăng, chuyển sang Error
                        </div>
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
                      <div className="text-[14px] font-bold">
                        <Icon name="tag" filled size={15} className="inline align-[-3px] mr-1" />
                        Kho hashtag
                      </div>
                      <span className="ml-2.5 text-[12px] text-muted bg-[#101117] border border-border rounded-full px-2.5 py-0.5">
                        {cfg.hashtags.length} thẻ
                      </span>
                      <span className="ml-auto text-[12px] text-ok">luôn lấy ngẫu nhiên từ pool</span>
                    </div>
                    {/* chips */}
                    <div className="p-4 flex flex-wrap gap-2.5 min-h-[60px]">
                      {cfg.hashtags.length === 0 && (
                        <span className="text-muted text-[13px]">Chưa có tag — thêm bên dưới.</span>
                      )}
                      {cfg.hashtags.map((h) => (
                        <span
                          key={h.tag}
                          className="text-[13px] px-2.5 py-1.5 rounded-full font-semibold inline-flex items-center gap-1.5 border"
                          style={{
                            background: h.color + '26',
                            color: h.color,
                            borderColor: h.color + '66',
                          }}
                        >
                          {h.tag}
                          <span className="opacity-60 cursor-pointer" onClick={() => removeTag(h.tag)}>
                            <Icon name="close" filled size={13} className="inline align-[-3px]" />
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
                              className={
                                'w-[22px] h-[22px] rounded-full cursor-pointer border-2 ' +
                                (c === newColor ? 'border-white' : 'border-transparent')
                              }
                              style={{ background: c }}
                            />
                          ))}
                        </div>
                        <button
                          onClick={addTag}
                          className="accent-grad text-[#0a0b10] font-bold rounded-[9px] px-4 py-2.5 text-[14px] whitespace-nowrap"
                        >
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
                </>
              )}
            </div>

            <div className="px-5 py-3.5 border-t border-borderSoft flex items-center gap-2.5">
              {/* Cùng một khuôn với nút "Xóa tất cả" ở tab Hồ sơ: gradient đỏ đặc,
                  chữ tối, quầng đỏ — hai nút cùng mức hậu quả thì phải trông giống
                  nhau, chứ không phải một cái nền đỏ nhạt một cái nền đỏ đặc. */}
              <button
                onClick={del}
                className="h-10 inline-flex items-center gap-1.5 danger-grad text-[#2a0d12] font-bold text-[14px] rounded-[10px] px-4 shadow-[0_0_18px_rgba(244,63,94,.26)]"
              >
                <Icon name="trash" filled size={18} className="shrink-0" />
                Xóa template
              </button>
              <button
                onClick={save}
                disabled={!dirty}
                className="ml-auto accent-grad text-[#0a0b10] font-bold rounded-[9px] px-[22px] py-2.5 text-[14px] disabled:opacity-40"
              >
                {dirty ? 'Lưu' : 'Đã lưu'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted">
            <div className="text-center">
              <div className="text-xl font-bold mb-2">Chưa có template</div>
              <div>
                Bấm <b className="text-accent2">+ Mới</b> rồi chọn loại template.
              </div>
            </div>
          </div>
        )}
      </div>

      {showCode && sel && (
        <CodeEditor
          code={sel.scriptCode}
          type={sel.type}
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
          <Icon name="check" filled size={15} className="inline align-[-3px] mr-1" />
          {ranMsg}
        </div>
      )}
    </div>
  )
}
