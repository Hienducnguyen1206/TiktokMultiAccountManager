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

`win.target` đang là `dir`, nên `npm run dist` **không** tạo trình cài đặt. Kết
quả là một thư mục chạy trực tiếp:

```
release/win-unpacked/HienNVAuto.exe
```

Bước cuối của script `dist` chạy `scripts/set-exe-icon.ps1` để gắn icon vào file
`.exe` đó. Muốn có file cài đặt thì đổi `win.target` thành `nsis`.
