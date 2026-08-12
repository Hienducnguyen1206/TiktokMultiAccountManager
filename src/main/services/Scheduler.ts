import { EventEmitter } from 'events'
import { ScheduleStore } from './ScheduleStore'
import { TemplateStore } from './TemplateStore'
import type { Schedule } from '@shared/types'

export const schedulerEvents = new EventEmitter()

let timer: NodeJS.Timeout | null = null

function minutesOfDay(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function ranToday(lastRunAt: number | null): boolean {
  if (!lastRunAt) return false
  const a = new Date(lastRunAt)
  const b = new Date()
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** Today as "YYYY-MM-DD" (local). */
function todayStr(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function isDue(s: Schedule, now: Date, nowMin: number): boolean {
  if (!s.enabled || !s.templateId || s.profileIds.length === 0) return false
  // templateId khác null vẫn có thể trỏ vào khoảng không nếu template đã bị xóa.
  // TemplateStore/ScheduleStore nay dọn sạch trường hợp đó, nhưng đây là chốt
  // cuối ngay trước khi thật sự chạy một task nên kiểm lại cho chắc.
  if (!TemplateStore.get(s.templateId)) return false
  const sched = minutesOfDay(s.time)
  // Fire within a 2-minute window after the scheduled time so a missed tick still catches it.
  if (nowMin < sched || nowMin > sched + 2) return false
  const today = todayStr(now)
  if (s.repeat === 'once') {
    // Chạy đúng ngày đã đặt (nếu chưa đặt ngày thì bỏ qua điều kiện ngày).
    if (s.date && s.date !== today) return false
    return s.lastRunAt === null
  }
  // weekly: chạy vào các thứ đã tích, từ ngày bắt đầu trở đi, mỗi ngày một lần.
  if (s.date && today < s.date) return false
  if (s.weekdays.length > 0 && !s.weekdays.includes(now.getDay())) return false
  return !ranToday(s.lastRunAt)
}

function tick(): void {
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  for (const s of ScheduleStore.list()) {
    if (!isDue(s, now, nowMin)) continue
    ScheduleStore.markRun(s.id, s.repeat === 'once')
    // Integration point: when Queue is built, enqueue here:
    //   QueueManager.enqueue(s.templateId!, s.profileIds)
    schedulerEvents.emit('fire', s)
  }
}

export function startScheduler(): void {
  if (timer) return
  timer = setInterval(tick, 30_000)
  tick() // run once at startup
}

