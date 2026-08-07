import { useCallback, useEffect, useState } from 'react'
import { Sidebar, type TabKey } from './components/Sidebar'
import { ProfileTab } from './features/profile/ProfileTab'
import { ManagerTab } from './features/manager/ManagerTab'
import { TemplateTab } from './features/template/TemplateTab'
import { ScheduleTab } from './features/schedule/ScheduleTab'
import { GetVideoTab } from './features/getvideo/GetVideoTab'
import { SearchTab } from './features/search/SearchTab'
import { ProxyTab } from './features/proxy/ProxyTab'
import { AnalyticsTab } from './features/analytics/AnalyticsTab'
import { QueueTab } from './features/queue/QueueTab'
import { SettingTab } from './features/setting/SettingTab'
import { UiDialogsHost } from './components/uiDialogs'
import { Splash } from './components/Splash'
import type { Group, MachineIp, Profile } from '@shared/types'

export default function App(): JSX.Element {
  const [booting, setBooting] = useState(true)
  const [tab, setTab] = useState<TabKey>('profile')
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [machineIp, setMachineIp] = useState<MachineIp | null>(null)

  const reload = useCallback(async () => {
    const [p, g] = await Promise.all([window.hnv.profiles.list(), window.hnv.groups.list()])
    setProfiles(p)
    setGroups(g)
  }, [])

  const refreshMachineIp = useCallback(() => {
    window.hnv.system.machineIp().then(setMachineIp)
  }, [])

  useEffect(() => {
    reload()
    window.hnv.system.machineIp().then(setMachineIp)
    const off = window.hnv.onProfileStatus((id, status) => {
      setProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, status } : p)))
    })
    // Job phát hiện profile bị TikTok đăng xuất → main tắt cờ trong DB, tải lại
    // để tab Profile hiện đúng ngay, không phải đợi thao tác khác.
    const offChanged = window.hnv.onProfilesChanged(() => reload())
    return () => {
      off()
      offChanged()
    }
  }, [reload])

  const runningCount = profiles.filter((p) => p.status === 'running').length

  return (
    <div className="flex h-full">
      {/* Dải gradient dùng chung cho icon SVG. Icon không ăn được background-clip
          như chữ (.text-grad), phải trỏ fill vào một <linearGradient> có thật.
          Khai báo đúng một lần ở đây thay vì nhét defs vào từng icon: id trùng
          nhau thì chỉ cái đầu tiên có tác dụng, sửa màu về sau sẽ sót.
          Cùng hai chặng màu với .text-grad trong index.css. */}
      <svg width="0" height="0" aria-hidden className="absolute">
        <defs>
          <linearGradient id="hnv-icon-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#818cf8" />
            <stop offset="100%" stopColor="#22d3ee" />
          </linearGradient>
        </defs>
      </svg>
      {booting && <Splash onDone={() => setBooting(false)} />}
      <UiDialogsHost />
      <Sidebar active={tab} onChange={setTab} runningCount={runningCount} total={profiles.length} />
      {/* key={tab} → remount mỗi lần đổi tab để chạy lại animation vào tab */}
      <div key={tab} className="flex-1 flex min-w-0 hv-fade-up">
        {tab === 'profile' ? (
          <ProfileTab profiles={profiles} groups={groups} machineIp={machineIp} onReload={reload} onRefreshIp={refreshMachineIp} />
        ) : tab === 'manager' ? (
          <ManagerTab profiles={profiles} />
        ) : tab === 'template' ? (
          <TemplateTab />
        ) : tab === 'getvideo' ? (
          <GetVideoTab />
        ) : tab === 'search' ? (
          <SearchTab />
        ) : tab === 'schedule' ? (
          <ScheduleTab />
        ) : tab === 'queue' ? (
          <QueueTab />
        ) : tab === 'proxy' ? (
          <ProxyTab onProfilesChanged={reload} />
        ) : tab === 'analytics' ? (
          <AnalyticsTab />
        ) : (
          <SettingTab />
        )}
      </div>
    </div>
  )
}
