/**
 * dsh-net-hosts — 宿主半区
 *
 * 一个只读的 DSH 插件：把 `lsof -i` 的套接字表变成可浏览的界面，
 * 并在 Web 界面里注入一个「网络」入口。所有数据接口都是同源 GET，
 * 不接收任何写入参数，因此不会改变系统状态。
 *
 * 组成：
 *   GET /net-hosts/                 独立页面（可在浏览器直接打开）
 *   GET /net-hosts/ui.js            客户端界面（Shadow DOM 隔离）
 *   GET /net-hosts/launcher.js      悬浮入口
 *   GET /net-hosts/api/snapshot     连接/主机/监听 快照（JSON）
 *
 * 桌面端（dsh-app://）不会执行 tapIndex，因此同时订阅
 * `webserver/index-inject` 的结构化注入行 —— 这是桌面壳唯一的注入通道。
 */

import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { collectSnapshot } from './collect.js'

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const UI_FILE = join(PKG_ROOT, 'lib', 'ui.js')
const LAUNCHER_FILE = join(PKG_ROOT, 'lib', 'launcher.js')

export const name = 'dsh-net-hosts'
export const inject = []

const ROUTE_BASE = '/net-hosts'
const LAUNCHER_SRC = `${ROUTE_BASE}/launcher.js`

const TRUSTED_AUTHORITIES = String(
  process.env.DSH_NET_HOSTS_TRUSTED_HOSTS || process.env.DSHW_TRUSTED_HOSTS || '',
).split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)

/* ------------------------------------------------------------------ */
/* 请求信任栅栏                                                        */
/* ------------------------------------------------------------------ */

function isLoopbackHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (!host) return false
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '::1') return true
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!match) return false
  if (Number(match[1]) !== 127) return false
  return [match[2], match[3], match[4]].every((part) => Number(part) <= 255)
}

function selfRejection(req, fenceAvailable) {
  try {
    const headers = req.headers || {}
    let hostUrl
    try {
      hostUrl = new URL(`http://${String(headers.host || '')}`)
    } catch {
      return 403
    }
    const hostname = hostUrl.hostname
    const authority = hostUrl.host
    if (!isLoopbackHostname(hostname)) {
      const listed = TRUSTED_AUTHORITIES.some((entry) => (
        entry.includes(':') ? entry === authority.toLowerCase() : entry === hostname.toLowerCase()
      ))
      if (!listed && !fenceAvailable) return 403
    }
    const site = String(headers['sec-fetch-site'] || '').toLowerCase()
    if (site === 'cross-site') return 403
    const origin = headers.origin
    if (typeof origin === 'string' && origin && origin !== 'null') {
      let originUrl
      try {
        originUrl = new URL(origin)
      } catch {
        return 403
      }
      if (originUrl.host.toLowerCase() !== authority.toLowerCase()) return 403
    }
    return null
  } catch {
    return 403
  }
}

/* ------------------------------------------------------------------ */
/* 静态资源                                                            */
/* ------------------------------------------------------------------ */

const PAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>本机网络连接 · DSH</title>
<style>
  html, body { margin: 0; min-height: 100%; }
  body { background: #f2f4f7; }
  @media (prefers-color-scheme: dark) { body { background: #0f1115; } }
  #app { min-height: 100vh; }
</style>
</head>
<body>
<div id="app"></div>
<script src="${ROUTE_BASE}/ui.js"></script>
<script>
  try {
    window.__DSH_NET_HOSTS_UI__.mount(document.getElementById('app'), { standalone: true })
  } catch (err) {
    document.getElementById('app').textContent = '界面加载失败：' + (err && err.message ? err.message : err)
  }
</script>
</body>
</html>`

let pkgVersion = '0.0.0'
try {
  pkgVersion = String(JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')).version || pkgVersion)
} catch { /* 读不到就用占位版本 */ }

/**
 * 每次都从磁盘读：ui.js / launcher.js 不是 ESM 模块，HMR 不会感知它们的变化。
 * 早先这里做过缓存，导致改完界面后即使热重载插件，客户端仍拿旧脚本。
 */
async function readAsset(file) {
  return readFile(file, 'utf8')
}

/** 资源指纹：把 mtime 拼进 health，客户端可据此判断要不要重新加载脚本。 */
async function assetStamp(file) {
  try {
    const { stat } = await import('node:fs/promises')
    const info = await stat(file)
    return String(Math.round(info.mtimeMs))
  } catch {
    return ''
  }
}

function send(res, status, headers, body) {
  res.writeHead(status, {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...headers,
  })
  res.end(body)
}

function sendJson(res, status, value) {
  send(res, status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  }, JSON.stringify(value))
}

/* ------------------------------------------------------------------ */
/* 插件入口                                                            */
/* ------------------------------------------------------------------ */

export function apply(root, config = {}) {
  const disposers = []

  root.effect(() => () => {
    for (const dispose of disposers) {
      try { dispose() } catch { /* ignore */ }
    }
    disposers.length = 0
  })

  // ① 桌面端注入通道：必须在 apply() 一开始注册（桌面壳只在启动时收集一次这张表）。
  disposers.push(root.on('webserver/index-inject', (table) => {
    try {
      if (!Array.isArray(table)) return
      for (const row of table) {
        if (!row) continue
        if (row.kind === 'script-src' && row.src === LAUNCHER_SRC) return
        if (row.kind === 'script' && typeof row.text === 'string' && row.text.includes(LAUNCHER_SRC)) return
      }
      table.push({
        kind: 'script',
        placement: 'body',
        // 内联行自己建 <script src>，并吞掉 onerror：插件被热卸载时页面不会因此起不来。
        text: `(function(){try{if(window.__dshNetHostsLauncher)return;window.__dshNetHostsLauncher=1;`
          + `var d=document.body||document.documentElement;if(!d)return;`
          + `var s=document.createElement('script');s.src='${LAUNCHER_SRC}';s.async=true;`
          + `s.onerror=function(){};d.appendChild(s)}catch(e){}})()`,
      })
    } catch { /* ignore */ }
  }))

  // ② Web 形态的兜底注入：HTTP 版 index 每次渲染都会走 tapIndex。
  root.inject(['webServer'], (ctx) => {
    const webServer = ctx.webServer

    disposers.push(webServer.tapIndex((html) => {
      if (typeof html !== 'string' || html.includes(LAUNCHER_SRC)) return html
      const tag = `<script src="${LAUNCHER_SRC}" async></script>`
      return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${tag}</body>`) : html + tag
    }))

    const guard = (req, res) => {
      const connection = (() => {
        try {
          const service = ctx.get('connection')
          return service && typeof service.requestRejection === 'function' ? service : null
        } catch {
          return null
        }
      })()
      const self = selfRejection(req, Boolean(connection))
      if (self !== null) {
        res.statusCode = self
        res.end()
        return false
      }
      if (!connection) return true
      let code
      try {
        code = connection.requestRejection(req)
      } catch {
        res.statusCode = 403
        res.end()
        return false
      }
      if (code === undefined || code === null || code === false) return true
      res.statusCode = typeof code === 'number' ? code : 403
      res.end()
      return false
    }

    const register = (route) => {
      const handler = route.handler
      disposers.push(webServer.register({
        kind: route.kind,
        path: route.path,
        handler: (req, res) => {
          if (!guard(req, res)) return
          return handler(req, res)
        },
      }))
    }

    register({
      kind: 'exact',
      path: ROUTE_BASE,
      handler: (req, res) => {
        res.writeHead(302, { location: `${ROUTE_BASE}/` })
        res.end()
      },
    })

    register({
      kind: 'exact',
      path: `${ROUTE_BASE}/`,
      handler: (req, res) => {
        send(res, 200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-cache',
        }, PAGE_HTML)
      },
    })

    register({
      kind: 'exact',
      path: `${ROUTE_BASE}/ui.js`,
      handler: async (req, res) => {
        try {
          const source = await readAsset(UI_FILE)
          send(res, 200, {
            'content-type': 'text/javascript; charset=utf-8',
            'cache-control': 'no-cache, no-store, must-revalidate',
          }, source)
        } catch (err) {
          send(res, 500, { 'content-type': 'text/plain; charset=utf-8' }, String(err && err.message))
        }
      },
    })

    register({
      kind: 'exact',
      path: `${ROUTE_BASE}/launcher.js`,
      handler: async (req, res) => {
        try {
          const source = await readAsset(LAUNCHER_FILE)
          send(res, 200, {
            'content-type': 'text/javascript; charset=utf-8',
            'cache-control': 'no-cache, no-store, must-revalidate',
          }, source)
        } catch (err) {
          send(res, 500, { 'content-type': 'text/plain; charset=utf-8' }, String(err && err.message))
        }
      },
    })

    register({
      kind: 'exact',
      path: `${ROUTE_BASE}/api/snapshot`,
      handler: async (req, res) => {
        try {
          const url = new URL(req.url || '/', 'http://localhost')
          const fresh = url.searchParams.get('fresh') === '1'
          const snapshot = await collectSnapshot({ fresh })
          sendJson(res, 200, snapshot)
        } catch (err) {
          const message = err && err.code === 'LSOF_MISSING'
            ? '未找到 lsof 命令，无法读取网络连接。'
            : err && err.code === 'LSOF_TIMEOUT'
              ? 'lsof 执行超时，请稍后重试。'
              : (err && err.message) || '读取网络连接失败'
          sendJson(res, 500, { ok: false, error: message, code: (err && err.code) || 'COLLECT_FAILED' })
        }
      },
    })

    register({
      kind: 'exact',
      path: `${ROUTE_BASE}/api/health`,
      handler: async (req, res) => {
        const [ui, launcher] = await Promise.all([assetStamp(UI_FILE), assetStamp(LAUNCHER_FILE)])
        sendJson(res, 200, { ok: true, name, version: pkgVersion, ui, launcher })
      },
    })

    // ③ 把同一份数据注册成模型工具。这里手写 tool 定义，不 import('@deepseek-ai/dsh-tools')：
    // 插件的裸包名解析取决于宿主 loader，装在任意目录时并不保证成功；而 tools.register
    // 本身只要求 output 形状与受支持的 JSON Schema 子集（type/properties/required/enum/...）。
    root.inject(['tools'], (toolCtx) => {
      const tool = {
        name: 'net_connections',
        description:
          '查看本机当前的 TCP/UDP 网络连接：状态、进程、本地/远端地址与反向解析出的主机名。只读，不会建立或关闭连接。',
        parameters: {
          type: 'object',
          properties: {
            state: {
              type: 'string',
              enum: ['all', 'established', 'listening'],
              description: 'all（默认）| established 只看已建立 | listening 只看监听端口',
            },
            scope: {
              type: 'string',
              enum: ['all', 'public', 'lan', 'loopback'],
              description: 'all（默认）| public 仅公网 | lan 仅局域网 | loopback 仅本机，按远端地址归类',
            },
            limit: {
              type: 'integer',
              description: '最多返回多少条，默认 40，最大 200',
            },
          },
          required: [],
          additionalProperties: false,
        },
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: String(value) }],
        },
        async execute(args = {}) {
          const snapshot = await collectSnapshot()
          const state = ['established', 'listening'].includes(String(args.state || '').toLowerCase())
            ? String(args.state).toLowerCase()
            : 'all'
          const scope = ['public', 'lan', 'loopback'].includes(String(args.scope || '').toLowerCase())
            ? String(args.scope).toLowerCase()
            : 'all'
          const limit = Math.max(1, Math.min(200, Number(args.limit) || 40))

          let rows = snapshot.rows
          if (state === 'established') rows = rows.filter((row) => row.state === 'ESTABLISHED')
          else if (state === 'listening') rows = rows.filter((row) => row.state === 'LISTEN')
          if (scope !== 'all') {
            rows = rows.filter((row) => (row.remote ? row.remoteScope : row.localScope) === scope)
          }

          const summary = snapshot.summary
          const header = `共 ${summary.total} 个套接字（已建立 ${summary.established}，监听 ${summary.listening}，对端主机 ${summary.hosts}）；显示 ${Math.min(rows.length, limit)} 条`
          if (rows.length === 0) return `${header}\n（没有匹配的连接）`
          const lines = rows.slice(0, limit).map((row) => {
            const local = `${row.local.addr}:${row.local.port ?? ''}`
            const remote = row.remote ? `${row.remote.addr}:${row.remote.port ?? ''}` : '-'
            const name = row.hostname ? ` (${row.hostname})` : ''
            return `${row.state || row.proto}  ${row.process || '?'}(${row.pid ?? '?'})  ${row.proto}  ${local} -> ${remote}${name}`
          })
          return `${header}\n${lines.join('\n')}`
        },
      }
      try {
        disposers.push(toolCtx.tools.register(tool))
      } catch (err) {
        try {
          root.logger?.debug?.(`[dsh-net-hosts] 模型工具注册失败：${err && err.message}`)
        } catch { /* ignore */ }
      }
    })
  })
}

export default { name, apply }

// reload marker 1794279767

// client reload 1794279864
