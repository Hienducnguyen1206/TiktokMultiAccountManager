import { app } from 'electron'
import { spawn } from 'child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, rmSync } from 'fs'
import { join } from 'path'
import { Readable } from 'stream'
import { EventEmitter } from 'events'

export const engineEvents = new EventEmitter()

// Pinned fingerprint-chromium build (Ungoogled Chromium, patched at C++ level).
const ENGINE_VERSION = '144.0.7559.132'
const ENGINE_URL =
  `https://github.com/adryfish/fingerprint-chromium/releases/download/${ENGINE_VERSION}` +
  `/ungoogled-chromium_${ENGINE_VERSION}-1.1_windows_x64.zip`

let cachedPath: string | null = null

export function engineDir(): string {
  const dir = join(app.getPath('userData'), 'engine')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Recursively find chrome.exe under the engine directory. */
function findChromeExe(dir: string): string | null {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return null
  }
  for (const name of entries) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      const found = findChromeExe(full)
      if (found) return found
    } else if (name.toLowerCase() === 'chrome.exe') {
      return full
    }
  }
  return null
}

export function findEngine(): string | null {
  if (cachedPath && existsSync(cachedPath)) return cachedPath
  cachedPath = findChromeExe(engineDir())
  return cachedPath
}

async function downloadZip(dest: string): Promise<void> {
  engineEvents.emit('progress', { phase: 'download', pct: 0 })
  const res = await fetch(ENGINE_URL)
  if (!res.ok || !res.body) throw new Error(`Tải engine thất bại (HTTP ${res.status})`)
  const total = Number(res.headers.get('content-length') || 0)
  let received = 0
  const out = createWriteStream(dest)
  const reader = (Readable.fromWeb(res.body as any))
  reader.on('data', (chunk: Buffer) => {
    received += chunk.length
    if (total) engineEvents.emit('progress', { phase: 'download', pct: Math.round((received / total) * 100) })
  })
  await new Promise<void>((resolve, reject) => {
    reader.pipe(out)
    out.on('finish', resolve)
    out.on('error', reject)
    reader.on('error', reject)
  })
}

function extractZip(zipPath: string, destDir: string): Promise<void> {
  engineEvents.emit('progress', { phase: 'extract', pct: 0 })
  return new Promise<void>((resolve, reject) => {
    // Use Windows PowerShell Expand-Archive (no extra dependency).
    const ps = spawn('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${destDir}" -Force`
    ])
    ps.on('error', reject)
    ps.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('Giải nén engine thất bại'))))
  })
}

/** Ensure the engine exists locally; download + extract on first use. */
export async function ensureEngine(): Promise<string> {
  const existing = findEngine()
  if (existing) return existing

  const dir = engineDir()
  const zipPath = join(dir, '_download.zip')
  await downloadZip(zipPath)
  await extractZip(zipPath, dir)
  try {
    rmSync(zipPath, { force: true })
  } catch {
    // ignore
  }
  const found = findChromeExe(dir)
  if (!found) throw new Error('Không tìm thấy chrome.exe sau khi giải nén engine')
  cachedPath = found
  engineEvents.emit('progress', { phase: 'done', pct: 100 })
  return found
}
