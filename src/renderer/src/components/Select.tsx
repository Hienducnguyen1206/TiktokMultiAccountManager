import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface SelectOption {
  value: string
  label: string
  /** Dòng phụ mờ bên dưới nhãn (tuỳ chọn). */
  hint?: string
  disabled?: boolean
}

/**
 * Dropdown theo theme của app, thay cho <select> mặc định.
 *
 * Lý do phải tự dựng: danh sách option của <select> do Windows vẽ, CSS không với tới
 * được — nó luôn bung ra nền trắng giữa giao diện tối.
 *
 * Danh sách render bằng position:fixed theo toạ độ nút nên không bị cắt bởi ô cha có
 * overflow:hidden/auto, và tự lật lên trên khi gần đáy màn hình.
 *
 * Và nó phải đi qua PORTAL ra thẳng <body>. `position: fixed` chỉ neo theo
 * viewport khi KHÔNG có tổ tiên nào tạo containing block. Thẻ bọc tab của App
 * (`.hv-fade-up`) chạy animation với `fill-mode: both`, mà một animation đang
 * fill trên `transform` là đủ để tạo containing block — dù giá trị tính ra là
 * `none`. Đo thật: danh sách bị đẩy sang phải đúng 216px, bằng bề rộng sidebar,
 * ở MỌI tab. Portal đưa danh sách ra ngoài thẻ đó nên toạ độ lại đúng viewport.
 */
export function Select({
  value,
  options,
  onChange,
  placeholder = '— Chưa chọn —',
  disabled,
  className = '',
  title,
  center
}: {
  value: string
  options: SelectOption[]
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  title?: string
  /** Căn giữa nhãn trên nút và các dòng trong danh sách. */
  center?: boolean
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number; width: number; drop: 'down' | 'up' } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const current = options.find((o) => o.value === value)

  // Đo vị trí nút ngay trước khi vẽ danh sách để không thấy nó nhảy 1 frame.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const need = Math.min(options.length * 38 + 10, 288)
    const below = window.innerHeight - r.bottom - 10
    const drop = below < need && r.top > below ? 'up' : 'down'
    setPos({
      left: r.left,
      top: drop === 'down' ? r.bottom + 6 : r.top - 6,
      width: r.width,
      drop
    })
  }, [open, options.length])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (!btnRef.current?.contains(t) && !listRef.current?.contains(t)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    // Cuộn/resize thì đóng lại — rẻ hơn và đỡ giật hơn là bám theo liên tục.
    const onScroll = (): void => setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        title={title}
        onClick={() => setOpen(!open)}
        className={`hv-select ${center ? 'center' : ''} ${open ? 'open' : ''} ${className}`}
      >
        <span className={current ? '' : 'hv-select-ph'}>{current ? current.label : placeholder}</span>
        <svg className="hv-select-caret" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={listRef}
            className="hv-select-list hv-scroll"
            style={{
              left: pos.left,
              width: pos.width,
              ...(pos.drop === 'down' ? { top: pos.top } : { bottom: window.innerHeight - pos.top })
            }}
          >
            {options.length === 0 && <div className="hv-select-empty">Không có lựa chọn</div>}
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                disabled={o.disabled}
                className={`hv-select-opt${center ? ' center' : ''}${o.value === value ? ' on' : ''}`}
                onClick={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
              >
                <span className="hv-select-opt-txt">
                  {o.label}
                  {o.hint && <span className="hv-select-opt-hint">{o.hint}</span>}
                </span>
                {o.value === value && (
                  <svg className="hv-select-tick" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m5 12 5 5L20 7" />
                  </svg>
                )}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  )
}
