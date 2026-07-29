import type { UploadVideoConfig } from '@shared/types'

export function defaultUploadConfig(): UploadVideoConfig {
  return {
    pendingDir: '',
    uploadedDir: '',
    errorDir: '',
    videoOrder: 'oldest',
    captionMode: 'filename',
    captionCustom: '',
    hashtags: [],
    hashtagCount: 0,
    checkCopyright: true,
    checkContent: true
  }
}

/**
 * Bundled TikTok upload script. Runs once per profile (the runner loops while
 * videos remain). Context provided by AutomationRunner:
 *   page      - Puppeteer Page (profile browser, native fingerprint)
 *   profile   - the Profile object
 *   config    - UploadVideoConfig
 *   nextVideo()      -> { path, name } | null   (locks the file from the shared Pending pool)
 *   buildCaption(v)  -> string                  (filename/empty/custom + N random hashtags)
 *   markUploaded(v)  / markError(v)             (move file to Uploaded / Error)
 *   waitCheck(kind)  -> boolean                 (kind: 'copyright'|'content'; true = phát hiện vi phạm)
 *   checkLogin()     -> 'in'|'out'|'unknown'    ('out' tự tắt cờ đăng nhập của profile)
 *   log(msg), sleep(ms)
 * Editable — adjust selectors if TikTok changes its UI.
 */
export const DEFAULT_TIKTOK_SCRIPT = `// TikTok — Upload video
// Vi phạm bản quyền/nội dung → chuyển Error, lấy video sau.
// Lỗi KỸ THUẬT (mạng/proxy/điều hướng) → GIỮ video ở Pending, DỪNG job để thử lại
//   (không đẩy hàng loạt video tốt sang Error).
// ĐĂNG THÀNH CÔNG → dừng. Hết video trong Pending → dừng.
function isNetworkError(e) {
  const m = (e && e.message ? e.message : String(e)) || '';
  return /net::|ERR_|Navigation|Target closed|Protocol error|disconnected|ECONN|socket hang up/i.test(m);
}
function isTimeoutError(e) {
  const m = (e && e.message ? e.message : String(e)) || '';
  return /Waiting failed|exceeded|timeout|Timed out/i.test(m);
}

while (true) {
  const video = await nextVideo();
  if (!video) { log('Hết video trong Pending — dừng'); break; }
  log('Video: ' + video.name);

  try {
    await page.goto('https://www.tiktok.com/tiktokstudio/upload', { waitUntil: 'domcontentloaded' });

    // chọn file
    const input = await page.waitForSelector('input[type=file]', { timeout: 60000 });
    await input.uploadFile(video.path);
    log('Đang tải video lên…');

    // chờ vùng cấu hình hiện ra (ô caption) — tức video đã tải xong
    await page.waitForSelector('div[contenteditable="true"]', { timeout: 180000 });

    // 2 kiểm tra (chờ check XONG, KHÔNG dựa vào nút Post). waitCheck tự ghi log.
    if (config.checkCopyright && await waitCheck('copyright')) { await markError(video); continue; }
    if (config.checkContent && await waitCheck('content')) { await markError(video); continue; }

    // caption + hashtag
    const caption = buildCaption(video);
    const box = await page.$('div[contenteditable="true"]');
    await box.click();
    await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(caption, { delay: 25 });

    await sleep(1500);
    await page.click('button[data-e2e="post_video_button"]');
    await sleep(4000);

    await markUploaded(video);
    log('✓ Đăng xong: ' + video.name);
    break; // thành công → dừng profile này
  } catch (e) {
    const msg = e && e.message ? e.message : JSON.stringify(e);
    if (isNetworkError(e)) {
      // Mạng/proxy lỗi → giữ video ở Pending, DỪNG job để thử lại sau.
      await releaseVideo(video);
      log('✕ Lỗi mạng/proxy (giữ Pending, dừng): ' + msg);
      throw e;
    }
    if (isTimeoutError(e)) {
      // Trang/upload chậm quá timeout → video vẫn TỐT: giữ ở Pending, bỏ qua
      // video này và thử video kế (KHÔNG chuyển Error, KHÔNG dừng cả job).
      await releaseVideo(video);
      // Timeout ở trang upload thường là do bị đá về trang đăng nhập. Không kiểm
      // thì vòng lặp chờ hết timeout cho TỪNG video còn lại — trông như treo.
      if (await checkLogin() === 'out') throw new Error('Profile đã đăng xuất TikTok');
      log('✕ Tải chậm/timeout (giữ Pending, thử video kế): ' + msg);
      continue;
    }
    // Lỗi khác → coi là hỏng video cụ thể, chuyển Error rồi thử video kế.
    await markError(video);
    log('✕ Lỗi (chuyển Error): ' + msg);
  }
}
`
