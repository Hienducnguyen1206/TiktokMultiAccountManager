// Chay bang: node scripts/verify/04-launch-guard.mjs
//
// Kiem chung GIAN TIEP 2 finding Important tu review Task 4 tren
// src/main/services/ShardEngine.ts. Khong import truc tiep duoc file that (ly
// do giong het scripts/verify/02b-race.mjs: dataRoot() cua ShardEngine.ts phu
// thuoc app.getPath() cua Electron, khong chay duoc bang `node` thuong ngoai
// Electron main process). Thay vao do mo phong dung 2 pattern da sua bang ham
// gia lap co do tre bat dong bo, giong cach 02b-race.mjs da lam cho
// ensureRuntime().
//
// Finding 1 (openAutomation): puppeteer.connect() truoc day khong co
// try/catch - neu no reject (WS handshake loi, timeout) thi tien trinh
// Chromium van con song (dang o ngoai man hinh vi --window-position, nguoi
// dung khong thay de tu dong), entry trong `sessions` khong bi xoa,
// isRunning() bao true vinh vien.
//
// Finding 2 (openBrowsing/openAutomation): `sessions.has(id)` truoc day kiem
// dong bo o dau ham, nhung `sessions.set()` chi xay ra sau nhieu await ben
// trong launch() (getSdk(), ensureShardId(), s.launch() - cho toi 15s khi
// cdp:true). Hai loi goi gan nhau deu lot qua check, cung mo 2 tien trinh cho
// cung 1 profile.
//
// Moi phan (A, B) co 2 khoi: pattern MOI (ky vong PASS) va sanity-check tai
// hien pattern CU truoc khi sua (ky vong lo dung bug that, chung minh bai test
// o tren THAT SU phan biet duoc dung/sai, khong phai luon-luon-PASS).

let failures = 0
function check(name, cond) {
  if (cond) {
    console.log(`  PASS: ${name}`)
  } else {
    failures++
    console.log(`  FAIL: ${name}`)
  }
}

// ---------------------------------------------------------------------------
// [A] Finding 2 - pattern MOI: sessions + launching, check dong bo truoc await
// ---------------------------------------------------------------------------
console.log('[A] Pattern MOI (sessions + launching)...')
{
  const sessions = new Map()
  const launching = new Set()
  let bodyEnteredCount = 0

  function isRunning(id) {
    return sessions.has(id) || launching.has(id)
  }

  async function launch(id) {
    if (sessions.has(id) || launching.has(id)) {
      throw new Error('Profile dang mo')
    }
    launching.add(id)
    try {
      bodyEnteredCount++
      // Mo phong chuoi await that trong launch() that: getSdk(),
      // ensureShardId(), s.launch() (co the cho readCdpEndpoint toi 15s).
      await new Promise((r) => setTimeout(r, 30))
      sessions.set(id, { id })
      return sessions.get(id)
    } finally {
      launching.delete(id)
    }
  }

  const results = await Promise.allSettled([launch('p1'), launch('p1')])
  const fulfilled = results.filter((r) => r.status === 'fulfilled').length
  const rejected = results.filter((r) => r.status === 'rejected').length

  check('dung 1 trong 2 loi goi dong thoi vao duoc than ham', bodyEnteredCount === 1)
  check('dung 1 fulfilled + 1 rejected', fulfilled === 1 && rejected === 1)
  check(
    'sau khi xong: sessions co profile, launching rong (khong bi ket)',
    sessions.has('p1') && !launching.has('p1')
  )
  check('isRunning() dung ca hai tap hop', isRunning('p1') === true)
}

// ---------------------------------------------------------------------------
// [A2] Sanity check - tai hien pattern CU (chi sessions.has(), KHONG co
// launching) de chung minh bai test [A] that su phan biet duoc dung/sai
// ---------------------------------------------------------------------------
console.log('[A2] Sanity check: pattern CU (chi sessions.has(), khong co launching)...')
{
  const sessions = new Map()
  let bodyEnteredCount = 0

  async function launchOld(id) {
    if (sessions.has(id)) throw new Error('Profile dang mo')
    bodyEnteredCount++
    await new Promise((r) => setTimeout(r, 30))
    sessions.set(id, { id })
    return sessions.get(id)
  }

  const results = await Promise.allSettled([launchOld('p1'), launchOld('p1')])
  const fulfilled = results.filter((r) => r.status === 'fulfilled').length

  // Ky vong tren pattern CU: CA HAI loi goi deu lot qua check (bug that su).
  // Neu dong check nay khong dung, nghia la moi truong gia lap khong tai hien
  // dung bug, va ban than phep thu [A] khong chung minh duoc gi ca.
  check(
    'pattern CU: CA HAI loi goi dong thoi deu vao duoc than ham (bug that su ton tai)',
    bodyEnteredCount === 2 && fulfilled === 2
  )
}

// ---------------------------------------------------------------------------
// [B] Finding 1 - pattern MOI: try/catch quanh connect(), don dep khi that bai
// ---------------------------------------------------------------------------
console.log('[B] Pattern MOI (try/catch quanh connect())...')
{
  const sessions = new Map()
  let stopCallCount = 0
  const fakeSession = {
    cdpUrl: 'ws://fake',
    stop: async () => {
      stopCallCount++
    }
  }
  sessions.set('p2', fakeSession) // launch() da sessions.set() truoc do trong luong that

  const connectError = new Error('gia lap WS handshake that bai')
  async function fakeConnectAlwaysFails() {
    throw connectError
  }

  async function openAutomationNew(id, session) {
    if (!session.cdpUrl) {
      await session.stop()
      sessions.delete(id)
      throw new Error('ShardX khong tra ve CDP endpoint')
    }
    try {
      const browser = await fakeConnectAlwaysFails()
      return { browser, session }
    } catch (e) {
      await session.stop()
      sessions.delete(id)
      throw e
    }
  }

  let caught = null
  try {
    await openAutomationNew('p2', fakeSession)
  } catch (e) {
    caught = e
  }

  check('nem lai DUNG loi goc tu connect() (khong bi thay bang loi khac)', caught === connectError)
  check('session.stop() duoc goi dung 1 lan', stopCallCount === 1)
  check('entry bi xoa khoi sessions sau khi connect() that bai (khong con bi ket)', !sessions.has('p2'))
}

// ---------------------------------------------------------------------------
// [B2] Sanity check - tai hien pattern CU (KHONG co try/catch quanh
// connect()) de chung minh bai test [B] that su phan biet duoc dung/sai
// ---------------------------------------------------------------------------
console.log('[B2] Sanity check: pattern CU (khong co try/catch quanh connect())...')
{
  const sessions = new Map()
  let stopCallCount = 0
  const fakeSession = {
    cdpUrl: 'ws://fake',
    stop: async () => {
      stopCallCount++
    }
  }
  sessions.set('p2', fakeSession)

  async function fakeConnectAlwaysFails() {
    throw new Error('gia lap WS handshake that bai')
  }

  async function openAutomationOld(id, session) {
    if (!session.cdpUrl) {
      await session.stop()
      sessions.delete(id)
      throw new Error('ShardX khong tra ve CDP endpoint')
    }
    // KHONG co try/catch - dung nguyen ban truoc khi sua Finding 1.
    const browser = await fakeConnectAlwaysFails()
    return { browser, session }
  }

  let threw = false
  try {
    await openAutomationOld('p2', fakeSession)
  } catch {
    threw = true
  }

  // Ky vong tren pattern CU: loi van nem len tren goi (dung), NHUNG khong ai
  // goi stop() va sessions van con giu entry - day chinh la ro ri bug that.
  check(
    'pattern CU: bug that su ton tai - stop() KHONG duoc goi khi connect() loi',
    threw === true && stopCallCount === 0
  )
  check(
    'pattern CU: bug that su ton tai - entry VAN CON trong sessions (bi ket vinh vien)',
    sessions.has('p2') === true
  )
}

console.log('')
if (failures > 0) {
  console.log(`FAIL - ${failures} kiem tra khong dat.`)
  process.exit(1)
}
console.log(
  'PASS - pattern MOI (sessions+launching, try/catch quanh connect()) dung nhu ky vong;\n' +
    'sanity check xac nhan ca 2 bug that su ton tai tren pattern CU (truoc khi sua).'
)
