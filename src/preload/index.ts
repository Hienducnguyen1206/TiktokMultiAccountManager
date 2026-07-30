import { contextBridge, ipcRenderer } from 'electron'
import type {
  CreateProfileInput,
  CsCandidate,
  CsQuota,
  CsSearchParams,
  CsSearchResult,
  CsSettings,
  CsStatus,
  CsTiktokMatch,
  Group,
  GvSettings,
  HnvApi,
  ImportTxtResult,
  LoginResult,
  Profile,
  ProfileStatus,
  ProxyConfig,
  Schedule,
  Template
} from '../shared/types'

const api: HnvApi = {
  profiles: {
    list: () => ipcRenderer.invoke('profiles:list'),
    create: (input: CreateProfileInput) => ipcRenderer.invoke('profiles:create', input),
    update: (profile: Profile) => ipcRenderer.invoke('profiles:update', profile),
    remove: (id: string) => ipcRenderer.invoke('profiles:remove', id),
    removeAll: () => ipcRenderer.invoke('profiles:removeAll'),
    run: (id: string) => ipcRenderer.invoke('profiles:run', id),
    stop: (id: string) => ipcRenderer.invoke('profiles:stop', id),
    checkProxy: (proxy: ProxyConfig) => ipcRenderer.invoke('profiles:checkProxy', proxy),
    syncTiktok: (id: string) => ipcRenderer.invoke('profiles:syncTiktok', id),
    importTxt: (): Promise<ImportTxtResult | null> => ipcRenderer.invoke('profiles:importTxt'),
    setLoggedIn: (id: string, loggedIn: boolean): Promise<void> => ipcRenderer.invoke('profiles:setLoggedIn', id, loggedIn),
    login: (id: string): Promise<LoginResult> => ipcRenderer.invoke('profiles:login', id),
    uploadHistory: (id: string) => ipcRenderer.invoke('profiles:uploadHistory', id)
  },
  groups: {
    list: () => ipcRenderer.invoke('groups:list'),
    create: (name: string, color: string) => ipcRenderer.invoke('groups:create', name, color),
    update: (group: Group) => ipcRenderer.invoke('groups:update', group),
    remove: (id: string) => ipcRenderer.invoke('groups:remove', id)
  },
  analytics: {
    collect: () => ipcRenderer.invoke('analytics:collect'),
    data: () => ipcRenderer.invoke('analytics:data')
  },
  proxies: {
    list: () => ipcRenderer.invoke('proxies:list'),
    addMany: (text: string, type: ProxyConfig['type']) => ipcRenderer.invoke('proxies:addMany', text, type),
    remove: (id: string) => ipcRenderer.invoke('proxies:remove', id),
    check: (id: string) => ipcRenderer.invoke('proxies:check', id),
    assign: (proxyId: string, profileIds: string[]) => ipcRenderer.invoke('proxies:assign', proxyId, profileIds)
  },
  getvideo: {
    listChannels: () => ipcRenderer.invoke('getvideo:listChannels'),
    addChannel: (url: string) => ipcRenderer.invoke('getvideo:addChannel', url),
    removeChannel: (id: string) => ipcRenderer.invoke('getvideo:removeChannel', id),
    refreshMeta: () => ipcRenderer.invoke('getvideo:refreshMeta'),
    setFollowing: (id: string, following: boolean) => ipcRenderer.invoke('getvideo:setFollowing', id, following),
    update: (id: string) => ipcRenderer.invoke('getvideo:update', id),
    getSettings: () => ipcRenderer.invoke('getvideo:getSettings'),
    saveSettings: (s: GvSettings) => ipcRenderer.invoke('getvideo:saveSettings', s)
  },
  channelSearch: {
    search: (params: CsSearchParams) => ipcRenderer.invoke('channelSearch:search', params),
    listCandidates: () => ipcRenderer.invoke('channelSearch:listCandidates'),
    addCandidate: (r: CsSearchResult) => ipcRenderer.invoke('channelSearch:addCandidate', r),
    removeCandidate: (id: string) => ipcRenderer.invoke('channelSearch:removeCandidate', id),
    setStatus: (id: string, status: CsStatus) => ipcRenderer.invoke('channelSearch:setStatus', id, status),
    checkTiktok: (id: string) => ipcRenderer.invoke('channelSearch:checkTiktok', id),
    getSettings: () => ipcRenderer.invoke('channelSearch:getSettings'),
    saveSettings: (s: CsSettings) => ipcRenderer.invoke('channelSearch:saveSettings', s),
    getQuota: () => ipcRenderer.invoke('channelSearch:getQuota')
  },
  templates: {
    list: () => ipcRenderer.invoke('templates:list'),
    create: (type: Template['type']) => ipcRenderer.invoke('templates:create', type),
    save: (template: Template) => ipcRenderer.invoke('templates:save', template),
    remove: (id: string) => ipcRenderer.invoke('templates:remove', id),
    defaultScript: (type: Template['type']) => ipcRenderer.invoke('templates:defaultScript', type)
  },
  schedules: {
    list: () => ipcRenderer.invoke('schedules:list'),
    create: () => ipcRenderer.invoke('schedules:create'),
    save: (schedule: Schedule) => ipcRenderer.invoke('schedules:save', schedule),
    remove: (id: string) => ipcRenderer.invoke('schedules:remove', id)
  },
  queue: {
    list: () => ipcRenderer.invoke('queue:list'),
    state: () => ipcRenderer.invoke('queue:state'),
    enqueue: (templateId: string, profileIds: string[]) => ipcRenderer.invoke('queue:enqueue', templateId, profileIds),
    jobLog: (jobId: string) => ipcRenderer.invoke('queue:jobLog', jobId),
    cancel: (jobId: string) => ipcRenderer.invoke('queue:cancel', jobId),
    retry: (jobId: string) => ipcRenderer.invoke('queue:retry', jobId),
    clearDone: () => ipcRenderer.invoke('queue:clearDone'),
    setPaused: (paused: boolean) => ipcRenderer.invoke('queue:setPaused', paused)
  },
  system: {
    machineIp: () => ipcRenderer.invoke('system:machineIp'),
    pickFolder: () => ipcRenderer.invoke('system:pickFolder'),
    openFolder: (dir: string) => ipcRenderer.invoke('system:openFolder', dir),
    countVideos: (dir: string) => ipcRenderer.invoke('system:countVideos', dir),
    clearVideos: (dir: string) => ipcRenderer.invoke('system:clearVideos', dir),
    cleanData: (drafts: boolean) => ipcRenderer.invoke('system:cleanData', drafts)
  },
  onProfileStatus: (cb: (id: string, status: ProfileStatus) => void) => {
    const handler = (_e: unknown, id: string, status: ProfileStatus): void => cb(id, status)
    ipcRenderer.on('profile:status', handler)
    return () => ipcRenderer.removeListener('profile:status', handler)
  },
  onProfilesChanged: (cb: () => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('profiles:changed', handler)
    return () => ipcRenderer.removeListener('profiles:changed', handler)
  },
  onLoginProgress: (cb: (id: string, msg: string) => void) => {
    const handler = (_e: unknown, id: string, msg: string): void => cb(id, msg)
    ipcRenderer.on('profile:login-progress', handler)
    return () => ipcRenderer.removeListener('profile:login-progress', handler)
  },
  onGetVideoUpdate: (cb: () => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('getvideo:update', handler)
    return () => ipcRenderer.removeListener('getvideo:update', handler)
  },
  onGetVideoLog: (cb: (line: string) => void) => {
    const handler = (_e: unknown, line: string): void => cb(line)
    ipcRenderer.on('getvideo:log', handler)
    return () => ipcRenderer.removeListener('getvideo:log', handler)
  },
  onChannelSearchLog: (cb: (line: string) => void) => {
    const handler = (_e: unknown, line: string): void => cb(line)
    ipcRenderer.on('channelsearch:log', handler)
    return () => ipcRenderer.removeListener('channelsearch:log', handler)
  },
  onChannelSearchQuota: (cb: (q: CsQuota) => void) => {
    const handler = (_e: unknown, q: CsQuota): void => cb(q)
    ipcRenderer.on('channelsearch:quota', handler)
    return () => ipcRenderer.removeListener('channelsearch:quota', handler)
  },
  onAnalyticsProgress: (cb: (msg: string) => void) => {
    const handler = (_e: unknown, msg: string): void => cb(msg)
    ipcRenderer.on('analytics:progress', handler)
    return () => ipcRenderer.removeListener('analytics:progress', handler)
  },
  onScheduleFired: (cb: (scheduleId: string, name: string) => void) => {
    const handler = (_e: unknown, id: string, name: string): void => cb(id, name)
    ipcRenderer.on('schedule:fired', handler)
    return () => ipcRenderer.removeListener('schedule:fired', handler)
  },
  onQueueUpdate: (cb: () => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('queue:update', handler)
    return () => ipcRenderer.removeListener('queue:update', handler)
  },
  onJobLog: (cb: (jobId: string, line: string) => void) => {
    const handler = (_e: unknown, jobId: string, line: string): void => cb(jobId, line)
    ipcRenderer.on('job:log', handler)
    return () => ipcRenderer.removeListener('job:log', handler)
  }
}

contextBridge.exposeInMainWorld('hnv', api)
