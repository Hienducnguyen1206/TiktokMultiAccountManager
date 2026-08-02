// Chay bang: node scripts/verify/02-shardengine.mjs
// Import truc tiep file TS da build khong kha thi -> ta test lai logic bang SDK tho,
// va doi chieu ket qua voi ShardEngine khi chay app that.
import { ShardX } from '@proxyshard/shardx'

const sdk = new ShardX({ cacheDir: './.spike-cache' })

const devices = await sdk.listProfiles({ platform: 'windows' })
console.log('so thiet bi windows:', devices.length)
if (devices.length === 0) throw new Error('FAIL: thu vien rong')

const p1 = await sdk.createProfile(undefined, { platform: 'windows' })
const p2 = await sdk.createProfile(undefined, { platform: 'windows' })
console.log('p1:', p1.id, '| p2:', p2.id)
if (p1.id === p2.id) throw new Error('FAIL: hai profile trung id')

const gpu1 = JSON.stringify(p1.config.webgl)
const gpu2 = JSON.stringify(p2.config.webgl)
console.log('gpu1:', gpu1)
console.log('gpu2:', gpu2)
if (gpu1 === gpu2) console.warn('CANH BAO: hai profile trung GPU — chay lai vai lan de xac nhan')

const saved = sdk.listSavedProfiles()
if (!saved.includes(p1.id)) throw new Error('FAIL: createProfile khong luu xuong dia')

sdk.deleteProfile(p1.id)
sdk.deleteProfile(p2.id)
if (sdk.listSavedProfiles().includes(p1.id)) throw new Error('FAIL: deleteProfile khong xoa')

console.log('PASS')
