// Chay bang: node scripts/verify/02b-race.mjs
//
// Kiem chung GIAN TIEP: khong import duoc src/main/services/ShardEngine.ts
// truc tiep (la TypeScript, va dataRoot() cua no phu thuoc app.getPath() cua
// Electron - khong chay duoc bang `node` thuong, ngoai Electron main process).
// Thay vao do, script nay tai hien dung pattern memo hoa moi trong
// ensureRuntime()/initRuntime() bang mot ham gia lap co do tre bat dong bo
// (giong await sdk.runtime.install()), roi goi dong thoi qua Promise.all de
// chung minh ham khoi tao chi thuc su chay 1 lan du co N lenh goi chong cheo.

let initCallCount = 0

async function initRuntime() {
  initCallCount++
  // Mo phong cong viec bat dong bo that (vd sdk.runtime.install() tai/giai nen
  // dia). Delay du lon de cac loi goi Promise.all chac chan chong lan nhau.
  await new Promise((r) => setTimeout(r, 50))
}

let initPromise = null

function ensureRuntime() {
  if (!initPromise) {
    initPromise = initRuntime().catch((e) => {
      // Cho phep retry khi install that bai, khong cache lai rejection.
      initPromise = null
      throw e
    })
  }
  return initPromise
}

console.log('[1] Goi dong thoi 5 lan ensureRuntime() qua Promise.all...')
await Promise.all([
  ensureRuntime(),
  ensureRuntime(),
  ensureRuntime(),
  ensureRuntime(),
  ensureRuntime()
])
console.log('    initCallCount sau 5 loi goi dong thoi =', initCallCount)
if (initCallCount !== 1) {
  throw new Error(`FAIL: initRuntime chay ${initCallCount} lan thay vi 1 — con race condition`)
}

console.log('[2] Goi them ensureRuntime() sau khi da resolve (tuan tu)...')
await ensureRuntime()
await ensureRuntime()
console.log('    initCallCount sau khi goi them =', initCallCount)
if (initCallCount !== 1) {
  throw new Error(`FAIL: initRuntime chay lai (${initCallCount} lan) sau khi da khoi tao xong`)
}

// Bonus (ngoai yeu cau toi thieu): xac nhan nhanh loi khong bi cache vinh vien —
// initPromise phai duoc reset ve null trong .catch() de lan goi sau duoc retry.
console.log('[3] (bonus) Kiem tra loi khong bi cache vinh vien...')
let failCount = 0
let failInitPromise = null
async function failingInit() {
  failCount++
  await new Promise((r) => setTimeout(r, 10))
  if (failCount === 1) throw new Error('loi gia lap lan 1')
}
function ensureRuntimeFailing() {
  if (!failInitPromise) {
    failInitPromise = failingInit().catch((e) => {
      failInitPromise = null
      throw e
    })
  }
  return failInitPromise
}
let firstThrew = false
try {
  await ensureRuntimeFailing()
} catch {
  firstThrew = true
}
if (!firstThrew) throw new Error('FAIL: lan goi dau (gia lap loi) le ra phai throw')
await ensureRuntimeFailing() // lan 2: khong throw vi failCount kiem tra !== 1
console.log('    failCount sau retry =', failCount, '(ky vong 2 — lan dau that bai duoc retry, khong bi cache)')
if (failCount !== 2) throw new Error(`FAIL: retry-sau-loi khong hoat dong dung (failCount=${failCount})`)

console.log('\nPASS — initRuntime() chi chay dung 1 lan du goi dong thoi 5 lan; loi khong bi cache vinh vien.')
