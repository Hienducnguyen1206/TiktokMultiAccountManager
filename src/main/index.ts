import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { getDb } from './db'
import { registerIpc } from './ipc'
import { sweepAllProfilesCache } from './services/cacheCleaner'
import { autoCollectIfNeeded } from './services/AnalyticsService'
import { killAllProcs } from './services/EngineProcs'
import { cleanPartFiles } from './services/GetVideoService'
import { autoUpdateYtDlp } from './services/YtDlpManager'
import { ProfileStore, profileEvents } from './services/ProfileStore'
import { assignDevices } from './services/ShardEngine'

let mainWindow: BrowserWindow | null = null

// Lưới an toàn: lỗi/rejection không bắt được sẽ CHỈ ghi log, KHÔNG làm sập app.
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e))
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e))

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0b10',
    title: 'HienNVAuto',
    // Icon cửa sổ (dev). Bản đóng gói dùng icon nhúng trong .exe (build/icon.ico).
    icon: join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    // Mở sẵn toàn màn hình, nhưng KHÔNG khóa: người dùng thu nhỏ về cửa sổ được.
    mainWindow?.maximize()
    mainWindow?.show()
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  getDb() // init DB + run migrations
  // Quét dọn cache còn sót từ phiên trước (crash/tắt đột ngột). Lúc này chưa
  // browser nào chạy nên không kẹt file khóa → dọn triệt để. Giữ cookie/login.
  sweepAllProfilesCache()
  cleanPartFiles() // dọn file .part/.ytdl tải dở còn sót trong Pending
  registerIpc(() => mainWindow)
  createWindow()

  // Kiểm tra bản mới của yt-dlp (tối đa 7 ngày/lần), chạy nền — KHÔNG chờ, vì
  // đây không phải thứ đáng để cửa sổ mở chậm. Bản cũ hỏng theo kiểu trông như
  // bị YouTube chặn, nên để nó tự mốc là tự chuốc lỗi khó đoán.
  void autoUpdateYtDlp()

  // Gán thiết bị ShardX cho những profile còn thiếu (tạo/import trước khi việc
  // gán được chuyển lên lúc tạo). Không có bước này thì panel cài đặt của chúng
  // trống trơn — không User-Agent, không GPU, không màn hình — cho tới khi mở
  // thủ công từng cái. Chạy nền, nuốt lỗi, và chỉ tốn công đúng một lần: xong
  // rồi thì các lần khởi động sau không còn gì để làm.
  setTimeout(() => {
    void (async () => {
      // Filter on the symptom the user sees — an empty device — not on whether
      // a shard profile exists. Two profiles had one and were still blank.
      const missing = ProfileStore.list().filter((p) => !p.fingerprint.deviceId)
      if (missing.length === 0) return
      console.log(`[main] gán thiết bị cho ${missing.length} profile còn thiếu…`)
      await assignDevices(missing)
      profileEvents.emit('changed') // renderer tải lại danh sách
    })()
  }, 4000)

  // Tự thu thập follower 1 lần/ngày (nền, headless). Chờ 8s cho UI load xong.
  setTimeout(() => { void autoCollectIfNeeded() }, 8000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Thoát app → kill mọi trình duyệt engine còn mở (tránh orphan giữ khóa profile).
app.on('before-quit', () => killAllProcs())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
