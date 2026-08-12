import type { Page } from 'puppeteer-core'

/**
 * Điều hướng sang một trang TikTok rồi CHỜ CHO TỚI KHI TRANG THẬT SỰ DÙNG ĐƯỢC,
 * tự tải lại nếu không.
 *
 * Vì sao cần: TikTok thỉnh thoảng trả về trang lỗi trống trơn ("Đã xảy ra lỗi —
 * vui lòng thử lại sau", kèm nút Làm mới) khi mạng chập chờn hoặc phía họ quá
 * tải. `page.goto()` coi đó là thành công — HTTP 200, DOM tải xong — nên mọi
 * bước sau đó tìm không thấy thứ mình cần rồi job báo hỏng, trong khi chỉ cần
 * tải lại là chạy tiếp được.
 *
 * ĐỪNG chuyển sang dò chữ trên trang để nhận ra lỗi. Chữ đó đổi theo ngôn ngữ
 * của hồ sơ ("Something went wrong" với hồ sơ tiếng Anh, tiếng Hàn lại khác),
 * nên dò chữ là phải đoán đủ mọi ngôn ngữ và sót cái nào thì hồ sơ đó âm thầm
 * không được gỡ. Ở đây hỏi ngược lại: THỨ TA CẦN đã có trên trang chưa. Cách này
 * không phụ thuộc ngôn ngữ và gỡ được cả những kiểu hỏng khác chưa gặp bao giờ.
 */

const LOGIN_URL_RE = /^https:\/\/www\.tiktok\.com\/login(\/|\?|$)/

/**
 * Dấu hiệu "đây là một trang TikTok tử tế" khi chỗ gọi không nêu gì cụ thể hơn.
 *
 * Trang TikTok bình thường luôn rải rất nhiều thuộc tính `data-e2e` (chính
 * TikTok đặt cho test của họ). Trang lỗi thì gần như trống: một cái icon, một
 * dòng chữ, một cái nút — không có `data-e2e` nào. Đó là thứ phân biệt được hai
 * bên mà không cần đọc chữ.
 */
const ANY_TIKTOK_CONTENT = '[data-e2e]'

export type NavResult =
  /** Trang đã tải và có thứ ta cần. */
  | 'ok'
  /** TikTok đá về trang đăng nhập — phiên hết hạn, tải lại bao nhiêu lần cũng vô ích. */
  | 'login'
  /** Thử hết số lần vẫn không dùng được. */
  | 'failed'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Chờ tới khi trang dùng được, hoặc lộ ra là đã bị đá về đăng nhập.
 *
 * Vòng lặp thay vì `waitForSelector`: điều hướng phía client vẫn chạy tiếp SAU
 * khi goto trả về, nên phải kiểm tra URL xen kẽ chứ không thể chỉ đứng chờ một
 * phần tử — cùng lý do khiến AutomationRunner.probeUploadPage() cũng viết kiểu
 * này.
 */
async function waitUsable(page: Page, selector: string, timeoutMs: number): Promise<NavResult> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (LOGIN_URL_RE.test(page.url())) return 'login'
    try {
      const found = await page.evaluate((sel) => !!document.querySelector(sel), selector)
      if (found) return 'ok'
    } catch {
      /* đang điều hướng giữa chừng — thử lại ở vòng sau */
    }
    await sleep(500)
  }
  return LOGIN_URL_RE.test(page.url()) ? 'login' : 'failed'
}

/**
 * Đúng trang lỗi của TikTok hay chỉ là trang tải mãi không xong?
 *
 * CHỈ dùng để ghi log cho dễ lần, KHÔNG dùng để quyết định có tải lại hay không
 * — quyết định đó đã do waitUsable() lo, và nó không phụ thuộc ngôn ngữ. Sót
 * ngôn ngữ ở đây thì cùng lắm mất một dòng log.
 */
async function looksLikeErrorPage(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(() => {
      const t = document.body?.innerText ?? ''
      return /đã xảy ra lỗi|thử lại sau|something went wrong|try again later|出错了/i.test(t)
    })
  } catch {
    return false
  }
}

/**
 * @param expect  Phần tử chứng minh trang đã dùng được. Bỏ trống thì chỉ cần
 *                trang có nội dung TikTok bất kỳ — đủ để loại trang lỗi.
 * @param tries   Số lượt tải trang, tính cả lượt đầu.
 */
export async function gotoTiktok(
  page: Page,
  url: string,
  opts: {
    expect?: string
    timeout?: number
    tries?: number
    log?: (line: string) => void
  } = {}
): Promise<NavResult> {
  const navigate = page.goto.bind(page)
  const { result } = await navigateWithRetry(page, url, navigate, opts)
  return result
}

/**
 * Phần thử-lại dùng chung, tách khỏi `page.goto` để `installRetryGoto()` bọc
 * được chính hàm goto mà không tự gọi lại mình.
 */
async function navigateWithRetry(
  page: Page,
  url: string,
  navigate: (u: string, o: { waitUntil: 'domcontentloaded'; timeout: number }) => Promise<unknown>,
  opts: {
    expect?: string
    timeout?: number
    tries?: number
    log?: (line: string) => void
  }
): Promise<{ result: NavResult; response: unknown }> {
  const selector = opts.expect ?? ANY_TIKTOK_CONTENT
  const timeout = opts.timeout ?? 45_000
  const tries = Math.max(1, opts.tries ?? 3)
  const log = opts.log ?? ((): void => {})
  let response: unknown = null

  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      // Giữ lại response của CHÍNH lần điều hướng này — chỗ gọi cần trả nó về
      // nguyên vẹn. Điều hướng thêm một lần nữa chỉ để lấy response sẽ xoá đúng
      // cái trạng thái vừa chờ được.
      response = await navigate(url, { waitUntil: 'domcontentloaded', timeout })
    } catch {
      // Hết giờ hoặc mất mạng giữa chừng. Vẫn đi tiếp xuống waitUsable: có khi
      // trang đã tải đủ dùng rồi mà chỉ vài tài nguyên phụ còn treo.
      response = null
    }

    const r = await waitUsable(page, selector, timeout)
    if (r === 'ok') {
      if (attempt > 1) log(`✓ Tải lại lần ${attempt - 1} đã vào được ${url}`)
      return { result: 'ok', response }
    }
    // Phiên hết hạn thì tải lại vô nghĩa — trả về ngay để chỗ gọi bảo người dùng
    // đăng nhập lại, thay vì đốt hết số lượt rồi mới báo một lỗi mơ hồ.
    if (r === 'login') return { result: 'login', response }

    if (attempt < tries) {
      // Nghỉ tăng dần: lỗi choáng nhoáng thường qua trong vài giây, còn lúc
      // TikTok đang quá tải thì dồn dập chỉ làm nặng thêm.
      const wait = 3000 * 2 ** (attempt - 1)
      const why = (await looksLikeErrorPage(page)) ? 'TikTok báo lỗi' : 'trang không tải được'
      log(`↻ ${why} — nghỉ ${wait / 1000}s rồi tải lại (lần ${attempt}/${tries - 1})`)
      await sleep(wait)
    }
  }

  log(`✗ Thử ${tries} lần vẫn không vào được ${url}`)
  return { result: 'failed', response }
}

/**
 * Bọc `page.goto` của MỘT trang để mọi lần điều hướng sau đó tự tải lại khi
 * gặp trang lỗi.
 *
 * Dùng cho các kịch bản tự động (đăng bài, warm up, thao tác hàng loạt): script
 * của chúng nằm trong DB và người dùng sửa được, nên không thể đổi cú pháp script
 * để gọi một hàm mới — sửa file mẫu cũng không ăn vào template đã lưu. Bọc thẳng
 * đối tượng `page` mà runner đưa cho script thì script cũ chạy nguyên, không sửa
 * một dòng, mà vẫn được tự gỡ.
 *
 * Giữ nguyên chữ ký của `goto`: vào được thì trả về response như thường, thử hết
 * lượt vẫn hỏng thì ném lỗi — đúng thứ script vốn đã bắt và xử lý.
 */
export function installRetryGoto(page: Page, log?: (line: string) => void): void {
  const raw = page.goto.bind(page)
  const patched = async (
    url: string,
    options?: Parameters<Page['goto']>[1]
  ): Promise<Awaited<ReturnType<Page['goto']>>> => {
    // Chỉ lo cho TikTok. Trang khác (Chrome Web Store, ảnh, trang tiện ích...)
    // giữ nguyên hành vi gốc — không có `data-e2e` nên vòng chờ ở đây sẽ hiểu
    // nhầm là hỏng rồi tải lại vô ích.
    if (!/^https?:\/\/(www\.)?tiktok\.com\//i.test(url)) {
      return raw(url, options)
    }
    const { result, response } = await navigateWithRetry(
      page,
      url,
      (u, o) => raw(u, { ...options, ...o }),
      { log }
    )
    if (result === 'failed') throw new Error(`Không tải được ${url} sau 3 lần thử`)
    // 'login' không ném: script tự gọi checkLogin() và có nhánh xử lý riêng cho
    // phiên hết hạn, ném ở đây sẽ cướp mất nhánh đó.
    return response as Awaited<ReturnType<Page['goto']>>
  }
  page.goto = patched as Page['goto']
}
