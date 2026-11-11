import assert from 'node:assert/strict'
import test from 'node:test'

import { ownerFromName,
  classifyAddress,
  collectSnapshot,
  connectionKey,
  decodeLsofText,
  diffConnections,
  parseEndpoint,
  parseLsofOutput,
  resetCache,
} from '../lib/collect.js'

test('decodeLsofText 还原中文进程名', () => {
  assert.equal(decodeLsofText('\\xE7\\xBD\\x91\\xE7\\xBB\\x9C'), '网络')
  assert.equal(decodeLsofText('Safari'), 'Safari')
  // 不完整的转义保持原样，不吞字符
  assert.equal(decodeLsofText('a\\xZZb'), 'a\\xZZb')
})

test('parseEndpoint 处理 IPv4 / IPv6 / 通配', () => {
  assert.deepEqual(parseEndpoint('127.0.0.1:8080'), { addr: '127.0.0.1', port: 8080, wildcard: false })
  assert.deepEqual(parseEndpoint('[::1]:443'), { addr: '::1', port: 443, wildcard: false })
  assert.deepEqual(parseEndpoint('[fe80::1%en0]:1024'), { addr: 'fe80::1%en0', port: 1024, wildcard: false })
  assert.deepEqual(parseEndpoint('*:5353'), { addr: '*', port: 5353, wildcard: true })
  assert.deepEqual(parseEndpoint('*:*'), { addr: '*', port: null, wildcard: true })
  assert.deepEqual(parseEndpoint('*'), { addr: '*', port: null, wildcard: true })
})

test('parseLsofOutput 解析连接 / 监听 / UDP，并过滤 ICMP', () => {
  const text = [
    'p1234',
    'cSafari',
    'f12',
    'PTCP',
    'n192.0.2.20:51766->203.0.113.34:443',
    'TST=ESTABLISHED',
    'f13',
    'PTCP',
    'n127.0.0.1:56070->127.0.0.1:7897',
    'TST=ESTABLISHED',
    'p99',
    'c\\xE7\\xBD\\x91\\xE7\\xBB\\x9C',
    'f5',
    'PUDP',
    'n*:5353',
    'p77',
    'cping',
    'f3',
    'PICMP',
    'n*',
    'p88',
    'cnode',
    'f9',
    'PTCP',
    'n[::1]:3000',
    'TST=LISTEN',
  ].join('\n')

  const rows = parseLsofOutput(text)
  assert.equal(rows.length, 4)
  assert.deepEqual(rows[0], {
    pid: 1234,
    process: 'Safari',
    fd: '12',
    proto: 'TCP',
    state: 'ESTABLISHED',
    type: 'IPv4',
    local: { addr: '192.0.2.20', port: 51766, wildcard: false },
    remote: { addr: '203.0.113.34', port: 443, wildcard: false },
  })
  assert.equal(rows[2].proto, 'UDP')
  assert.equal(rows[2].state, null)
  assert.equal(rows[2].process, '网络')
  assert.equal(rows[3].type, 'IPv6')
  assert.equal(rows[3].state, 'LISTEN')
})

test('classifyAddress 划分 loopback / lan / public', () => {
  assert.equal(classifyAddress('127.0.0.1'), 'loopback')
  assert.equal(classifyAddress('::1'), 'loopback')
  assert.equal(classifyAddress('::ffff:127.0.0.1'), 'loopback')
  assert.equal(classifyAddress('10.255.0.1'), 'lan')
  assert.equal(classifyAddress('10.0.0.8'), 'lan')
  assert.equal(classifyAddress('172.20.3.4'), 'lan')
  assert.equal(classifyAddress('100.64.0.1'), 'lan')
  assert.equal(classifyAddress('fe80::1%en0'), 'lan')
  assert.equal(classifyAddress('fd00::5'), 'lan')
  assert.equal(classifyAddress('8.8.8.8'), 'public')
  assert.equal(classifyAddress('2001:4860:4860::8888'), 'public')
  assert.equal(classifyAddress('*'), 'wildcard')
})

const liveTest = process.platform === 'darwin' ? test : test.skip

liveTest('collectSnapshot 读取真实 lsof 输出', async () => {
  resetCache()
  const snapshot = await collectSnapshot({ fresh: true, maxAgeMs: 0 })
  assert.equal(snapshot.ok, true)
  assert.ok(Array.isArray(snapshot.rows))
  assert.ok(snapshot.rows.length > 0, '本机应当至少有一个套接字')
  assert.ok(snapshot.summary.total >= snapshot.summary.established)
  for (const row of snapshot.rows) {
    assert.ok(['TCP', 'UDP'].includes(row.proto))
    assert.ok(['IPv4', 'IPv6'].includes(row.type))
    assert.ok(row.local && typeof row.local.addr === 'string')
    assert.ok(Number.isInteger(row.pid) || row.pid === null)
    assert.ok(['inbound', 'outbound', 'listen'].includes(row.direction))
  }
  // 监听行没有对端
  for (const row of snapshot.rows) {
    if (row.state === 'LISTEN') assert.equal(row.remote, null)
  }
})

test('helper 进程归并回宿主 App', () => {
  assert.equal(ownerFromName('Google Chrome Helper (Aperitif)').name, 'Google Chrome')
  assert.equal(ownerFromName('极空间 Helper').name, '极空间')
  assert.equal(ownerFromName('com.apple.WebKit.Networking').name, '系统组件')
  const fromPath = ownerFromName('Electron', '/Applications/WorkBuddy.app/Contents/MacOS/WorkBuddy')
  assert.equal(fromPath.name, 'WorkBuddy')
  assert.equal(fromPath.helper, true)
  assert.equal(ownerFromName('Safari').helper, false)
})

function conn(over = {}) {
  return {
    id: 'TCP:100:192.0.2.10:51000:203.0.113.9:443:ESTABLISHED',
    pid: 100,
    process: 'DemoApp',
    proto: 'TCP',
    state: 'ESTABLISHED',
    local: { addr: '192.0.2.10', port: 51000, wildcard: false },
    remote: { addr: '203.0.113.9', port: 443, wildcard: false },
    remoteScope: 'public',
    hostname: 'example.com',
    ownerName: 'DemoApp',
    ownerKey: 'app:demoapp',
    ...over,
  }
}

test('connectionKey 不含 state，握手状态变化不会算成新连接', () => {
  const syn = conn({ state: 'SYN_SENT', id: 'a' })
  const established = conn({ state: 'ESTABLISHED', id: 'b' })
  assert.equal(connectionKey(syn), connectionKey(established))
  assert.equal(connectionKey({ proto: 'TCP', pid: 1, local: { addr: 'x', port: 1 }, remote: null }), '')
})

test('diffConnections 首帧只做基线，之后给出建立与断开事件', () => {
  const first = diffConnections([conn()], null, 1700000000000)
  assert.equal(first.events.length, 0, '基线不刷历史')
  assert.equal(first.live.size, 1)

  const opened = diffConnections([conn(), conn({ pid: 200, id: 'x', local: { addr: '192.0.2.10', port: 51001 } })], first.live, 1700000002000)
  assert.equal(opened.events.length, 1)
  assert.equal(opened.events[0].kind, 'open')
  assert.equal(opened.events[0].ts, 1700000002000)
  assert.equal(opened.events[0].pid, 200)
  assert.equal(opened.live.size, 2)

  const closed = diffConnections([conn()], opened.live, 1700000009000)
  assert.equal(closed.events.length, 1)
  const event = closed.events[0]
  assert.equal(event.kind, 'close')
  assert.equal(event.pid, 200)
  assert.equal(event.ts, 1700000009000)
  assert.equal(event.durationMs, 7000)
  assert.equal(event.host, 'example.com')
  assert.equal(closed.live.size, 1)
})

test('diffConnections 握手状态变化不产生事件，回环连接被跳过', () => {
  const first = diffConnections([conn({ state: 'SYN_SENT' })], null, 1700000000000)
  const same = diffConnections([conn({ state: 'ESTABLISHED' })], first.live, 1700000002000)
  assert.equal(same.events.length, 0, '只是状态变了')

  const loop = conn({ remote: { addr: '127.0.0.1', port: 7897 }, remoteScope: 'loopback', id: 'loop', pid: 300 })
  const withLoop = diffConnections([conn({ state: 'ESTABLISHED' }), loop], same.live, 1700000004000)
  assert.equal(withLoop.events.length, 0, '回环不进时间线')
  assert.equal(withLoop.live.size, 1)
})
