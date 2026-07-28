import { rmSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { ProfileStore } from './ProfileStore'

// Cache-only subfolders của Chromium — xóa được mà KHÔNG mất cookie/đăng nhập.
// Chrome tự tạo lại khi mở lần sau. Không đụng vào Network/Cookies/Local Storage.
const CACHE_SUBDIRS = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'Crashpad',
  'Component Crash Reports',
  'ShaderCache',
  'GrShaderCache',
  'DawnCache',
  'DawnGraphiteCache',
  join('Service Worker', 'CacheStorage'),
  join('Service Worker', 'ScriptCache')
]

/**
 * Dọn cache của một profile. An toàn khi browser đã đóng (file hết khóa); nếu
 * còn khóa, rmSync ném lỗi và bị nuốt — không phá luồng chính.
 */
export function cleanProfileCache(userDataDir: string): void {
  for (const sub of CACHE_SUBDIRS) {
    try {
      rmSync(join(userDataDir, sub), { recursive: true, force: true })
    } catch {
      /* file đang khóa / không tồn tại — bỏ qua */
    }
  }
}

/**
 * Quét dọn cache TẤT CẢ profile. Gọi lúc app khởi động (chưa browser nào chạy →
 * không kẹt file khóa) để xóa rác còn sót từ phiên trước bị tắt đột ngột/crash.
 */
export function sweepAllProfilesCache(): void {
  for (const p of ProfileStore.list()) {
    cleanProfileCache(p.userDataDir)
  }
  // Cả trình duyệt đọc analytics dùng chung (giữ cookie ấm, chỉ xóa cache).
  cleanProfileCache(join(app.getPath('userData'), 'data', 'analytics-browser'))
}
