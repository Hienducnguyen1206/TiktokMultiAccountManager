// Xoá mô tả của release vừa phát hành.
//
// Vì sao cần script này: khi mô tả release để trống, GitHub tự lấy commit message
// của tag ra hiển thị thay — nên "không có mô tả" lại thành ra có chữ. Khoá
// `build.releaseInfo.releaseNotes` trong package.json KHÔNG giải quyết được: đã thử,
// electron-builder không gửi nó lên khi tạo release (kiểm chứng ở v1.0.4 — body trả
// về rỗng dù đã khai báo).
//
// Cách duy nhất chạy thật: sau khi phát hành xong, gọi thẳng API đặt mô tả thành một
// ký tự zero-width (U+200B). Khác rỗng nên GitHub không lấp commit message vào, mà
// mắt thường không thấy gì.
//
// Chạy tự động ở cuối `npm run release`. Cần biến môi trường GH_TOKEN.

import { readFileSync } from 'fs'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const token = process.env.GH_TOKEN
const repo = 'Hienducnguyen1206/TiktokMultiAccountManager'

if (!token) {
  console.log('Bo qua xoa mo ta release: khong co GH_TOKEN')
  process.exit(0)
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json'
}

const res = await fetch(`https://api.github.com/repos/${repo}/releases/tags/v${version}`, { headers })
if (!res.ok) {
  console.log(`Bo qua xoa mo ta release: khong tim thay v${version} (HTTP ${res.status})`)
  process.exit(0)
}

const { id } = await res.json()
const patch = await fetch(`https://api.github.com/repos/${repo}/releases/${id}`, {
  method: 'PATCH',
  headers,
  body: JSON.stringify({ body: '​' })
})

if (patch.ok) {
  console.log(`Da xoa mo ta release v${version}`)
} else {
  // Không cho hỏng cả lệnh release chỉ vì phần trang trí này.
  console.log(`Khong xoa duoc mo ta release v${version} (HTTP ${patch.status})`)
}
