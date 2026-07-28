import { app } from 'electron'
import { spawn } from 'child_process'
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { Readable } from 'stream'
import { EventEmitter } from 'events'

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

/** Đảm bảo yt-dlp.exe có sẵn; tải lần đầu khi dùng. */
export function ensureYtDlp(): Promise<string> {
  if (cachedPath && existsSync(cachedPath)) return Promise.resolve(cachedPath)
  if (!ytdlpPromise) {
    ytdlpPromise = doEnsureYtDlp().finally(() => {
      ytdlpPromise = null
    })
  }
  return ytdlpPromise
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
