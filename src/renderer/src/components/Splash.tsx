import { useEffect, useState } from 'react'
import logo from '../assets/logo.png'

/** Tổng thời gian thanh chạy từ 0 → 100%, rồi mờ dần trong FADE_MS. */
const RUN_MS = 1800
const FADE_MS = 320

/**
 * Màn chờ lúc mở app: logo + thanh tiến trình.
 *
 * Tiến trình là GIẢ — renderer không có bước khởi tạo nào đáng kể để mà đo. Đây
 * thuần là màn thương hiệu cho cửa sổ khỏi bật ra trống trơn. Cửa sổ chỉ show ở
 * 'ready-to-show' (main/index.ts) nên đây là thứ đầu tiên người dùng thấy.
 */
export function Splash({ onDone }: { onDone: () => void }): JSX.Element {
  const [pct, setPct] = useState(0)
  const [fading, setFading] = useState(false)

  useEffect(() => {
    const t0 = Date.now()
    // Bám đồng hồ thật thay vì cộng dồn mỗi tick: máy chậm/tab bị throttle thì
    // cộng dồn sẽ kéo dài lê thê, còn mốc thời gian thì luôn xong đúng RUN_MS.
    const id = setInterval(() => {
      const p = Math.min(100, ((Date.now() - t0) / RUN_MS) * 100)
      setPct(p)
      if (p < 100) return
      clearInterval(id)
      setFading(true)
      setTimeout(onDone, FADE_MS)
    }, 30)
    return () => clearInterval(id)
  }, [onDone])

  return (
    <div
      className={
        'fixed inset-0 z-[100] flex flex-col items-center justify-center bg-bg transition-opacity ' +
        (fading ? 'opacity-0 pointer-events-none' : 'opacity-100')
      }
      style={{ transitionDuration: `${FADE_MS}ms` }}
    >
      <img
        src={logo}
        alt=""
        className="w-[104px] h-[104px] drop-shadow-[0_0_28px_rgba(34,211,238,.30)]"
      />

      <div className="mt-5 text-[22px] font-bold tracking-tight">HienNVAuto</div>
      <div className="mt-1 text-[12.5px] text-muted">YouTube Shorts → TikTok</div>

      <div className="mt-8 w-[268px] h-1.5 rounded-full bg-borderSoft border border-border overflow-hidden">
        <div className="h-full rounded-full accent-grad" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2.5 text-[11.5px] text-muted tabular-nums">{Math.round(pct)}%</div>
    </div>
  )
}
