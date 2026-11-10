import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifyAddress,
  collectSnapshot,
  decodeLsofText,
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
    'n192.168.1.20:51766->93.184.216.34:443',
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
    local: { addr: '192.168.1.20', port: 51766, wildcard: false },
    remote: { addr: '93.184.216.34', port: 443, wildcard: false },
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
  assert.equal(classifyAddress('192.168.1.5'), 'lan')
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
