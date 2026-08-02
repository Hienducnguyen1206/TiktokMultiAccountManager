// Run with: node scripts/verify/09-proxy-probe.mjs
//
// INDIRECT verification for Task 9 (docs: .superpowers/sdd/2026-08-02-shardx-
// engine-integration/task-9-brief.md) of:
//  - src/main/services/ProxyStore.ts: saveProbe() + rowToProxy()'s handling of
//    the 5 columns Task 3 added to `proxies` (timezone/latitude/longitude/
//    udp_ms/quic_ok).
//  - src/main/services/ShardEngine.ts: the `if (profile.proxyId && session.geo)`
//    guard inside launch() that decides whether saveProbe() gets called at all.
//
// Cannot import the real .ts files directly: ProxyStore.ts's getDb() comes
// from src/main/db.ts, which calls Electron's app.getPath('userData') — that
// throws under plain `node` outside the Electron main process (same
// constraint noted in every other script in this folder, e.g. 02b-race.mjs,
// 04-launch-guard.mjs, 07-finally-scoped-cleanup.mjs).
//
// Part 1 runs against a REAL sqlite database (better-sqlite3 — the exact
// package the app ships) in a TEMP FILE under the OS tmpdir, created and
// deleted by this script. It NEVER touches the app's real userData database
// (which currently holds 109 real profiles per task-3-report.md). The schema
// (CREATE TABLE + addColumn migrations) and the SQL text run against it are
// copied VERBATIM from src/main/db.ts and src/main/services/ProxyStore.ts —
// this exercises the actual SQL strings that ship, not a paraphrase of them.
//
// Part 2 re-checks the launch() guard as a pure boolean truth table (the `if`
// condition copied verbatim) since it needs no I/O.
//
// Part 3 (Fix round 1 — review finding, Important) reproduces the exact tail
// of launch() (guard + try/catch around ProxyStore.saveProbe() + `return
// session`) as a standalone async function, verbatim from ShardEngine.ts, and
// asserts that a throwing saveProbe() no longer makes launch() reject. Same
// import constraint as above, so this is a reproduction, not a direct import.

import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let failures = 0
function check(name, cond) {
  if (cond) {
    console.log(`  PASS: ${name}`)
  } else {
    failures++
    console.log(`  FAIL: ${name}`)
  }
}

// ===========================================================================
// Part 1 — real sqlite DB, verbatim SQL from the shipped code
// ===========================================================================

const tmpDir = mkdtempSync(join(tmpdir(), 'proxy-probe-verify-'))
const dbPath = join(tmpDir, 'test.db')
console.log(`[setup] temp sqlite db at ${dbPath}`)
console.log('        (deleted at the end of this script — NOT the app\'s real userData db)')
const db = new Database(dbPath)

// Verbatim from src/main/db.ts's migrate(): CREATE TABLE proxies (pre-Task-3
// columns only — timezone/latitude/longitude/udp_ms/quic_ok are added below
// via addColumn(), exactly like the real migration path for existing DBs).
db.exec(`
  CREATE TABLE IF NOT EXISTS proxies (
    id           TEXT PRIMARY KEY,
    type         TEXT NOT NULL DEFAULT 'http',
    host         TEXT NOT NULL,
    port         TEXT NOT NULL,
    username     TEXT NOT NULL DEFAULT '',
    password     TEXT NOT NULL DEFAULT '',
    alive        INTEGER,
    ip           TEXT,
    country      TEXT,
    country_code TEXT,
    ping         INTEGER,
    checked_at   INTEGER,
    created_at   INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS profiles (
    id       TEXT PRIMARY KEY,
    proxy_id TEXT
  );
`)

// Verbatim from src/main/db.ts's addColumn().
function addColumn(d, table, column, def) {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all()
  if (!cols.some((c) => c.name === column)) {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`)
  }
}
// Verbatim from src/main/db.ts's migrate() — the 5 Task-3 lines relevant here.
addColumn(db, 'proxies', 'timezone', `TEXT`)
addColumn(db, 'proxies', 'latitude', `REAL`)
addColumn(db, 'proxies', 'longitude', `REAL`)
addColumn(db, 'proxies', 'udp_ms', `INTEGER`)
addColumn(db, 'proxies', 'quic_ok', `INTEGER`)

// Verbatim from src/main/services/ProxyStore.ts's saveProbe().
function saveProbe(id, d) {
  db.prepare('UPDATE proxies SET timezone = ?, latitude = ?, longitude = ?, udp_ms = ?, quic_ok = ? WHERE id = ?')
    .run(d.timezone, d.latitude, d.longitude, d.udpMs, d.quicOk ? 1 : 0, id)
}

// Verbatim from src/main/services/ProxyStore.ts's rowToProxy().
function rowToProxy(r) {
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

// Verbatim from src/main/services/ProxyStore.ts's list().
function list() {
  const rows = db.prepare(`
        SELECT p.*, (SELECT COUNT(*) FROM profiles pr WHERE pr.proxy_id = p.id) AS used_by
        FROM proxies p
        ORDER BY p.created_at DESC
      `).all()
  return rows.map(rowToProxy)
}

function getById(id) {
  return list().find((p) => p.id === id)
}

// --- Seed 2 proxies, A and B, both never probed yet ---
db.prepare('INSERT INTO proxies (id, type, host, port, username, password, created_at) VALUES (?,?,?,?,?,?,?)')
  .run('A', 'http', '1.2.3.4', '8080', '', '', 1000)
db.prepare('INSERT INTO proxies (id, type, host, port, username, password, created_at) VALUES (?,?,?,?,?,?,?)')
  .run('B', 'socks5', '5.6.7.8', '1080', '', '', 2000)

console.log('\n[1] Fresh rows (never launched through) read back as null, via the real SELECT p.* ...')
{
  const a = getById('A')
  const b = getById('B')
  check('proxy A: udpMs === null before any probe', a.udpMs === null)
  check('proxy A: quicOk === null before any probe', a.quicOk === null)
  check('proxy B: udpMs === null before any probe', b.udpMs === null)
  check('proxy B: quicOk === null before any probe', b.quicOk === null)
}

console.log('\n[2] saveProbe(A, quicOk:true) writes A only, B stays untouched...')
{
  saveProbe('A', { timezone: 'Asia/Ho_Chi_Minh', latitude: 10.78, longitude: 106.70, udpMs: 42, quicOk: true })
  // timezone/latitude/longitude are written by saveProbe() but — matching the
  // brief exactly ("Thêm udpMs và quicOk vào kiểu proxy trong types.ts") —
  // rowToProxy()/the Proxy type deliberately do NOT surface them (Step 4's UI
  // only ever displays udpMs/quicOk). So the write is checked against the raw
  // DB row directly here, not through rowToProxy()/getById().
  const rawA = db.prepare('SELECT timezone, latitude, longitude FROM proxies WHERE id = ?').get('A')
  const a = getById('A')
  const b = getById('B')
  check('A.timezone === Asia/Ho_Chi_Minh (raw column, written but not surfaced on Proxy)', rawA.timezone === 'Asia/Ho_Chi_Minh')
  check('A.latitude === 10.78 (raw column)', rawA.latitude === 10.78)
  check('A.longitude === 106.70 (raw column)', rawA.longitude === 106.70)
  check('A.udpMs === 42 (surfaced on Proxy, per brief)', a.udpMs === 42)
  check('A.quicOk === true (surfaced on Proxy, strict boolean, not 1)', a.quicOk === true)
  check('B.udpMs still null (not clobbered by A\'s write)', b.udpMs === null)
  check('B.quicOk still null (not clobbered by A\'s write)', b.quicOk === null)
}

console.log('\n[3] saveProbe(B, quicOk:false) — TCP fallback must read back as false, not null/0...')
{
  saveProbe('B', { timezone: null, latitude: null, longitude: null, udpMs: 15, quicOk: false })
  const b = getById('B')
  const a = getById('A')
  check('B.udpMs === 15', b.udpMs === 15)
  check('B.quicOk === false (strict boolean false, NOT null and NOT falsy-but-wrong-type)', b.quicOk === false)
  check('B.quicOk !== null (must be distinguishable from "never probed")', b.quicOk !== null)
  check('A untouched by B\'s write (A.udpMs still 42)', a.udpMs === 42)
  check('A untouched by B\'s write (A.quicOk still true)', a.quicOk === true)
}

console.log('\n[4] saveProbe() must not disturb the columns owned by check()/Network.ts (ip-api.com flow)...')
{
  // Simulate proxy A having already been probed via the "Check" button before
  // ShardEngine ever launched a profile through it.
  db.prepare('UPDATE proxies SET alive = 1, ip = ?, country = ?, country_code = ?, ping = ?, checked_at = ? WHERE id = ?')
    .run('9.9.9.9', 'Vietnam', 'vn', 123, 5000, 'A')
  const before = getById('A')
  saveProbe('A', { timezone: 'Europe/London', latitude: 51.5, longitude: -0.1, udpMs: 77, quicOk: false })
  const after = getById('A')
  check('alive unchanged by saveProbe()', after.alive === before.alive && after.alive === true)
  check('ip unchanged by saveProbe()', after.ip === before.ip && after.ip === '9.9.9.9')
  check('country unchanged by saveProbe()', after.country === before.country && after.country === 'Vietnam')
  check('countryCode unchanged by saveProbe()', after.countryCode === before.countryCode && after.countryCode === 'vn')
  check('ping unchanged by saveProbe()', after.ping === before.ping && after.ping === 123)
  check('checkedAt unchanged by saveProbe()', after.checkedAt === before.checkedAt && after.checkedAt === 5000)
  check('saveProbe still updated its own columns (udpMs=77)', after.udpMs === 77)
  check('saveProbe still updated its own columns (quicOk=false)', after.quicOk === false)
}

console.log('\n[5] Sanity check: a saveProbe() WITHOUT "WHERE id = ?" would clobber every row...')
{
  // Proves the WHERE clause in the real code is load-bearing, and that this
  // test suite would catch its accidental removal (e.g. a copy-paste slip).
  function buggySaveProbeNoWhere(_id, d) {
    db.prepare('UPDATE proxies SET timezone = ?, latitude = ?, longitude = ?, udp_ms = ?, quic_ok = ?')
      .run(d.timezone, d.latitude, d.longitude, d.udpMs, d.quicOk ? 1 : 0)
  }
  buggySaveProbeNoWhere('A', { timezone: 'X', latitude: 1, longitude: 1, udpMs: 999, quicOk: true })
  const a = getById('A')
  const b = getById('B')
  check('BUG REPRODUCED: buggy no-WHERE write clobbered A', a.udpMs === 999)
  check('BUG REPRODUCED: buggy no-WHERE write ALSO clobbered B (proves WHERE id=? matters)', b.udpMs === 999)
}

db.close()
rmSync(tmpDir, { recursive: true, force: true })
console.log(`\n[cleanup] removed ${tmpDir}`)

// ===========================================================================
// Part 2 — ShardEngine.launch()'s write guard, as a pure boolean truth table.
// Verbatim condition: `if (profile.proxyId && session.geo) { ProxyStore.saveProbe(...) }`
// ===========================================================================

console.log('\n[6] launch() guard: only writes when proxyId is set AND geo was measured...')
function shouldSaveProbe(profile, session) {
  return Boolean(profile.proxyId && session.geo)
}
{
  const cases = [
    { label: 'proxyId=null,  geo=null  (no proxy, probe also failed/skipped)', profile: { proxyId: null }, session: { geo: null }, expect: false },
    { label: 'proxyId="P1", geo=null  (has proxy, but this launch could not measure geo)', profile: { proxyId: 'P1' }, session: { geo: null }, expect: false },
    { label: 'proxyId=null,  geo={...} (MACHINE IP profile — must NOT write, no proxy row to target)', profile: { proxyId: null }, session: { geo: { timezone: 'UTC' } }, expect: false },
    { label: 'proxyId="P1", geo={...} (real proxy + real measurement — must write)', profile: { proxyId: 'P1' }, session: { geo: { timezone: 'UTC' } }, expect: true }
  ]
  for (const c of cases) {
    check(c.label, shouldSaveProbe(c.profile, c.session) === c.expect)
  }
}

console.log('\n[7] Sanity check: a guard that forgets proxyId (only checks session.geo) would wrongly write for machine-IP profiles...')
{
  function buggyShouldSaveProbe(_profile, session) {
    return Boolean(session.geo)
  }
  const machineIpProfile = { proxyId: null }
  const measuredSession = { session: { geo: { timezone: 'UTC' } } }
  const wronglyWrites = buggyShouldSaveProbe(machineIpProfile, measuredSession.session)
  check('BUG REPRODUCED: buggy guard (missing proxyId check) wrongly decides to write for a machine-IP profile', wronglyWrites === true)
}

// ===========================================================================
// Part 3 — Fix round 1 (review finding, Important): a throwing saveProbe()
// must not make launch() reject. Verbatim reproduction of ShardEngine.ts's
// launch() tail (fixed version has try/catch around the saveProbe() call;
// pre-fix version — what Task 9 originally shipped — does not).
// ===========================================================================

// Fixed pattern — matches the real (post-fix) launch() tail exactly.
async function fixedLaunchTail(profile, session, saveProbeFn) {
  if (profile.proxyId && session.geo) {
    try {
      saveProbeFn(profile.proxyId, {
        timezone: session.geo.timezone ?? null,
        latitude: session.geo.latitude ?? null,
        longitude: session.geo.longitude ?? null,
        udpMs: session.proxyUdpMs ?? null,
        quicOk: Boolean(session.quicEnabled)
      })
    } catch (e) {
      console.error(`[ShardEngine] saveProbe failed for profile ${profile.id}:`, e)
    }
  }
  return session
}

// Pre-fix pattern — the exact tail Task 9 originally shipped, before this
// review finding (no try/catch around the saveProbe() call).
async function unfixedLaunchTail(profile, session, saveProbeFn) {
  if (profile.proxyId && session.geo) {
    saveProbeFn(profile.proxyId, {
      timezone: session.geo.timezone ?? null,
      latitude: session.geo.latitude ?? null,
      longitude: session.geo.longitude ?? null,
      udpMs: session.proxyUdpMs ?? null,
      quicOk: Boolean(session.quicEnabled)
    })
  }
  return session
}

console.log('\n[8] Fix round 1: saveProbe() throwing must NOT make launch() reject (fixed pattern)...')
{
  const profile = { id: 'prof-1', proxyId: 'P1' }
  const session = { geo: { timezone: 'UTC', latitude: 1, longitude: 1 }, proxyUdpMs: 10, quicEnabled: true }
  let callCount = 0
  const throwingSaveProbe = () => {
    callCount++
    throw new Error('SQLITE_BUSY: database is locked')
  }

  const loggedCalls = []
  const origConsoleError = console.error
  console.error = (...args) => loggedCalls.push(args)
  let result
  let threw = false
  try {
    result = await fixedLaunchTail(profile, session, throwingSaveProbe)
  } catch {
    threw = true
  } finally {
    console.error = origConsoleError
  }

  check('fixed pattern: saveProbe() was actually attempted (not skipped)', callCount === 1)
  check('fixed pattern: launch() tail does NOT throw/reject when saveProbe() throws', threw === false)
  check('fixed pattern: session is still returned normally', result === session)
  check('fixed pattern: the swallowed error was still logged via console.error (not silently dropped)', loggedCalls.length === 1 && loggedCalls[0][0].includes('prof-1'))
}

console.log('\n[9] Sanity check: WITHOUT the try/catch, the same throwing saveProbe() DOES reject launch()...')
{
  const profile = { id: 'prof-1', proxyId: 'P1' }
  const session = { geo: { timezone: 'UTC', latitude: 1, longitude: 1 }, proxyUdpMs: 10, quicEnabled: true }
  const throwingSaveProbe = () => {
    throw new Error('SQLITE_BUSY: database is locked')
  }
  let threw = false
  try {
    await unfixedLaunchTail(profile, session, throwingSaveProbe)
  } catch {
    threw = true
  }
  check('BUG REPRODUCED: pre-fix pattern (no try/catch) rejects launch() when saveProbe() throws — proves the try/catch is load-bearing', threw === true)
}

console.log('')
if (failures > 0) {
  console.log(`FAIL - ${failures} check(s) did not pass.`)
  process.exit(1)
}
console.log(
  'PASS - saveProbe()/rowToProxy() write and read back timezone/latitude/longitude/udp_ms/quic_ok\n' +
    'correctly against a real sqlite db, target only the intended row, and never touch the columns\n' +
    "owned by check()/Network.ts; the launch() guard writes only when a real proxy is assigned AND\n" +
    'geo was actually measured, never for machine-IP profiles; a throwing saveProbe() no longer\n' +
    'makes launch() reject (Fix round 1) and the swallowed error is still logged; all three sanity\n' +
    'checks confirm the harness would catch a regression in the SQL WHERE clause, the guard\n' +
    'condition, or a missing try/catch around saveProbe().'
)
