# Cải thiện chất lượng tìm kiếm kênh (tab Search Kênh)

Ngày: 2026-07-30
Nhánh: `feature/channel-search-tab`
Trạng thái: chờ duyệt

## 1. Vấn đề

Chọn quốc gia Hàn Quốc nhưng kết quả lẫn nhiều kênh không liên quan. Bản vá `00cbb0c`
siết bộ lọc country thành so khớp chặt, hết kênh tạp nhưng đổi lại vứt nhầm kênh thật.

Đo thực tế cho thấy gốc rễ nằm ở **câu tìm**, không phải bộ lọc.

### 1.1. Từ khóa tiếng Anh trả về cùng một nhóm kênh toàn cầu cho mọi nước

Cùng câu tìm `vlog`, đổi `hl`/`gl` qua 9 vùng (en-US, ko-KR, ja-JP, th-TH, id-ID,
pt-BR, vi-VN, tr-TR, hi-IN):

- Jaccard trung bình giữa các vùng: **0.26**
- 29–50% kết quả mỗi vùng trùng với kết quả en/US
- Các kênh nổi nhất (Bà Tân Vlog, BANGTANTV, Sydney Serena, Viy Cortez) xuất hiện ở
  **cả** tìm kiếm Hàn, Indonesia lẫn Brazil

Lấy 6 kênh đầu mỗi vùng, kéo RSS rồi nhận diện ngôn ngữ: chỉ khoảng **1/6** kênh đúng
ngôn ngữ đích.

### 1.2. Từ khóa bản địa mới là đòn bẩy

| Câu tìm | hl/gl | % tiêu đề đúng ngôn ngữ |
|---|---|---|
| `vlog` | en/US | 0% |
| `vlog` | ko/KR | 35% |
| `브이로그` | en/US | 60% |
| `브이로그` | ko/KR | **100%** |
| `먹방` | ko/KR | **100%** |

`hl`/`gl` giúp một phần. Từ khóa bản địa quyết định.

### 1.3. Ba khiếm khuyết cơ chế trong code hiện tại

| Vị trí | Vấn đề |
|---|---|
| `ChannelSearchService.ts:535` | Nguồn yt-dlp (**0 quota**) bị chặn `Math.min(limit, 100)` video, trong khi nguồn `search.list` (100 unit/trang) được thả tới 10 trang. Bóp đúng nguồn miễn phí. |
| `ChannelSearchService.ts:558` | `applyBasicFilters` chạy **sau** khi đã tiêu hết quota `search.list`. Lọc diễn ra quá muộn. |
| `ChannelSearchService.ts:215-218` | `regionCode` của `search.list` lọc theo "video xem được ở nước đó", không phải nước chủ kênh — chính comment trong code đã ghi nhận. Endpoint đắt nhất không phục vụ mục tiêu chính. |

### 1.4. Nguồn miễn phí chưa dùng

Đã kiểm chứng bằng đo đạc:

**RSS** `youtube.com/feeds/videos.xml?channel_id=X` — 36 KB, không key, không quota,
thành công **54/54** kênh thử. Mỗi feed có 15 video gần nhất kèm:

```xml
<published>2024-12-02T13:00:02+00:00</published>
<media:statistics views="11538"/>
<media:starRating count="735" average="5.00"/>
```

→ ngày đăng, lượt xem, **lượt thích**, tiêu đề, videoId, thumbnail, mô tả.

**InnerTube / HTML trang kênh** — `country`, `joinedDateText`, `videoCountText`,
tổng lượt xem kênh. Ví dụ đo được: `HYBELABELS → South Korea, Joined Jun 4 2008,
47.403.203.640 views, 3.431 videos`.

## 2. Mục tiêu

1. Kết quả tìm đúng ngôn ngữ đích, cho **mọi** ngôn ngữ — không nhúng từ điển cứng.
2. Không còn vứt nhầm kênh chỉ vì chủ kênh không khai `country`.
3. Toàn bộ khâu khám phá và lọc chạy ở **0 quota**. API chỉ gọi cho nhóm đã sống sót.
4. Tách `ChannelSearchService.ts` (582 dòng, đang ôm mọi việc) thành các module có
   ranh giới rõ.

### Ngoài phạm vi

- Không đổi luồng check TikTok, lưu candidate, hay bảng `cs_*`.
- Không đụng các tab khác.
- Không thêm dịch vụ dịch thuật hay phụ thuộc mạng ngoài YouTube.
- Không thêm thiết lập mới nào cho người dùng.

`search.list` **rời khỏi đường chạy mặc định**. Không thêm công tắc bật/tắt (sẽ phình
phạm vi); hàm giữ nguyên trong code và chỉ được gọi khi GĐ1 trả về rỗng — tức khi
yt-dlp hỏng hoàn toàn. Đây là đường lùi, không phải nguồn bồi.

## 3. Nguyên tắc

**Ngôn ngữ là bộ lọc bắt buộc, quốc gia là điểm cộng.** Đây là quyết định đã chốt.
Kênh `@akapinnkorean` (24K subs, nội dung tiếng Hàn thuần) **không khai country** —
lọc chặt theo country sẽ loại nó, lọc theo ngôn ngữ thì giữ.

**Rẻ trước, đắt sau.** Mỗi giai đoạn chỉ nhận đầu vào đã qua giai đoạn rẻ hơn.

## 4. Kiến trúc

Bốn giai đoạn, xếp theo giá tăng dần:

```
GĐ1  KHÁM PHÁ            0 quota    yt-dlp / InnerTube flat search
     └─ câu tìm × lát ngày × hl/gl  →  tập channelId
                    ↓
GĐ2  XÁC MINH NGÔN NGỮ   0 quota    RSS 1 request/kênh
     └─ 15 tiêu đề → nhận diện ngôn ngữ → giữ kênh khớp
        đồng thời thu: ngày đăng, lượt xem, lượt thích
                    ↓
GĐ3  MỞ RỘNG TỪ KHÓA     0 quota    (giai đoạn 2 của kế hoạch)
     └─ trích n-gram từ tiêu đề nhóm đã xác minh → từ khóa bản địa → quay lại GĐ1
                    ↓
GĐ4  LÀM GIÀU + XẾP HẠNG  có quota   channels.list 1 unit/50 kênh
     └─ country, ytCreatedAt, videoCount, topics → chấm điểm → chỉ TOP_DEEP kênh
        đầu bảng mới gọi videos.list + commentThreads (~2 unit/kênh)
```

Điểm mấu chốt: GĐ1–3 **không tiêu unit nào**. Quota chỉ chi cho kênh đã chứng minh
đúng ngôn ngữ.

### 4.1. Hằng số

Đặt cạnh nhau trong `search/config.ts` để chỉnh một chỗ:

| Hằng | Giá trị | Căn cứ |
|---|---|---|
| `DISCOVER_TARGET` | 1.500 video | Đo được ~610 video/câu tìm là trần; 4 lát ngày cho 1.647 video khác nhau. |
| `DATE_SLICES` | 4 | Cùng phép đo: 1 lát → 646, 4 lát → 1.647. |
| `DISCOVER_CONCURRENCY` | 3 | Bằng số luồng `ytDlpSearch` hiện dùng (`ChannelSearchService.ts:477`). |
| `FEED_CONCURRENCY` | 6 | RSS là GET tĩnh 36 KB. Chưa đo ở mức vài trăm request — xem mục 10. |
| `FEED_MIN_TITLES` | 8 | Dưới ngưỡng này franc quá nhiễu. |
| `TOP_DEEP` | 60 | Trần cứng cho `fetchDeep`. 60 × ~2 unit = 120 unit/lượt tìm, tức ~80 lượt/ngày. Hiện **không có trần** (`ChannelSearchService.ts:563`). |

## 5. Thành phần

Tạo thư mục `src/main/services/search/`. `ChannelSearchService.ts` còn lại vai trò
điều phối.

| Module | Trách nhiệm | Vào → Ra |
|---|---|---|
| `discover.ts` | Flat search qua yt-dlp, chia lát ngày, đặt hl/gl | `{queries[], hl, gl, slices, limit}` → `Map<channelId, {name, handle}>` |
| `feed.ts` | Tải + phân tích RSS | `channelId` → `{titles[], publishedAt[], views[], likes[]}` hoặc `null` |
| `lang.ts` | Nhận diện ngôn ngữ | `titles[]` → `{lang, confident}` |
| `expand.ts` | Trích từ khóa bản địa (GĐ3) | `titles[][]` → `string[]` |
| `enrich.ts` | Gọi API theo lô, đếm quota | `channelIds[]` → `CsSearchResult[]` |
| `score.ts` | Chấm điểm và xếp hạng | `results[], params` → `results[]` đã sắp |

Mỗi module là hàm thuần trừ `discover`/`feed`/`enrich` (có I/O). Không module nào
biết về `ChannelSearchStore` trừ `enrich` (để cộng quota).

### 5.1. Nhận diện ngôn ngữ — thiết kế theo dữ liệu đo được

franc **không** đáng tin trên một tiêu đề lẻ (mốc tiếng Anh chỉ nhận đúng 25%), nhưng
đáng tin trên văn bản dài. Vì vậy:

1. **Ưu tiên chữ viết.** Hangul, Thái, Nhật, Devanagari, Kirin, Ả Rập nhận bằng dải
   Unicode — gần như không sai. Ngôn ngữ nào có chữ viết riêng thì dừng ở bước này.
2. **franc chỉ dùng cho chữ Latin**, và chạy trên **15 tiêu đề đã ghép**, không phải
   từng tiêu đề.
3. **Gộp họ ngôn ngữ gần nhau.** Đo được: franc trả `sun` (Sundanese) cho câu tiếng
   Indonesia sạch, và `zlm` (Mã Lai) cho kênh Indonesia thật. Coi `ind`/`zlm`/`sun`
   là một nhóm. Tương tự các cặp dễ nhầm khác.
4. Ngưỡng: kênh phải có ≥ `FEED_MIN_TITLES` tiêu đề mới kết luận; ít hơn thì đánh dấu
   `langConfident=false` và đẩy xuống cuối bảng thay vì loại.

Đây là điểm rủi ro cao nhất của thiết kế — xem mục 10.

### 5.2. Xếp hạng

Thứ tự do `score.ts` quyết định, không phải bộ lọc cứng:

| Hạng | Điều kiện |
|---|---|
| ★★ | ngôn ngữ khớp + `country` khớp |
| ★ | ngôn ngữ khớp + `country` trống |
| — | ngôn ngữ khớp + `country` khác (giữ, xếp cuối) |
| loại | ngôn ngữ không khớp |

`country` khác nước chọn vẫn **giữ lại** chứ không loại — kênh Hàn đăng ký ở Mỹ vẫn
là kênh nội dung Hàn.

## 6. Thay đổi kiểu dữ liệu

`CsSearchParams` (`src/shared/types.ts:350`):

```ts
  /** Ngôn ngữ NỘI DUNG, nhận từ tiêu đề video. Bộ lọc chính. null = mọi ngôn ngữ. */
  contentLang: string | null
  /** Quốc gia giờ là ĐIỂM CỘNG khi xếp hạng, không còn loại bỏ. */
  country: string | null
```

Phân biệt rõ với `audienceLangs` sẵn có — trường đó suy từ **comment**, tốn quota, và
đo người xem chứ không đo nội dung. Hai thứ khác nhau, giữ cả hai.

`CsSearchResult` thêm hai trường phục vụ hiển thị hạng:

```ts
  detectedLang: string | null   // ISO 639-3, suy từ tiêu đề
  langConfident: boolean        // false = dưới FEED_MIN_TITLES tiêu đề
```

### 6.1. Định dạng mã ngôn ngữ

Có xung đột phải giải: franc trả **ISO 639-3** (3 chữ: `kor`, `vie`, `ind`), còn
`audienceLang` sẵn có ghi rõ là "mã 2 chữ" (`src/shared/types.ts:378`).

Quy ước: **nội bộ dùng 639-3**, vì đó là thứ franc sinh ra và là thứ đủ phân giải để
gộp họ ngôn ngữ (`ind`/`zlm`/`sun`). `lang.ts` giữ bảng ánh xạ 639-1 ↔ 639-3 cho
khoảng 20 ngôn ngữ dự án quan tâm, dùng ở hai chỗ:

- đổi lựa chọn của người dùng (2 chữ, khớp danh sách nước/ngôn ngữ hiện có) sang 639-3
- sinh `hl` cho GĐ1, vì YouTube nhận mã 2 chữ

`audienceLang` giữ nguyên 2 chữ, không đụng tới.

## 7. Thay đổi UI

- Thêm ô chọn **Ngôn ngữ nội dung** vào panel lọc.
- Cột/nhãn hạng ★★ / ★ để phân biệt kênh có khai country với kênh không khai.
- Nhãn quốc gia đổi từ "Lọc" sang "Ưu tiên" cho khớp hành vi mới.

Ô chọn ngôn ngữ **phải tự code theo theme**, không dùng `<select>` mặc định của
trình duyệt — theo quy ước đã có của dự án.

## 8. Ngân sách quota

| | Hiện tại | Sau thay đổi |
|---|---|---|
| Khám phá | tới 1.000 unit (10 trang `search.list`) | **0** |
| Lọc | 0 (nhưng chạy sau khi đã tiêu) | **0** |
| Chỉ số cơ bản | 1 unit/50 kênh | 1 unit/50 kênh, chỉ cho kênh đã lọc |
| Chỉ số sâu | ~2 unit/kênh, **không giới hạn số kênh** | ~2 unit/kênh, trần `TOP_DEEP` |

Ví dụ một lượt tìm: 1.500 video khám phá → ~700 kênh khác nhau → sau lọc ngôn ngữ còn
~250 → `channels.list` tốn 5 unit → `fetchDeep` cho 60 kênh đầu bảng tốn ~120 unit.
**Tổng ~125 unit**, so với tối đa ~1.000 unit chỉ riêng khâu khám phá hiện nay.

## 9. Xử lý lỗi

- RSS lỗi/timeout một kênh → bỏ kênh khỏi vòng xác minh, ghi log, **không** phá cả
  lượt tìm. Đo được 54/54 thành công nên đây là đường hiếm.
- yt-dlp lỗi một lát ngày → bỏ lát đó, giữ các lát khác.
- Không có API key → GĐ1–3 vẫn chạy đầy đủ. Đây là cải thiện lớn cho nhánh fallback:
  hiện tại `ytDlpSearch` chỉ lọc được `subs` + `shortsCount`, sau thay đổi sẽ lọc được
  cả ngôn ngữ và 7 chỉ số từ RSS.
- Mọi lỗi mạng phải phân biệt được với "không có kết quả" trong log gửi lên UI.

## 10. Rủi ro

**Nhận diện ngôn ngữ chữ Latin.** Đây là chỗ yếu nhất. Indonesia/Mã Lai, Bồ Đào Nha/
Tây Ban Nha, các ngôn ngữ Bắc Âu rất dễ lẫn. Chữ viết riêng (Hàn, Nhật, Thái, Ả Rập)
thì gần như chắc chắn đúng. **Cần đo tỷ lệ đúng trên tập mẫu có nhãn trước khi bật
mặc định cho ngôn ngữ chữ Latin.**

**GĐ3 phụ thuộc chất lượng GĐ1.** Nếu vòng 1 không tìm được kênh đúng ngôn ngữ nào thì
không có gì để trích từ khóa. Cần đường lùi: vòng 1 trắng tay → báo người dùng nhập từ
khóa bản địa thủ công.

**Tần suất khai `country`.** Chưa đo tỷ lệ kênh có khai country. Không chặn thiết kế
này (country đã hạ xuống làm điểm cộng) nhưng ảnh hưởng độ hữu ích của hạng ★★.

**Nhịp gọi RSS.** Mới thử 54 request; chưa thử vài trăm liên tiếp. `FEED_CONCURRENCY`
đặt 6 là phỏng đoán, chưa có số đo. Việc đầu tiên của giai đoạn 1 là đo nhịp an toàn
trên ~300 kênh và chỉnh lại hằng này. Nếu bị chặn nhịp, đường lùi là giảm luồng và
thêm nghỉ giữa các lô — không phải bỏ RSS, vì không nguồn miễn phí nào thay được.

## 11. Kiểm thử

**Hàm thuần** (không mạng) — chạy trên fixture tiêu đề có nhãn:
- `lang.ts`: tỷ lệ đúng theo từng chữ viết; khẳng định nhóm `ind`/`zlm`/`sun` gộp đúng
- `expand.ts`: trích n-gram từ tập tiêu đề dựng sẵn
- `feed.ts`: phân tích XML RSS mẫu, gồm cả feed hỏng và feed rỗng

**Tích hợp** (có mạng, 0 quota) — một lượt khám phá thật với câu tìm cố định, khẳng
định tỷ lệ đúng ngôn ngữ vượt ngưỡng.

**Chốt chặn quota** — khẳng định `quota.used` **vẫn bằng 0** sau GĐ1–3. Đây là bất
biến quan trọng nhất; phải có assert tự động, không kiểm bằng mắt.

**UI** — dùng bộ driver Playwright sẵn có (`driver-search.mjs`) trên userData cô lập.
Vẫn giữ quy tắc: không bấm "Tìm kiếm" với API key thật.

## 12. Kế hoạch hai giai đoạn

**Giai đoạn 1** — tách module, GĐ1/GĐ2/GĐ4, hạ country xuống điểm cộng, bỏ trần 100
video, thêm trần cho `fetchDeep`, UI chọn ngôn ngữ. Tự nó đã dùng được và kiểm chứng
được ngay.

**Giai đoạn 2** — thêm GĐ3 mở rộng từ khóa. Chỉ làm sau khi giai đoạn 1 đo được tỷ lệ
đúng ngôn ngữ thực tế, vì GĐ3 chỉ có nghĩa nếu GĐ1 đủ tốt để cho mồi.
