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

    // Danh sách profile dựng từ ProfileStore, KHÔNG từ bảng analytics — đúng bằng
    // những gì tab Profile hiển thị, không hơn không kém.
    //
    // Trước đây danh sách là hợp của hai nguồn: mọi profile_id từng có bản ghi,
    // cộng thêm profile có username. Xóa profile lại không dọn bảng analytics, nên
    // bản ghi của nó nằm lại vĩnh viễn và vẫn dựng thành một hàng mang tên
    // "(đã xóa)". Đo trên DB thật: tab Profile 20 profile, tab Analytics 128 hàng,
    // trong đó 108 là profile đã bị xóa từ lâu.
    //
    // Profile chưa thu thập được (proxy chết / sai username / bị chặn) vẫn có mặt
    // với points rỗng — UI hiện "—", để thấy cái nào chưa lấy được thay vì để nó
    // im lặng biến mất.
    const profiles: AnalyticsProfile[] = ProfileStore.list().map((p) => ({
      profileId: p.id,
      name: p.name,
      avatar: p.avatar,
      balance: p.balance,
      monetization: p.monetization,
      monetizationActive: p.monetizationActive,
      groupId: p.groupId,
      groupName: p.groupName ?? null,
      groupColor: p.groupColor ?? null,
      groupIcon: p.groupIcon ?? null,
      points: byProfile.get(p.id) ?? []
    }))

    return { dates: [...dateSet].sort(), profiles }
  }
}
