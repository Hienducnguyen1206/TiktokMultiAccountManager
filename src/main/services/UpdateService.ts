import { app } from 'electron'
import { EventEmitter } from 'events'
import { autoUpdater } from 'electron-updater'
import type { InstallResult, UpdateInfo, UpdateState } from '@shared/types'
import { QueueManager } from './QueueManager'
import { hasAnyRunning } from './ShardEngine'

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

// Nguồn của lượt kiểm tra ĐANG chạy — dùng để App.tsx biết có nên bắn toast nền
// hay không (finding MINOR 6: bấm tay ở tab Cài đặt đã tự toast tại chỗ rồi,
// bắn thêm ở App.tsx thành 2 toast chồng nhau cho cùng một cú bấm).
let lastCheckSource: 'manual' | 'background' = 'background'

autoUpdater.on('checking-for-update', () => setState({ kind: 'checking' }))
autoUpdater.on('update-available', (info) => {
  setState({ kind: 'available', newVersion: info.version })
  if (lastCheckSource === 'background') updateEvents.emit('background-available', info.version)
})
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
  // Chỉ tin statusCode THẬT trên error object (HttpError của builder-util-runtime
  // gắn field này khi chính GitHub API trả 404 — vd token sai/repo không tồn tại).
  // TRƯỚC ĐÂY còn dò thêm chữ "404" trong message làm phương án dự phòng — bỏ:
  // khi release thiếu asset latest.yml, GitHubProvider bọc lỗi 404 gốc thành
  // ERR_UPDATER_CHANNEL_FILE_NOT_FOUND (node_modules/electron-updater/out/providers/
  // GitHubProvider.js) bằng newError(), một Error THƯỜNG không có statusCode —
  // nhưng message của nó vẫn nhét nguyên message gốc "404 Not Found..." vào
  // trong (`e.stack || e.message`). Dò chữ "404" trong text sẽ nuốt nhầm đúng
  // ca lỗi thật này thành "đang dùng bản mới nhất", im lặng vĩnh viễn — chính
  // lỗi mà finding CRITICAL 2 của review bắt được. statusCodeOf() không dính lỗi
  // này vì nó đọc field số thật, không đọc text.
  const is404 = statusCodeOf(e) === 404
  if (is404) return ''
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|network/i.test(raw)) {
    return 'Không kết nối được máy chủ cập nhật. Kiểm tra mạng rồi thử lại.'
  }
  // Mọi lỗi khác (chữ ký không hợp lệ, hết dung lượng đĩa, thiếu quyền ghi file...):
  // không đẩy nguyên văn tiếng Anh/URL ra UI. Giữ chi tiết lại console để còn debug.
  console.error('[UpdateService]', raw)
  return 'Lỗi cập nhật. Vui lòng thử lại sau.'
}

/**
 * Điều kiện nào đang chặn cài đặt — hoặc null nếu không có gì chặn.
 *
 * Hai nguồn độc lập:
 * - hàng đợi còn job chạy/chờ: quitAndInstall() đóng app ngay, mất trắng job.
 * - có profile đang mở Chromium (bất kể mở tay qua "Mở", hay do job template/
 *   đăng nhập/đồng bộ mở): before-quit gọi killAllProcs() hard-kill Chromium,
 *   cách chắc chắn làm hỏng user_data_dir của đúng profile đang mở đó.
 *   Nguồn đọc là ShardEngine.hasAnyRunning() (sessions/launching) — KHÔNG
 *   phải ProfileStore.setRunning()/status==='running': cờ đó chỉ được
 *   BrowserLauncher (nút "Mở" tay) cập nhật, còn phiên do TikTokLogin/
 *   TikTokSync/ProfileManagerService mở (đăng nhập, đồng bộ, load thông tin
 *   ~30s) không bao giờ set nó true — dùng cờ đó từng khiến guard đọc "rảnh"
 *   trong khi Chromium vẫn đang mở, đúng lỗ hổng mà finding IMPORTANT 3 của
 *   review nêu ra (đã sửa lại ở đây).
 */
function installBlockReason(): 'queue' | 'profiles' | null {
  if (QueueManager.list().some((j) => j.status === 'running' || j.status === 'queued')) return 'queue'
  if (hasAnyRunning()) return 'profiles'
  return null
}

export function canInstall(): boolean {
  return installBlockReason() === null
}

export function currentInfo(): UpdateInfo {
  const reason = installBlockReason()
  return {
    current: app.getVersion(),
    state: app.isPackaged ? state : unsupported(),
    canInstall: reason === null,
    installBlockedReason: reason
  }
}

export async function checkForUpdate(source: 'manual' | 'background' = 'manual'): Promise<UpdateState> {
  lastCheckSource = source
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

/**
 * Chốt chặn THẬT phải nằm ở main — nơi giữ state gốc (QueueManager, ShardEngine).
 * Renderer (UpdateSection.tsx) cũng tự khóa nút bằng canInstall, nhưng đó chỉ là
 * snapshot lấy async: một cú click lọt đúng khoảng "job vừa bắt đầu chạy — renderer
 * chưa kịp nhận refresh" vẫn gọi được ipc 'update:install'. Nếu installNow() tin
 * renderer vô điều kiện, quitAndInstall() sẽ đóng app giữa chừng — mất job hàng đợi,
 * hoặc hard-kill Chromium của profile đang mở (before-quit → killAllProcs()) và
 * làm hỏng user_data_dir của nó.
 */
export function installNow(): InstallResult {
  if (!app.isPackaged) return { ok: false, reason: 'Cập nhật chỉ hoạt động ở bản đã cài đặt.' }
  const reason = installBlockReason()
  if (reason === 'queue') {
    return {
      ok: false,
      reason: 'Hàng đợi đang có việc chạy. Đợi chạy xong rồi hãy cài đặt.'
    }
  }
  if (reason === 'profiles') {
    return {
      ok: false,
      reason: 'Đang có profile mở trình duyệt. Đóng hết các phiên đang chạy rồi hãy cài đặt.'
    }
  }
  // isSilent = false để người dùng thấy trình cài chạy; isForceRunAfter = true
  // để app tự mở lại — không thì họ tưởng app biến mất.
  autoUpdater.quitAndInstall(false, true)
  return { ok: true }
}

/**
 * Kiểm tra lúc mở app. Nuốt lỗi hoàn toàn: không có mạng là chuyện thường, và
 * đây không phải thứ đáng để một cửa sổ vừa mở đã ném thông báo đỏ vào mặt.
 */
export async function checkInBackground(): Promise<void> {
  if (!app.isPackaged) return
  try {
    await checkForUpdate('background')
  } catch {
    /* im lặng — trạng thái đã được set trong checkForUpdate */
  }
}
