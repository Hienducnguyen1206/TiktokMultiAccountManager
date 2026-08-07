import type { NumRange, WarmupConfig } from '@shared/types'

/**
 * Một tham số kiểu khoảng: hai ô số min–max.
 *
 * Gõ min lớn hơn max thì kéo max theo (và ngược lại) ngay tại chỗ, thay vì để
 * lưu xong mới báo lỗi — khoảng ngược đầu không có nghĩa gì, chặn luôn cho gọn.
 */
function RangeRow({
  label,
  unit,
  value,
  onChange,
}: {
  label: string
  unit: string
  value: NumRange
  onChange: (r: NumRange) => void
}): JSX.Element {
  const set = (k: 'min' | 'max', raw: string): void => {
    const n = Math.max(0, Math.floor(Number(raw) || 0))
    const next = { ...value, [k]: n }
    if (k === 'min' && n > value.max) next.max = n
    if (k === 'max' && n < value.min) next.min = n
    onChange(next)
  }
  const box =
    'w-[68px] h-9 bg-[#101117] border border-border rounded-[9px] px-2.5 text-[14px] text-center outline-none focus:border-[#3a3d6b]'
  return (
    <div className="flex items-center gap-3 py-3 border-b border-borderSoft last:border-0">
      <div className="min-w-0 flex-1 text-[13.5px] text-text">{label}</div>
      <div className="flex items-center gap-1.5 shrink-0">
        <input type="number" min={0} value={value.min} onChange={(e) => set('min', e.target.value)} className={box} />
        <span className="text-muted text-[13px]">–</span>
        <input type="number" min={0} value={value.max} onChange={(e) => set('max', e.target.value)} className={box} />
        <span className="text-[12px] text-muted w-[38px]">{unit}</span>
      </div>
    </div>
  )
}

export function WarmupConfigForm({
  cfg,
  onPatch,
}: {
  cfg: WarmupConfig
  onPatch: (p: Partial<WarmupConfig>) => void
}): JSX.Element {
  const pool = cfg.commentPool ?? []
  // Số hành động không được vượt quá số video xem — rút 3 cái tim từ 2 video là
  // vô nghĩa. Cảnh báo tại chỗ thay vì để script tự cắt bớt trong im lặng.
  const over = [
    cfg.likes.max > cfg.videos.max ? 'tim' : '',
    cfg.comments.max > cfg.videos.max ? 'bình luận' : '',
    cfg.follows.max > cfg.videos.max ? 'theo dõi' : '',
  ].filter(Boolean)

  return (
    <>
      <div className="text-[12px] uppercase tracking-wide text-muted font-bold mb-2.5">Mỗi lượt lướt</div>
      <div className="bg-card border border-borderSoft rounded-[12px] px-4 py-1 mb-4">
        <RangeRow
          label="Số video lướt qua"
          unit="video"
          value={cfg.videos}
          onChange={(videos) => onPatch({ videos })}
        />
        <RangeRow
          label="Xem mỗi video"
          unit="giây"
          value={cfg.watchSec}
          onChange={(watchSec) => onPatch({ watchSec })}
        />
      </div>

      <div className="text-[12px] uppercase tracking-wide text-muted font-bold mb-2.5">Tương tác</div>
      <div className="bg-card border border-borderSoft rounded-[12px] px-4 py-1 mb-4">
        <RangeRow label="Thả tim" unit="video" value={cfg.likes} onChange={(likes) => onPatch({ likes })} />
        <RangeRow label="Bình luận" unit="video" value={cfg.comments} onChange={(comments) => onPatch({ comments })} />
        <RangeRow
          label="Theo dõi tác giả"
          unit="video"
          value={cfg.follows}
          onChange={(follows) => onPatch({ follows })}
        />
      </div>
      {over.length > 0 && (
        <div className="mb-4 px-3.5 py-2.5 rounded-[9px] border border-[#5a4a1a] bg-[#231e0e] text-[12.5px] text-[#e8c96a]">
          Số {over.join(', ')} đang lớn hơn số video lướt — phần dư sẽ không dùng tới.
        </div>
      )}

      <div className="flex items-center mb-2.5">
        <div className="text-[12px] uppercase tracking-wide text-muted font-bold">Kho câu bình luận</div>
        <div className="ml-auto text-[12px] text-muted">{pool.length} câu</div>
      </div>
      <div className="bg-card border border-borderSoft rounded-[12px] p-4 mb-4">
        <textarea
          value={pool.join('\n')}
          onChange={(e) => onPatch({ commentPool: e.target.value.split('\n') })}
          onBlur={(e) =>
            onPatch({
              commentPool: e.target.value
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          rows={6}
          placeholder={'Mỗi dòng một câu'}
          spellCheck={false}
          className="w-full bg-[#101117] border border-border rounded-[9px] px-3 py-2.5 text-[13.5px] leading-relaxed outline-none focus:border-[#3a3d6b] resize-y hv-scroll"
        />
      </div>
    </>
  )
}
