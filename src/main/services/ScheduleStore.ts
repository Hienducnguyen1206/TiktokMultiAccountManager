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

  create(): Schedule {
    const now = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    const s: Schedule = {
      id: randomUUID(),
      name: 'Lịch mới',
      time: '09:00',
      date: today,
      repeat: 'weekly',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      templateId: null,
      profileIds: [],
      enabled: true,
      lastRunAt: null,
      createdAt: Date.now()
    }
    getDb()
      .prepare(`
        INSERT INTO schedules (id, name, time, date, repeat, weekdays, template_id, profile_ids, enabled, last_run_at, created_at)
        VALUES (@id, @name, @time, @date, @repeat, @weekdays, @templateId, @profileIds, 1, NULL, @createdAt)
      `)
      .run({ ...s, weekdays: JSON.stringify(s.weekdays), profileIds: JSON.stringify(s.profileIds) })
    return s
  },

  save(s: Schedule): Schedule {
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
