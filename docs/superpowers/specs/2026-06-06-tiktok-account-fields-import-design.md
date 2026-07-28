# Thiết kế: Trường tài khoản TikTok + Tạo profile từ file txt + Nút Đăng nhập (stub)

Ngày: 2026-06-06
Trạng thái: Đã duyệt thiết kế

## Mục tiêu

Chuẩn bị nền cho tính năng đăng nhập TikTok tự động (TOTP) sau này. Phạm vi
lần này **chưa triển khai logic đăng nhập** — chỉ thêm dữ liệu, đường nhập
liệu, và chỗ móc UI.

## Phạm vi

1. Mỗi profile lưu thêm 3 trường: `tiktokUsername`, `tiktokPassword`,
   `tiktok2fa` (chuỗi bí mật TOTP base32).
2. Tạo profile thủ công → 3 trường rỗng.
3. Tạo profile hàng loạt từ file `.txt` (mỗi dòng `username|password|2fa`),
   tên profile = username.
4. Sửa 3 trường trong dialog Cài đặt profile.
5. Nút "Đăng nhập" trên mỗi profile — **stub**, bấm hiện `alert`.

Ngoài phạm vi (để sau): logic đăng nhập CDP/TOTP/captcha, proxy theo account,
nhịp chạy hàng loạt, mã hoá mật khẩu.

## Quyết định đã chốt

- Mật khẩu + 2FA lưu **plaintext** trong SQLite (giống password proxy hiện có).
- Đường nhập file txt đặt **trong dialog "+ Profile mới"** (toggle chế độ),
  không làm nút riêng.
- Nút Đăng nhập khi bấm: hiện `alert("Chức năng đăng nhập sẽ triển khai sau")`.

## Chi tiết kỹ thuật

### Data model (`src/shared/types.ts`)
- `Profile`: thêm `tiktokUsername: string`, `tiktokPassword: string`,
  `tiktok2fa: string`.
- `CreateProfileInput`: dùng cho tạo thủ công — thêm 3 trường (optional, default
  rỗng) HOẶC giữ nguyên và set rỗng ở store. Chọn: thêm optional để dùng lại cho
  import.
- `HnvApi.profiles`: thêm `importTxt: () => Promise<{ created: number; failed: number }>`.

### DB (`src/main/db.ts`)
- 3 cột mới qua `addColumn` (idempotent): `tiktok_username`, `tiktok_password`,
  `tiktok_2fa`, kiểu `TEXT NOT NULL DEFAULT ''`. Profile cũ → rỗng, không phá DB.

### Store (`src/main/services/ProfileStore.ts`)
- `Row` + `rowToProfile`: map 3 cột mới.
- `create`: nhận thêm 3 trường (default rỗng) và INSERT.
- `update`: UPDATE thêm 3 cột.
- Hàm mới `createFromAccounts(accounts: {username; password; twofa}[])`: với mỗi
  account tạo 1 profile, **name = username**, 3 trường điền tương ứng,
  proxy/fingerprint mặc định. Trả về danh sách profile tạo được.

### IPC (`src/main/ipc.ts` + `src/preload/index.ts`)
- `profiles:importTxt`: main mở `dialog.showOpenDialog` lọc `.txt`, đọc file,
  parse từng dòng `username|password|2fa` (trim; bỏ dòng rỗng/sai định dạng/
  thiếu trường), gọi `ProfileStore.createFromAccounts`, trả `{ created, failed }`.

### UI tạo profile (`src/renderer/.../NewProfileDialog.tsx`)
- Thêm toggle 2 chế độ: "Thủ công" (form hiện tại) và "Từ file .txt".
- Chế độ txt: nút "Chọn file .txt" → gọi `profiles.importTxt()` → báo
  `Đã tạo {created} profile, {failed} dòng lỗi` → đóng dialog + reload.

### UI cài đặt (`src/renderer/.../ProfileSettingsDialog.tsx`)
- Thêm mục "Tài khoản TikTok": 3 ô input (username/password/2FA), lưu qua
  `profiles.update` sẵn có.

### UI danh sách (`src/renderer/.../ProfileTab.tsx`)
- Thêm nút "🔑 Đăng nhập" mỗi dòng (cạnh Run/Đồng bộ), onClick →
  `alert('Chức năng đăng nhập sẽ triển khai sau')`.

## Định dạng file txt (tham chiếu `E:\Tool2\30han.txt`)
```
username|password|2fa_secret
```
- Ngăn cách bằng `|`. Cột 1 là username TikTok (không phải email).
- Cột 3 là chuỗi base32 TOTP.
- 1 dòng = 1 account = 1 profile.

## Kiểm thử
- Tạo thủ công: 3 trường rỗng, hoạt động như cũ.
- Import `30han.txt`: tạo đúng 30 profile, tên = username, 3 trường đúng giá trị.
- Dòng lỗi/thiếu trường: bị bỏ qua, đếm vào `failed`.
- Settings: sửa & lưu 3 trường thành công.
- Nút Đăng nhập: hiện alert, không làm gì khác.
