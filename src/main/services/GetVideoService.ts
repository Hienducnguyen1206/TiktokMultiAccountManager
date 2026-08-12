import { spawn } from 'child_process'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { basename, join } from 'path'
import { EventEmitter } from 'events'
import { ensureFfmpeg, ensureYtDlp } from './YtDlpManager'
import { GetVideoStore } from './GetVideoStore'
import { ProfileStore } from './ProfileStore'
import { type Browser } from 'puppeteer-core'
import { closeSession, isRunning, openAutomation, proxyUrl, shardProfilesDir, shardUserDataDir } from './ShardEngine'
import { trackProc } from './EngineProcs'
import {
  fetchPageMeta,
  listDownloadsSince,
  moveInto,
  openExtBridge,
  revealWindow,
  runBulkJob,
  setDownloadDir
} from './ExtDownloader'
import type { GvChannel, GvCrawlResult, GvSettings, GvSource } from '@shared/types'

export const getVideoEvents = new EventEmitter()

/**
 * Đệm log của lượt chạy, giữ ở MAIN chứ không ở giao diện.
 *
 * Trước đây log chỉ nằm trong state của tab Tải video. Chuyển sang tab khác là
 * React tháo component, kéo theo bộ nghe sự kiện bị gỡ — mà crawl thì vẫn chạy
 * dưới này. Nên log sinh ra trong lúc đó KHÔNG AI HỨNG, quay lại là trắng trơn
 * và mất hẳn phần giữa. Giữ ở đây thì tab chỉ việc đọc lại lúc mở.
 *
 * 500 dòng: đủ cho một lượt crawl channel lớn, mà không phình mãi theo phiên.
 */
const LOG_MAX = 500
const logBuffer: string[] = []

export function getVideoLogs(): string[] {
  return logBuffer
}

/**
 * Người dùng đã bấm Dừng chưa.
 *
 * Cờ ở mức MODULE chứ không theo từng kênh: nút Dừng nghĩa là dừng cả lượt
 * đang chạy, mà một lượt có thể trải qua nhiều kênh. crawlChannel() xoá cờ ở
 * đầu mỗi lần chạy, nên bấm Dừng xong chạy lại là sạch.
 */
let stopRequested = false

export function stopCrawl(): void {
  if (stopRequested) return
  stopRequested = true
  log('■ Đã yêu cầu dừng — đang đóng lại…')
}

export function isStopRequested(): boolean {
  return stopRequested
}

function log(msg: string): void {
  const line = redact(msg)
  logBuffer.push(line)
  if (logBuffer.length > LOG_MAX) logBuffer.splice(0, logBuffer.length - LOG_MAX)
  getVideoEvents.emit('log', line)
}

/**
 * Xoá thông tin đăng nhập proxy khỏi mọi thứ đi ra ngoài.
 *
 * Từ khi profile ảo có thể kèm `--proxy scheme://user:pass@host:port`, output
 * của yt-dlp có thể in nguyên URL đó ra khi lỗi kết nối — và app thì đang ghi
 * mấy dòng cuối của output vào khung log để chẩn đoán 403. Chặn ngay tại cửa
 * duy nhất đi ra, thay vì trông vào việc nhớ lọc ở từng chỗ gọi.
 */
function redact(msg: string): string {
  return msg.replace(/:\/\/[^/\s@]+:[^/\s@]+@/g, '://***:***@')
}

/** Dọn file tải dở của yt-dlp (.part/.ytdl/.temp) trong thư mục Pending —
 *  rác còn sót khi lần tải trước bị ngắt giữa chừng. Gọi lúc khởi động app. */
export function cleanPartFiles(): void {
  try {
    const dir = GetVideoStore.getSettings().pendingDir
    if (!dir || !existsSync(dir)) return
    for (const n of readdirSync(dir)) {
      // CHỈ file tải dở của yt-dlp. KHÔNG đụng .fNNN.mp4 (có thể là video thật).
      if (/\.(part|ytdl|part-Frag\d+|temp)$/i.test(n)) {
        try {
          rmSync(join(dir, n), { force: true })
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
}

interface RunResult {
  code: number
  out: string
}

/** Nguồn cookie nào đã xác định không đọc được trong lượt chạy này. */
const cookieBroken = new Map<string, string>()

/** Quên kết luận cũ để lượt chạy mới thử lại — người dùng có thể vừa đóng trình
 *  duyệt hoặc đổi sang nguồn khác. */
function resetCookieState(): void {
  cookieBroken.clear()
}

/** Nguồn cookie đã giải xong, dùng chung cho mọi lệnh yt-dlp của lượt chạy. */
interface CookieSource {
  /** Tham số truyền thẳng cho yt-dlp. Rỗng = chạy không cookie. */
  args: string[]
  /** Tên hiện trong log, cũng là khoá ghi nhớ khi hỏng.
   *  TUYỆT ĐỐI không được chứa mật khẩu proxy. */
  label: string
}

const NO_COOKIES: CookieSource = { args: [], label: '' }

/**
 * Dựng nguồn cookie từ cài đặt. Profile ảo được ưu tiên hơn trình duyệt hệ thống.
 *
 * Vì sao profile ảo đọc được mà Chrome thật thì không: từ bản 127 các trình
 * duyệt nhân Chromium giữ khoá giải mã cookie trong một dịch vụ hệ thống chỉ
 * cấp cho đúng file thực thi của chúng (App-Bound Encryption), nên yt-dlp luôn
 * chết ở "Failed to decrypt with DPAPI". Chromium của ShardX KHÔNG có cơ chế
 * đó — đo thật trên một profile có sẵn: "Extracted 7 cookies from chrome".
 *
 * PHẢI trỏ vào thư mục con `Default`, KHÔNG phải thư mục gốc của profile:
 * yt-dlp tìm khoá trong `Local State` ở THƯ MỤC CHA của đường dẫn được đưa. Đưa
 * thư mục gốc thì nó ngó lên `shard-profiles\` (không có `Local State` ở đó),
 * rơi về khoá của Chrome thật và hỏng sạch — đo thật: "Extracted 0 cookies
 * (7 could not be decrypted) … MAC check failed. Possibly the key is wrong?".
 */
function cookieSource(s: GvSettings): CookieSource {
  if (s.cookieProfileId) {
    const p = ProfileStore.get(s.cookieProfileId)
    if (!p) {
      log('⚠ Profile lấy cookie không còn nữa — chạy không cookie.')
      return NO_COOKIES
    }
    // Chromium đang chạy thì khoá luôn file Cookies, yt-dlp copy không được.
    // Nói trước ở đây thay vì để nó hỏng rồi mới đoán ngược lại từ câu lỗi.
    if (isRunning(p.id)) {
      log(`⚠ Profile "${p.name}" đang mở nên file cookie bị khoá — chạy không cookie. Đóng profile rồi chạy lại.`)
      return NO_COOKIES
    }
    const dir = join(shardProfilesDir(), p.shardProfileId ?? p.id, 'Default')
    if (!existsSync(dir)) {
      log(`⚠ Profile "${p.name}" chưa mở lần nào nên chưa có cookie — chạy không cookie.`)
      return NO_COOKIES
    }
    const args = ['--cookies-from-browser', `chrome:${dir}`]
    // Đi đúng đường mạng mà tài khoản vẫn sống. Đăng nhập sau proxy rồi tải
    // bằng IP nhà là vênh IP — dấu hiệu còn xấu hơn không có cookie.
    const url = proxyUrl(p)
    if (url) args.push('--proxy', url) // KHÔNG log biến này: có mật khẩu proxy
    return { args, label: `profile ${p.name}` }
  }
  if (s.cookieBrowser) return { args: ['--cookies-from-browser', s.cookieBrowser], label: s.cookieBrowser }
  return NO_COOKIES
}

/**
 * Chạy yt-dlp có kèm cookie; nếu hỏng ĐÚNG vì khâu cookie thì nói rõ lý do, ghi
 * nhớ, rồi chạy lại KHÔNG cookie.
 *
 * Cookie chỉ cần khi YouTube giở bài kiểm tra bot. Bỏ cuộc hoàn toàn chỉ vì
 * không đọc nổi cookie là hỏng một việc vốn vẫn làm được — đo thật: tải cùng
 * video đó không kèm cookie thì chạy ngon, exit 0.
 */
async function runWithCookies(exe: string, base: string[], src: CookieSource): Promise<RunResult> {
  const use = src.args.length > 0 && !cookieBroken.has(src.label)
  const r = await runYtDlp(exe, use ? [...src.args, ...base] : base)
  if (r.code === 0 || !use) return r
  const why = cookieProblem(r.out)
  if (!why) return r
  // Nhớ lại để CẢ LƯỢT CHẠY này thôi thử nữa. Đo thật: mỗi lần thử hỏng tốn 3,3
  // giây, mà cookie hỏng thì hỏng ở mọi lệnh — kênh 98 video sẽ vứt đi hơn 5
  // phút và in 98 dòng cảnh báo y hệt nhau.
  cookieBroken.set(src.label, why)
  log(`⚠ Bỏ qua cookie (${src.label}) cho cả lượt này: ${why}`)
  return runYtDlp(exe, base)
}

/**
 * Đọc ra lý do THẬT khi yt-dlp không lấy được cookie trình duyệt.
 *
 * Câu lỗi phụ thuộc trình duyệt CÓ ĐANG CHẠY hay không, và đó là hai nguyên
 * nhân khác hẳn nhau — đo trên máy thật (Chrome 150, Edge 151):
 *   • đang chạy → "Could not copy … cookie database"  → khoá file, ĐÓNG là xong
 *   • đã tắt    → "Failed to decrypt with DPAPI"       → App-Bound Encryption,
 *                                                        đóng cũng vô ích
 *   • firefox   → chạy bình thường ở cả hai trạng thái
 *
 * Từ bản 127, các trình duyệt nhân Chromium giữ khoá giải mã trong một dịch vụ
 * hệ thống chỉ cấp cho đúng file thực thi của chúng, nên chương trình khác dù
 * chạy cùng tài khoản Windows cũng không mở được. Phân biệt đúng hai câu này
 * quan trọng: một cái sửa được bằng cách đóng trình duyệt, cái kia thì không.
 */
function cookieProblem(out: string): string | null {
  if (/Failed to decrypt with DPAPI/i.test(out))
    return 'trình duyệt nhân Chromium (Chrome/Edge/Brave…) từ bản 127 mã hoá cookie bằng App-Bound Encryption — yt-dlp không đọc được, đóng trình duyệt cũng không giúp. Dùng Firefox hoặc để "Không dùng".'
  if (/Could not copy .{0,20}cookie database|could not find .{0,20}cookies database/i.test(out))
    return 'không đọc được cookie vì trình duyệt đang mở và khoá file. Đóng hẳn trình duyệt đó rồi thử lại.'
  if (/could not process cookie|unsupported browser/i.test(out)) return 'yt-dlp không hỗ trợ trình duyệt đã chọn.'
  return null
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * YouTube chặn cả PHIÊN, không phải chặn một video.
 *
 * Nặng hơn 403 một bậc: 403 là đã xin được link rồi mới bị từ chối, còn câu này
 * là không cho xin nữa. Gặp nó thì mọi video sau đều hỏng y hệt — cày tiếp chỉ
 * tổ nện thêm vào cái IP đang bị soi và kéo dài thời gian bị chặn.
 */
function isBotBlock(out: string): boolean {
  return /Sign in to confirm|not a bot|LOGIN_REQUIRED/i.test(out)
}

/**
 * Hỏng nhất thời — đáng thử lại.
 *
 * Đo thật: ba video 403 trong một lượt chạy (o4aFmmUk6BQ, JCLs9ur2jRg,
 * DVBpbXQJPAM) đều tải được ở lần chạy sau mà không đổi bất cứ tham số nào.
 */
function isTransient(out: string): boolean {
  return /HTTP Error 403|Forbidden|HTTP Error 429|Too Many Requests|unable to download video data|timed out|Connection reset|RemoteDisconnected/i.test(
    out
  )
}

function runYtDlp(exe: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { windowsHide: true })
    let out = ''
    child.stdout.on('data', (d) => (out += d.toString()))
    child.stderr.on('data', (d) => (out += d.toString()))
    child.on('error', () => resolve({ code: -1, out }))
    child.on('exit', (code) => resolve({ code: code ?? -1, out }))
  })
}

/** Tên nguồn để ghép vào câu báo lỗi cho người đọc. */
const SOURCE_LABEL: Record<GvSource, string> = {
  youtube: 'YouTube',
  facebook: 'Facebook',
  instagram: 'Instagram',
  douyin: 'Douyin'
}

/**
 * Chuẩn hóa input người dùng thành URL gốc của channel.
 *
 * Chỉ YouTube mới đoán được từ `@handle` hay tên trơn, vì handle của nó nằm ngay
 * trên tên miền. Ba nguồn kia bắt buộc dán URL đầy đủ: Douyin định danh người
 * dùng bằng `sec_uid` dài loằng ngoằng chứ không phải tên, còn Facebook có tới
 * mấy dạng đường dẫn (`/<tên>`, `/profile.php?id=`, `/people/…`) — đoán là đoán sai.
 */
function toChannelUrl(input: string, source: GvSource = 'youtube'): string {
  let s = input.trim()
  if (source === 'youtube') {
    if (s.startsWith('@')) s = `https://www.youtube.com/${s}`
    else if (!/^https?:\/\//i.test(s)) s = `https://www.youtube.com/${s}`
    s = s.replace(/\/(videos|shorts|streams|featured)\/?$/i, '')
  } else if (!/^https?:\/\//i.test(s)) {
    // Thiếu giao thức thì thêm vào, còn lại giữ nguyên những gì người dùng dán.
    s = `https://${s}`
  }
  return s.replace(/\/$/, '')
}

/**
 * URL đem đi liệt kê video. YouTube dùng tab Shorts để khỏi vớ phải video dài;
 * ba nguồn kia không có khái niệm tab nên lấy thẳng URL trang.
 */
function toListUrl(input: string, source: GvSource = 'youtube'): string {
  const base = toChannelUrl(input, source)
  return source === 'youtube' ? base + '/shorts' : base
}

/**
 * Lấy tên + avatar của channel qua yt-dlp (1 request metadata, không tải gì).
 * Avatar nằm trong thumbnails với id 'avatar_uncropped'; bản dự phòng là thumbnail
 * vuông (banner thì luôn chữ nhật) — đã kiểm bằng dữ liệu thật của yt-dlp.
 */
async function fetchChannelMeta(
  url: string,
  source: GvSource = 'youtube'
): Promise<{ name: string; avatar: string } | null> {
  const exe = await ensureYtDlp()
  const s = GetVideoStore.getSettings()
  const r = await runWithCookies(
    exe,
    [toChannelUrl(url, source), '-J', '--flat-playlist', '--playlist-end', '1', '--no-warnings'],
    cookieSource(s)
  )
  if (r.code !== 0) return null
  const line = r.out.split('\n').find((l) => l.trim().startsWith('{'))
  if (!line) return null
  try {
    const j = JSON.parse(line)
    const thumbs: { url?: string; id?: string; width?: number; height?: number }[] = j.thumbnails ?? []
    const avatar =
      thumbs.find((t) => t.id === 'avatar_uncropped')?.url ??
      thumbs.filter((t) => t.width && t.width === t.height).pop()?.url ??
      ''
    return { name: typeof j.channel === 'string' ? j.channel : '', avatar }
  } catch {
    return null
  }
}

/** Lấy metadata 1 channel rồi lưu. Trả true nếu có cập nhật gì. */
export async function refreshChannelMeta(channelId: string): Promise<boolean> {
  const c = GetVideoStore.getChannel(channelId)
  if (!c) return false
  const meta = await fetchChannelMeta(c.url, c.source)
  if (!meta || (!meta.name && !meta.avatar)) return false
  GetVideoStore.setMeta(channelId, meta.name, meta.avatar)
  getVideoEvents.emit('update')
  return true
}

/** Bổ sung avatar cho mọi channel còn thiếu — chạy tuần tự để không dội request YouTube. */
let metaSyncing = false
/**
 * Đồng bộ tên + ảnh đại diện cho toàn bộ kênh của một nguồn.
 *
 * YouTube đi qua yt-dlp như cũ, không cần trình duyệt. Ba nguồn kia phải mở
 * trang ra mới đọc được meta — nên mở hồ sơ MỘT lần rồi duyệt hết danh sách,
 * thay vì mở lại cho từng kênh (mỗi lần mở mất cả chục giây).
 *
 * Chỉ chạy khi người dùng tự bấm, không chạy ngầm lúc mở tab: bật hẳn một cửa
 * sổ trình duyệt lên trong khi người dùng không yêu cầu là chuyện không nên làm.
 */
export async function syncChannelMeta(source: GvSource): Promise<{ ok: number; failed: number }> {
  const channels = GetVideoStore.listChannels(source)
  if (!channels.length) return { ok: 0, failed: 0 }

  stopRequested = false
  let ok = 0
  let failed = 0

  if (!EXT_SOURCES.has(source)) {
    resetCookieState()
    for (const c of channels) {
      if (isStopRequested()) break
      if (await refreshChannelMeta(c.id)) ok++
      else failed++
    }
    log(`Đồng bộ ${SOURCE_LABEL[source]}: ${ok} kênh xong, ${failed} không đọc được`)
    return { ok, failed }
  }

  const s = GetVideoStore.getSettings()
  const profile = s.cookieProfileId ? ProfileStore.get(s.cookieProfileId) : null
  if (!profile) throw new Error('Chưa chọn hồ sơ tải — vào Cài đặt chọn "Cookie từ hồ sơ ảo"')
  if (isRunning(profile.id)) throw new Error(`Hồ sơ "${profile.name}" đang mở — đóng lại rồi thử lại`)

  let browser: Browser | null = null
  try {
    log(`Mở hồ sơ "${profile.name}" để đọc tên và ảnh của ${channels.length} kênh…`)
    const { browser: b, session } = await openAutomation(profile)
    browser = b
    trackProc(session.process)
    const pages = await browser.pages()
    const page = pages[0] ?? (await browser.newPage())
    await revealWindow(page)

    for (const c of channels) {
      if (isStopRequested()) break
      const meta = await fetchPageMeta(page, toChannelUrl(c.url, source))
      if (meta && (meta.name || meta.avatar)) {
        GetVideoStore.setMeta(c.id, meta.name, meta.avatar)
        ok++
        log(`  ✓ ${meta.name || c.url}${meta.avatar ? '' : ' — KHÔNG có ảnh'}`)
        // Thiếu ảnh thì in luôn phần chẩn đoán: báo "xong" mà danh sách không
        // đổi gì là kiểu hỏng khó đoán nhất từ bên ngoài.
        if (!meta.avatar) log(`      ${meta.why}`)
      } else {
        failed++
        log(`  ✗ không đọc được ${c.url}`)
        if (meta) log(`      ${meta.why}`)
      }
      getVideoEvents.emit('update')
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
  log(`Đồng bộ ${SOURCE_LABEL[source]}: ${ok} kênh xong, ${failed} không đọc được`)
  return { ok, failed }
}

export async function refreshMissingMeta(): Promise<void> {
  if (metaSyncing) return
  metaSyncing = true
  resetCookieState()
  try {
    for (const c of GetVideoStore.channelsMissingAvatar()) {
      await refreshChannelMeta(c.id)
    }
  } finally {
    metaSyncing = false
  }
}

/**
  * URL đem đi tải một video.
  *
  * Ưu tiên URL mà khâu liệt kê in ra. Chỉ khi nó không có mới ghép lại từ mã, và
  * ghép được thì cũng chỉ với YouTube. Bản trước LUÔN ghép `watch?v=<mã>` — đúng
  * với YouTube, nhưng nguồn khác thì cho ra một URL YouTube không tồn tại.
  */
function videoUrl(id: string, listed: string, source: GvSource): string | null {
  if (/^https?:\/\//i.test(listed)) return listed
  if (source === 'youtube') return `https://www.youtube.com/watch?v=${id}`
  return null
}



/**
 * Ba nguồn này đi hẳn qua extension Social Bulk Downloader: chính nó liệt kê,
 * chính nó tải. yt-dlp không đụng vào, và cũng không có đường lùi về yt-dlp.
 *
 * Vì sao không tự làm: đo thật trên yt-dlp 2026.07.04 thì cả ba đều không liệt
 * kê được theo trang (Unsupported URL / Unable to extract data), còn ở khâu tải
 * thì Douyin đòi "Fresh cookies (not necessarily logged in) are needed". Bản
 * thân extension thì đã giải xong cả hai chuyện đó và người dùng đã cài sẵn.
 */
const EXT_SOURCES = new Set<GvSource>(['facebook', 'instagram', 'douyin'])

/**
 * Chạy một kênh bằng extension, rồi dọn file nó tải về sang Pending.
 *
 * Trình tự: mở hồ sơ tải → mở trang extension → điền form → đợi job xong → hỏi
 * chrome.downloads xem vừa ghi ra những file nào → chuyển sang Pending.
 *
 * Chống tải trùng theo TÊN FILE chứ không theo mã video: sau khi extension tải
 * xong, tên file là thứ duy nhất còn lại để nhận ra video: app không nhìn thấy
 * danh sách nó đã duyệt. Vì vậy cấu hình tên file luôn kèm 'id' (ép ở
 * GetVideoStore) — không có mã trong tên thì hai video khác nhau cùng tiêu đề
 * sẽ bị coi là một.
 */
async function runViaExtension(
  s: GvSettings,
  channel: GvChannel
): Promise<{ downloaded: number; skipped: number; failed: number }> {
  const profile = ProfileStore.get(s.cookieProfileId)
  if (!profile) throw new Error('Không tìm thấy hồ sơ tải — vào Cài đặt chọn lại')
  if (isRunning(profile.id)) throw new Error(`Hồ sơ "${profile.name}" đang mở — đóng lại rồi chạy lại`)

  // Trỏ thư mục tải của hồ sơ vào Pending TRƯỚC khi mở trình duyệt: Chromium
  // đọc Preferences lúc khởi động, đổi sau khi nó chạy rồi là vô ích. Làm được
  // thì file rơi thẳng chỗ cần, không phải chuyển đi đâu nữa.
  mkdirSync(s.pendingDir, { recursive: true })
  const direct = setDownloadDir(shardUserDataDir(profile.shardProfileId ?? profile.id), s.pendingDir)
  if (!direct) log('⚠ Không đặt được thư mục tải của hồ sơ — sẽ chuyển file sang Pending sau khi tải xong')

  let browser: Browser | null = null
  let downloaded = 0
  let skipped = 0

  /**
   * Đóng trình duyệt. Gọi được nhiều lần, lần thứ hai không làm gì.
   *
   * Cần gọi được sớm chứ không chỉ ở finally: khi người dùng bấm Dừng, đóng
   * trình duyệt là thứ CHẮC CHẮN chặn được extension. Để nó sống trong lúc app
   * dọn file thì nó vẫn tải tiếp, nhìn từ ngoài đúng là nút Dừng không ăn.
   */
  const closeBrowser = async (): Promise<void> => {
    if (!browser) return
    const b = browser
    browser = null
    try {
      await b.close()
    } catch {
      /* ignore */
    }
    await closeSession(profile.id)
    ProfileStore.setRunning(profile.id, false)
  }

  try {
    if (isStopRequested()) return { downloaded: 0, skipped: 0, failed: 0 }
    log(`Mở hồ sơ "${profile.name}" để tải qua extension…`)
    const { browser: b, session } = await openAutomation(profile)
    browser = b
    trackProc(session.process)
    const bridge = await openExtBridge(browser, profile.name)

    // Mốc thời gian phải lấy TRƯỚC khi bấm chạy: sau đó mới hỏi
    // chrome.downloads "có gì mới từ mốc này", nên file nào của lượt này cũng
    // nằm trong khoảng, mà file người dùng tự tải lúc khác thì không.
    const since = Date.now()
    const r = await runBulkJob(
      bridge,
      channel.source,
      toChannelUrl(channel.url, channel.source),
      {
        fileNameFormat: s.extFileNameFormat,
        concurrency: s.extConcurrency,
        delaySeconds: s.extDelaySeconds
      },
      log,
      isStopRequested
    )
    if (r.status === 'TIMEOUT') log('⚠ Quá giờ chờ extension — lấy những gì đã tải được')
    else if (r.status === 'STOPPED') log('■ Đã dừng — giữ lại những gì đã tải xong')
    else if (r.status === 'FAILED') log('⚠ Extension báo tiến trình hỏng — lấy những gì đã tải được')

    const files = await listDownloadsSince(bridge, since)
    // Có danh sách rồi thì không cần trình duyệt nữa — đóng NGAY. File đã nằm
    // trên đĩa, phần dọn dẹp bên dưới không đụng gì tới nó.
    await closeBrowser()
    log(`  ⇣ extension ghi ra ${files.length} file`)

    for (const f of files) {
      const key = basename(f).replace(/\.[^.]+$/, '')
      if (GetVideoStore.isDownloaded(key)) {
        // Đã có trong Pending từ lượt trước. Xoá bản vừa tải, đừng để hai bản
        // cùng nội dung nằm chờ đăng.
        rmSync(f, { force: true })
        skipped++
        continue
      }
      try {
        const dest = moveInto(f, s.pendingDir)
        GetVideoStore.markDownloaded(key, channel.id, key, channel.url)
        downloaded++
        log(`  ✓ ${basename(dest)}`)
      } catch (e) {
        log(`  ✗ không chuyển được ${basename(f)}: ${(e as Error).message}`)
      }
      getVideoEvents.emit('update')
    }
    // Extension bỏ qua bao nhiêu thì cộng luôn vào — người dùng chỉ cần một con
    // số "bỏ qua", không cần biết bên nào bỏ.
    skipped += r.skipped
  } finally {
    await closeBrowser()
  }
  return { downloaded, skipped, failed: 0 }
}

/**
 * Backfill 1 channel: liệt kê Shorts hiện có → lọc (thời lượng / cửa sổ giờ hoặc
 * số lượng) → tải cái chưa có về Pending. Trả về thống kê.
 */
export async function crawlChannel(channelId: string): Promise<GvCrawlResult> {
  const channel = GetVideoStore.getChannel(channelId)
  if (!channel) throw new Error('Không tìm thấy channel')
  const s: GvSettings = GetVideoStore.getSettings()
  if (!s.pendingDir || !existsSync(s.pendingDir)) {
    throw new Error('Chưa cấu hình thư mục Pending hợp lệ (vào Setting)')
  }
  // Kiểm ĐỦ ĐIỀU KIỆN trước khi đụng vào bất cứ thứ gì nặng: ensureYtDlp() có
  // thể phải tải binary về, mà thiếu hồ sơ thì kiểu gì cũng hỏng ở dưới.
  if (EXT_SOURCES.has(channel.source) && !s.cookieProfileId)
    throw new Error(
      `${SOURCE_LABEL[channel.source]} cần một hồ sơ để mở trang — vào Cài đặt chọn "Cookie từ hồ sơ ảo"`
    )
  mkdirSync(s.pendingDir, { recursive: true })
  stopRequested = false // lượt mới, quên lần bấm Dừng trước đi
  resetCookieState() // mỗi lượt crawl thử lại cookie đúng một lần
  // Cookie và yt-dlp chỉ còn phục vụ YouTube. Ba nguồn kia đi hẳn đường trình
  // duyệt + extension, nên không giải cookie (khỏi in dòng log gây hiểu nhầm) và
  // không tải binary về làm gì.
  const viaExt = EXT_SOURCES.has(channel.source)
  // Giải MỘT lần cho cả lượt: cookieSource() có thể ghi log giải thích vì sao
  // không dùng được cookie, gọi lại ở từng video sẽ in đúng câu đó 100 lần.
  const cookies = viaExt ? NO_COOKIES : cookieSource(s)
  if (cookies.label) log(`🍪 Dùng cookie từ ${cookies.label}`)

  const exe = viaExt ? '' : await ensureYtDlp()
  const ffmpegDir = viaExt ? '' : await ensureFfmpeg()
  const listUrl = toListUrl(channel.url, channel.source)
  // 'count' → giới hạn N bài gần nhất; 'hours' → quét 50 bài gần nhất rồi lọc theo giờ;
  // 'all' → không giới hạn (liệt kê toàn bộ), chỉ loại video đã tải ở dưới.
  const limit = s.backfillMode === 'count' ? Math.max(1, s.backfillCount) : s.backfillMode === 'hours' ? 50 : null

  // ---- Ba nguồn chạy hẳn bằng extension ----
  //
  // Extension tự liệt kê và tự tải, nên không có khâu "liệt kê rồi tải" như
  // YouTube. Xong là ra thẳng kết quả.
  if (viaExt) {
    const r = await runViaExtension(s, channel)
    GetVideoStore.markCrawled(channel.id, r.downloaded)
    log(
      `[${channel.name || channel.url}] Xong: ${r.downloaded} tải, ${r.skipped} bỏ qua, ${r.failed} lỗi`
    )
    getVideoEvents.emit('update')
    return r
  }

  log(`[${channel.name || channel.url}] Liệt kê video…`)

  /** id + tên kênh + URL thật của từng video. */
  let rows: { id: string; ch: string; url: string }[] = []

  {
    const list = await runWithCookies(
      exe,
      [
        '--flat-playlist',
        '--no-warnings',
        '--print',
        // In thêm %(url)s: khâu tải cần URL THẬT. Ghép lại từ mã chỉ đúng
        // với YouTube. Trường vắng thì yt-dlp in "NA", xử ở dưới.
        '%(id)s\t%(channel)s\t%(url)s',
        ...(limit !== null ? ['--playlist-end', String(limit)] : []),
        listUrl
      ],
      cookies
    )
    if (list.code !== 0) {
      log(`[${channel.url}] Lỗi liệt kê: ${list.out.split('\n').slice(-3).join(' ')}`)
      // Nói đúng nguyên nhân. Bản trước lúc nào cũng đổ cho URL sai, kể cả khi thật
      // ra là YouTube chặn bot hay cookie hỏng — người dùng đi sửa nhầm chỗ.
      const why = cookieProblem(list.out)
      if (why) throw new Error(`Không liệt kê được: ${why}`)
      // "Unsupported URL" = yt-dlp không có bộ đọc cho dạng đường dẫn này. Với ba
      // nguồn ngoài YouTube thì đó là chuyện bình thường chứ không phải gõ sai: đo
      // thật trên bản 2026.07.04, cả /reels, /videos lẫn URL trang trần của
      // Facebook đều bị từ chối — nó chỉ có bộ đọc cho TỪNG video, không có bộ đọc
      // liệt kê theo trang. Nói thẳng ra thay vì ném nguyên câu tiếng Anh của
      // yt-dlp, kẻo người dùng ngồi sửa URL mãi không xong.
      if (channel.source !== 'youtube' && /Unsupported URL/i.test(list.out)) {
        throw new Error(
          `${SOURCE_LABEL[channel.source]} không cho liệt kê video theo trang — yt-dlp chỉ đọc được LINK TỪNG VIDEO. ` +
            'Xoá mục này đi, rồi dán thẳng link của một video (hoặc reel) cụ thể.'
        )
      }
      // Lời khuyên cũ ("chọn Firefox") nay sai chỗ: gốc rễ là đang tải với tư cách
      // KHÁCH, mà trần của khách chỉ ~300 video/giờ so với ~2000 khi có tài khoản.
      if (isBotBlock(list.out) || /429|Too Many Requests/i.test(list.out))
        throw new Error(
          'YouTube đang chặn bot vì tải quá nhiều với tư cách khách. Nghỉ vài giờ, hoặc vào Setting chọn profile lấy cookie để tải bằng tài khoản.'
        )
      throw new Error('yt-dlp không liệt kê được channel (URL sai?)')
    }

    rows = list.out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [id, ch, u] = l.split('\t')
        return { id, ch, url: u && u !== 'NA' ? u : '' }
      })
      .filter((r) => r.id && r.id !== 'NA')
  }

  // cập nhật tên channel nếu lần đầu
  if (!channel.name && rows[0]?.ch && rows[0].ch !== 'NA') {
    GetVideoStore.setName(channelId, rows[0].ch)
  }

  // lọc cái chưa tải
  const todo = rows.filter((r) => !GetVideoStore.isDownloaded(r.id))
  // Hàng đợi bên dưới chỉ mang mã video, nên URL tra qua bảng này. Giữ nguyên
  // cấu trúc hàng đợi + lượt thử lại, khỏi phải sửa hai chỗ đó.
  const urlById = new Map(rows.map((r) => [r.id, r.url]))
  log(`[${channel.name || channel.url}] ${rows.length} video, ${todo.length} chưa tải`)

  // match-filter: thời lượng + (cửa sổ giờ nếu mode hours)
  // Dấu '?' sau toán tử = "hoặc trường này không có" (đọc từ chính --help của
  // yt-dlp). Chỉ dùng cho nguồn NGOÀI YouTube: chưa đo được Facebook/Instagram/
  // Douyin có trả duration và timestamp hay không, mà thiếu trường thì bộ lọc
  // loại sạch — kết quả là "0 video" trông y như hỏng vì lý do khác. YouTube
  // luôn có hai trường này nên giữ nguyên dạng chặt, không đổi hành vi đang chạy.
  const q = channel.source === 'youtube' ? '' : '?'
  const filterParts = [`duration<=${q}${s.maxDuration}`]
  if (s.backfillMode === 'hours') {
    const after = Math.floor(Date.now() / 1000) - s.backfillHours * 3600
    filterParts.push(`timestamp>=${q}${after}`)
  }
  const matchFilter = filterParts.join(' & ')
  // Tiêu đề đã LÀM SẠCH (#hashtag + ký tự đặc biệt) qua --replace-in-metadata.
  // Vẫn kèm [mã video] ở cuối tên file để chống trùng; caption sẽ tự bỏ [mã] này.
  const outTemplate = join(s.pendingDir, s.nameByTitle ? '%(title)s [%(id)s].%(ext)s' : '%(id)s.%(ext)s')
  // Chuỗi làm sạch tiêu đề, áp dụng theo thứ tự: bỏ hashtag → bỏ ký tự đặc
  // biệt/emoji (giữ chữ/số/space/gạch) → gộp khoảng trắng.
  const titleClean = [
    '--replace-in-metadata', 'title', '#\\S+', '',
    '--replace-in-metadata', 'title', '[^\\w\\s-]', '',
    '--replace-in-metadata', 'title', '\\s+', ' '
  ]

  let downloaded = 0
  let skipped = 0
  let failed = 0

  /** Video hỏng nhất thời, gom lại thử lại một lượt ở cuối. */
  const retryQueue: string[] = []
  /** Số lần dính chặn-bot; đủ ngưỡng thì bỏ cuộc cả lượt. */
  let botBlocks = 0
  let aborted = false
  /**
   * Giãn nhịp TỰ ĐIỀU CHỈNH, tính bằng ms, áp trước mỗi video.
   *
   * Giãn cố định thì lúc nào cũng chậm kể cả khi YouTube chẳng phàn nàn gì;
   * không giãn gì thì lúc đã bị soi vẫn nện đều và càng bị siết. Nên: chạy hết
   * tốc khi đang trót lọt, hỏng cái nào thì chùn lại, trót lọt lại thì nhanh dần
   * về như cũ.
   */
  let paceMs = 0

  const downloadOne = async (id: string): Promise<void> => {
    if (aborted) return
    // Nút Dừng có tác dụng với CẢ bốn nguồn, không riêng ba nguồn chạy
    // extension. Chặn ngay ở đây thì video đang tải dở vẫn chạy nốt còn video
    // sau thì không bắt đầu nữa.
    if (stopRequested) {
      aborted = true
      return
    }
    const url = videoUrl(id, urlById.get(id) ?? '', channel.source)
    if (!url) {
      // Khâu liệt kê không in ra URL và cũng không ghép lại được. Nói thẳng chứ
      // đừng thử tải một URL bịa ra rồi báo lỗi mạng.
      failed++
      log(`  ✕ ${id}: không dựng được URL video cho nguồn ${channel.source}`)
      return
    }
    if (paceMs) await sleep(paceMs)
    const r = await runWithCookies(
      exe,
      [
        '-f',
        'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best',
        '--merge-output-format',
        'mp4',
        '--ffmpeg-location',
        ffmpegDir,
        '--no-playlist',
        // KHÔNG có --no-warnings ở đây (khác lệnh liệt kê bên trên, chỗ đó phải
        // giữ vì cảnh báo lẫn vào output làm hỏng khâu tách id). Chính cảnh báo
        // mới nói ra vì sao 403: thiếu PO token, format bị bỏ, client nào đang
        // dùng. Bịt nó đi thì trong tay chỉ còn mỗi chữ "403: Forbidden".
        // Không dùng --sleep-* của yt-dlp: chúng giãn CỐ ĐỊNH mọi lúc. Việc giãn
        // nhịp do `paceMs` ở trên lo, và nó chỉ chậm lại khi thật sự bị chặn.
        '--limit-rate', '5M',
        ...titleClean,
        '--match-filter',
        matchFilter,
        '-o',
        outTemplate,
        url
      ],
      cookies
    )
    const out = r.out
    if (r.code === 0 && (/Destination:|has already been downloaded|Merging/i.test(out))) {
      // lấy title từ DB sau; ở đây chỉ cần đánh dấu
      GetVideoStore.markDownloaded(id, channelId, '', url)
      downloaded++
      // Trót lọt thì nới dần trở lại, không nhảy thẳng về 0 — vừa hỏng xong mà
      // phi ngay hết tốc là rơi lại vào đúng chỗ vừa ngã.
      paceMs = Math.max(0, paceMs - 500)
      log(`  ✓ tải ${id}`)
    } else if (/does not pass filter|Skipping/i.test(out)) {
      skipped++
    } else if (isBotBlock(out)) {
      // Chặn ở mức PHIÊN: video nào cũng sẽ hỏng như nhau. Chùn mạnh, và quá 3
      // lần thì bỏ cuộc — chạy nốt 100 video để in 100 dòng lỗi giống hệt nhau
      // chỉ làm YouTube siết chặt thêm.
      botBlocks++
      paceMs = Math.min(paceMs + 5000, 30_000)
      retryQueue.push(id)
      log(`  ⛔ ${id}: YouTube chặn bot (lần ${botBlocks}/3)`)
      if (botBlocks >= 3) {
        aborted = true
        log('⛔ Dừng lượt này: YouTube đang chặn bot. Nghỉ vài giờ, hoặc chọn profile lấy cookie trong Setting để tải với tư cách tài khoản (trần ~2000 video/giờ thay vì ~300).')
      }
    } else if (r.code !== 0) {
      if (isTransient(out)) {
        retryQueue.push(id)
        paceMs = Math.min(paceMs + 2000, 15_000)
      } else {
        failed++
      }
      // Giữ vài dòng cuối chứ không phải một. Câu 403 của YouTube không tự khai
      // lý do ở dòng cuối — lý do nằm ở mấy dòng cảnh báo ngay trước nó, và bản
      // cũ vứt sạch phần đó đi nên mọi lần hỏng đều trông giống hệt nhau.
      const tail = out
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .filter((l) => !/^\[download\]\s+\d/.test(l)) // bỏ dòng phần trăm
        .slice(-6)
      log(`  ✗ lỗi ${id}:`)
      for (const l of tail) log(`      ${l}`)
    } else {
      // exit 0 nhưng không rõ → coi như skipped
      skipped++
    }
    getVideoEvents.emit('update')
  }

  // pool song song theo concurrency
  const pool = Math.max(1, s.concurrency)
  const queue = [...todo.map((t) => t.id)]
  const workers: Promise<void>[] = []
  for (let i = 0; i < pool; i++) {
    workers.push(
      (async () => {
        for (;;) {
          if (aborted) break
          const id = queue.shift()
          if (!id) break
          await downloadOne(id)
        }
      })()
    )
  }
  await Promise.all(workers)

  // ---- Lượt thử lại ----
  //
  // Lỗi 403 của YouTube là chập chờn chứ không cố định: đo thật, ba video hỏng
  // trong một lượt đều tải được ở lần sau mà không đổi gì. Thử lại một lượt dọn
  // được gần hết, rẻ hơn hẳn mọi cách chống chặn khác.
  //
  // Chạy TUẦN TỰ chứ không song song, và nghỉ trước khi bắt đầu: đây đúng lúc
  // YouTube vừa cau mày, dồn 3 luồng vào là xin bị siết tiếp.
  if (!aborted && retryQueue.length) {
    const wait = 20_000
    log(`↻ ${retryQueue.length} video hỏng — nghỉ ${wait / 1000}s rồi thử lại một lượt…`)
    await sleep(wait)
    const again = [...retryQueue]
    retryQueue.length = 0
    let i = 0
    for (; i < again.length; i++) {
      if (aborted) break
      await downloadOne(again[i])
    }
    // Thử lại vẫn hỏng, CỘNG những cái chưa kịp thử vì đã bỏ cuộc giữa chừng.
    failed += retryQueue.length + (again.length - i)
  } else {
    failed += retryQueue.length
  }

  GetVideoStore.markCrawled(channelId, downloaded)
  log(
    `[${channel.name || channel.url}] ${aborted ? 'DỪNG GIỮA CHỪNG' : 'Xong'}: ` +
      `${downloaded} tải, ${skipped} bỏ qua, ${failed} lỗi` +
      // Video hỏng KHÔNG được đánh dấu đã tải, nên chạy lại kênh là nó tự lấy nốt.
      (failed ? ' — chạy lại kênh này sẽ tự lấy tiếp phần còn thiếu' : '')
  )
  getVideoEvents.emit('update')
  return { downloaded, skipped, failed }
}
