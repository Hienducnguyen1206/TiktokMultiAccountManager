import { randomUUID } from 'crypto'
import { getDb } from '../db'
import type { Group } from '@shared/types'

export const GroupStore = {
  list(): Group[] {
    return getDb().prepare('SELECT id, name, color FROM groups ORDER BY name').all() as Group[]
  },

  create(name: string, color: string): Group {
    const group: Group = { id: randomUUID(), name: name.trim(), color }
    getDb()
      .prepare('INSERT INTO groups (id, name, color) VALUES (@id, @name, @color)')
      .run(group)
    return group
  },

  update(group: Group): Group {
    getDb()
      .prepare('UPDATE groups SET name = @name, color = @color WHERE id = @id')
      .run(group)
    return group
  },

  /** Xóa nhóm. profiles.group_id có FK ON DELETE SET NULL và build better-sqlite3
   *  đang dùng bật PRAGMA foreign_keys theo mặc định (đã kiểm chứng) nên SQLite tự
   *  đưa profile trong nhóm về "không nhóm" — dòng UPDATE dưới đây là dự phòng rõ
   *  ràng, không phụ thuộc vào mặc định ngầm của thư viện/bản SQLite (có thể đổi
   *  khi nâng cấp dependency). */
  remove(id: string): void {
    const tx = getDb().transaction((gid: string) => {
      getDb().prepare('UPDATE profiles SET group_id = NULL WHERE group_id = ?').run(gid)
      getDb().prepare('DELETE FROM groups WHERE id = ?').run(gid)
    })
    tx(id)
  }
}
