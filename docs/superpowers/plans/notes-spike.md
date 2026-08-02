# Kết quả spike 2026-08-02

- cdpUrl trả về: **Có** — `ws://127.0.0.1:49971/devtools/browser/8fc7ebd1-c137-414d-b039-99f76303b9f4` (lần chạy 2, sau khi sửa `cacheDir` sang đường dẫn tuyệt đối). Lần chạy 1 (`cacheDir` tương đối) trả về `null` — xem chẩn đoán chi tiết trong `.superpowers/sdd/2026-08-02-shardx-engine-integration/task-1-report.md`.
- extraArgs có tác dụng: **Có, nhưng chỉ xác nhận gián tiếp** qua đọc mã nguồn (`browser.js`: `if (opts.extraArgs) argv.push(...opts.extraArgs)` chạy không điều kiện, không có logic lọc bỏ tham số nào). KHÔNG quan sát trực tiếp bằng mắt việc cửa sổ có thực sự bị đẩy ra ngoài màn hình hay không, ở cả hai lần chạy.
- userDataDir do SDK trả về: `E:\Tool2\.claude\worktrees\manga-recap-tool-8b1af9\.spike-cache\profiles\9ab72989d5ca4759a0eb6fff0f7daf95` — đường dẫn tuyệt đối; đã xác minh file `DevToolsActivePort` nằm đúng trong thư mục này (không còn lệch vị trí như lần chạy 1 với `cacheDir` tương đối).
- geo qua proxy: **CHƯA ĐO — cần người chạy tay** (Step 4, cần proxy nước ngoài của chủ dự án).
- quicEnabled với proxy đang dùng: **CHƯA ĐO — cần người chạy tay** (Step 4). Ghi chú phụ: ở Step 3 (không proxy) `quicEnabled = false`, đúng như kỳ vọng khi không có proxy SOCKS5.
- session.process là ChildProcess: **Có** — `pid = 18952`, `!!session.process?.kill === true`.
- REUSE_USER_DATA_DIR = **CHƯA ĐO — cần người chạy tay**  ← Task 5 dùng giá trị này
  Lý do: Step 5 (trỏ vào user-data-dir cũ đang đăng nhập TikTok, tự tay mở tiktok.com kiểm tra cookie còn hay mất) chưa chạy — cần proxy riêng và người quan sát cửa sổ trình duyệt bằng mắt, ngoài phạm vi được giao cho lần chạy này.
- deleteProfile có xoá user-data-dir không: **CHƯA ĐO** — script Step 3 không gọi `deleteProfile`.

## Ba mục đo thêm (theo yêu cầu ngoài mẫu chuẩn)

- **cacheDir phải tuyệt đối = true.** Lý do: `@proxyshard/shardx@0.1.11` không gọi `resolve()` cho `cacheDir` (khác `profilesDir`, có gọi `resolve()`). Với `cacheDir` tương đối, tiến trình `chrome.exe` con phân giải `--user-data-dir` theo thư mục chứa chính nó (`<cacheDir>/ShardX-Windows/`), còn SDK lại poll file `DevToolsActivePort` theo cwd của tiến trình Node — hai nơi lệch nhau nên `readCdpEndpoint()` timeout 15 giây và trả `null`. Đổi sang `cacheDir: resolve('./.spike-cache')` thì hai bên khớp nhau, `cdpUrl` có giá trị hợp lệ ngay ở lần chạy kế tiếp, không cần tải lại engine.
- **Dung lượng tải thực tế = 511MB** (đo ở lần chạy 1 — trọn bộ engine + Widevine CDM + thư viện fingerprint, trước khi có profile nào chạy). Tài liệu/ước tính ban đầu ghi ~150MB — sai đáng kể (~3.4 lần) — cần đặt kỳ vọng dung lượng và timeout tải đúng con số này cho các máy chạy Task 1 sau.
- **deleteProfile có xoá user-data-dir không = CHƯA ĐO** — script spike không test đường này (không nằm trong Step 2/3).
