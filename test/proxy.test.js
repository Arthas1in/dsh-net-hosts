import assert from 'node:assert/strict'
import test from 'node:test'

import { applyProxyTargets } from '../lib/collect.js'
import {
  endpointFromController,
  normalizeProxyConnections,
  parseProxyConfig,
} from '../lib/proxy.js'

test('parseProxyConfig 从 Clash 配置里抠出控制器与代理端口', () => {
  const text = [
    '# Clash Verge Rev',
    'mixed-port: 7897',
    'port: 7899',
    'socks-port: 7898',
    'redir-port: 7895',
    'external-controller: 127.0.0.1:9097',
    'external-controller-unix: /tmp/verge-mihomo.sock',
    'secret: "set-your-secret"  # 默认占位',
    'allow-lan: false',
  ].join('\n')
  assert.deepEqual(parseProxyConfig(text), {
    controller: '127.0.0.1:9097',
    socket: '/tmp/verge-mihomo.sock',
    secret: 'set-your-secret',
    ports: [7897, 7899, 7898, 7895],
  })
  assert.equal(parseProxyConfig('mode: rule'), null)
})

test('endpointFromController 支持 host:port / URL / unix socket', () => {
  assert.deepEqual(endpointFromController('127.0.0.1:9097'), {
    kind: 'http', host: '127.0.0.1', port: 9097, label: '127.0.0.1:9097',
  })
  assert.deepEqual(endpointFromController('http://127.0.0.1:9090'), {
    kind: 'http', host: '127.0.0.1', port: 9090, label: '127.0.0.1:9090',
  })
  assert.deepEqual(endpointFromController('unix:///tmp/mihomo.sock'), {
    kind: 'unix', socketPath: '/tmp/mihomo.sock', label: 'unix:/tmp/mihomo.sock',
  })
  assert.equal(endpointFromController(''), null)
})

test('normalizeProxyConnections 只保留有 sourcePort 的连接，并丢弃 IP 形式的主机名', () => {
  const list = [
    {
      id: 'abc',
      rule: 'Rule',
      chains: ['Proxy', 42],
      metadata: {
        sourcePort: '51766',
        sourceIP: '192.0.2.20',
        host: 'www.example.com',
        destinationIP: '203.0.113.12',
        destinationPort: '443',
        inboundPort: '7897',
        network: 'tcp',
        processPath: '/Applications/Safari.app',
      },
    },
    {
      id: 'def',
      metadata: { sourcePort: 51767, host: '203.0.113.12', destinationIP: '203.0.113.12', destinationPort: 443 },
    },
    {
      id: 'ghi',
      metadata: { sourcePort: 51768, host: 'imap.example.com', destinationIP: '', remoteDestination: '203.0.113.61', destinationPort: 993 },
    },
    { id: 'bad' },
  ]
  const out = normalizeProxyConnections(list)
  assert.equal(out.length, 3)
  assert.deepEqual(out[0], {
    id: 'abc',
    sourcePort: 51766,
    sourceIP: '192.0.2.20',
    host: 'www.example.com',
    destinationIP: '203.0.113.12',
    destinationPort: 443,
    inboundPort: 7897,
    network: 'tcp',
    processPath: '/Applications/Safari.app',
    rule: 'Rule',
    chains: ['Proxy'],
  })
  // host 与 destinationIP 相同时视为没有域名，交给 PTR 兜底。
  assert.equal(out[1].host, '')
  // mihomo 的域名连接：destinationIP 为空，IP 在 remoteDestination 里。
  assert.equal(out[2].destinationIP, '203.0.113.61')
  assert.equal(out[2].host, 'imap.example.com')
})

test('applyProxyTargets 用 sourcePort 把经代理的连接还原成域名', () => {
  const rows = [
    {
      id: 'a',
      local: { addr: '127.0.0.1', port: 51766, wildcard: false },
      remote: { addr: '127.0.0.1', port: 7897, wildcard: false },
      localScope: 'loopback',
      remoteScope: 'loopback',
      hostname: null,
    },
    {
      id: 'b',
      local: { addr: '127.0.0.1', port: 51767, wildcard: false },
      remote: { addr: '127.0.0.1', port: 7897, wildcard: false },
      localScope: 'loopback',
      remoteScope: 'loopback',
      hostname: null,
    },
    {
      id: 'c',
      local: { addr: '192.0.2.20', port: 51768, wildcard: false },
      remote: { addr: '203.0.113.34', port: 443, wildcard: false },
      localScope: 'lan',
      remoteScope: 'public',
      hostname: 'example.com',
    },
  ]
  const proxy = {
    available: true,
    ports: [7897],
    connections: [
      {
        sourcePort: 51766,
        host: 'www.example.com',
        destinationIP: '203.0.113.12',
        destinationPort: 443,
        rule: 'Rule',
        chains: ['Proxy'],
      },
      { sourcePort: 51767, host: '', destinationIP: '1.2.3.4', destinationPort: 443 },
      { sourcePort: 9999, host: 'noise.example', destinationIP: '1.1.1.1', destinationPort: 443 },
    ],
  }
  assert.equal(applyProxyTargets(rows, proxy), 2)

  assert.equal(rows[0].viaProxy, true)
  assert.equal(rows[0].hostname, 'www.example.com')
  assert.equal(rows[0].domain, 'www.example.com')
  assert.deepEqual(rows[0].target, { addr: '203.0.113.12', port: 443, host: 'www.example.com' })
  assert.equal(rows[0].targetScope, 'public')
  assert.deepEqual(rows[0].proxy, { rule: 'Rule', chains: ['Proxy'], processPath: '' })

  // 没有域名时仍然命中（目标 IP 可用），hostname 保持为空，交给 PTR。
  assert.equal(rows[1].viaProxy, true)
  assert.equal(rows[1].hostname, null)

  // 直连的公网连接不受影响。
  assert.equal(rows[2].viaProxy, undefined)
  assert.equal(rows[2].hostname, 'example.com')
})

test('applyProxyTargets 用 inboundPort 收紧端口匹配', () => {
  const rows = [
    {
      id: 'a',
      local: { addr: '127.0.0.1', port: 50000, wildcard: false },
      remote: { addr: '127.0.0.1', port: 7897, wildcard: false },
      localScope: 'loopback', remoteScope: 'loopback', hostname: null,
    },
    {
      id: 'b',
      local: { addr: '127.0.0.1', port: 50001, wildcard: false },
      remote: { addr: '127.0.0.1', port: 18787, wildcard: false },
      localScope: 'loopback', remoteScope: 'loopback', hostname: null,
    },
  ]
  const proxy = {
    available: true,
    ports: [],
    connections: [
      { sourcePort: 50000, host: 'a.example', destinationIP: '1.2.3.4', destinationPort: 443, inboundPort: 7897 },
      { sourcePort: 18787, host: 'b.example', destinationIP: '5.6.7.8', destinationPort: 443, inboundPort: 7897 },
    ],
  }
  // b 的行占用了 18787，但远端不是代理端口，不能误伤。
  assert.equal(applyProxyTargets(rows, proxy), 1)
  assert.equal(rows[0].hostname, 'a.example')
  assert.equal(rows[1].viaProxy, undefined)
})

test('applyProxyTargets 只认代理端口的连接，代理不可用时不动数据', () => {
  const rows = [{
    id: 'a',
    local: { addr: '127.0.0.1', port: 51766, wildcard: false },
    remote: { addr: '127.0.0.1', port: 7897, wildcard: false },
    localScope: 'loopback',
    remoteScope: 'loopback',
    hostname: null,
  }]
  const conn = { sourcePort: 51766, host: 'a.example', destinationIP: '1.2.3.4', destinationPort: 443 }
  assert.equal(applyProxyTargets(rows, { available: true, ports: [1080], connections: [conn] }), 0)
  assert.equal(applyProxyTargets(rows, { available: true, ports: [], connections: [conn] }), 1)
  assert.equal(applyProxyTargets(rows, { available: false, connections: [conn] }), 0)
  assert.equal(applyProxyTargets(rows, null), 0)
})
