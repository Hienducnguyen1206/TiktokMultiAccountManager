import { spawn } from 'child_process'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import { EventEmitter } from 'events'
import { ensureFfmpeg, ensureYtDlp } from './YtDlpManager'
import { GetVideoStore } from './GetVideoStore'
import { ProfileStore } from './ProfileStore'
import { isRunning, proxyUrl, shardProfilesDir } from './ShardEngine'
import type { GvCrawlResult, GvSettings } from '@shared/types'

export const getVideoEvents = new EventEmitter()

function log(msg: string): void {
  getVideoEvents.emit('log', redact(msg))
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

/** Chuẩn hóa input người dùng (URL / @handle) thành URL gốc của channel, bỏ tab cuối. */
function toChannelUrl(input: string): string {
  let s = input.trim()
  if (s.startsWith('@')) s = `https://www.youtube.com/${s}`
  else if (!/^https?:\/\//i.test(s)) s = `https://www.youtube.com/${s}`
  s = s.replace(/\/(videos|shorts|streams|featured)\/?$/i, '')
  return s.replace(/\/$/, '')
}

/** Chuẩn hóa input người dùng (URL / @handle) thành URL tab Shorts của channel. */
function toShortsUrl(input: string): string {
  return toChannelUrl(input) + '/shorts'
}

/**
 * Lấy tên + avatar của channel qua yt-dlp (1 request metadata, không tải gì).
 * Avatar nằm trong thumbnails với id 'avatar_uncropped'; bản dự phòng là thumbnail
 * vuông (banner thì luôn chữ nhật) — đã kiểm bằng dữ liệu thật của yt-dlp.
 */
async function fetchChannelMeta(url: string): Promise<{ name: string; avatar: string } | null> {
  const exe = await ensureYtDlp()
  const s = GetVideoStore.getSettings()
  const r = await runWithCookies(
    exe,
    [toChannelUrl(url), '-J', '--flat-playlist', '--playlist-end', '1', '--no-warnings'],
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
  const meta = await fetchChannelMeta(c.url)
  if (!meta || (!meta.name && !meta.avatar)) return false
  GetVideoStore.setMeta(channelId, meta.name, meta.avatar)
  getVideoEvents.emit('update')
  return true
}

/** Bổ sung avatar cho mọi channel còn thiếu — chạy tuần tự để không dội request YouTube. */
let metaSyncing = false
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

function watchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`
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
  mkdirSync(s.pendingDir, { recursive: true })
  resetCookieState() // mỗi lượt crawl thử lại cookie đúng một lần
  // Giải MỘT lần cho cả lượt: cookieSource() có thể ghi log giải thích vì sao
  // không dùng được cookie, gọi lại ở từng video sẽ in đúng câu đó 100 lần.
  const cookies = cookieSource(s)
  if (cookies.label) log(`🍪 Dùng cookie từ ${cookies.label}`)

  const exe = await ensureYtDlp()
  const ffmpegDir = await ensureFfmpeg()
  const shortsUrl = toShortsUrl(channel.url)
  // 'count' → giới hạn N bài gần nhất; 'hours' → quét 50 bài gần nhất rồi lọc theo giờ;
  // 'all' → không giới hạn (liệt kê toàn bộ), chỉ loại video đã tải ở dưới.
  const limit = s.backfillMode === 'count' ? Math.max(1, s.backfillCount) : s.backfillMode === 'hours' ? 50 : null

  log(`[${channel.name || channel.url}] Liệt kê Shorts…`)
  const list = await runWithCookies(
    exe,
    [
      '--flat-playlist',
      '--no-warnings',
      '--print',
      '%(id)s\t%(channel)s',
      ...(limit !== null ? ['--playlist-end', String(limit)] : []),
      shortsUrl
    ],
    cookies
  )
  if (list.code !== 0) {
    log(`[${channel.url}] Lỗi liệt kê: ${list.out.split('\n').slice(-3).join(' ')}`)
    // Nói đúng nguyên nhân. Bản trước lúc nào cũng đổ cho URL sai, kể cả khi thật
    // ra là YouTube chặn bot hay cookie hỏng — người dùng đi sửa nhầm chỗ.
    const why = cookieProblem(list.out)
    if (why) throw new Error(`Không liệt kê được: ${why}`)
    // Lời khuyên cũ ("chọn Firefox") nay sai chỗ: gốc rễ là đang tải với tư cách
    // KHÁCH, mà trần của khách chỉ ~300 video/giờ so với ~2000 khi có tài khoản.
    if (isBotBlock(list.out) || /429|Too Many Requests/i.test(list.out))
      throw new Error(
        'YouTube đang chặn bot vì tải quá nhiều với tư cách khách. Nghỉ vài giờ, hoặc vào Setting chọn profile lấy cookie để tải bằng tài khoản.'
      )
    throw new Error('yt-dlp không liệt kê được channel (URL sai?)')
  }

  const rows = list.out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [id, ch] = l.split('\t')
      return { id, ch }
    })
    .filter((r) => r.id && r.id !== 'NA')

  // cập nhật tên channel nếu lần đầu
  if (!channel.name && rows[0]?.ch && rows[0].ch !== 'NA') {
    GetVideoStore.setName(channelId, rows[0].ch)
  }

  // lọc cái chưa tải
  const todo = rows.filter((r) => !GetVideoStore.isDownloaded(r.id))
  log(`[${channel.name || channel.url}] ${rows.length} video, ${todo.length} chưa tải`)

  // match-filter: thời lượng + (cửa sổ giờ nếu mode hours)
  const filterParts = [`duration<=${s.maxDuration}`]
  if (s.backfillMode === 'hours') {
    const after = Math.floor(Date.now() / 1000) - s.backfillHours * 3600
    filterParts.push(`timestamp>=${after}`)
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
        watchUrl(id)
      ],
      cookies
    )
    const out = r.out
    if (r.code === 0 && (/Destination:|has already been downloaded|Merging/i.test(out))) {
      // lấy title từ DB sau; ở đây chỉ cần đánh dấu
      GetVideoStore.markDownloaded(id, channelId, '')
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
