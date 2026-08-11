import { app } from 'electron'
import { EventEmitter } from 'events'
import { autoUpdater } from 'electron-updater'
import type { UpdateInfo, UpdateState } from '@shared/types'
import { QueueManager } from './QueueManager'

export const updateEvents = new EventEmitter()

// Không tự tải: người dùng bấm mới tải. Tải ngầm vài trăm MB trên máy đang chạy
// automation là thứ không ai xin.
autoUpdater.autoDownload = false
// Không tự cài lúc thoát: app này thường bị tắt giữa chừng một phiên làm việc,
// cài đè đúng lúc đó là thay file dưới chân tiến trình đang dọn dẹp.
autoUpdater.autoInstallOnAppQuit = false

let state: UpdateState = { kind: 'idle' }

function setState(s: UpdateState): void {
  state = s
  updateEvents.emit('state', s)
}

/** Bản dev không có installer nên electron-updater không có gì để so. */
function unsupported(): UpdateState {
  return {
    kind: 'unsupported',
    note: 'Cập nhật chỉ hoạt động ở bản đã cài đặt, không chạy ở bản dev'
  }
}

autoUpdater.on('checking-for-update', () => setState({ kind: 'checking' }))
autoUpdater.on('update-available', (info) =>
  setState({ kind: 'available', newVersion: info.version })
)
autoUpdater.on('update-not-available', () => setState({ kind: 'latest' }))
autoUpdater.on('download-progress', (p) =>
  setState({ kind: 'downloading', percent: Math.round(p.percent) })
)
autoUpdater.on('update-downloaded', (info) =>
  setState({ kind: 'downloaded', newVersion: info.version })
)
autoUpdater.on('error', (e) => setState({ kind: 'error', message: viError(e) }))

/**
 * Lỗi của electron-updater là tiếng Anh và hay lộ cả URL. Dịch sang câu người
 * dùng hiểu được.
 *
 * Trường hợp 404 KHÔNG phải lỗi: repo chưa có release nào thì đúng là chưa có
 * bản mới. Báo đỏ ở đây chỉ dọa người dùng vì một tình huống bình thường.
 */
function viError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  if (/404/.test(raw)) return ''
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|network/i.test(raw)) {
    return 'Không kết nối được máy chủ cập nhật. Kiểm tra mạng rồi thử lại.'
  }
  return `Lỗi cập nhật: ${raw}`
}

export function canInstall(): boolean {
  return !QueueManager.list().some((j) => j.status === 'running' || j.status === 'queued')
}

export function currentInfo(): UpdateInfo {
  return {
    current: app.getVersion(),
    state: app.isPackaged ? state : unsupported(),
    canInstall: canInstall()
  }
}

export async function checkForUpdate(): Promise<UpdateState> {
  if (!app.isPackaged) {
    setState(unsupported())
    return state
  }
  try {
    await autoUpdater.checkForUpdates()
  } catch (e) {
    const msg = viError(e)
    // Chuỗi rỗng = 404 = chưa có release nào. Coi như đang dùng bản mới nhất.
    setState(msg ? { kind: 'error', message: msg } : { kind: 'latest' })
  }
  return state
}

export async function downloadUpdate(): Promise<UpdateState> {
  if (!app.isPackaged) {
    setState(unsupported())
    return state
  }
  try {
    await autoUpdater.downloadUpdate()
  } catch (e) {
    const msg = viError(e)
    setState({ kind: 'error', message: msg || 'Tải bản cập nhật thất bại' })
  }
  return state
}

export function installNow(): void {
  if (!app.isPackaged) return
  // isSilent = false để người dùng thấy trình cài chạy; isForceRunAfter = true
  // để app tự mở lại — không thì họ tưởng app biến mất.
  autoUpdater.quitAndInstall(false, true)
}

/**
 * Kiểm tra lúc mở app. Nuốt lỗi hoàn toàn: không có mạng là chuyện thường, và
 * đây không phải thứ đáng để một cửa sổ vừa mở đã ném thông báo đỏ vào mặt.
 */
export async function checkInBackground(): Promise<void> {
  if (!app.isPackaged) return
  try {
    await checkForUpdate()
  } catch {
    /* im lặng — trạng thái đã được set trong checkForUpdate */
  }
}
