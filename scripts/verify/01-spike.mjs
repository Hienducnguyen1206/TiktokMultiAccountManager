import { ShardX } from '@proxyshard/shardx'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const PROXY = process.env.SHARDX_PROXY || null   // vd: socks5://user:pass@host:1080
const OLD_UDD = process.env.OLD_USER_DATA_DIR || null

// Log only every 10% instead of every tick — a raw \r-redraw becomes
// thousands of lines when captured non-interactively (e.g. in a CI log).
const lastBucketByLabel = new Map()

// cacheDir MUST be absolute: the SDK does not resolve() it, and a relative
// path makes chrome.exe and the SDK disagree on where user-data-dir lives,
// which makes readCdpEndpoint() time out and return null.
const sdk = new ShardX({
  cacheDir: resolve('./.spike-cache'),
  progress: (label, got, total) => {
    if (!total) return
    const bucket = Math.floor((got / total) * 10) * 10
    if (lastBucketByLabel.get(label) !== bucket) {
      lastBucketByLabel.set(label, bucket)
      console.log(`${label}: ${bucket}%`)
    }
  }
})

console.log('\n[1] Tao profile tu thu vien...')
const profile = await sdk.createProfile(undefined, { platform: 'windows' })
console.log('    id =', profile.id)
console.log('    platform =', profile.platform, '| hasWebGPU =', profile.hasWebGPU)

console.log('[2] Launch voi cdp + extraArgs...')
const session = await sdk.launch(profile, {
  proxy: PROXY ?? undefined,
  cdp: true,
  screenMode: 'profile',
  webrtc: 'auto',
  userDataDir: OLD_UDD ?? undefined,
  extraArgs: [
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=CalculateNativeWinOcclusion',
    '--window-position=-32000,-32000'
  ]
})

console.log('    cdpUrl      =', session.cdpUrl)
console.log('    userDataDir =', session.userDataDir)
console.log('    quicEnabled =', session.quicEnabled, '| proxyUdpMs =', session.proxyUdpMs)
console.log('    webrtcMode  =', session.webrtcMode)
console.log('    geo         =', session.geo ? `${session.geo.countryCode} ${session.geo.timezone}` : null)
console.log('    pid         =', session.pid, '| co ChildProcess =', !!session.process?.kill)

console.log('[3] Kiem tra cookie cu con khong...')
if (OLD_UDD) {
  console.log('    Cookies file ton tai =', existsSync(`${OLD_UDD}/Default/Network/Cookies`))
  console.log('    => Mo tay trinh duyet, vao tiktok.com xem con dang nhap khong.')
}

console.log('\nDe cua so mo 30s de ban kiem tra. Ctrl+C de dung som.')
await new Promise((r) => setTimeout(r, 30000))
await session.stop()
console.log('[4] Da dung.')
