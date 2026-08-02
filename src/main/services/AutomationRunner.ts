import { existsSync, readFileSync } from 'fs'
import { mkdir, readdir, rename, copyFile, unlink, stat } from 'fs/promises'
import { join, basename, extname } from 'path'
import type { Browser, Page } from 'puppeteer-core'
import { openAutomation, closeSession } from './ShardEngine'
import { ProfileStore } from './ProfileStore'
import { cleanProfileCache } from './cacheCleaner'
import { trackProc } from './EngineProcs'
import type { Profile, Template, UploadVideoConfig, HashtagItem } from '@shared/types'

export const VIDEO_EXT = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'])

// Shared Pending pool: paths claimed by a running job so other concurrent jobs
// don't pick the same file. Single-process, so an in-memory set is enough.
const claimed = new Set<string>()

interface VideoFile {
  path: string
  name: string
}

export interface RunHandle {
  cancel: () => void
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function moveFile(src: string, destDir: string): Promise<void> {
  // File có thể đã bị job khác chuyển đi (pool Pending chung) → bỏ qua, không ném lỗi.
  if (!existsSync(src)) return
  await mkdir(destDir, { recursive: true })
  const dest = join(destDir, basename(src))
  try {
    await rename(src, dest)
  } catch {
    try {
      await copyFile(src, dest)
      await unlink(src)
    } catch {
      /* nguồn đã mất giữa chừng — bỏ qua */
    }
  }
}

async function pickVideo(cfg: UploadVideoConfig): Promise<VideoFile | null> {
  if (!cfg.pendingDir || !existsSync(cfg.pendingDir)) return null
  const names = await readdir(cfg.pendingDir)
  const files: { path: string; name: string; mtime: number }[] = []
  for (const n of names) {
    if (!VIDEO_EXT.has(extname(n).toLowerCase())) continue
    const path = join(cfg.pendingDir, n)
    if (claimed.has(path)) continue
    try {
      const st = await stat(path)
      if (st.isFile()) files.push({ path, name: n, mtime: st.mtimeMs })
    } catch {
      // skip
    }
  }
  if (files.length === 0) return null
  switch (cfg.videoOrder) {
    case 'newest':
      files.sort((a, b) => b.mtime - a.mtime)
      break
    case 'name':
      files.sort((a, b) => a.name.localeCompare(b.name))
      break
    case 'random':
      files.sort(() => Math.random() - 0.5)
      break
    default:
      files.sort((a, b) => a.mtime - b.mtime) // oldest
  }
  // Chọn + claim NGUYÊN TỬ (không await ở giữa) để 2 job chạy song song không
  // giành trúng cùng 1 video từ pool Pending chung.
  for (const f of files) {
    if (!claimed.has(f.path)) {
      claimed.add(f.path)
      return { path: f.path, name: f.name }
    }
  }
  return null
}

function buildCaption(cfg: UploadVideoConfig, v: VideoFile): string {
  // Làm sạch tên file → caption: bỏ [mã video], #hashtag, ký tự đặc biệt/emoji.
  const base = basename(v.name, extname(v.name))
    .replace(/\[[^\]]*\]/g, ' ') // bỏ [SWmgipq3pjQ]
    .replace(/#\S+/g, ' ') // bỏ #hashtag
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // bỏ ký tự đặc biệt/emoji (giữ chữ/số Unicode + space)
    .replace(/\s+/g, ' ')
    .trim()
  let caption = ''
  if (cfg.captionMode === 'filename') caption = base
  else if (cfg.captionMode === 'custom') caption = (cfg.captionCustom || '').replace(/\{filename\}/g, base)
  // random N hashtags from pool
  if (cfg.hashtagCount > 0 && cfg.hashtags.length > 0) {
    const pool = [...cfg.hashtags]
    pool.sort(() => Math.random() - 0.5)
    const tags = pool.slice(0, Math.min(cfg.hashtagCount, pool.length)).map((h: HashtagItem) => h.tag)
    caption = (caption + ' ' + tags.join(' ')).trim()
  }
  return caption
}

/**
 * Wait for the open browser's DevTools endpoint. Chrome writes two lines to
 * DevToolsActivePort: the port, then the browser ws path (/devtools/browser/<id>).
 * We build the ws endpoint directly to avoid the /json/version fetch.
 */
export async function waitForWsEndpoint(userDataDir: string, timeoutMs = 30000): Promise<string> {
  const file = join(userDataDir, 'DevToolsActivePort')
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (existsSync(file)) {
      // File có thể đang bị Chromium ghi/khóa (EBUSY) lúc vừa khởi động →
      // bỏ qua, chờ vòng sau thay vì ném lỗi ra ngoài.
      try {
        const lines = readFileSync(file, 'utf8').split('\n')
        const port = Number(lines[0]?.trim())
        const wsPath = lines[1]?.trim()
        if (port && wsPath) return `ws://127.0.0.1:${port}${wsPath}`
      } catch {
        /* file đang khóa/ghi dở — thử lại lượt sau */
      }
    }
    await sleep(300)
  }
  throw new Error('Không kết nối được DevTools (timeout)')
}

/**
 * Run one job: launch the profile in fingerprint-chromium with a debugging port,
 * connect Puppeteer, and execute the template script with a provided context.
 */
export function runJob(
  profile: Profile,
  template: Template,
  log: (line: string) => void,
  onProgress: (pct: number) => void
): { promise: Promise<void>; handle: RunHandle } {
  let browser: Browser | null = null
  let session: any = null
  let cancelled = false
  const myClaims = new Set<string>() // video job này đang giữ → nhả hết khi kết thúc

  const promise = (async () => {
    log('Khởi động trình duyệt…')
    const { browser: b, session: s } = await openAutomation(profile)
    browser = b
    session = s
    trackProc(session.process)
    ProfileStore.markLastUsed(profile.id) // upload job cũng tính vào "lần cuối"

    const pages = await browser.pages()
    const page: Page = pages[0] ?? (await browser.newPage())

    // TikTok đặt beforeunload khi có thay đổi chưa lưu (video đang/đã tải lên).
    // Khi script goto() sang video kế, Chrome bật hộp thoại "Rời khỏi trang?
    // Thay đổi hiện tại sẽ mất" và CHẶN điều hướng → vòng lặp treo. Tự động
    // chấp nhận mọi hộp thoại (beforeunload/alert/confirm) để điều hướng trôi.
    page.on('dialog', async (dialog) => {
      try {
        await dialog.accept()
      } catch {
        /* hộp thoại đã được xử lý */
      }
    })

    const cfg = template.config as UploadVideoConfig
    const ctx: Record<string, unknown> = {
      page,
      profile,
      config: cfg,
      log,
      sleep,
      nextVideo: async () => {
        const v = await pickVideo(cfg)
        if (v) myClaims.add(v.path)
        return v
      },
      buildCaption: (v: VideoFile) => buildCaption(cfg, v),
      markUploaded: async (v: VideoFile) => {
        if (cfg.uploadedDir) await moveFile(v.path, cfg.uploadedDir)
        claimed.delete(v.path)
        myClaims.delete(v.path)
        ProfileStore.addUploadLog(profile.id, v.name, 'done')
        onProgress(100)
      },
      markError: async (v: VideoFile) => {
        if (cfg.errorDir) await moveFile(v.path, cfg.errorDir)
        claimed.delete(v.path)
        myClaims.delete(v.path)
        ProfileStore.addUploadLog(profile.id, v.name, 'error')
      },
      // Lỗi kỹ thuật (mạng/proxy/điều hướng): trả video về Pending, KHÔNG move
      // sang Error — video vẫn tốt, sẽ thử lại lần sau.
      releaseVideo: (v: VideoFile) => {
        claimed.delete(v.path)
        myClaims.delete(v.path)
      },
      // Wait for a TikTok check (copyright/content) to finish, then read result.
      // Language-independent: locates blocks by data-e2e + reads the status-* class
      // (TikTok keeps these class names regardless of UI language).
      // Returns true if a violation/restriction is detected (status-warn).
      waitCheck: async (kind: string) => {
        const timeout = kind === 'copyright' ? 120_000 : 720_000 // content check can take ~10 min
        const label = kind === 'copyright' ? 'bản quyền' : 'nội dung'
        const start = Date.now()
        let sawChecking = false
        while (Date.now() - start < timeout) {
          let res: { state: string; tip: string } = { state: 'none', tip: '' }
          try {
            res = (await page.evaluate((k: string) => {
              let visible: Element | null = null
              if (k === 'content') {
                // Content check: 4 result divs share data-show; the active one is data-show="true".
                visible = document.querySelector('.content-check__divider ~ * .status-result[data-show="true"]')
                  || document.querySelector('.status-result[data-show="true"]')
              } else {
                // Copyright: locate via stable data-e2e; it renders only the active result (no data-show).
                const copyContainer = document.querySelector('[data-e2e="copyright_container"]')
                const wrap = copyContainer?.parentElement?.querySelector('.status-wrapper') ?? null
                visible = wrap?.querySelector('.status-result') ?? null
              }
              if (!visible) return { state: 'none', tip: '' }
              const cls = visible.className
              const tip = (visible.querySelector('.status-tip')?.textContent || visible.textContent || '').trim()
              let state = 'unknown'
              if (/status-checking/.test(cls)) state = 'checking'
              else if (/status-success/.test(cls)) state = 'success'
              else if (/status-warn/.test(cls)) state = 'warn'
              else if (/status-error/.test(cls)) state = 'error'
              else if (/status-ready/.test(cls)) state = 'ready'
              return { state, tip }
            }, kind)) as { state: string; tip: string }
          } catch {
            /* page navigating */
          }
          if (res.state === 'checking') {
            if (!sawChecking) {
              log(`Kiểm tra ${label}: đang kiểm tra…`)
              sawChecking = true
            }
            await sleep(3000)
            continue
          }
          if (res.state === 'none') {
            await sleep(2000)
            continue
          }
          if (res.state === 'ready') {
            // 'ready' = chưa bắt đầu kiểm tra, hoặc hết lượt/không áp dụng.
            if (!sawChecking && Date.now() - start < 60_000) {
              await sleep(3000)
              continue
            }
            log(`Kiểm tra ${label}: bỏ qua`)
            return false
          }
          // terminal: success / warn / error
          if (res.state === 'warn') log(`Kiểm tra ${label}: ⚠ vi phạm`)
          else if (res.state === 'success') log(`Kiểm tra ${label}: ✓ OK`)
          else log(`Kiểm tra ${label}: ${res.state}`)
          return res.state === 'warn'
        }
        log(`Hết thời gian chờ kiểm tra ${kind}`)
        return false
      },
      isCancelled: () => cancelled
    }

    onProgress(10)
    // Execute the (trusted, user-editable) template script with ctx injected as params.
    const keys = Object.keys(ctx)
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function(...keys, `return (async () => { ${template.scriptCode}\n })()`)
    await fn(...keys.map((k) => ctx[k]))
  })()
    .catch((e) => {
      throw e
    })
    .finally(async () => {
      // Đóng êm: browser.close() để Chrome ghi cờ "thoát bình thường", rồi bảo
      // đảm session/tiến trình đã tắt hẳn qua closeSession (ShardEngine tự lo
      // phần chờ/kill bên trong).
      try {
        if (browser) await browser.close()
      } catch {
        /* ignore */
      }
      await closeSession(profile.id)
      ProfileStore.setRunning(profile.id, false)
      // Nhả mọi video còn giữ (job bị dừng/crash trước khi mark) → không kẹt pool.
      for (const p of myClaims) claimed.delete(p)
      myClaims.clear()
      // Browser đã đóng hẳn → dọn cache của profile này (giữ nguyên cookie/login).
      cleanProfileCache(profile.userDataDir)
      log('Đã dọn cache profile')
    })

  return {
    promise,
    handle: {
      cancel: () => {
        cancelled = true
        try {
          if (browser) void browser.close()
        } catch {
          /* ignore */
        }
      }
    }
  }
}
