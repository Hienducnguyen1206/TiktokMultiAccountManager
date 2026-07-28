import { useCallback, useEffect, useState } from 'react'
import { Sidebar, type TabKey } from './components/Sidebar'
import { ProfileTab } from './features/profile/ProfileTab'
import { TemplateTab } from './features/template/TemplateTab'
import { ScheduleTab } from './features/schedule/ScheduleTab'
import { GetVideoTab } from './features/getvideo/GetVideoTab'
import { SearchTab } from './features/search/SearchTab'
import { ProxyTab } from './features/proxy/ProxyTab'
import { AnalyticsTab } from './features/analytics/AnalyticsTab'
import { QueueTab } from './features/queue/QueueTab'
import { UiDialogsHost } from './components/uiDialogs'
import type { Group, MachineIp, Profile } from '@shared/types'

function Placeholder({ title }: { title: string }): JSX.Element {
  return (
    <div className="flex-1 flex items-center justify-center text-muted">
      <div className="text-center">
        <div className="text-2xl font-bold mb-2">{title}</div>
        <div>Tính năng đang được phát triển…</div>
      </div>
    </div>
  )
}

export default function App(): JSX.Element {
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
    return off
  }, [reload])

  const runningCount = profiles.filter((p) => p.status === 'running').length

  return (
    <div className="flex h-full">
      <UiDialogsHost />
      <Sidebar active={tab} onChange={setTab} runningCount={runningCount} total={profiles.length} />
      {/* key={tab} → remount mỗi lần đổi tab để chạy lại animation vào tab */}
      <div key={tab} className="flex-1 flex min-w-0 hv-fade-up">
        {tab === 'profile' ? (
          <ProfileTab profiles={profiles} groups={groups} machineIp={machineIp} onReload={reload} onRefreshIp={refreshMachineIp} />
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
          <Placeholder title={tab[0].toUpperCase() + tab.slice(1)} />
        )}
      </div>
    </div>
  )
}
