import { type Browser, type Page } from 'puppeteer-core'
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
 * Ảnh đại diện của tài khoản đang đăng nhập, trả về dạng data URL.
 *
 * Ảnh được tải BẰNG CHÍNH TRANG (fetch trong page), không phải bằng Node ở
 * main process: request đi qua proxy của profile như mọi request khác của nó,
 * chứ không rời máy bằng IP thật. Đã đo trên tài khoản thật — CDN của TikTok
 * cho phép CORS, ảnh về là JPEG ~13KB.
 *
 * Lưu nội dung chứ không lưu link vì link CDN của TikTok có hạn dùng.
 * Trả '' nếu không tìm/tải được — khi đó ô avatar để trống, không phải lỗi.
 */
async function readAvatar(page: Page): Promise<string> {
  try {
    // PHẢI chờ: username đọc được ngay từ blob nhúng sẵn trong HTML, còn thanh
    // nav là client-render. Đo trên tài khoản thật qua proxy Hàn, ô avatar mãi
    // giây thứ 8 mới có mặt — đọc thẳng không chờ thì lần nào cũng ra rỗng.
    await page.waitForSelector('[data-e2e="nav-profile"] img', { timeout: 15000 })
    const url = await page.evaluate(() => {
      const img = document.querySelector('[data-e2e="nav-profile"] img') as HTMLImageElement | null
      return img?.src ?? ''
    })
    if (!url) return ''
    const data = await page.evaluate(async (src: string) => {
      try {
        const res = await fetch(src)
        if (!res.ok) return ''
        const blob = await res.blob()
        if (!blob.type.startsWith('image/')) return ''
        if (blob.size > 400_000) return '' // chặn ảnh bất thường to, đừng phình DB
        return await new Promise<string>((ok) => {
          const fr = new FileReader()
          fr.onload = () => ok(String(fr.result))
          fr.onerror = () => ok('')
          fr.readAsDataURL(blob)
        })
      } catch {
        return ''
      }
    }, url)
    return data
  } catch {
    return '' // trang đang điều hướng / mất kết nối — bỏ qua, tên vẫn đồng bộ được
  }
}

/**
 * Số dư và trạng thái Creator Rewards, đọc ở /tiktokstudio/monetization.
 *
 * Trang bày mỗi chương trình thành đúng ba dòng liên tiếp — tên, mô tả, trạng
 * thái — nên trạng thái là dòng thứ hai sau dòng mang tên chương trình:
 *
 *   Chương trình Creator Rewards
 *   Tạo video dài hơn 1 phút để nhận thưởng nhờ lượt xem đạt tiêu chuẩn.
 *   Không đủ điều kiện
 *
 * Neo vào "Creator Rewards" chứ không vào chữ tiếng Việt quanh nó: đó là tên
 * riêng, TikTok giữ nguyên ở mọi ngôn ngữ, nên profile đặt ngôn ngữ khác vẫn
 * khớp. Ngược lại, bản thân nhãn trạng thái BỊ dịch — nên lưu nguyên văn và
 * hiển thị lại y như vậy, không cố phân loại đủ/không đủ điều kiện.
 *
 * Số dư lấy cụm tiền ĐẦU TIÊN trên trang: khối "Phân tích phần thưởng" nằm trên
 * cùng và ô "Tổng" của nó là con số duy nhất được in kèm ký hiệu tiền tệ.
 *
 * `active` mới là thứ đáng tin để biết đã kích hoạt hay chưa: ô trạng thái là một
 * <button data-disabled="true|false"> — khóa khi chưa đủ điều kiện, bấm được khi
 * đã tham gia. Thuộc tính đó KHÔNG bị dịch, khác hẳn chữ bên trong nút. Trang này
 * không có id/data-e2e nào để neo (đã dò cả bảy đời tổ tiên, toàn class băm kiểu
 * `css-a44jsg` đổi theo mỗi lần build), nên cách định vị vẫn là leo từ chữ
 * "Creator Rewards" — tên riêng, không bị dịch — lên tới hàng chứa nó.
 *
 * Trả về chuỗi rỗng / null cho phần nào không đọc được — không phải lỗi, chỉ là
 * tài khoản chưa có mục đó.
 */
async function readMonetization(
  page: Page
): Promise<{ balance: string; monetization: string; active: boolean | null }> {
  const empty = { balance: '', monetization: '', active: null }
  try {
    await page.goto('https://www.tiktok.com/tiktokstudio/monetization', {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    })
    // Trang là SPA: sau domcontentloaded body gần như trống, nội dung đến sau.
    for (let i = 0; i < 12; i++) {
      const len = await page.evaluate(() => (document.body?.innerText ?? '').length)
      if (len > 400) break
      await sleep(2000)
    }
    return await page.evaluate(() => {
      const lines = (document.body?.innerText ?? '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
      const money = lines.join('\n').match(/(?:US\$|\$|₫)\s?[\d.,]+|[\d.,]+\s?(?:₫|VND)\b/)
      const i = lines.findIndex((l) => /Creator Rewards/i.test(l))

      // Nút trạng thái của ĐÚNG hàng Creator Rewards. Leo dần lên từ ô chữ; dừng
      // ở tầng đầu tiên có nút. Nếu một tầng chứa từ 2 nút trở lên nghĩa là đã
      // trèo quá hàng sang cả khối chứa nhiều chương trình → bỏ, thà không biết
      // còn hơn lấy trạng thái của chương trình khác.
      let active: boolean | null = null
      let node: Element | null = null
      for (const el of document.querySelectorAll('*')) {
        if (el.children.length === 0 && /Creator Rewards/i.test(el.textContent ?? '')) {
          node = el
          break
        }
      }
      for (let box = node, k = 0; box?.parentElement && k < 6; k++) {
        box = box.parentElement
        const btns = box.querySelectorAll('button[data-disabled]')
        if (btns.length === 1) {
          active = btns[0].getAttribute('data-disabled') !== 'true'
          break
        }
        if (btns.length > 1) break
      }

      return {
        balance: money?.[0] ?? '',
        monetization: i >= 0 ? (lines[i + 2] ?? '') : '',
        active
      }
    })
  } catch {
    return empty // không vào được trang (chưa đăng nhập / mạng lỗi) — bỏ qua
  }
}

/**
 * Chỉ đọc số dư + trạng thái kiếm tiền, KHÔNG đụng tên hay avatar.
 *
 * Dành cho nút "Thu thập ngay" ở tab Analytics: nó cần hai con số này cho từng
 * profile, nhưng không có lý do gì để đổi tên profile hay tải lại ảnh đại diện.
 * Phải mở phiên riêng của profile (không dùng chung phiên đọc như phần follower)
 * vì trang TikTok Studio chỉ hiện khi đã đăng nhập bằng chính tài khoản đó.
 */
export async function syncMonetization(profileId: string): Promise<SyncResult> {
  const profile = ProfileStore.get(profileId)
  if (!profile) return { ok: false, reason: 'Không tìm thấy profile' }
  if (profile.status === 'running') return { ok: false, reason: 'Profile đang mở' }

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

    const money = await readMonetization(page)
    if (!money.balance && !money.monetization && money.active === null) {
      return { ok: false, reason: 'Không đọc được (chưa đăng nhập?)' }
    }
    ProfileStore.setMonetization(profileId, money.balance, money.monetization, money.active)
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message || 'Lỗi đọc số dư' }
  } finally {
    // Cùng lý do như finally của syncTiktokName(): chỉ dọn khi CHÍNH lần gọi này
    // mở được browser.
    if (browser) {
      try {
        await browser.close()
      } catch {
        /* ignore */
      }
      await closeSession(profile.id)
      ProfileStore.setRunning(profile.id, false)
    }
  }
}

/**
 * Mở profile bằng chính engine ShardX của nó (qua CDP, cửa sổ đặt ngoài màn
 * hình), đọc @username TikTok đang đăng nhập rồi đặt lại tên profile, lấy ảnh
 * đại diện, số dư và trạng thái kiếm tiền. Không mở được nếu profile đang chạy
 * thủ công (trùng userDataDir).
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
      const avatar = await readAvatar(page)
      if (avatar) ProfileStore.setAvatar(profileId, avatar)
      // Sau avatar: bước này ĐIỀU HƯỚNG sang TikTok Studio, nên mọi thứ đọc từ
      // trang chủ phải xong trước khi gọi.
      const money = await readMonetization(page)
      if (money.balance || money.monetization || money.active !== null) {
        ProfileStore.setMonetization(profileId, money.balance, money.monetization, money.active)
      }
      return { ok: true, username }
    }
    if (hasSession) return { ok: false, reason: 'Đã đăng nhập nhưng chưa đọc được username — thử lại' }
    return { ok: false, reason: 'Chưa đăng nhập TikTok' }
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message || 'Lỗi đồng bộ' }
  } finally {
    // CHỈ đụng tới session/cờ running khi CHÍNH lần gọi này mở được browser —
    // xem giải thích đầy đủ trong finally của TikTokLogin.loginProfile()
    // (review Fix round 1, Finding 1: closeSession/setRunning tra theo
    // profile.id trong state dùng chung, không phân biệt ai gọi).
    if (browser) {
      try {
        await browser.close()
      } catch {
        /* ignore */
      }
      await closeSession(profile.id)
      ProfileStore.setRunning(profile.id, false)
    }
  }
}
