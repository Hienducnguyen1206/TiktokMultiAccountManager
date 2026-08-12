import { useEffect, useRef, useState } from 'react'

/**
 * Ô nhập số kèm nút tăng/giảm TỰ VẼ.
 *
 * `<input type="number">` trơn thì Chromium vẽ hai nút mũi tên theo kiểu hệ điều
 * hành — nền sáng, bo góc vuông, lạc hẳn khỏi theme tối của app, và chỉ hiện
 * lúc rê chuột nên nhìn còn nhấp nháy. index.css đã bỏ nút mặc định cho MỌI ô
 * số; nút thật nằm ở đây.
 *
 * Nhận và trả số nguyên. Kẹp trong [min, max] ngay lúc gõ chứ không đợi lưu:
 * người dùng gõ 999 vào ô trần 20 mà mãi sau mới biết là hỏng trải nghiệm.
 */
export function NumInput({
  value,
  onChange,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  step = 1,
  width = 'w-[68px]',
  className = ''
}: {
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
  step?: number
  /** Lớp chiều rộng của cả khối. Mặc định vừa số có 3 chữ số. */
  width?: string
  className?: string
}): JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  const clamp = (n: number): number => Math.min(max, Math.max(min, Math.floor(n)))

  /**
   * Chữ đang hiện trong ô, tách khỏi giá trị đã nắn.
   *
   * Nắn ngay lúc gõ thì ô có min ≥ 1 không sửa được: xoá trắng để gõ số khác là
   * nó bật ngay về min, thành ra phải gõ chen vào giữa. Nên trong lúc gõ cứ để
   * nguyên, rời ô mới nắn.
   */
  const [draft, setDraft] = useState(String(value))
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!editing) setDraft(String(value))
  }, [value, editing])

  const bump = (d: number): void => {
    const next = clamp((Number(value) || 0) + d * step)
    setDraft(String(next))
    onChange(next)
    // Giữ tiêu điểm ở ô số: bấm nút xong mà tiêu điểm nhảy đi thì không gõ tiếp
    // được, cũng không dùng được mũi tên bàn phím.
    ref.current?.focus()
  }

  return (
    <div
      className={
        `${width} h-9 flex items-stretch bg-[#101117] border border-border rounded-[9px] ` +
        `overflow-hidden focus-within:border-[#3a3d6b] ${className}`
      }
    >
      <input
        ref={ref}
        type="number"
        value={draft}
        min={min}
        max={max}
        onFocus={() => setEditing(true)}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d]/g, '')
          setDraft(raw)
          // Vẫn báo ra ngoài ngay để chỗ khác thấy thay đổi, nhưng chỉ chặn trần
          // — chặn sàn để lúc rời ô mới làm.
          onChange(Math.min(max, Number(raw) || 0))
        }}
        onBlur={() => {
          setEditing(false)
          const n = clamp(Number(draft) || 0)
          setDraft(String(n))
          if (n !== value) onChange(n)
        }}
        className="min-w-0 flex-1 bg-transparent px-2 text-[14px] text-center outline-none"
      />
      {/* Hai nút xếp dọc, mỗi nút nửa chiều cao — đúng chỗ Chromium vẫn đặt nút
          mặc định, nên thói quen bấm của người dùng không đổi. */}
      <div className="flex flex-col border-l border-borderSoft shrink-0">
        <Step dir="up" disabled={value >= max} onClick={() => bump(1)} />
        <Step dir="down" disabled={value <= min} onClick={() => bump(-1)} />
      </div>
    </div>
  )
}

/** Một nút mũi tên. Tam giác vẽ tay: bộ icon của app không có mũi tên cỡ này. */
function Step({
  dir,
  disabled,
  onClick
}: {
  dir: 'up' | 'down'
  disabled: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      tabIndex={-1}
      disabled={disabled}
      onClick={onClick}
      className={
        'flex-1 w-[18px] grid place-items-center text-muted ' +
        (disabled ? 'opacity-25' : 'hover:bg-[#1b1c25] hover:text-text') +
        (dir === 'up' ? ' border-b border-borderSoft' : '')
      }
    >
      <svg width="7" height="4" viewBox="0 0 7 4" fill="currentColor" aria-hidden="true">
        {dir === 'up' ? <path d="M3.5 0 7 4H0z" /> : <path d="M3.5 4 0 0h7z" />}
      </svg>
    </button>
  )
}
