# Ghi chú đóng gói

## Không được loại `patchright` / `patchright-core` khỏi bundle

Hai gói này nặng ~18MB nên rất dễ bị nhắm tới khi muốn giảm dung lượng bản đóng
gói. **Không loại được.**

`@proxyshard/shardx` phụ thuộc cứng vào chúng: `dist/index.js` dòng 3 là một
`import { chromium } from "patchright"` ở **cấp cao nhất của module**, không phải
import lười bên trong `session()`. Đã kiểm chứng bằng cách gỡ tạm từng gói rồi
chạy `import('@proxyshard/shardx')` — cả hai đều ném `ERR_MODULE_NOT_FOUND`, tức
là mất luôn cả engine trình duyệt.

Thứ duy nhất loại được là phần định nghĩa TypeScript và tài liệu của chúng
(~2.3MB) — runtime không bao giờ đọc tới. Đó chính là mấy dòng `!**/node_modules/patchright*/…`
trong `build.files` của `package.json`.

## Vì sao ghi chú này nằm ở đây thay vì trong `package.json`

Trước đây nó nằm trong `package.json` dưới khoá `_filesComment` — một mảng chuỗi
dùng như comment, vì JSON không có comment. electron-builder 24 kiểm tra cấu
hình theo schema nghiêm ngặt và **từ chối mọi khoá lạ**, kể cả khoá bắt đầu bằng
dấu gạch dưới, nên `npm run dist` hỏng ngay từ bước xác thực cấu hình:

```
⨯ Invalid configuration object … configuration has an unknown property '_filesComment'
```

Muốn để comment ngay cạnh cấu hình thì phải chuyển toàn bộ `build` sang
`electron-builder.yml` (YAML có comment thật).

## Bản build ra cái gì

`win.target` là `nsis`, nên `npm run dist` tạo trình cài đặt:

```
release/HienNVAuto Setup <version>.exe
release/latest.yml
```

`latest.yml` là thứ `electron-updater` đọc để biết có bản mới — thiếu file này
thì auto-update im lặng không hoạt động. Thư mục `release/win-unpacked/` vẫn
được sinh ra như bước trung gian, chạy trực tiếp được, nhưng không phải sản phẩm
để phát hành.

## Icon được gắn lúc nào

`scripts/set-exe-icon.ps1` KHÔNG còn chạy ở bước cuối của `npm run dist` nữa. Nó
được gọi từ hook `afterPack` (`build/afterPack.js`), tức là sau khi electron-builder
pack xong thư mục app và trước khi đóng gói installer.

Thứ tự này là bắt buộc, không phải sở thích: với target `nsis`, electron-builder
pack rồi đóng gói ngay trong cùng một lệnh. Chạy script sau đó thì icon chỉ vào
được thư mục `win-unpacked`, còn bản `.exe` nằm trong installer vẫn trắng trơn.

## Phát hành bản mới

1. Sửa `version` trong `package.json`.
2. `npm run release`

Lệnh này build, tạo installer + `latest.yml`, rồi upload lên GitHub Releases của
`Hienducnguyen1206/TiktokMultiAccountManager`. Token đọc từ biến môi trường
`GH_TOKEN` — không nằm trong repo.

## Vì sao release không có mô tả

`npm run release` chạy `scripts/clear-release-notes.mjs` ở bước cuối để xoá mô tả
của bản vừa phát hành.

Không bỏ bước này được. Khi mô tả release để trống, GitHub tự lấy commit message
của tag ra hiển thị thay — nên "không mô tả" lại thành ra có chữ. Khoá
`build.releaseInfo.releaseNotes` trong `package.json` **không** giải quyết được:
đã thử ở v1.0.4, electron-builder không gửi nó lên, release tạo ra vẫn có body
rỗng và GitHub vẫn lấp commit message vào.

Script đặt mô tả thành một ký tự zero-width (U+200B) — khác rỗng nên GitHub không
lấp gì, mà mắt thường không thấy. Script tự bỏ qua nếu thiếu `GH_TOKEN` hoặc
không tìm thấy release, nên không làm hỏng lệnh phát hành.
