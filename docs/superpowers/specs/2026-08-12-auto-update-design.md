# Tự động cập nhật app (auto-update qua GitHub Releases)

Ngày: 2026-08-12
Nhánh: `claude/auto-update-app-2d04b6`
Trạng thái: chờ duyệt

## 1. Vấn đề

App sẽ được chia sẻ cho người dùng khác. Hiện chưa có đường ra bản mới: mỗi lần
sửa gì đều phải gửi tay cả thư mục build và người kia phải tự chép đè. Không ai
biết mình đang chạy bản nào.

Mục tiêu: người dùng bấm một nút trong app là tải và cài được bản mới nhất.

### 1.1. Ràng buộc từ hiện trạng

| Vị trí | Hiện trạng | Ảnh hưởng |
|---|---|---|
| `package.json` `win.target` | `dir` — build ra thư mục chạy trực tiếp, không có trình cài đặt | `electron-updater` cần target `nsis` (hoặc zip) để sinh `latest.yml`. Phải đổi. |
| Repo | Chưa có git remote | Chưa có chỗ chứa file phát hành. |
| `scripts/set-exe-icon.ps1` | Chạy **sau** `electron-builder`, gắn icon vào `release/win-unpacked/HienNVAuto.exe` | Xem mục 3.2 — thứ tự này hỏng khi chuyển sang `nsis`. |
| Dữ liệu người dùng | DB, profile, Deno, yt-dlp đều nằm dưới `app.getPath('userData')` | Cài đè an toàn, không mất dữ liệu. Đã kiểm chứng: `db.ts:10`, `DenoManager.ts:31`, `YtDlpManager.ts:21`, `ProfileStore.ts:148`. |

## 2. Quyết định đã chốt

| Câu hỏi | Chốt | Lý do |
|---|---|---|
| Chỗ host bản mới | GitHub Releases | `electron-updater` hỗ trợ sẵn, miễn phí, không phải viết server. |
| Cấu trúc repo | Một repo public duy nhất: `Hienducnguyen1206/TiktokMultiAccountManager`, chứa cả source code lẫn bản phát hành. | Gọn, chỉ một chỗ để quản lý. Không phải nhúng GitHub token vào app — token nhúng trong `.exe` thì ai mở ra cũng đọc được. Đánh đổi: toàn bộ source công khai (xem mục 8). |
| Hình thức đóng gói | Trình cài đặt NSIS | Đường auto-update chính thức của `electron-updater`. Bản portable phải tự viết logic thay file khi app đóng, dễ lỗi. |
| Thời điểm kiểm tra | Tự kiểm tra nền khi mở app **và** nút bấm tay trong tab Cài đặt | Người dùng không bỏ lỡ bản mới mà vẫn chủ động kiểm tra được. |
| Tải về | Chỉ tải khi người dùng đồng ý (`autoDownload = false`) | Không ngốn mạng ngầm; người dùng chọn thời điểm. |

## 2.1. Điều kiện tiên quyết (tác giả tự làm, nằm ngoài phần code)

Ba việc này phải làm bằng tay trên GitHub trước khi phát hành được, không có bước
code nào thay thế được:

1. Đổi repo `Hienducnguyen1206/TiktokMultiAccountManager` từ Private sang Public.
2. Nối repo local với remote đó và đẩy source lên (repo local hiện chưa có
   remote nào).
3. Tạo Personal Access Token scope `public_repo`, đặt vào biến môi trường
   `GH_TOKEN` trên máy tác giả. Token **không** được commit vào repo.

Phần code vẫn viết và kiểm tra kiểu được trước khi có hai thứ này; chỉ bước phát
hành thật (mục 7) mới cần.

## 3. Thiết kế

### 3.1. Cấu hình đóng gói (`package.json`)

- `build.win.target`: `dir` → `nsis`.
- Thêm `build.publish`: provider `github`, `owner: Hienducnguyen1206`,
  `repo: TiktokMultiAccountManager`.
- Thêm `build.nsis`: `oneClick: true`, `perMachine: false` (cài vào thư mục người
  dùng, không cần quyền admin — hợp với một app công cụ cá nhân).
- Thêm script `release`: build rồi `electron-builder --win --publish always`.
  Token GitHub đọc từ biến môi trường `GH_TOKEN` trên máy tác giả, **không** nằm
  trong repo hay trong app.

### 3.2. Sửa thời điểm gắn icon

`scripts/set-exe-icon.ps1` tồn tại vì `signAndEditExecutable: true` làm hỏng build
trên Windows khi chưa bật Developer Mode (đã ghi trong `docs/dong-goi.md`). Script
tự chạy `rcedit` thay cho electron-builder.

Với target `dir`, chạy script sau `electron-builder` là đúng — thư mục
`win-unpacked` chính là sản phẩm cuối. Với `nsis` thì sai: electron-builder tạo
`win-unpacked` rồi **đóng gói ngay thành installer trong cùng một lệnh**, nên khi
script chạy thì installer đã chứa bản `.exe` chưa có icon.

Cách sửa: chuyển sang hook `afterPack` của electron-builder — hook này chạy đúng
giữa bước pack thư mục và bước đóng gói installer. Thêm `build/afterPack.js`, gọi
lại script PowerShell hiện có với đường dẫn `appOutDir` mà hook truyền vào (thay
vì đường dẫn ghi cứng `release\win-unpacked`). Logic `rcedit` giữ nguyên, chỉ đổi
thời điểm gọi và nguồn đường dẫn.

### 3.3. Main process — `src/main/services/UpdateService.ts`

Service mới, đóng gói toàn bộ tương tác với `electron-updater`:

- `autoUpdater.autoDownload = false`, `autoInstallOnAppQuit = false`.
- Xuất một `EventEmitter` (`updateEvents`) theo đúng pattern các service sẵn có
  (`profileEvents`, `queueEvents`, `getVideoEvents`), phát các trạng thái:
  `checking`, `available` (kèm version), `not-available`, `progress` (kèm %),
  `downloaded`, `error` (kèm thông báo tiếng Việt).
- `checkForUpdate()` — kiểm tra, trả về kết quả cho lời gọi thủ công.
- `downloadUpdate()` — tải bản đã tìm thấy.
- `quitAndInstall()` — thoát và cài.
- `currentVersion()` — `app.getVersion()`.
- Khi `!app.isPackaged`: mọi hàm trả về trạng thái "không khả dụng ở bản dev"
  thay vì ném lỗi, để chạy `npm run dev` không vỡ.
- Nuốt lỗi mạng: không có mạng thì báo trạng thái lỗi, không làm sập app.

### 3.4. IPC và preload

Trong `src/main/ipc.ts`, thêm bốn handler theo đúng pattern hiện có:
`update:version`, `update:check`, `update:download`, `update:install`. Cầu nối sự
kiện `updateEvents` → `webContents.send` đặt cùng chỗ với các cầu nối sự kiện khác
trong `registerIpc`.

Trong `src/preload/index.ts`, thêm nhánh `update` vào `api`, khai báo kiểu trong
`HnvApi` (`src/shared/types.ts`), gồm cả hàm đăng ký lắng nghe sự kiện tiến trình.

### 3.5. Renderer — khối "Phiên bản" trong `SettingTab.tsx`

Một khối mới trong tab Cài đặt, dùng lại đúng style thẻ/nút/toast sẵn có của tab
này. Không dùng control mặc định của browser.

Nội dung theo trạng thái:

| Trạng thái | Hiển thị |
|---|---|
| Nghỉ | "Phiên bản hiện tại: 1.0.0" + nút **Kiểm tra cập nhật** |
| Đang kiểm tra | Nút chuyển sang trạng thái chờ, khóa bấm |
| Đã mới nhất | "Bạn đang dùng bản mới nhất" |
| Có bản mới | "Đã có bản 1.1.0" + nút **Tải về** |
| Đang tải | Thanh tiến trình theo % |
| Tải xong | Nút **Cài đặt & khởi động lại** |
| Lỗi | Thông báo lỗi tiếng Việt + cho bấm kiểm tra lại |

Nút **Cài đặt & khởi động lại** bị khóa khi hàng đợi đang chạy, kèm chú thích lý
do — khởi động lại giữa một phiên automation là hỏng việc đang chạy.

### 3.6. Kiểm tra nền khi mở app

Trong `src/main/index.ts`, thêm một lệnh kiểm tra chạy nền đặt cạnh
`autoUpdateYtDlp()` (`index.ts:72`), trễ vài giây cho cửa sổ load xong. Không chờ
kết quả, không chặn khởi động. Có bản mới thì renderer nhận sự kiện `available` và
hiện toast; không có thì im lặng.

## 4. Luồng dữ liệu

```
Mở app ──> UpdateService.checkForUpdate() ──> GitHub Releases (latest.yml)
                     │
                     ├─ không có bản mới ──> im lặng
                     └─ có bản mới ──> updateEvents 'available' ──> IPC ──> toast + khối Phiên bản

Người dùng bấm Tải về ──> IPC update:download ──> updateEvents 'progress' (%) ──> thanh tiến trình
                                                          └─ 'downloaded' ──> nút Cài đặt & khởi động lại

Người dùng bấm Cài đặt ──> IPC update:install ──> quitAndInstall() ──> NSIS cài đè ──> app mở lại
```

Dữ liệu người dùng nằm ở `userData` (AppData), nằm ngoài thư mục cài đặt nên
không bị bước cài đè động tới.

## 5. Quy trình phát hành

1. Sửa `version` trong `package.json`.
2. Chạy `npm run release`.
3. electron-builder build, tạo installer + `latest.yml`, tự upload lên GitHub Releases.

Người dùng mở app → thấy thông báo → bấm tải → bấm khởi động lại.

## 6. Xử lý lỗi

| Tình huống | Hành vi |
|---|---|
| Không có mạng | Trạng thái lỗi trong khối Phiên bản, có nút thử lại. Kiểm tra nền thì im lặng. |
| GitHub trả 404 (chưa có release nào) | Coi như "đang dùng bản mới nhất", không báo lỗi dọa người dùng. |
| Tải dở dang rồi mất mạng | Báo lỗi, cho bấm tải lại từ đầu. |
| Chạy bản dev | Khối Phiên bản hiện version và ghi chú "cập nhật chỉ hoạt động ở bản đã cài đặt". |
| Hàng đợi đang chạy | Nút cài bị khóa kèm lý do. Tải về vẫn cho phép. |

## 7. Kiểm chứng

Không thể chỉ dựa vào `tsc` và build sạch. Cách kiểm chứng thật:

1. Build bản `1.0.0`, cài lên máy bằng installer.
2. Tăng version lên `1.0.1`, `npm run release` để đẩy lên GitHub Releases.
3. Mở bản `1.0.0` đã cài → phải thấy thông báo có bản mới.
4. Bấm tải → thanh tiến trình chạy → bấm cài → app khởi động lại ở bản `1.0.1`.
5. Kiểm tra sau khi cập nhật: danh sách profile, database, thư mục Deno và yt-dlp
   còn nguyên.
6. Kiểm tra icon của `.exe` sau khi cài (xác nhận hook `afterPack` hoạt động).

## 8. Điều đã biết trước và chấp nhận

**Source code công khai.** Repo phát hành cũng là repo chứa source, và nó là
public — nghĩa là toàn bộ code, gồm cả phần fingerprint/antidetect, ai cũng đọc
được. Tác giả đã cân nhắc và chấp nhận đánh đổi này để chỉ phải quản lý một repo.
Đã kiểm tra `.gitignore`: `node_modules/`, `out/`, `release/`, `*.log` đều bị
chặn, và dữ liệu người dùng (database, profile, cookie) nằm ở `userData` trong
AppData nên không nằm trong repo. Không có rò rỉ dữ liệu, chỉ có công khai code.

**App không có chữ ký số.** Windows SmartScreen sẽ cảnh báo "Nhà phát hành không xác
định" ở lần cài đầu tiên — người dùng phải bấm "More info → Run anyway".
Auto-update vẫn hoạt động bình thường sau đó. Muốn hết cảnh báo phải mua
certificate (khoảng 200–400 USD/năm), **không** nằm trong phạm vi thiết kế này.

## 9. Ngoài phạm vi

- Chữ ký số / code signing.
- Cập nhật kênh beta, rollback về bản cũ, cập nhật từng phần (delta).
- Bản dựng cho macOS / Linux.
- Giữ song song bản portable — đã chốt chỉ phát hành installer.
- Tách repo phát hành khỏi repo source — đã chốt dùng chung một repo public.

## 10. Tài liệu phải cập nhật

`docs/dong-goi.md` — mục "Bản build ra cái gì" đang mô tả `win.target = dir` và
việc `set-exe-icon.ps1` chạy ở bước cuối. Cả hai đều thay đổi trong thiết kế này.
