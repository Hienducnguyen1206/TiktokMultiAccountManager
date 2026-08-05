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
 * Thu thập follower cho mọi profile có username TikTok.
 * Dùng MỘT phiên đọc dùng chung (ShardEngine.openReader() — headless, không
 * proxy) rồi lướt lần lượt từng @username trên cùng 1 page — follower TikTok
 * là dữ liệu công khai, không cần fingerprint/proxy/session riêng của từng
 * profile (xác nhận lại từ code gốc trước Task 6 — xem task-6-report.md,
 * Fix round 1, Finding 2). KHÔNG mở phiên automation riêng cho từng profile:
 * làm vậy vừa chậm hơn nhiều (mỗi profile phải khởi động 1 Chromium mới), vừa
 * có thể vô tình đóng nhầm phiên thật của profile đó nếu nó đang được mở ở
 * nơi khác — không có lý do kỹ thuật nào cần đánh đổi việc đó chỉ để đọc 1
 * con số công khai.
 *
 * Phiên đọc mở ở chế độ headless trước; nếu profile ĐẦU TIÊN không đọc được thì
 * mở lại đúng một lần bằng cửa sổ thật đẩy ra ngoài màn hình (headless=false) —
 * xem giải thích tại chỗ trong vòng lặp.
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

    // Mở phiên đọc dùng chung và trả về page đầu tiên đã gắn sẵn handler dialog.
    // Caller PHẢI gán kết quả .browser vào `browser` để finally ngoài cùng luôn
    // đóng đúng trình duyệt đang sống (đừng gán bên trong hàm này: gán trong
    // closure làm TypeScript mất luồng thu hẹp kiểu của biến ngoài).
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

    for (let i = 0; i < targets.length; i++) {
      const p = targets[i]
      const username = p.tiktokUsername
      const isFirst = i === 0
      log(`Đang đọc ${p.name} (${i + 1}/${targets.length})…`)

      // Lần đầu chờ lâu (45s) để vượt tường "Please wait"; sau đó phiên ấm → nhanh.
      let followers = await readFollowerOnPage(page, username, isFirst ? 45000 : 15000)

      if (followers === null && isFirst && headless) {
        // Profile ĐẦU TIÊN fail dưới headless → nhiều khả năng TikTok chặn thẳng
        // chế độ headless, không phải lỗi lẻ của riêng profile này. Mở lại bằng
        // cửa sổ thật đẩy ra ngoài màn hình rồi thử lại — ĐÚNG MỘT LẦN.
        // Bỏ nhánh này thì mọi profile ra null, AnalyticsStore.upsert không chạy,
        // hasDate(today()) mãi false, nên autoCollectIfNeeded() (chạy 8s sau khi
        // mở app và NUỐT MỌI LỖI) lặp lại y hệt mỗi lần khởi động: hỏng âm thầm,
        // không toast, không cờ lỗi, không tự phục hồi.
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
        followers = await readFollowerOnPage(page, username, 45000)
      } else if (followers === null) {
        // Retry 1 lần cho profile lỗi lẻ tẻ (private/tạm chặn/nhỡ điều hướng).
        await sleep(2500)
        followers = await readFollowerOnPage(page, username, 20000)
      }

      if (followers !== null) {
        AnalyticsStore.upsert(p.id, date, followers)
        ok++
        log(`${p.name}: ${followers} follower`)
      } else {
        failed++
        log(`${p.name}: không đọc được`)
      }

      if (i < targets.length - 1) await sleep(2500) // giãn nhẹ giữa các profile
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
        log(`Đọc số dư của ${signedIn.length} profile đang đăng nhập…`)
        for (let i = 0; i < signedIn.length; i++) {
          const p = signedIn[i]
          log(`Số dư ${p.name} (${i + 1}/${signedIn.length})…`)
          const r = await syncMonetization(p.id)
          log(r.ok ? `${p.name}: đã đọc số dư` : `${p.name}: ${r.reason ?? 'không đọc được số dư'}`)
        }
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
