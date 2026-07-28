import { spawn, type ChildProcess } from 'child_process'
import { rmSync, mkdirSync } from 'fs'
import { join } from 'path'
import { EventEmitter } from 'events'
import { app } from 'electron'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { ensureEngine } from './EngineManager'
import { waitForWsEndpoint } from './AutomationRunner'
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

/** User-data-dir RIÊNG cho browser đọc analytics — giữ nguyên giữa các lần thu
 *  thập để phiên luôn "ấm" (cookie ttwid/msToken còn hạn → không phải vượt lại
 *  tường chống bot "Please wait" mỗi lần). Follower là dữ liệu công khai nên
 *  không cần session/proxy của từng profile. */
function readerDir(): string {
  const dir = join(app.getPath('userData'), 'data', 'analytics-browser')
  mkdirSync(dir, { recursive: true })
  return dir
}

interface Reader {
  browser: Browser
  child: ChildProcess
  page: Page
}

/** Mở 1 browser đọc dùng chung. headless=true → không cửa sổ (nhẹ, vô hình);
 *  false → cửa sổ thật đặt ngoài màn hình (fallback khi headless bị chặn). */
async function launchReader(headless: boolean): Promise<Reader> {
  const enginePath = await ensureEngine()
  const udd = readerDir()
  try { rmSync(join(udd, 'DevToolsActivePort'), { force: true }) } catch { /* ignore */ }

  const args = [
    `--user-data-dir=${udd}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    '--remote-allow-origins=*'
  ]
  if (headless) args.push('--headless=new')
  else args.push('--window-position=-32000,-32000')

  const child = spawn(enginePath, args, { stdio: 'ignore' })
  trackProc(child)
  child.on('error', (e) => log(`Lỗi engine: ${(e as Error).message}`))
  const ws = await waitForWsEndpoint(udd)
  const browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null })
  const pages = await browser.pages()
  const page: Page = pages[0] ?? (await browser.newPage())
  page.on('dialog', async (d) => { try { await d.dismiss() } catch { /* ignore */ } })
  return { browser, child, page }
}

async function closeReader(r: Reader | null): Promise<void> {
  if (!r) return
  try { await r.browser.close() } catch { /* ignore */ }
  await new Promise<void>((resolve) => {
    if (r.child.exitCode !== null || r.child.killed) return resolve()
    const t = setTimeout(() => { try { r.child.kill() } catch { /* ignore */ } resolve() }, 6000)
    r.child.once('exit', () => { clearTimeout(t); resolve() })
  })
}

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
 * Thu thập follower cho mọi profile có username TikTok.
 * Dùng MỘT browser headless duy nhất, warm-up 1 lần rồi lướt lần lượt từng
 * @username (mỗi lần chỉ vài giây) — nhanh hơn nhiều so với mở/tắt từng profile,
 * và ít bị chặn vì tái dùng phiên đã vượt thử thách.
 */
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

export async function collectAll(): Promise<CollectResult> {
  if (busy) return { ok: 0, failed: 0 }
  busy = true
  const date = today()
  let ok = 0
  let failed = 0
  let reader: Reader | null = null

  try {
    // Follower là dữ liệu công khai → chỉ cần có username (không bắt buộc login).
    const targets = ProfileStore.list().filter((p) => p.tiktokUsername)
    if (targets.length === 0) {
      log('Không có profile nào có username TikTok để đọc.')
      return { ok: 0, failed: 0 }
    }
    log(`Bắt đầu thu thập ${targets.length} profile…`)

    let headless = true
    log('Mở trình đọc (headless)…')
    reader = await launchReader(headless)

    for (let i = 0; i < targets.length; i++) {
      const p = targets[i]
      const username = p.tiktokUsername
      const isFirst = i === 0
      log(`Đang đọc ${p.name} (${i + 1}/${targets.length})…`)

      // Lần đầu chờ lâu (45s) để vượt tường "Please wait"; sau đó phiên ấm → nhanh.
      let followers = await readFollowerOnPage(reader.page, username, isFirst ? 45000 : 15000)

      if (followers === null && isFirst && headless) {
        // Headless không vượt được ngay từ profile đầu → chuyển sang cửa sổ ẩn.
        log('Headless chưa qua — chuyển chế độ ẩn màn hình…')
        await closeReader(reader)
        headless = false
        reader = await launchReader(headless)
        followers = await readFollowerOnPage(reader.page, username, 45000)
      } else if (followers === null) {
        // Retry 1 lần cho profile lỗi lẻ tẻ (private/tạm chặn/nhỡ điều hướng).
        await sleep(2500)
        followers = await readFollowerOnPage(reader.page, username, 20000)
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

    log(`Xong: ${ok} thành công, ${failed} lỗi`)
    return { ok, failed }
  } finally {
    await closeReader(reader)
    busy = false
  }
}
