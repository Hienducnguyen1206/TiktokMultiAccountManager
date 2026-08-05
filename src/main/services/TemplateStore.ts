import { randomUUID } from 'crypto'
import { getDb } from '../db'
import { defaultUploadConfig, DEFAULT_TIKTOK_SCRIPT } from './templates/uploadVideo'
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
  // Migrate hashtags from string[] (old) to { tag, color }[] (new).
  if (Array.isArray(config?.hashtags)) {
    config.hashtags = config.hashtags.map((h: unknown) =>
      typeof h === 'string' ? { tag: h, color: DEFAULT_TAG_COLOR } : h
    )
  }
  if (config && typeof config.checkCopyright !== 'boolean') config.checkCopyright = true
  if (config && typeof config.checkContent !== 'boolean') config.checkContent = true
  return {
    id: r.id,
    name: r.name,
    type: r.type as Template['type'],
    platform: r.platform as Template['platform'],
    config,
    scriptCode: r.script_code,
    concurrency: r.concurrency,
    retry: r.retry,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
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
    // Only 'upload-video' is bundled for now.
    const tpl: Template = {
      id: randomUUID(),
      name: 'Upload video',
      type,
      platform: 'tiktok',
      config: defaultUploadConfig(),
      scriptCode: DEFAULT_TIKTOK_SCRIPT,
      concurrency: 5,
      retry: 1,
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
