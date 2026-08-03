import { createHmac } from 'crypto'
import { EventEmitter } from 'events'
import { type Browser, type ElementHandle, type Page } from 'puppeteer-core'
import { openAutomation, closeSession } from './ShardEngine'
import { trackProc } from './EngineProcs'
import { ProfileStore } from './ProfileStore'

export const loginEvents = new EventEmitter()

export interface LoginResult {
  ok: boolean
  reason?: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

// ─── Mô phỏng thao tác người ──────────────────────────────────────────────────
//
// `elementHandle.click()` của Puppeteer chỉ bắn mousePressed + mouseReleased tại
// đúng tọa độ phần tử: con trỏ hiện ra ngay trên nút, không có một sự kiện
// mousemove nào dẫn tới đó. Trình duyệt thật không bao giờ sinh ra chuỗi như vậy.
// `type(text, { delay: 80 })` cũng vậy — khoảng cách giữa các phím đều tăm tắp.

// Con trỏ chuột không đọc ngược lại được từ CDP, nên tự nhớ vị trí để đường đi
// nối liền nhau thay vì nhảy cóc. Theo từng Page: hai profile đăng nhập song
// song không được dùng chung một con trỏ.
const cursors = new WeakMap<Page, { x: number; y: number }>()

/**
 * Vẽ một chấm đánh dấu vị trí "chuột" để người dùng nhìn thấy thao tác đang
 * chạy. Con trỏ thật của Windows KHÔNG bị điều khiển — sự kiện chuột được bơm
 * thẳng vào trang, nên không có gì để nhìn nếu không tự vẽ.
 *
 * ĐÁNH ĐỔI: chấm này là một <div> thật trong DOM của trang. Trang không thể
 * bấm/hover trúng nó (pointer-events:none) và id đặt ngẫu nhiên theo từng phiên,
 * nhưng về nguyên tắc mã của TikTok vẫn quét DOM ra được. Đặt false để tắt hẳn.
 */
const SHOW_FAKE_CURSOR = true

const cursorIds = new WeakMap<Page, string>()

function cursorId(page: Page): string {
  let id = cursorIds.get(page)
  if (!id) {
    id = `_${Math.random().toString(36).slice(2, 10)}`
    cursorIds.set(page, id)
  }
  return id
}

/** Đặt chấm tại (x, y). `pressed` = đang giữ nút chuột. */
async function paintCursor(page: Page, x: number, y: number, pressed = false): Promise<void> {
  if (!SHOW_FAKE_CURSOR) return
  try {
    await page.evaluate(
      (cx: number, cy: number, id: string, down: boolean) => {
        let dot = document.getElementById(id)
        if (!dot) {
          dot = document.createElement('div')
          dot.id = id
          dot.style.cssText =
            'position:fixed;left:0;top:0;width:16px;height:16px;margin:-8px 0 0 -8px;' +
            'border-radius:50%;pointer-events:none;z-index:2147483647;' +
            'box-shadow:0 0 0 2px #fff,0 2px 8px rgba(0,0,0,.55);'
          document.documentElement.appendChild(dot)
        }
        dot.style.transform = `translate(${cx}px,${cy}px) scale(${down ? 0.6 : 1})`
        dot.style.background = down ? 'rgba(255,196,0,.95)' : 'rgba(255,64,64,.85)'
      },
      x,
      y,
      cursorId(page),
      pressed
    )
  } catch {
    /* trang đang điều hướng — bỏ qua, chấm sẽ được vẽ lại ở bước sau */
  }
}

/**
 * Rê chuột tới (x, y) theo đường cong Bezier bậc hai, tốc độ chậm-nhanh-chậm.
 *
 * Đi thẳng cũng lộ như dịch chuyển tức thời: tay người không kẻ được đường
 * thẳng, và không giữ vận tốc đều từ đầu tới cuối.
 */
async function moveTo(page: Page, x: number, y: number): Promise<void> {
  const from = cursors.get(page) ?? { x: rand(60, 320), y: rand(60, 320) }
  const dist = Math.hypot(x - from.x, y - from.y)
  // ~1 điểm mỗi 6-14px: đo trên trang thử, quãng ~200px cho ra 14-33 sự kiện
  // mousemove trong ~250ms — cùng khoảng mật độ mà chuột thật (125Hz) sinh ra.
  const steps = Math.max(10, Math.min(60, Math.round(dist / rand(6, 14))))
  // Điểm điều khiển đẩy lệch sang MỘT bên của đoạn thẳng → cung cong một chiều.
  const side = Math.random() < 0.5 ? -1 : 1
  const bow = Math.min(120, dist * rand(0.1, 0.28)) * side
  const angle = Math.atan2(y - from.y, x - from.x) + Math.PI / 2
  const cx = (from.x + x) / 2 + Math.cos(angle) * bow
  const cy = (from.y + y) / 2 + Math.sin(angle) * bow
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2 // ease-in-out
    const px = (1 - e) ** 2 * from.x + 2 * (1 - e) * e * cx + e ** 2 * x
    const py = (1 - e) ** 2 * from.y + 2 * (1 - e) * e * cy + e ** 2 * y
    await page.mouse.move(px, py)
    await paintCursor(page, px, py)
    await sleep(rand(6, 18))
  }
  cursors.set(page, { x, y })
}

/** Rê chuột tới một điểm bất kỳ trong phần tử rồi mới nhấn — không bấm giữa tâm. */
async function humanClick(page: Page, el: ElementHandle<Element>): Promise<void> {
  const box = await el.boundingBox()
  if (!box) {
    await el.click() // phần tử không có layout → không mô phỏng được, bấm thẳng
    return
  }
  const x = box.x + box.width * rand(0.25, 0.75)
  const y = box.y + box.height * rand(0.3, 0.7)
  await moveTo(page, x, y)
  await sleep(rand(60, 180)) // khựng lại trước khi nhấn
  await page.mouse.down()
  await paintCursor(page, x, y, true)
  await sleep(rand(45, 110)) // thời gian giữ phím chuột
  await page.mouse.up()
  await paintCursor(page, x, y)
}

/** Gõ từng ký tự với nhịp ngẫu nhiên, thỉnh thoảng ngừng lâu hơn. */
async function humanType(page: Page, text: string): Promise<void> {
  for (const ch of text) {
    await page.keyboard.type(ch)
    await sleep(rand(55, 165))
    if (Math.random() < 0.07) await sleep(rand(220, 600)) // ngập ngừng
  }
}

/** Bôi đen + xóa, nhưng CHỈ khi ô đang có sẵn nội dung. */
async function clearIfFilled(page: Page, el: ElementHandle<Element>): Promise<void> {
  const filled = await el.evaluate((e) => Boolean((e as HTMLInputElement).value))
  if (!filled) return
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyA')
  await page.keyboard.up('Control')
  await sleep(rand(40, 120))
  await page.keyboard.press('Backspace')
  await sleep(rand(80, 200))
}

function base32Decode(str: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const cleaned = str.toUpperCase().replace(/[\s=]/g, '')
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const ch of cleaned) {
    const idx = alphabet.indexOf(ch)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

export function generateTotp(secret: string): string {
  const key = base32Decode(secret)
  const counter = Math.floor(Date.now() / 1000 / 30)
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac('sha1', key).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return String(code % 1_000_000).padStart(6, '0')
}

// Điền mã TOTP vào ô input — hỗ trợ ô đơn (TikTok hiện dùng) lẫn 6 ô riêng
async function fillOtpCode(page: Page, code: string): Promise<boolean> {
  // Ô đơn của TikTok 2FA: div.code-input > input, hoặc theo placeholder
  const single = await page.$(
    '.code-input input, input[placeholder*="6 chữ số"], input[placeholder*="6 digit" i], input[maxlength="6"], input[autocomplete="one-time-code"]'
  )
  if (single) {
    await humanClick(page, single)
    await clearIfFilled(page, single)
    await humanType(page, code)
    return true
  }

  // 6 ô riêng (maxlength=1)
  const boxes = await page.$$('input[maxlength="1"]')
  if (boxes.length >= 6) {
    await humanClick(page, boxes[0])
    await humanType(page, code)
    return true
  }

  // Fallback: focus và type vào bất kỳ input tel/numeric đang visible
  const fallback = await page.$('input[type="tel"], input[inputmode="numeric"]')
  if (fallback) {
    await humanClick(page, fallback)
    await clearIfFilled(page, fallback)
    await humanType(page, code)
    return true
  }

  return false
}

// Đọc cookie sessionid (httpOnly) qua CDP — document.cookie KHÔNG đọc được.
// Trả về GIÁ TRỊ (không phải boolean) để phân biệt phiên MỚI với phiên cũ còn
// sót lại: xem chỗ dùng ở Bước 4. Giá trị này là bí mật đăng nhập — không log.
async function sessionId(page: Page): Promise<string> {
  const cookies = await page.cookies('https://www.tiktok.com')
  return cookies.find((c) => c.name === 'sessionid')?.value ?? ''
}

const LOGIN_URL = 'https://www.tiktok.com/login/phone-or-email/email'

/**
 * Profile này đã đăng nhập sẵn chưa? Đo bằng cách xem TikTok có ĐÁ mình khỏi
 * trang đăng nhập không.
 *
 * KHÔNG dùng "form đăng nhập có xuất hiện không" — đã đo trên profile thật đang
 * đăng nhập: trang /login/phone-or-email/email render form ĐẦY ĐỦ (cả ô username
 * lẫn ô password) rồi ~5 giây SAU mới bị chuyển về /foryou. Ai kiểm tra bằng form
 * sẽ kết luận "chưa đăng nhập" và điền lại tài khoản vào một phiên đang sống.
 *
 * Cũng không dùng DOM (nút Đăng nhập / avatar): cùng lần đo đó, trên /foryou cả
 * `#header-login-button` lẫn `[data-e2e="nav-profile"]` đều không có mặt, nên hai
 * selector này không phân biệt được gì. URL thì không phụ thuộc DOM lẫn ngôn ngữ.
 *
 * Số liệu: đã đăng nhập → rời /login ở giây thứ 7.2. Chưa đăng nhập → ở nguyên
 * /login suốt 22 giây theo dõi. Ngưỡng 15s nằm giữa hai mốc đó.
 */
async function redirectedOffLogin(page: Page, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    if (!page.url().includes('/login')) return true
    await sleep(500)
  }
  return false
}

const SIGNED_IN_PROBE_MS = 15000
const GLOBAL_TIMEOUT_MS = 6 * 60 * 1000 // 6 phút (chờ user tự bấm Đăng nhập)
const OTP_SELECTOR =
  '.code-input input, input[placeholder*="6 chữ số"], input[placeholder*="6 digit" i], input[maxlength="6"], input[maxlength="1"], input[autocomplete="one-time-code"], input[inputmode="numeric"]'

const activeLogins = new Set<string>()

type DoLoginResult = LoginResult & { keepOpen?: boolean }

async function doLogin(page: Page, profile: ReturnType<typeof ProfileStore.get> & object, log: (m: string) => void): Promise<DoLoginResult> {
  // ── Bước 1: Mở thẳng trang đăng nhập bằng email/username ──────────────────
  // Không ghé trang chủ trước: mọi thứ cần biết đều đọc được ngay tại đây (xem
  // Bước 2). URL này cũng không phụ thuộc ngôn ngữ — trước đây bấm nút Đăng nhập
  // rồi so khớp TEXT mục "Sử dụng số điện thoại hoặc email" trong modal, nên
  // profile đặt ngôn ngữ khác (vd ja-JP → "電話番号またはメールを使う") là hỏng ngay.
  log('Mở trang đăng nhập…')
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })

  // ── Bước 2: Đã đăng nhập sẵn chưa? ────────────────────────────────────────
  // Chỉ profile CÒN cookie sessionid mới đáng bỏ thời gian ra dò — profile chưa
  // từng đăng nhập đi thẳng xuống Bước 3, không mất giây nào.
  const before = await sessionId(page)
  if (before) {
    log('Có phiên cũ — đang kiểm tra còn hiệu lực không…')
    if (await redirectedOffLogin(page, SIGNED_IN_PROBE_MS)) {
      ProfileStore.setLoggedIn(profile.id, true)
      log('Đã đăng nhập sẵn!')
      return { ok: true }
    }
    // Còn cookie mà TikTok vẫn cho ở lại trang đăng nhập = phiên đã chết
    // server-side. KHÔNG xóa cookie: Bước 4 so sánh giá trị với `before` nên
    // cookie cũ không thể bị nhầm thành lần đăng nhập mới.
    ProfileStore.setLoggedIn(profile.id, false)
    log('Phiên cũ đã hết hạn — đăng nhập lại…')
  }

  // ── Bước 3: Điền username ─────────────────────────────────────────────────
  log('Điền username…')
  const usernameInput = await page.waitForSelector(
    'input[name="username"], input[autocomplete="username"], input[placeholder*="email" i]',
    { timeout: 8000 }
  )
  if (!usernameInput) return { ok: false, reason: 'Không tìm thấy ô nhập username' }
  await humanClick(page, usernameInput)
  await clearIfFilled(page, usernameInput)
  await humanType(page, profile.tiktokUsername)
  await sleep(rand(400, 900))

  // Điền password
  log('Điền mật khẩu…')
  const passwordInput = await page.waitForSelector('input[type="password"]', { timeout: 8000 })
  if (!passwordInput) return { ok: false, reason: 'Không tìm thấy ô nhập mật khẩu' }
  await humanClick(page, passwordInput)
  await clearIfFilled(page, passwordInput)
  await humanType(page, profile.tiktokPassword)
  await sleep(rand(500, 1100))

  // ── Bước 4: KHÔNG tự bấm — để user tự bấm "Đăng nhập" ─────────────────────
  // Đã điền tài khoản + mật khẩu. Không tự động submit (tránh bị TikTok chặn /
  // giới hạn tần suất). User tự bấm nút Đăng nhập trong cửa sổ trình duyệt.
  log('Đã điền tài khoản & mật khẩu — hãy TỰ BẤM "Đăng nhập" trong cửa sổ trình duyệt…')

  // ── Bước 5: Đợi 2FA hoặc sessionid MỚI ───────────────────────────────────
  log('Đang chờ xác thực…')
  // LƯU Ý: sessionid của TikTok là httpOnly → document.cookie KHÔNG đọc được.
  // Bắt buộc dùng page.cookies() (CDP) để đọc.
  let got2fa = false
  const dl1 = Date.now() + 150000 // 150s: đủ để user tự bấm Đăng nhập
  while (Date.now() < dl1) {
    try {
      // So với `before`, KHÔNG chỉ "có cookie hay không": tới được đây nghĩa là
      // phiên cũ (nếu có) đã chết ở Bước 2 nhưng cookie của nó vẫn nằm trong
      // profile. Chỉ nhận khi TikTok cấp một sessionid KHÁC.
      const now = await sessionId(page)
      if (now && now !== before) {
        ProfileStore.setLoggedIn(profile.id, true)
        log('Đăng nhập thành công!')
        return { ok: true }
      }
      // CHỈ coi là 2FA khi đã RỜI form đăng nhập (ô password biến mất = user đã
      // bấm Đăng nhập). Nếu còn form → tránh khớp nhầm ô numeric trên form login.
      const stillOnLoginForm = await page.$('input[type="password"]')
      if (!stillOnLoginForm && (await page.$(OTP_SELECTOR))) {
        got2fa = true
        break
      }
    } catch {
      /* trang đang điều hướng — bỏ qua, thử lượt sau (KHÔNG đóng browser) */
    }
    await sleep(1000)
  }

  // ── Bước 6: Điền mã 2FA ───────────────────────────────────────────────────
  // Chưa thấy 2FA và chưa có session → có thể user chưa bấm / đang giải CAPTCHA.
  // Giữ cửa sổ mở để user tự hoàn tất.
  if (!got2fa) return { ok: false, reason: 'Chưa hoàn tất — hãy tự bấm Đăng nhập / giải CAPTCHA trong cửa sổ', keepOpen: true }
  if (!profile.tiktok2fa) return { ok: false, reason: 'Cần mã 2FA nhưng profile không có secret' }

  log('Điền mã xác thực 2FA…')
  await sleep(500)
  const code = generateTotp(profile.tiktok2fa)
  const filled = await fillOtpCode(page, code)
  if (!filled) return { ok: false, reason: 'Không điền được mã 2FA' }

  // Dừng lại ở đây, KHÔNG tự bấm "Tiếp" — cùng lý do như Bước 4: tự động submit
  // dễ bị TikTok chặn/giới hạn tần suất. Giữ cửa sổ mở để user tự bấm.
  log('Đã điền mã 6 số — vui lòng tự bấm "Tiếp"')
  return { ok: true, keepOpen: true }
}

export async function loginProfile(profileId: string): Promise<LoginResult> {
  if (activeLogins.has(profileId)) return { ok: false, reason: 'Đang đăng nhập, vui lòng chờ' }

  const profile = ProfileStore.get(profileId)
  if (!profile) return { ok: false, reason: 'Không tìm thấy profile' }
  if (profile.status === 'running') return { ok: false, reason: 'Đóng profile trước khi đăng nhập' }
  if (!profile.tiktokUsername) return { ok: false, reason: 'Profile chưa có username TikTok' }
  if (!profile.tiktokPassword) return { ok: false, reason: 'Profile chưa có mật khẩu' }

  activeLogins.add(profileId)

  const log = (msg: string): void => {
    console.log(`[TikTokLogin ${profile.tiktokUsername}] ${msg}`)
    loginEvents.emit('progress', profileId, msg)
  }

  let browser: Browser | null = null
  let keepOpen = false
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    log('Đang mở trình duyệt…')
    const { browser: b, session } = await openAutomation(profile)
    browser = b
    trackProc(session.process)
    const pages = await browser.pages()
    const page: Page = pages[0] ?? (await browser.newPage())
    page.on('dialog', async (d) => { try { await d.dismiss() } catch { /* ignore */ } })

    // openAutomation() mặc định đẩy cửa sổ ra ngoài màn hình (dành cho automation
    // không cần hiển thị) — nhưng đăng nhập cần user TỰ bấm nút/nhập OTP, nên phải
    // kéo cửa sổ về lại màn hình và phóng to. Lỗi ở đây không chặn luồng đăng nhập.
    try {
      const client = await page.createCDPSession()
      const { windowId } = await client.send('Browser.getWindowForTarget')
      await client.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } })
      await client.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } })
    } catch {
      /* không chỉnh được vị trí cửa sổ — vẫn tiếp tục đăng nhập */
    }

    const timeoutPromise = new Promise<DoLoginResult>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Quá 6 phút, đăng nhập thất bại')), GLOBAL_TIMEOUT_MS)
    })

    const result = await Promise.race([doLogin(page, profile, log), timeoutPromise])
    keepOpen = result.keepOpen === true
    return { ok: result.ok, reason: result.reason }
  } catch (e) {
    const msg = (e as Error)?.message ?? 'Lỗi không xác định'
    console.error(`[TikTokLogin ${profile.tiktokUsername}] LỖI:`, e)
    log(`Lỗi: ${msg}`)
    return { ok: false, reason: msg }
  } finally {
    clearTimeout(timer) // dọn timeout treo → tránh rejection lơ lửng
    activeLogins.delete(profileId)
    // CHỈ đụng tới session/cờ running khi CHÍNH lần gọi này mở được browser.
    // openAutomation() có thể ném lỗi vì profile.id đang mở ở nơi khác (job
    // queue, đọc follower, hoặc browsing thủ công) — khi đó browser vẫn null,
    // và closeSession(profile.id)/setRunning(profile.id, false) vô điều kiện
    // sẽ đụng nhầm vào phiên KHÔNG PHẢI của lần gọi này, vì cả hai đều tra
    // theo profile.id trong state DÙNG CHUNG (review Fix round 1, Finding 1).
    if (browser) {
      ProfileStore.setRunning(profile.id, false)
      if (keepOpen) {
        // Giữ cửa sổ Chrome mở cho user tự thao tác — chỉ ngắt CDP, KHÔNG đóng/kill
        try { browser.disconnect() } catch { /* ignore */ }
      } else {
        try { await browser.close() } catch { /* ignore */ }
        await closeSession(profile.id)
      }
    }
  }
}
