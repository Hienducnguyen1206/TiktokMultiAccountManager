import { randomUUID } from 'crypto'
import { getDb } from '../db'
import { ProfileStore, profileEvents } from './ProfileStore'
import type { Group } from '@shared/types'

export const GroupStore = {
  list(): Group[] {
    return getDb().prepare('SELECT id, name, color, icon FROM groups ORDER BY name').all() as Group[]
  },

  create(name: string, color: string, icon = ''): Group {
    const group: Group = { id: randomUUID(), name: name.trim(), color, icon }
    getDb()
      .prepare('INSERT INTO groups (id, name, color, icon) VALUES (@id, @name, @color, @icon)')
      .run(group)
    // Danh sách nhóm sống trong App.tsx và chỉ được nạp lại khi có sự kiện này.
    // Thiếu nó thì nhóm vừa tạo chỉ xuất hiện đúng ở chỗ vừa tạo ra nó, các tab
    // khác giữ danh sách cũ cho tới khi một thao tác không liên quan tình cờ
    // reload — chính là chỗ "đồng bộ toàn app" đang hụt trước đây.
    profileEvents.emit('changed')
    return group
  },

  update(group: Group): Group {
    getDb()
      .prepare('UPDATE groups SET name = @name, color = @color, icon = @icon WHERE id = @id')
      .run(group)
    profileEvents.emit('changed')
    return group
  },

  /**
   * Xóa nhóm.
   *
   * `deleteProfiles = false`: profile trong nhóm về "Không nhóm". profiles.group_id
   * có FK ON DELETE SET NULL và build better-sqlite3 đang dùng bật PRAGMA
   * foreign_keys theo mặc định (đã kiểm chứng) nên SQLite tự làm việc đó — dòng
   * UPDATE dưới đây là dự phòng rõ ràng, không phụ thuộc vào mặc định ngầm của
   * thư viện/bản SQLite (có thể đổi khi nâng cấp dependency).
   *
   * `deleteProfiles = true`: xóa luôn từng profile qua ProfileStore.remove(), KHÔNG
   * phải một câu DELETE gộp — remove() còn dọn thư mục ShardX, thư mục user-data và
   * lịch sử analytics của profile. Một câu DELETE thẳng vào bảng sẽ để lại rác trên
   * đĩa và trong bảng analytics.
   */
  remove(id: string, deleteProfiles = false): void {
    if (deleteProfiles) {
      const ids = (
        getDb().prepare('SELECT id FROM profiles WHERE group_id = ?').all(id) as { id: string }[]
      ).map((r) => r.id)
      for (const pid of ids) ProfileStore.remove(pid)
    }
    const tx = getDb().transaction((gid: string) => {
      getDb().prepare('UPDATE profiles SET group_id = NULL WHERE group_id = ?').run(gid)
      getDb().prepare('DELETE FROM groups WHERE id = ?').run(gid)
    })
    tx(id)
    // DB da dung nhung danh sach profiles/groups trong renderer khong tu biet — kiem
    // qua Playwright: bang van hien nhom vua xoa cho toi khi mot hanh dong KHONG LIEN
    // QUAN nao do tinh co reload. Dung lai kenh profileEvents da noi san cho
    // markLastUsed/setLoggedIn de App.reload() chay ngay.
    profileEvents.emit('changed')
  },

  /**
   * Đặt lại ĐÚNG tập thành viên của một nhóm — dùng cho danh sách ô tích trong hộp
   * thoại cài đặt nhóm. Profile bị bỏ tích về "Không nhóm"; profile mới tích được
   * kéo sang nhóm này kể cả khi đang thuộc nhóm khác (một profile chỉ ở một nhóm).
   */
  setMembers(groupId: string, profileIds: string[]): void {
    const db = getDb()
    const tx = db.transaction((gid: string, ids: string[]) => {
      db.prepare('UPDATE profiles SET group_id = NULL WHERE group_id = ?').run(gid)
      const set = db.prepare('UPDATE profiles SET group_id = ? WHERE id = ?')
      for (const pid of ids) set.run(gid, pid)
    })
    tx(groupId, profileIds)
    profileEvents.emit('changed')
  },

  /** Gán hàng loạt — dùng cho kéo thả và cho lệnh chuyển nhóm của tập đang chọn. */
  assign(profileIds: string[], groupId: string | null): void {
    const db = getDb()
    const tx = db.transaction((ids: string[], gid: string | null) => {
      const set = db.prepare('UPDATE profiles SET group_id = ? WHERE id = ?')
      for (const pid of ids) set.run(gid, pid)
    })
    tx(profileIds, groupId)
    profileEvents.emit('changed')
  }
}
