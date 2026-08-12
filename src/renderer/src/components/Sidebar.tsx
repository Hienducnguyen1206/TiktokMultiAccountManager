import logo from '../assets/logo.png'
import { Icon, type IconName } from './Icon'

export type TabKey =
  'profile' | 'manager' | 'template' | 'getvideo' | 'queue' | 'schedule' | 'analytics' | 'proxy' | 'setting'

const TABS: { key: TabKey; icon: IconName; label: string }[] = [
  { key: 'profile', icon: 'profile', label: 'Hồ sơ' },
  { key: 'manager', icon: 'manager', label: 'Quản lý hồ sơ' },
  { key: 'template', icon: 'template', label: 'Kịch bản' },
  { key: 'getvideo', icon: 'getvideo', label: 'Tải video' },
  { key: 'queue', icon: 'queue', label: 'Hàng đợi' },
  { key: 'schedule', icon: 'schedule', label: 'Lịch chạy' },
  { key: 'analytics', icon: 'analytics', label: 'Thống kê' },
  { key: 'proxy', icon: 'proxy', label: 'Proxy' },
  { key: 'setting', icon: 'setting', label: 'Cài đặt' },
]

export function Sidebar({
  active,
  onChange,
  runningCount,
  total,
}: {
  active: TabKey
  onChange: (t: TabKey) => void
  runningCount: number
  total: number
}): JSX.Element {
  return (
    <div className="w-[216px] shrink-0 flex flex-col bg-[#0c0d13] border-r border-borderSoft">
      <div className="px-4 pt-6 pb-5 flex items-center gap-2.5">
        <img src={logo} alt="" className="w-[38px] h-[38px] shrink-0 drop-shadow-[0_0_10px_rgba(34,211,238,.35)]" />
        <div className="text-[19px] font-extrabold tracking-tight text-grad whitespace-nowrap">HienNVAuto</div>
      </div>
      <div className="flex-1 px-3 py-1">
        {TABS.map((t) => {
          const on = t.key === active
          return (
            <button
              key={t.key}
              onClick={() => onChange(t.key)}
              className={
                'w-full text-left my-1 px-3.5 py-2.5 rounded-[10px] text-[15px] flex items-center transition ' +
                (on
                  ? 'font-semibold border border-[rgba(129,140,248,.35)] bg-[linear-gradient(100deg,rgba(129,140,248,.18),rgba(34,211,238,.10))] shadow-[0_0_16px_rgba(129,140,248,.15)]'
                  : 'text-[#b3b4c2] hover:bg-surface border border-transparent')
              }
            >
              {/* Gradient CHỈ cho tab đang mở. Tô hết mọi tab thì mất thứ duy nhất
                  phân biệt tab nào đang xem — nền và viền mờ quá, không đủ. */}
              <Icon name={t.icon} filled={on} size={19} className={'mr-2.5 shrink-0 ' + (on ? 'icon-grad' : '')} />
              <span className={on ? 'text-grad' : ''}>{t.label}</span>
            </button>
          )
        })}
      </div>
      <div className="px-5 py-3.5 border-t border-borderSoft text-[12px] text-muted">
        <span className="text-ok">●</span> {runningCount} đang chạy · {total} hồ sơ
      </div>
    </div>
  )
}
