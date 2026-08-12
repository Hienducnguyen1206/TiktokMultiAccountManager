/**
 * Nạp thêm mẫu fingerprint Win32 vào kho ShardX từ NGUỒN NGOÀI.
 *
 *   node scripts/import-fingerprints.mjs [số lượng]      (mặc định 200)
 *   node scripts/import-fingerprints.mjs 300 --dry-run   (chỉ xem, không ghi)
 *
 * NGUỒN: `fingerprint-generator` của Apify (Apache-2.0) — lấy mẫu theo phân bố
 * telemetry thật từ mạng trình duyệt residential của họ, nên các trường đi CÙNG
 * NHAU đúng như ngoài đời: một UA nhất định đi với độ phân giải, số nhân, dung
 * lượng RAM và card màn hình mà máy thật hay có. Đây là điểm khác biệt so với
 * việc tự hoán vị các trường: hoán vị tạo ra những tổ hợp không tồn tại.
 *
 * VÌ SAO CẦN: kho gốc chỉ có 120 mẫu Win32. ShardEngine.unusedTemplate() chọn
 * mẫu chưa hồ sơ nào dùng; hết mẫu thì trả null và SDK lặng lẽ bốc ngẫu nhiên —
 * từ hồ sơ thứ 121 trở đi các hồ sơ dùng chung mẫu mà không có cảnh báo nào.
 *
 * ─── Vì sao vẫn phải mượn một phần từ mẫu ShardX ─────────────────────────────
 * Nguồn ngoài cho 71 trường, ShardX cần 118. Ba nhóm nó KHÔNG có:
 *
 *   webgl.extensions / max_texture_size / max_vertex_attribs
 *   webgpu.vendor / architecture / 35 giới hạn
 *       → đây là NĂNG LỰC THẬT của GPU, không suy ra được từ tên card. Lấy trọn
 *         khối từ một mẫu ShardX CÙNG HÃNG (intel/amd/nvidia) để bộ extension,
 *         các giới hạn webgpu và tên hãng không đá nhau.
 *
 *   audio / connection / tls / webauthn / memory / speech / storage_estimate
 *       → đo trên cả 120 mẫu gốc thì các trường này GIỐNG HỆT NHAU, tức chúng
 *         không phải trục phân biệt. Chép nguyên từ mẫu nền.
 *
 *   timezone / icu_locale / ngôn ngữ
 *       → app tự ghi đè theo từng hồ sơ lúc launch (toShardOverrides), nên đặt
 *         gì ở đây cũng bị thay. Giữ theo mẫu nền cho nhất quán.
 *
 * ĐIỀU NÀY KHÔNG LÀM: mẫu chỉ đổi thứ trình duyệt KHAI BÁO. Canvas, font, audio
 * vẫn do máy thật kết xuất nên vẫn giống nhau giữa các hồ sơ trên cùng một máy.
 * Đây là cách hết cảnh dùng trùng mẫu, không phải cách làm các hồ sơ khác nhau
 * thật sự.
 *
 * Tên file dùng tiền tố `hnv-` nên không đụng tên bộ gốc (`win-*`): lúc engine
 * cập nhật, SDK chỉ ghi đè những file trùng tên với bản tải về (dist/runtime.js
 * installFingerprints), file tự thêm được giữ nguyên.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { FingerprintGenerator } from 'fingerprint-generator'

// HNV_FP_DIR chỉ dùng để kiểm thử vào thư mục tạm; chạy bình thường thì bỏ trống.
const FP_DIR =
  process.env.HNV_FP_DIR || join(homedir(), 'AppData', 'Roaming', 'hiennvauto', 'data', 'shardx', 'fingerprints')
const PREFIX = 'hnv-w-'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const want = Number(args.find((a) => /^\d+$/.test(a)) ?? 200)

const w = (s) => process.stdout.write(s + '\n')
const clone = (o) => JSON.parse(JSON.stringify(o))

if (!existsSync(FP_DIR)) {
  w(`Không thấy kho fingerprint: ${FP_DIR}`)
  w('Mở app một lần để ShardX tải engine về trước đã.')
  process.exit(1)
}

// ── Đọc kho hiện có ───────────────────────────────────────────────────────────
const files = readdirSync(FP_DIR).filter((f) => f.endsWith('.json'))
const originals = []
for (const f of files) {
  try {
    const j = JSON.parse(readFileSync(join(FP_DIR, f), 'utf8'))
    // Chỉ mẫu GỐC mới được làm nguồn mượn khối GPU — mẫu do script này tạo ra ở
    // lần chạy trước cũng chỉ mượn lại từ đó, không thêm thông tin gì.
    if (j.navigator?.platform_value === 'Win32' && !f.startsWith(PREFIX)) originals.push(j)
  } catch {
    /* file hỏng — bỏ qua */
  }
}
if (originals.length === 0) {
  w('Không tìm thấy mẫu Win32 gốc nào để mượn khối GPU.')
  process.exit(1)
}

/** intel | amd | nvidia — đọc từ webgpu.vendor của mẫu gốc. */
const vendorOf = (renderer) => {
  const s = String(renderer).toLowerCase()
  if (s.includes('nvidia')) return 'nvidia'
  if (s.includes('amd') || s.includes('radeon')) return 'amd'
  if (s.includes('intel')) return 'intel'
  return ''
}

// Kho khối GPU, gom theo hãng.
const gpuDonors = new Map() // vendor -> [{ webgl, webgpu }]
for (const j of originals) {
  const v = j.webgpu?.vendor || vendorOf(j.webgl?.renderer)
  if (!v) continue
  if (!gpuDonors.has(v)) gpuDonors.set(v, [])
  gpuDonors.get(v).push({ webgl: j.webgl, webgpu: j.webgpu })
}

const existingGen = files.filter((f) => f.startsWith(PREFIX)).length
const takenRenderers = new Set(files.map((f) => {
  try {
    return JSON.parse(readFileSync(join(FP_DIR, f), 'utf8')).webgl?.renderer
  } catch {
    return null
  }
}).filter(Boolean))

w(`Kho hiện có : ${files.length} file (${originals.length} mẫu Win32 gốc, ${existingGen} đã nạp thêm)`)
w(`Khối GPU mượn được: ${[...gpuDonors].map(([k, v]) => `${k} ${v.length}`).join(', ')}`)

// ── Lấy mẫu từ nguồn ngoài ────────────────────────────────────────────────────
const gen = new FingerprintGenerator({
  devices: ['desktop'],
  operatingSystems: ['windows'],
  browsers: [{ name: 'chrome', minVersion: 120 }]
})

const base = originals[0] // khung nền cho các trường bất biến
const pick = (a) => a[Math.floor(Math.random() * a.length)]

/** Một mẫu nguồn ngoài → một cấu hình ShardX đầy đủ 118 trường. */
function convert(fp) {
  const nav = fp.navigator
  const uad = nav.userAgentData ?? {}
  const scr = fp.screen
  const vendor = vendorOf(fp.videoCard?.renderer ?? '')
  const donors = gpuDonors.get(vendor)
  if (!donors) return null // hãng lạ (VMware, llvmpipe…) — bỏ, đừng đoán năng lực

  // Nguồn ngoài lấy mẫu theo phân bố THẬT, mà ngoài đời có máy khai UA Windows
  // nhưng navigator.platform lại là "Linux x86_64" (máy đã bị giả mạo sẵn, hoặc
  // trình duyệt lạ). Đo thật: 1/200 mẫu đầu tiên rơi vào trường hợp này. Chép
  // thẳng vào thì ra một fingerprint TỰ MÂU THUẪN — đúng thứ dễ bị bắt hơn cả
  // trùng lặp. Lọc bỏ, đừng cố sửa.
  if (nav.platform !== 'Win32') return null
  if (!/Windows NT/.test(nav.userAgent ?? '')) return null
  if (uad.platform && uad.platform !== 'Windows') return null

  const j = clone(base)

  // ── navigator ───────────────────────────────────────────────────────────────
  j.navigator.user_agent = nav.userAgent
  j.navigator.platform_value = nav.platform // 'Win32'
  j.navigator.hardware_concurrency = nav.hardwareConcurrency
  j.navigator.device_memory = nav.deviceMemory
  j.navigator.max_touch_points = nav.maxTouchPoints ?? 0
  j.navigator.platform_version = uad.platformVersion ?? j.navigator.platform_version

  // ── client hints (phải khớp UA, nên lấy cùng một mẫu nguồn) ────────────────
  const full = uad.uaFullVersion ?? ''
  const parts = full.split('.')
  j.client_hints.platform_version = uad.platformVersion ?? j.client_hints.platform_version
  j.client_hints.architecture = uad.architecture ?? j.client_hints.architecture
  j.client_hints.bitness = uad.bitness ?? j.client_hints.bitness
  j.client_hints.mobile = uad.mobile ?? false
  if (full) {
    j.client_hints.brand_version = parts[0]
    j.client_hints.brand_full_version = full
    j.client_hints.chrome_build = Number(parts[2] ?? j.client_hints.chrome_build)
    j.client_hints.chrome_patch = Number(parts[3] ?? j.client_hints.chrome_patch)
  }

  // ── màn hình + cửa sổ (window suy từ screen, giữ đúng quan hệ của mẫu nguồn) ─
  const dpr = Math.round((scr.devicePixelRatio ?? 1) * 100) / 100
  j.screen.width = scr.width
  j.screen.height = scr.height
  j.screen.avail_width = scr.availWidth ?? scr.width
  j.screen.avail_height = scr.availHeight ?? scr.height
  j.screen.avail_left = scr.availLeft ?? 0
  j.screen.avail_top = scr.availTop ?? 0
  j.screen.color_depth = scr.colorDepth ?? 24
  j.screen.pixel_depth = scr.pixelDepth ?? 24
  j.screen.device_pixel_ratio = dpr
  j.screen.dynamic_range_high = !!scr.hasHDR
  // Cửa sổ trình duyệt: bề rộng bằng vùng khả dụng, bề cao trừ đi phần khung —
  // giữ đúng khoảng chênh mà mẫu ShardX nền đang dùng, thay vì bịa số mới.
  const chromeH = base.window.outer_height - base.window.inner_height
  const barH = base.screen.avail_height - base.window.outer_height
  j.window.outer_width = j.screen.avail_width
  j.window.inner_width = j.screen.avail_width
  j.window.outer_height = Math.max(200, j.screen.avail_height - barH)
  j.window.inner_height = Math.max(100, j.window.outer_height - chromeH)

  // ── GPU: TÊN từ nguồn ngoài, NĂNG LỰC mượn từ mẫu ShardX cùng hãng ─────────
  const donor = pick(donors)
  j.webgl = clone(donor.webgl)
  j.webgpu = clone(donor.webgpu)
  j.webgl.renderer = fp.videoCard.renderer
  j.webgl.vendor = fp.videoCard.vendor
  j.notes = fp.videoCard.renderer

  // ── thiết bị đa phương tiện ────────────────────────────────────────────────
  const md = fp.multimediaDevices ?? {}
  if (j.media_devices) {
    j.media_devices.audio_input_count = (md.micros ?? []).length
    j.media_devices.video_input_count = (md.webcams ?? []).length
    if ('audio_output_count' in j.media_devices) j.media_devices.audio_output_count = (md.speakers ?? []).length
  }

  return j
}

// ── Sinh ──────────────────────────────────────────────────────────────────────
const made = []
const usedRenderers = new Set(takenRenderers)
let attempts = 0
let skippedVendor = 0
let skippedDup = 0
while (made.length < want && attempts < want * 60) {
  attempts++
  const { fingerprint } = gen.getFingerprint()
  const j = convert(fingerprint)
  if (!j) {
    skippedVendor++ // hãng GPU lạ HOẶC mẫu tự mâu thuẫn (xem convert)
    continue
  }
  // Trùng chuỗi GPU với mẫu đã có thì bỏ — đó là trục phân biệt chính.
  if (usedRenderers.has(j.webgl.renderer)) {
    skippedDup++
    continue
  }
  usedRenderers.add(j.webgl.renderer)
  made.push(j)
}

w('')
w(`Lấy ${attempts} mẫu từ nguồn ngoài → dùng được ${made.length}`)
w(`  bỏ vì hãng GPU lạ hoặc tự mâu thuẫn  : ${skippedVendor}`)
w(`  bỏ vì trùng chuỗi GPU đã có          : ${skippedDup}`)
if (made.length < want) w(`  CHÚ Ý: chỉ đạt ${made.length}/${want} — nguồn ngoài đã hết GPU mới để cấp.`)

// ── Ghi ───────────────────────────────────────────────────────────────────────
let index = existingGen
let written = 0
for (const j of made) {
  let id
  do {
    index++
    id = `${PREFIX}${String(index).padStart(5, '0')}`
  } while (existsSync(join(FP_DIR, `${id}.json`))) // không bao giờ ghi đè
  j.name = id
  if (!dryRun) writeFileSync(join(FP_DIR, `${id}.json`), JSON.stringify(j, null, 2), 'utf8')
  written++
}

w('')
if (dryRun) {
  w(`[--dry-run] sẽ ghi ${written} file, chưa ghi gì cả.`)
} else {
  w(`Đã ghi ${written} mẫu mới vào ${FP_DIR}`)
  const total = readdirSync(FP_DIR).filter((f) => f.endsWith('.json')).length
  w(`Kho sau khi ghi: ${total} file.`)
  w('Khởi động lại app để ShardEngine đọc lại danh sách (nó cache theo tiến trình).')
}
w('')
w('Nguồn: fingerprint-generator của Apify, giấy phép Apache-2.0.')
