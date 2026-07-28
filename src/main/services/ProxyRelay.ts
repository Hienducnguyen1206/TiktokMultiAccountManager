import http from 'http'
import net from 'net'
import type { Profile, ProxyConfig } from '@shared/types'

// Chromium không nhận user/pass trong --proxy-server. Thay vì extension (MV3 kém
// tin cậy), ta chạy một HTTP proxy local KHÔNG auth; Chrome trỏ vào đây, relay
// tự thêm Proxy-Authorization khi forward lên proxy thật. Chỉ hỗ trợ upstream HTTP.

interface Relay {
  port: number
  server: http.Server
  key: string
}

const relays = new Map<string, Relay>() // profileId -> relay

function proxyKey(p: ProxyConfig): string {
  return `${p.type}:${p.host}:${p.port}:${p.username}:${p.password}`
}

function authHeader(p: ProxyConfig): string {
  return 'Basic ' + Buffer.from(`${p.username}:${p.password}`).toString('base64')
}

/** Đảm bảo có relay cho profile (nếu proxy HTTP có auth). Trả port hoặc null. */
export async function ensureRelay(profile: Profile): Promise<number | null> {
  const p = profile.proxy
  if (!p.useProxy || !p.host || !p.username) return null
  if (p.type === 'socks5') return null // relay chỉ cho upstream HTTP/HTTPS

  const key = proxyKey(p)
  const existing = relays.get(profile.id)
  if (existing && existing.key === key) return existing.port
  if (existing) {
    try { existing.server.close() } catch { /* ignore */ }
    relays.delete(profile.id)
  }

  const upHost = p.host
  const upPort = Number(p.port)
  const auth = authHeader(p)

  const server = http.createServer((req, res) => {
    // Request HTTP thường → forward tới upstream proxy kèm auth
    const opts: http.RequestOptions = {
      host: upHost,
      port: upPort,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, 'Proxy-Authorization': auth }
    }
    const upReq = http.request(opts, (upRes) => {
      res.writeHead(upRes.statusCode || 502, upRes.headers)
      upRes.pipe(res)
    })
    upReq.on('error', () => {
      if (!res.headersSent) res.writeHead(502)
      res.end()
    })
    req.pipe(upReq)
  })

  // HTTPS đi qua CONNECT tunnel
  server.on('connect', (req, clientSocket, head) => {
    const upstream = net.connect(upPort, upHost, () => {
      upstream.write(
        `CONNECT ${req.url} HTTP/1.1\r\nHost: ${req.url}\r\nProxy-Authorization: ${auth}\r\n\r\n`
      )
    })
    let established = false
    upstream.once('data', (chunk) => {
      const statusLine = chunk.toString('latin1').split('\r\n')[0]
      if (/\s200\s/.test(statusLine) || statusLine.includes('200')) {
        established = true
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head && head.length) upstream.write(head)
        upstream.pipe(clientSocket)
        clientSocket.pipe(upstream)
      } else {
        try { clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n') } catch { /* ignore */ }
        upstream.end()
      }
    })
    upstream.on('error', () => {
      if (!established) { try { clientSocket.end() } catch { /* ignore */ } }
    })
    clientSocket.on('error', () => {
      try { upstream.end() } catch { /* ignore */ }
    })
  })

  server.on('clientError', (_e, sock) => {
    try { sock.end() } catch { /* ignore */ }
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as net.AddressInfo).port
  relays.set(profile.id, { port, server, key })
  return port
}

export function getRelayPort(profileId: string): number | null {
  return relays.get(profileId)?.port ?? null
}

export function stopRelay(profileId: string): void {
  const r = relays.get(profileId)
  if (r) {
    try { r.server.close() } catch { /* ignore */ }
    relays.delete(profileId)
  }
}
