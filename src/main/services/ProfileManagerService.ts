import { type Browser, type ElementHandle, type HTTPResponse, type Page } from 'puppeteer-core'
import { openAutomation, closeSession } from './ShardEngine'
import { trackProc } from './EngineProcs'
import { ProfileStore } from './ProfileStore'
import { humanClick } from './TikTokLogin'
import type {
  AccountPrivacy,
  AccountPrivacyPatch,
  AudienceScope,
  Profile,
  TiktokAccount,
  TiktokVideo,
  VideoPrivacy
} from '@shared/types'

/**
 * Thông tin sâu của tài khoản cho tab Profile Manager.
 *
 * Dữ liệu KHÔNG lưu xuống DB — chỉ nằm trong bộ nhớ tiến trình chính và mất khi
 * tắt app, đúng như yêu cầu. Cache đặt ở main (không phải ở renderer) vì đổi tab
 * làm React tháo cả cây component; để ở renderer thì mỗi lần chuyển qua tab khác
 * rồi quay lại là mất trắng 34 giây vừa tải.
 */
const cache = new Map<string, TiktokAccount>()

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const rand = (min: number, max: number): number => min + Math.random() * (max - min)

/**
 * "1,234" → 1234 · "5.5K" → 5500 · "217,8K" → 217800
 *
 * TikTok trộn hai quy ước ngay trên cùng một trang: số nguyên dùng dấu phân nhóm
 * ("4,702"), số rút gọn dùng dấu thập phân ("5.5K", "217,8K" tùy ngôn ngữ). Phân
 * biệt bằng CÓ hậu tố K/M/B hay không, chứ không đoán theo loại dấu.
 */
function parseCount(raw: string): number {
  const s = raw.trim()
  const m = s.match(/^([\d.,]+)\s*([KMB])$/i)
  if (m) {
    const mul = m[2].toUpperCase() === 'K' ? 1e3 : m[2].toUpperCase() === 'M' ? 1e6 : 1e9
    return Math.round(parseFloat(m[1].replace(',', '.')) * mul)
  }
  const n = parseInt(s.replace(/[.,\s]/g, ''), 10)
  return Number.isFinite(n) ? n : 0
}

// ── Nghe JSON thay vì bóc DOM ───────────────────────────────────────────────
//
// Bắt gói lúc trang tải cho thấy MỌI con số đều tới bằng JSON, endpoint đặt tên
// rõ ràng. Đọc thẳng ở đó tốt hơn bóc chữ đã hiển thị vì:
//   • số nguyên chính xác — DOM ghi "5.5K", JSON ghi 5552
//   • đủ 98/98 video, cách cũ cuộn bảng ảo hoá chỉ lấy được 97
//   • có thêm lượt chia sẻ, lượt lưu, đã ghim, ảnh bìa — DOM không hiện
//
// KHÔNG tự gọi API: TikTok ký request (X-Bogus/msToken) nên gọi lại URL đã bắt
// được sẽ bị từ chối. Ở đây chỉ đọc thứ trang tự lấy về — không thêm request nào.

const STUDIO_URL = 'https://www.tiktok.com/tiktokstudio'
const CONTENT_URL = 'https://www.tiktok.com/tiktokstudio/content'

/** Chỉ giữ những endpoint thật sự dùng, khỏi ôm cả trăm phản hồi rác mỗi lần tải. */
const TAP_URLS = [
  'multiGetFollowRelationCount',
  'counter/getHashCount',
  'creator/manage/item_list',
  'api/web/user'
]

/**
 * Gom các phản hồi JSON của trang.
 *
 * Giữ TẤT CẢ các bản của cùng một URL, không phải bản đầu tiên: cùng một endpoint
 * trả "Invalid parameters" ở trang này nhưng trả dữ liệu thật ở trang khác — đo
 * thật, `reward_analytics` có cả bản 115 byte lẫn bản 15.813 byte trong một phiên.
 */
class JsonTap {
  private readonly bodies = new Map<string, string[]>()

  constructor(page: Page, private readonly want: string[]) {
    page.on('response', (res) => void this.take(res))
  }

  private async take(res: HTTPResponse): Promise<void> {
    try {
      const url = res.url()
      if (!this.want.some((w) => url.includes(w))) return
      if (!(res.headers()['content-type'] ?? '').includes('json')) return
      const txt = await res.text()
      if (!txt) return
      const key = url.split('?')[0]
      const arr = this.bodies.get(key)
      if (arr) arr.push(txt)
      else this.bodies.set(key, [txt])
    } catch {
      /* phản hồi bị huỷ theo điều hướng — bỏ qua */
    }
  }

  /** Bản đầu tiên của endpoint chứa `needle` mà `pick` rút ra được giá trị. */
  pick<T>(needle: string, pick: (j: any) => T | null | undefined): T | null {
    for (const [url, arr] of this.bodies) {
      if (!url.includes(needle)) continue
      for (const b of arr) {
        try {
          const v = pick(JSON.parse(b))
          if (v !== undefined && v !== null) return v
        } catch {
          /* bản này hỏng hoặc là phản hồi lỗi — thử bản kế */
        }
      }
    }
    return null
  }

  /** Mọi bản parse được của endpoint chứa `needle`. */
  all(needle: string): any[] {
    const out: any[] = []
    for (const [url, arr] of this.bodies) {
      if (!url.includes(needle)) continue
      for (const b of arr) {
        try {
          out.push(JSON.parse(b))
        } catch {
          /* bỏ qua bản hỏng */
        }
      }
    }
    return out
  }
}

/** TikTok trả nhiều chỉ số dạng { "<userId>": giá_trị } — lấy giá trị đầu tiên. */
function firstValue(m: unknown): string | null {
  if (!m || typeof m !== 'object') return null
  const v = Object.values(m as Record<string, unknown>)[0]
  return typeof v === 'string' || typeof v === 'number' ? String(v) : null
}

const toNum = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * `visibility` của item_list → quyền riêng tư.
 *
 * Đối chiếu với nhãn bảng vẽ ra: 1 = "Mọi người", 2 = "Chỉ mình tôi". Giá trị cho
 * "Bạn bè" chưa gặp lần nào. Gặp số lạ thì ghi log KÈM nhãn đọc được để lần sau
 * bổ sung thẳng vào bảng tra, và tạm lấy nhãn đó thay vì đoán bừa thành công khai.
 */
/** Đã đối chiếu với nhãn trên bảng: 1 = Mọi người, 2 = Chỉ mình tôi. Giá trị cho
 *  "Bạn bè" chưa gặp lần nào nên chưa có ở đây. */
const VISIBILITY_MAP: Record<number, VideoPrivacy> = { 1: 'public', 2: 'private' }

const seenVisibility = new Set<number>()
function fromVisibility(v: unknown, label: VideoPrivacy | undefined): VideoPrivacy {
  const n = toNum(v)
  const known = VISIBILITY_MAP[n]
  if (known) return known
  if (!seenVisibility.has(n)) {
    seenVisibility.add(n)
    // Ghi kèm nhãn đọc được để lần gặp sau đã biết luôn con số đó là gì, thay vì
    // chỉ biết "có một giá trị lạ".
    console.warn(`[manager] visibility=${n} chua co trong bang tra — nhan tren bang doc duoc: ${label ?? '(khong co)'}`)
  }
  return label ?? 'public'
}

/** Giây unix → "dd/MM/yyyy". DOM trả chuỗi đã dịch theo ngôn ngữ tài khoản. */
function fmtDate(sec: unknown): string {
  const n = toNum(sec)
  if (!n) return ''
  const d = new Date(n * 1000)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

/** Mili giây → "m:ss". */
function fmtDuration(ms: unknown): string {
  const s = Math.round(toNum(ms) / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Nhãn quyền riêng tư của TikTok → giá trị nội bộ. */
function parsePrivacy(raw: string): VideoPrivacy {
  const s = raw.toLowerCase()
  if (/chỉ mình|only you|private|自分のみ/.test(s)) return 'private'
  if (/bạn bè|friends|フォロワー/.test(s)) return 'friends'
  return 'public'
}

/**
 * Ba chỉ số ở trang chủ TikTok Studio: Follower, Đã follow, Lượt thích.
 *
 * Trang bày chúng thành cặp nhãn-rồi-số liên tiếp. Neo vào nhãn thay vì vị trí
 * cố định, và nhận nhiều ngôn ngữ vì nhãn bị dịch theo tài khoản.
 *
 * Điều kiện chờ phải là "ĐÃ CÓ SỐ", không phải "trang đã có chữ". Bản trước chờ
 * `innerText.length > 400` rồi đọc ngay, và bắt phải khoảnh khắc TikTok đã dựng
 * khung nhưng chưa điền dữ liệu — cả ba chỉ số về 0 trong khi tài khoản có 991
 * follower. Ở đây đọc lặp cho tới khi hai lần liên tiếp cho cùng kết quả và có
 * ít nhất một số khác 0; tài khoản thật sự rỗng thì hết giờ vẫn trả 0, không treo.
 */
async function readStats(page: Page): Promise<{ followers: number | null; following: number | null; likes: number | null }> {
  const empty = { followers: null, following: null, likes: null }
  try {
    await page.goto('https://www.tiktok.com/tiktokstudio', { waitUntil: 'domcontentloaded', timeout: 45000 })

    const readOnce = (): Promise<{ likes: string; followers: string; following: string }> =>
      page.evaluate(() => {
        const lines = (document.body?.innerText ?? '').split('\n').map((s) => s.trim()).filter(Boolean)
        const after = (re: RegExp): string => {
          const i = lines.findIndex((l) => re.test(l))
          const next = i >= 0 ? (lines[i + 1] ?? '') : ''
          // Giữa các chỉ số có dấu "·" — nếu vớ phải nó thì coi như chưa đọc được.
          return /^[\d.,]+\s*[KMB]?$/i.test(next) ? next : ''
        }
        return {
          likes: after(/^(Lượt thích|Likes)$/i),
          followers: after(/^(Follower|Followers|Người theo dõi)$/i),
          following: after(/^(Đã follow|Following|Đang theo dõi)$/i)
        }
      })

    let prev = ''
    let raw = { likes: '', followers: '', following: '' }
    for (let i = 0; i < 14; i++) {
      raw = await readOnce()
      const key = `${raw.likes}|${raw.followers}|${raw.following}`
      const hasNumber = !!(raw.likes || raw.followers || raw.following)
      const nonZero = [raw.likes, raw.followers, raw.following].some((v) => v && parseCount(v) > 0)
      if (hasNumber && key === prev && nonZero) break
      prev = key
      await sleep(1500)
    }

    return {
      followers: raw.followers ? parseCount(raw.followers) : null,
      following: raw.following ? parseCount(raw.following) : null,
      likes: raw.likes ? parseCount(raw.likes) : null
    }
  } catch {
    return empty
  }
}

// ── Quyền riêng tư cấp tài khoản ────────────────────────────────────────────
//
// Dò thực tế trên trang https://www.tiktok.com/setting?activeTab=privacy:
//   • "Tài khoản riêng tư"  → <input type="checkbox"> (bị ẩn, phải bấm lớp bọc)
//   • "Bình luận"           → bấm hàng mở danh sách: Mọi người / Bạn bè
//   • "Phối lại"            → bấm hàng mở danh sách: Mọi người / Bạn bè
// Web CHỈ có hai lựa chọn, không có "Không ai" như bản điện thoại.
//
// "Tin nhắn trực tiếp" cố tình không nằm ở đây: nó dẫn sang trang con riêng
// (/setting/privacy/direct-messages) với hai mục nhỏ hình dạng khác hẳn.

const PRIVACY_URL = 'https://www.tiktok.com/setting?activeTab=privacy'

/** Chuỗi neo cho từng hàng. Nhận cả tiếng Anh vì trang bị dịch theo ngôn ngữ
 *  tài khoản, và `?lang=` không ép được (đã đo ở phần đọc trạng thái kiếm tiền). */
const ROW_DESC: Record<'comment' | 'duet', string> = {
  comment: 'Người có thể bình luận bài đăng|Who can comment on your posts',
  duet: 'Người có thể phối lại bài đăng|Who can (Duet with|remix) your posts'
}
const PRIVATE_DESC = 'Tài khoản riêng tư|Private account'
const AUDIENCE_SRC: Record<AudienceScope, string> = {
  everyone: '^(Mọi người|Everyone)$',
  friends: '^(Bạn bè|Friends)$'
}
/** Ô chọn trong danh sách vừa mở — TikTok dùng lẫn lộn nhiều kiểu đánh dấu. */
const OPTION_SEL = 'input[type="radio"],[role="radio"],[role="menuitemradio"],[role="option"]'

const FIELD_LABEL: Record<keyof AccountPrivacyPatch, string> = {
  privateAccount: 'Tài khoản riêng tư',
  comment: 'Quyền bình luận',
  duet: 'Quyền đăng lại'
}

const NO_PRIVACY: AccountPrivacy = { privateAccount: null, comment: null, duet: null }

/** Mở trang cài đặt quyền riêng tư và chờ tới khi nó dựng xong. */
async function openPrivacyPage(page: Page): Promise<boolean> {
  await page.goto(PRIVACY_URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
  for (let i = 0; i < 14; i++) {
    const ready = await page.evaluate(
      (src: string) => new RegExp(src, 'i').test(document.body?.innerText ?? ''),
      PRIVATE_DESC
    )
    if (ready) return true
    await sleep(1500)
  }
  return false
}

/** Đọc ba giá trị từ trang đang mở. Không tự điều hướng. */
async function readPrivacy(page: Page): Promise<AccountPrivacy> {
  try {
    return await page.evaluate(
      (rowDesc: Record<string, string>, privDesc: string, audSrc: Record<string, string>) => {
        const lines = (document.body?.innerText ?? '').split('\n').map((s) => s.trim()).filter(Boolean)
        const scopeOf = (s: string): 'everyone' | 'friends' | null => {
          if (new RegExp(audSrc.everyone, 'i').test(s)) return 'everyone'
          if (new RegExp(audSrc.friends, 'i').test(s)) return 'friends'
          return null
        }
        // Giá trị hiện tại nằm ngay DÒNG SAU dòng mô tả của hàng.
        const valueAfter = (src: string): 'everyone' | 'friends' | null => {
          const re = new RegExp(src, 'i')
          const i = lines.findIndex((l) => re.test(l))
          return i >= 0 ? scopeOf(lines[i + 1] ?? '') : null
        }
        const pr = new RegExp(privDesc, 'i')
        let priv: boolean | null = null
        for (const box of document.querySelectorAll('input[type="checkbox"]')) {
          let p: Element | null = box
          for (let k = 0; k < 6 && p?.parentElement; k++) {
            p = p.parentElement
            if (pr.test((p as HTMLElement).innerText ?? '')) {
              priv = (box as HTMLInputElement).checked
              break
            }
          }
          if (priv !== null) break
        }
        return { privateAccount: priv, comment: valueAfter(rowDesc.comment), duet: valueAfter(rowDesc.duet) }
      },
      ROW_DESC as unknown as Record<string, string>,
      PRIVATE_DESC,
      AUDIENCE_SRC as unknown as Record<string, string>
    )
  } catch {
    return NO_PRIVACY
  }
}

/** Gỡ mọi dấu tạm mình đặt lên DOM, kể cả khi nửa chừng bị lỗi. */
async function clearMarks(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      for (const a of ['data-hnv-row', 'data-hnv-opt', 'data-hnv-sw'])
        document.querySelector(`[${a}]`)?.removeAttribute(a)
    })
    .catch(() => {
      /* trang đang điều hướng — dấu sẽ mất theo DOM cũ */
    })
}

/**
 * Đổi "ai được bình luận / phối lại": bấm hàng để mở danh sách, rồi bấm đúng
 * lựa chọn. TikTok lưu ngay khi chọn — không có nút Lưu, nên việc xác nhận nằm
 * ở bước đọc lại của hàm gọi.
 */
async function setAudience(page: Page, which: 'comment' | 'duet', target: AudienceScope): Promise<void> {
  const tagged = await page.evaluate((src: string) => {
    const re = new RegExp(src, 'i')
    const leaf = [...document.querySelectorAll('*')].find(
      (e) => e.children.length === 0 && re.test(e.textContent ?? '')
    )
    if (!leaf) return false
    let box: Element = leaf
    for (let k = 0; k < 6 && box.parentElement; k++) {
      box = box.parentElement
      if (((box as HTMLElement).innerText ?? '').trim().length > 20) {
        box.setAttribute('data-hnv-row', '1')
        return true
      }
    }
    return false
  }, ROW_DESC[which])
  if (!tagged) return

  const rowEl = await page.$('[data-hnv-row]')
  if (!rowEl) return
  await humanClick(page, rowEl)

  let opened = false
  for (let i = 0; i < 10; i++) {
    if (await page.evaluate((sel: string) => document.querySelectorAll(sel).length >= 2, OPTION_SEL)) {
      opened = true
      break
    }
    await sleep(500)
  }
  if (!opened) {
    await clearMarks(page)
    return
  }

  const picked = await page.evaluate(
    (sel: string, src: string) => {
      const re = new RegExp(src, 'i')
      for (const opt of document.querySelectorAll(sel)) {
        // Ô chọn thật bị ẩn — phải bấm vào HÀNG mang nhãn thì mới ăn.
        let box: Element = opt
        for (let k = 0; k < 4 && box.parentElement; k++) {
          box = box.parentElement
          const first = ((box as HTMLElement).innerText ?? '').split('\n')[0].trim()
          if (!first) continue
          if (re.test(first)) {
            box.setAttribute('data-hnv-opt', '1')
            return true
          }
          break // đã tới tầng có chữ mà không khớp → không phải lựa chọn cần tìm
        }
      }
      return false
    },
    OPTION_SEL,
    AUDIENCE_SRC[target]
  )
  if (picked) {
    const optEl = await page.$('[data-hnv-opt]')
    if (optEl) {
      await humanClick(page, optEl)
      await sleep(1500)
    }
  }
  await page.keyboard.press('Escape').catch(() => undefined)
  await clearMarks(page)
}

/**
 * Bật/tắt "Tài khoản riêng tư".
 *
 * Ô tích của TikTok bị ẩn hoàn toàn nên bấm thẳng vào nó không ăn — phải leo lên
 * lớp bọc nhìn thấy được. Nếu TikTok có hỏi xác nhận thì lần bấm này chưa đủ;
 * bước đọc lại của hàm gọi sẽ phát hiện và báo là chưa lưu, thay vì báo thành
 * công nhầm.
 */
async function setPrivateAccount(page: Page, target: boolean): Promise<void> {
  const tagged = await page.evaluate(
    (src: string, want: boolean) => {
      const re = new RegExp(src, 'i')
      for (const box of document.querySelectorAll('input[type="checkbox"]')) {
        let p: Element | null = box
        for (let k = 0; k < 6 && p?.parentElement; k++) {
          p = p.parentElement
          if (!re.test((p as HTMLElement).innerText ?? '')) continue
          if ((box as HTMLInputElement).checked === want) return 'same'
          let v: Element = box
          for (let j = 0; j < 4 && v.parentElement; j++) {
            v = v.parentElement
            if ((v as HTMLElement).offsetWidth > 0) {
              v.setAttribute('data-hnv-sw', '1')
              return 'tagged'
            }
          }
          return 'miss'
        }
      }
      return 'miss'
    },
    PRIVATE_DESC,
    target
  )
  if (tagged !== 'tagged') return

  const el = await page.$('[data-hnv-sw]')
  if (el) {
    await humanClick(page, el)
    await sleep(1500)
  }
  await clearMarks(page)
}

/**
 * Danh sách video ở trang Nội dung.
 *
 * Danh sách này ẢO HOÁ: chỉ vài hàng quanh vùng nhìn tồn tại trong DOM, cuộn qua
 * là hàng cũ bị gỡ. Đo thật: cuộn thẳng xuống đáy rồi đọc một lần chỉ ra 6 video
 * trên tài khoản có 98 bài, và số đếm còn nhảy 5→8→6→9 giữa các lần. Nên phải
 * cuộn từng bước và GOM DẦN theo id — 97/98 video trong 29 giây.
 */
async function readVideos(page: Page, onProgress?: (n: number) => void): Promise<{ videos: TiktokVideo[]; declared: number | null }> {
  await page.goto('https://www.tiktok.com/tiktokstudio/content', { waitUntil: 'domcontentloaded', timeout: 45000 })
  for (let i = 0; i < 14; i++) {
    const n = await page.evaluate(() => document.querySelectorAll('a[href*="/video/"]').length)
    if (n > 0) break
    await sleep(2000)
  }

  const declared = await page.evaluate(() => {
    const m = (document.body?.innerText ?? '').match(/Bài đăng\s+(\d+)|Posts\s+(\d+)/i)
    return m ? Number(m[1] ?? m[2]) : null
  })

  // Bảng nằm trong vùng cuộn RIÊNG, không phải window — cuộn window thì lazy load
  // không bao giờ kích hoạt.
  await page.evaluate(() => {
    let el: Element | null = document.querySelector('a[href*="/video/"]')
    while (el) {
      const s = getComputedStyle(el)
      if (el.scrollHeight > el.clientHeight + 20 && /auto|scroll/.test(s.overflowY)) {
        el.setAttribute('data-hnv-scroller', '1')
        return
      }
      el = el.parentElement
    }
    document.scrollingElement?.setAttribute('data-hnv-scroller', '1')
  })

  const harvest = (): Promise<{ id: string; cells: string[] }[]> =>
    page.evaluate(() => {
      const out: { id: string; cells: string[] }[] = []
      for (const a of document.querySelectorAll('a[href*="/video/"]')) {
        let box: Element = a
        for (let k = 0; k < 8 && box.parentElement; k++) {
          box = box.parentElement
          if (box.querySelector('[aria-haspopup="true"]')) break
        }
        out.push({
          id: (a.getAttribute('href') ?? '').split('/video/')[1] ?? '',
          cells: ((box as HTMLElement).innerText ?? '').split('\n').map((s) => s.trim()).filter(Boolean)
        })
      }
      return out
    })

  const seen = new Map<string, TiktokVideo>()
  const take = async (): Promise<void> => {
    for (const r of await harvest()) {
      if (!r.id || seen.has(r.id)) continue
      const [duration = '', title = '', postedAt = '', privacy = '', views = '', likes = '', comments = ''] = r.cells
      seen.set(r.id, {
        id: r.id,
        title,
        postedAt,
        duration,
        privacy: parsePrivacy(privacy),
        views: parseCount(views),
        likes: parseCount(likes),
        comments: parseCount(comments),
        cover: null // bảng không cho đường dẫn ảnh — chỉ đường JSON mới có
      })
    }
  }

  let dry = 0
  for (let round = 0; round < 120 && dry < 6; round++) {
    await take()
    const before = seen.size
    const atEnd = await page.evaluate(() => {
      const el = document.querySelector('[data-hnv-scroller]') as HTMLElement | null
      if (!el) return true
      el.scrollTop += Math.round(el.clientHeight * 0.8) // bước nhỏ; nhảy xuống đáy sẽ bỏ sót
      return el.scrollTop + el.clientHeight >= el.scrollHeight - 4
    })
    await sleep(900)
    await take()
    if (seen.size === before) dry++
    else {
      dry = 0
      onProgress?.(seen.size)
    }
    if (atEnd && dry >= 2) break
  }

  return { videos: [...seen.values()], declared }
}

/**
 * Tải ảnh bìa video và trả về dạng data URI.
 *
 * Chạy `fetch` BÊN TRONG trang của profile nên ảnh đi qua đúng proxy của nó.
 * Nếu để giao diện tự tải bằng thẻ <img> thì Electron đi bằng IP thật của máy,
 * nghĩa là một IP kéo ảnh thuộc video của cả 20 tài khoản — chính là kiểu liên
 * kết mà cả bộ antidetect này tồn tại để tránh.
 *
 * Đo thật: mỗi ảnh trung bình 18 KB (9-32 KB), mất 350-800 ms qua proxy. Tải
 * lần lượt 98 ảnh là hơn một phút, nên đi theo lô 8 tấm một lượt.
 */
const COVER_BATCH = 8

async function fetchCovers(
  page: Page,
  list: { id: string; url: string }[],
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let i = 0; i < list.length; i += COVER_BATCH) {
    const slice = list.slice(i, i + COVER_BATCH)
    const got = await page
      .evaluate(async (items: { id: string; url: string }[]) => {
        const res: Record<string, string> = {}
        await Promise.all(
          items.map(async ({ id, url }) => {
            try {
              const r = await fetch(url)
              if (!r.ok) return
              const blob = await r.blob()
              // Ảnh quá lớn thì bỏ — thà thiếu ảnh còn hơn phình bộ nhớ.
              if (blob.size > 400_000) return
              res[id] = await new Promise<string>((ok) => {
                const fr = new FileReader()
                fr.onload = () => ok(typeof fr.result === 'string' ? fr.result : '')
                fr.onerror = () => ok('')
                fr.readAsDataURL(blob)
              })
            } catch {
              /* một ảnh hỏng không được làm hỏng cả lô */
            }
          })
        )
        return res
      }, slice)
      .catch(() => ({}) as Record<string, string>)

    for (const [id, uri] of Object.entries(got)) if (uri) out.set(id, uri)
    onProgress?.(Math.min(i + COVER_BATCH, list.length), list.length)
  }
  return out
}

/**
 * Ba chỉ số tài khoản, đọc từ JSON. null = không lấy được → bên gọi lùi về DOM.
 *
 * `repined_count` là lượt thích: đo được 5552, trong khi DOM cùng lúc hiện "5.5K".
 */
async function readStatsFromJson(
  page: Page,
  tap: JsonTap
): Promise<{ followers: number; following: number; likes: number } | null> {
  await page.goto(STUDIO_URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
  for (let i = 0; i < 30; i++) {
    if (tap.pick('multiGetFollowRelationCount', (j) => firstValue(j.FollowerCount)) !== null) break
    await sleep(600)
  }

  const followers = tap.pick('multiGetFollowRelationCount', (j) => firstValue(j.FollowerCount))
  if (followers === null) return null
  const following = tap.pick('multiGetFollowRelationCount', (j) => firstValue(j.FollowingCount))
  const counter = tap.pick<Record<string, string>>(
    'getHashCount',
    (j) => Object.values(j.CountData ?? {})[0] as Record<string, string> | undefined
  )

  return {
    followers: toNum(followers),
    following: toNum(following ?? 0),
    likes: toNum(counter?.repined_count ?? 0)
  }
}

/**
 * Danh sách video, đọc từ JSON.
 *
 * Vẫn phải cuộn — trang chỉ gọi trang kế khi người dùng cuộn tới — nhưng cuộn
 * chỉ để KÍCH, còn dữ liệu lấy nguyên vẹn từ phản hồi. Mỗi gói trả 10-50 video,
 * đo thật: 98/98 trong 18,6 giây, so với 97/98 trong 29,1 giây của đường DOM.
 *
 * Nhãn quyền riêng tư trên bảng vẫn được gom song song, để dùng cho những video
 * có `visibility` mình chưa biết nghĩa.
 */
async function readVideosFromJson(
  page: Page,
  tap: JsonTap,
  onProgress?: (n: number) => void,
  onCoverProgress?: (done: number, total: number) => void
): Promise<{ videos: TiktokVideo[]; declared: number | null } | null> {
  await page.goto(CONTENT_URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
  for (let i = 0; i < 25; i++) {
    if (tap.all('item_list').length > 0) break
    await sleep(600)
  }
  if (tap.all('item_list').length === 0) return null

  await page.evaluate(() => {
    let el: Element | null = document.querySelector('a[href*="/video/"]')
    while (el) {
      const s = getComputedStyle(el)
      if (el.scrollHeight > el.clientHeight + 20 && /auto|scroll/.test(s.overflowY)) {
        el.setAttribute('data-hnv-scroller', '1')
        return
      }
      el = el.parentElement
    }
    document.scrollingElement?.setAttribute('data-hnv-scroller', '1')
  })

  /** id → nhãn quyền riêng tư đang hiện trên bảng, gom dần theo lúc cuộn. */
  const labels = new Map<string, VideoPrivacy>()
  const harvestLabels = async (): Promise<void> => {
    const rows = await page
      .evaluate(() => {
        const out: { id: string; cells: string[] }[] = []
        for (const a of document.querySelectorAll('a[href*="/video/"]')) {
          let box: Element = a
          for (let k = 0; k < 8 && box.parentElement; k++) {
            box = box.parentElement
            if (box.querySelector('[aria-haspopup="true"]')) break
          }
          out.push({
            id: (a.getAttribute('href') ?? '').split('/video/')[1] ?? '',
            cells: ((box as HTMLElement).innerText ?? '').split('\n').map((s) => s.trim()).filter(Boolean)
          })
        }
        return out
      })
      .catch(() => [] as { id: string; cells: string[] }[])
    for (const r of rows) {
      if (!r.id || labels.has(r.id)) continue
      const hit = r.cells.find((c) => /mọi người|bạn bè|chỉ mình|everyone|friends|only you|private/i.test(c))
      if (hit) labels.set(r.id, parsePrivacy(hit))
    }
  }

  const gathered = (): Map<string, any> => {
    const m = new Map<string, any>()
    for (const j of tap.all('item_list')) for (const it of j.item_list ?? []) m.set(String(it.item_id), it)
    return m
  }
  const isDone = (): boolean => tap.all('item_list').some((j) => j.has_more === false)

  // Ngưỡng "bao nhiêu vòng không thu được gì thì bỏ" phải rộng hơn hẳn đường DOM.
  // Đường DOM đếm số HÀNG đang dựng nên gần như vòng nào cũng tăng; đường này đếm
  // số video theo GÓI MẠNG, mà mỗi gói chỉ về sau vài vòng cuộn. Đo thật: để
  // ngưỡng 6 như bên DOM thì dừng ở 60/98 sau 9 vòng; nới lên 10 thì đủ 98/98
  // trong 18,6 giây qua 17 vòng.
  let dry = 0
  for (let round = 0; round < 40 && dry < 10; round++) {
    await harvestLabels()
    if (isDone()) break
    const before = gathered().size
    await page.evaluate(() => {
      const el = document.querySelector('[data-hnv-scroller]') as HTMLElement | null
      if (el) el.scrollTop = el.scrollHeight
    })
    await sleep(900)
    const now = gathered().size
    if (now === before) dry++
    else {
      dry = 0
      onProgress?.(now)
    }
  }
  await harvestLabels()

  const raw = [...gathered().values()]

  // Ảnh bìa: tải trước khi đóng trình duyệt, vì sau đó không còn đường nào đi
  // qua proxy của profile này nữa.
  const wanted: { id: string; url: string }[] = []
  for (const it of raw) {
    const u = it.cover_url?.[0]
    if (typeof u === 'string' && u.startsWith('http')) wanted.push({ id: String(it.item_id), url: u })
  }
  const covers = await fetchCovers(page, wanted, onCoverProgress)

  const videos: TiktokVideo[] = raw.map((it) => ({
    id: String(it.item_id ?? ''),
    title: String(it.desc ?? ''),
    postedAt: fmtDate(it.create_time),
    duration: fmtDuration(it.duration),
    privacy: fromVisibility(it.visibility, labels.get(String(it.item_id))),
    views: toNum(it.play_count),
    likes: toNum(it.like_count),
    comments: toNum(it.comment_count),
    cover: covers.get(String(it.item_id)) ?? null
  }))

  const declared = tap.pick<number>('getHashCount', (j) => {
    const c = Object.values(j.CountData ?? {})[0] as Record<string, string> | undefined
    return c?.item_count ? toNum(c.item_count) : undefined
  })
  return { videos, declared }
}

// ── Đổi quyền riêng tư của video ────────────────────────────────────────────
//
// Dò thực tế: ô quyền riêng tư trên mỗi hàng là một <button> (TUXButton). Bấm nó
// bằng chuột THẬT sẽ mở một [role="dialog"] chứa ba nhãn Mọi người / Bạn bè /
// Chỉ mình tôi. Ba điểm phải nhớ, đều là chỗ tôi đã đo sai một lần:
//   • element.click() KHÔNG mở được menu — TUX nghe sự kiện chuột thật.
//   • thiếu cờ --disable-features=CalculateNativeWinOcclusion thì cửa sổ nằm
//     ngoài màn hình không dựng lớp menu, cho kết quả âm tính giả.
//   • các lựa chọn KHÔNG mang role="option", chỉ là ô chữ trong dialog.

const VIDEO_PRIVACY_RE: Record<VideoPrivacy, string> = {
  public: '^(Mọi người|Everyone)$',
  friends: '^(Bạn bè|Friends)$',
  private: '^(Chỉ mình tôi|Only you|Private)$'
}
const ANY_PRIVACY_RE = /(Mọi người|Bạn bè|Chỉ mình tôi|Everyone|Friends|Only you)/i

/** Kéo phần tử đã đánh dấu vào tầm nhìn rồi bấm bằng chuột thật. */
async function scrollAndClick(page: Page, attr: string): Promise<boolean> {
  const h = await page.$(`[${attr}]`)
  if (!h) return false
  await h.evaluate((e) => e.scrollIntoView({ block: 'center' })).catch(() => undefined)
  await sleep(250)
  if (!(await h.boundingBox())) return false
  await humanClick(page, h)
  return true
}

/** Đổi quyền riêng tư của MỘT video đang có mặt trong DOM. */
async function setOneVideoPrivacy(page: Page, id: string, target: VideoPrivacy): Promise<boolean> {
  const marked = await page.evaluate((vid: string) => {
    document.querySelector('[data-hnv-pv]')?.removeAttribute('data-hnv-pv')
    const a = [...document.querySelectorAll('a[href*="/video/"]')].find((e) =>
      (e.getAttribute('href') ?? '').includes(`/video/${vid}`)
    )
    if (!a) return false
    let box: Element = a
    for (let k = 0; k < 8 && box.parentElement; k++) {
      box = box.parentElement
      if (box.querySelector('[aria-haspopup="true"]')) break
    }
    const btn = [...box.querySelectorAll('button')].find((b) =>
      /(Mọi người|Bạn bè|Chỉ mình tôi|Everyone|Friends|Only you)/i.test(b.textContent ?? '')
    )
    if (!btn) return false
    btn.setAttribute('data-hnv-pv', '1')
    return true
  }, id)
  if (!marked) return false
  if (!(await scrollAndClick(page, 'data-hnv-pv'))) return false

  let opened = false
  for (let i = 0; i < 14; i++) {
    opened = await page.evaluate(() =>
      [...document.querySelectorAll('[role="dialog"]')].some((d) =>
        /Chỉ mình tôi|Only you/i.test((d as HTMLElement).innerText ?? '')
      )
    )
    if (opened) break
    await sleep(400)
  }
  if (!opened) return false

  const picked = await page.evaluate((src: string) => {
    document.querySelector('[data-hnv-opt]')?.removeAttribute('data-hnv-opt')
    const re = new RegExp(src, 'i')
    for (const d of document.querySelectorAll('[role="dialog"]')) {
      if (!/Chỉ mình tôi|Only you/i.test((d as HTMLElement).innerText ?? '')) continue
      const leaf = [...d.querySelectorAll('*')].find(
        (e) => e.children.length === 0 && re.test((e.textContent ?? '').trim())
      )
      if (!leaf) continue
      // Ô chữ có thể quá mỏng để bấm — leo lên tầng đủ cao.
      let box: Element = leaf
      for (let k = 0; k < 3 && box.parentElement && (box as HTMLElement).offsetHeight < 20; k++) box = box.parentElement
      box.setAttribute('data-hnv-opt', '1')
      return true
    }
    return false
  }, VIDEO_PRIVACY_RE[target])
  if (!picked) {
    await page.keyboard.press('Escape').catch(() => undefined)
    return false
  }
  if (!(await scrollAndClick(page, 'data-hnv-opt'))) return false

  // Xác nhận bằng chính nhãn trên hàng, không tin vào việc bấm được.
  const want = new RegExp(VIDEO_PRIVACY_RE[target], 'i')
  for (let i = 0; i < 12; i++) {
    await sleep(500)
    const now = await page.evaluate((vid: string) => {
      const a = [...document.querySelectorAll('a[href*="/video/"]')].find((e) =>
        (e.getAttribute('href') ?? '').includes(`/video/${vid}`)
      )
      if (!a) return null
      let box: Element = a
      for (let k = 0; k < 8 && box.parentElement; k++) {
        box = box.parentElement
        if (box.querySelector('[aria-haspopup="true"]')) break
      }
      const btn = [...box.querySelectorAll('button')].find((b) =>
        /(Mọi người|Bạn bè|Chỉ mình tôi|Everyone|Friends|Only you)/i.test(b.textContent ?? '')
      )
      return btn ? (btn.textContent ?? '').trim() : null
    }, id)
    if (now && want.test(now)) return true
  }
  return false
}

// ── Xóa video ───────────────────────────────────────────────────────────────
//
// Dò thực tế: mỗi hàng có một <button> KHÔNG CHỮ ở mép phải. Bấm bằng chuột thật
// mở menu "Ghim lên đầu · Thêm vào danh sách phát · Tải về · Xóa". Bấm "Xóa" mở
// tiếp hộp "Xóa bài đăng?" với hai nút "Hủy" và "Xóa".
//
// TikTok nói rõ trong hộp đó: bài đăng còn khôi phục được trong 30 NGÀY qua
// Trung tâm hoạt động > Đã xóa gần đây. Không phải mất ngay vĩnh viễn.

/** Mở menu thao tác của một hàng. */
async function openRowMenu(page: Page, id: string): Promise<boolean> {
  const marked = await page.evaluate((vid: string) => {
    document.querySelector('[data-hnv-act]')?.removeAttribute('data-hnv-act')
    const a = [...document.querySelectorAll('a[href*="/video/"]')].find((e) =>
      (e.getAttribute('href') ?? '').includes(`/video/${vid}`)
    )
    if (!a) return false
    let box: Element = a
    for (let k = 0; k < 10 && box.parentElement; k++) {
      const p = box.parentElement
      const w = p.getBoundingClientRect().width
      box = p
      if (w > 700) break // đã tới tầng hàng ngang
    }
    const btn = [...box.querySelectorAll('button')].filter((b) => !(b.textContent ?? '').trim()).pop()
    if (!btn) return false
    btn.setAttribute('data-hnv-act', '1')
    return true
  }, id)
  return marked ? scrollAndClick(page, 'data-hnv-act') : false
}

/** Xóa MỘT video đang có mặt trong DOM. */
async function deleteOneVideo(page: Page, id: string): Promise<boolean> {
  if (!(await openRowMenu(page, id))) return false

  // Chờ menu — neo vào mục đầu tiên, không neo vào "Xóa" vì chữ đó còn xuất
  // hiện ở hộp xác nhận sau đó.
  let opened = false
  for (let i = 0; i < 14; i++) {
    opened = await page.evaluate(() =>
      [...document.querySelectorAll('*')].some(
        (e) => e.children.length === 0 && /^(Ghim lên đầu|Bỏ ghim|Pin to top|Unpin)$/i.test((e.textContent ?? '').trim())
      )
    )
    if (opened) break
    await sleep(350)
  }
  if (!opened) return false

  const marked = await page.evaluate(() => {
    document.querySelector('[data-hnv-del]')?.removeAttribute('data-hnv-del')
    const leaf = [...document.querySelectorAll('*')].find(
      (e) => e.children.length === 0 && /^(Xóa|Xoá|Delete)$/i.test((e.textContent ?? '').trim())
    )
    if (!leaf) return false
    let box: Element = leaf
    for (let k = 0; k < 3 && box.parentElement && (box as HTMLElement).offsetHeight < 20; k++) box = box.parentElement
    box.setAttribute('data-hnv-del', '1')
    return true
  })
  if (!marked || !(await scrollAndClick(page, 'data-hnv-del'))) {
    await page.keyboard.press('Escape').catch(() => undefined)
    return false
  }

  // Hộp xác nhận. Nút "Xóa" của nó phải tìm TRONG khối chứa tiêu đề, vì mục
  // "Xóa" của menu có thể vẫn còn trong DOM — bấm nhầm là không xác nhận được.
  let asked = false
  for (let i = 0; i < 14; i++) {
    asked = await page.evaluate(() => /Xóa bài đăng\?|Delete post\?/i.test(document.body?.innerText ?? ''))
    if (asked) break
    await sleep(350)
  }
  if (!asked) {
    await page.keyboard.press('Escape').catch(() => undefined)
    return false
  }

  const yes = await page.evaluate(() => {
    document.querySelector('[data-hnv-yes]')?.removeAttribute('data-hnv-yes')
    const title = [...document.querySelectorAll('*')].find(
      (e) => e.children.length === 0 && /Xóa bài đăng\?|Delete post\?/i.test((e.textContent ?? '').trim())
    )
    if (!title) return false
    let box: Element | null = title
    for (let k = 0; k < 8 && box?.parentElement; k++) {
      box = box.parentElement
      const btns = [...box.querySelectorAll('button')].filter((b) =>
        /^(Xóa|Xoá|Delete)$/i.test((b.textContent ?? '').trim())
      )
      if (btns.length === 1) {
        btns[0].setAttribute('data-hnv-yes', '1')
        return true
      }
      if (btns.length > 1) return false // mơ hồ thì dừng, không đoán
    }
    return false
  })
  if (!yes || !(await scrollAndClick(page, 'data-hnv-yes'))) {
    await page.keyboard.press('Escape').catch(() => undefined)
    return false
  }

  // Xác nhận bằng việc hàng biến mất, không tin vào việc bấm được.
  for (let i = 0; i < 18; i++) {
    await sleep(600)
    const gone = await page.evaluate(
      (vid: string) =>
        ![...document.querySelectorAll('a[href*="/video/"]')].some((a) =>
          (a.getAttribute('href') ?? '').includes(`/video/${vid}`)
        ),
      id
    )
    if (gone) return true
  }
  return false
}

/**
 * Áp dụng MỘT LƯỢT mọi thay đổi đang chờ của một profile: đổi quyền riêng tư và
 * xóa video.
 *
 * Gộp làm một hàm thay vì hai vì mỗi lần mở profile tốn ~10 giây khởi động
 * Chromium; người dùng sửa năm thứ rồi bấm Lưu không nên phải chờ năm lần.
 * Bảng ảo hoá nên vẫn đi MỘT LƯỢT từ trên xuống, gặp hàng nào cần đụng thì làm
 * ngay tại đó.
 *
 * Video vừa bị đổi quyền vừa bị đánh dấu xóa thì chỉ xóa — đổi quyền cho một
 * video sắp biến mất là thao tác thừa trên tài khoản thật.
 */
async function runVideoEdits(
  page: Page,
  profileId: string,
  edits: { privacy: Record<string, VideoPrivacy>; remove: string[] },
  onProgress?: (msg: string) => void
): Promise<{ changed: string[]; removed: string[]; failed: string[] }> {
  const removeSet = new Set(edits.remove)
  const privacyMap = new Map<string, VideoPrivacy>(
    Object.entries(edits.privacy).filter(([id]) => !removeSet.has(id)) as [string, VideoPrivacy][]
  )
  const all = [...new Set([...privacyMap.keys(), ...removeSet])]
  if (all.length === 0) return { changed: [], removed: [], failed: [] }

  const want = new Set(all)
  const changed: string[] = []
  const removed: string[] = []
  const failed: string[] = []
  {
    await page.goto(CONTENT_URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
    for (let i = 0; i < 25; i++) {
      if (await page.evaluate(() => document.querySelectorAll('a[href*="/video/"]').length > 0)) break
      await sleep(800)
    }
    await page.evaluate(() => {
      let el: Element | null = document.querySelector('a[href*="/video/"]')
      while (el) {
        const s = getComputedStyle(el)
        if (el.scrollHeight > el.clientHeight + 20 && /auto|scroll/.test(s.overflowY)) {
          el.setAttribute('data-hnv-scroller', '1')
          return
        }
        el = el.parentElement
      }
    })

    // Cuộn TỪNG BƯỚC NHỎ, khác hẳn đường đọc.
    //
    // Đo thật: bảng chỉ dựng 5-9 hàng quanh vùng nhìn, và nhảy `scrollTop =
    // scrollHeight` mỗi vòng làm vị trí nhảy 5.500px một bước — mọi hàng ở giữa
    // không bao giờ được dựng, nên sau 30 vòng chỉ GẶP ĐƯỢC 48/99 video và đứng
    // im từ vòng 16. Đường đọc không sao vì nó lấy dữ liệu từ gói mạng, nhưng
    // đường ghi phải tìm hàng TRONG DOM nên bắt buộc mỗi hàng phải lướt qua vùng
    // nhìn ít nhất một lần.
    const seen = new Set<string>()
    let dry = 0
    for (let round = 0; round < 200 && dry < 8; round++) {
      const here: string[] = await page.evaluate(() =>
        [...document.querySelectorAll('a[href*="/video/"]')]
          .map((a) => (a.getAttribute('href') ?? '').split('/video/')[1] ?? '')
          .filter(Boolean)
      )
      let fresh = false
      for (const id of here)
        if (!seen.has(id)) {
          seen.add(id)
          fresh = true
        }
      let acted = false
      for (const id of here) {
        if (!want.has(id)) continue
        want.delete(id)
        acted = true
        const n = changed.length + removed.length + failed.length + 1
        if (removeSet.has(id)) {
          onProgress?.(`Xóa ${n}/${all.length}…`)
          const ok = await deleteOneVideo(page, id)
          ;(ok ? removed : failed).push(id)
        } else {
          const target = privacyMap.get(id)!
          onProgress?.(`Đổi quyền riêng tư ${n}/${all.length}…`)
          const ok = await setOneVideoPrivacy(page, id, target)
          ;(ok ? changed : failed).push(id)
        }
        await sleep(rand(500, 1100))
      }
      if (want.size === 0) break
      const atEnd = await page.evaluate(() => {
        const el = document.querySelector('[data-hnv-scroller]') as HTMLElement | null
        if (!el) return true
        el.scrollTop += Math.round(el.clientHeight * 0.8)
        return el.scrollTop + el.clientHeight >= el.scrollHeight - 4
      })
      // Tới đáy mà vẫn không có hàng mới nào nữa thì mới thật sự hết.
      dry = acted || fresh ? 0 : atEnd ? dry + 1 : 0
      await sleep(700)
    }
    // Video nào cuộn hết bảng vẫn không gặp thì coi như hỏng, không im lặng bỏ qua.
    for (const id of want) failed.push(id)

    // Bộ nhớ tạm chỉ theo thứ THẬT SỰ làm được, không theo thứ người dùng muốn.
    const cached = cache.get(profileId)
    if (cached) {
      const gone = new Set(removed)
      const done = new Set(changed)
      cache.set(profileId, {
        ...cached,
        videos: cached.videos
          .filter((v) => !gone.has(v.id))
          .map((v) => (done.has(v.id) ? { ...v, privacy: privacyMap.get(v.id)! } : v))
      })
    }
    return { changed, removed, failed }
  }
}

/**
 * Đổi tên hiển thị.
 *
 * Hộp "Sửa hồ sơ" trên trang cá nhân có bốn ô theo thứ tự: ảnh (input file),
 * TikTok ID, tên hiển thị, tiểu sử. Không neo theo thứ tự mà neo theo GIÁ TRỊ:
 * ô nào đang chứa đúng username thì đó là TikTok ID, ô chữ còn lại là tên hiển
 * thị — thứ tự đổi thì vẫn đúng.
 */
async function runProfileEdit(
  page: Page,
  profile: Profile,
  want: { name?: string; avatarPath?: string },
  onProgress?: (msg: string) => void
): Promise<{ ok: boolean; reason?: string; name?: string; avatarDone?: boolean }> {
  const wanted = (want.name ?? '').trim()
  if (want.name !== undefined && !wanted) return { ok: false, reason: 'Tên để trống' }

  {
    onProgress?.('Mở trang hồ sơ…')
    await page.goto(`https://www.tiktok.com/@${profile.tiktokUsername}`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    })
    await page.keyboard.press('Escape').catch(() => undefined)
    let ready = false
    for (let i = 0; i < 20; i++) {
      ready = await page.evaluate(() => /Sửa hồ sơ|Edit profile/i.test(document.body?.innerText ?? ''))
      if (ready) break
      await sleep(700)
    }
    if (!ready) return { ok: false, reason: 'Không mở được trang hồ sơ' }

    // "Sửa hồ sơ" là một <div> bấm được, không phải <button>.
    const marked = await page.evaluate(() => {
      document.querySelector('[data-hnv-edit]')?.removeAttribute('data-hnv-edit')
      const hit = [...document.querySelectorAll('button,[role="button"],div,span')].find(
        (e) => e.children.length <= 2 && /^(Sửa hồ sơ|Edit profile)$/i.test((e.textContent ?? '').trim())
      )
      if (!hit) return false
      let box: Element = hit
      for (let k = 0; k < 3 && box.parentElement && box.getBoundingClientRect().height < 24; k++) box = box.parentElement
      box.setAttribute('data-hnv-edit', '1')
      return true
    })
    if (!marked || !(await scrollAndClick(page, 'data-hnv-edit')))
      return { ok: false, reason: 'Không bấm được "Sửa hồ sơ"' }

    // ── Ảnh đại diện ────────────────────────────────────────────────────────
    // Dò thực tế: gắn file vào input[type=file] làm hiện hộp "Chỉnh sửa ảnh" có
    // thanh "Thu phóng" và hai nút "Hủy" / "Đăng ký" — TikTok dùng chữ "Đăng ký"
    // cho nút xác nhận cắt ảnh. Phải bấm nó xong mới tới nút Lưu của hồ sơ.
    let avatarDone = false
    if (want.avatarPath) {
      onProgress?.('Tải ảnh đại diện lên…')
      let fileInput: ElementHandle<Element> | null = null
      for (let i = 0; i < 14; i++) {
        fileInput = await page.$('input[type="file"]')
        if (fileInput) break
        await sleep(600)
      }
      if (!fileInput) return { ok: false, reason: 'Không tìm thấy ô chọn ảnh' }
      // Ép kiểu vì page.$ trả về ElementHandle<Element> chung, còn uploadFile chỉ
      // có trên handle của <input type=file> — đã lọc đúng bằng selector ở trên.
      await (fileInput as ElementHandle<HTMLInputElement>).uploadFile(want.avatarPath)

      let cropped = false
      for (let i = 0; i < 16; i++) {
        await sleep(500)
        const ok = await page.evaluate(() => {
          document.querySelector('[data-hnv-crop]')?.removeAttribute('data-hnv-crop')
          const title = [...document.querySelectorAll('*')].find(
            (e) =>
              e.children.length === 0 &&
              /^(Chỉnh sửa ảnh|Edit photo|Edit image)$/i.test((e.textContent ?? '').trim())
          )
          if (!title) return false
          let box: Element | null = title
          for (let k = 0; k < 8 && box?.parentElement; k++) {
            box = box.parentElement
            if (!/Thu phóng|Zoom/i.test((box as HTMLElement).innerText ?? '')) continue
            // Nút xác nhận = nút KHÔNG phải "Hủy" trong chính hộp cắt ảnh.
            const btn = [...box.querySelectorAll('button,[role="button"]')].find(
              (b) => !/^(Hủy|Huỷ|Cancel)$/i.test((b.textContent ?? '').trim())
            )
            if (!btn) return false
            btn.setAttribute('data-hnv-crop', '1')
            return true
          }
          return false
        })
        if (ok) {
          cropped = await scrollAndClick(page, 'data-hnv-crop')
          break
        }
      }
      if (!cropped) return { ok: false, reason: 'Không xác nhận được bước cắt ảnh' }
      avatarDone = true
      await sleep(1500)
    }

    if (want.name === undefined) {
      // Chỉ đổi ảnh: bấm Lưu rồi thôi, không có gì để đọc lại đối chiếu.
      const saved = await page.evaluate(() => {
        document.querySelector('[data-hnv-save]')?.removeAttribute('data-hnv-save')
        const btn = [...document.querySelectorAll('button')].find(
          (b) => /^(Lưu|Save)$/i.test((b.textContent ?? '').trim()) && b.getBoundingClientRect().height > 20
        )
        if (!btn) return false
        btn.setAttribute('data-hnv-save', '1')
        return true
      })
      if (!saved || !(await scrollAndClick(page, 'data-hnv-save')))
        return { ok: false, reason: 'Không tìm thấy nút Lưu' }
      await sleep(3000)
      return { ok: true, avatarDone }
    }

    onProgress?.('Điền tên mới…')
    let filled = false
    for (let i = 0; i < 14; i++) {
      filled = await page.evaluate(
        (user: string, value: string) => {
          const boxes = [...document.querySelectorAll('input')].filter(
            (e) => e.getAttribute('type') !== 'file' && e.getAttribute('type') !== 'search' && e.offsetWidth > 0
          )
          const nick = boxes.find((e) => (e.value ?? '').trim() !== user)
          if (!nick) return false
          // React giữ giá trị riêng — phải gọi setter gốc rồi phát sự kiện, gán
          // thẳng .value là component không hay biết.
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
          setter?.call(nick, value)
          nick.dispatchEvent(new Event('input', { bubbles: true }))
          nick.dispatchEvent(new Event('change', { bubbles: true }))
          return true
        },
        profile.tiktokUsername,
        wanted
      )
      if (filled) break
      await sleep(600)
    }
    if (!filled) return { ok: false, reason: 'Không tìm thấy ô tên hiển thị' }

    await sleep(rand(400, 900))
    onProgress?.('Lưu…')
    const savePressed = await page.evaluate(() => {
      document.querySelector('[data-hnv-save]')?.removeAttribute('data-hnv-save')
      const btn = [...document.querySelectorAll('button')].find(
        (b) => /^(Lưu|Save)$/i.test((b.textContent ?? '').trim()) && b.getBoundingClientRect().height > 20
      )
      if (!btn) return false
      btn.setAttribute('data-hnv-save', '1')
      return true
    })
    if (!savePressed || !(await scrollAndClick(page, 'data-hnv-save')))
      return { ok: false, reason: 'Không tìm thấy nút Lưu' }

    // Xác nhận bằng cách nạp lại trang và đọc lại tên, không tin vào cú bấm.
    onProgress?.('Đọc lại để xác nhận…')
    await sleep(2500)
    await page.goto(`https://www.tiktok.com/@${profile.tiktokUsername}`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    })
    for (let i = 0; i < 16; i++) {
      await sleep(800)
      const shown = await page.evaluate(() => (document.body?.innerText ?? '').split('\n').map((s) => s.trim()))
      // Bộ nhớ tạm do applyAll cập nhật — hàm này chỉ làm việc trên trang.
      if (shown.some((l) => l === wanted)) return { ok: true, name: wanted, avatarDone }
    }
    return { ok: false, reason: 'TikTok chưa nhận tên mới' }
  }
}

/** Dữ liệu đã tải của một profile (nếu có). Không tự đi tải. */
export function getAccount(profileId: string): TiktokAccount | null {
  return cache.get(profileId) ?? null
}

/**
 * Tải thông tin sâu của một tài khoản. CHỈ chạy khi người dùng bấm — mỗi lần mở
 * một Chromium riêng và mất ~34 giây (đo thật trên tài khoản 98 video).
 */
export async function loadAccount(
  profileId: string,
  onProgress?: (msg: string) => void
): Promise<{ ok: boolean; reason?: string; account?: TiktokAccount }> {
  const profile = ProfileStore.get(profileId)
  if (!profile) return { ok: false, reason: 'Không tìm thấy profile' }
  if (profile.status === 'running') return { ok: false, reason: 'Đóng profile trước khi tải' }

  let browser: Browser | null = null
  try {
    onProgress?.('Đang mở trình duyệt…')
    const { browser: b, session } = await openAutomation(profile)
    browser = b
    trackProc(session.process)
    const pages = await browser.pages()
    const page = pages[0] ?? (await browser.newPage())
    page.on('dialog', async (d) => {
      try {
        await d.dismiss()
      } catch {
        /* ignore */
      }
    })

    // Nghe JSON trước, bóc DOM chỉ khi JSON không ra gì. Nếu TikTok đổi tên
    // endpoint thì app chậm lại chứ không gãy.
    const tap = new JsonTap(page, TAP_URLS)

    onProgress?.('Đọc chỉ số tài khoản…')
    const stats = (await readStatsFromJson(page, tap)) ?? (await readStats(page))

    // Tên hiển thị trên TikTok, khác tên profile trong app — nút đổi tên cần nó
    // để điền sẵn giá trị đang có.
    const displayName = tap.pick<string>(
      'api/web/user',
      (j) => j.userBaseInfo?.UserProfile?.UserBase?.NickName
    )

    onProgress?.('Đọc quyền riêng tư tài khoản…')
    const privacy = (await openPrivacyPage(page)) ? await readPrivacy(page) : NO_PRIVACY

    onProgress?.('Đọc danh sách video…')
    const fromJson = await readVideosFromJson(
      page,
      tap,
      (n) => onProgress?.(`Đã gom ${n} video…`),
      (done, total) => onProgress?.(`Tải ảnh bìa ${done}/${total}…`)
    )
    const { videos, declared } =
      fromJson ?? (await readVideos(page, (n) => onProgress?.(`Đã gom ${n} video…`)))

    if (declared !== null && videos.length < declared) {
      // Nói ra thay vì im lặng: người dùng thấy 97 mà TikTok ghi 98 thì cần biết
      // đó là thiếu thật, không phải mình đọc nhầm.
      onProgress?.(`Lấy được ${videos.length}/${declared} video`)
    }

    const account: TiktokAccount = {
      profileId,
      fetchedAt: Date.now(),
      followers: stats.followers,
      following: stats.following,
      likes: stats.likes,
      displayName,
      privacy,
      videos
    }
    cache.set(profileId, account)
    return { ok: true, account }
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message || 'Lỗi tải thông tin' }
  } finally {
    // Cùng lý do như finally của TikTokSync: chỉ dọn khi CHÍNH lần gọi này mở
    // được browser.
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
 * Ghi quyền riêng tư cấp tài khoản lên TikTok.
 *
 * Chỉ đụng vào mục nào KHÁC giá trị đang có trên trang — bấm lại đúng giá trị cũ
 * là thao tác thừa trên tài khoản thật. Sau khi bấm thì nạp lại trang và đọc lại
 * để xác nhận: TikTok lưu ngầm khi chọn, bấm được không có nghĩa là đã lưu.
 */
async function runAccountPrivacy(
  page: Page,
  profileId: string,
  patch: AccountPrivacyPatch,
  onProgress?: (msg: string) => void
): Promise<{ ok: boolean; reason?: string; privacy?: AccountPrivacy }> {
  {
    onProgress?.('Mở trang cài đặt…')
    if (!(await openPrivacyPage(page)))
      return { ok: false, reason: 'Không mở được trang cài đặt quyền riêng tư' }
    const before = await readPrivacy(page)

    if (patch.privateAccount !== undefined && patch.privateAccount !== before.privateAccount) {
      onProgress?.('Đổi Tài khoản riêng tư…')
      await setPrivateAccount(page, patch.privateAccount)
    }
    if (patch.comment !== undefined && patch.comment !== before.comment) {
      onProgress?.('Đổi quyền Bình luận…')
      await setAudience(page, 'comment', patch.comment)
    }
    if (patch.duet !== undefined && patch.duet !== before.duet) {
      onProgress?.('Đổi quyền Phối lại…')
      await setAudience(page, 'duet', patch.duet)
    }

    onProgress?.('Đọc lại để xác nhận…')
    const after = (await openPrivacyPage(page)) ? await readPrivacy(page) : NO_PRIVACY

    const cached = cache.get(profileId)
    if (cached) cache.set(profileId, { ...cached, privacy: after })

    const notSaved = (Object.keys(patch) as (keyof AccountPrivacyPatch)[]).filter(
      (k) => patch[k] !== undefined && after[k] !== patch[k]
    )
    if (notSaved.length)
      return {
        ok: false,
        reason: `TikTok chưa lưu: ${notSaved.map((k) => FIELD_LABEL[k]).join(', ')}`,
        privacy: after
      }
    return { ok: true, privacy: after }
  }
}

/**
 * Ghi MỌI thay đổi đang chờ của một profile trong MỘT phiên trình duyệt.
 *
 * Trước đây mỗi loại thay đổi có hàm riêng và mỗi hàm tự mở một Chromium. Người
 * dùng sửa quyền riêng tư tài khoản, đổi tên rồi xóa vài video là phải chờ ba
 * lần khởi động ~10 giây. Giờ giao diện chỉ đánh dấu, và đây là chỗ duy nhất
 * chạm vào TikTok.
 *
 * Thứ tự cố ý: tên hiển thị → quyền riêng tư tài khoản → video. Hai việc đầu
 * nhanh và ở trang khác, làm trước để nếu phần video hỏng giữa chừng thì chúng
 * vẫn đã xong.
 */
export async function applyAll(
  profileId: string,
  payload: {
    displayName?: string
    /** Đường dẫn ảnh trên máy, do người dùng chọn ở hộp chọn file của hệ điều hành. */
    avatarPath?: string
    privacy?: AccountPrivacyPatch
    videos?: { privacy: Record<string, VideoPrivacy>; remove: string[] }
  },
  onProgress?: (msg: string) => void
): Promise<{
  ok: boolean
  reason?: string
  name?: string
  avatarDone?: boolean
  privacy?: AccountPrivacy
  changed: string[]
  removed: string[]
  failed: string[]
  problems: string[]
}> {
  const empty = { changed: [] as string[], removed: [] as string[], failed: [] as string[], problems: [] as string[] }
  const profile = ProfileStore.get(profileId)
  if (!profile) return { ok: false, reason: 'Không tìm thấy profile', ...empty }
  if (profile.status === 'running') return { ok: false, reason: 'Đóng profile trước khi lưu', ...empty }

  const problems: string[] = []
  let name: string | undefined
  let avatarDone = false
  let privacy: AccountPrivacy | undefined
  let videoRes = { changed: [] as string[], removed: [] as string[], failed: [] as string[] }

  let browser: Browser | null = null
  try {
    onProgress?.('Đang mở trình duyệt…')
    const { browser: b, session } = await openAutomation(profile)
    browser = b
    trackProc(session.process)
    const pages = await browser.pages()
    const page = pages[0] ?? (await browser.newPage())
    page.on('dialog', async (d) => {
      try {
        await d.dismiss()
      } catch {
        /* ignore */
      }
    })

    // Tên và ảnh nằm chung một hộp thoại — làm cùng một lượt, khỏi mở hai lần.
    if (payload.displayName !== undefined || payload.avatarPath) {
      const r = await runProfileEdit(
        page,
        profile,
        { name: payload.displayName, avatarPath: payload.avatarPath },
        onProgress
      )
      if (r.ok) {
        name = r.name
        avatarDone = !!r.avatarDone
        const cached = cache.get(profileId)
        if (cached && r.name) cache.set(profileId, { ...cached, displayName: r.name })
      } else problems.push(`Sửa hồ sơ: ${r.reason ?? 'không đổi được'}`)
    }

    if (payload.privacy && Object.keys(payload.privacy).length > 0) {
      const r = await runAccountPrivacy(page, profileId, payload.privacy, onProgress)
      privacy = r.privacy
      if (!r.ok) problems.push(r.reason ?? 'Không lưu được quyền riêng tư tài khoản')
    }

    if (payload.videos) {
      videoRes = await runVideoEdits(page, profileId, payload.videos, onProgress)
      if (videoRes.failed.length) problems.push(`${videoRes.failed.length} video không xử lý được`)
    }

    return { ok: problems.length === 0, name, avatarDone, privacy, ...videoRes, problems }
  } catch (e) {
    return {
      ok: false,
      reason: (e as Error)?.message || 'Lỗi lưu thay đổi',
      name,
      avatarDone,
      privacy,
      ...videoRes,
      problems
    }
  } finally {
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
