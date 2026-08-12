import { type Browser, type Page } from 'puppeteer-core'
import { openAutomation, closeSession } from './ShardEngine'
import { installRetryGoto } from './tiktokNav'
import { trackProc } from './EngineProcs'
import { ProfileStore } from './ProfileStore'
import { ChannelSearchStore } from './ChannelSearchStore'
import { channelSearchEvents } from './ChannelSearchService'
import type { CsTiktokMatch } from '@shared/types'

function log(msg: string): void {
  channelSearchEvents.emit('log', msg)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

let busy = false

interface RawUser {
  username: string
  nickname: string
  followers: number | null
  avatarUrl: string
}

/** Mở trang search user TikTok, gom kết quả từ JSON của XHR /api/search/. */
async function collectSearchUsers(page: Page, query: string): Promise<RawUser[]> {
  const users: RawUser[] = []
  const onResponse = async (res: any): Promise<void> => {
    if (!/\/api\/search\/(user|general)\//.test(res.url())) return
    try {
      const j = await res.json()
      const list = j?.user_list ?? []
      for (const u of list) {
        const info = u?.user_info
        if (info?.unique_id) {
          users.push({
            username: String(info.unique_id),
            nickname: String(info.nickname ?? ''),
            followers: typeof info.follower_count === 'number' ? info.follower_count : null,
            avatarUrl: info.avatar_thumb?.url_list?.[0] ?? ''
          })
        }
      }
    } catch {
      /* body không phải JSON → bỏ qua */
    }
  }
  page.on('response', onResponse)
  try {
    await page.goto(`https://www.tiktok.com/search/user?q=${encodeURIComponent(query)}`, {
      waitUntil: 'domcontentloaded'
    })
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      if (users.length > 0) break
      // TikTok hiện captcha → dừng sớm với lỗi rõ ràng
      const captcha = await page
        .$('#captcha_container, .captcha_verify_container, [class*="captcha"]')
        .catch(() => null)
      if (captcha) throw new Error('TikTok hiện captcha — mở profile thủ công giải captcha rồi thử lại')
      await sleep(800)
    }
  } finally {
    page.off('response', onResponse)
  }
  return users
}

/**
 * Check 1 candidate: search TikTok theo tên kênh (+ handle nếu khác) qua profile
 * antidetect đã cấu hình, lưu top-N account giống nhất. Ném Error với message
 * tiếng Việt rõ ràng khi không chạy được.
 */
export async function checkTiktok(candidateId: string): Promise<CsTiktokMatch[]> {
  if (busy) throw new Error('Đang check ứng viên khác — chờ xong rồi thử lại')
  busy = true
  try {
    const cand = ChannelSearchStore.getCandidate(candidateId)
    if (!cand) throw new Error('Không tìm thấy ứng viên')
    const s = ChannelSearchStore.getSettings()
    if (!s.checkProfileId) throw new Error('Chưa chọn profile check TikTok (vào ⚙️ Cài đặt)')
    const profile = ProfileStore.get(s.checkProfileId)
    if (!profile) throw new Error('Profile check TikTok không còn tồn tại — chọn lại trong ⚙️ Cài đặt')
    if (!profile.loggedIn) throw new Error(`Profile "${profile.name}" chưa đăng nhập TikTok`)
    if (profile.status === 'running') throw new Error(`Profile "${profile.name}" đang chạy — đóng trước khi check`)

    let browser: Browser | null = null
    try {
      // ShardEngine owns the whole launch pipeline now: proxy auth, CDP, the
      // off-screen window position and the anti-throttle flags that buildArgs()
      // used to add. It also refuses to open a profile that is already running.
      const opened = await openAutomation(profile)
      browser = opened.browser
      trackProc(opened.session.process)

      const pages = await browser.pages()
      const page = pages[0] ?? (await browser.newPage())
      installRetryGoto(page)

      log(`[${cand.name}] Search TikTok: "${cand.name}"…`)
      const byName = await collectSearchUsers(page, cand.name)
      let all = byName
      const handleQ = cand.handle.replace(/^@/, '')
      if (handleQ && handleQ.toLowerCase() !== cand.name.toLowerCase()) {
        log(`[${cand.name}] Search TikTok: "${handleQ}"…`)
        const byHandle = await collectSearchUsers(page, handleQ)
        all = [...byName, ...byHandle]
      }

      // Dedupe theo username; ưu tiên trùng handle chính xác, sau đó follower giảm dần.
      const uniq = new Map<string, RawUser>()
      for (const u of all) if (!uniq.has(u.username)) uniq.set(u.username, u)
      const sorted = [...uniq.values()].sort((a, b) => {
        const aExact = a.username.toLowerCase() === handleQ.toLowerCase() ? 1 : 0
        const bExact = b.username.toLowerCase() === handleQ.toLowerCase() ? 1 : 0
        if (aExact !== bExact) return bExact - aExact
        return (b.followers ?? 0) - (a.followers ?? 0)
      })
      const top = sorted.slice(0, s.topN).map((u) => ({
        username: u.username,
        nickname: u.nickname,
        followers: u.followers,
        videoCount: null as number | null, // search API không trả số video — để null, UI hiện "—"
        avatarUrl: u.avatarUrl
      }))

      const matches = ChannelSearchStore.setMatches(candidateId, top)
      log(`[${cand.name}] Xong: ${matches.length} account giống nhất`)
      return matches
    } finally {
      // Only tear down when THIS call actually opened the browser. closeSession()
      // looks the session up by profile id, so calling it after a failed
      // openAutomation() would kill whatever session already held that profile —
      // e.g. a window the user opened by hand.
      if (browser) {
        try {
          await browser.close()
        } catch {
          /* ignore */
        }
        await closeSession(profile.id)
      }
    }
  } finally {
    busy = false
  }
}
