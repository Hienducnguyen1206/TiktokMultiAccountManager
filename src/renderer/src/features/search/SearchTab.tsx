import { useEffect, useState } from 'react'
import { showToast } from '../../components/uiDialogs'
import type { CsSettings, Profile } from '@shared/types'

export function CsSettingsDialog({
  settings,
  profiles,
  onClose,
  onSaved
}: {
  settings: CsSettings
  profiles: Profile[]
  onClose: () => void
  onSaved: (s: CsSettings) => void
}): JSX.Element {
  const [s, setS] = useState<CsSettings>(settings)
  const loggedIn = profiles.filter((p) => p.loggedIn)

  const save = async (): Promise<void> => {
    const saved = await window.hnv.channelSearch.saveSettings(s)
    onSaved(saved)
    showToast('Đã lưu cài đặt')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-[520px] bg-[#0d0e14] border border-border rounded-[14px] shadow-2xl overflow-hidden">
        <div className="px-[22px] py-[16px] border-b border-borderSoft flex items-center">
          <div className="text-[17px] font-bold">⚙️ Cài đặt Search Kênh</div>
          <button onClick={onClose} className="ml-auto text-muted text-lg">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <div className="text-[13px] text-subtle mb-1.5">YouTube Data API v3 key (bỏ trống = dùng yt-dlp, lọc rút gọn)</div>
            <input className="inp" value={s.apiKey} onChange={(e) => setS({ ...s, apiKey: e.target.value })} placeholder="AIza…" />
          </div>
          <div>
            <div className="text-[13px] text-subtle mb-1.5">Profile check TikTok (phải đã đăng nhập)</div>
            <select className="inp" value={s.checkProfileId} onChange={(e) => setS({ ...s, checkProfileId: e.target.value })}>
              <option value="">— Chưa chọn —</option>
              {loggedIn.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {loggedIn.length === 0 && (
              <div className="text-[12px] text-warn mt-1">Chưa có profile nào đăng nhập TikTok — vào tab Profile đăng nhập trước.</div>
            )}
          </div>
          <div>
            <div className="text-[13px] text-subtle mb-1.5">Số account TikTok lưu mỗi lần check (top N)</div>
            <input className="inp w-[120px]" type="number" min={1} max={20} value={s.topN} onChange={(e) => setS({ ...s, topN: parseInt(e.target.value) || 5 })} />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-borderSoft flex justify-end gap-2">
          <button onClick={onClose} className="bg-surface text-[#c7c8d4] border border-border rounded-[9px] px-4 py-2 text-[14px]">Hủy</button>
          <button onClick={save} className="accent-grad text-white font-semibold rounded-[9px] px-4 py-2 text-[14px]">Lưu</button>
        </div>
      </div>
    </div>
  )
}

type View = 'find' | 'candidates'

export function SearchTab(): JSX.Element {
  const [view, setView] = useState<View>('find')
  const [settings, setSettings] = useState<CsSettings | null>(null)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    window.hnv.channelSearch.getSettings().then(setSettings)
    window.hnv.profiles.list().then(setProfiles)
  }, [])

  return (
    <div className="flex-1 flex flex-col min-w-0 p-5">
      <div className="flex items-center mb-4">
        <div className="text-[20px] font-bold">🔍 Search Kênh</div>
        <div className="ml-5 flex gap-1 bg-[#101117] border border-border rounded-[10px] p-1">
          {(['find', 'candidates'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={
                'px-3.5 py-1.5 rounded-[8px] text-[13px] transition ' +
                (view === v ? 'text-white font-semibold bg-[linear-gradient(100deg,rgba(129,140,248,.25),rgba(34,211,238,.12))]' : 'text-subtle')
              }
            >
              {v === 'find' ? 'Tìm kiếm' : 'Ứng viên'}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowSettings(true)}
          className="ml-auto bg-surface text-[#c7c8d4] border border-border rounded-[9px] px-4 py-2 text-[14px]"
        >
          ⚙️ Cài đặt
        </button>
      </div>

      {/* Task 9 thay bằng <SearchPanel …/>, Task 10 thay bằng <CandidatesPanel …/> */}
      {view === 'find' ? (
        <div className="flex-1 flex items-center justify-center text-muted">Khu Tìm kiếm (Task 9)</div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted">Khu Ứng viên (Task 10)</div>
      )}

      {showSettings && settings && (
        <CsSettingsDialog
          settings={settings}
          profiles={profiles}
          onClose={() => setShowSettings(false)}
          onSaved={setSettings}
        />
      )}
    </div>
  )
}
