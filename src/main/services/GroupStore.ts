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

  remove(id: string): void {
    getDb().prepare('DELETE FROM groups WHERE id = ?').run(id)
  }
}
