# Design: Tab "Search Kênh" — tìm & lọc kênh YouTube + check trùng TikTok

**Ngày:** 2026-07-28
**Trạng thái:** Đã duyệt design, chờ implementation plan

## 1. Mục tiêu

Thêm tab mới vào HienNVAuto giúp:

1. **Tìm kênh YouTube nguồn** theo nhiều tiêu chí (niche, quy mô, chất lượng view, khán giả) để chọn kênh reup.
2. **Check trùng trên TikTok**: với mỗi kênh ứng viên, xem (a) chủ kênh có TikTok riêng không, (b) đã có ai reup nội dung kênh đó chưa. App chỉ **hiển thị các account TikTok giống nhất** — người dùng tự nhìn và kết luận.
3. **Quản lý danh sách ứng viên** với trạng thái, tích hợp 1-click sang tab Get Video.

**Ngoài phạm vi:** check trùng ở mức từng video (đã có trong template upload — `checkCopyright`/`checkContent`); tự động kết luận trùng/không; batch check qua QueueManager (có thể nâng cấp sau).

## 2. Tiêu chí lọc kênh

| Nhóm | Tiêu chí | Nguồn (API) | Fallback yt-dlp |
|---|---|---|---|
| Cơ bản | Keyword/chủ đề | `search.list` | `ytsearch50:` |
| Cơ bản | Khoảng subscriber (min–max) | `channels.list` statistics | Có (nếu đọc được) |
| Cơ bản | Quốc gia kênh | `channels.list` snippet.country | — |
| Cơ bản | Tuổi kênh (ngày tạo) | `channels.list` snippet.publishedAt | — |
| Cơ bản | Chủ đề YouTube chính thức | `channels.list` topicDetails | — |
| Hoạt động | Tần suất đăng (video/tuần) | `playlistItems.list` 20 video gần nhất | — |
| Hoạt động | Ngày đăng gần nhất trong X ngày | như trên | — |
| Hoạt động | Số lượng Shorts (min) | `videos.list` duration | Đếm tab Shorts (~20 đầu) |
| Hoạt động | Thời lượng video ≤ max | `videos.list` contentDetails | — |
| Chất lượng view | View trung bình/video (min) | `videos.list` statistics | — |
| Chất lượng view | Like/view % (min) | như trên | — |
| Chất lượng view | Comment/view % (min) | như trên | — |
| Chất lượng view | View/sub ratio (min) | tính từ 2 nguồn trên | — |
| Chất lượng view | Momentum: view TB 5 video mới vs 15 video trước (%) | tính | — |
| Chất lượng view | Độ ổn định view: median/mean (0–1) | tính | — |
| Chất lượng view | Tỉ lệ Shorts thuần (%) trong 20 video gần nhất (Short = duration ≤ 180s) | tính | — |
| Khán giả | Ngôn ngữ khán giả (phân bố % từ ~50 comment + tiêu đề) | `commentThreads.list` + franc-min | — |

Ghi chú giới hạn: **địa lý/demographics khán giả thật** là dữ liệu riêng của chủ kênh (Analytics API) — không lấy được; ngôn ngữ comment + quốc gia kênh là proxy. Cột thiếu dữ liệu = NULL, UI hiện "—".

## 3. UI

Tab `search` ("🔍 Search Kênh") trong Sidebar, sau Get Video. Hai khu vực:

### 3.1 Khu "Tìm kiếm"
- Ô keyword + nút **Tìm** + nút ⚙️ Cài đặt.
- Panel filter (collapse được) với toàn bộ tiêu chí mục 2.
- Bảng kết quả: avatar, tên, @handle, sub, tổng video, view TB, like/view %, momentum, ổn định, %Shorts, đăng gần nhất, quốc gia, ngôn ngữ khán giả, ngày tạo. Mỗi dòng: nút **➕ Lưu ứng viên**.
- Không có API key → banner "Thêm API key để lọc đầy đủ", filter chỉ còn keyword/sub/số Shorts.

### 3.2 Khu "Ứng viên"
- Bảng ứng viên đã lưu: thông tin kênh + badge trạng thái + tóm tắt TikTok ("3 account giống · check 2 giờ trước") + expand xem chi tiết matches (avatar, username, nickname, follower, số video, link mở ngoài).
- Trạng thái: `new` 🆕 Chưa check · `good` ✅ Đáng làm · `own_tiktok` 🎭 Có TikTok riêng · `reupped` ♻️ Đã có người reup · `skip` ⏭️ Bỏ qua · `in_use` ▶️ Đang dùng.
- Hành động/dòng: **Check TikTok**, dropdown đổi trạng thái, **Thêm vào Get Video** (gọi `getvideo.addChannel(url)` + set `in_use`), **Xóa**.
- Nút **Check tất cả**: tuần tự các ứng viên chưa check, delay ngẫu nhiên 3–6s, dừng khi 3 lỗi liên tiếp. Log tiến trình hiện dòng dưới (giống tab Get Video).

### 3.3 Cài đặt (dialog trong tab)
- `csApiKey`: YouTube Data API v3 key ('' = dùng fallback yt-dlp).
- `csCheckProfileId`: profile antidetect dùng để search TikTok (bắt buộc đã login).
- `csTopN`: số account TikTok lấy mỗi lần check (mặc định 5).

## 4. Kiến trúc

### 4.1 File mới
| File | Vai trò |
|---|---|
| `src/main/services/ChannelSearchService.ts` | Search YouTube: Data API v3 (fetch) + fallback yt-dlp |
| `src/main/services/TikTokSearch.ts` | Check TikTok qua profile: pattern TikTokSync (spawn engine off-screen + `buildArgs` + CDP/puppeteer) |
| `src/main/services/ChannelSearchStore.ts` | SQLite: candidates, tiktok matches, settings |
| `src/renderer/src/features/search/SearchTab.tsx` | UI tab |

Dependency mới: `franc-min` (detect ngôn ngữ, nhẹ, không phụ thuộc).

### 4.2 DB (thêm vào `db.ts`)
```sql
cs_candidates (
  id TEXT PK, ytChannelId TEXT UNIQUE, url TEXT, name TEXT, handle TEXT,
  thumbnail TEXT, subs INTEGER NULL, videoCount INTEGER NULL,
  avgViews REAL NULL, lastUploadAt INTEGER NULL, uploadsPerWeek REAL NULL,
  country TEXT NULL, ytCreatedAt INTEGER NULL,
  likeViewPct REAL NULL, commentViewPct REAL NULL, viewSubRatio REAL NULL,
  momentumPct REAL NULL, viewConsistency REAL NULL, shortsPct REAL NULL,
  shortsCount INTEGER NULL,    -- API: ước tính videoCount×shortsPct; yt-dlp: đếm chính xác tab Shorts
  topics TEXT NULL,            -- JSON ["Gaming","Pets"]
  audienceLangs TEXT NULL,     -- JSON [{"lang":"en","pct":70},...]
  status TEXT DEFAULT 'new', tiktokCheckedAt INTEGER NULL, createdAt INTEGER
)
cs_tiktok_matches (
  id TEXT PK, candidateId TEXT REFERENCES cs_candidates ON DELETE CASCADE,
  username TEXT, nickname TEXT, followers INTEGER NULL, videoCount INTEGER NULL,
  avatarUrl TEXT, fetchedAt INTEGER
)
```
Settings lưu ở bảng 1 dòng `cs_settings` (id=1, cùng pattern `gv_settings`): `api_key`, `check_profile_id`, `top_n`.

### 4.3 IPC (`shared/types.ts`, `preload/index.ts`, `main/ipc.ts`)
```ts
window.hnv.channelSearch = {
  search(params: CsSearchParams): Promise<CsSearchResult[]>
  listCandidates(): Promise<CsCandidate[]>
  addCandidate(r: CsSearchResult): Promise<{ candidate: CsCandidate; existed: boolean }>
  removeCandidate(id: string): Promise<void>
  setStatus(id: string, status: CsStatus): Promise<void>
  checkTiktok(id: string): Promise<CsTiktokMatch[]>
  getSettings(): Promise<CsSettings>
  saveSettings(s: CsSettings): Promise<CsSettings>
}
// + event onChannelSearchLog(line: string)
```
"Check tất cả" là vòng lặp tuần tự ở renderer gọi `checkTiktok` từng kênh — không cần queue ở main.

## 5. Flow chi tiết

### 5.1 Search YouTube (có API key) — fetch theo tầng tiết kiệm quota
1. `search.list` type=channel, q=keyword, maxResults=50 — **100 unit**.
2. `channels.list` part=snippet,statistics,topicDetails,contentDetails (1 call batch 50 id — **1 unit**) → sub, tổng video, quốc gia, ngày tạo, topics, uploads playlist.
3. **Lọc sơ bộ ngay** (sub, tuổi kênh, quốc gia, chủ đề). Chỉ kênh qua vòng này fetch tiếp:
4. `playlistItems.list` uploads, 20 video (**1 unit/kênh**) → tần suất, ngày đăng cuối.
5. `videos.list` batch 20 id (**1 unit/kênh**) → duration, views, likes, comments → view TB, like/view, comment/view, %Shorts, momentum, viewConsistency, lọc thời lượng.
6. `commentThreads.list` allThreadsRelatedToChannelId, 50 comment (**1 unit/kênh**) → franc-min → audienceLangs. Kênh tắt comment → NULL.
7. Áp nốt filter còn lại, trả kết quả.

Quota: 100 + ~3–4 unit/kênh sâu → 1 lần search đầy đủ ≈ 200 unit → ~50 lần/ngày với quota miễn phí 10.000.

### 5.2 Fallback yt-dlp (không có key)
- `ytsearch50:<keyword>` `--flat-playlist --print "%(channel_id)s\t%(channel)s\t..."` → gom video theo kênh.
- Mỗi kênh: đọc tab Shorts flat-playlist (`--playlist-end 20`) → tên, handle, `channel_follower_count` (nếu có), số Shorts.
- Tái dùng setting `cookieBrowser` của Get Video (`GvSettings`) để né bot-check; nghỉ `--sleep-requests 1` như `GetVideoService`.
- Tiêu chí áp dụng được: keyword, sub, số Shorts. Còn lại NULL.

### 5.3 Check TikTok (pattern `TikTokSync.ts`)
1. Validate: `csCheckProfileId` tồn tại, `loggedIn=true`, `status='idle'` — sai thì trả lỗi rõ ràng.
2. Spawn fingerprint-chromium off-screen (`buildArgs(profile)` + `--remote-debugging-port=0` + `--window-position=-32000,-32000`), `ensureRelay` nếu có proxy, connect CDP qua `waitForWsEndpoint`.
3. Mở `https://www.tiktok.com/search/user?q=<tên kênh>` → poll tới 20s đọc kết quả user từ DOM/state nhúng (`__UNIVERSAL_DATA_FOR_REHYDRATION__`/SIGI) → username, nickname, follower, avatar. Lấy top `csTopN`.
4. Nếu handle khác tên → search lần 2 bằng handle (bỏ ký tự đặc biệt), gộp + dedupe theo username.
5. Transaction: xóa match cũ của candidate → insert mới → set `tiktokCheckedAt`. Emit log + update event.
6. Đóng browser; kill child nếu không thoát sau 6s (đúng pattern TikTokSync).

## 6. Xử lý lỗi

| Tình huống | Hành vi |
|---|---|
| API key sai / hết quota | Toast message lỗi từ Google (400/403) + gợi ý chạy fallback yt-dlp |
| Không có API key | Tự chạy fallback + banner nhắc thêm key |
| yt-dlp dính bot-check | Báo như Get Video: gợi ý bật cookie browser (đóng browser đó khi chạy) |
| Profile check chưa cấu hình / chưa login / đang chạy | Toast lỗi cụ thể từng trường hợp, không spawn |
| TikTok captcha / không parse được kết quả | Lỗi "TikTok chặn — mở profile thủ công giải captcha rồi thử lại"; không tự retry |
| Check tất cả lỗi 3 lần liên tiếp | Dừng vòng lặp, log lý do |
| Kênh đã có trong ứng viên (UNIQUE ytChannelId) | `addCandidate` trả bản ghi cũ, toast "đã có trong danh sách" |
| Xóa candidate | CASCADE xóa matches |

## 7. Kiểm thử (thủ công — repo chưa có test framework)

1. Search với API key hợp lệ: đủ cột, filter hoạt động từng tiêu chí.
2. Search không key: fallback chạy, cột thiếu hiện "—", banner hiện.
3. Search key sai: hiện lỗi Google, không crash.
4. Lưu ứng viên, lưu trùng, xóa, đổi trạng thái — restart app còn nguyên.
5. Check TikTok: profile login → có matches; profile chưa login → lỗi đúng; profile đang chạy → lỗi đúng; captcha → lỗi đúng.
6. Check tất cả: chạy tuần tự, delay, dừng sau 3 lỗi.
7. Thêm vào Get Video: kênh xuất hiện ở tab Get Video, trạng thái → Đang dùng.
8. Kênh tắt comment: ngôn ngữ khán giả "—", không lỗi.

## 8. Quyết định đã chốt (log)

- Mục đích: tìm kênh nguồn + check chủ kênh có TikTok riêng / đã có ai reup. KHÔNG check mức video.
- App không tự kết luận trùng — hiển thị matches để user tự đánh giá và chốt trạng thái.
- YouTube: hybrid API key (đầy đủ) / yt-dlp (rút gọn).
- TikTok: qua profile antidetect đã login, check on-demand từng kênh + "Check tất cả" tuần tự (không dùng QueueManager).
- Lưu ứng viên + 6 trạng thái + 1-click sang Get Video.
