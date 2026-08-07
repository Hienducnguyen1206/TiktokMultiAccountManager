/** Công tắc bật/tắt theo theme (KHÔNG dùng <input type="checkbox"> mặc định của
 *  browser). Dùng chung cho mọi tab để trông giống nhau — trước đây markup này nằm
 *  cục bộ trong TemplateTab, tab Schedule cần thì dễ copy ra rồi lệch dần. */
export function Toggle({
  on,
  onChange,
  disabled
}: {
  on: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}): JSX.Element {
  return (
    <button
      onClick={() => onChange(!on)}
      disabled={disabled}
      role="switch"
      aria-checked={on}
      className={
        // active:scale: phản hồi ngay lúc ngón tay xuống, không đợi state đổi.
        'w-[42px] h-[24px] rounded-full relative shrink-0 transition-colors duration-200 ease-out ' +
        'active:scale-[.94] motion-reduce:transition-none motion-reduce:active:scale-100 ' +
        (on ? 'accent-grad' : 'bg-border') +
        (disabled ? ' opacity-40 cursor-not-allowed active:scale-100' : '')
      }
    >
      {/* Núm chạy bằng transform, KHÔNG bằng cặp left/right như trước: đổi từ
          left:3px sang right:3px là đổi thuộc tính, trình duyệt không nội suy
          được nên transition thành vô hiệu và núm nhảy thẳng sang bên kia.
          translateX nội suy được, lại chạy trên compositor nên không reflow.

          18px = 42 (track) − 3 (lề trái) − 18 (núm) − 3 (lề phải).

          Easing hơi vượt đích (1.12) cho cảm giác nảy nhẹ như công tắc thật.
          Vượt 12% của 18px ≈ 2.2px, vẫn nằm trong lề 3px nên núm không chạm mép. */}
      <span
        className={
          'absolute top-[3px] left-[3px] w-[18px] h-[18px] rounded-full ' +
          'transition-[transform,background-color] duration-[240ms] ease-[cubic-bezier(.22,.9,.3,1.12)] ' +
          'motion-reduce:transition-none ' +
          (on ? 'translate-x-[18px] bg-white' : 'translate-x-0 bg-muted')
        }
      />
    </button>
  )
}
