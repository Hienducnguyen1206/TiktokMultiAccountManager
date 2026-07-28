import http from 'http'
import type { MachineIp, ProxyConfig, ProxyCheckResult } from '@shared/types'

// ip-api.com returns { query, country, countryCode } over plain HTTP (free tier).
const IP_API = 'http://ip-api.com/json/?fields=status,country,countryCode,query'

function getJson(agent?: http.Agent): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.get(IP_API, { agent, timeout: 10000 }, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch (e) {
          reject(e)
        }
      })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

export async function getMachineIp(): Promise<MachineIp> {
  try {
    const j = await getJson()
    return { ip: j.query, country: j.country, countryCode: String(j.countryCode || '').toLowerCase() }
  } catch {
    return { ip: 'unknown', country: 'Unknown', countryCode: '' }
  }
}

async function buildAgent(proxy: ProxyConfig): Promise<http.Agent> {
  const auth = proxy.username ? `${proxy.username}:${proxy.password}@` : ''
  if (proxy.type === 'socks5') {
    const { SocksProxyAgent } = await import('socks-proxy-agent')
    return new SocksProxyAgent(`socks5://${auth}${proxy.host}:${proxy.port}`)
  }
  const { HttpsProxyAgent } = await import('https-proxy-agent')
  return new HttpsProxyAgent(`http://${auth}${proxy.host}:${proxy.port}`)
}

export async function checkProxy(proxy: ProxyConfig): Promise<ProxyCheckResult> {
  if (!proxy.host || !proxy.port) {
    return { alive: false, ip: null, country: null, countryCode: null, pingMs: null, error: 'thiếu host/port' }
  }
  const start = Date.now()
  try {
    const j = await getJson(await buildAgent(proxy))
    return {
      alive: j.status === 'success',
      ip: j.query ?? null,
      country: j.country ?? null,
      countryCode: j.countryCode ? String(j.countryCode).toLowerCase() : null,
      pingMs: Date.now() - start
    }
  } catch (e: any) {
    return { alive: false, ip: null, country: null, countryCode: null, pingMs: null, error: e?.message ?? 'lỗi' }
  }
}
