/**
 * dsh-net-hosts — 本地代理连接表（Clash / mihomo）
 *
 * 开了系统代理之后，应用的套接字连的是 127.0.0.1:7897，lsof 只能看到这层壳，
 * 真正的域名（SNI / HTTP Host）只存在于代理进程里。Clash 系列（Clash Verge Rev、
 * ClashX、mihomo）都会在本地开一个 HTTP 控制接口，`GET /connections` 返回的
 * metadata 里同时有 host（域名）、destinationIP、destinationPort 和 sourcePort。
 *
 * sourcePort 正好是发起方（应用）那头的本地端口，可以和 lsof 的 local.port 对上，
 * 所以能把「127.0.0.1:51766 -> 127.0.0.1:7897」还原成「192.168.1.20:51766 ->
 * www.xueqiu.com:443」。
 *
 * 全部失败都静默降级：没有代理、没开控制接口、没权限，都不影响主流程。
 */

import http from 'node:http'
import net from 'node:net'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PROBE_TIMEOUT_MS = 400
const FETCH_TIMEOUT_MS = 900
const DISCOVERY_OK_MS = 60_000
const DISCOVERY_FAIL_MS = 8_000
const MAX_BODY_BYTES = 8 * 1024 * 1024

/** 常见控制器端口：Clash Verge Rev = 9097，ClashX / mihomo = 9090，其余是习惯用法。 */
export const DEFAULT_CONTROLLER_PORTS = [9097, 9090, 9091, 6170]

/**
 * Clash Verge Rev 的「服务模式」会用特权助手（root）跑 mihomo，控制接口走 unix socket：
 * `/var/run/clash-verge-service/users/<uid>/verge-mihomo.sock`，属主是当前用户。
 * 这条路径不依赖 external-controller 是否在 GUI 里打开，是最稳的入口。
 */
function serviceSocketCandidates() {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null
  const list = []
  if (uid != null) list.push(`/var/run/clash-verge-service/users/${uid}/verge-mihomo.sock`)
  list.push('/var/run/mihomo.sock', '/var/run/clash.sock')
  return list
}

const CONFIG_CANDIDATES = [
  ['Clash Verge Rev', 'Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/config.yaml'],
  ['Clash Verge Rev', 'Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/clash-verge.yaml'],
  ['ClashX', '.config/clash/config.yaml'],
  ['mihomo', '.config/mihomo/config.yaml'],
  ['ClashX Pro', 'Library/Application Support/ClashX/config.yaml'],
]

/** 从 YAML 文本里抠出几个扁平字段（不引 yaml 依赖，配置行格式很稳定）。 */
export function parseProxyConfig(text) {
  if (typeof text !== 'string' || text === '') return null
  const pick = (key) => {
    const match = new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, 'm').exec(text)
    if (!match) return ''
    return match[1].replace(/\s+#.*$/, '').replace(/^['"]|['"]$/g, '').trim()
  }
  const controller = pick('external-controller')
  const socket = pick('external-controller-unix')
  const secret = pick('secret')
  const ports = ['mixed-port', 'port', 'socks-port', 'redir-port', 'tproxy-port']
    .map((key) => Number(pick(key)))
    .filter((port) => Number.isInteger(port) && port > 0 && port < 65536)
  if (!controller && !socket) return null
  return { controller, socket, secret, ports: [...new Set(ports)] }
}

export function endpointFromController(value) {
  if (!value) return null
  const text = value.includes('://') ? value : `http://${value}`
  try {
    const url = new URL(text)
    if (url.protocol === 'unix:') {
      const socketPath = url.searchParams.get('socket') || url.pathname
      return socketPath ? { kind: 'unix', socketPath, label: `unix:${socketPath}` } : null
    }
    return {
      kind: 'http',
      host: url.hostname || '127.0.0.1',
      port: Number(url.port) || 80,
      label: `${url.hostname || '127.0.0.1'}:${Number(url.port) || 80}`,
    }
  } catch {
    return null
  }
}

function envOverrides() {
  const endpoints = []
  const url = process.env.DSH_NET_HOSTS_PROXY_URL
  if (url) {
    if (url.includes('/') && url.includes('://')) {
      const ep = endpointFromController(url)
      if (ep) endpoints.push(ep)
    } else {
      const ep = endpointFromController(`http://${url}`)
      if (ep) endpoints.push(ep)
    }
  }
  const socket = process.env.DSH_NET_HOSTS_PROXY_SOCKET
  if (socket) endpoints.push({ kind: 'unix', socketPath: socket, label: `unix:${socket}` })
  return { endpoints, secret: process.env.DSH_NET_HOSTS_PROXY_SECRET || '' }
}

function requestJson(endpoint, pathname, secret, timeoutMs) {
  return new Promise((resolve, reject) => {
    const headers = { accept: 'application/json' }
    if (secret) headers.authorization = `Bearer ${secret}`
    const options = endpoint.kind === 'unix'
      ? { socketPath: endpoint.socketPath, path: pathname, method: 'GET', headers, timeout: timeoutMs }
      : { host: endpoint.host, port: endpoint.port, path: pathname, method: 'GET', headers, timeout: timeoutMs }
    const req = http.request(options, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        body += chunk
        if (body.length > MAX_BODY_BYTES) req.destroy(new Error('response too large'))
      })
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }
        try {
          resolve(JSON.parse(body))
        } catch (err) {
          reject(err)
        }
      })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end()
  })
}

let discovery = { at: 0, value: null }

async function readConfigs() {
  const home = os.homedir()
  const found = []
  const seen = new Set()
  for (const [name, rel] of CONFIG_CANDIDATES) {
    const file = path.join(home, rel)
    let text
    try {
      text = await fs.readFile(file, 'utf8')
    } catch {
      continue
    }
    const parsed = parseProxyConfig(text)
    if (!parsed) continue
    const endpoints = []
    const controller = endpointFromController(parsed.controller)
    if (controller) endpoints.push(controller)
    if (parsed.socket) endpoints.push({ kind: 'unix', socketPath: parsed.socket, label: `unix:${parsed.socket}` })
    for (const endpoint of endpoints) {
      const key = endpoint.kind === 'unix' ? endpoint.socketPath : `${endpoint.host}:${endpoint.port}`
      if (seen.has(key)) continue
      seen.add(key)
      found.push({ name, endpoint, secret: parsed.secret, ports: parsed.ports })
    }
  }
  return found
}

async function probe(candidate) {
  try {
    const data = await requestJson(candidate.endpoint, '/version', candidate.secret, PROBE_TIMEOUT_MS)
    if (data && (data.version || data.meta !== undefined || data.premium !== undefined)) return true
  } catch {
    /* 控制接口没开是常态，静默跳过 */
  }
  return false
}

/**
 * 找出一个可用的控制器。配置里写死的地址优先，其次探测默认端口。
 * 结果缓存：成功 60s、失败 8s，避免每 2 秒轮询都去连一串没人监听的端口。
 */
export async function discoverProxy() {
  const now = Date.now()
  if (discovery.value && now - discovery.at < (discovery.value.length ? DISCOVERY_OK_MS : DISCOVERY_FAIL_MS)) {
    return discovery.value
  }

  const env = envOverrides()
  const candidates = env.endpoints.map((endpoint) => ({ name: 'env', endpoint, secret: env.secret, ports: [] }))
  const seen = new Set(candidates.map((item) => (item.endpoint.kind === 'unix' ? item.endpoint.socketPath : `${item.endpoint.host}:${item.endpoint.port}`)))

  for (const item of await readConfigs()) {
    const key = item.endpoint.kind === 'unix' ? item.endpoint.socketPath : `${item.endpoint.host}:${item.endpoint.port}`
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push(item)
  }
  for (const socketPath of serviceSocketCandidates()) {
    if (seen.has(socketPath)) continue
    seen.add(socketPath)
    candidates.push({
      name: 'clash-service',
      endpoint: { kind: 'unix', socketPath, label: `unix:${socketPath}` },
      secret: '',
      ports: [],
    })
  }
  for (const port of DEFAULT_CONTROLLER_PORTS) {
    const key = `127.0.0.1:${port}`
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push({
      name: 'probe',
      endpoint: { kind: 'http', host: '127.0.0.1', port, label: `127.0.0.1:${port}` },
      secret: env.secret,
      ports: [],
    })
  }

  let picked = null
  for (const candidate of candidates) {
    // 环境变量指定的端点不再探测，直接尝试；其余端点先快速探活。
    if (candidate.name === 'env' || await probe(candidate)) {
      picked = candidate
      break
    }
  }

  discovery = { at: now, value: picked }
  return picked
}

/** 把 /connections 的原始条目压成插件用的扁平结构。 */
export function normalizeProxyConnections(list) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const item of list) {
    const meta = item && item.metadata
    if (!meta || typeof meta !== 'object') continue
    const sourcePort = Number(meta.sourcePort)
    if (!Number.isInteger(sourcePort) || sourcePort <= 0) continue
    const destinationPort = Number(meta.destinationPort)
    const host = typeof meta.host === 'string' ? meta.host.trim() : ''
    // mihomo 对「按域名连接」的条目会把 destinationIP 留空，真正的 IP 放在
    // remoteDestination 里；取不到就保持空，交给 UI 显示域名。
    const rawDest = typeof meta.destinationIP === 'string' ? meta.destinationIP.trim() : ''
    const remoteDest = typeof meta.remoteDestination === 'string' ? meta.remoteDestination.trim() : ''
    const destinationIP = rawDest || (remoteDest && net.isIP(remoteDest) ? remoteDest : '')
    const inboundPort = Number(meta.inboundPort)
    out.push({
      id: String(item.id || ''),
      sourcePort,
      sourceIP: typeof meta.sourceIP === 'string' ? meta.sourceIP : '',
      host: host && host !== destinationIP ? host : '',
      destinationIP,
      destinationPort: Number.isInteger(destinationPort) && destinationPort > 0 ? destinationPort : null,
      inboundPort: Number.isInteger(inboundPort) && inboundPort > 0 ? inboundPort : null,
      network: typeof meta.network === 'string' ? meta.network : '',
      processPath: typeof meta.processPath === 'string' ? meta.processPath : '',
      rule: typeof item.rule === 'string' ? item.rule : '',
      chains: Array.isArray(item.chains) ? item.chains.filter((entry) => typeof entry === 'string') : [],
    })
  }
  return out
}

/**
 * 拉一次代理连接表。
 * 返回 { available, endpoint, connections, ports, name, reason }，永不抛错。
 */
export async function fetchProxyConnections() {
  let picked = null
  try {
    picked = await discoverProxy()
  } catch (err) {
    return { available: false, reason: (err && err.message) || 'discovery failed', connections: [], ports: [] }
  }
  if (!picked) {
    return { available: false, reason: 'no-proxy', connections: [], ports: [] }
  }
  try {
    const payload = await requestJson(picked.endpoint, '/connections', picked.secret, FETCH_TIMEOUT_MS)
    const connections = normalizeProxyConnections(payload && payload.connections)
    return {
      available: true,
      name: picked.name,
      endpoint: picked.endpoint.label,
      ports: picked.ports || [],
      connections,
      reason: null,
    }
  } catch (err) {
    // 端点失效：清掉发现缓存，下一轮重新找。
    discovery = { at: 0, value: null }
    return {
      available: false,
      name: picked.name,
      endpoint: picked.endpoint.label,
      ports: picked.ports || [],
      connections: [],
      reason: (err && err.message) || 'fetch failed',
    }
  }
}

/** 复位模块缓存（测试用）。 */
export function resetProxyCache() {
  discovery = { at: 0, value: null }
}
