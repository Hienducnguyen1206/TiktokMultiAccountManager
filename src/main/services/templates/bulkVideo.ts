import type { BulkVideoConfig } from '@shared/types'

/** Giá trị mặc định của phần quyền riêng tư tài khoản — cũng là thứ TemplateStore
 *  điền cho template cũ chưa có khoá `account`. Đúng mặc định của TikTok: tài
 *  khoản công khai, ai cũng bình luận và đăng lại được. */
export const DEFAULT_BULK_ACCOUNT: BulkVideoConfig['account'] = {
  privateAccount: 'off',
  comment: 'everyone',
  duet: 'everyone'
}

export function defaultBulkVideoConfig(): BulkVideoConfig {
  // Mặc định là ĐỔI QUYỀN sang riêng tư, không phải xoá: tạo template mới rồi
  // lỡ tay bấm Chạy thì hậu quả còn gỡ lại được.
  return { action: 'privacy', privacy: 'private', account: { ...DEFAULT_BULK_ACCOUNT } }
}

/**
 * Script mỏng: toàn bộ phần nặng nằm ở `bulkVideos()` và `accountPrivacy()`
 * trong ProfileManagerService — chỗ đã đo kỹ khâu cuộn và khâu dò menu từng hàng.
 *
 * Thứ tự cố ý giống applyAll: quyền riêng tư TÀI KHOẢN trước, video sau. Phần
 * tài khoản nhanh và ở trang khác, làm trước để nếu phần video hỏng giữa chừng
 * thì nó vẫn đã xong.
 *
 * Gửi cả ba mục tài khoản mỗi lần chạy — không còn lựa chọn "giữ nguyên".
 * accountPrivacy() tự bỏ qua mục nào đang trùng giá trị nên vẫn không sinh thao
 * tác thừa trên TikTok.
 */
export const DEFAULT_BULK_VIDEO_SCRIPT = `// TikTok — Chỉnh sửa quyền riêng tư (v2)
// Áp cấu hình lên quyền riêng tư TÀI KHOẢN và TOÀN BỘ video của nick.

const acc = config.account || {};
const p = await accountPrivacy({
  privateAccount: acc.privateAccount === 'on',
  comment: acc.comment,
  duet: acc.duet
});
if (p.ok) log('Quyền riêng tư tài khoản: đã lưu');
else log('Quyền riêng tư tài khoản: ' + (p.reason || 'không lưu được'));

const r = await bulkVideos(config.action === 'delete'
  ? { kind: 'delete' }
  : { kind: 'privacy', privacy: config.privacy });

log('Tổng ' + r.total + ' video · cần xử lý ' + r.todo);
if (r.changed.length) log('Đã đổi quyền: ' + r.changed.length);
if (r.removed.length) log('Đã xóa: ' + r.removed.length);
if (r.failed.length) log('Không xử lý được: ' + r.failed.length);
`
