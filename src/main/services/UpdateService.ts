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
// electron-updater phát 'error' TRƯỚC KHI ném lỗi ra ngoài cho checkForUpdate()/
// downloadUpdate() bắt (xem AppUpdater.checkForUpdates() và .downloadUpdate() trong
// node_modules/electron-updater/out/AppUpdater.js — cả hai đều emit('error', e) rồi
// mới throw/reject). Message rỗng nghĩa là lỗi vô hại (404 = chưa có release) —
// khối catch của checkForUpdate()/downloadUpdate() sẽ tự set state đúng (vd 'latest')
// ngay sau đây. Không phát state ở đây khi rỗng, nếu không UI (Task 4, lắng nghe
// thẳng sự kiện 'state') sẽ thấy lóe lên một state lỗi rỗng trước khi state đúng tới.
autoUpdater.on('error', (e) => {
  const message = viError(e)
  if (message) setState({ kind: 'error', message })
})

/** Đọc mã lỗi HTTP thật từ error object, nếu electron-updater có gắn (HttpError
 *  của nó có field `statusCode`). Đáng tin hơn nhiều so với mò trong text message. */
function statusCodeOf(e: unknown): number | null {
  if (!e || typeof e !== 'object') return null
  const o = e as Record<string, unknown>
  const v = o.statusCode ?? o.status
  return typeof v === 'number' ? v : null
}

/**
 * electron-updater luôn dùng ĐÚNG chuỗi này (xem GitHubProvider.getLatestVersion()
 * trong node_modules/electron-updater/out/providers/GitHubProvider.js, cả 2 nhánh
 * — feed rỗng lẫn tag == null) khi repo GitHub chưa có release nào.
 *
 * Xác nhận bằng cách CHẠY THẬT nhắm đúng repo publish của app (npm run dev với
 * autoUpdater.forceDevUpdateConfig=true): lỗi nhận được có
 * code='ERR_XML_MISSED_ELEMENT', KHÔNG có statusCode, và KHÔNG chứa chữ số "404"
 * ở đâu cả — giả định "404 = chưa có release" của bản gốc sai với thực tế.
 */
const NO_RELEASE_MESSAGE = 'No published versions on GitHub'

/**
 * Lỗi của electron-updater là tiếng Anh và hay lộ cả URL. Dịch sang câu người
 * dùng hiểu được.
 *
 * Trường hợp repo chưa có release nào KHÔNG phải lỗi — đúng là chưa có bản mới.
 * Báo đỏ ở đây chỉ dọa người dùng vì một tình huống bình thường.
 */
function viError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  if (raw === NO_RELEASE_MESSAGE) return ''
  // Phòng trường hợp provider/host khác thật sự trả 404 (một đường dẫn khác trong
  // thư viện — vd getLatestTagName()/fetchData() cùng file). Ưu tiên statusCode
  // thật trên error object; chỉ dò chữ "404" trong message làm phương án dự
  // phòng, và phải khớp NGUYÊN SỐ (word boundary) — nếu không thì một cổng mạng
  // hay mốc thời gian timeout tính bằng mili-giây trùng chuỗi con "404" cũng bị
  // nuốt nhầm thành "không có gì mới", hướng sai nguy hiểm hơn nhiều so với báo
  // lỗi nhầm.
  const is404 = statusCodeOf(e) === 404 || /\b404\b/.test(raw)
  if (is404) return ''
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|network/i.test(raw)) {
    return 'Không kết nối được máy chủ cập nhật. Kiểm tra mạng rồi thử lại.'
  }
  // Mọi lỗi khác (chữ ký không hợp lệ, hết dung lượng đĩa, thiếu quyền ghi file...):
  // không đẩy nguyên văn tiếng Anh/URL ra UI. Giữ chi tiết lại console để còn debug.
  console.error('[UpdateService]', raw)
  return 'Lỗi cập nhật. Vui lòng thử lại sau.'
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
    // Chuỗi rỗng = chưa có release nào (xem viError). Coi như đang dùng bản mới nhất.
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
