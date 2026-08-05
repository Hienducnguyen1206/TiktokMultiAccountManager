import { spawn } from 'child_process'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import { EventEmitter } from 'events'
import { ensureFfmpeg, ensureYtDlp } from './YtDlpManager'
import { GetVideoStore } from './GetVideoStore'
import type { GvCrawlResult, GvSettings } from '@shared/types'

export const getVideoEvents = new EventEmitter()

function log(msg: string): void {
  getVideoEvents.emit('log', msg)
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

/** Trình duyệt nào đã xác định không đọc được cookie trong lượt chạy này. */
const cookieBroken = new Map<string, string>()

/** Quên kết luận cũ để lượt chạy mới thử lại — người dùng có thể vừa đóng trình
 *  duyệt hoặc đổi sang trình duyệt khác. */
function resetCookieState(): void {
  cookieBroken.clear()
}

/**
 * Chạy yt-dlp có kèm cookie; nếu hỏng ĐÚNG vì khâu cookie thì nói rõ lý do, ghi
 * nhớ, rồi chạy lại KHÔNG cookie.
 *
 * Cookie chỉ cần khi YouTube giở bài kiểm tra bot. Bỏ cuộc hoàn toàn chỉ vì
 * không đọc nổi cookie là hỏng một việc vốn vẫn làm được — đo thật: tải cùng
 * video đó không kèm cookie thì chạy ngon, exit 0.
 */
async function runWithCookies(exe: string, base: string[], browser: string): Promise<RunResult> {
  const use = !!browser && !cookieBroken.has(browser)
  const r = await runYtDlp(exe, use ? ['--cookies-from-browser', browser, ...base] : base)
  if (r.code === 0 || !use) return r
  const why = cookieProblem(r.out)
  if (!why) return r
  // Nhớ lại để CẢ LƯỢT CHẠY này thôi thử nữa. Đo thật: mỗi lần thử hỏng tốn 3,3
  // giây, mà cookie hỏng thì hỏng ở mọi lệnh — kênh 98 video sẽ vứt đi hơn 5
  // phút và in 98 dòng cảnh báo y hệt nhau.
  cookieBroken.set(browser, why)
  log(`⚠ Bỏ qua cookie (${browser}) cho cả lượt này: ${why}`)
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
    s.cookieBrowser
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
    s.cookieBrowser
  )
  if (list.code !== 0) {
    log(`[${channel.url}] Lỗi liệt kê: ${list.out.split('\n').slice(-3).join(' ')}`)
    // Nói đúng nguyên nhân. Bản trước lúc nào cũng đổ cho URL sai, kể cả khi thật
    // ra là YouTube chặn bot hay cookie hỏng — người dùng đi sửa nhầm chỗ.
    const why = cookieProblem(list.out)
    if (why) throw new Error(`Không liệt kê được: ${why}`)
    if (/Sign in to confirm|not a bot|429|Too Many Requests/i.test(list.out))
      throw new Error('YouTube đang chặn bot. Chọn cookie trình duyệt Firefox trong Setting, hoặc thử lại sau.')
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

  const downloadOne = async (id: string): Promise<void> => {
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
        '--no-warnings',
        // Đã bỏ --sleep-requests/--sleep-interval/--max-sleep-interval theo yêu
        // cầu: giãn nhịp là khuyến nghị chống bot của yt-dlp, nhưng nút thắt
        // thật là tốc độ tải chứ không phải hạn mức YouTube (~2000 video/giờ khi
        // có tài khoản) — có giãn hay không cũng không chạm tới ngưỡng đó.
        // Giữ --limit-rate để không chiếm sạch băng thông mạng.
        '--limit-rate', '5M',
        ...titleClean,
        '--match-filter',
        matchFilter,
        '-o',
        outTemplate,
        watchUrl(id)
      ],
      s.cookieBrowser
    )
    const out = r.out
    if (r.code === 0 && (/Destination:|has already been downloaded|Merging/i.test(out))) {
      // lấy title từ DB sau; ở đây chỉ cần đánh dấu
      GetVideoStore.markDownloaded(id, channelId, '')
      downloaded++
      log(`  ✓ tải ${id}`)
    } else if (/does not pass filter|Skipping/i.test(out)) {
      skipped++
    } else if (r.code !== 0) {
      failed++
      log(`  ✗ lỗi ${id}: ${out.split('\n').filter(Boolean).slice(-1)[0] ?? ''}`)
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
          const id = queue.shift()
          if (!id) break
          await downloadOne(id)
        }
      })()
    )
  }
  await Promise.all(workers)

  GetVideoStore.markCrawled(channelId, downloaded)
  log(`[${channel.name || channel.url}] Xong: ${downloaded} tải, ${skipped} bỏ qua, ${failed} lỗi`)
  getVideoEvents.emit('update')
  return { downloaded, skipped, failed }
}
