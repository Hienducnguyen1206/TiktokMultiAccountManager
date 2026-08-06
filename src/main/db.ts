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
      avatar     TEXT NOT NULL DEFAULT '', -- URL ảnh đại diện kênh (yt-dlp lấy về)
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

    -- ===== Channel Search (tab Search Kênh) =====
    CREATE TABLE IF NOT EXISTS cs_candidates (
      id                TEXT PRIMARY KEY,
      yt_channel_id     TEXT NOT NULL UNIQUE,
      url               TEXT NOT NULL,
      name              TEXT NOT NULL DEFAULT '',
      handle            TEXT NOT NULL DEFAULT '',
      thumbnail         TEXT NOT NULL DEFAULT '',
      subs              INTEGER,
      video_count       INTEGER,
      avg_views         REAL,
      last_upload_at    INTEGER,
      uploads_per_week  REAL,
      country           TEXT,
      yt_created_at     INTEGER,
      like_view_pct     REAL,
      comment_view_pct  REAL,
      view_sub_ratio    REAL,
      momentum_pct      REAL,
      view_consistency  REAL,
      shorts_count      INTEGER,
      topics            TEXT,   -- JSON string[]
      audience_langs    TEXT,   -- JSON CsLangPct[]
      status            TEXT NOT NULL DEFAULT 'new',
      tiktok_checked_at INTEGER,
      created_at        INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cs_tiktok_matches (
      id           TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,  -- FK logic tới cs_candidates; xóa liên đới làm trong store (app không bật PRAGMA foreign_keys)
      username     TEXT NOT NULL,
      nickname     TEXT NOT NULL DEFAULT '',
      followers    INTEGER,
      video_count  INTEGER,
      avatar_url   TEXT NOT NULL DEFAULT '',
      fetched_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cs_matches_candidate ON cs_tiktok_matches(candidate_id);

    CREATE TABLE IF NOT EXISTS cs_settings (
      id               INTEGER PRIMARY KEY CHECK (id = 1),
      api_key          TEXT NOT NULL DEFAULT '',
      check_profile_id TEXT NOT NULL DEFAULT '',
      top_n            INTEGER NOT NULL DEFAULT 5
    );
    INSERT OR IGNORE INTO cs_settings (id) VALUES (1);

    -- Quota YouTube Data API v3 app đã tiêu, gom theo ngày. Google reset lúc 0h múi giờ
    -- Thái Bình Dương nên 'day' lưu theo America/Los_Angeles, không phải giờ máy.
    CREATE TABLE IF NOT EXISTS cs_quota (
      day   TEXT PRIMARY KEY,   -- 'YYYY-MM-DD' theo America/Los_Angeles
      units INTEGER NOT NULL DEFAULT 0
    );
  `)

  // Incremental migrations for DBs created before a column existed.
  addColumn(d, 'profiles', 'home_url', `TEXT NOT NULL DEFAULT ''`)
  addColumn(d, 'profiles', 'tiktok_username', `TEXT NOT NULL DEFAULT ''`)
  addColumn(d, 'profiles', 'tiktok_password', `TEXT NOT NULL DEFAULT ''`)
  addColumn(d, 'profiles', 'tiktok_2fa', `TEXT NOT NULL DEFAULT ''`)
  addColumn(d, 'profiles', 'logged_in', `INTEGER NOT NULL DEFAULT 0`)
  addColumn(d, 'profiles', 'proxy_id', `TEXT`)
  addColumn(d, 'profiles', 'shard_profile_id', `TEXT`)
  // Ảnh đại diện TikTok, lưu thẳng nội dung dạng data URL (base64) chứ không
  // lưu link: link CDN của TikTok có hạn dùng, lưu link thì ít hôm sau ảnh hỏng.
  // Đo thật trên tài khoản có sẵn: JPEG ~13KB, nên vài trăm profile vẫn vài MB.
  addColumn(d, 'profiles', 'avatar', `TEXT NOT NULL DEFAULT ''`)
  // Số dư và trạng thái kiếm tiền đọc từ /tiktokstudio/monetization lúc Đồng bộ.
  // Lưu NGUYÊN VĂN chuỗi TikTok hiển thị ("$0.00", "Không đủ điều kiện") chứ
  // không tách thành số + mã tiền tệ: đơn vị đổi theo tài khoản, nhãn trạng thái
  // đổi theo ngôn ngữ profile, và app chỉ hiển thị lại chứ không tính toán gì.
  addColumn(d, 'profiles', 'balance', `TEXT NOT NULL DEFAULT ''`)
  addColumn(d, 'profiles', 'monetization', `TEXT NOT NULL DEFAULT ''`)
  // 1/0 = đã/chưa kích hoạt Creator Rewards, NULL = chưa đọc được. Suy từ thuộc
  // tính data-disabled của nút trạng thái chứ không từ chữ trong nút — chữ bị
  // dịch theo ngôn ngữ tài khoản, thuộc tính thì không.
  addColumn(d, 'profiles', 'monetization_active', `INTEGER`)
  // Emoji đại diện nhóm, hiện cạnh tên trong cây thư mục ở tab Profile. Rỗng =
  // vẽ chấm tròn màu như trước.
  addColumn(d, 'groups', 'icon', `TEXT NOT NULL DEFAULT ''`)
  addColumn(d, 'proxies', 'timezone', `TEXT`)
  addColumn(d, 'proxies', 'latitude', `REAL`)
  addColumn(d, 'proxies', 'longitude', `REAL`)
  addColumn(d, 'proxies', 'udp_ms', `INTEGER`)
  addColumn(d, 'proxies', 'quic_ok', `INTEGER`)
  addColumn(d, 'proxies', 'ip', `TEXT`)
  addColumn(d, 'gv_settings', 'cookie_browser', `TEXT NOT NULL DEFAULT ''`)
  addColumn(d, 'gv_settings', 'cookie_profile_id', `TEXT NOT NULL DEFAULT ''`)
  addColumn(d, 'gv_channels', 'avatar', `TEXT NOT NULL DEFAULT ''`)
  addColumn(d, 'schedules', 'date', `TEXT NOT NULL DEFAULT ''`)
  addColumn(d, 'schedules', 'weekdays', `TEXT NOT NULL DEFAULT '[]'`)
  // Lịch cũ repeat='daily' → 'weekly' với đủ 7 thứ (giữ nguyên hành vi hàng ngày).
  d.exec(`UPDATE schedules SET repeat='weekly', weekdays='[0,1,2,3,4,5,6]' WHERE repeat='daily'`)

  // Lịch không có template HỢP LỆ thì không thể chạy (Scheduler.isDue bỏ qua) —
  // tắt cờ cho khớp. ScheduleStore.save()/create() nay tự giữ quy tắc này; dòng
  // đây xử lý những bản ghi lưu từ trước, vốn hiện "▶ Đang bật" mà không bao giờ
  // chạy.
  //
  // Vế thứ hai dọn id MỒ CÔI: xóa template trước đây không đụng tới schedule trỏ
  // vào nó, để lại một chuỗi id không còn tương ứng với bản ghi nào. Dropdown khi
  // đó hiện "— Chưa chọn —" trong khi cột DB vẫn có giá trị, nên mọi phép thử
  // kiểu `!templateId` đều lọt.
  d.exec(`
    UPDATE schedules SET template_id = NULL, enabled = 0
    WHERE template_id IS NULL OR template_id = ''
       OR template_id NOT IN (SELECT id FROM templates)
  `)

  // Dọn lịch sử follower của những profile đã bị xóa. Bảng analytics không có
  // khóa ngoại và ProfileStore.remove() trước đây không đụng tới nó, nên rác đã
  // tích lại: đo trên DB thật có 108 profile đã xóa vẫn còn bản ghi, và tab
  // Analytics dựng chúng thành 108 hàng mang tên "(đã xóa)". remove() nay dọn
  // ngay khi xóa; dòng này xử lý phần đã lỡ tích trước đó.
  d.exec(`DELETE FROM analytics WHERE profile_id NOT IN (SELECT id FROM profiles)`)

  // NOTE: the old `hardwareConcurrency >= 12` migration was deliberately
  // dropped when the engine moved to ShardX. Core count is now owned by the
  // SDK's per-profile randomizeHardware() roll, and forcing 12 back into the
  // stored fingerprint would both fight that roll and make every profile
  // report the same value — the exact cross-profile linkage the swap removes.

  // % Shorts đổi thành đếm thật (số lượng) thay vì tỉ lệ — bỏ cột cũ ở DB đã tồn tại.
  dropColumn(d, 'cs_candidates', 'shorts_pct')

  // Hạn mức quota chốt cứng 10000/ngày trong code, không cho chỉnh nữa.
  dropColumn(d, 'cs_settings', 'quota_limit')

  // Kho kênh tích lũy (cs_pool) bị gỡ ngay sau khi thêm — người dùng đổi hướng sang
  // phân trang + đa từ khóa. Bản đóng gói trung gian có thể đã tạo bảng → dọn.
  d.exec('DROP TABLE IF EXISTS cs_pool')
}

/** Add a column if it doesn't already exist (idempotent). */
function addColumn(d: Database.Database, table: string, column: string, def: string): void {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some((c) => c.name === column)) {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`)
  }
}

/** Drop a column if it still exists (idempotent). Requires SQLite 3.35+ (bundled by better-sqlite3). */
function dropColumn(d: Database.Database, table: string, column: string): void {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (cols.some((c) => c.name === column)) {
    d.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`)
  }
}
