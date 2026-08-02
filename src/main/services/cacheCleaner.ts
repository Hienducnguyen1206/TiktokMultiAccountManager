import { rmSync } from 'fs'
import { join } from 'path'
import { ProfileStore } from './ProfileStore'
import { readerShardId, shardUserDataDir } from './ShardEngine'

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
 *
 * Phải quét THƯ MỤC SHARDX, không phải `profile.userDataDir`: từ khi đổi engine,
 * cache thật nằm ở `<dataRoot>/shard-profiles/<shardProfileId>/`, còn
 * `userDataDir` là thư mục của engine cũ và luôn rỗng — quét nó biến cả lượt dọn
 * lúc khởi động thành no-op. Cũng vì thế thư mục reader cũ
 * `data/analytics-browser` không còn tồn tại; reader bây giờ là một profile
 * ShardX có id lưu trong analytics-reader.json.
 */
export function sweepAllProfilesCache(): void {
  for (const p of ProfileStore.list()) {
    if (p.shardProfileId) cleanProfileCache(shardUserDataDir(p.shardProfileId))
  }
  // Cả trình duyệt đọc analytics dùng chung (giữ cookie ấm, chỉ xóa cache).
  const readerId = readerShardId()
  if (readerId) cleanProfileCache(shardUserDataDir(readerId))
}
