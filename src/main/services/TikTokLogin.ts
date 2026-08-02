import { createHmac } from 'crypto'
import { EventEmitter } from 'events'
import { type Browser, type Page } from 'puppeteer-core'
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

// Chờ và click element theo selector, có timeout riêng
async function waitAndClick(page: Page, selector: string, timeout: number): Promise<void> {
  const el = await page.waitForSelector(selector, { timeout, visible: true })
  if (!el) throw new Error(`Không tìm thấy: ${selector}`)
  await el.click()
  await sleep(300)
}

// Tìm element chứa text rồi click, thử lần lượt từng text. Trả về true nếu thành công.
async function clickText(page: Page, texts: string[], timeout = 8000): Promise<boolean> {
  for (const text of texts) {
    try {
      const el = await page.waitForFunction(
        (t) => {
          const all = Array.from(document.querySelectorAll('button, [role="button"], span, div, p, a'))
          return all.find(
            (e) =>
              e.textContent?.trim() === t &&
              (e as HTMLElement).offsetParent !== null
          ) as Element | undefined
        },
        { timeout },
        text
      )
      if (el) {
        await page.evaluate((e) => (e as HTMLElement).click(), el)
        await sleep(300)
        return true
      }
    } catch {
      // thử text tiếp theo
    }
  }
  return false
}

// Điền mã TOTP vào ô input — hỗ trợ ô đơn (TikTok hiện dùng) lẫn 6 ô riêng
async function fillOtpCode(page: Page, code: string): Promise<boolean> {
  // Ô đơn của TikTok 2FA: div.code-input > input, hoặc theo placeholder
  const single = await page.$(
    '.code-input input, input[placeholder*="6 chữ số"], input[placeholder*="6 digit" i], input[maxlength="6"], input[autocomplete="one-time-code"]'
  )
  if (single) {
    await single.click({ clickCount: 3 })
    await single.type(code, { delay: 80 })
    return true
  }

  // 6 ô riêng (maxlength=1)
  const boxes = await page.$$('input[maxlength="1"]')
  if (boxes.length >= 6) {
    await boxes[0].click()
    await page.keyboard.type(code, { delay: 100 })
    return true
  }

  // Fallback: focus và type vào bất kỳ input tel/numeric đang visible
  const fallback = await page.$('input[type="tel"], input[inputmode="numeric"]')
  if (fallback) {
    await fallback.click({ clickCount: 3 })
    await fallback.type(code, { delay: 80 })
    return true
  }

  return false
}

// Đọc cookie sessionid (httpOnly) qua CDP — document.cookie KHÔNG đọc được.
async function hasSession(page: Page): Promise<boolean> {
  const cookies = await page.cookies('https://www.tiktok.com')
  return cookies.some((c) => c.name === 'sessionid' && !!c.value)
}

const GLOBAL_TIMEOUT_MS = 6 * 60 * 1000 // 6 phút (chờ user tự bấm Đăng nhập)
const OTP_SELECTOR =
  '.code-input input, input[placeholder*="6 chữ số"], input[placeholder*="6 digit" i], input[maxlength="6"], input[maxlength="1"], input[autocomplete="one-time-code"], input[inputmode="numeric"]'

const activeLogins = new Set<string>()

type DoLoginResult = LoginResult & { keepOpen?: boolean }

async function doLogin(page: Page, profile: ReturnType<typeof ProfileStore.get> & object, log: (m: string) => void): Promise<DoLoginResult> {
  // ── Bước 1: Mở trang, kiểm tra đã login chưa ──────────────────────────────
  log('Đang tải trang TikTok…')
  // domcontentloaded: nhanh — KHÔNG dùng networkidle (TikTok luôn có request nền)
  const curUrl = page.url()
  if (!curUrl.startsWith('https://www.tiktok.com')) {
    await page.goto('https://www.tiktok.com/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  }
  // Đợi nút Login hoặc avatar profile xuất hiện trong DOM (chạy tiếp ngay khi có)
  await page.waitForSelector('#header-login-button, [data-e2e="nav-login-button"], [data-e2e="nav-profile"]', { timeout: 20000 })

  // Xác minh đã login bằng UI THẬT, không tin cookie sessionid (cookie cũ/hết hạn
  // vẫn còn trong profile → false positive). Có nút Login = CHƯA login.
  const alreadyLoggedIn = await page.evaluate(() => {
    const loginBtn = document.querySelector('#header-login-button, [data-e2e="nav-login-button"]')
    const profileBtn = document.querySelector('[data-e2e="nav-profile"]')
    return !loginBtn && !!profileBtn
  })
  if (alreadyLoggedIn) {
    ProfileStore.setLoggedIn(profile.id, true)
    log('Đã đăng nhập sẵn!')
    return { ok: true }
  }

  // UI báo CHƯA đăng nhập nhưng có thể còn cookie phiên CŨ đã hết hạn (server-side
  // đã đăng xuất). Nếu để nguyên, hasSession() ở Bước 8 sẽ thấy cookie này và báo
  // NHẦM "đăng nhập thành công" rồi đóng browser. → Xóa cookie cũ để re-login sạch.
  try {
    const oldCookies = await page.cookies('https://www.tiktok.com')
    if (oldCookies.some((c) => c.name === 'sessionid' && !!c.value)) {
      await page.deleteCookie(...oldCookies)
      ProfileStore.setLoggedIn(profile.id, false)
      log('Phiên cũ đã hết hạn — xóa cookie, đăng nhập lại…')
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
      await sleep(800)
    }
  } catch {
    /* ignore */
  }

  // ── Bước 2: Lăn chuột ─────────────────────────────────────────────────────
  log('Cuộn trang…')
  await page.mouse.wheel({ deltaY: 400 })
  await sleep(700)
  await page.mouse.wheel({ deltaY: 400 })
  await sleep(800)

  // ── Bước 3: Click nút Đăng nhập ───────────────────────────────────────────
  log('Nhấn nút Đăng nhập…')
  const loginBtnEl = await page.waitForSelector('#header-login-button, [data-e2e="nav-login-button"]', { timeout: 10000 })
  if (!loginBtnEl) return { ok: false, reason: 'Không tìm thấy nút Đăng nhập' }
  await page.evaluate((el) => (el as HTMLElement).click(), loginBtnEl)
  // Đợi modal/panel đăng nhập xuất hiện
  await page.waitForSelector('[data-e2e="channel-item"], [data-e2e="login-modal"]', { timeout: 12000 })
  await sleep(500)

  // ── Bước 4: Chọn "Sử dụng số điện thoại hoặc email" ───────────────────────
  log('Chọn đăng nhập bằng email/số điện thoại…')
  // Tìm channel-item có chứa text phone/email rồi click (DOM: 7 item, cần item #2)
  const clickedPhoneEmail = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('[data-e2e="channel-item"]'))
    const keywords = ['số điện thoại', 'phone', 'email']
    const target = items.find((el) => {
      const t = (el.textContent ?? '').toLowerCase()
      return keywords.some((k) => t.includes(k))
    })
    if (target) {
      (target as HTMLElement).click()
      return true
    }
    return false
  })
  if (!clickedPhoneEmail) return { ok: false, reason: 'Không tìm thấy tùy chọn đăng nhập bằng email/SĐT' }
  // ── Bước 5: Click "Sử dụng email hoặc tên người dùng" ─────────────────────
  log('Chọn đăng nhập bằng email / tên người dùng…')
  const emailLink = await page.waitForSelector('a[href="/login/phone-or-email/email"]', { timeout: 10000 })
  if (!emailLink) return { ok: false, reason: 'Không tìm thấy link đăng nhập bằng email/username' }
  await page.evaluate((el) => (el as HTMLElement).click(), emailLink)
  // Đợi ô username sẵn sàng
  await page.waitForSelector('input[name="username"], input[autocomplete="username"]', { timeout: 10000 })
  await sleep(500)

  // ── Bước 6: Điền username ─────────────────────────────────────────────────
  log('Điền username…')
  const usernameInput = await page.waitForSelector(
    'input[name="username"], input[autocomplete="username"], input[placeholder*="email" i]',
    { timeout: 8000 }
  )
  if (!usernameInput) return { ok: false, reason: 'Không tìm thấy ô nhập username' }
  await usernameInput.click({ clickCount: 3 })
  await usernameInput.type(profile.tiktokUsername, { delay: 80 })
  await sleep(600)

  // Điền password
  log('Điền mật khẩu…')
  const passwordInput = await page.waitForSelector('input[type="password"]', { timeout: 8000 })
  if (!passwordInput) return { ok: false, reason: 'Không tìm thấy ô nhập mật khẩu' }
  await passwordInput.click()
  await passwordInput.type(profile.tiktokPassword, { delay: 80 })
  await sleep(800)

  // ── Bước 7: KHÔNG tự bấm — để user tự bấm "Đăng nhập" ─────────────────────
  // Đã điền tài khoản + mật khẩu. Không tự động submit (tránh bị TikTok chặn /
  // giới hạn tần suất). User tự bấm nút Đăng nhập trong cửa sổ trình duyệt.
  log('Đã điền tài khoản & mật khẩu — hãy TỰ BẤM "Đăng nhập" trong cửa sổ trình duyệt…')

  // ── Bước 8: Đợi 2FA hoặc sessionid ───────────────────────────────────────
  log('Đang chờ xác thực…')
  // LƯU Ý: sessionid của TikTok là httpOnly → document.cookie KHÔNG đọc được.
  // Bắt buộc dùng page.cookies() (CDP) để đọc.
  let got2fa = false
  const dl1 = Date.now() + 150000 // 150s: đủ để user tự bấm Đăng nhập
  while (Date.now() < dl1) {
    try {
      if (await hasSession(page)) {
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

  // ── Bước 9: Điền mã 2FA ───────────────────────────────────────────────────
  // Chưa thấy 2FA và chưa có session → có thể user chưa bấm / đang giải CAPTCHA.
  // Giữ cửa sổ mở để user tự hoàn tất.
  if (!got2fa) return { ok: false, reason: 'Chưa hoàn tất — hãy tự bấm Đăng nhập / giải CAPTCHA trong cửa sổ', keepOpen: true }
  if (!profile.tiktok2fa) return { ok: false, reason: 'Cần mã 2FA nhưng profile không có secret' }

  log('Điền mã xác thực 2FA…')
  await sleep(500)
  const code = generateTotp(profile.tiktok2fa)
  const filled = await fillOtpCode(page, code)
  if (!filled) return { ok: false, reason: 'Không điền được mã 2FA' }

  // ── TẠM DỪNG: đã điền mã 6 số, để user tự bấm "Tiếp" ──────────────────────
  log('Đã điền mã 6 số — vui lòng tự bấm "Tiếp"')
  return { ok: true, keepOpen: true }

  // Blur ô mã để React validate → nút Tiếp enable
  await page.evaluate(() => {
    const inp = document.querySelector('.code-input input, input[placeholder*="6"]') as HTMLElement | null
    inp?.blur()
  })
  // Đợi nút Tiếp KHÔNG còn disabled (chỉ enable sau khi nhập đủ 6 số)
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('button[type="submit"]') as HTMLButtonElement | null
      if (!btn) return false
      return !btn.disabled && btn.getAttribute('aria-disabled') !== 'true'
    },
    { timeout: 8000 }
  ).catch(() => { /* vẫn thử click + Enter */ })
  await sleep(500)

  // Nhấn Tiếp / Confirm
  const confirmBtn = await page.waitForSelector(
    '[data-e2e="confirm-code"], button[type="submit"]',
    { timeout: 8000, visible: true }
  ).catch(() => null)
  await confirmBtn?.click().catch(() => { /* fallback Enter */ })
  await sleep(800)

  // Fallback: nếu còn ô mã (chưa submit) → nhấn Enter
  const otpStill = await page.$(OTP_SELECTOR)
  await otpStill?.focus()
  if (otpStill) await page.keyboard.press('Enter')
  await sleep(2000)

  // Nếu còn ô OTP → mã hết hạn (window 30s), thử mã mới
  const stillOtp = await page.$(OTP_SELECTOR)
  if (stillOtp) {
    const code2 = generateTotp(profile.tiktok2fa)
    if (code2 !== code) {
      log('Thử lại với mã 2FA mới…')
      await fillOtpCode(page, code2)
      await sleep(600)
      await confirmBtn?.click().catch(() => { /* ignore */ })
      await sleep(2000)
    }
  }

  // Đợi sessionid sau 2FA (tối đa 20s) — dùng page.cookies() vì httpOnly
  log('Đang chờ sau khi nhập 2FA…')
  const dl2 = Date.now() + 20000
  while (Date.now() < dl2) {
    if (await hasSession(page)) break
    await sleep(1000)
  }

  const finalCookies = await page.cookies('https://www.tiktok.com')
  if (finalCookies.some((c) => c.name === 'sessionid' && !!c.value)) {
    ProfileStore.setLoggedIn(profile.id, true)
    log('Đăng nhập thành công!')
    return { ok: true }
  }
  return { ok: false, reason: 'Đăng nhập thất bại sau khi nhập 2FA' }
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
