# Thiết kế lại tab Profile — panel cài đặt bung inline

Ngày: 2026-08-02
Trạng thái: đã duyệt
Mockup: `mockups/profile.html` (commit `114f603`)

## Bối cảnh

Tab Profile hiện dùng bảng 10 cột, cài đặt mở trong modal dialog
(`ProfileSettingsDialog`). Ba vấn đề:

1. **Modal che mất ngữ cảnh** — không thấy đang sửa profile nào trong danh sách,
   không mở hai profile để so sánh.
2. **Dùng control mặc định của trình duyệt.** `ProfileSettingsDialog.tsx:255,
   264, 272` là `<select>` gốc: hộp được style bằng class `inp` nhưng danh sách
   xổ ra do Windows vẽ — sai theme, sai font. Trái nguyên tắc của dự án.
3. **Thiếu chỗ cho các trường mới** sau khi chuyển sang ShardX: thiết bị/GPU,
   màn hình, RAM, nhiễu 6 vector, media devices, cổng chặn quét, Do Not Track,
   vị trí.

## Quyết định

Giữ bảng với các cột nghiệp vụ hiện có, đổi modal thành **panel bung inline**
ngay dưới hàng, bố cục ba cột theo ShardX.

Không dùng bảng của ShardX vì nó không có Nhóm, Đã login, Cảnh báo,
Quốc gia/IP — bỏ các cột đó là mất thông tin nghiệp vụ.

## Bảng

Cột: checkbox · Tên (kèm id ngắn) · Nhóm · Quốc gia/IP · Trạng thái · Đã login ·
Cảnh báo · Lần cuối · thao tác.

Thêm so với hiện tại: cột checkbox đầu dòng (chuẩn bị cho thao tác hàng loạt) và
id ngắn dưới tên. Bỏ cột `#` và cột `Cài đặt` — nút ⚙ chuyển vào cụm thao tác.

Hàng đang mở đổi nền và bo góc dưới bằng 0 để nối liền với panel.

## Panel

Ba cột, `colspan` hết chiều rộng bảng:

| Cột 1 — Danh tính | Cột 2 — Khu vực + Nhiễu | Cột 3 — Riêng tư + Media + TikTok |
|---|---|---|
| Tên profile | Múi giờ | WebRTC (3 mức) |
| Nhóm, Cảnh báo (0–5) | Ngôn ngữ | Do Not Track |
| Hệ điều hành | Nhiễu: canvas, webgl, audio, client rects, cảm biến, font | Vị trí (auto / nhập tay) |
| Thiết bị / GPU | Cổng chặn quét | Media: mic, loa, webcam |
| User-Agent *(chỉ đọc)* | | TikTok: tài khoản, mật khẩu, 2FA, trang chủ |
| CPU cores, RAM, Màn hình *(chỉ đọc)* | | Ghi chú |
| Proxy + trạng thái UDP/QUIC | | |

Đáy panel: Xóa profile (trái) · Hủy · Lưu thay đổi.

### Quyết định về trường

- **Màn hình chỉ đọc** — độ phân giải đến từ thiết bị trong thư viện. Cho sửa
  tay dễ tạo tổ hợp không tồn tại ngoài đời.
- **User-Agent chỉ đọc** — `applyEngineVersion()` tự chuẩn hoá theo version
  engine đang chạy, sửa tay sẽ bị ghi đè.
- **Múi giờ và Ngôn ngữ đổi từ ô nhập tay sang dropdown** có sẵn lựa chọn
  "Tự động (theo proxy)". Đây chính là chỗ đang hỏng ở bản hiện tại.
- **Dòng trạng thái dưới ô Proxy** hiển thị `udpMs` / `quicEnabled` từ
  `checkProxy()` — thông tin trước giờ không nhìn thấy được.
- **Nhiễu mặc định để Thật** cho cả 6 vector, kèm ghi chú giải thích khi nào nên
  bật nhiễu.

## Control tự vẽ

Không dùng control mặc định của trình duyệt ở bất kỳ đâu:

- **Dropdown** — `div` hiển thị giá trị + popup danh sách tự vẽ, đóng khi bấm ra
  ngoài. Thay toàn bộ `<select>` hiện có, kể cả ô sắp xếp trên thanh công cụ.
- **Checkbox** — vuông bo 5px, viền `#3b3d4f`, khi bật thì nền gradient
  accent→accent2 và dấu tick vẽ bằng border.
- **Segmented** — dùng cho Hệ điều hành, Thật/Nhiễu, Do Not Track, Vị trí,
  Cảnh báo 0–5. Hai biến thể: nền gradient (lựa chọn chính) và nền `#1e2030`
  viền `#3a3d6b` (lựa chọn phụ, đỡ chói khi có nhiều cái cạnh nhau).
- **Chip cổng** — nền `rgba(99,102,241,.14)`, viền `#3a3d6b`, có nút × và ô nhập
  thêm ở cuối.
- **Scrollbar** — `::-webkit-scrollbar` thumb `#252732` bo tròn, track trong
  suốt.

## Thứ tự làm

Code React làm **cùng đợt tích hợp engine**, không tách riêng, vì panel hiển thị
những trường chỉ tồn tại sau khi chuyển sang ShardX (thiết bị/GPU, màn hình,
RAM, nhiễu, media, cổng).

Riêng phần thay `<select>` bằng dropdown tự vẽ thì độc lập với engine, làm trước
cũng được.

## Ngoài phạm vi

- Thao tác hàng loạt. Cột checkbox được dựng sẵn nhưng chưa nối hành vi.
- Ghim và nhân bản profile. Nút có trong mockup nhưng chưa có nghiệp vụ.
- Các tab khác giữ nguyên.
