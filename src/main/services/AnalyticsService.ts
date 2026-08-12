import { EventEmitter } from 'events'
import { type Browser, type Page } from 'puppeteer-core'
import { openReader, closeReader } from './ShardEngine'
import { trackProc } from './EngineProcs'
import { ProfileStore } from './ProfileStore'
import { AnalyticsStore } from './AnalyticsStore'
import { syncMonetization } from './TikTokSync'
import type { CollectResult } from '@shared/types'

export const analyticsEvents = new EventEmitter()

function log(msg: string): void {
  analyticsEvents.emit('progress', msg)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function today(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

let busy = false

/** Điều hướng tới @username trên page dùng chung, chờ tối đa timeoutMs để đọc
 *  follower (rehydration hoặc DOM). Trả null nếu không đọc được. */
async function readFollowerOnPage(page: Page, username: string, timeoutMs: number): Promise<number | null> {
  try {
    await page.goto(`https://www.tiktok.com/@${username}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  } catch {
    return null
  }
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    let n: number | null = null
    try {
      n = await page.evaluate(() => {
        try {
          const raw = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__')?.textContent
          if (raw) {
            const scope = (JSON.parse(raw)?.__DEFAULT_SCOPE__ ?? {}) as Record<string, any>
            const c = scope['webapp.user-detail']?.userInfo?.stats?.followerCount
            if (typeof c === 'number') return c
          }
          const el = document.querySelector('[data-e2e="followers-count"]')
          const txt = el?.textContent?.trim()
          if (txt && /^[\d.,KMBkmb]+$/.test(txt)) {
            const m = txt.replace(/,/g, '')
            const mul = /K/i.test(m) ? 1e3 : /M/i.test(m) ? 1e6 : /B/i.test(m) ? 1e9 : 1
            const num = parseFloat(m) * mul
            if (!isNaN(num)) return Math.round(num)
          }
        } catch { /* ignore */ }
        return null
      })
    } catch {
      /* trang đang điều hướng (context destroyed) → thử lại lượt sau */
    }
    if (typeof n === 'number') return n
    await sleep(1000)
  }
  return null
}

/**
 * Tự thu thập 1 lần/ngày khi mở app: nếu hôm nay CHƯA có dữ liệu thì chạy nền.
 * Nhờ lưu theo (profile, ngày), mỗi ngày có 1 mốc → cột "Hôm nay" so được với
 * ngày trước. Chạy im lặng, nuốt lỗi để không ảnh hưởng khởi động.
 */
export async function autoCollectIfNeeded(): Promise<void> {
  try {
    if (AnalyticsStore.hasDate(today())) return
    log('Tự thu thập follower cho hôm nay…')
    // KHÔNG đọc số dư ở đây: bước đó phải mở một Chromium riêng cho từng profile
    // đã đăng nhập, mỗi cái ~20 giây. Chạy nền lúc mở app thì người dùng chịu
    // toàn bộ chi phí đó mà không hề yêu cầu. Nút "Thu thập ngay" mới làm.
    await collectAll(false)
  } catch {
    /* lỗi thu thập nền — bỏ qua */
  }
}

/**
 * Số tab đọc song song trong phiên đọc dùng chung.
 *
 * Đo thật trên 18 hồ sơ của máy này (Chromium 149 của ShardX, trang công khai):
 *   tuần tự, giãn 2,5s mỗi acc → 3,33 giây/acc
 *   4 tab song song, không giãn → 5,5 giây cho CẢ 18 acc, đọc được 18/18
 * Tức nhanh hơn khoảng 11 lần mà không hề bị TikTok siết. Phần lớn thời gian cũ
 * nằm ở chỗ ngủ giữa hai acc chứ không phải ở việc tải trang: số follower nằm
 * sẵn trong JSON nhúng của lần tải đầu.
 *
 * Đã THỬ nâng lên 10 rồi quay lại 4. Đo trên chính máy này:
 *   4 tab, 18 trang, 1 lần/ngày  → 18/18, tám ngày liên tiếp (dữ liệu thật)
 *   10 tab, 18 trang, một lượt   → 0/18, và ngay sau đó một trang lẻ cũng 403
 *   nhiều lượt liên tiếp         → HTTP 403 "Access Denied" ở tầng CDN cho MỌI
 *                                  trang, tự hết sau ít phút
 * Thứ TikTok phản ứng là TỐC ĐỘ request trên một IP, không phải số tab; 10 tab
 * chỉ dồn cùng một khối lượng vào khoảng thời gian ngắn hơn. Muốn nhanh hơn 4
 * tab thì phải giãn cách giữa các lượt tải, không phải mở thêm tab.
 */
const READ_POOL = 4

/**
 * Số hồ sơ đọc số dư cùng lúc. Mỗi hồ sơ là MỘT Chromium riêng kèm proxy và vân
 * tay của nó, nặng hơn hẳn một tab.
 *
 * Nâng 2 → 4 theo yêu cầu, và chạy headless (xem BALANCE_HEADLESS) nên mỗi tiến
 * trình nhẹ hơn hẳn bản có cửa sổ: không cửa sổ, không GPU compositor, không
 * render. Đo trên máy này: 15,9 GB RAM tổng, ~4,9 GB trống lúc app đang mở.
 */
const BALANCE_POOL = 4

/**
 * Đọc số dư bằng headless.
 *
 * Khác pha đọc follower ở một điểm quan trọng: pha này mở HỒ SƠ ĐÃ ĐĂNG NHẬP và
 * vào TikTok Studio, tức trang bị soi kỹ hơn trang công khai nhiều. Chưa có số
 * đo nào cho biết TikTok Studio có chịu headless hay không, nên bật kèm luôn
 * lưới an toàn giống pha 1: hồ sơ ĐẦU TIÊN mà đọc không ra thì chuyển cả phần
 * còn lại về cửa sổ thật (đẩy ngoài màn hình) và đọc lại chính hồ sơ đó.
 *
 * Thiếu lưới này, nếu headless bị chặn thì mọi hồ sơ trả về rỗng, setMonetization
 * không chạy, và không ai biết gì cả — đúng kiểu hỏng âm thầm.
 */
const BALANCE_HEADLESS = true

/**
 * Thu thập follower cho mọi profile có username TikTok.
 * Dùng MỘT phiên đọc dùng chung (ShardEngine.openReader() — headless, không
 * proxy) rồi lướt từng @username trên các tab của cùng phiên đó — follower
 * TikTok là dữ liệu công khai, không cần fingerprint/proxy/session riêng của
 * từng profile. KHÔNG mở phiên automation riêng cho từng profile: làm vậy vừa
 * chậm hơn nhiều (mỗi profile phải khởi động 1 Chromium mới), vừa có thể vô
 * tình đóng nhầm phiên thật của profile đó nếu nó đang được mở ở nơi khác.
 *
 * Phiên đọc mở ở chế độ headless trước; nếu profile ĐẦU TIÊN không đọc được thì
 * mở lại đúng một lần bằng cửa sổ thật đẩy ra ngoài màn hình (headless=false).
 * Vì thế hồ sơ đầu tiên luôn đọc một mình, phần còn lại mới chia cho các tab.
 */
export async function collectAll(withMonetization = false): Promise<CollectResult> {
  if (busy) return { ok: 0, failed: 0 }
  busy = true
  const date = today()
  let ok = 0
  let failed = 0
  let browser: Browser | null = null

  try {
    // Follower là dữ liệu công khai → chỉ cần có username (không bắt buộc login).
    const targets = ProfileStore.list().filter((p) => p.tiktokUsername)
    if (targets.length === 0) {
      log('Không có profile nào có username TikTok để đọc.')
      return { ok: 0, failed: 0 }
    }
    log(`Bắt đầu thu thập ${targets.length} profile…`)

    const openPage = async (hl: boolean): Promise<{ browser: Browser; page: Page }> => {
      const { browser: b, session } = await openReader(hl)
      trackProc(session.process)
      const pages = await b.pages()
      const pg: Page = pages[0] ?? (await b.newPage())
      pg.on('dialog', async (d) => { try { await d.dismiss() } catch { /* ignore */ } })
      return { browser: b, page: pg }
    }

    let headless = true
    log('Mở trình đọc (headless)…')
    let opened = await openPage(headless)
    browser = opened.browser
    let page = opened.page

    const save = (p: (typeof targets)[number], followers: number | null): void => {
      if (followers !== null) {
        AnalyticsStore.upsert(p.id, date, followers)
        ok++
        log(`${p.name}: ${followers} follower`)
      } else {
        failed++
        log(`${p.name}: không đọc được`)
      }
    }

    // ── Hồ sơ đầu tiên: đọc một mình để còn dò được chế độ ────────────────────
    //
    // Chờ lâu (45s) vì lần đầu hay đụng tường "Please wait"; xong lần này thì
    // phiên ấm, các tab sau nhanh hẳn.
    const first = targets[0]
    log(`Đang đọc ${first.name} (1/${targets.length})…`)
    let firstCount = await readFollowerOnPage(page, first.tiktokUsername, 45000)

    if (firstCount === null && headless) {
      // Hồ sơ ĐẦU TIÊN hỏng dưới headless → nhiều khả năng TikTok chặn thẳng chế
      // độ headless chứ không phải lỗi lẻ của riêng hồ sơ này. Mở lại bằng cửa
      // sổ thật đẩy ra ngoài màn hình rồi thử lại — ĐÚNG MỘT LẦN.
      // Bỏ nhánh này thì mọi hồ sơ ra null, AnalyticsStore.upsert không chạy,
      // hasDate(today()) mãi false, nên autoCollectIfNeeded() (chạy 8s sau khi
      // mở app và NUỐT MỌI LỖI) lặp lại y hệt mỗi lần khởi động: hỏng âm thầm.
      log('Headless chưa qua — chuyển chế độ ẩn màn hình…')
      if (browser) {
        try {
          await browser.close()
        } catch {
          /* ignore */
        }
      }
      await closeReader()
      browser = null
      headless = false
      opened = await openPage(headless)
      browser = opened.browser
      page = opened.page
      firstCount = await readFollowerOnPage(page, first.tiktokUsername, 45000)
    }
    save(first, firstCount)

    // ── Phần còn lại: chia cho các tab chạy song song ─────────────────────────
    const queue = targets.slice(1)
    if (queue.length) {
      const lanes: Page[] = [page] // tái dùng tab đã ấm, khỏi tải lại từ đầu
      for (let i = 1; i < Math.min(READ_POOL, queue.length + 1); i++) {
        const pg = await browser.newPage()
        pg.on('dialog', async (d) => { try { await d.dismiss() } catch { /* ignore */ } })
        lanes.push(pg)
      }
      let done = 1
      await Promise.all(
        lanes.map(async (pg) => {
          for (;;) {
            const p = queue.shift()
            if (!p) break
            log(`Đang đọc ${p.name} (${++done}/${targets.length})…`)
            let n = await readFollowerOnPage(pg, p.tiktokUsername, 15000)
            // Thử lại một lần cho hồ sơ hỏng lẻ tẻ (riêng tư / nhỡ điều hướng).
            if (n === null) {
              await sleep(1500)
              n = await readFollowerOnPage(pg, p.tiktokUsername, 20000)
            }
            save(p, n)
          }
        })
      )
      // Đóng tab phụ, giữ lại tab đầu cho phần finally xử lý cùng browser.
      for (const pg of lanes.slice(1)) await pg.close().catch(() => undefined)
    }

    // ── Giai đoạn 2: số dư + trạng thái kiếm tiền ────────────────────────────
    //
    // Tách hẳn khỏi phần follower ở trên vì đây là loại dữ liệu khác: nó nằm sau
    // đăng nhập, nên KHÔNG dùng được phiên đọc dùng chung — mỗi profile phải mở
    // Chromium riêng của chính nó (~20 giây/profile). Vì thế chỉ chạy khi người
    // dùng bấm nút, và chỉ cho profile đang đăng nhập.
    //
    // Phiên đọc dùng chung phải ĐÓNG trước khi sang đây, nếu không hai trình
    // duyệt cùng sống vô ích suốt cả vòng lặp.
    if (withMonetization) {
      if (browser) {
        try {
          await browser.close()
        } catch {
          /* ignore */
        }
        browser = null
      }
      await closeReader()

      const signedIn = ProfileStore.list().filter((p) => p.loggedIn && p.status !== 'running')
      if (signedIn.length === 0) {
        log('Không có profile nào đang đăng nhập để đọc số dư.')
      } else {
        log(`Đọc số dư của ${signedIn.length} profile đang đăng nhập${BALANCE_HEADLESS ? ' (headless)' : ''}…`)
        const bq = [...signedIn]
        let bdone = 0
        let bHeadless = BALANCE_HEADLESS

        // Hồ sơ ĐẦU TIÊN đọc một mình để còn dò được chế độ — y hệt pha follower.
        const first = bq.shift()!
        log(`Số dư ${first.name} (${++bdone}/${signedIn.length})…`)
        let r0 = await syncMonetization(first.id, bHeadless)
        if (!r0.ok && bHeadless) {
          // Hỏng ngay hồ sơ đầu dưới headless → nhiều khả năng TikTok Studio
          // chặn thẳng chế độ này chứ không phải lỗi lẻ. Hạ xuống cửa sổ thật
          // (vẫn ngoài màn hình) cho CẢ phần còn lại, và thử lại đúng một lần.
          log('Headless chưa qua ở bước số dư — chuyển chế độ ẩn màn hình…')
          bHeadless = false
          r0 = await syncMonetization(first.id, bHeadless)
        }
        log(r0.ok ? `${first.name}: đã đọc số dư` : `${first.name}: ${r0.reason ?? 'không đọc được số dư'}`)

        await Promise.all(
          Array.from({ length: Math.min(BALANCE_POOL, bq.length) }, async () => {
            for (;;) {
              const p = bq.shift()
              if (!p) break
              log(`Số dư ${p.name} (${++bdone}/${signedIn.length})…`)
              const r = await syncMonetization(p.id, bHeadless)
              log(r.ok ? `${p.name}: đã đọc số dư` : `${p.name}: ${r.reason ?? 'không đọc được số dư'}`)
            }
          })
        )
      }
    }

    log(`Xong: ${ok} thành công, ${failed} lỗi`)
    return { ok, failed }
  } finally {
    if (browser) {
      try {
        await browser.close()
      } catch {
        /* ignore */
      }
    }
    await closeReader()
    busy = false
  }
}
