import { ipcMain, dialog, shell, type BrowserWindow } from 'electron'
import { existsSync, readdirSync, readFileSync, rmSync } from 'fs'
import { extname, join } from 'path'
import { VIDEO_EXT } from './services/AutomationRunner'
import { ProfileStore, profileEvents } from './services/ProfileStore'
import { sweepAllProfilesCache } from './services/cacheCleaner'
import { GroupStore } from './services/GroupStore'
import { TemplateStore } from './services/TemplateStore'
import { DEFAULT_TIKTOK_SCRIPT } from './services/templates/uploadVideo'
import { ScheduleStore } from './services/ScheduleStore'
import { startScheduler, schedulerEvents } from './services/Scheduler'
import { QueueManager, queueEvents } from './services/QueueManager'
import { runProfile, stopProfile, launcherEvents } from './services/BrowserLauncher'
import { listDevices, changeDevice, assignDevices, engineEvents } from './services/ShardEngine'
import { syncTiktokName } from './services/TikTokSync'
import {
  getAccount,
  loadAccount,
  applyAll
} from './services/ProfileManagerService'
import { checkTiktok } from './services/TikTokSearch'
import { loginProfile, loginEvents, type LoginResult } from './services/TikTokLogin'
import { GetVideoStore } from './services/GetVideoStore'
import { updateYtDlp } from './services/YtDlpManager'
import { denoInfo, installDeno } from './services/DenoManager'
import { crawlChannel, getVideoEvents, refreshChannelMeta, refreshMissingMeta } from './services/GetVideoService'
import { ProxyStore } from './services/ProxyStore'
import { AnalyticsStore } from './services/AnalyticsStore'
import { collectAll, analyticsEvents } from './services/AnalyticsService'
import { getMachineIp, checkProxy } from './services/Network'
import { ChannelSearchStore } from './services/ChannelSearchStore'
import { searchChannels, channelSearchEvents } from './services/ChannelSearchService'
import {
  checkForUpdate,
  currentInfo,
  downloadUpdate,
  installNow,
  updateEvents
} from './services/UpdateService'
import type { AccountPrivacyPatch, VideoPrivacy, CreateProfileInput, Group, GvSettings, Profile, ProxyConfig, Schedule, Template, CsSearchResult, CsSettings, CsStatus, CsSearchParams, CsQuota, UpdateState } from '@shared/types'

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  // profiles
  ipcMain.handle('profiles:list', () => ProfileStore.list())
  ipcMain.handle('profiles:create', async (_e, input: CreateProfileInput) => {
    const created = ProfileStore.create(input)
    // Give them their ShardX device now rather than at first launch, so the
    // settings panel shows a real user-agent / GPU / screen straight away.
    // Best-effort: assignDevices() swallows its own failures.
    await assignDevices(created)
    return created.map((p) => ProfileStore.get(p.id) ?? p)
  })
  ipcMain.handle('profiles:update', (_e, profile: Profile) => ProfileStore.update(profile))
  ipcMain.handle('profiles:remove', (_e, id: string) => ProfileStore.remove(id))
  ipcMain.handle('profiles:removeAll', () => ProfileStore.removeAll())
  ipcMain.handle('profiles:run', (_e, id: string) => runProfile(id))
  ipcMain.handle('profiles:stop', (_e, id: string) => stopProfile(id))
  ipcMain.handle('profiles:checkProxy', (_e, proxy: ProxyConfig) => checkProxy(proxy))
  ipcMain.handle('profiles:syncTiktok', (_e, id: string) => syncTiktokName(id))
  ipcMain.handle('profiles:setLoggedIn', (_e, id: string, loggedIn: boolean) => ProfileStore.setLoggedIn(id, loggedIn))
  ipcMain.handle('profiles:login', (_e, id: string): Promise<LoginResult> => loginProfile(id))
  ipcMain.handle('profiles:uploadHistory', (_e, id: string) => ProfileStore.uploadHistory(id))
  ipcMain.handle('profiles:devices', (_e, platform: string) => listDevices(platform))
  ipcMain.handle('profiles:changeDevice', (_e, id: string, deviceId: string) => {
    const profile = ProfileStore.get(id)
    if (!profile) throw new Error('Không tìm thấy profile')
    return changeDevice(profile, deviceId)
  })
  ipcMain.handle('profiles:importTxt', async () => {
    const win = getWindow()
    const res = await dialog.showOpenDialog(win ?? undefined!, {
      properties: ['openFile'],
      filters: [{ name: 'Text files', extensions: ['txt'] }]
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const lines = readFileSync(res.filePaths[0], 'utf8').split('\n')
    const accounts: { username: string; password: string; twofa: string }[] = []
    let failed = 0
    const seen = new Set<string>()
    for (const raw of lines) {
      const line = raw.trim()
      if (!line) continue
      const parts = line.split('|')
      if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) { failed++; continue }
      const username = parts[0].trim().toLowerCase()
      if (seen.has(username)) { failed++; continue }
      seen.add(username)
      accounts.push({ username: parts[0].trim(), password: parts[1].trim(), twofa: parts[2].trim() })
    }
    const created = ProfileStore.createFromAccounts(accounts)
    // Same reason as profiles:create — importing 50 accounts used to leave all
    // 50 without a device until each was opened by hand.
    await assignDevices(created)
    const skippedDuplicate = accounts.length - created.length
    return { created: created.length, failed: failed + skippedDuplicate }
  })

  // groups
  ipcMain.handle('groups:list', () => GroupStore.list())
  ipcMain.handle('groups:create', (_e, name: string, color: string, icon: string) =>
    GroupStore.create(name, color, icon)
  )
  ipcMain.handle('groups:update', (_e, group: Group) => GroupStore.update(group))
  ipcMain.handle('groups:remove', (_e, id: string, deleteProfiles: boolean) =>
    GroupStore.remove(id, deleteProfiles)
  )
  ipcMain.handle('groups:setMembers', (_e, groupId: string, profileIds: string[]) =>
    GroupStore.setMembers(groupId, profileIds)
  )
  ipcMain.handle('groups:assign', (_e, profileIds: string[], groupId: string | null) =>
    GroupStore.assign(profileIds, groupId)
  )

  // profile manager — dữ liệu chỉ sống trong bộ nhớ tiến trình này, không xuống DB
  ipcMain.handle('manager:get', (_e, profileId: string) => getAccount(profileId))
  ipcMain.handle('manager:load', (_e, profileId: string) =>
    loadAccount(profileId, (msg) => sendToRenderer('manager:progress', profileId, msg))
  )
  // Một cửa duy nhất cho mọi thay đổi: giao diện chỉ đánh dấu, bấm Lưu mới chạy.
  ipcMain.handle(
    'manager:applyAll',
    (
      _e,
      profileId: string,
      payload: {
        displayName?: string
        username?: string
        avatarPath?: string
        privacy?: AccountPrivacyPatch
        videos?: { privacy: Record<string, VideoPrivacy>; remove: string[] }
      }
    ) => applyAll(profileId, payload, (msg) => sendToRenderer('manager:progress', profileId, msg))
  )
  // Chọn ảnh phải qua hộp thoại của hệ điều hành: engine cần ĐƯỜNG DẪN file để
  // đưa vào trang, mà <input type="file"> ở renderer chỉ cho đối tượng File.
  ipcMain.handle('manager:pickAvatar', async () => {
    const win = getWindow()
    const r = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Chọn ảnh đại diện',
      properties: ['openFile'],
      filters: [{ name: 'Ảnh', extensions: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'tiff'] }]
    })
    const file = r.canceled ? null : r.filePaths[0]
    if (!file) return null
    // Trả kèm data URL để giao diện xem trước ngay trong khung avatar. Renderer
    // chạy từ http://localhost nên KHÔNG tự đọc được file:// — phải đọc ở main.
    let dataUrl = ''
    try {
      const buf = readFileSync(file)
      if (buf.length <= 10_000_000) {
        const ext = extname(file).slice(1).toLowerCase()
        const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
        dataUrl = `data:${mime};base64,${buf.toString('base64')}`
      }
    } catch {
      /* không đọc được thì thôi xem trước, đường dẫn vẫn dùng được */
    }
    return { path: file, dataUrl }
  })

  // analytics
  // Bấm tay = thu thập đầy đủ, gồm cả số dư (phải mở từng profile đã đăng nhập).
  // Lượt tự động lúc mở app vẫn chỉ lấy follower — xem autoCollectIfNeeded().
  ipcMain.handle('analytics:collect', () => collectAll(true))
  ipcMain.handle('analytics:data', () => AnalyticsStore.data())

  // proxies (pool)
  ipcMain.handle('proxies:list', () => ProxyStore.list())
  ipcMain.handle('proxies:addMany', (_e, text: string, type: ProxyConfig['type']) => ProxyStore.addMany(text, type))
  ipcMain.handle('proxies:remove', (_e, id: string) => ProxyStore.remove(id))
  ipcMain.handle('proxies:check', (_e, id: string) => ProxyStore.check(id))
  ipcMain.handle('proxies:assign', (_e, proxyId: string, profileIds: string[]) => ProxyStore.assign(proxyId, profileIds))

  // get video
  ipcMain.handle('getvideo:listChannels', () => GetVideoStore.listChannels())
  ipcMain.handle('getvideo:addChannel', (_e, url: string) => {
    const c = GetVideoStore.addChannel(url)
    // Tên + avatar lấy nền, đừng bắt nút "Thêm channel" chờ 1 request mạng.
    void refreshChannelMeta(c.id)
    return c
  })
  ipcMain.handle('getvideo:refreshMeta', () => refreshMissingMeta())
  ipcMain.handle('getvideo:removeChannel', (_e, id: string) => GetVideoStore.removeChannel(id))
  ipcMain.handle('getvideo:setFollowing', (_e, id: string, f: boolean) => GetVideoStore.setFollowing(id, f))
  ipcMain.handle('getvideo:update', (_e, id: string) => crawlChannel(id))
  ipcMain.handle('getvideo:getSettings', () => GetVideoStore.getSettings())
  ipcMain.handle('getvideo:saveSettings', (_e, s: GvSettings) => GetVideoStore.saveSettings(s))
  ipcMain.handle('getvideo:updateYtDlp', () => updateYtDlp())
  ipcMain.handle('getvideo:denoInfo', () => denoInfo())
  ipcMain.handle('getvideo:installDeno', () => installDeno())

  // update
  ipcMain.handle('update:info', () => currentInfo())
  ipcMain.handle('update:check', () => checkForUpdate())
  ipcMain.handle('update:download', () => downloadUpdate())
  ipcMain.handle('update:install', () => installNow())

  // channel search (tab Search Kênh)
  ipcMain.handle('channelSearch:listCandidates', () => ChannelSearchStore.listCandidates())
  ipcMain.handle('channelSearch:addCandidate', (_e, r: CsSearchResult) => ChannelSearchStore.addCandidate(r))
  ipcMain.handle('channelSearch:removeCandidate', (_e, id: string) => ChannelSearchStore.removeCandidate(id))
  ipcMain.handle('channelSearch:setStatus', (_e, id: string, st: CsStatus) => ChannelSearchStore.setStatus(id, st))
  ipcMain.handle('channelSearch:getSettings', () => ChannelSearchStore.getSettings())
  ipcMain.handle('channelSearch:saveSettings', (_e, s: CsSettings) => ChannelSearchStore.saveSettings(s))
  ipcMain.handle('channelSearch:getQuota', () => ChannelSearchStore.getQuota())
  ipcMain.handle('channelSearch:search', (_e, p: CsSearchParams) => searchChannels(p))
  ipcMain.handle('channelSearch:checkTiktok', (_e, id: string) => checkTiktok(id))

  // templates
  ipcMain.handle('templates:list', () => TemplateStore.list())
  ipcMain.handle('templates:create', (_e, type: Template['type']) => TemplateStore.create(type))
  ipcMain.handle('templates:save', (_e, template: Template) => TemplateStore.save(template))
  ipcMain.handle('templates:remove', (_e, id: string) => TemplateStore.remove(id))
  ipcMain.handle('templates:defaultScript', () => DEFAULT_TIKTOK_SCRIPT)

  // schedules
  ipcMain.handle('schedules:list', () => ScheduleStore.list())
  ipcMain.handle('schedules:create', () => ScheduleStore.create())
  ipcMain.handle('schedules:save', (_e, s: Schedule) => ScheduleStore.save(s))
  ipcMain.handle('schedules:remove', (_e, id: string) => ScheduleStore.remove(id))

  // queue
  QueueManager.init()
  ipcMain.handle('queue:list', () => QueueManager.list())
  ipcMain.handle('queue:state', () => QueueManager.state())
  ipcMain.handle('queue:enqueue', (_e, templateId: string, profileIds: string[]) => QueueManager.enqueue(templateId, profileIds))
  ipcMain.handle('queue:jobLog', (_e, id: string) => QueueManager.jobLog(id))
  ipcMain.handle('queue:cancel', (_e, id: string) => QueueManager.cancel(id))
  ipcMain.handle('queue:retry', (_e, id: string) => QueueManager.retry(id))
  ipcMain.handle('queue:clearDone', () => QueueManager.clearDone())
  ipcMain.handle('queue:setPaused', (_e, p: boolean) => QueueManager.setPaused(p))
  ipcMain.handle('queue:setMaxConcurrency', (_e, n: number) => QueueManager.setMaxConcurrency(n))

  // system
  ipcMain.handle('system:machineIp', () => getMachineIp())
  ipcMain.handle('system:cleanData', (_e, drafts: boolean) => sweepAllProfilesCache({ drafts }))
  ipcMain.handle('system:countVideos', (_e, dir: string) => {
    if (!dir || !existsSync(dir)) return 0
    try {
      return readdirSync(dir).filter((n) => VIDEO_EXT.has(extname(n).toLowerCase())).length
    } catch {
      return 0
    }
  })
  /** Xóa video trong MỘT thư mục. Cố ý dùng ĐÚNG bộ lọc VIDEO_EXT của
   *  system:countVideos: nút dọn dẹp chỉ được xóa chính những file mà con số hiển thị
   *  bên cạnh nó đang đếm — không quét thư mục con, không đụng file khác (ảnh, .txt,
   *  .json…). Trả về số đã xóa và số xóa được (file đang bị khóa/mở dở → bỏ qua,
   *  không ném lỗi làm hỏng cả lượt). */
  ipcMain.handle('system:clearVideos', (_e, dir: string) => {
    if (!dir || !existsSync(dir)) return { deleted: 0, failed: 0 }
    let deleted = 0
    let failed = 0
    try {
      for (const name of readdirSync(dir)) {
        if (!VIDEO_EXT.has(extname(name).toLowerCase())) continue
        try {
          rmSync(join(dir, name), { force: true })
          deleted++
        } catch {
          failed++ // file đang được tiến trình khác giữ
        }
      }
    } catch {
      /* không đọc được thư mục — trả về những gì đã làm được */
    }
    return { deleted, failed }
  })
  ipcMain.handle('system:openFolder', async (_e, dir: string) => {
    if (!dir || !existsSync(dir)) return false
    const err = await shell.openPath(dir)
    return err === ''
  })
  ipcMain.handle('system:pickFolder', async () => {
    const win = getWindow()
    const res = await dialog.showOpenDialog(win ?? undefined!, { properties: ['openDirectory'] })
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })

  const sendToRenderer = (channel: string, ...args: unknown[]): void => {
    const win = getWindow()
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, ...args)
    }
  }

  // push profile status changes to the renderer
  launcherEvents.on('status', (id: string, status: string) => sendToRenderer('profile:status', id, status))
  loginEvents.on('progress', (id: string, msg: string) => sendToRenderer('profile:login-progress', id, msg))
  profileEvents.on('changed', () => sendToRenderer('profiles:changed'))
  getVideoEvents.on('update', () => sendToRenderer('getvideo:update'))
  getVideoEvents.on('log', (line: string) => sendToRenderer('getvideo:log', line))
  channelSearchEvents.on('log', (line: string) => sendToRenderer('channelsearch:log', line))
  channelSearchEvents.on('quota', (q: CsQuota) => sendToRenderer('channelsearch:quota', q))
  analyticsEvents.on('progress', (msg: string) => sendToRenderer('analytics:progress', msg))
  updateEvents.on('state', (s: UpdateState) => sendToRenderer('update:state', s))
  // Engine download/extract progress. The first launch on a machine (and every
  // time ShardX's manifest points at a newer engine) runs runtime.install()
  // INSIDE the profiles:run IPC call, which pulls a few hundred MB — without
  // this line the "Mở" button just sits there for minutes with no feedback and
  // the app looks frozen.
  engineEvents.on('progress', (p: { phase: string; pct: number }) =>
    sendToRenderer('engine:progress', p.phase, p.pct)
  )

  // schedule fired → enqueue jobs + notify UI
  schedulerEvents.on('fire', (s: Schedule) => {
    if (s.templateId && s.profileIds.length) QueueManager.enqueue(s.templateId, s.profileIds)
    sendToRenderer('schedule:fired', s.id, s.name)
  })

  // queue events → renderer
  queueEvents.on('update', () => sendToRenderer('queue:update'))
  queueEvents.on('log', (jobId: string, line: string) => sendToRenderer('job:log', jobId, line))

  startScheduler()
}
