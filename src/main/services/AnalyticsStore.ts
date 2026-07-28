import { getDb } from '../db'
import { ProfileStore } from './ProfileStore'
import type { AnalyticsData, AnalyticsProfile } from '@shared/types'

export const AnalyticsStore = {
  upsert(profileId: string, date: string, followers: number): void {
    getDb()
      .prepare(
        `INSERT INTO analytics (profile_id, date, followers, collected_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(profile_id, date) DO UPDATE SET followers = excluded.followers, collected_at = excluded.collected_at`
      )
      .run(profileId, date, followers, Date.now())
  },

  /** Đã có ít nhất 1 bản ghi cho ngày này chưa (để khỏi thu thập lặp trong ngày). */
  hasDate(date: string): boolean {
    const r = getDb().prepare('SELECT 1 FROM analytics WHERE date = ? LIMIT 1').get(date)
    return !!r
  },

  data(): AnalyticsData {
    const rows = getDb()
      .prepare('SELECT profile_id, date, followers FROM analytics ORDER BY date ASC')
      .all() as { profile_id: string; date: string; followers: number }[]

    const dateSet = new Set<string>()
    const byProfile = new Map<string, { date: string; followers: number }[]>()
    for (const r of rows) {
      dateSet.add(r.date)
      if (!byProfile.has(r.profile_id)) byProfile.set(r.profile_id, [])
      byProfile.get(r.profile_id)!.push({ date: r.date, followers: r.followers })
    }

    const infoById = new Map(
      ProfileStore.list().map((p) => [p.id, { name: p.name, groupName: p.groupName, groupColor: p.groupColor }])
    )
    const profiles: AnalyticsProfile[] = [...byProfile.entries()].map(([profileId, points]) => {
      const info = infoById.get(profileId)
      return {
        profileId,
        name: info?.name ?? '(đã xóa)',
        groupName: info?.groupName ?? null,
        groupColor: info?.groupColor ?? null,
        points
      }
    })

    return { dates: [...dateSet].sort(), profiles }
  }
}
