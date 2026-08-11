import { randomUUID } from 'crypto'
import { getDb } from '../db'
import { defaultUploadConfig, DEFAULT_TIKTOK_SCRIPT } from './templates/uploadVideo'
import { defaultWarmupConfig, DEFAULT_WARMUP_SCRIPT } from './templates/warmup'
import { defaultBulkVideoConfig, DEFAULT_BULK_ACCOUNT, DEFAULT_BULK_VIDEO_SCRIPT } from './templates/bulkVideo'
import type { Template } from '@shared/types'

interface Row {
  id: string
  name: string
  type: string
  platform: string
  config: string
  script_code: string
  concurrency: number
  retry: number
  created_at: number
  updated_at: number
}

const DEFAULT_TAG_COLOR = '#818cf8'

function rowToTemplate(r: Row): Template {
  const config = JSON.parse(r.config)
  // Mấy phép nâng cấp dưới đây CHỈ dành cho cấu hình upload. Chạy cả trên
  // warmup thì nó nhét checkCopyright/checkContent vào một khuôn không có hai
  // khoá đó — form không hiện, nhưng file config bẩn dần theo mỗi lần đọc.
  if (r.type === 'upload-video') {
    // Migrate hashtags from string[] (old) to { tag, color }[] (new).
    if (Array.isArray(config?.hashtags)) {
      config.hashtags = config.hashtags.map((h: unknown) =>
        typeof h === 'string' ? { tag: h, color: DEFAULT_TAG_COLOR } : h
      )
    }
    if (config && typeof config.checkCopyright !== 'boolean') config.checkCopyright = true
    if (config && typeof config.checkContent !== 'boolean') config.checkContent = true
  }
  let script = r.script_code
  if (r.type === 'bulk-video') {
    // Template tạo trước khi có phần quyền riêng tư TÀI KHOẢN thiếu hẳn khoá
    // `account`; bản giữa còn có giá trị 'keep' (đã bỏ) và action 'none'.
    // Cả hai đều phải quy về một giá trị cụ thể, vì giao diện không còn cách nào
    // diễn tả "giữ nguyên" nữa. HỆ QUẢ: những template đó sau lần đọc này SẼ ghi
    // quyền riêng tư tài khoản lên mọi hồ sơ được chọn, thay vì bỏ qua như trước.
    const a = config?.account
    if (!a || typeof a !== 'object') config.account = { ...DEFAULT_BULK_ACCOUNT }
    else {
      if (a.privateAccount !== 'on' && a.privateAccount !== 'off')
        a.privateAccount = DEFAULT_BULK_ACCOUNT.privateAccount
      if (a.comment !== 'everyone' && a.comment !== 'friends') a.comment = DEFAULT_BULK_ACCOUNT.comment
      if (a.duet !== 'everyone' && a.duet !== 'friends') a.duet = DEFAULT_BULK_ACCOUNT.duet
    }
    if (config && config.action !== 'privacy' && config.action !== 'delete') config.action = 'privacy'
    // Script nằm trong DB theo TỪNG template, nên đổi bản mặc định thôi là chưa
    // đủ: template cũ vẫn chạy script cũ và sẽ lặng lẽ bỏ qua phần tài khoản dù
    // người dùng đã chọn. Nhận diện bằng dấu (vN) ở dòng đầu chứ không bằng tên
    // hàm — bản trung gian có gọi accountPrivacy() nhưng vẫn còn nhánh 'keep'.
    // An toàn vì hộp Code editor đã ẩn — không có script nào là bản người dùng
    // tự sửa; nếu sau này mở lại, phải bỏ phép nâng cấp này đi.
    if (!script.includes('(v2)')) script = DEFAULT_BULK_VIDEO_SCRIPT
  }
  return {
    id: r.id,
    name: r.name,
    type: r.type as Template['type'],
    platform: r.platform as Template['platform'],
    config,
    scriptCode: script,
    concurrency: r.concurrency,
    retry: r.retry,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

/**
 * Kịch bản mặc định của từng loại template.
 *
 * Tách ra khỏi create() vì nút "Khôi phục mặc định" ở Code editor cũng cần —
 * trước đây IPC trả cứng DEFAULT_TIKTOK_SCRIPT cho mọi loại, nên khôi phục
 * template Nuôi account hay Quyền riêng tư là nhét nhầm script Đăng video vào.
 */
export function defaultScriptFor(type: Template['type']): string {
  if (type === 'warmup') return DEFAULT_WARMUP_SCRIPT
  if (type === 'bulk-video') return DEFAULT_BULK_VIDEO_SCRIPT
  return DEFAULT_TIKTOK_SCRIPT
}

export const TemplateStore = {
  list(): Template[] {
    const rows = getDb().prepare('SELECT * FROM templates ORDER BY created_at DESC').all() as Row[]
    return rows.map(rowToTemplate)
  },

  get(id: string): Template | null {
    const r = getDb().prepare('SELECT * FROM templates WHERE id = ?').get(id) as Row | undefined
    return r ? rowToTemplate(r) : null
  },

  create(type: Template['type']): Template {
    const now = Date.now()
    const preset = {
      'upload-video': {
        name: 'Đăng video',
        config: defaultUploadConfig as () => Template['config'],
        script: DEFAULT_TIKTOK_SCRIPT,
        concurrency: 5,
        retry: 1
      },
      warmup: {
        name: 'Nuôi account',
        config: defaultWarmupConfig as () => Template['config'],
        script: DEFAULT_WARMUP_SCRIPT,
        // Mở nhiều nick cùng lúc thì mỗi nick lướt giật cục vì máy chia CPU cho
        // ngần ấy Chromium — mà warmup cốt ở chỗ trông mượt như người thật.
        concurrency: 2,
        // Hỏng giữa chừng thì để lượt sau. Chạy lại ngay chỉ làm nick tương tác
        // dồn cục trong vài phút, đúng thứ đang muốn tránh.
        retry: 0
      },
      'bulk-video': {
        name: 'Chỉnh sửa quyền riêng tư',
        config: defaultBulkVideoConfig as () => Template['config'],
        script: DEFAULT_BULK_VIDEO_SCRIPT,
        concurrency: 2,
        // KHÔNG tự chạy lại: lượt trước có thể đã xoá/đổi được một phần rồi mới
        // gãy. Chạy lại là làm lần hai lên phần còn lại mà không ai ra lệnh.
        retry: 0
      }
    }[type]
    const tpl: Template = {
      id: randomUUID(),
      name: preset.name,
      type,
      platform: 'tiktok',
      config: preset.config(),
      scriptCode: preset.script,
      concurrency: preset.concurrency,
      retry: preset.retry,
      createdAt: now,
      updatedAt: now
    }
    getDb()
      .prepare(`
        INSERT INTO templates (id, name, type, platform, config, script_code, concurrency, retry, created_at, updated_at)
        VALUES (@id, @name, @type, @platform, @config, @scriptCode, @concurrency, @retry, @createdAt, @updatedAt)
      `)
      .run({ ...tpl, config: JSON.stringify(tpl.config) })
    return tpl
  },

  save(t: Template): Template {
    getDb()
      .prepare(`
        UPDATE templates SET
          name = @name, config = @config, script_code = @scriptCode,
          concurrency = @concurrency, retry = @retry, updated_at = @updatedAt
        WHERE id = @id
      `)
      .run({
        id: t.id,
        name: t.name,
        config: JSON.stringify(t.config),
        scriptCode: t.scriptCode,
        concurrency: t.concurrency,
        retry: t.retry,
        updatedAt: Date.now()
      })
    return this.get(t.id)!
  },

  /**
   * Xóa template, và gỡ nó khỏi mọi schedule đang trỏ tới.
   *
   * Không có bước thứ hai thì `schedules.template_id` trỏ vào khoảng không: dropdown
   * chọn task không tìm thấy option nào khớp nên hiện "— Chưa chọn —", trong khi cột
   * trong DB vẫn là một chuỗi id. Mọi kiểm tra kiểu `!templateId` đều lọt, nên lịch
   * đó bật được và Scheduler vẫn coi là hợp lệ — dù task đã biến mất.
   */
  remove(id: string): void {
    const db = getDb()
    const tx = db.transaction((tid: string) => {
      db.prepare('UPDATE schedules SET template_id = NULL, enabled = 0 WHERE template_id = ?').run(tid)
      db.prepare('DELETE FROM templates WHERE id = ?').run(tid)
    })
    tx(id)
  }
}
