import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'

let db: Database.Database

/** Root folder holding the DB and all profile user-data-dirs. */
export function dataRoot(): string {
  const root = join(app.getPath('userData'), 'data')
  mkdirSync(root, { recursive: true })
  return root
}

export function profilesRoot(): string {
  const root = join(dataRoot(), 'profiles')
  mkdirSync(root, { recursive: true })
  return root
}

export function getDb(): Database.Database {
  if (db) return db
  db = new Database(join(dataRoot(), 'hiennvauto.db'))
  db.pragma('journal_mode = WAL')
  migrate(db)
  return db
}

function migrate(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id    TEXT PRIMARY KEY,
      name  TEXT NOT NULL,
      color TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      group_id      TEXT,
      proxy         TEXT NOT NULL,        -- JSON ProxyConfig
      fingerprint   TEXT NOT NULL,        -- JSON Fingerprint
      user_data_dir TEXT NOT NULL,
      notes         TEXT NOT NULL DEFAULT '',
      warning_level INTEGER NOT NULL DEFAULT 0,
      last_used_at  INTEGER,
      created_at    INTEGER NOT NULL,
      home_url      TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS templates (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      type        TEXT NOT NULL,
      platform    TEXT NOT NULL,
      config      TEXT NOT NULL,          -- JSON (type-specific)
      script_code TEXT NOT NULL,
      concurrency INTEGER NOT NULL DEFAULT 5,
      retry       INTEGER NOT NULL DEFAULT 1,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      time         TEXT NOT NULL,         -- "HH:MM"
      date         TEXT NOT NULL DEFAULT '', -- "YYYY-MM-DD": ngày chạy (once) / ngày bắt đầu (weekly)
      repeat       TEXT NOT NULL,         -- once | weekly
      weekdays     TEXT NOT NULL DEFAULT '[]', -- JSON number[] getDay(): chỉ dùng khi weekly
      template_id  TEXT,
      profile_ids  TEXT NOT NULL,         -- JSON string[]
      enabled      INTEGER NOT NULL DEFAULT 1,
      last_run_at  INTEGER,
      created_at   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id           TEXT PRIMARY KEY,
      template_id  TEXT NOT NULL,
      profile_id   TEXT NOT NULL,
      status       TEXT NOT NULL,         -- queued | running | done | error
      error        TEXT,
      log          TEXT NOT NULL DEFAULT '',
      created_at   INTEGER NOT NULL,
      started_at   INTEGER,
      finished_at  INTEGER
    );

    -- ===== Analytics: follower theo ngày =====
    CREATE TABLE IF NOT EXISTS analytics (
      profile_id   TEXT NOT NULL,
      date         TEXT NOT NULL,          -- 'YYYY-MM-DD' (local)
      followers    INTEGER NOT NULL,
      collected_at INTEGER NOT NULL,
      PRIMARY KEY (profile_id, date)
    );

    -- ===== Pool proxy =====
    CREATE TABLE IF NOT EXISTS proxies (
      id           TEXT PRIMARY KEY,
      type         TEXT NOT NULL DEFAULT 'http',  -- http | https | socks5
      host         TEXT NOT NULL,
      port         TEXT NOT NULL,
      username     TEXT NOT NULL DEFAULT '',
      password     TEXT NOT NULL DEFAULT '',
      alive        INTEGER,                        -- null=chưa check, 1 sống, 0 chết
      ip           TEXT,                           -- IP công khai khi đi qua proxy
      country      TEXT,
      country_code TEXT,
      ping         INTEGER,
      checked_at   INTEGER,
      created_at   INTEGER NOT NULL
    );

    -- ===== Lịch sử upload theo profile =====
    CREATE TABLE IF NOT EXISTS upload_history (
      id          TEXT PRIMARY KEY,
      profile_id  TEXT NOT NULL,
      video_name  TEXT NOT NULL,
      status      TEXT NOT NULL,          -- done | error
      note        TEXT NOT NULL DEFAULT '',
      at          INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_upload_history_profile ON upload_history(profile_id, at DESC);

    -- ===== Get Video (crawl YouTube Shorts) =====
    CREATE TABLE IF NOT EXISTS gv_channels (
      id         TEXT PRIMARY KEY,
      url        TEXT NOT NULL,           -- channel URL hoặc @handle người dùng nhập
      name       TEXT NOT NULL DEFAULT '',
      following  INTEGER NOT NULL DEFAULT 0, -- 1 = theo dõi realtime (whitelist push)
      last_crawl INTEGER,
      fetched    INTEGER NOT NULL DEFAULT 0, -- tổng số video đã tải từ channel này
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gv_downloaded (
      video_id      TEXT PRIMARY KEY,     -- YouTube video id → chống trùng
      channel_id    TEXT,
      title         TEXT NOT NULL DEFAULT '',
      downloaded_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gv_settings (
      id           INTEGER PRIMARY KEY CHECK (id = 1),
      pending_dir  TEXT NOT NULL DEFAULT '',
      backfill_mode TEXT NOT NULL DEFAULT 'count', -- 'hours' | 'count'
      backfill_hours INTEGER NOT NULL DEFAULT 24,
      backfill_count INTEGER NOT NULL DEFAULT 20,
      max_duration INTEGER NOT NULL DEFAULT 60,     -- giây, chỉ lấy short
      name_by_title INTEGER NOT NULL DEFAULT 1,
      concurrency  INTEGER NOT NULL DEFAULT 3,
      ws_port      INTEGER NOT NULL DEFAULT 17653
    );
    INSERT OR IGNORE INTO gv_settings (id) VALUES (1);
  `)

  // Incremental migrations for DBs created before a column existed.
  addColumn(d, 'profiles', 'home_url', `TEXT NOT NULL DEFAULT ''`)
  addColumn(d, 'profiles', 'tiktok_username', `TEXT NOT NULL DEFAULT ''`)
  addColumn(d, 'profiles', 'tiktok_password', `TEXT NOT NULL DEFAULT ''`)
  addColumn(d, 'profiles', 'tiktok_2fa', `TEXT NOT NULL DEFAULT ''`)
  addColumn(d, 'profiles', 'logged_in', `INTEGER NOT NULL DEFAULT 0`)
  addColumn(d, 'profiles', 'proxy_id', `TEXT`)
  addColumn(d, 'proxies', 'ip', `TEXT`)
  addColumn(d, 'gv_settings', 'cookie_browser', `TEXT NOT NULL DEFAULT ''`)
  addColumn(d, 'schedules', 'date', `TEXT NOT NULL DEFAULT ''`)
  addColumn(d, 'schedules', 'weekdays', `TEXT NOT NULL DEFAULT '[]'`)
  // Lịch cũ repeat='daily' → 'weekly' với đủ 7 thứ (giữ nguyên hành vi hàng ngày).
  d.exec(`UPDATE schedules SET repeat='weekly', weekdays='[0,1,2,3,4,5,6]' WHERE repeat='daily'`)

  // Profile cũ có hardwareConcurrency thấp (2/4) → upload TikTok chậm vì ít
  // Web Worker. Nâng lên 12. Idempotent (lần sau không còn bản ghi < 8).
  d.exec(`
    UPDATE profiles
    SET fingerprint = json_set(fingerprint, '$.hardwareConcurrency', 12)
    WHERE CAST(json_extract(fingerprint, '$.hardwareConcurrency') AS INTEGER) < 8
  `)
}

/** Add a column if it doesn't already exist (idempotent). */
function addColumn(d: Database.Database, table: string, column: string, def: string): void {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some((c) => c.name === column)) {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`)
  }
}
