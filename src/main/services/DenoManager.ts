import { app } from 'electron'
import { spawn } from 'child_process'
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'fs'
import { delimiter, join } from 'path'
import { Readable } from 'stream'
import type { DenoInfo } from '@shared/types'

/**
 * Đảm bảo có một JS runtime cho yt-dlp — cụ thể là Deno.
 *
 * Từ bản 2025.11.12 yt-dlp BẮT BUỘC cần một JS runtime bên ngoài để giải
 * n-param/signature của YouTube; thiếu nó thì yt-dlp tự bỏ client `web`, số
 * format tụt hẳn và (theo chính thông báo của nhóm yt-dlp) sẽ tệ dần tới lúc
 * không tải nổi. Trong 5 runtime được hỗ trợ chỉ Deno bật sẵn, còn lại
 * (node/bun/quickjs) mặc định TẮT vì lý do an toàn — nên cài Node cũng vô ích.
 *
 * Vì sao phải tự lo thay vì trông vào máy người dùng: yt-dlp tìm runtime qua
 * PATH. Máy đang phát triển có sẵn Deno 2.9.1 cài bằng WinGet nên mọi thứ chạy
 * ngon và KHÔNG lộ ra vấn đề gì; bê app sang máy trắng là hỏng ngầm — vẫn tải
 * được, chỉ kém dần, và triệu chứng trông y hệt bị YouTube chặn.
 *
 * Có sẵn Deno hệ thống (>= 2.0.0) thì dùng luôn, không tải lại 40 MB.
 */

const DENO_URL = 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip'

/** yt-dlp yêu cầu Deno >= 2.0.0; bản 1.x không dùng được. */
const MIN_MAJOR = 2

function binDir(): string {
  const dir = join(app.getPath('userData'), 'deno')
  mkdirSync(dir, { recursive: true })
  return dir
}

function bundledExe(): string {
  return join(binDir(), 'deno.exe')
}

/** Chạy `<exe> --version`, trả về số phiên bản ('' nếu không chạy được). */
function probe(exe: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(exe, ['--version'], { windowsHide: true })
    let out = ''
    child.stdout.on('data', (d) => (out += d.toString()))
    child.on('error', () => resolve(''))
    child.on('exit', () => {
      // Dòng đầu có dạng: "deno 2.9.1 (stable, release, x86_64-pc-windows-msvc)"
      resolve(/deno\s+(\d+\.\d+\.\d+)/i.exec(out)?.[1] ?? '')
    })
  })
}

function tooOld(version: string): boolean {
  return Number(version.split('.')[0] ?? 0) < MIN_MAJOR
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`Tải Deno thất bại (HTTP ${res.status})`)
  const out = createWriteStream(dest)
  const reader = Readable.fromWeb(res.body as any)
  await new Promise<void>((resolve, reject) => {
    reader.pipe(out)
    out.on('finish', resolve)
    out.on('error', reject)
    reader.on('error', reject)
  })
}

/** Zip của Deno chỉ có đúng deno.exe ở gốc → giải thẳng vào thư mục đích. */
function extract(zipPath: string, destDir: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // Mọi lỗi phải làm lệnh thoát khác 0 — mặc định lỗi non-terminating của
    // PowerShell vẫn cho exit 0 và nuốt mất lỗi.
    const cmd =
      `$ErrorActionPreference='Stop'; ` +
      `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${destDir}" -Force`
    const ps = spawn('powershell.exe', ['-NoProfile', '-Command', cmd], { windowsHide: true })
    let err = ''
    ps.stderr.on('data', (d) => (err += d.toString()))
    ps.on('error', reject)
    ps.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Giải nén Deno thất bại: ${err.split('\n').filter(Boolean)[0] ?? `exit ${code}`}`))
    )
  })
}

/**
 * Cho thư mục chứa deno.exe của app lên đầu PATH của tiến trình main.
 *
 * Sửa PATH một lần ở đây thay vì truyền `env` riêng ở từng chỗ spawn: yt-dlp
 * được gọi từ cả GetVideoService lẫn ChannelSearchService, mà tiến trình con
 * thừa kế `process.env` — nên vá một chỗ là mọi lệnh yt-dlp đều thấy Deno.
 * Đứng ĐẦU PATH để bản của app thắng bản hệ thống nếu bản hệ thống quá cũ.
 */
function addToPath(dir: string): void {
  const cur = process.env.PATH ?? ''
  if (cur.split(delimiter).some((p) => p.toLowerCase() === dir.toLowerCase())) return
  process.env.PATH = dir + delimiter + cur
}

/** Trạng thái hiện tại, KHÔNG tải gì — để tab Setting hiển thị. */
export async function denoInfo(): Promise<DenoInfo> {
  const mine = bundledExe()
  if (existsSync(mine)) {
    const v = await probe(mine)
    if (v && !tooOld(v)) {
      addToPath(binDir())
      return { ok: true, source: 'bundled', version: v, dir: binDir(), note: 'Bản do app tải về' }
    }
  }
  const sys = await probe('deno')
  if (sys && !tooOld(sys)) {
    return { ok: true, source: 'system', version: sys, dir: '', note: 'Đang dùng Deno cài sẵn trên máy' }
  }
  return {
    ok: false,
    source: 'none',
    version: sys,
    dir: '',
    note: sys
      ? `Deno ${sys} quá cũ — yt-dlp cần từ ${MIN_MAJOR}.0.0 trở lên.`
      : 'Chưa có Deno — YouTube sẽ thiếu format và hỏng dần.'
  }
}

let resolved = false
let cachedDir: string | null = null
let pending: Promise<string | null> | null = null

/**
 * Đảm bảo có Deno dùng được, tải về nếu chưa có.
 *
 * KHÔNG BAO GIỜ ném lỗi: thiếu Deno thì yt-dlp vẫn tải được (kém hơn), nên
 * hỏng khâu này không được phép chặn cả lượt tải.
 * Trả về thư mục đã thêm vào PATH, hoặc null nếu dùng bản hệ thống / không có.
 */
export function ensureDeno(): Promise<string | null> {
  if (resolved) return Promise.resolve(cachedDir)
  // single-flight: nhiều lượt crawl song song đều gọi ensureYtDlp() → nếu không
  // gom lại thì hai stream cùng ghi một file zip và phá hỏng archive.
  if (!pending) {
    pending = doEnsure()
      .catch(() => null)
      .then((dir) => {
        resolved = true
        cachedDir = dir
        return dir
      })
      .finally(() => {
        pending = null
      })
  }
  return pending
}

async function doEnsure(): Promise<string | null> {
  const info = await denoInfo()
  if (info.ok) return info.source === 'bundled' ? info.dir : null

  const dir = binDir()
  const zip = join(dir, '_deno.zip')
  await download(DENO_URL, zip)
  await extract(zip, dir)
  if (!existsSync(bundledExe())) throw new Error('Không tìm thấy deno.exe sau khi giải nén')
  // chỉ xoá zip sau khi chắc chắn đã có deno.exe
  rmSync(zip, { force: true })
  addToPath(dir)
  return dir
}

/** Cài/cài lại ngay theo yêu cầu của người dùng (nút trong tab Setting). */
export async function installDeno(): Promise<DenoInfo> {
  resolved = false
  cachedDir = null
  await ensureDeno()
  return denoInfo()
}
