export interface SegmentedOption {
  value: string
  label: string
}

/**
 * Short multiple-choice control drawn in-app — the project never renders a
 * native <select> or radio, so the popup/knob always matches the theme.
 * `tone='accent'` fills the active pill with the brand gradient (primary
 * choices); `tone='soft'` uses a flat panel so a row of several controls does
 * not turn into a wall of gradient.
 */
export function Segmented({
  value,
  options,
  onChange,
  tone = 'accent',
  size = 'md'
}: {
  value: string
  options: SegmentedOption[]
  onChange: (v: string) => void
  tone?: 'accent' | 'soft'
  size?: 'sm' | 'md'
}): JSX.Element {
  return (
    <div className="flex bg-[#101117] border border-border rounded-[9px] p-[3px] gap-[3px]">
      {options.map((o) => {
        const on = o.value === value
        const base =
          size === 'sm'
            ? 'flex-1 text-center rounded-[7px] px-1 py-[5px] text-[12px] cursor-pointer whitespace-nowrap'
            : 'flex-1 text-center rounded-[7px] px-1 py-1.5 text-[13px] cursor-pointer whitespace-nowrap'
        const state = !on
          ? 'text-subtle'
          : tone === 'accent'
            ? 'accent-grad text-[#0a0b10] font-bold'
            : 'bg-[#1e2030] text-white border border-[#3a3d6b] font-bold'
        return (
          <div key={o.value} className={`${base} ${state}`} onClick={() => onChange(o.value)}>
            {o.label}
          </div>
        )
      })}
    </div>
  )
}
