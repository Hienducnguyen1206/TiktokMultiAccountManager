import { EventEmitter } from 'events'
import { type Browser, type Page } from 'puppeteer-core'
import { openAutomation, closeSession } from './ShardEngine'
import { trackProc } from './EngineProcs'
import { ProfileStore } from './ProfileStore'
import { AnalyticsStore } from './AnalyticsStore'
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
    await collectAll()
  } catch {
    /* lỗi thu thập nền — bỏ qua */
  }
}

/**
 * Thu thập follower cho mọi profile có username TikTok.
 * Mỗi profile được mở RIÊNG qua openAutomation() (đúng fingerprint + proxy của
 * chính nó) để đọc @username của nó — khác với reader dùng chung trước đây,
 * cách này khiến proxy HTTP có mật khẩu hoạt động đúng (SDK tự lo auth) và
 * follower luôn được đọc qua danh tính/IP hợp lệ của từng profile.
 */
export async function collectAll(): Promise<CollectResult> {
  if (busy) return { ok: 0, failed: 0 }
  busy = true
  const date = today()
  let ok = 0
  let failed = 0

  try {
    // Follower là dữ liệu công khai → chỉ cần có username (không bắt buộc login).
    const targets = ProfileStore.list().filter((p) => p.tiktokUsername)
    if (targets.length === 0) {
      log('Không có profile nào có username TikTok để đọc.')
      return { ok: 0, failed: 0 }
    }
    log(`Bắt đầu thu thập ${targets.length} profile…`)

    for (let i = 0; i < targets.length; i++) {
      const p = targets[i]
      const username = p.tiktokUsername
      log(`Đang đọc ${p.name} (${i + 1}/${targets.length})…`)

      let browser: Browser | null = null
      try {
        const { browser: b, session } = await openAutomation(p)
        browser = b
        trackProc(session.process)
        const pages = await browser.pages()
        const page: Page = pages[0] ?? (await browser.newPage())
        page.on('dialog', async (d) => { try { await d.dismiss() } catch { /* ignore */ } })

        // Mỗi profile là một phiên nguội (không còn reader dùng chung "ấm") →
        // luôn chờ đủ lâu để vượt tường chống bot "Please wait" nếu gặp.
        let followers = await readFollowerOnPage(page, username, 45000)
        if (followers === null) {
          // Retry 1 lần cho lỗi lẻ tẻ (private/tạm chặn/nhỡ điều hướng).
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
      } catch (e) {
        failed++
        log(`${p.name}: lỗi mở trình duyệt — ${(e as Error)?.message || 'không rõ'}`)
      } finally {
        try {
          if (browser) await browser.close()
        } catch {
          /* ignore */
        }
        await closeSession(p.id)
        ProfileStore.setRunning(p.id, false)
      }

      if (i < targets.length - 1) await sleep(2500) // giãn nhẹ giữa các profile
    }

    log(`Xong: ${ok} thành công, ${failed} lỗi`)
    return { ok, failed }
  } finally {
    busy = false
  }
}
