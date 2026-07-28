export type TabKey = 'profile' | 'template' | 'getvideo' | 'queue' | 'schedule' | 'analytics' | 'proxy' | 'setting'

const TABS: { key: TabKey; icon: string; label: string }[] = [
  { key: 'profile', icon: '👤', label: 'Profile' },
  { key: 'template', icon: '📄', label: 'Template' },
  { key: 'getvideo', icon: '🎬', label: 'Get Video' },
  { key: 'queue', icon: '📊', label: 'Queue' },
  { key: 'schedule', icon: '🗓️', label: 'Schedule' },
  { key: 'analytics', icon: '📈', label: 'Analytics' },
  { key: 'proxy', icon: '🌐', label: 'Proxy' },
  { key: 'setting', icon: '⚙️', label: 'Setting' }
]

export function Sidebar({
  active,
  onChange,
  runningCount,
  total
}: {
  active: TabKey
  onChange: (t: TabKey) => void
  runningCount: number
  total: number
}): JSX.Element {
  return (
    <div className="w-[216px] shrink-0 flex flex-col bg-[#0c0d13] border-r border-borderSoft">
      <div className="px-5 pt-6 pb-4">
        <div className="text-[23px] font-extrabold tracking-tight text-grad">HienNVAuto</div>
        <div className="text-[11px] text-muted mt-1">Antidetect Browser Manager</div>
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
                  ? 'text-white font-semibold border border-[rgba(129,140,248,.35)] bg-[linear-gradient(100deg,rgba(129,140,248,.18),rgba(34,211,238,.10))] shadow-[0_0_16px_rgba(129,140,248,.15)]'
                  : 'text-[#b3b4c2] hover:bg-surface border border-transparent')
              }
            >
              <span className="mr-2">{t.icon}</span>
              {t.label}
            </button>
          )
        })}
      </div>
      <div className="px-5 py-3.5 border-t border-borderSoft text-[12px] text-muted">
        <span className="text-ok">●</span> {runningCount} đang chạy · {total} profile
      </div>
    </div>
  )
}
