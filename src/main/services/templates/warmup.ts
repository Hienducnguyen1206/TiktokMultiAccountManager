import type { WarmupConfig } from '@shared/types'

export function defaultWarmupConfig(): WarmupConfig {
  return {
    videos: { min: 4, max: 8 },
    watchSec: { min: 8, max: 25 },
    likes: { min: 1, max: 2 },
    comments: { min: 0, max: 1 },
    follows: { min: 0, max: 1 },
    commentPool: []
  }
}

/**
 * Warmup TikTok — lướt For You như người thật.
 *
 * Context do AutomationRunner cấp (giống script upload, trừ mấy hàm về file):
 *   page, profile, config (WarmupConfig), log(msg), sleep(ms),
 *   checkLogin() -> 'in'|'out'|'unknown', isCancelled() -> boolean
 *
 * Chỗ quan trọng nhất nằm ở khâu LẬP KẾ HOẠCH đầu script: bốc số video trước,
 * rồi RÚT NGẪU NHIÊN xem video thứ mấy được tim / bình luận / theo dõi. Làm
 * liền tay mấy cái đầu rồi thôi là lộ ngay ra máy chạy.
 */
export const DEFAULT_WARMUP_SCRIPT = `// TikTok — Warmup
// Lướt For You, xem, thỉnh thoảng tim / bình luận / theo dõi.
// Hụt một cú bấm thì ghi log rồi đi tiếp — không làm hỏng cả lượt.

const rnd = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const range = (r, dflt) => rnd(
  Math.max(0, (r && r.min) != null ? r.min : dflt[0]),
  Math.max(0, (r && r.max) != null ? r.max : dflt[1])
);

// ── Kế hoạch cho lượt này ──────────────────────────────────────────────────
const total = Math.max(1, range(config.videos, [4, 8]));
// Rút ngẫu nhiên N vị trí KHÁC NHAU trong [0, total).
function pickSlots(n) {
  const all = Array.from({ length: total }, (_, i) => i);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return new Set(all.slice(0, Math.min(n, total)));
}
const likeAt = pickSlots(range(config.likes, [1, 2]));
const cmtAt = pickSlots(range(config.comments, [0, 1]));
const folAt = pickSlots(range(config.follows, [0, 1]));
const pool = (config.commentPool || []).filter((s) => String(s).trim() !== '');
log('Kế hoạch: xem ' + total + ' video · tim ' + likeAt.size + ' · bình luận ' + Math.min(cmtAt.size, pool.length) + ' · theo dõi ' + folAt.size);
if (cmtAt.size > 0 && pool.length === 0) log('⚠ Kho câu bình luận trống — bỏ qua phần bình luận');

// ── Mở For You ─────────────────────────────────────────────────────────────
await page.goto('https://www.tiktok.com/foryou', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(rnd(2500, 5000));

// Bấm một nút theo tên hiện trên nó, trong khung video đang xem.
async function tapByLabel(names) {
  return await page.evaluate((wanted) => {
    const inView = (el) => {
      const b = el.getBoundingClientRect();
      return b.width > 0 && b.height > 0 && b.top < innerHeight && b.bottom > 0;
    };
    const hit = [...document.querySelectorAll('button,[role="button"],[aria-label]')].find((e) => {
      if (!inView(e)) return false;
      const label = ((e.getAttribute('aria-label') || '') + ' ' + (e.textContent || '')).toLowerCase();
      return wanted.some((w) => label.includes(w));
    });
    if (!hit) return false;
    hit.click();
    return true;
  }, names);
}

for (let i = 0; i < total; i++) {
  if (isCancelled()) { log('Đã dừng theo yêu cầu'); break; }

  const watch = Math.max(1, range(config.watchSec, [8, 25]));
  log('Video ' + (i + 1) + '/' + total + ' — xem ' + watch + 's');

  // Hành động rơi vào GIỮA lúc xem, không phải ngay khi video vừa hiện.
  const actAt = Math.floor(watch * (0.3 + Math.random() * 0.4));
  await sleep(actAt * 1000);

  if (likeAt.has(i)) {
    const ok = await tapByLabel(['thích', 'like']);
    log(ok ? '  ♥ đã tim' : '  (không thấy nút tim)');
    await sleep(rnd(400, 1200));
  }

  if (folAt.has(i)) {
    const ok = await tapByLabel(['theo dõi', 'follow']);
    log(ok ? '  + đã theo dõi' : '  (không thấy nút theo dõi)');
    await sleep(rnd(500, 1400));
  }

  if (cmtAt.has(i) && pool.length > 0) {
    const text = pool[Math.floor(Math.random() * pool.length)];
    const opened = await tapByLabel(['bình luận', 'comment']);
    if (!opened) {
      log('  (không mở được khung bình luận)');
    } else {
      await sleep(rnd(1200, 2500));
      const box = await page.$('div[contenteditable="true"]');
      if (!box) {
        log('  (không thấy ô nhập bình luận)');
      } else {
        await box.click();
        for (const ch of text) await page.keyboard.type(ch, { delay: rnd(40, 140) });
        await sleep(rnd(600, 1500));
        const sent = await tapByLabel(['đăng', 'post']);
        log(sent ? '  💬 đã bình luận: ' + text : '  (không bấm được nút đăng)');
      }
      await page.keyboard.press('Escape').catch(() => {});
    }
    await sleep(rnd(500, 1200));
  }

  await sleep(Math.max(0, watch - actAt) * 1000);
  if (i < total - 1) await page.keyboard.press('ArrowDown').catch(() => {});
}

log('Xong lượt warmup');
`
