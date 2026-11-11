import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'

/**
 * 在假的浏览器环境里加载 lib/ui.js，把内部纯函数暴露出来喂两份快照。
 * 验证旧宿主（数据层 0.4.x、无 events / owner*）时，界面侧能自己
 * 推导新连接事件，且刷新页面后 sessionStorage 里的历史不会丢。
 */
function loadUI(storage) {
  const document = {
    createElement: () => ({ style: {}, classList: { add() {} }, appendChild() {}, setAttribute() {} }),
    head: { appendChild() {} },
    body: { appendChild() {} },
    addEventListener() {},
    removeEventListener() {},
  }
  const sandbox = {
    console,
    document,
    localStorage: storage,
    sessionStorage: storage,
    CustomEvent: class CustomEvent { constructor(type) { this.type = type } },
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    Notification: undefined,
  }
  sandbox.window = sandbox
  vm.createContext(sandbox)
  const code = fs.readFileSync(new URL('../lib/ui.js', import.meta.url), 'utf8')
  // 仅测试用：把 IIFE 内部函数挂到 window。
  const patched = code.replace(
    'window.__DSH_NET_HOSTS_UI__ = { mount: mountPanel, mountLauncher }',
    'window.__test_resolve = resolveSnapshotEvents; window.__test_view = createViewModel(); window.__DSH_NET_HOSTS_UI__ = { mount: mountPanel, mountLauncher }',
  )
  vm.runInContext(patched, sandbox)
  return {
    resolve: sandbox.window.__test_resolve,
    view: sandbox.window.__test_view,
  }
}

function makeStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  }
}

function row(id, extra = {}) {
  return {
    id,
    pid: 100,
    process: 'DemoApp',
    proto: 'TCP',
    state: 'ESTABLISHED',
    local: { addr: '192.0.2.10', port: 51000, wildcard: false },
    remote: { addr: '203.0.113.9', port: 443, wildcard: false },
    localScope: 'lan',
    remoteScope: 'public',
    hostname: 'example.com',
    ...extra,
  }
}

function snapshot(ids, ts) {
  return {
    ok: true,
    ts,
    summary: { total: ids.length, established: ids.length, listening: 0, hosts: 0, externalHosts: 0, processes: 0, udp: 0, inbound: 0, outbound: 0 },
    rows: ids.map((id) => row(id)),
    hosts: [],
    interfaces: [],
    localNames: {},
  }
}

test('旧宿主无 events 时，界面侧按 id 差集生成秒级事件', () => {
  const { resolve, view } = loadUI(makeStorage())

  const first = snapshot(['a'], 1700000000000)
  resolve(first, view)
  assert.equal(first.events.length, 0, '第一份快照只做基线，不刷历史')

  const second = snapshot(['a', 'b'], 1700000002000)
  resolve(second, view)
  assert.equal(second.events.length, 1)
  const event = second.events[0]
  assert.equal(event.id, 'b')
  assert.equal(event.ts, 1700000002000)
  assert.equal(event.ownerName, 'DemoApp')
  assert.equal(event.ownerKey, 'app:demoapp')
  assert.equal(event.host, 'example.com')
  assert.equal(event.addr, '203.0.113.9')
  assert.equal(event.port, 443)
  assert.equal(event.scope, 'public')
  assert.equal(event.viaProxy, false)
})

test('回环连接不进时间线，刷新页面后历史仍在', () => {
  const storage = makeStorage()
  const { resolve, view } = loadUI(storage)

  resolve(snapshot(['a'], 1700000000000), view)
  const next = snapshot(['a', 'b'], 1700000002000)
  next.rows.push(row('loop', { remoteScope: 'loopback', remote: { addr: '127.0.0.1', port: 7897, wildcard: false } }))
  resolve(next, view)
  assert.equal(next.events.length, 1, 'loopback 被跳过')
  assert.equal(next.events[0].id, 'b')

  // 模拟 ⌘R：新 JS 上下文，但 sessionStorage 内容保留
  const { resolve: resolve2, view: view2 } = loadUI(storage)
  const afterReload = snapshot(['a', 'b'], 1700000004000)
  resolve2(afterReload, view2)
  assert.equal(afterReload.events.length, 1, '刷新后时间线不清空')
  assert.equal(afterReload.events[0].id, 'b')
})

test('代理连接优先用真实目的地址，com.apple 进程归并到系统组件', () => {
  const { resolve, view } = loadUI(makeStorage())

  resolve(snapshot(['a'], 1700000000000), view)
  const proxied = snapshot(['a'], 1700000002000)
  proxied.rows.push(row('p', {
    process: 'com.apple.WebKit.Networking',
    remote: { addr: '127.0.0.1', port: 7897, wildcard: false },
    remoteScope: 'loopback',
    viaProxy: true,
    target: { addr: '203.0.113.77', port: 443 },
    targetScope: 'public',
    domain: 'qwenwork.cn',
  }))
  resolve(proxied, view)
  assert.equal(proxied.events.length, 1)
  const event = proxied.events[0]
  assert.equal(event.ownerName, '系统组件')
  assert.equal(event.host, 'qwenwork.cn')
  assert.equal(event.addr, '203.0.113.77')
  assert.equal(event.viaProxy, true)
  assert.equal(event.scope, 'public')
})

test('新版数据层自带 events 时，界面侧不覆盖', () => {
  const { resolve, view } = loadUI(makeStorage())

  const data = snapshot(['a'], 1700000000000)
  const provided = [{ id: 'native', ts: 1700000000000, ownerName: '精确归并' }]
  data.events = provided
  resolve(data, view)
  assert.strictEqual(data.events, provided, '不得覆盖宿主提供的事件')
  assert.equal(data.events[0].ownerName, '精确归并')
})
