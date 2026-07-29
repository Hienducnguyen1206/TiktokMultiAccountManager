import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import { join } from 'path'
import { rmSync } from 'fs'
import { getDb, profilesRoot } from '../db'
import { generateFingerprint } from './FingerprintEngine'
import type { CreateProfileInput, Profile, ProxyConfig } from '@shared/types'

/** 'changed' — profile bị sửa từ phía main (không qua IPC) nên renderer phải tải lại.
 *  Dùng khi job phát hiện profile đã bị TikTok đăng xuất giữa chừng. */
export const profileEvents = new EventEmitter()

interface Row {
  id: string
  name: string
  group_id: string | null
  proxy: string
  fingerprint: string
  user_data_dir: string
  home_url: string
  notes: string
  warning_level: number
  last_used_at: number | null
  created_at: number
  tiktok_username: string
  tiktok_password: string
  tiktok_2fa: string
  logged_in: number
  proxy_id: string | null
  group_name: string | null
  group_color: string | null
  proxy_country: string | null
  proxy_country_code: string | null
  proxy_ip: string | null
}

// Runtime statuses live in memory only (not persisted).
const runningIds = new Set<string>()

function defaultProxy(): ProxyConfig {
  return { useProxy: false, type: 'socks5', host: '', port: '', username: '', password: '' }
}

function rowToProfile(r: Row): Profile {
  let fingerprint = JSON.parse(r.fingerprint)
  // Migrate profiles created before the native (seed-based) fingerprint model.
  if (typeof fingerprint?.seed !== 'number') {
    fingerprint = generateFingerprint()
    getDb().prepare('UPDATE profiles SET fingerprint = ? WHERE id = ?').run(JSON.stringify(fingerprint), r.id)
  }
  return {
    id: r.id,
    name: r.name,
    groupId: r.group_id,
    proxy: JSON.parse(r.proxy),
    fingerprint,
    userDataDir: r.user_data_dir,
    homepageUrl: r.home_url ?? '',
    notes: r.notes,
    warningLevel: r.warning_level,
    status: runningIds.has(r.id) ? 'running' : 'idle',
    lastUsedAt: r.last_used_at,
    createdAt: r.created_at,
    tiktokUsername: r.tiktok_username ?? '',
    tiktokPassword: r.tiktok_password ?? '',
    tiktok2fa: r.tiktok_2fa ?? '',
    loggedIn: r.logged_in === 1,
    proxyId: r.proxy_id ?? null,
    groupName: r.group_name,
    groupColor: r.group_color,
    proxyCountry: r.proxy_country,
    proxyCountryCode: r.proxy_country_code,
    proxyIp: r.proxy_ip
  }
}

const SELECT = `
  SELECT p.*, g.name AS group_name, g.color AS group_color,
         px.country AS proxy_country, px.country_code AS proxy_country_code, px.ip AS proxy_ip
  FROM profiles p
  LEFT JOIN groups g ON g.id = p.group_id
  LEFT JOIN proxies px ON px.id = p.proxy_id
`

export const ProfileStore = {
  list(): Profile[] {
    const rows = getDb().prepare(`${SELECT} ORDER BY p.created_at DESC`).all() as Row[]
    return rows.map(rowToProfile)
  },

  get(id: string): Profile | null {
    const row = getDb().prepare(`${SELECT} WHERE p.id = ?`).get(id) as Row | undefined
    return row ? rowToProfile(row) : null
  },

  /** Create one or many profiles. Names are suffixed with an incrementing index. */
  create(input: CreateProfileInput): Profile[] {
    const db = getDb()
    const qty = Math.max(1, Math.min(50, input.quantity || 1))
    const insert = db.prepare(`
      INSERT INTO profiles (id, name, group_id, proxy, fingerprint, user_data_dir, home_url, notes, warning_level, last_used_at, created_at, tiktok_username, tiktok_password, tiktok_2fa, logged_in)
      VALUES (@id, @name, @group_id, @proxy, @fingerprint, @user_data_dir, @home_url, @notes, 0, NULL, @created_at, @tiktok_username, @tiktok_password, @tiktok_2fa, 0)
    `)
    // Next index: count existing profiles whose name starts with the prefix.
    const startIndex =
      (db
        .prepare('SELECT COUNT(*) AS c FROM profiles WHERE name LIKE ?')
        .get(`${input.namePrefix}%`) as { c: number }).c + 1

    const created: Profile[] = []
    const tx = db.transaction(() => {
      for (let i = 0; i < qty; i++) {
        const id = randomUUID()
        const name = qty === 1 && !/[_-]$/.test(input.namePrefix)
          ? input.namePrefix
          : `${input.namePrefix}${startIndex + i}`
        const userDataDir = join(profilesRoot(), id)
        insert.run({
          id,
          name,
          group_id: input.groupId,
          proxy: JSON.stringify(defaultProxy()),
          fingerprint: JSON.stringify(generateFingerprint()),
          user_data_dir: userDataDir,
          home_url: (input.homepageUrl ?? '').trim(),
          notes: input.notes ?? '',
          created_at: Date.now(),
          tiktok_username: '',
          tiktok_password: '',
          tiktok_2fa: ''
        })
        created.push(this.get(id)!)
      }
    })
    tx()
    return created
  },

  update(profile: Profile): Profile {
    getDb()
      .prepare(`
        UPDATE profiles SET
          name = @name,
          group_id = @group_id,
          proxy = @proxy,
          fingerprint = @fingerprint,
          home_url = @home_url,
          notes = @notes,
          warning_level = @warning_level,
          tiktok_username = @tiktok_username,
          tiktok_password = @tiktok_password,
          tiktok_2fa = @tiktok_2fa,
          logged_in = @logged_in,
          proxy_id = @proxy_id
        WHERE id = @id
      `)
      .run({
        id: profile.id,
        name: profile.name,
        group_id: profile.groupId,
        proxy: JSON.stringify(profile.proxy),
        fingerprint: JSON.stringify(profile.fingerprint),
        home_url: (profile.homepageUrl ?? '').trim(),
        notes: profile.notes,
        warning_level: profile.warningLevel,
        tiktok_username: profile.tiktokUsername ?? '',
        tiktok_password: profile.tiktokPassword ?? '',
        tiktok_2fa: profile.tiktok2fa ?? '',
        logged_in: profile.loggedIn ? 1 : 0,
        proxy_id: profile.proxyId ?? null
      })
    return this.get(profile.id)!
  },

  remove(id: string): void {
    const profile = this.get(id)
    getDb().prepare('DELETE FROM profiles WHERE id = ?').run(id)
    if (profile) {
      try {
        rmSync(profile.userDataDir, { recursive: true, force: true })
      } catch {
        // ignore — folder may be locked or already gone
      }
    }
  },

  /** Xóa TẤT CẢ profile + thư mục dữ liệu của chúng. Trả về số profile đã xóa. */
  removeAll(): number {
    const all = this.list()
    getDb().prepare('DELETE FROM profiles').run()
    for (const p of all) {
      try {
        rmSync(p.userDataDir, { recursive: true, force: true })
      } catch {
        // ignore — folder may be locked or already gone
      }
    }
    return all.length
  },

  createFromAccounts(accounts: { username: string; password: string; twofa: string }[]): Profile[] {
    const db = getDb()
    const existing = new Set(
      (db.prepare("SELECT tiktok_username FROM profiles WHERE tiktok_username != ''").all() as { tiktok_username: string }[])
        .map((r) => r.tiktok_username.toLowerCase())
    )
    const insert = db.prepare(`
      INSERT INTO profiles (id, name, group_id, proxy, fingerprint, user_data_dir, home_url, notes, warning_level, last_used_at, created_at, tiktok_username, tiktok_password, tiktok_2fa, logged_in)
      VALUES (@id, @name, NULL, @proxy, @fingerprint, @user_data_dir, 'https://www.tiktok.com', '', 0, NULL, @created_at, @tiktok_username, @tiktok_password, @tiktok_2fa, 0)
    `)
    const created: Profile[] = []
    const tx = db.transaction(() => {
      for (const acc of accounts) {
        if (existing.has(acc.username.toLowerCase())) continue
        const id = randomUUID()
        insert.run({
          id,
          name: acc.username,
          proxy: JSON.stringify(defaultProxy()),
          fingerprint: JSON.stringify(generateFingerprint()),
          user_data_dir: join(profilesRoot(), id),
          created_at: Date.now(),
          tiktok_username: acc.username,
          tiktok_password: acc.password,
          tiktok_2fa: acc.twofa
        })
        created.push(this.get(id)!)
      }
    })
    tx()
    return created
  },

  setLoggedIn(id: string, loggedIn: boolean): void {
    getDb().prepare('UPDATE profiles SET logged_in = ? WHERE id = ?').run(loggedIn ? 1 : 0, id)
    profileEvents.emit('changed')
  },

  addUploadLog(profileId: string, videoName: string, status: 'done' | 'error', note = ''): void {
    getDb()
      .prepare('INSERT INTO upload_history (id, profile_id, video_name, status, note, at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), profileId, videoName, status, note, Date.now())
  },

  uploadHistory(profileId: string, limit = 100): { videoName: string; status: string; note: string; at: number }[] {
    return getDb()
      .prepare('SELECT video_name AS videoName, status, note, at FROM upload_history WHERE profile_id = ? ORDER BY at DESC LIMIT ?')
      .all(profileId, limit) as { videoName: string; status: string; note: string; at: number }[]
  },

  rename(id: string, name: string): void {
    getDb().prepare('UPDATE profiles SET name = ? WHERE id = ?').run(name, id)
  },

  /** Gọi từ cả Run tay (BrowserLauncher) lẫn job template (AutomationRunner) — mọi
   *  lần mở browser của profile đều tính là "truy cập". Bắn 'changed' để tab Profile
   *  tải lại: launcherEvents.emit('status') chỉ merge status, không đụng
   *  lastUsedAt; còn job template không emit gì cho renderer cả, nên trước đây cột
   *  "Lần cuối" đứng nguyên cho tới khi có hành động khác vô tình load lại. */
  markLastUsed(id: string): void {
    getDb().prepare('UPDATE profiles SET last_used_at = ? WHERE id = ?').run(Date.now(), id)
    profileEvents.emit('changed')
  },

  setRunning(id: string, running: boolean): void {
    if (running) runningIds.add(id)
    else runningIds.delete(id)
  }
}
