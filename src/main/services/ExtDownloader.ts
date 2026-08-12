import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, renameSync, writeFileSync } from 'fs'
import { basename, dirname, join } from 'path'
import type { Browser, Page } from 'puppeteer-core'

/**
 * `chrome.*` chỉ tồn tại BÊN TRONG trang extension, tức trong thân các hàm đưa
 * cho page.evaluate(). Khai báo suông ở đây để TypeScript thôi kêu; không sinh
 * ra dòng mã nào ở phía main.
 */
declare const chrome: any

/**
 * Cầu nối sang extension "Social Bulk Downloader" đã cài trong hồ sơ tải.
 *
 * VÌ SAO PHẢI BẮC CẦU CHỨ KHÔNG GỌI THẲNG:
 * manifest của nó KHÔNG khai `externally_connectable`, nên mặc định không trang
 * web nào — kể cả trang ta điều khiển — gọi được `chrome.runtime.sendMessage`
 * vào background của nó. Đường duy nhất còn mở là chạy mã TỪ BÊN TRONG một
 * trang thuộc chính extension: mở tab `chrome-extension://<id>/options.html`
 * rồi `page.evaluate()` ở đó. Trang đó là ngữ cảnh extension thật, có đủ
 * `chrome.runtime` và `chrome.downloads`.
 *
 * VÌ SAO KHÔNG BẤM NÚT TRÊN GIAO DIỆN CỦA NÓ: nút nằm trong shadow DOM do
 * Plasmo dựng, tên lớp sinh tự động và đổi theo mỗi bản build — bấm theo bộ
 * chọn là gãy ở bản kế tiếp. Đường nhắn tin thì ổn định hơn hẳn.
 *
 * Mọi hằng số dưới đây đọc thẳng từ mã của extension bản 1.8.4 trong hồ sơ,
 * không phải đoán:
 *   static/background/index.js — ExtensionMessageKey.DOWNLOAD_MEDIA="downloadMedia"
 *   @webext-core/messaging     — phong bì { id, type, data, timestamp }, đáp { res, err }
 *   handleDownloadMedia        — data chính là tham số của chrome.downloads.download,
 *                                cộng waitUntilCompleted/retryCount/maxResumeAttempts
 */
export const SBD_EXT_ID = 'cnejldbhpclimaappoekdhmeieehfdpb'

/**
 * Trỏ thư mục tải mặc định của hồ sơ vào Pending, để file rơi thẳng chỗ cần.
 *
 * `chrome.downloads.download()` chỉ nhận đường dẫn TƯƠNG ĐỐI so với thư mục tải
 * của trình duyệt — không có cách nào bảo nó ghi vào E:\Video\Pending từ phía
 * extension. Nên phải đổi chính thư mục đó.
 *
 * Ghi vào `Default/Preferences` và PHẢI ghi lúc Chromium chưa chạy: nó đọc file
 * này lúc khởi động và ghi đè lúc thoát. Cũng tắt luôn `prompt_for_download`,
 * kẻo Chromium chờ người dùng bấm "Lưu ở đâu" trong khi không ai ngồi đó.
 *
 * Hỏng thì không sao: file rơi vào thư mục tải cũ, và tầng gọi vẫn chuyển sang
 * Pending như thường.
 */
export function setDownloadDir(userDataDir: string, dir: string): boolean {
  const file = join(userDataDir, 'Default', 'Preferences')
  try {
    if (!existsSync(file)) return false
    const raw = readFileSync(file, 'utf8')
    const prefs = JSON.parse(raw)
    prefs.download = prefs.download ?? {}
    if (prefs.download.default_directory === dir && prefs.download.prompt_for_download === false) return true
    prefs.download.default_directory = dir
    prefs.download.prompt_for_download = false
    // savefile.default_directory là chỗ Chromium nhớ cho hộp thoại "Lưu thành…".
    // Đặt luôn cho khớp, khỏi nhảy về Downloads khi extension đi đường đó.
    prefs.savefile = prefs.savefile ?? {}
    prefs.savefile.default_directory = dir
    writeFileSync(file, JSON.stringify(prefs), 'utf8')
    return true
  } catch {
    return false
  }
}

/**
 * Kéo cửa sổ về màn hình và phóng to.
 *
 * openAutomation() mở kèm `--window-position=-32000,-32000` để cửa sổ automation
 * không che chỗ làm việc. Nhưng luồng này thì phải nhìn được: extension chạy
 * hàng chục phút, và khi Facebook/Instagram đòi đăng nhập lại hoặc hỏi mã xác
 * minh thì người dùng phải TỰ bấm — cửa sổ nằm ngoài màn hình là bấm không tới,
 * nhìn cũng không thấy, chỉ biết có gì đó vừa bật lên rồi thôi.
 *
 * Không chỉnh được thì vẫn chạy tiếp: đây là chuyện hiển thị, không phải điều
 * kiện để tải.
 */
export async function revealWindow(page: Page): Promise<void> {
  try {
    const client = await page.createCDPSession()
    const { windowId } = (await client.send('Browser.getWindowForTarget')) as any
    // Phải qua 'normal' rồi đặt lại toạ độ TRƯỚC khi phóng to: cửa sổ đang ở
    // toạ độ âm mà set thẳng 'maximized' thì Chromium phóng to trên vùng màn
    // hình chứa toạ độ đó — tức vẫn nằm ngoài tầm nhìn.
    await client.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } })
    await client.send('Browser.setWindowBounds', {
      windowId,
      bounds: { left: 60, top: 60, width: 1400, height: 900 }
    })
    await client.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } })
    await client.detach().catch(() => undefined)
  } catch {
    /* không chỉnh được vị trí cửa sổ — vẫn chạy tiếp */
  }
}

/**
 * Mở trang options của extension và kiểm tra nó thật sự sống.
 *
 * Ném lỗi nói rõ phải làm gì nếu chưa cài — đây là lỗi hay gặp nhất và người
 * dùng không thể tự đoán ra từ một câu "navigation failed".
 */
export async function openExtBridge(browser: Browser, profileName: string): Promise<Page> {
  const page = await browser.newPage()
  const url = `chrome-extension://${SBD_EXT_ID}/options.html`
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
  } catch {
    await page.close().catch(() => {})
    throw new Error(
      `Hồ sơ "${profileName}" chưa cài extension Social Bulk Downloader. ` +
        'Mở hồ sơ đó, cài extension từ Chrome Web Store rồi chạy lại.'
    )
  }
  const ok = await page
    .evaluate(() => typeof chrome?.runtime?.sendMessage === 'function' && typeof chrome?.downloads?.search === 'function')
    .catch(() => false)
  if (!ok) {
    await page.close().catch(() => {})
    throw new Error('Mở được trang extension nhưng không gọi được API của nó — extension có thể đang bị tắt.')
  }
  // Kéo cửa sổ ra chỗ nhìn được NGAY khi mở, chứ không đợi lúc cần: nếu extension
  // đòi đăng nhập giữa chừng thì người dùng đã có sẵn cửa sổ trước mặt.
  await revealWindow(page)
  await page.bringToFront().catch(() => undefined)
  return page
}

/** Kết quả đọc meta, kèm phần chẩn đoán để log nói ra được vì sao hụt. */
export interface PageMeta {
  name: string
  /** data URL, hoặc rỗng nếu không lấy được ảnh. */
  avatar: string
  /** Một dòng mô tả những gì thật sự đọc được — chỉ để ghi log. */
  why: string
}

/**
 * Đọc tên + ảnh đại diện của một trang bằng chính trình duyệt hồ sơ.
 *
 * KHÔNG dùng thẻ Open Graph. Đo thật trên hồ sơ đã đăng nhập (Chromium 149 của
 * ShardX, trang Facebook và Douyin của người dùng): og:title và og:image đều
 * RỖNG ở cả hai — Meta/Douyin chỉ nhả thẻ og cho bot chưa đăng nhập, còn phiên
 * thật thì trang dựng bằng JS và không có thẻ nào. Nên phải đọc từ DOM.
 *
 * Những gì đo được, và vì sao chọn đúng chỗ đó:
 *   Facebook — không có <h1>; tên là DÒNG CHỮ ĐẦU trong [role="main"]
 *              ("Que Đen Thông Thái"). Ảnh đại diện dựng bằng <svg><image>, và
 *              phải khoanh trong [role="main"]: cùng loại thẻ đó ở thanh trên là
 *              avatar của CHÍNH tài khoản đang đăng nhập (đo được hai URL khác
 *              nhau — lấy nhầm là mọi kênh đều mang một ảnh).
 *   Douyin   — <h1> chính là tên ("圆蛤菌"). Ảnh nằm ở CDN nội dung
 *              p3-pc.douyinpic.com (đường dẫn có 'aweme-avatar'), trong khi giao
 *              diện dùng douyinstatic.com — nên loại mọi host chứa "static".
 *   Instagram— CHƯA đo được (chưa có kênh IG nào trong danh sách). Dùng chung bộ
 *              luật trên; nếu hụt thì dòng chẩn đoán trong log sẽ chỉ ra.
 *
 * ẢNH TẢI BẰNG ĐIỀU HƯỚNG, KHÔNG BẰNG fetch(): gọi fetch() trong ngữ cảnh trang
 * facebook.com để lấy ảnh ở fbcdn.net bị chặn vì khác nguồn (CORS). Điều hướng
 * thì không dính CORS, lại đi đúng phiên nên có sẵn cookie và Referer.
 *
 * Ảnh trả về dạng data URL chứ không phải link: link ảnh của Meta có chữ ký hết
 * hạn sau vài giờ, cất vào DB thì hôm sau mở ra là ô trống.
 */
export async function fetchPageMeta(page: Page, url: string): Promise<PageMeta | null> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  } catch (e) {
    return { name: '', avatar: '', why: `không mở được trang: ${(e as Error).message.split('\n')[0]}` }
  }
  // Cả hai trang đều dựng bằng JS. Đo thật: sau 3 giây Facebook đã có tên,
  // nhưng ảnh của Douyin cần lâu hơn — 6 giây thì cả hai đều đủ.
  await new Promise((r) => setTimeout(r, 6000))

  const read = await page
    .evaluate(() => {
      const main = document.querySelector('[role="main"]') ?? document.body
      const clean = (raw: string | null): string =>
        (raw || '')
          .trim()
          .split(/\s+[|•·–—]\s+/)[0]
          .replace(/\s*\(@[^)]+\)\s*$/, '')
          .replace(/的抖音$/, '') // "圆蛤菌的抖音" → "圆蛤菌"
          .trim()
      // Tên trơ trọi của nền tảng = bị đá về trang chung, không phải tên kênh.
      // Hai chuỗi tiếng Trung là nút bật/tắt trình đọc màn hình của Douyin, luôn
      // đứng đầu body nên rất dễ bị nhặt nhầm.
      const junk = (n: string): boolean =>
        !n ||
        n.length > 80 ||
        /^(facebook|instagram|douyin|抖音|log in|đăng nhập|开启读屏标签|读屏标签已关闭)$/i.test(n)

      let name = ''
      for (const cand of [
        ...[...document.querySelectorAll('h1')].map((e) => e.textContent),
        ...(main as HTMLElement).innerText
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean)
          .slice(0, 4),
        document.title
      ]) {
        const c = clean(cand)
        if (!junk(c)) {
          name = c
          break
        }
      }

      const hostOf = (u: string): string => {
        try {
          return new URL(u, location.href).host
        } catch {
          return ''
        }
      }
      let img = ''
      for (const e of main.querySelectorAll('svg image')) {
        const h = e.getAttribute('xlink:href') || e.getAttribute('href') || ''
        if (/^https?:/.test(h) && !/static/i.test(hostOf(h))) {
          img = h
          break
        }
      }
      if (!img) {
        // Ảnh vuông đầu tiên ở CDN nội dung. Bìa video của Douyin là ảnh dọc nên
        // bị loại; ảnh bài viết của Facebook là 16:9 nên cũng vậy.
        const cand = [...main.querySelectorAll('img')].filter(
          (i) =>
            /^https?:/.test(i.src) &&
            !/static/i.test(hostOf(i.src)) &&
            i.naturalWidth >= 40 &&
            Math.abs(i.naturalWidth - i.naturalHeight) <= Math.max(4, i.naturalWidth * 0.1)
        )
        img = cand[0]?.src ?? ''
      }

      return { name, img, title: document.title, href: location.href }
    })
    .catch(() => null)

  if (!read) return { name: '', avatar: '', why: 'không đọc được nội dung trang' }

  let avatar = ''
  let imgNote = 'không thấy ảnh đại diện trên trang'
  if (read.img) {
    try {
      const resp = await page.goto(read.img, { waitUntil: 'domcontentloaded', timeout: 45000 })
      const type = resp?.headers()['content-type'] ?? ''
      const buf = resp ? await resp.buffer() : null
      if (!buf || !buf.length) imgNote = 'tải ảnh về rỗng'
      else if (!/^image\//.test(type)) imgNote = `link ảnh trả về ${type || 'kiểu lạ'}`
      // Ảnh đại diện chỉ vài KB tới vài chục KB (đo thật: Facebook 3KB, Douyin
      // 14KB). To hơn 400KB thì là ảnh bìa — cất vào DB vừa phí vừa sai.
      else if (buf.length > 400_000) imgNote = `ảnh quá lớn (${Math.round(buf.length / 1024)}KB), bỏ qua`
      else {
        avatar = `data:${type.split(';')[0]};base64,${buf.toString('base64')}`
        imgNote = `ảnh ${Math.round(buf.length / 1024)}KB`
      }
    } catch (e) {
      imgNote = `tải ảnh hỏng: ${(e as Error).message.split('\n')[0]}`
    }
  }

  const why =
    `tên=${read.name ? `"${read.name}"` : 'KHÔNG CÓ'} · ${imgNote} · ` +
    `tiêu đề trang="${read.title}" · dừng ở ${read.href}`
  return { name: read.name, avatar, why }
}
// ===================== Chạy "Tải hàng loạt" của extension =====================
//
// Toàn bộ máy chạy hàng loạt nằm trong options.js — background chỉ nhận 5 lệnh,
// và không có lệnh nào tạo job. Nên muốn dùng bảng điều khiển của nó thì phải
// điều khiển chính cái form đó.
//
// Mọi hằng số dưới đây đọc từ options.95eda3f3.js của bản 1.8.4:
//   APP_ROUTES.DOWNLOAD_ALL            → đường dẫn từng nền tảng
//   <Form name="basic">                → antd đặt id ô nhập là `basic_<tên trường>`
//   DownloadFormOptions (module ckiIi) → tên các trường
//   download.constants (module 1efuh)  → danh sách lựa chọn VÀ THỨ TỰ của chúng
//   PROCESS_STATUS_TAG_COLOR           → RUNNING=blue, COMPLETED=green, FAILED=red

/**
 * Đường dẫn tuyến của từng nền tảng, và TÊN hiện trên tiêu đề trang.
 *
 * Tên dùng để kiểm chứng đã sang đúng trang chưa: PageContainer dựng
 * `<h1>Tải hàng loạt từ {socialName}</h1>`, mà socialName là chuỗi tiếng Anh
 * nhét thẳng vào chứ KHÔNG qua bản dịch — nên so theo tên vẫn đúng dù giao diện
 * đang hiện tiếng Việt.
 */
const BULK_PAGE: Record<string, { route: string; label: string }> = {
  facebook: { route: '/download-all/facebook', label: 'Facebook' },
  instagram: { route: '/download-all/instagram', label: 'Instagram' },
  douyin: { route: '/download-all/douyin', label: 'Douyin' }
}

/**
 * Chuyển sang trang tải hàng loạt của một nền tảng, và không trả về `true` cho
 * tới khi chắc chắn đã đứng đúng chỗ.
 *
 * PHẢI BẤM vào mục ở sidebar, không được điều hướng bằng URL. Đo thật trên bản
 * 1.8.4: app dùng router theo đường dẫn chứ không phải HashRouter, nên mở
 * `options.html#/download-all/instagram` — đổi hash hay nạp lại hẳn tài liệu
 * cũng vậy — đều rơi về tuyến mặc định là Facebook. Đó chính là lỗi link
 * Instagram bị dán vào ô của form Facebook.
 *
 * Bấm thì được: sidebar là thẻ <a href="/download-all/instagram"> của
 * react-router, bấm vào là chuyển tuyến trong app.
 *
 * Xác nhận bằng <h1> chứ không bằng location: chuyển tuyến kiểu này KHÔNG đổi
 * địa chỉ — đo được, cả ba trang đều đứng nguyên ở .../options.html.
 */
export async function gotoBulkPage(bridge: Page, source: string): Promise<boolean> {
  const spec = BULK_PAGE[source]
  if (!spec) throw new Error(`Extension không có trang tải hàng loạt cho nguồn ${source}`)

  // Dùng HẰNG id, không suy từ địa chỉ hiện tại của tab. Tab có thể đang ở một
  // trang bất kỳ — khâu đồng bộ tên/ảnh dùng chung tab này và bỏ nó lại ở một
  // file ảnh — lúc đó suy ra thành `chrome-extension://www.douyin.com/…` và bị
  // chặn. Lỗi này bắt được khi chạy kiểm chứng, không phải đoán.
  //
  // Nạp lại từ đầu mỗi lượt cũng vì lý do đó.
  await bridge.goto(`chrome-extension://${SBD_EXT_ID}/options.html`, { waitUntil: 'load', timeout: 45000 })
  await bridge.waitForSelector('h1', { timeout: 30000 }).catch(() => undefined)

  for (let i = 0; i < 40; i++) {
    const state = await bridge
      .evaluate(
        (route: string, label: string) => {
          const here = (document.querySelector('h1')?.textContent ?? '').toLowerCase().includes(label.toLowerCase())
          if (here) return 'ok'
          const a = [...document.querySelectorAll('a')].find((x) => x.getAttribute('href') === route)
          if (!a) return 'no-link'
          a.click()
          return 'clicked'
        },
        spec.route,
        spec.label
      )
      .catch(() => 'error')
    if (state === 'ok') return true
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

/**
 * Danh sách lựa chọn của ô "Loại tải", ĐÚNG THỨ TỰ như extension dựng ra, cùng
 * vị trí của mục video mà app luôn chọn.
 *
 * Chọn theo VỊ TRÍ chứ không theo nhãn: nhãn đã dịch sang tiếng Việt trong giao
 * diện của họ, mà bản dịch thì đổi theo phiên bản. Thứ tự thì đến từ mảng hằng
 * trong mã, bền hơn.
 */
const TYPE_INDEX: Record<string, { index: number; value: string }> = {
  // PROFILE: [PHOTO, VIDEO, REEL, HIGHLIGHT, STORY]
  facebook: { index: 2, value: 'REEL' },
  // [POST_MEDIA, REEL, HIGHLIGHT, STORY]
  instagram: { index: 1, value: 'REEL' },
  // [POST_MEDIA] — Douyin chỉ có một lựa chọn
  douyin: { index: 0, value: 'POST_MEDIA' }
}

/** Thứ tự mảnh tên file trong ô "Cấu hình tên file" của từng nền tảng. */
const FILE_NAME_OPTIONS: Record<string, string[]> = {
  // FacebookDownloadAllForm tự khai riêng, KHÔNG dùng mặc định chung
  facebook: ['id', 'title', 'numericalOrder'],
  // FILE_NAME_CONFIG_DEFAULT_OPTIONS
  instagram: ['id', 'title', 'timestamp', 'numericalOrder'],
  douyin: ['id', 'title', 'timestamp', 'numericalOrder']
}

export interface BulkOptions {
  fileNameFormat: string[]
  concurrency: number
  delaySeconds: number
}

export interface BulkResult {
  downloaded: number
  skipped: number
  status: 'COMPLETED' | 'FAILED' | 'TIMEOUT' | 'STOPPED'
}

/**
 * Kịch bản chạy TRONG trang extension.
 *
 * Neo vào nhãn `label[for="basic_<tên trường>"]` chứ không vào `#basic_<tên>`.
 * Lý do đo được từ mã của họ: ô "Cấu hình tên file" là component tự viết
 * (FileNameConfig) — nó chỉ nhận value/onChange và KHÔNG chuyển `id` xuống thẻ
 * Select bên trong, nên `#basic_fileNameFormat` không hề tồn tại trong DOM. Còn
 * nhãn thì antd luôn đặt htmlFor theo tên trường, không phụ thuộc control.
 */
const PAGE_SCRIPT = String.raw`
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

  // React nghe sự kiện 'input' trên value setter GỐC của prototype. Gán
  // el.value = x trực tiếp thì React không thấy gì và state không đổi.
  function setNative(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  /** Khối .ant-form-item của một trường: tìm qua nhãn trước, id chỉ là dự phòng. */
  function itemOf(name) {
    const lab = document.querySelector('label[for="basic_' + name + '"]')
    const byLabel = lab && lab.closest('.ant-form-item')
    if (byLabel) return byLabel
    const el = document.getElementById('basic_' + name)
    return el ? el.closest('.ant-form-item') : null
  }

  /** Các trường form đang có — in ra khi tìm hụt, để lần sau khỏi phải mò. */
  function fieldNames() {
    return [...document.querySelectorAll('.ant-form-item label[for]')]
      .map((l) => l.getAttribute('for'))
      .filter(Boolean)
  }

  function need(name) {
    const it = itemOf(name)
    if (!it) throw new Error('khong thay truong "' + name + '" — form dang co: ' + fieldNames().join(', '))
    return it
  }

  /**
   * Chọn mục thứ "index" trong một dropdown.
   *
   * Theo VỊ TRÍ chứ không theo nhãn: nhãn đã dịch sang tiếng Việt và đổi theo
   * phiên bản, còn thứ tự thì đến từ mảng hằng trong mã nguồn của họ.
   */
  async function pickSelect(name, index, keepOpen) {
    const box = need(name).querySelector('.ant-select')
    if (!box) throw new Error('truong "' + name + '" khong phai dropdown')
    // Bấm .ant-select-selector nếu có, không thì bấm thẳng vào khung.
    const hit = box.querySelector('.ant-select-selector') || box
    hit.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    hit.click()
    for (let i = 0; i < 40; i++) {
      const items = openList(box)
      if (items.length > index) {
        items[index].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        items[index].click()
        await sleep(120)
        if (!keepOpen) document.body.click()
        await sleep(120)
        return
      }
      await sleep(50)
    }
    throw new Error('dropdown "' + name + '" khong mo ra muc thu ' + index)
  }

  // Danh sách của antd nằm trong portal riêng ngoài form, tìm cái đang mở.
  function openList(box) {
    const ctl = box.querySelector('[aria-controls]')
    const id = ctl && ctl.getAttribute('aria-controls')
    const list = id && document.getElementById(id)
    let root = list && list.closest('.ant-select-dropdown')
    if (!root) {
      const open = [...document.querySelectorAll('.ant-select-dropdown')].filter(
        (d) => !d.classList.contains('ant-select-dropdown-hidden')
      )
      root = open[open.length - 1] || null
    }
    if (!root || root.classList.contains('ant-select-dropdown-hidden')) return []
    return [...root.querySelectorAll('.ant-select-item-option')]
  }

  async function clearMultiSelect(name) {
    const box = need(name).querySelector('.ant-select')
    if (!box) return
    // Dấu x tổng chỉ hiện khi rê chuột nhưng vẫn nằm sẵn trong DOM.
    const clear = box.querySelector('.ant-select-clear')
    if (clear) {
      clear.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      clear.click()
      await sleep(150)
    }
    for (let i = 0; i < 10; i++) {
      const x = box.querySelector('.ant-select-selection-item-remove')
      if (!x) break
      x.click()
      await sleep(80)
    }
  }

  function setNumberField(name, v) {
    const el = need(name).querySelector('input')
    if (!el) throw new Error('truong "' + name + '" khong co o nhap')
    setNative(el, String(v))
  }
`

/** Phần thân điền form, nối sau PAGE_SCRIPT rồi đưa cho new Function('cfg', …). */
const FILL_BODY = String.raw`
  return (async () => {
    const done = []

    // --- Đối tượng (chỉ Facebook): PROFILE hay GROUP, suy từ URL ---
    if (itemOf('target')) {
      // [PROFILE, GROUP] — link có /groups/ thì là nhóm.
      const wantGroup = /\/groups\//i.test(cfg.url)
      await pickSelect('target', wantGroup ? 1 : 0)
      done.push('target=' + (wantGroup ? 'GROUP' : 'PROFILE'))
    }

    // --- Loại tải: app tự chọn, không cho người dùng đổi ---
    await pickSelect('type', cfg.typeIndex)
    done.push('type=' + cfg.typeValue)

    // --- URL kênh ---
    const url = need('userUrl').querySelector('input')
    if (!url) throw new Error('o URL khong co input')
    setNative(url, cfg.url)
    done.push('userUrl')

    // --- Cấu hình tên file (chọn nhiều) ---
    if (cfg.nameIdx.length) {
      await clearMultiSelect('fileNameFormat')
      for (const i of cfg.nameIdx) await pickSelect('fileNameFormat', i, true)
      document.body.click()
      done.push('fileNameFormat=' + cfg.nameIdx.join('/'))
    }

    // --- Cấu trúc thư mục: [mỗi bài một thư mục, gộp một thư mục] ---
    //
    // LUÔN chọn "gộp một thư mục" (vị trí 1), không cho người dùng đổi: file
    // phải rơi thẳng vào thư mục Pending. Chọn "mỗi bài một thư mục" thì video
    // nằm lồng nhiều tầng con và luồng đăng không thấy chúng.
    await pickSelect('isMergeIntoOneFolder', 1)
    done.push('merge')

    // --- Hai ô số ---
    setNumberField('concurrencyProcessLimit', cfg.concurrency)
    done.push('concurrency')
    setNumberField('delayTimeInSecond', cfg.delaySeconds)
    done.push('delay')

    // Ô "Lọc theo khoảng thời gian" của extension để nguyên, không đụng vào:
    // bỏ trống nghĩa là lấy tất cả, và việc lấy tới đâu thì app đã lo bằng
    // chống trùng theo tên file.

    await sleep(300)
    return done
  })()
`

/**
 * Chạy một lượt "Tải hàng loạt" trên trang của extension và đợi nó xong.
 *
 * Điền form rồi bấm nút, y như người dùng làm — không gọi lén hàm nội bộ nào.
 * Đổi lại là phải bám vào DOM, nên khi hụt một trường thì lỗi in luôn danh sách
 * trường form đang có: lần chạy đầu mà gãy thì log tự nói ra gãy ở đâu.
 */
export async function runBulkJob(
  bridge: Page,
  source: string,
  channelUrl: string,
  opts: BulkOptions,
  log: (msg: string) => void,
  /** Người dùng đã bấm Dừng chưa. Hỏi lại mỗi vòng chứ không truyền một lần. */
  shouldStop: () => boolean,
  /** Trần thời gian chờ job, ms. Hết giờ thì trả TIMEOUT chứ không treo mãi. */
  timeoutMs = 45 * 60_000
): Promise<BulkResult> {
  const typePick = TYPE_INDEX[source]
  if (!typePick) throw new Error(`Extension không có trang tải hàng loạt cho nguồn ${source}`)

  // Sang đúng trang TRƯỚC KHI đụng vào bất cứ ô nào. Bỏ bước xác nhận này là
  // link Instagram rơi vào form Facebook — mọi form đều có ô tên `userUrl` nên
  // chỉ chờ ô đó xuất hiện thì không phát hiện được đứng nhầm trang.
  if (!(await gotoBulkPage(bridge, source)))
    throw new Error(`Không mở được trang tải hàng loạt của ${source} trong extension`)
  log(`  ⇢ đã sang trang ${BULK_PAGE[source].label} của extension`)

  // Chờ chính cái NHÃN của ô URL: id thì ô có ô không (xem chú thích ở
  // PAGE_SCRIPT), còn nhãn thì trường nào cũng có.
  await bridge.waitForSelector('label[for="basic_userUrl"]', { timeout: 30000 }).catch(() => {
    throw new Error(`Không thấy form tải hàng loạt của ${source} — extension có thể đã đổi giao diện`)
  })

  // Bấm Dừng trong lúc còn đang dựng form thì thoát luôn, khỏi khởi động job
  // rồi mới đi huỷ nó.
  if (shouldStop()) return { downloaded: 0, skipped: 0, status: 'STOPPED' }

  const nameIdx = (opts.fileNameFormat ?? [])
    .map((p) => FILE_NAME_OPTIONS[source].indexOf(p))
    .filter((i) => i >= 0)

  const filled = (await bridge.evaluate(
    // eslint-disable-next-line no-new-func
    new Function('cfg', PAGE_SCRIPT + FILL_BODY) as any,
    {
      url: channelUrl,
      typeIndex: typePick.index,
      typeValue: typePick.value,
      nameIdx,
      concurrency: opts.concurrency,
      delaySeconds: opts.delaySeconds
    }
  )) as string[]
  log(`  ⚙ đã điền form extension: ${filled.join(', ')}`)

  // Bấm Tải. Nút là submit của chính form đó, không phụ thuộc chữ nghĩa.
  const submitted = await bridge.evaluate(() => {
    const btn = document.querySelector('form button[type="submit"]') as HTMLButtonElement | null
    if (!btn) return false
    btn.click()
    return true
  })
  if (!submitted) throw new Error('Không thấy nút Tải trên form của extension')
  if (shouldStop()) return { downloaded: 0, skipped: 0, status: 'STOPPED' }
  log('  ▶ đã bấm Tải, đang đợi extension chạy…')

  // Đợi job xong. Đọc trạng thái qua MÀU thẻ chứ không qua chữ: chữ đã dịch,
  // màu thì đến từ hằng PROCESS_STATUS_TAG_COLOR trong mã.
  const started = Date.now()
  let last = { downloaded: 0, skipped: 0 }
  let quiet = 0

  /**
   * Bấm Huỷ trên hàng đang chạy rồi trả kết quả.
   *
   * PHẢI đi qua đây ở MỌI lối thoát vì người dùng bấm Dừng — bản trước có một
   * lối tắt `return` ngay đầu vòng lặp, nên extension không hề bị huỷ và vẫn
   * tải tiếp trong lúc app dọn file. Nhìn từ ngoài đúng là "nút Dừng không ăn".
   */
  const stopNow = async (): Promise<BulkResult> => {
    const stopped = await bridge
      .evaluate(() => {
        const rows = [...document.querySelectorAll('.ant-table-row')]
        const row = rows[rows.length - 1]
        if (!row) return false
        // Cột Thao tác chỉ dựng nút khi hàng đang chạy (DownloadProcessesTable),
        // nên nút cuối hàng chính là nút Huỷ — khỏi dò theo chữ đã dịch.
        const cells = row.querySelectorAll('td')
        const btn = cells[cells.length - 1]?.querySelector('button') as HTMLButtonElement | null
        if (!btn) return false
        btn.click()
        return true
      })
      .catch(() => false)
    log(
      stopped
        ? '  ■ đã bấm Huỷ trên bảng của extension'
        : '  ⚠ không thấy nút Huỷ trên bảng của extension — đóng trình duyệt để dừng hẳn'
    )
    // Cho file đang tải dở kịp ghi xong rồi mới đi dọn.
    await new Promise((r) => setTimeout(r, stopped ? 4000 : 500))
    return { ...last, status: 'STOPPED' }
  }

  for (;;) {
    if (Date.now() - started > timeoutMs) return { ...last, status: 'TIMEOUT' }
    if (shouldStop()) return stopNow()
    // Nhịp 1 giây chứ không 3: đây cũng là nhịp phản hồi của nút Dừng, chờ 3
    // giây mới nhúc nhích thì người dùng tưởng bấm hụt.
    await new Promise((r) => setTimeout(r, 1000))
    const snap = await bridge
      .evaluate(() => {
        const rows = [...document.querySelectorAll('.ant-table-row')]
        if (!rows.length) return null
        // Cột: No | Loại | Username | Khoảng ngày | Đã tải | Bỏ qua | Trạng thái | Thao tác
        const cells = [...rows[rows.length - 1].querySelectorAll('td')].map((td) => (td.textContent || '').trim())
        const running = document.querySelector('.ant-table-row .ant-tag-blue')
        const failed = !!rows[rows.length - 1].querySelector('.ant-tag-red')
        return {
          downloaded: parseInt(cells[4] || '0', 10) || 0,
          skipped: parseInt(cells[5] || '0', 10) || 0,
          running: !!running,
          failed
        }
      })
      .catch(() => null)
    if (!snap) {
      // Bảng chưa có hàng nào — job có thể còn đang dựng. Chờ tối đa ~1 phút.
      if (++quiet > 60) throw new Error('Extension không tạo được tiến trình nào (chưa đăng nhập?)')
      continue
    }
    quiet = 0
    if (snap.downloaded !== last.downloaded || snap.skipped !== last.skipped) {
      log(`  … extension: ${snap.downloaded} tải, ${snap.skipped} bỏ qua`)
    }
    last = { downloaded: snap.downloaded, skipped: snap.skipped }
    if (!snap.running) return { ...last, status: snap.failed ? 'FAILED' : 'COMPLETED' }

    if (shouldStop()) return stopNow()
  }
}

/**
 * Liệt kê file mà extension đã ghi ra kể từ mốc thời gian cho trước.
 *
 * Hỏi thẳng chrome.downloads thay vì quét thư mục: nó trả đường dẫn TUYỆT ĐỐI,
 * nên không cần biết thư mục tải của hồ sơ nằm ở đâu, cũng không nhặt nhầm file
 * do người dùng tự tải về lúc khác.
 */
export async function listDownloadsSince(bridge: Page, sinceMs: number): Promise<string[]> {
  return bridge.evaluate(async (since: number) => {
    const items = await chrome.downloads.search({
      startedAfter: new Date(since).toISOString(),
      state: 'complete',
      limit: 0
    })
    return items.map((i: any) => i.filename).filter((f: string) => !!f)
  }, sinceMs)
}

/**
 * Đưa file về Pending.
 *
 * Bình thường setDownloadDir() đã trỏ thư mục tải của hồ sơ vào đúng Pending nên
 * file nằm sẵn ở đó rồi — lúc đó hàm này không làm gì. Vẫn giữ đường chuyển cho
 * trường hợp không ghi được Preferences, hoặc file lọt vào thư mục khác.
 *
 * rename() hỏng khi hai nơi khác ổ đĩa — Downloads thường ở C: còn Pending ở
 * E: — nên có đường chép rồi xoá làm dự phòng.
 */
export function moveInto(src: string, destDir: string): string {
  // So sánh không phân biệt hoa thường: Windows trả đường dẫn với hoa thường
  // khác nhau tuỳ nguồn (chrome.downloads vs ô người dùng chọn).
  const same = (a: string, b: string): boolean =>
    a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase()
  if (same(dirname(src), destDir)) return src

  mkdirSync(destDir, { recursive: true })
  let dest = join(destDir, basename(src))
  for (let i = 1; existsSync(dest) && i < 100; i++) {
    const b = basename(src)
    const dot = b.lastIndexOf('.')
    dest = join(destDir, dot < 0 ? `${b} (${i})` : `${b.slice(0, dot)} (${i})${b.slice(dot)}`)
  }
  try {
    renameSync(src, dest)
  } catch {
    copyFileSync(src, dest)
    rmSync(src, { force: true })
  }
  return dest
}
