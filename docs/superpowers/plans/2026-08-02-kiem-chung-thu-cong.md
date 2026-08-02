# Kiểm chứng thủ công sau khi đổi engine ShardX

Tài liệu này gộp toàn bộ các bước cần **bấm tay** mà 9 task tích hợp ShardX để lại rải rác trong các báo cáo (`task-5-report.md`, `task-6-report.md`, `task-8-report.md`, `task-9-report.md`) cộng với phần kiểm chứng gốc của Task 10, sắp lại theo đúng **thứ tự thực hiện** — không theo thứ tự task. Dành cho người dùng cuối, không cần biết lập trình.

Không ai làm thay được phần này: cần người ngồi trước màn hình, cần proxy nước ngoài thật, cần tài khoản TikTok thật — và tuyệt đối không được tự ý đăng bài lên TikTok.

**Cách đọc:** làm từ trên xuống, đúng thứ tự — bước sau thường cần bước trước đã đạt. Mỗi mục có 3 phần: **Làm** (bấm ở đâu), **Kỳ vọng** (phải thấy gì), **Nếu KHÔNG đúng** (nghĩa là gì).

- 🔴 **CHẶN** — không đạt thì tính năng đó (hoặc cả tool) không dùng được, dừng lại xử lý trước khi đi tiếp.
- 🟡 **Xác nhận thêm** — nên kiểm cho yên tâm, nhưng không đạt vẫn dùng tool được ở mức chấp nhận.
- 🔧 **BẮT BUỘC** — không phải kết quả đo, mà là thao tác phải làm (sao lưu…).

---

## Giai đoạn 0 — Sao lưu dữ liệu trước khi làm bất cứ gì khác

DB thật hiện có **109 profile**. Mọi bước bên dưới đều động vào dữ liệu này (mở/đóng trình duyệt, đổi cấu hình, đăng nhập lại...).

**1. 🔧 Sao lưu toàn bộ dữ liệu bằng `backup-data.bat`**
- **Làm:** Đóng hẳn app HienNVAuto (kiểm Task Manager không còn `HienNVAuto.exe`). Chạy file `backup-data.bat` (thư mục cài app).
- **Kỳ vọng:** Dòng cuối hiện `[OK] Da sao luu xong vao: %APPDATA%\HienNVAuto\backup_data`.
- **Nếu KHÔNG đúng:** Hiện `[!] Sao luu that bai` — thường vì app chưa đóng hẳn. Đóng hẳn rồi chạy lại. Nếu vẫn lỗi, **đừng làm tiếp** — 109 profile chưa được bảo vệ.

> **Ghi nhớ:** chủ dự án đã chốt bỏ toàn bộ phiên đăng nhập TikTok cũ khi đổi engine (không tái dùng thư mục dữ liệu cũ). Nghĩa là **cả 109 profile sẽ hiện "chưa đăng nhập"** khi mở lần đầu bằng engine mới, kể cả những profile trước đây đã đăng nhập. Đây là chuyện đã biết trước, không phải lỗi phát sinh — Giai đoạn 4 bên dưới sẽ cần đăng nhập lại từng profile.

---

## Giai đoạn 1 — Mở app, mở/đóng một profile

Nền tảng cho mọi thứ phía sau. Nếu giai đoạn này không đạt, không cần thử các giai đoạn sau.

**2. 🔴 Chạy app**
- **Làm:** Mở terminal tại thư mục project, chạy `npm run dev`.
- **Kỳ vọng:** Cửa sổ app hiện lên, terminal không có dòng lỗi đỏ.
- **Nếu KHÔNG đúng:** App không mở hoặc terminal báo lỗi đỏ — dừng lại, chụp lỗi, báo lại.

**3. 🔴 Mở một profile**
- **Làm:** Tab **Profile** → chọn 1 profile có sẵn → bấm **▶ Run**.
- **Kỳ vọng:** Một cửa sổ Chrome hiện lên, chiếm toàn màn hình; cột trạng thái đổi thành **● Đang chạy**. (Lần đầu trên máy có thể chờ lâu hơn — app đang tải engine ~500MB nếu chưa có sẵn.)
- **Nếu KHÔNG đúng:** Không có cửa sổ nào hiện ra, hoặc trạng thái không đổi — dừng lại, không gì phía sau hoạt động được nếu bước này fail.

**4. 🔴 Bấm Run lần hai trên cùng profile đang mở**
- **Làm:** Trong khi cửa sổ ở mục 3 còn mở, quay lại app, bấm **▶ Run** lần nữa trên **đúng profile đó**.
- **Kỳ vọng:** Hiện toast lỗi "Profile đang mở". **Không** có cửa sổ Chrome thứ hai nào mở thêm.
- **Nếu KHÔNG đúng:** Nếu một cửa sổ thứ hai thật sự mở ra cho cùng profile — dừng ngay, đừng dùng tiếp. Hai cửa sổ chung một thư mục dữ liệu có thể làm hỏng cookie/đăng nhập của profile đó.

**5. 🔴 Đóng cửa sổ bằng tay**
- **Làm:** Bấm dấu ✕ trên cửa sổ Chrome (không bấm gì trong app).
- **Kỳ vọng:** Quay lại app, trạng thái tự đổi về **○ Idle** — không cần bấm thêm gì.
- **Nếu KHÔNG đúng:** Trạng thái vẫn "Đang chạy" dù cửa sổ đã đóng hẳn — profile bị kẹt, chỉ khởi động lại app mới hết. Ghi lại profile nào bị kẹt.

**6. 🔴 Mở lại rồi Dừng bằng nút trong app**
- **Làm:** Bấm **▶ Run** lại, đợi cửa sổ hiện lên, rồi bấm **■ Dừng** trong app (không tự đóng cửa sổ).
- **Kỳ vọng:** Cửa sổ tự đóng, trạng thái về **○ Idle** — giống hệt mục 5.
- **Nếu KHÔNG đúng:** Tương tự mục 5 — ghi lại, tránh dùng nút Dừng cho tới khi được xử lý.

**7. 🔴 Mở hai profile khác nhau cùng lúc**
- **Làm:** Bấm **▶ Run** trên profile A, rồi ngay sau đó bấm **▶ Run** trên profile B (khác A).
- **Kỳ vọng:** Cả hai đều mở bình thường — điều kiện chặn ở mục 4 chỉ áp dụng khi bấm 2 lần **cùng một** profile.
- **Nếu KHÔNG đúng:** Một trong hai bị báo "Profile đang mở" dù là 2 profile khác nhau — lỗi chặn nhầm, dừng lại báo — app gần như không dùng được cho nhiều profile nếu vậy.

---

## Giai đoạn 2 — Đo dấu vân tay trình duyệt (fingerprint) thật

Mục đích chính của việc đổi engine: mỗi profile phải trông như một máy khác nhau thật sự, IP/múi giờ phải khớp proxy được gán. Đo **trước khi** dùng tài khoản TikTok thật (Giai đoạn 4) — nếu fingerprint bị lộ mà vẫn đăng nhập tài khoản thật qua đó thì rủi ro cao hơn.

**Chuẩn bị:** tạo 2 profile chỉ để test (tab Profile → **+ Profile mới**, đặt tên dễ nhận, ví dụ `test-fp-1`, `test-fp-2`). Không cần gán proxy/tài khoản TikTok cho `test-fp-1`. Cần sẵn 1 proxy nước ngoài thật (host/port/user/pass) cho mục 9.

**8. 🔴 So sánh GPU và canvas giữa hai profile**
- **Làm:** Mở `test-fp-1`, trong cửa sổ Chrome vào `https://browserleaks.com/webgl`, ghi lại **WebGL Renderer** và **Canvas Hash** (nếu trang không hiện Canvas Hash, tìm mục Canvas riêng trên cùng site browserleaks). Vào thêm `https://webgpureport.org`, ghi lại **Adapter**. Đóng cửa sổ, lặp lại y hệt với `test-fp-2`.
- **Kỳ vọng:** WebGL Renderer khác nhau giữa 2 profile, Canvas Hash khác nhau, độ phân giải màn hình (Screen Resolution) khác nhau, WebGPU Adapter khác nhau.
- **Nếu KHÔNG đúng:** Nếu hai profile ra **cùng** GPU/canvas hash — dừng ngay, không dùng tool ở trạng thái này. Đây đúng lỗ hổng nặng nhất từng phát hiện khi làm (Task 8: từng có lỗi khiến GPU ngẫu nhiên bị ghi đè thành rỗng, đã vá — nếu tái hiện nghĩa là bản vá hỏng hoặc bị revert), mọi profile sẽ lộ chung một dấu vân tay.

**9. 🔴 Đo múi giờ qua proxy nước ngoài**
- **Làm:** Tab **Proxy** → **+ Thêm proxy** → nhập proxy nước ngoài thật → Thêm. Bấm **🔗 Gán** ở dòng proxy đó → chọn `test-fp-2` → **Gán**. Mở `test-fp-2` (**▶ Run**), vào `https://browserleaks.com/javascript`, đọc dòng **Time Zone**.
- **Kỳ vọng:** Time Zone khớp nước của proxy (proxy Mỹ → múi giờ kiểu `America/...`), **không phải** `Asia/Ho_Chi_Minh`.
- **Nếu KHÔNG đúng:** Vẫn ra `Asia/Ho_Chi_Minh` dù đã gán proxy nước ngoài — dừng ngay. Mục này **chưa từng được đo** trong toàn bộ quá trình làm, kể cả lúc thử SDK ban đầu (`notes-spike.md` ghi rõ: "geo qua proxy: CHƯA ĐO — cần người chạy tay") — đây là rủi ro cao nhất chưa ai kiểm chứng trước bạn. Nếu sai, vị trí thật của máy có thể lộ cho TikTok.

**10. 🟡 Cột "UDP / QUIC" trong tab Proxy**
- **Làm:** Sau khi đóng `test-fp-2` ở mục 9, quay lại tab **Proxy**, nhìn dòng proxy vừa gán.
- **Kỳ vọng:** Cột **UDP / QUIC** hiện `QUIC <số> ms` (chữ xanh) nếu proxy hỗ trợ UDP, hoặc `TCP <số> ms` (chữ xám) nếu chỉ TCP — không còn là `—`.
- **Nếu KHÔNG đúng:** Vẫn `—` sau khi đã mở/đóng profile qua proxy đó — có thể proxy lỗi kết nối, hoặc việc ghi kết quả đo vào DB bị lỗi. Không chặn dùng (chỉ là ô thông tin phụ), báo lại để kiểm log.

**11. 🟡 Không ghi nhầm sang proxy khác**
- **Làm:** Mở rồi đóng `test-fp-1` (profile KHÔNG gán proxy — IP máy thật).
- **Kỳ vọng:** Quay lại tab Proxy, các dòng proxy khác (không phải dòng vừa gán ở mục 9) **không** bị đổi giá trị UDP/QUIC.
- **Nếu KHÔNG đúng:** Có proxy khác trong pool bị đổi giá trị dù không liên quan — báo lại kèm tên proxy bị ảnh hưởng.

Xong Giai đoạn 2: xoá `test-fp-1`, `test-fp-2` nếu không cần giữ (nút 🗑 Xóa profile trong Cài đặt).

---

## Giai đoạn 3 — Giao diện Cài đặt profile

**12. 🟡 Ô "Thiết bị / GPU" hiện đúng**
- **Làm:** Mở Cài đặt (nút **⚙️**) của 1 profile **đã** Run ít nhất 1 lần (dùng lại profile ở Giai đoạn 1 hoặc 2).
- **Kỳ vọng:** Khối "Fingerprint" → ô **Thiết bị / GPU** hiện tên GPU thật (dạng `ANGLE (NVIDIA, NVIDIA GeForce RTX ... D3D11)`), không phải `—` và không phải một chuỗi mã ngẫu nhiên.
- **Nếu KHÔNG đúng:** Vẫn `—` dù đã Run — bug từng có ở Task 8 (đã vá). Nếu tái hiện, báo lại — chỉ ảnh hưởng hiển thị trong app, **không** ảnh hưởng dấu vân tay thật gửi cho website (đã đo độc lập ở mục 8).

**13. 🟡 Ô "Trình duyệt" và không có lỗi đỏ trong Console**
- **Làm:** Cùng màn hình mục 12, nhìn ô **Trình duyệt**. Mở thêm DevTools (F12) xem tab Console.
- **Kỳ vọng:** Ô Trình duyệt hiện chuỗi User-Agent thật hoặc `—`. Console không có dòng đỏ.
- **Nếu KHÔNG đúng:** Có lỗi đỏ trong Console — ghi lại nội dung, báo lại.

**14. 🟡 Đổi và lưu WebRTC**
- **Làm:** Ô **WebRTC** có 3 lựa chọn: "Tự động — đi qua proxy, giữ QUIC" / "Chỉ TCP" / "Chặn hoàn toàn". Chọn giá trị khác hiện tại, bấm **Lưu**, đóng rồi mở lại đúng Cài đặt profile đó.
- **Kỳ vọng:** Giá trị vừa chọn được giữ nguyên.
- **Nếu KHÔNG đúng:** Giá trị bị reset về mặc định — lựa chọn không lưu được, báo lại.

**15. 🔴 Tạo profile mới**
- **Làm:** Tab Profile → **+ Profile mới** → điền tên → tạo.
- **Kỳ vọng:** Profile mới xuất hiện trong danh sách, không lỗi.
- **Nếu KHÔNG đúng:** Báo lỗi hoặc không tạo được — chức năng lõi (mở rộng số lượng profile), phải xử lý trước khi dùng cho nhiều tài khoản.

---

## Giai đoạn 4 — Tự động hoá TikTok với tài khoản thật

Chỉ chủ dự án tự làm được — cần tài khoản TikTok thật, không ai đăng bài thay. Vì cả 109 profile đã mất phiên đăng nhập cũ (Giai đoạn 0), bước đăng nhập dưới đây **không chỉ là kiểm tra** — đây là lần đăng nhập lại đầu tiên thật sự. Làm với 1 profile trước cho chắc cơ chế đúng, rồi lặp lại cho các profile còn lại.

**16. 🔴 Đăng nhập TikTok — cửa sổ phải hiện trên màn hình**
- **Làm:** Chọn 1 profile đã điền username/password TikTok, bấm nút **🔑** (Đăng nhập TikTok).
- **Kỳ vọng:** Cửa sổ Chrome **phải hiện ra, phóng to, trên màn hình chính** — không mất tích ngoài màn hình. Log hiện tuần tự các bước, dừng lại chờ bạn tự bấm "Đăng nhập" trong cửa sổ thật.
- **Nếu KHÔNG đúng:** Cửa sổ không hiện, hoặc hiện sai vị trí/kích thước — dừng lại, báo ngay. Đây là điểm có sửa riêng để kéo cửa sổ về màn hình; nếu hỏng thì **không đăng nhập được cho bất kỳ profile nào** — chặn hoàn toàn tính năng.

**17. 🔴 Hoàn tất luồng đăng nhập**
- **Làm:** Tự bấm "Đăng nhập" trong cửa sổ thật. Nếu có 2FA và profile có sẵn mã bí mật, tool tự điền 6 số — tự bấm "Tiếp" sau đó. Tự giải CAPTCHA nếu TikTok yêu cầu.
- **Kỳ vọng:** Log cuối hiện "Đăng nhập thành công!".
- **Nếu KHÔNG đúng:** Báo lỗi hoặc treo lâu không phản hồi — ghi lại profile nào, kẹt ở bước nào.

**18. 🟡 Bấm đăng nhập lần hai khi đang chờ**
- **Làm:** Trong lúc cửa sổ đăng nhập ở mục 16-17 còn mở (ví dụ đang chờ giải CAPTCHA), bấm **🔑** lần nữa cho **cùng profile đó**.
- **Kỳ vọng:** Toast hiện "Đang đăng nhập, vui lòng chờ" — không mở cửa sổ đè lên, app không đơ/crash.
- **Nếu KHÔNG đúng:** App treo hoặc mở chồng cửa sổ thứ hai — báo lại.

**19. 🟡 Đồng bộ tên theo TikTok**
- **Làm:** Với profile vừa đăng nhập xong ở mục 17, bấm nút **🔄** (Đồng bộ tên).
- **Kỳ vọng:** **Không** thấy cửa sổ Chrome nào hiện lên (chạy ẩn), sau vài giây tên profile đổi thành đúng @username TikTok hiện tại.
- **Nếu KHÔNG đúng:** Tên không đổi hoặc báo lỗi — không chặn sử dụng (chỉ ảnh hưởng tên hiển thị), báo lại để kiểm.

**20. 🔴 Upload video qua hàng đợi (Queue)**
- **Làm:** Tab **Template** → mở 1 template Upload Video → bấm mở khung **📂 Pending** để mở đúng thư mục trên máy, copy 1 video thật vào đó (Windows Explorer). Quay lại app bấm **▶ Chạy…**, trong hộp thoại chọn đúng profile đã đăng nhập ở mục 17, bấm **▶ Chạy 1 profile**.
- **Kỳ vọng:** Tab Queue hiện log "Khởi động trình duyệt…", **không** thấy cửa sổ Chrome nào bật lên (chạy ẩn), job đi qua các bước rồi chuyển **done**.
- **Nếu KHÔNG đúng:** Job lỗi ngay từ đầu, hoặc treo mãi không qua bước nào — đây là mục đích sử dụng chính của cả tool (up video hàng loạt), phải xử lý trước khi dùng thật.

**21. 🔴 Dọn dẹp sau khi upload xong**
- **Làm:** Sau khi job ở mục 20 xong, mở Task Manager kiểm tra tiến trình `chrome.exe`. Quay lại tab Profile xem trạng thái.
- **Kỳ vọng:** Không còn tiến trình Chrome nào của profile đó sống trong Task Manager. Trạng thái profile là **○ Idle**, không kẹt "Đang chạy".
- **Nếu KHÔNG đúng:** Còn tiến trình mồ côi, hoặc kẹt "Đang chạy" — chạy nhiều job liên tục sẽ tích rác và phải khởi động lại app thường xuyên, không ổn định lâu dài.

**22. 🟡 Upload cho profile đang mở tay**
- **Làm:** Mở tay 1 profile (**▶ Run**), trong lúc đó đưa đúng profile này vào hàng đợi upload (mục 20) rồi chạy.
- **Kỳ vọng:** Job báo lỗi rõ ràng "Profile đang mở ở nơi khác", app không crash, profile không bị kẹt trạng thái sau đó.
- **Nếu KHÔNG đúng:** App crash, hoặc cửa sổ bạn đang mở tay bị tự động đóng mất — báo lại ngay, đây từng là lỗi nặng đã vá (đóng nhầm phiên người khác).

**23. 🔴 Thu thập follower**
- **Làm:** Cần ít nhất 2-3 profile đã có username TikTok (đăng nhập ở mục 17). Tab **Analytics** → bấm **⟳ Thu thập ngay**.
- **Kỳ vọng:** Log hiện "Đang đọc `<tên>` (i/N)…" cho từng profile. Follower đọc được ghi đúng vào bảng Analytics cho từng profile.
- **Nếu KHÔNG đúng:** Follower không đọc được cho phần lớn/tất cả profile, hoặc bảng không cập nhật — tính năng theo dõi follower coi như hỏng, báo lại.

**24. 🟡 Tốc độ thu thập — chỉ khởi động 1 lần cho cả mẻ**
- **Làm:** Quan sát log ở mục 23 — đếm số lần trình duyệt được khởi động.
- **Kỳ vọng:** Chỉ khởi động Chromium **một lần** cho toàn bộ danh sách (không phải N lần cho N profile) — các lần đọc sau tái dùng cùng cửa sổ nên nhanh hơn hẳn.
- **Nếu KHÔNG đúng:** Khởi động lại nhiều lần (chậm hẳn) — không chặn (tool vẫn chạy được, chỉ chậm hơn), nhưng nên báo lại vì đây là kiến trúc mới được khôi phục sau khi phát hiện đổi sai ở vòng sửa trước.

**25. 🟡 Follower với proxy HTTP có mật khẩu**
- **Làm:** Đảm bảo trong danh sách ở mục 23 có ít nhất 1 profile đang gán proxy loại HTTP có username/password.
- **Kỳ vọng:** Follower của profile này vẫn đọc được bình thường như các profile khác.
- **Nếu KHÔNG đúng:** Riêng profile dùng proxy HTTP có mật khẩu bị lỗi/không đọc được — đúng lỗi cũ trước khi đổi engine, kỳ vọng đã sửa xong — báo lại nếu vẫn còn.

**26. 🟡 Một profile lỗi không làm vỡ cả mẻ**
- **Làm:** Trong lúc mục 23 đang chạy (hoặc ngay trước khi bấm), mở tay 1 trong các profile nằm trong danh sách thu thập.
- **Kỳ vọng:** Chỉ đúng profile đang mở tay bị đánh dấu lỗi ("failed") trong log, các profile còn lại vẫn đọc bình thường.
- **Nếu KHÔNG đúng:** Cả mẻ dừng/lỗi hết chỉ vì 1 profile — báo lại.

---

## Giai đoạn 5 — Tốc độ khi chạy nhiều profile song song

Chỉ đo sau khi mọi mục 🔴 CHẶN ở trên đã đạt. Cần ít nhất 4 profile đã đăng nhập TikTok (mục 17) — hộp thoại chọn profile để chạy chỉ hiện profile đã đăng nhập.

**27. 🟡 Thời gian upload 4 profile cùng lúc**
- **Làm:** Tab Template → mở template Upload Video → đảm bảo có video chờ sẵn cho 4 profile khác nhau trong Pending. Bấm **▶ Chạy…**, chọn đúng 4 profile, bấm **▶ Chạy 4 profile**. Bấm giờ từ lúc bắt đầu tới khi cả 4 job chuyển **done**.
- **Kỳ vọng:** Cả 4 cửa sổ chạy ẩn ngoài màn hình (không hiện lên). Tổng thời gian chênh lệch **dưới 20%** so với số liệu trước khi đổi engine (nếu có số liệu cũ để so — nếu không, ghi lại số liệu lần này làm mốc cho lần sau).
- **Nếu KHÔNG đúng:** Chậm hơn hẳn — mở 1 trong 4 cửa sổ đang chạy, gõ `chrome://version` vào thanh địa chỉ, cuộn tới **Command Line**, tìm các cụm `--disable-background-timer-throttling`, `--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding`, `--disable-features=CalculateNativeWinOcclusion`. Nếu **không có** trong Command Line, cấu hình chống throttle không tới được trình duyệt — báo lại kèm ảnh chụp dòng Command Line. Không chặn dùng tool (chỉ chậm hơn), nhưng ảnh hưởng trải nghiệm khi chạy nhiều profile.

---

## Giai đoạn 6 — Sau khi mọi thứ ổn định: sao lưu riêng thư mục engine

ShardX tự kiểm tra bản engine mới nhất mỗi khi mở app và tự tải bản mới nếu có thay đổi — **không có cách tắt** việc này trong app hiện tại. Nếu một bản engine mới tự tải về sau này bị lỗi (crash, fingerprint sai...), cần một bản engine cũ **đã kiểm chứng ổn định** để khôi phục.

`backup-data.bat` **không đủ** cho việc này: nó chỉ giữ **đúng 1 slot** backup, và mỗi lần chạy lại (ví dụ trước khi cập nhật app) sẽ **xoá và ghi đè** bản cũ — kể cả khi lúc đó engine đã tự cập nhật sang bản mới hơn (có thể lỗi). Cần một bản sao riêng, không bị 2 file `.bat` đụng vào.

**28. 🔧 Sao lưu thư mục engine sau khi Giai đoạn 1–5 đã đạt hết các mục 🔴 CHẶN**
- **Làm:** Đóng hẳn app. Copy toàn bộ thư mục
  `%APPDATA%\HienNVAuto\data\shardx`
  dán sang một thư mục mới, đặt tên có ngày, **nằm ngoài** thư mục `data` — ví dụ
  `%APPDATA%\HienNVAuto\shardx-da-kiem-chung-2026-08-02`
- **Kỳ vọng:** Thư mục mới có đầy đủ dữ liệu (thường vài trăm MB — bản thân engine đã ~500MB).
- **Nếu KHÔNG đúng:** Không tìm thấy `%APPDATA%\HienNVAuto\data\shardx` — app chưa từng mở profile nào thành công qua engine mới, quay lại Giai đoạn 1.

**Cách khôi phục khi có sự cố sau này:** đóng app → xoá `%APPDATA%\HienNVAuto\data\shardx` → copy bản đã lưu ở mục 28 vào lại đúng vị trí đó → mở app lại.

---

## Bảng ghi kết quả (điền sau khi làm xong các mục CHẶN)

| Mục | Phép đo | Đạt | Ghi chú |
|---|---|---|---|
| 3–7 | Mở/đóng/dừng profile, không kẹt trạng thái | ☐ | |
| 8 | GPU và canvas khác nhau giữa 2 profile | ☐ | |
| 9 | Timezone khớp proxy nước ngoài | ☐ | |
| 15 | Tạo profile mới thành công | ☐ | |
| 16–17 | Đăng nhập TikTok — cửa sổ hiện đúng, đăng nhập xong | ☐ | |
| 20–21 | Upload video qua Queue, dọn dẹp sạch | ☐ | |
| 23 | Thu thập follower đọc & ghi đúng | ☐ | |

---

*Ngoài phạm vi tài liệu này (không chặn việc dùng engine mới, để sau):* tab Settings cho engine (chọn nhà cung cấp geo, sao lưu engine tự động), thiết kế lại tab Profile bỏ `<select>` mặc định, giảm dấu vết hành vi (jitter khi gõ/nghỉ).
