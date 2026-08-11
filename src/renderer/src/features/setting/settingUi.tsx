import { Icon, type IconName } from '../../components/Icon'

/**
 * Một nhóm cài đặt. Không bọc khung — chỉ tách nhau bằng tiêu đề và đường kẻ mảnh,
 * cho trang thoáng và mắt đi thẳng xuống nội dung.
 */
export function Section({
  icon,
  title,
  children,
  footer,
}: {
  icon: IconName
  title: string
  children: React.ReactNode
  footer?: React.ReactNode
}): JSX.Element {
  return (
    <section className="flex flex-col">
      <header className="flex items-center gap-3 pb-4 border-b border-borderSoft">
        <span className="w-9 h-9 shrink-0 rounded-[10px] grid place-items-center text-[17px] bg-[rgba(99,102,241,.14)]">
          <Icon name={icon} filled size={19} />
        </span>
        <h2 className="text-[15px] font-bold leading-tight min-w-0">{title}</h2>
      </header>
      <div className="py-6 flex flex-col gap-6">{children}</div>
      {footer && <footer className="flex items-center gap-3 pt-1">{footer}</footer>}
    </section>
  )
}

/** Một dòng cài đặt: nhãn bên trái, control bên phải, thẳng cột với nhau. */
export function Row({
  label,
  children,
  below,
}: {
  label: string
  children: React.ReactNode
  below?: React.ReactNode
}): JSX.Element {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-x-8 gap-y-2 items-center">
      <div className="min-w-0 text-[13.5px] text-text">{label}</div>
      <div className="min-w-0">{children}</div>
      {below && <div className="col-span-2">{below}</div>}
    </div>
  )
}

export function Warn({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="mt-1 px-3.5 py-2.5 rounded-[9px] border border-[#5a4a1a] bg-[#231e0e] text-[12.5px] text-[#e8c96a] leading-snug">
      {children}
    </div>
  )
}
