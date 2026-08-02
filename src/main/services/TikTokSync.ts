import { type Browser } from 'puppeteer-core'
import { openAutomation, closeSession } from './ShardEngine'
import { trackProc } from './EngineProcs'
import { ProfileStore } from './ProfileStore'

export interface SyncResult {
  ok: boolean
  username?: string
  reason?: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Mở profile bằng chính fingerprint-chromium của nó (qua CDP, cửa sổ đặt ngoài
 * màn hình), đọc @username TikTok đang đăng nhập rồi đặt lại tên profile.
 * Không mở được nếu profile đang chạy thủ công (trùng userDataDir).
 */
export async function syncTiktokName(profileId: string): Promise<SyncResult> {
  const profile = ProfileStore.get(profileId)
  if (!profile) return { ok: false, reason: 'Không tìm thấy profile' }
  if (profile.status === 'running') return { ok: false, reason: 'Đóng profile trước khi đồng bộ' }

  let browser: Browser | null = null
  try {
    const { browser: b, session } = await openAutomation(profile)
    browser = b
    trackProc(session.process)
    const pages = await browser.pages()
    const page = pages[0] ?? (await browser.newPage())
    page.on('dialog', async (d) => {
      try {
        await d.accept()
      } catch {
        /* ignore */
      }
    })

    await page.goto('https://www.tiktok.com/', { waitUntil: 'domcontentloaded' })

    // Đọc @username của CHÍNH tài khoản đang đăng nhập (không lấy nhầm link creator ở feed):
    //  a) dữ liệu rehydration nhúng sẵn trong HTML, hoặc
    //  b) link profile trên thanh nav.
    const readUsername = (): Promise<string> =>
      page.evaluate(() => {
        try {
          const raw = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__')?.textContent
          if (raw) {
            const scope = (JSON.parse(raw)?.__DEFAULT_SCOPE__ ?? {}) as Record<string, any>
            const u = scope['webapp.app-context']?.user
            if (u?.uniqueId) return String(u.uniqueId)
          }
        } catch {
          /* ignore */
        }
        const href = document.querySelector('[data-e2e="nav-profile"]')?.getAttribute('href') || ''
        const m = href.match(/\/@([^/?#]+)/)
        return m ? m[1] : ''
      }) as Promise<string>

    // TikTok là SPA, header render trễ và phụ thuộc proxy → poll tới ~20s thay vì
    // chờ cố định. Cookie sessionid phân biệt "chưa đăng nhập" với "render chậm".
    const deadline = Date.now() + 20_000
    let username = ''
    let hasSession = false
    while (Date.now() < deadline) {
      const cookies = await page.cookies('https://www.tiktok.com')
      hasSession = cookies.some((c) => c.name === 'sessionid' && !!c.value)
      username = await readUsername()
      if (username) break
      if (!hasSession) break // chắc chắn chưa đăng nhập → khỏi chờ
      await sleep(1500)
    }

    // Đồng bộ cả trạng thái đăng nhập theo cookie sessionid (nguồn chuẩn).
    ProfileStore.setLoggedIn(profileId, hasSession)
    if (username) {
      ProfileStore.rename(profileId, username)
      return { ok: true, username }
    }
    if (hasSession) return { ok: false, reason: 'Đã đăng nhập nhưng chưa đọc được username — thử lại' }
    return { ok: false, reason: 'Chưa đăng nhập TikTok' }
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message || 'Lỗi đồng bộ' }
  } finally {
    try {
      if (browser) await browser.close()
    } catch {
      /* ignore */
    }
    await closeSession(profile.id)
    ProfileStore.setRunning(profile.id, false)
  }
}
