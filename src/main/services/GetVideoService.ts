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

/** Chuẩn hóa input người dùng (URL / @handle) thành URL tab Shorts của channel. */
function toShortsUrl(input: string): string {
  let s = input.trim()
  if (s.startsWith('@')) s = `https://www.youtube.com/${s}`
  else if (!/^https?:\/\//i.test(s)) s = `https://www.youtube.com/${s}`
  // bỏ tab cuối nếu có rồi gắn /shorts
  s = s.replace(/\/(videos|shorts|streams|featured)\/?$/i, '')
  return s.replace(/\/$/, '') + '/shorts'
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

  const exe = await ensureYtDlp()
  const ffmpegDir = await ensureFfmpeg()
  const shortsUrl = toShortsUrl(channel.url)
  // Cookie trình duyệt → qua bot check "Sign in to confirm you're not a bot".
  // LƯU Ý: trình duyệt đó nên ĐÓNG khi crawl (Chrome khóa file cookie khi mở).
  const cookieArgs = s.cookieBrowser ? ['--cookies-from-browser', s.cookieBrowser] : []
  // 'count' → giới hạn N bài gần nhất; 'hours' → quét 50 bài gần nhất rồi lọc theo giờ;
  // 'all' → không giới hạn (liệt kê toàn bộ), chỉ loại video đã tải ở dưới.
  const limit = s.backfillMode === 'count' ? Math.max(1, s.backfillCount) : s.backfillMode === 'hours' ? 50 : null

  log(`[${channel.name || channel.url}] Liệt kê Shorts…`)
  const list = await runYtDlp(exe, [
    '--flat-playlist',
    '--no-warnings',
    '--sleep-requests', '1', // giãn request → giảm nguy cơ bị YouTube chặn bot (429)
    ...cookieArgs,
    '--print',
    '%(id)s\t%(channel)s',
    ...(limit !== null ? ['--playlist-end', String(limit)] : []),
    shortsUrl
  ])
  if (list.code !== 0) {
    log(`[${channel.url}] Lỗi liệt kê: ${list.out.split('\n').slice(-3).join(' ')}`)
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
    const r = await runYtDlp(exe, [
      '-f',
      'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best',
      '--merge-output-format',
      'mp4',
      '--ffmpeg-location',
      ffmpegDir,
      '--no-playlist',
      '--no-warnings',
      // Chống bị YouTube chặn bot: giãn request, nghỉ ngẫu nhiên giữa các video,
      // và giới hạn tốc độ để không "hammer" máy chủ.
      '--sleep-requests', '1',
      '--sleep-interval', '2',
      '--max-sleep-interval', '5',
      '--limit-rate', '5M',
      ...cookieArgs,
      ...titleClean,
      '--match-filter',
      matchFilter,
      '-o',
      outTemplate,
      watchUrl(id)
    ])
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
