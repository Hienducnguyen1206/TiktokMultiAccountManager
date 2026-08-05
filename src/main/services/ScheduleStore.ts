import { randomUUID } from 'crypto'
import { getDb } from '../db'
import type { Schedule } from '@shared/types'

interface Row {
  id: string
  name: string
  time: string
  date: string
  repeat: string
  weekdays: string
  template_id: string | null
  profile_ids: string
  enabled: number
  last_run_at: number | null
  created_at: number
}

function rowToSchedule(r: Row): Schedule {
  return {
    id: r.id,
    name: r.name,
    time: r.time,
    date: r.date,
    repeat: r.repeat as Schedule['repeat'],
    weekdays: JSON.parse(r.weekdays || '[]'),
    templateId: r.template_id,
    profileIds: JSON.parse(r.profile_ids),
    enabled: !!r.enabled,
    lastRunAt: r.last_run_at,
    createdAt: r.created_at
  }
}

export const ScheduleStore = {
  list(): Schedule[] {
    const rows = getDb().prepare('SELECT * FROM schedules ORDER BY time').all() as Row[]
    return rows.map(rowToSchedule)
  },

  get(id: string): Schedule | null {
    const r = getDb().prepare('SELECT * FROM schedules WHERE id = ?').get(id) as Row | undefined
    return r ? rowToSchedule(r) : null
  },

  /** Giờ mặc định cho schedule mới: bắt đầu 09:00, nếu giờ đó đã có schedule thì bước
   *  tiếp 15 phút tới khi gặp khe trống.
   *  Trước đây cứng '09:00': tạo nhiều schedule là chúng nằm ĐÈ LÊN NHAU tại đúng một
   *  điểm trên timeline — chỉ card trên cùng nhận được pointerdown nên những card còn
   *  lại không thể chọn, kéo hay xóa; người dùng tưởng "tạo mà không hiện".
   *  15 phút (không phải 5) vì timeline cao 52px/giờ: 5 phút chỉ lệch ~4px trong khi
   *  card cao ~50px, hở ra quá mảnh để bấm. 15 phút cho ~13px — vẫn là bội của bước
   *  snap 5 phút khi kéo card nên không lệch lưới. */
  nextFreeTime(): string {
    const taken = new Set(
      (getDb().prepare('SELECT time FROM schedules').all() as { time: string }[]).map((r) => r.time)
    )
    const pad2 = (n: number): string => String(n).padStart(2, '0')
    const STEP = 15
    for (let i = 0; i < (24 * 60) / STEP; i++) {
      const m = (9 * 60 + i * STEP) % 1440
      const t = `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`
      if (!taken.has(t)) return t
    }
    return '09:00' // kín cả 96 khe 15 phút — chấp nhận trùng
  },

  create(): Schedule {
    const now = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    const s: Schedule = {
      id: randomUUID(),
      name: 'Lịch mới',
      time: this.nextFreeTime(),
      date: today,
      repeat: 'weekly',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      templateId: null,
      profileIds: [],
      // Lịch mới chưa có template nên tắt — cùng quy tắc mà save() ép, để trạng
      // thái hiển thị không nói dối ngay từ giây đầu tiên.
      enabled: false,
      lastRunAt: null,
      createdAt: Date.now()
    }
    getDb()
      .prepare(`
        INSERT INTO schedules (id, name, time, date, repeat, weekdays, template_id, profile_ids, enabled, last_run_at, created_at)
        VALUES (@id, @name, @time, @date, @repeat, @weekdays, @templateId, @profileIds, 0, NULL, @createdAt)
      `)
      .run({ ...s, weekdays: JSON.stringify(s.weekdays), profileIds: JSON.stringify(s.profileIds) })
    return s
  },

  /**
   * Lưu schedule. Không có template HỢP LỆ thì cờ `enabled` bị ép về false.
   *
   * "Hợp lệ" = id thật sự còn trong bảng templates, không phải chỉ khác null.
   * Template bị xóa để lại một id mồ côi: dropdown hiện "— Chưa chọn —" nhưng cột
   * trong DB vẫn có chuỗi, nên phép thử `!templateId` lọt và lịch vẫn bật được.
   *
   * Scheduler vốn đã bỏ qua lịch thiếu template (xem isDue), nhưng cờ vẫn giữ
   * true nên giao diện ghi "▶ Đang bật" cho một lịch không bao giờ chạy. Ép ở
   * đây — nơi mọi đường ghi đều đi qua — thay vì chỉ sửa chỗ hiển thị.
   */
  save(s: Schedule): Schedule {
    const templateOk =
      !!s.templateId &&
      !!getDb().prepare('SELECT 1 FROM templates WHERE id = ?').get(s.templateId)
    if (!templateOk) s = { ...s, templateId: null, enabled: false }
    getDb()
      .prepare(`
        UPDATE schedules SET
          name = @name, time = @time, date = @date, repeat = @repeat, weekdays = @weekdays,
          template_id = @templateId, profile_ids = @profileIds, enabled = @enabled
        WHERE id = @id
      `)
      .run({
        id: s.id,
        name: s.name,
        time: s.time,
        date: s.date,
        repeat: s.repeat,
        weekdays: JSON.stringify(s.weekdays ?? []),
        templateId: s.templateId,
        profileIds: JSON.stringify(s.profileIds),
        enabled: s.enabled ? 1 : 0
      })
    return this.get(s.id)!
  },

  remove(id: string): void {
    getDb().prepare('DELETE FROM schedules WHERE id = ?').run(id)
  },

  markRun(id: string, disable: boolean): void {
    getDb()
      .prepare('UPDATE schedules SET last_run_at = ?, enabled = CASE WHEN ? THEN 0 ELSE enabled END WHERE id = ?')
      .run(Date.now(), disable ? 1 : 0, id)
  }
}
