# Tích hợp ShardX làm engine trình duyệt cho HienNVAuto

Ngày: 2026-08-02
Trạng thái: chờ duyệt

## Bối cảnh

HienNVAuto hiện dùng `fingerprint-chromium` (adryfish) pin cứng ở bản
`144.0.7559.132`, tải từ GitHub Releases. Engine này spoof được UA, OS, audio,
canvas, WebGL image, fonts, ClientRects, plugins, memory, CPU cores và Client
Hints, nhưng để hở một số bề mặt:

- **Timezone / locale / geolocation không khớp proxy.** `types.ts` khai
  `"auto" to follow proxy / system` nhưng phần "follow proxy" chưa được viết:
  `FingerprintEngine` mặc định `timezone: 'auto'`, còn `buildArgs()` gặp
  `'auto'` thì bỏ qua, không truyền `--timezone`. Kết quả là profile lộ giờ máy
  thật dù `proxies.country_code` đã có sẵn trong DB.
- **GPU.** Các tham số `--fingerprint-gpu-vendor` / `--fingerprint-gpu-renderer`
  bị gỡ ở Chrome 144 — đúng bản đang pin. GPU thật nhiều khả năng lộ qua
  `navigator.gpu` và WebGL renderer, giống nhau trên mọi profile.
- **Screen.** Engine không spoof độ phân giải. Mọi profile trên cùng một máy báo
  cùng `screen.*` và `devicePixelRatio`.
- **TLS ClientHello (JA3/JA4).** Không spoof. Mọi profile có cùng ClientHello.
- **CDP.** Toàn bộ luồng automation (`AutomationRunner`, `TikTokLogin`,
  `TikTokSync`, `AnalyticsService`) chạy qua CDP không hardened.
- **QUIC.** `blockWebRTC` mặc định bật → `--disable-quic`, mất HTTP/3.
- **`--fingerprint-brand-version` không bao giờ được truyền**, nên
  `fingerprint.browserVersion` là dữ liệu chết và UI hiển thị sai version.

Screen và GPU giống nhau giữa các profile là tín hiệu **liên kết tài khoản**,
nguy hiểm hơn từng lỗ riêng lẻ.

## Quyết định

Thay engine bằng **ShardX Node SDK** (`@proxyshard/shardx`), thay hẳn engine cũ
(không giữ song song hai engine). Đường lui là git.

### Vì sao SDK chứ không phải HTTP API

App desktop ShardX có REST API ở `127.0.0.1:40325`, nhưng:

- API **yêu cầu app desktop đang mở** — thêm một GUI thứ hai, trái yêu cầu
  "điều khiển bằng giao diện của tôi".
- Body của `POST /profiles/{id}/start` chỉ nhận `headless`. Không truyền được
  `extraArgs` → mất 4 flag chống throttle và `--window-position`.
- Không expose `userDataDir` → `cleanProfileCache()` hỏng.

SDK không có các hạn chế trên: `LaunchOptions` có `extraArgs`, `userDataDir`,
`env`, và `BrowserSession` trả về `userDataDir`, `pid`, `process`, `cdpUrl`.

### Vì sao thay hẳn chứ không chạy song song

Giữ hai engine nghĩa là nuôi `EngineManager`, `ProxyRelay`, `buildArgs` cùng bug
timezone của chúng, và mọi thay đổi sau này phải sửa hai nơi. Rủi ro duy nhất
từng khiến cần đường lui — throttle khi chạy nhiều profile song song — đã được
`extraArgs` gỡ bỏ vì truyền được đúng 4 flag hiện dùng.

## Giấy phép

- SDK: **MIT**, `files: ["dist", "README.md"]` — chỉ mã JS.
- Engine Chromium 149: **closed-source**, tải runtime từ R2 của ProxyShard.
  Không đóng gói vào bản build → không redistribute → không vi phạm.
- Điều khoản cấm **sản phẩm antidetect thương mại**. Dùng cá nhân được phép.
  Nếu HienNVAuto chuyển sang thương mại thì phải xin phép ProxyShard trước.

## Kiến trúc

Thêm một module duy nhất được phép `import` từ `@proxyshard/shardx`:

`src/main/services/ShardEngine.ts`

```ts
ensureRuntime(): Promise<void>
createShardProfile(fp: Fingerprint): Promise<string>
updateShardProfile(shardId: string, fp: Fingerprint): Promise<void>
deleteShardProfile(shardId: string): Promise<void>
openBrowsing(profile: Profile): Promise<BrowserSession>
openAutomation(profile: Profile): Promise<{ browser: Browser; session: BrowserSession }>
closeSession(profileId: string): Promise<void>
```

**Xoá:** `EngineManager.ts`, `ProxyRelay.ts`, `buildArgs()`, `waitForWsEndpoint()`.

**Giữ nguyên:** `EngineProcs` (`BrowserSession.process` là `ChildProcess` nên
`trackProc()` dùng lại y nguyên), `cacheCleaner` (nhận `session.userDataDir`),
`Network.ts`, `QueueManager`, `Scheduler`, `TemplateStore`, toàn bộ GetVideo,
`AnalyticsStore`, `GroupStore`.

**Đổi vai:** `FingerprintEngine.ts` — từ chỗ random seed thành lớp dịch hai
chiều giữa `Fingerprint` của UI và `Profile.config` của SDK, kiêm chọn thiết bị
từ `library.filter({ platform: 'windows' })`.

Hai package `https-proxy-agent` và `socks-proxy-agent` **giữ lại** —
`Network.ts` vẫn dùng, không phải chỉ `ProxyRelay` dùng.

## Nguồn sự thật

| Dữ liệu | Nơi lưu |
|---|---|
| name, group, notes, warning_level, home_url, thông tin TikTok, lịch sử, analytics | sqlite (không đổi) |
| proxy (kho, gán cho profile, kết quả test) | sqlite (không đổi) |
| fingerprint | **file profile của SDK** |
| user-data-dir | thư mục hiện có, truyền qua `LaunchOptions.userDataDir` |

Fingerprint chuyển hẳn sang SDK để tránh hai nguồn lệch nhau. Cột
`profiles.fingerprint` ngừng được đọc, giữ lại để rollback. Đọc/ghi qua
`sdk.openProfile(id)` và `sdk.saveProfile(profile)` — cả hai đều đồng bộ, không
phải `Promise`, nên gọi trực tiếp trong IPC handler được.

Hệ quả: `ProfileSettingsDialog` hiển thị đúng giá trị sẽ chạy, chấm dứt tình
trạng hiện tại (hiện 143 nhưng chạy 144).

## Thay đổi DB

Một dòng vào `migrate()`, theo đúng kiểu `addColumn` idempotent sẵn có:

```ts
addColumn(d, 'profiles', 'shard_profile_id', `TEXT`)
```

Profile cũ để `NULL`, tạo lazy ở lần mở đầu tiên. Không migrate hàng loạt.

Bảng `proxies` thêm `timezone`, `latitude`, `longitude`, `udp_ms`,
`quic_ok` để cache kết quả geo (xem phần Rủi ro).

## Ánh xạ fingerprint

| `Fingerprint` (UI) | `Profile.config` (SDK) |
|---|---|
| *(bỏ)* `seed` | — SDK dùng thư viện thiết bị + `setNoise`, không có seed |
| `deviceId` *(mới)* | id entry trong `FingerprintLibrary` |
| `platform` | `navigator.platform` + `client_hints.platform` |
| `brand`, `browserVersion` | `navigator.user_agent` (chỉ đọc — `applyEngineVersion` tự chuẩn hoá theo engine) |
| `hardwareConcurrency` | `navigator.hardware_concurrency` |
| `deviceMemory` *(mới)* | `navigator.device_memory` |
| `language`, `languages` | `navigator.language` |
| `timezone` | `timezone` — cùng ngữ nghĩa, `'auto'` resolve qua proxy lúc launch |
| `blockWebRTC: boolean` → `webrtc: 'block' \| 'auto' \| 'tcp_only'` | `LaunchOptions.webrtc` |
| `screen` *(mới)* | `screen` |
| `webgl` *(mới)* | `webgl.unmasked_vendor` / `unmasked_renderer` |

`Ports to block` và `Media devices` chưa có API có kiểu, nhưng `Profile.config`
là `Record<string, unknown>` và `withOverride()` nhận key tuỳ ý, nên set được
sau khi tra tên trường trong file profile JSON.

## Mặc định bắt buộc đặt tường minh

Mặc định của SDK **khác** mặc định của app desktop. `ShardEngine` phải đặt rõ,
không dựa vào mặc định thư viện:

- `screenMode: 'profile'` — SDK mặc định `'use_host'` trên Windows, tức là lộ
  đúng màn hình máy thật. App desktop mặc định "From fingerprint" (`'profile'`).
  **Đây là lỗi dễ mắc nhất và làm hỏng một trong các lợi ích chính.**
- noise: tắt hết (giữ `Real`) — mỗi profile bốc một thiết bị khác nhau, không
  cần nhiễu. Nhiễu chỉ cần khi nhiều profile chung một thiết bị.
- `timezone`, `language`, geolocation: `'auto'`.
- `extraArgs`: 4 flag chống throttle hiện có, cộng `--window-position` cho
  luồng automation.

## Luồng

**Tạo profile** — `sdk.createProfile()` (không truyền template → bốc ngẫu nhiên
từ thư viện, mỗi profile một thiết bị khác nhau), đè các trường user chọn, lưu
id vào `shard_profile_id`.

**Mở thủ công** — `openBrowsing()` gọi `sdk.launch(prof, { proxy, cdp: false,
screenMode: 'profile', webrtc, userDataDir, extraArgs: [...ANTI_THROTTLE,
'--start-maximized'] })`.

**Automation** — `openAutomation()` như trên nhưng `cdp: true` và `extraArgs` có
`--window-position=-32000,-32000`, rồi
`puppeteer.connect({ browserWSEndpoint: session.cdpUrl })`.
**Từ dòng đó trở xuống, cả bốn service không sửa gì.**

**Đóng** — `session.stop()` rồi `cleanProfileCache(session.userDataDir)`.

## Xử lý lỗi

- Nối `ShardXOptions.progress` vào `engineEvents` sẵn có để UI tiến trình tải
  engine không phải sửa.
- Giữ map `openSessions` thay `openProcs` để chặn mở trùng profile.
- Mọi lỗi từ SDK phải `ProfileStore.setRunning(id, false)` trong `finally`.
  Hiện tại profile có thể kẹt trạng thái "đang chạy" khi spawn lỗi.
- `geoCheckVia` **throw** khi provider lỗi hoặc chạm rate limit — phải bắt và
  fallback về giá trị cache, không để làm hỏng cả job.

## Settings mới

- **Thư mục engine** (`cacheDir`) — mặc định `join(dataRoot(), 'shardx')` để
  `backup-data.bat` / `restore-data.bat` bao luôn.
- **Nhà cung cấp geo** — `ip-api.com` | `ipapi.co` | `ipwho.is`, kèm bật/tắt
  cache theo proxy.
- **Timeout UDP probe** (`probeTimeoutMs`).
- **Mặc định cho profile mới** — `screenMode`, các công tắc noise. (Làm sau.)

## Rủi ro

**Engine tự cập nhật, không tắt được.** `MANIFEST_URL` trỏ vào
`runtime.json` trên GitHub của họ; `install()` đọc manifest mỗi lần tiến trình
khởi động rồi tải archive từ R2. `applyEngineVersion()` viết lại
`navigator.user_agent` và client hints của mọi profile theo version mới. App
desktop của họ cũng không có tuỳ chọn tắt. Giảm thiểu: coi `cacheDir` như
artifact, sao lưu sau khi xác nhận một bản chạy ổn. Hệ quả kèm theo: **cần mạng
lúc khởi động**, khác `ensureEngine()` hiện tại chạy offline được.

**Geo lookup chạm trần.** Cả ba provider đều no-key, rate-limited;
`ip-api.com` khoảng 45 req/phút. Mỗi lần launch có trường `auto` là một lượt
tra. Chạy queue nhiều profile song song sẽ đụng trần. Bắt buộc cache theo proxy.

**Package pre-1.0.** `0.1.11`, cập nhật lần cuối 2026-06-14. Pin cứng version
trong `package.json`, không dùng `^`.

**Engine closed-source, không kiểm toán được.** Tài khoản GitHub `ProxyShard` là
tài khoản cá nhân tạo 2026-03-23, không tên thật, không pháp nhân. Engine chạy
với quyền truy cập toàn bộ cookie/session trong user-data-dir. Khuyến nghị:
không dùng chung profile cho ngân hàng, ví crypto, email chính.

**Throttle khi chạy song song chưa đo.** Đã xác nhận `extraArgs` truyền được
nên rủi ro thấp, nhưng vẫn phải đo thật.

**`patchright` là dependency cứng** (~21MB) dù chỉ `session()` dùng tới. Ta dùng
`launch()` + `puppeteer-core` nên có thể loại khỏi bản `electron-builder`.

## Ngoài phạm vi

- **Thiết kế lại UI profile.** Làm sau, project riêng, bắt đầu bằng
  `mockups/profile.html` rồi mới code — đúng quy trình đang dùng cho các tab
  khác. Sẽ thay luôn các `<select>` gốc của trình duyệt ở
  `ProfileSettingsDialog.tsx:255, 264, 272` bằng dropdown tự code.
- **Import/export cookie.** SDK không có. Nếu cần thì phải qua HTTP API.
- **Giảm dấu vết hành vi.** `uploadVideo.ts` đang gõ phím đều 25ms và `sleep`
  hằng số; `schedules.time` cố định theo phút. Đây là tầng rủi ro lớn hơn
  fingerprint nhưng độc lập với việc đổi engine — xử lý riêng.
- **MCP server.** Cần app desktop chạy nền; chỉ dùng như công cụ dev khi
  TikTok đổi giao diện, không đưa vào kiến trúc sản phẩm.

## Kiểm chứng

Ba bước, bước sau chỉ làm khi bước trước đạt:

1. **Spike** — cài package vào dự án, xác minh chữ ký hàm khớp type
   definitions. Ba điểm còn nghi: cách mở URL trang chủ khi `cdp: false`;
   `extraArgs` có bị lọc flag nào không; `deleteProfile` có xoá user-data-dir
   không. **Kèm một phép thử đáng giá:** trỏ `userDataDir` vào thư mục profile
   cũ xem session TikTok còn không — cookie Chromium trên Windows mã hoá bằng
   DPAPI gắn với tài khoản máy chứ không gắn với bản build, nên có khả năng
   không phải đăng nhập lại.
2. **Một profile** — timezone có khớp nước proxy không; hai profile có GPU,
   screen và canvas hash khác nhau không. Đo trên `browserleaks.com/webgl`,
   `webgpureport.org`, creepjs.
3. **Bốn profile song song** off-screen — so tốc độ upload với hiện tại.

## Việc độc lập

Nếu vì lý do nào đó không chuyển engine, thì bug timezone ở
`BrowserLauncher.ts:34` vẫn phải vá riêng: map `proxy_country_code` sang IANA
timezone và truyền `--timezone` khi `fingerprint.timezone === 'auto'`.
