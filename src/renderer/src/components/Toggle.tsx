/** Công tắc bật/tắt theo theme (KHÔNG dùng <input type="checkbox"> mặc định của
 *  browser). Dùng chung cho mọi tab để trông giống nhau — trước đây markup này nằm
 *  cục bộ trong TemplateTab, tab Schedule cần thì dễ copy ra rồi lệch dần. */
export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <button
      onClick={() => onChange(!on)}
      className={'w-[42px] h-[24px] rounded-full relative transition shrink-0 ' + (on ? 'accent-grad' : 'bg-border')}
    >
      <span
        className={'absolute top-[3px] w-[18px] h-[18px] rounded-full transition-all ' + (on ? 'right-[3px] bg-white' : 'left-[3px] bg-muted')}
      />
    </button>
  )
}
