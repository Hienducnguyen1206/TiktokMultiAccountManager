import { rmSync, existsSync, readdirSync, statSync, type Dirent } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { ProfileStore } from './ProfileStore'

/**
 * Thư mục CHỈ chứa cache của Chromium — xóa không mất cookie/đăng nhập, Chrome tự
 * tạo lại lần mở sau. Không đụng Network (cookie) / Local Storage / Preferences.
 *
 * Phải dò CẢ HAI tầng: Chromium để gần hết dữ liệu profile trong <udd>/Default,
 * chỉ vài thư mục nằm ở gốc. Bản trước chỉ dò ở gốc nên trượt 100% — đo trên 49
 * profile thật: 49/49 có Default/Cache, 0/49 có Cache ở gốc; ngược lại
 * GraphiteDawnCache thì 49/49 ở gốc, 0/49 trong Default.
 */
const CACHE_SUBDIRS = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'ShaderCache',
  'GrShaderCache',
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'GraphiteDawnCache',
  'Crashpad',
  'Component Crash Reports',
  join('Service Worker', 'CacheStorage'),
  join('Service Worker', 'ScriptCache')
]

/**
 * Kho nháp upload của TikTok Studio. Mỗi video đăng lên để lại NGUYÊN file MP4 ở
 * đây để khôi phục nháp nếu đóng tab giữa chừng; đăng xong TikTok không tự dọn.
 * Đo thật: 785 blob ≈ 1,4 GB, blob lớn nhất 48 MB, magic byte 'ftypisom' = MP4.
 *
 * Automation không bao giờ dùng tới nháp, và phiên đăng nhập nằm ở
 * Default/Network/Cookies nên xóa chỗ này không làm đăng xuất.
 */
const DRAFT_DIRS = [
  join('Default', 'IndexedDB', 'https_www.tiktok.com_0.indexeddb.blob'),
  join('Default', 'IndexedDB', 'https_www.tiktok.com_0.indexeddb.leveldb')
]

export interface CleanResult {
  freedBytes: number
  profiles: number
}

/** Tổng dung lượng file trong 1 thư mục. Lỗi lẻ (khóa/không quyền) → bỏ qua. */
function dirSize(p: string): number {
  let total = 0
  let entries: Dirent[]
  try {
    entries = readdirSync(p, { withFileTypes: true }) as unknown as Dirent[]
  } catch {
    return 0
  }
  for (const e of entries) {
    const full = join(p, e.name)
    try {
      if (e.isDirectory()) total += dirSize(full)
      else total += statSync(full).size
    } catch {
      /* file biến mất giữa chừng */
    }
  }
  return total
}

/** Đo rồi xóa 1 thư mục. Trả về số byte thực sự giải phóng (0 nếu không có/xóa hụt). */
function rmDir(p: string): number {
  if (!existsSync(p)) return 0
  const size = dirSize(p)
  try {
    rmSync(p, { recursive: true, force: true })
  } catch {
    return 0 // đang bị khóa (browser còn mở) — lần sau dọn
  }
  return existsSync(p) ? 0 : size
}

/**
 * Dọn cache của một profile, trả về số byte giải phóng. An toàn khi browser đã đóng;
 * còn khóa thì rmSync ném lỗi và bị nuốt, không phá luồng chính.
 *
 * drafts=true: xóa thêm kho nháp upload TikTok (IndexedDB). Mặc định BẬT vì đó là
 * thứ phình nhanh nhất sau cache.
 */
export function cleanProfileCache(userDataDir: string, opts: { drafts?: boolean } = {}): number {
  const drafts = opts.drafts !== false
  let freed = 0
  for (const sub of CACHE_SUBDIRS) {
    freed += rmDir(join(userDataDir, sub))
    freed += rmDir(join(userDataDir, 'Default', sub))
  }
  if (drafts) for (const sub of DRAFT_DIRS) freed += rmDir(join(userDataDir, sub))
  return freed
}

/**
 * Quét dọn TẤT CẢ profile + trình duyệt analytics dùng chung. Gọi lúc app khởi động
 * (chưa browser nào chạy → không kẹt file khóa) và khi bấm nút Dọn ở tab Setting.
 */
export function sweepAllProfilesCache(opts: { drafts?: boolean } = {}): CleanResult {
  let freedBytes = 0
  let profiles = 0
  for (const p of ProfileStore.list()) {
    const n = cleanProfileCache(p.userDataDir, opts)
    if (n > 0) profiles++
    freedBytes += n
  }
  // Trình duyệt đọc analytics dùng chung (giữ cookie ấm, chỉ xóa cache).
  freedBytes += cleanProfileCache(join(app.getPath('userData'), 'data', 'analytics-browser'), opts)
  return { freedBytes, profiles }
}
