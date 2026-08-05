import { app } from 'electron'
import { spawn } from 'child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { Readable } from 'stream'
import { EventEmitter } from 'events'
import { ensureDeno } from './DenoManager'

export const ytdlpEvents = new EventEmitter()

// yt-dlp phát hành 1 file exe duy nhất (không cần giải nén).
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
// ffmpeg build chính thức cho yt-dlp — cần để merge video+audio chất lượng cao (1080p+).
const FFMPEG_URL =
  'https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip'

let cachedPath: string | null = null
let cachedFfmpegDir: string | null = null

function binDir(): string {
  const dir = join(app.getPath('userData'), 'ytdlp')
  mkdirSync(dir, { recursive: true })
  return dir
}

async function download(url: string, dest: string): Promise<void> {
  ytdlpEvents.emit('progress', { phase: 'download', pct: 0 })
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`Tải ${url.split('/').pop()} thất bại (HTTP ${res.status})`)
  const total = Number(res.headers.get('content-length') || 0)
  let received = 0
  const out = createWriteStream(dest)
  const reader = Readable.fromWeb(res.body as any)
  reader.on('data', (chunk: Buffer) => {
    received += chunk.length
    if (total) ytdlpEvents.emit('progress', { phase: 'download', pct: Math.round((received / total) * 100) })
  })
  await new Promise<void>((resolve, reject) => {
    reader.pipe(out)
    out.on('finish', resolve)
    out.on('error', reject)
    reader.on('error', reject)
  })
}

let ytdlpPromise: Promise<string> | null = null

/**
 * Đảm bảo yt-dlp.exe có sẵn; tải lần đầu khi dùng.
 *
 * Kèm luôn Deno: từ bản 2025.11.12 yt-dlp cần một JS runtime ngoài mới chạy
 * đủ YouTube. Đặt ở đây vì mọi lệnh yt-dlp trong app đều đi qua hàm này, nên
 * không thể quên ở một nhánh nào. `ensureDeno()` tự nuốt lỗi và nhớ kết quả,
 * nên gọi lại là gần như miễn phí và không bao giờ chặn lượt tải.
 */
export async function ensureYtDlp(): Promise<string> {
  await ensureDeno()
  if (cachedPath && existsSync(cachedPath)) return cachedPath
  if (!ytdlpPromise) {
    ytdlpPromise = doEnsureYtDlp().finally(() => {
      ytdlpPromise = null
    })
  }
  return ytdlpPromise
}

/** Chạy yt-dlp và gom stdout + stderr. */
function run(exe: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { windowsHide: true })
    let out = ''
    child.stdout.on('data', (d) => (out += d.toString()))
    child.stderr.on('data', (d) => (out += d.toString()))
    child.on('error', () => resolve({ code: -1, out }))
    child.on('exit', (code) => resolve({ code: code ?? -1, out }))
  })
}

async function versionOf(exe: string): Promise<string> {
  const r = await run(exe, ['--version'])
  return (r.out.trim().split('\n')[0] ?? '').trim()
}

function stampFile(): string {
  return join(binDir(), '.last-update-check')
}

/**
 * Nâng cấp yt-dlp bằng cơ chế tự cập nhật của chính nó (`-U`).
 *
 * Dùng `-U` thay vì tải đè file: yt-dlp tự lo tải, kiểm tra và thay thế đúng
 * cách, kể cả khi bản mới đổi cách đóng gói.
 */
export async function updateYtDlp(): Promise<{ ok: boolean; from: string; to: string; message: string }> {
  const exe = await ensureYtDlp()
  const from = await versionOf(exe)
  const r = await run(exe, ['-U'])
  const to = await versionOf(exe)
  try {
    writeFileSync(stampFile(), String(Date.now()))
  } catch {
    /* không ghi được mốc thì lần sau kiểm lại sớm — không sao */
  }
  if (from && to && to !== from) return { ok: true, from, to, message: `Đã cập nhật ${from} → ${to}` }
  if (/is up to date/i.test(r.out)) return { ok: true, from, to, message: `Đang dùng bản mới nhất (${to})` }
  return { ok: r.code === 0, from, to, message: r.out.trim().split('\n').slice(-1)[0] || 'Không rõ kết quả' }
}

/**
 * Tự kiểm tra bản mới, nhiều nhất 7 ngày một lần.
 *
 * Trước đây `doEnsureYtDlp` chỉ có một nhánh: có file thì dùng luôn, không bao
 * giờ ngó tới bản mới. Đo thật: máy đang chạy 2026.03.17 trong khi bản mới nhất
 * là 2026.07.04 — cách nhau gần 4 tháng. YouTube đổi cách phát video liên tục và
 * yt-dlp vá theo trong vài ngày, nên bản cũ hỏng theo kiểu TRÔNG HỆT NHƯ BỊ
 * CHẶN: cùng thông báo, cùng triệu chứng, mà thật ra chỉ là extractor lỗi thời.
 */
const UPDATE_CHECK_MS = 7 * 24 * 3600 * 1000

export async function autoUpdateYtDlp(): Promise<void> {
  try {
    const stamp = stampFile()
    if (existsSync(stamp)) {
      const last = Number(readFileSync(stamp, 'utf8').trim())
      if (Number.isFinite(last) && Date.now() - last < UPDATE_CHECK_MS) return
    }
    const r = await updateYtDlp()
    ytdlpEvents.emit('log', `[yt-dlp] ${r.message}`)
  } catch {
    /* không cập nhật được thì vẫn chạy bản đang có — không chặn khởi động */
  }
}

async function doEnsureYtDlp(): Promise<string> {
  const exe = join(binDir(), 'yt-dlp.exe')
  if (existsSync(exe)) {
    cachedPath = exe
    return exe
  }
  await download(YTDLP_URL, exe)
  if (!existsSync(exe)) throw new Error('Không tìm thấy yt-dlp.exe sau khi tải')
  cachedPath = exe
  ytdlpEvents.emit('progress', { phase: 'done', pct: 100 })
  return exe
}

function extractFfmpeg(zipPath: string, destDir: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const tmp = join(destDir, '_ffmpeg_tmp')
    // Giải nén rồi chỉ giữ lại ffmpeg.exe + ffprobe.exe. Mọi lỗi phải làm lệnh
    // thoát khác 0 (mặc định lỗi non-terminating vẫn cho exit 0 → nuốt lỗi).
    const cmd =
      `$ErrorActionPreference='Stop'; ` +
      `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${tmp}" -Force; ` +
      `Get-ChildItem -Path "${tmp}" -Recurse -Include ffmpeg.exe,ffprobe.exe | Move-Item -Destination "${destDir}" -Force; ` +
      `Remove-Item -Recurse -Force "${tmp}"`
    const ps = spawn('powershell.exe', ['-NoProfile', '-Command', cmd], { windowsHide: true })
    let err = ''
    ps.stderr.on('data', (d) => (err += d.toString()))
    ps.on('error', reject)
    ps.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Giải nén ffmpeg thất bại: ${err.split('\n').filter(Boolean)[0] ?? `exit ${code}`}`))
    )
  })
}

let ffmpegPromise: Promise<string> | null = null

/** Đảm bảo ffmpeg.exe có sẵn; trả về thư mục chứa nó (cho --ffmpeg-location). */
export function ensureFfmpeg(): Promise<string> {
  if (cachedFfmpegDir && existsSync(join(cachedFfmpegDir, 'ffmpeg.exe'))) {
    return Promise.resolve(cachedFfmpegDir)
  }
  // single-flight: nhiều crawl song song dùng chung 1 lần tải, tránh 2 stream
  // cùng ghi 1 file zip làm hỏng archive
  if (!ffmpegPromise) {
    ffmpegPromise = doEnsureFfmpeg().finally(() => {
      ffmpegPromise = null
    })
  }
  return ffmpegPromise
}

async function doEnsureFfmpeg(): Promise<string> {
  const dir = binDir()
  const exe = join(dir, 'ffmpeg.exe')
  if (existsSync(exe)) {
    cachedFfmpegDir = dir
    return dir
  }
  const zip = join(dir, '_ffmpeg.zip')
  await download(FFMPEG_URL, zip)
  await extractFfmpeg(zip, dir)
  if (!existsSync(exe)) throw new Error('Không tìm thấy ffmpeg.exe sau khi giải nén')
  // chỉ xoá zip sau khi chắc chắn đã có ffmpeg.exe
  rmSync(zip, { force: true })
  cachedFfmpegDir = dir
  ytdlpEvents.emit('progress', { phase: 'done', pct: 100 })
  return dir
}
