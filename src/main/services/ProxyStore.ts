import { randomUUID } from 'crypto'
import { getDb } from '../db'
import { checkProxy } from './Network'
import { MACHINE_PROXY_ID, type Proxy, type ProxyConfig, type ProxyType, type ProxyCheckResult } from '@shared/types'

interface Row {
  id: string
  type: ProxyType
  host: string
  port: string
  username: string
  password: string
  alive: number | null
  ip: string | null
  country: string | null
  country_code: string | null
  ping: number | null
  checked_at: number | null
  udp_ms: number | null
  quic_ok: number | null
  created_at: number
  used_by: number
}

function rowToProxy(r: Row): Proxy {
  return {
    id: r.id,
    type: r.type,
    host: r.host,
    port: r.port,
    username: r.username,
    password: r.password,
    alive: r.alive === null ? null : r.alive === 1,
    ip: r.ip ?? null,
    country: r.country,
    countryCode: r.country_code,
    ping: r.ping,
    checkedAt: r.checked_at,
    udpMs: r.udp_ms,
    quicOk: r.quic_ok === null ? null : r.quic_ok === 1,
    createdAt: r.created_at,
    usedBy: r.used_by
  }
}

function toConfig(r: { type: ProxyType; host: string; port: string; username: string; password: string }): ProxyConfig {
  return { useProxy: true, type: r.type, host: r.host, port: r.port, username: r.username, password: r.password }
}

/** Trạng thái "không proxy" — MỘT nơi định nghĩa duy nhất.
 *  Trước đây literal này bị lặp ở 3 chỗ trong assign() và remove() thì quên hẳn:
 *  xóa proxy khỏi pool chỉ set proxy_id = NULL, còn profiles.proxy giữ nguyên host
 *  cũ → UI đọc proxy_id nên báo "không proxy", nhưng buildArgs() đọc profiles.proxy
 *  nên browser VẪN chạy --proxy-server tới proxy đã xóa. Gom về một chỗ để hai
 *  đường không thể lệch nhau lần nữa. */
const NO_PROXY_CFG = JSON.stringify({
  useProxy: false, type: 'socks5', host: '', port: '', username: '', password: ''
} satisfies ProxyConfig)

export const ProxyStore = {
  list(): Proxy[] {
    const rows = getDb()
      .prepare(`
        SELECT p.*, (SELECT COUNT(*) FROM profiles pr WHERE pr.proxy_id = p.id) AS used_by
        FROM proxies p
        ORDER BY p.created_at DESC
      `)
      .all() as Row[]
    return rows.map(rowToProxy)
  },

  get(id: string): Row | undefined {
    return getDb()
      .prepare('SELECT p.*, 0 AS used_by FROM proxies p WHERE p.id = ?')
      .get(id) as Row | undefined
  },

  /** Parse nhiều dòng "host:port[:user:pass]" → thêm vào pool. Bỏ trùng host:port. */
  addMany(text: string, type: ProxyType): number {
    const db = getDb()
    const existing = new Set(
      (db.prepare('SELECT host, port FROM proxies').all() as { host: string; port: string }[]).map(
        (r) => `${r.host}:${r.port}`
      )
    )
    const insert = db.prepare(
      'INSERT INTO proxies (id, type, host, port, username, password, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    let added = 0
    const tx = db.transaction(() => {
      for (const raw of text.split('\n')) {
        const line = raw.trim()
        if (!line) continue
        const parts = line.split(/[:|]/).map((s) => s.trim())
        const [host, port, username = '', password = ''] = parts
        if (!host || !port) continue
        const key = `${host}:${port}`
        if (existing.has(key)) continue
        existing.add(key)
        insert.run(randomUUID(), type, host, port, username, password, Date.now())
        added++
      }
    })
    tx()
    return added
  },

  remove(id: string): void {
    const db = getDb()
    // Đưa hẳn profile đang dùng về "không proxy", KHÔNG chỉ set proxy_id = NULL.
    // Giữ lại bản copy config như trước là bẫy: proxy không còn trong pool nên UI
    // hiển thị "không proxy" (nó đọc qua proxy_id) và cũng không còn cách nào để bỏ
    // gán, nhưng browser vẫn chạy qua proxy đã xóa (buildArgs đọc profiles.proxy).
    const tx = db.transaction((pid: string) => {
      db.prepare('UPDATE profiles SET proxy = ?, proxy_id = NULL WHERE proxy_id = ?').run(NO_PROXY_CFG, pid)
      db.prepare('DELETE FROM proxies WHERE id = ?').run(pid)
    })
    tx(id)
  },

  async check(id: string): Promise<ProxyCheckResult> {
    const r = this.get(id)
    if (!r) return { alive: false, ip: null, country: null, countryCode: null, pingMs: null, error: 'không tìm thấy' }
    const res = await checkProxy(toConfig(r))
    getDb()
      .prepare('UPDATE proxies SET alive = ?, ip = ?, country = ?, country_code = ?, ping = ?, checked_at = ? WHERE id = ?')
      .run(res.alive ? 1 : 0, res.ip, res.country, res.countryCode, res.pingMs, Date.now(), id)
    return res
  },

  /** Ghi kết quả geo/UDP mà ShardX đo được khi một profile gắn proxy này thực
   *  sự launch — nguồn khác với check() ở trên (ShardX, không phải ip-api.com).
   *  Gọi từ ShardEngine.launch() sau mỗi lần mở phiên thành công. */
  saveProbe(
    id: string,
    d: { timezone: string | null; latitude: number | null; longitude: number | null; udpMs: number | null; quicOk: boolean }
  ): void {
    getDb()
      .prepare('UPDATE proxies SET timezone = ?, latitude = ?, longitude = ?, udp_ms = ?, quic_ok = ? WHERE id = ?')
      .run(d.timezone, d.latitude, d.longitude, d.udpMs, d.quicOk ? 1 : 0, id)
  },

  /** Gán proxy cho các profile: copy config vào profile.proxy + set proxy_id.
   *  proxyId = MACHINE_PROXY_ID → xóa proxy, dùng IP máy thật (proxy_id = NULL). */
  assign(proxyId: string, profileIds: string[]): void {
    const db = getDb()

    if (proxyId === MACHINE_PROXY_ID) {
      const upd = db.prepare('UPDATE profiles SET proxy = ?, proxy_id = NULL WHERE id = ?')
      const tx = db.transaction(() => {
        for (const pid of profileIds) upd.run(NO_PROXY_CFG, pid)
      })
      tx()
      return
    }

    const r = this.get(proxyId)
    if (!r) return
    const cfg = JSON.stringify(toConfig(r))
    const upd = db.prepare('UPDATE profiles SET proxy = ?, proxy_id = ? WHERE id = ?')
    // Ô tick trong hộp thoại Gán là nguồn chuẩn: profile đang dùng proxy này mà
    // KHÔNG được chọn → gỡ (về không proxy) để cột "Dùng bởi" đếm đúng.
    const placeholders = profileIds.map(() => '?').join(',')
    const clear = db.prepare(
      `UPDATE profiles SET proxy = ?, proxy_id = NULL
       WHERE proxy_id = ?${profileIds.length ? ` AND id NOT IN (${placeholders})` : ''}`
    )
    const tx = db.transaction(() => {
      for (const pid of profileIds) upd.run(cfg, proxyId, pid)
      clear.run(NO_PROXY_CFG, proxyId, ...profileIds)
    })
    tx()
  }
}
