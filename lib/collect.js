/**
 * dsh-net-hosts — 数据采集层
 *
 * 只依赖 Node 内置模块：用 `lsof -F` 的机器可读输出拿到本机 TCP/UDP 套接字，
 * 解析成结构化行，再补充方向、地址作用域、反向 DNS 主机名等派生信息。
 *
 * 设计要点：
 * - `lsof -F` 的字段顺序固定为 p(pid) c(command) f(fd) P(protocol) n(name) T(ST=state)，
 *   不像默认表格那样会被含空格的进程名/地址打乱，解析稳定。
 * - 反向 DNS 永远不阻塞快照：命中缓存就带上，未命中就排队解析，下一次轮询自然补全。
 *   这样即使某个公网 IP 的 PTR 查询卡住，界面也不会跟着卡。
 * - 快照有极短的复用窗口（默认 700ms），多个界面同时轮询时不会把 lsof 打爆。
 */

import { execFile } from 'node:child_process'
import { promises as dns } from 'node:dns'
import os from 'node:os'
import { fetchProxyConnections } from './proxy.js'

const LSOF_TIMEOUT_MS = 5000
const SNAPSHOT_MAX_AGE_MS = 700
const DNS_TIMEOUT_MS = 900
const DNS_OK_TTL_MS = 30 * 60 * 1000
const DNS_FAIL_TTL_MS = 10 * 60 * 1000
const HOST_MEMORY_TTL_MS = 12 * 60 * 60 * 1000

/** lsof 会把不可打印字节转成 `\xNN`（例如中文进程名），这里还原成 UTF-8。 */
export function decodeLsofText(input) {
  if (typeof input !== 'string' || !input.includes('\\x')) return input
  const bytes = []
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    if (ch === '\\' && input[i + 1] === 'x' && /^[0-9a-fA-F]{2}$/.test(input.slice(i + 2, i + 4))) {
      bytes.push(Number.parseInt(input.slice(i + 2, i + 4), 16))
      i += 3
    } else {
      const buf = Buffer.from(ch, 'utf8')
      for (const b of buf) bytes.push(b)
    }
  }
  return Buffer.from(bytes).toString('utf8')
}

/** 解析一个 `addr:port` / `[v6]:port` / `*:*` 端点。 */
export function parseEndpoint(text) {
  if (typeof text !== 'string' || text === '' || text === '*') {
    return { addr: '*', port: null, wildcard: true }
  }
  let host = text
  let port = null
  if (text.startsWith('[')) {
    const close = text.lastIndexOf(']')
    if (close > 0) {
      host = text.slice(1, close)
      const rest = text.slice(close + 1)
      if (rest.startsWith(':')) port = rest.slice(1)
    }
  } else {
    const idx = text.lastIndexOf(':')
    if (idx >= 0) {
      host = text.slice(0, idx)
      port = text.slice(idx + 1)
    }
  }
  const numericPort = port && /^\d+$/.test(port) ? Number(port) : null
  return {
    addr: host === '' ? '*' : host,
    port: numericPort,
    wildcard: host === '*' || host === '',
  }
}

function splitName(name) {
  if (typeof name !== 'string' || name === '') return null
  const arrow = name.indexOf('->')
  if (arrow < 0) return { local: name, remote: null }
  return { local: name.slice(0, arrow), remote: name.slice(arrow + 2) }
}

/**
 * 把 `lsof -nP -i -F pcnPT` 的输出解析成原始行。
 * 只保留 TCP / UDP（ICMP 也会出现在 -i 里，且没有端口，对本插件无意义）。
 */
export function parseLsofOutput(text) {
  if (typeof text !== 'string' || text === '') return []
  const rows = []
  let pid = null
  let command = ''
  let entry = null

  const flush = () => {
    if (!entry || !entry.name) {
      entry = null
      return
    }
    const proto = entry.proto || 'TCP'
    if (proto !== 'TCP' && proto !== 'UDP') {
      entry = null
      return
    }
    const parts = splitName(entry.name)
    if (!parts) {
      entry = null
      return
    }
    const local = parseEndpoint(parts.local)
    const remote = parts.remote ? parseEndpoint(parts.remote) : null
    rows.push({
      pid,
      process: decodeLsofText(command || ''),
      fd: entry.fd || null,
      proto,
      state: entry.state || null,
      type: local.addr.includes(':') ? 'IPv6' : 'IPv4',
      local,
      remote,
    })
    entry = null
  }

  for (const line of text.split('\n')) {
    if (!line) continue
    const tag = line[0]
    const value = line.slice(1)
    if (tag === 'p') {
      flush()
      const n = Number(value)
      pid = Number.isFinite(n) ? n : null
      command = ''
    } else if (tag === 'c') {
      command = value
    } else if (tag === 'f') {
      flush()
      entry = { fd: value }
    } else if (tag === 'P') {
      if (entry) entry.proto = value
    } else if (tag === 'n') {
      if (entry) entry.name = value
    } else if (tag === 'T') {
      if (entry && value.startsWith('ST=')) entry.state = value.slice(3)
    }
  }
  flush()
  return rows
}

const LOOPBACK = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback'])
const PRIVATE_V4 = [
  [/^10\./, 8],
  [/^172\.(1[6-9]|2\d|3[01])\./, 12],
  [/^192\.168\./, 16],
  [/^169\.254\./, 16],
  [/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, 10],
]

/** 把地址粗分成 loopback / lan / public / wildcard 四类，用于配色与筛选。 */
export function classifyAddress(addr) {
  const value = String(addr || '').toLowerCase().split('%')[0]
  if (!value || value === '*') return 'wildcard'
  if (value === '::1' || value === '0:0:0:0:0:0:0:1') return 'loopback'
  if (LOOPBACK.has(value)) return 'loopback'
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value)
  if (mapped) return classifyAddress(mapped[1])
  if (/^127\./.test(value)) return 'loopback'
  for (const [re, ] of PRIVATE_V4) if (re.test(value)) return 'lan'
  if (/^fe80:/.test(value)) return 'lan'
  if (/^f[cd][0-9a-f]{2}:/.test(value)) return 'lan'
  if (value.includes(':')) return 'public'
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return 'public'
  // 主机名（lsof 基本不会给，但保留兜底）
  return LOOPBACK.has(value) ? 'loopback' : 'public'
}

/** 相同的套接字可能因 IPv4/IPv6 双栈或 dup 出现多次，去重并记录副本数。 */
function dedupe(rows) {
  const seen = new Map()
  for (const row of rows) {
    const key = [
      row.pid, row.proto, row.state || '',
      row.local.addr, row.local.port,
      row.remote ? row.remote.addr : '-', row.remote ? row.remote.port : '-',
    ].join('|')
    const hit = seen.get(key)
    if (hit) {
      hit.fds += 1
      continue
    }
    seen.set(key, {
      ...row,
      fds: 1,
      localScope: classifyAddress(row.local.addr),
      remoteScope: row.remote ? classifyAddress(row.remote.addr) : null,
    })
  }
  return [...seen.values()]
}

/* ------------------------------------------------------------------ */
/* 反向 DNS 缓存                                                       */
/* ------------------------------------------------------------------ */

const dnsCache = new Map() // addr -> { name, state: 'ok'|'fail'|'pending', expires, at }
let dnsInflight = 0
const DNS_CONCURRENCY = 6

function cacheHostname(addr, allowLookup = true) {
  const key = addr
  const now = Date.now()
  const hit = dnsCache.get(key)
  if (hit && hit.expires > now) {
    if (hit.state === 'ok') return hit.name
    if (hit.state === 'pending' || hit.state === 'fail') return null
  }
  if (!allowLookup) return null
  if (dnsInflight >= DNS_CONCURRENCY) return null
  const entry = { name: null, state: 'pending', expires: now + 20000, at: now }
  dnsCache.set(key, entry)
  dnsInflight += 1
  const timer = setTimeout(() => {
    if (dnsCache.get(key) === entry) {
      entry.state = 'fail'
      entry.expires = Date.now() + DNS_FAIL_TTL_MS
    }
    dnsInflight = Math.max(0, dnsInflight - 1)
  }, DNS_TIMEOUT_MS)
  dns.reverse(addr).then((names) => {
    clearTimeout(timer)
    const name = Array.isArray(names) && names.length > 0 ? String(names[0]).replace(/\.$/, '') : null
    if (dnsCache.get(key) === entry) {
      if (name) {
        entry.name = name
        entry.state = 'ok'
        entry.expires = Date.now() + DNS_OK_TTL_MS
      } else {
        entry.state = 'fail'
        entry.expires = Date.now() + DNS_FAIL_TTL_MS
      }
    }
    dnsInflight = Math.max(0, dnsInflight - 1)
  }, () => {
    clearTimeout(timer)
    if (dnsCache.get(key) === entry) {
      entry.state = 'fail'
      entry.expires = Date.now() + DNS_FAIL_TTL_MS
    }
    dnsInflight = Math.max(0, dnsInflight - 1)
  })
  return null
}

/* ------------------------------------------------------------------ */
/* 主机记忆（首次/最近出现）                                            */
/* ------------------------------------------------------------------ */

const hostMemory = new Map() // addr -> { firstSeen, lastSeen, name }

function rememberHost(addr, name) {
  const now = Date.now()
  let hit = hostMemory.get(addr)
  if (!hit) {
    hit = { firstSeen: now, lastSeen: now, name: null }
    hostMemory.set(addr, hit)
  }
  hit.lastSeen = now
  if (name) hit.name = name
  return hit
}

function pruneHostMemory(now) {
  if (hostMemory.size < 2000) return
  for (const [addr, hit] of hostMemory) {
    if (now - hit.lastSeen > HOST_MEMORY_TTL_MS) hostMemory.delete(addr)
  }
}

/* ------------------------------------------------------------------ */
/* 代理连接表（Clash / mihomo）                                         */
/* ------------------------------------------------------------------ */

const PROXY_MAX_AGE_MS = 1200

let proxyState = { at: 0, value: null, loading: false }

/** 后台刷新代理连接表；快照本身永远不等它，下一轮轮询自然带上域名。 */
function getProxy() {
  const now = Date.now()
  if (!proxyState.loading && now - proxyState.at > PROXY_MAX_AGE_MS) {
    proxyState.loading = true
    fetchProxyConnections()
      .then((value) => {
        proxyState.value = value
        proxyState.at = Date.now()
      })
      .catch(() => { /* 静默降级 */ })
      .finally(() => { proxyState.loading = false })
  }
  return proxyState.value
}

/**
 * 把代理连接表贴回 lsof 行：sourcePort 等于应用的本地端口，于是可以把
 * 「应用 -> 127.0.0.1:7897」还原成「应用 -> www.xueqiu.com:443」。
 * 返回匹配上的行数（测试直接用它断言）。
 */
export function applyProxyTargets(rows, proxy) {
  if (!proxy || !proxy.available || !Array.isArray(proxy.connections) || proxy.connections.length === 0) return 0
  const bySourcePort = new Map()
  for (const conn of proxy.connections) {
    if (!conn || !conn.sourcePort || bySourcePort.has(conn.sourcePort)) continue
    bySourcePort.set(conn.sourcePort, conn)
  }
  // 代理端口的来源有两处：配置里的 mixed-port 等，以及代理自己回报的 inboundPort。
  // 后者在没有配置文件（例如只拿到 unix socket）时也能把匹配收紧到真实代理端口。
  const proxyPorts = new Set(Array.isArray(proxy.ports) ? proxy.ports : [])
  for (const conn of proxy.connections) {
    if (conn && conn.inboundPort) proxyPorts.add(conn.inboundPort)
  }
  let applied = 0
  for (const row of rows) {
    if (!row.remote || row.remoteScope !== 'loopback' || row.viaProxy) continue
    // 已知代理端口时只认指向这些端口的连接；未知时退化为 sourcePort 匹配。
    if (proxyPorts.size > 0 && !proxyPorts.has(row.remote.port)) continue
    const conn = bySourcePort.get(row.local.port)
    if (!conn) continue
    row.viaProxy = true
    row.processPath = conn.processPath || row.processPath || null
    row.domain = conn.host || null
    row.hostname = conn.host || null
    row.target = {
      addr: conn.destinationIP || null,
      port: conn.destinationPort != null ? conn.destinationPort : row.remote.port,
      host: conn.host || null,
    }
    row.targetScope = conn.destinationIP ? classifyAddress(conn.destinationIP) : row.remoteScope
    row.proxy = {
      rule: conn.rule || '',
      chains: Array.isArray(conn.chains) ? conn.chains : [],
      processPath: conn.processPath || '',
    }
    applied += 1
  }
  return applied
}

/* ------------------------------------------------------------------ */
/* 采集                                                                */
/* ------------------------------------------------------------------ */

function runLsof() {
  return new Promise((resolve, reject) => {
    execFile('lsof', ['-nP', '-i', '-F', 'pcnPT'], {
      timeout: LSOF_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    }, (error, stdout) => {
      // lsof 在没有匹配项时退出码为 1，但 stdout 仍是合法（空）输出；只有真的缺命令才报错。
      if (error && error.code === 'ENOENT') {
        reject(Object.assign(new Error('未找到 lsof 命令'), { code: 'LSOF_MISSING' }))
        return
      }
      if (error && error.killed) {
        reject(Object.assign(new Error('lsof 执行超时'), { code: 'LSOF_TIMEOUT' }))
        return
      }
      resolve(typeof stdout === 'string' ? stdout : '')
    })
  })
}

function localInterfaces() {
  const out = []
  const ifaces = os.networkInterfaces()
  for (const [name, list] of Object.entries(ifaces)) {
    for (const item of list || []) {
      out.push({
        name,
        address: item.address,
        family: item.family,
        internal: Boolean(item.internal),
        mac: item.mac,
        scope: classifyAddress(item.address),
      })
    }
  }
  return out
}

let inflight = null
let cachedSnapshot = null
let cachedAt = 0
let seenIds = null
const eventLog = []
const MAX_EVENTS = 400
let ownerCache = { at: 0, value: new Map() }

export function resetCache() {
  dnsCache.clear()
  hostMemory.clear()
  proxyState = { at: 0, value: null, loading: false }
  cachedSnapshot = null
  cachedAt = 0
  inflight = null
  seenIds = null
  eventLog.length = 0
  ownerCache = { at: 0, value: new Map() }
}

/** 没有进程树时，用进程名/代理上报的路径兜底：把 Helper 归回宿主 App。 */
export function ownerFromName(name, processPath) {
  const bundle = /([^/]+)\.app\//.exec(processPath || '')
  if (bundle) return { name: bundle[1], helper: bundle[1] !== name, system: false }
  const value = String(name || '').trim()
  if (/^com\.apple\./.test(value) || /^\/System\//.test(processPath || '')) {
    return { name: '系统组件', helper: false, system: true }
  }
  const helper = /^(.*?)\s+Helper(\s*\(.*\))?$/i.exec(value)
  if (helper && helper[1]) return { name: helper[1].trim(), helper: true, system: false }
  return { name: value, helper: false, system: false }
}

/** 从 ps 的路径推断「这个进程属于哪个 App」。helper 进程向上找到 .app 包。 */
function appNameFromPath(value) {
  const bundle = /([^/]+)\.app\//.exec(value || '')
  if (bundle) return bundle[1]
  const base = String(value || '').split('/').filter(Boolean).pop() || ''
  if (/^com\.apple\./.test(base)) return '系统组件'
  return base
}

async function resolveOwners() {
  if (ownerCache.value.size && Date.now() - ownerCache.at < 5000) return ownerCache.value
  const owners = new Map()
  try {
    const stdout = await new Promise((resolve, reject) => {
      const env = { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' }
      execFile('ps', ['-axo', 'pid=,ppid=,comm='], { timeout: 1200, maxBuffer: 2 * 1024 * 1024, env }, (err, out) => {
        if (err) reject(err)
        else resolve(out)
      })
    })
    const tree = new Map()
    for (const line of stdout.split('\n')) {
      const parts = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line)
      if (!parts) continue
      tree.set(Number(parts[1]), { ppid: Number(parts[2]), path: parts[3].trim() })
    }
    for (const [pid, item] of tree) {
      let name = null
      let current = item
      for (let depth = 0; current && depth < 6; depth += 1) {
        const bundle = /([^/]+)\.app\//.exec(current.path)
        if (bundle) { name = bundle[1]; break }
        if (!current.ppid || current.ppid <= 1) break
        current = tree.get(current.ppid)
      }
      if (!name) name = appNameFromPath(item.path)
      const base = item.path.split('/').filter(Boolean).pop() || ''
      const helper = name !== base && !/^com\.apple\./.test(base)
      const system = name === '系统组件'
      owners.set(pid, { name, helper, system })
    }
  } catch {
    // ps 不可用时退回进程名，不影响主流程。
  }
  ownerCache = { at: Date.now(), value: owners }
  return owners
}

/** 采集一次快照；并发调用共享同一个进行中的采集。 */
export async function collectSnapshot(options = {}) {
  const maxAge = Number.isFinite(options.maxAgeMs) ? options.maxAgeMs : SNAPSHOT_MAX_AGE_MS
  const now = Date.now()
  if (!options.fresh && cachedSnapshot && now - cachedAt <= maxAge) {
    return decorate(cachedSnapshot)
  }
  if (inflight) return inflight
  inflight = collectFresh()
    .then((snapshot) => {
      cachedSnapshot = snapshot
      cachedAt = Date.now()
      return decorate(snapshot)
    })
    .finally(() => { inflight = null })
  return inflight
}

async function collectFresh() {
  const startedAt = Date.now()
  const stdout = await runLsof()
  const allRows = parseLsofOutput(stdout)
  const rows = dedupe(allRows)
  const now = Date.now()

  const listeningProtoPort = new Set()
  for (const row of rows) {
    if (row.state === 'LISTEN') listeningProtoPort.add(`${row.proto}:${row.local.port}`)
  }

  for (const row of rows) {
    row.direction = row.remote
      ? (listeningProtoPort.has(`${row.proto}:${row.local.port}`) ? 'inbound' : 'outbound')
      : 'listen'
    row.id = `${row.proto}:${row.pid ?? '?'}:${row.local.addr}:${row.local.port}:${row.remote ? `${row.remote.addr}:${row.remote.port}` : 'l'}:${row.state || ''}`
    row.hostname = null
    if (row.remote && row.remoteScope !== 'loopback' && !row.remote.wildcard) {
      cacheHostname(row.remote.addr)
    }
  }

  const interfaces = localInterfaces()
  const localNames = new Map()
  for (const item of interfaces) {
    if (!localNames.has(item.address)) localNames.set(item.address, item.name)
  }

  const proxy = getProxy()
  applyProxyTargets(rows, proxy)

  const owners = await resolveOwners()
  for (const row of rows) {
    const owner = owners.get(row.pid) || ownerFromName(row.process, row.processPath)
    row.ownerName = owner.name || row.process || '未知进程'
    row.ownerKey = `app:${row.ownerName.toLowerCase()}`
    row.ownerHelper = Boolean(owner.helper)
    row.ownerSystem = Boolean(owner.system)
  }

  // 记录「新出现的连接」事件：重启插件后的第一份快照只做基线，不刷一屏历史。
  const currentIds = new Set()
  for (const row of rows) {
    if (!row.remote || row.remote.wildcard || !row.remote.addr) continue
    currentIds.add(row.id)
    if (seenIds && !seenIds.has(row.id)) {
      const eventScope = row.viaProxy ? (row.targetScope || row.remoteScope) : row.remoteScope
      if (eventScope === 'loopback') continue
      const host = (row.domain || row.hostname || row.target?.host || row.remote.addr || '').trim()
      eventLog.push({
        ts: Date.now(),
        id: row.id,
        pid: row.pid ?? null,
        process: row.process || '',
        ownerName: row.ownerName,
        ownerKey: row.ownerKey,
        host,
        addr: row.viaProxy && row.target ? (row.target.addr || row.remote.addr) : row.remote.addr,
        port: row.viaProxy && row.target ? (row.target.port ?? row.remote.port) : row.remote.port,
        scope: eventScope,
        viaProxy: Boolean(row.viaProxy),
        state: row.state || '',
      })
      if (eventLog.length > MAX_EVENTS) eventLog.splice(0, eventLog.length - MAX_EVENTS)
    }
  }
  seenIds = currentIds

  const hosts = new Map()
  for (const row of rows) {
    if (!row.remote || row.remote.wildcard || !row.remote.addr || row.remote.addr === '*') continue
    // 经代理的连接以真实目标（域名/目的 IP）聚合，而不是 127.0.0.1:7897。
    const key = row.viaProxy && row.target
      ? (row.target.host || row.target.addr || row.remote.addr)
      : row.remote.addr
    const scope = row.viaProxy ? (row.targetScope || row.remoteScope) : row.remoteScope
    let host = hosts.get(key)
    if (!host) {
      host = {
        addr: key,
        scope,
        hostname: null,
        viaProxy: false,
        ips: new Set(),
        connections: 0,
        established: 0,
        listening: 0,
        ports: new Set(),
        processes: new Map(),
        firstSeen: null,
        lastSeen: null,
      }
      hosts.set(key, host)
    }
    if (row.viaProxy) {
      host.viaProxy = true
      if (row.target && row.target.addr) host.ips.add(row.target.addr)
      if (row.target && row.target.port) host.ports.add(row.target.port)
    } else if (row.remote.port) {
      host.ports.add(row.remote.port)
    }
    host.connections += 1
    if (row.state === 'ESTABLISHED') host.established += 1
    const procKey = `${row.pid ?? '?'}:${row.process || ''}`
    host.processes.set(procKey, (host.processes.get(procKey) || 0) + 1)
  }

  const cleanedHosts = [...hosts.values()].map((host) => {
    const memory = rememberHost(host.addr)
    return {
      addr: host.addr,
      scope: host.scope,
      hostname: host.hostname,
      viaProxy: host.viaProxy,
      ips: [...host.ips],
      connections: host.connections,
      established: host.established,
      ports: [...host.ports].sort((a, b) => a - b),
      processes: [...host.processes.entries()]
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count),
      firstSeen: memory.firstSeen,
      lastSeen: memory.lastSeen,
    }
  }).sort((a, b) => b.connections - a.connections)

  const summary = {
    total: rows.filter((row) => row.remote || row.state === 'LISTEN').length,
    established: rows.filter((row) => row.state === 'ESTABLISHED').length,
    listening: rows.filter((row) => row.state === 'LISTEN').length,
    hosts: cleanedHosts.length,
    externalHosts: cleanedHosts.filter((host) => host.scope === 'public').length,
    domains: new Set(rows.filter((row) => row.viaProxy && row.target && row.target.host).map((row) => row.target.host)).size,
    proxied: rows.filter((row) => row.viaProxy).length,
    processes: new Set(rows.map((row) => row.pid)).size,
    udp: rows.filter((row) => row.proto === 'UDP').length,
    inbound: rows.filter((row) => row.direction === 'inbound').length,
    outbound: rows.filter((row) => row.direction === 'outbound').length,
  }

  pruneHostMemory(now)

  return {
    ok: true,
    ts: Date.now(),
    durationMs: Date.now() - startedAt,
    hostname: os.hostname(),
    platform: process.platform,
    user: safeUser(),
    limited: process.platform !== 'win32' && typeof process.getuid === 'function' && process.getuid() !== 0,
    dnsPending: [...dnsCache.values()].filter((entry) => entry.state === 'pending').length,
    proxy: proxyInfo(proxy),
    summary,
    rows,
    hosts: cleanedHosts,
    events: eventLog.slice(-200).reverse(),
    interfaces,
    localNames: Object.fromEntries(localNames),
  }
}

function proxyInfo(proxy) {
  if (!proxy) return { available: false, name: null, endpoint: null, connections: 0, ports: [], reason: 'pending' }
  const connections = Array.isArray(proxy.connections) ? proxy.connections : []
  return {
    available: Boolean(proxy.available),
    name: proxy.name || null,
    endpoint: proxy.endpoint || null,
    connections: connections.length,
    ports: Array.isArray(proxy.ports) ? proxy.ports : [],
    reason: proxy.reason || null,
  }
}

function safeUser() {
  try { return os.userInfo().username } catch { return '' }
}

/** 把缓存里已经解析好的主机名贴到行上（不触发新的查询）。 */
function decorate(snapshot) {
  let dnsPending = 0
  const rows = snapshot.rows.map((row) => {
    if (!row.remote || row.remote.wildcard || row.viaProxy) return row
    const hit = dnsCache.get(row.remote.addr)
    if (hit && hit.state === 'pending') dnsPending += 1
    const name = hit && hit.state === 'ok' ? hit.name : null
    const dnsState = hit ? hit.state : 'unknown'
    if (name === row.hostname && dnsState === row.dnsState) return row
    return { ...row, hostname: name, dnsState }
  })
  const hosts = snapshot.hosts.map((host) => {
    if (host.viaProxy) return host
    const hit = dnsCache.get(host.addr)
    const name = hit && hit.state === 'ok' ? hit.name : null
    const dnsState = hit ? hit.state : 'unknown'
    if (name === host.hostname && dnsState === host.dnsState) return host
    const copy = { ...host, hostname: name, dnsState }
    if (name) rememberHost(host.addr, name)
    return copy
  })
  return { ...snapshot, rows, hosts, dnsPending }
}
