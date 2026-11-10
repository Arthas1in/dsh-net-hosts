import assert from 'node:assert/strict'
import test from 'node:test'

import applyDefault, { apply, name } from '../lib/index.js'

function createContext() {
  const routes = []
  const tools = []
  const indexInjectRows = []
  const indexInjectHandlers = []
  const tapIndexFns = []
  const disposers = []
  let effectCleanup = null

  const webServer = {
    register(route) {
      routes.push(route)
      return () => {
        const at = routes.indexOf(route)
        if (at >= 0) routes.splice(at, 1)
      }
    },
    tapIndex(fn) {
      tapIndexFns.push(fn)
      return () => tapIndexFns.splice(tapIndexFns.indexOf(fn), 1)
    },
  }

  const ctx = {
    webServer,
    tools: {
      register(definition) {
        tools.push(definition)
        return () => {
          const at = tools.indexOf(definition)
          if (at >= 0) tools.splice(at, 1)
        }
      },
    },
    get() { return undefined },
    on(event, handler) {
      if (event === 'webserver/index-inject') indexInjectHandlers.push(handler)
      return () => {}
    },
    effect(fn) {
      const cleanup = fn()
      if (typeof cleanup === 'function') effectCleanup = cleanup
      return () => {}
    },
    inject(_deps, callback) {
      callback(ctx)
    },
    logger: { debug() {}, warn() {} },
  }

  return {
    ctx,
    routes,
    tools,
    indexInjectHandlers,
    tapIndexFns,
    get effectCleanup() { return effectCleanup },
    disposeAll() { if (effectCleanup) effectCleanup() },
    rows: indexInjectRows,
    disposers,
  }
}

function mockRequest(overrides = {}) {
  return {
    method: 'GET',
    url: '/net-hosts/api/snapshot',
    ...overrides,
    headers: { host: '127.0.0.1:55436', ...(overrides.headers || {}) },
  }
}

function mockResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.statusCode = status
      Object.assign(this.headers, headers || {})
    },
    end(chunk) {
      this.body += chunk == null ? '' : String(chunk)
    },
  }
  return res
}

function call(harness, path, headers) {
  const route = harness.routes.find((item) => item.path === path)
  assert.ok(route, `route ${path} not registered`)
  const res = mockResponse()
  return Promise.resolve(route.handler(mockRequest({ url: path, headers }), res)).then(() => res)
}

test('apply 注册路由、注入入口，并暴露默认导出', () => {
  assert.equal(name, 'dsh-net-hosts')
  assert.equal(typeof applyDefault.apply, 'function')

  const harness = createContext()
  apply(harness.ctx)

  const paths = harness.routes.map((route) => route.path)
  for (const expected of ['/net-hosts', '/net-hosts/', '/net-hosts/ui.js', '/net-hosts/launcher.js', '/net-hosts/api/snapshot', '/net-hosts/api/health']) {
    assert.ok(paths.includes(expected), `missing ${expected}`)
  }
  assert.equal(harness.indexInjectHandlers.length, 1)
  assert.equal(harness.tapIndexFns.length, 1)

  const table = []
  harness.indexInjectHandlers[0](table)
  assert.equal(table.length, 1)
  assert.equal(table[0].kind, 'script')
  assert.ok(table[0].text.includes('/net-hosts/launcher.js'))

  const html = harness.tapIndexFns[0]('<html><body><div id="app"></div></body></html>')
  assert.ok(html.includes('<script src="/net-hosts/launcher.js" async></script>'))
  // 重复渲染不会重复注入
  assert.equal(harness.tapIndexFns[0](html), html)
})

const liveTest = process.platform === 'darwin' ? test : test.skip

liveTest('api/snapshot 返回真实数据', async () => {
  const harness = createContext()
  apply(harness.ctx)
  const res = await call(harness, '/net-hosts/api/snapshot')
  assert.equal(res.statusCode, 200)
  assert.match(res.headers['content-type'], /application\/json/)
  const body = JSON.parse(res.body)
  assert.equal(body.ok, true)
  assert.ok(body.rows.length > 0)
  assert.ok(body.summary.total >= 1)
})

test('api/health 与独立页面、静态资源', async () => {
  const harness = createContext()
  apply(harness.ctx)

  const health = await call(harness, '/net-hosts/api/health')
  assert.equal(health.statusCode, 200)
  assert.equal(JSON.parse(health.body).ok, true)

  const page = await call(harness, '/net-hosts/')
  assert.equal(page.statusCode, 200)
  assert.match(page.headers['content-type'], /text\/html/)
  assert.ok(page.body.includes('/net-hosts/ui.js'))

  const ui = await call(harness, '/net-hosts/ui.js')
  assert.equal(ui.statusCode, 200)
  assert.match(ui.headers['content-type'], /text\/javascript/)
  assert.ok(ui.body.includes('__DSH_NET_HOSTS_UI__'))

  const launcher = await call(harness, '/net-hosts/launcher.js')
  assert.equal(launcher.statusCode, 200)
  assert.ok(launcher.body.includes('__dshNetHostsMounted'))
})

test('拒绝非回环 Host、跨站 Origin 与跨站 fetch', async () => {
  const harness = createContext()
  apply(harness.ctx)

  for (const headers of [
    { host: 'evil.example.com' },
    { host: '127.0.0.1:55436', origin: 'http://evil.example.com' },
    { host: '127.0.0.1:55436', 'sec-fetch-site': 'cross-site' },
  ]) {
    const res = await call(harness, '/net-hosts/api/snapshot', headers)
    assert.equal(res.statusCode, 403, JSON.stringify(headers))
    assert.equal(res.body, '')
  }

  const ok = await call(harness, '/net-hosts/api/snapshot', {
    host: '127.0.0.1:55436',
    origin: 'http://127.0.0.1:55436',
    'sec-fetch-site': 'same-origin',
  })
  assert.equal(ok.statusCode, 200)
})

test('注册 net_connections 工具并可执行', async () => {
  const harness = createContext()
  apply(harness.ctx)
  assert.equal(harness.tools.length, 1)

  const tool = harness.tools[0]
  assert.equal(tool.name, 'net_connections')
  assert.equal(tool.parameters.type, 'object')
  assert.deepEqual(tool.parameters.properties.state.enum, ['all', 'established', 'listening'])
  assert.equal(tool.parameters.additionalProperties, false)
  assert.equal(typeof tool.execute, 'function')

  const text = await tool.execute({ state: 'listening', limit: 3 })
  assert.match(text, /个套接字/)
  assert.ok(text.split('\n').length <= 4)

  const filtered = await tool.execute({ scope: 'public', limit: 2 })
  assert.match(filtered, /^共 \d+ 个套接字/)

  const content = tool.output.render({}, text)
  assert.equal(content[0].type, 'text')
  assert.equal(content[0].text, text)
})

test('dispose 时清理路由与注入', () => {
  const harness = createContext()
  apply(harness.ctx)
  assert.ok(harness.routes.length > 0)
  harness.disposeAll()
  assert.equal(harness.routes.length, 0)
  assert.equal(harness.tapIndexFns.length, 0)
})
