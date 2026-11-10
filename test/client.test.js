import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'

function loadBundle() {
  const code = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  let factory
  const registered = []
  const events = []
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children } }),
    useRef: () => ({ current: null }),
    useEffect: () => {},
  }
  const head = { appendChild() {} }
  const sandbox = {
    console,
    CustomEvent: class CustomEvent { constructor(type) { this.type = type } },
    document: { createElement: () => ({}), head },
    window: {
      dispatchEvent: (event) => events.push(event.type),
      addEventListener() {},
    },
  }
  sandbox.window.__ModuleLoader__ = { load: ({ id, factory: fn }) => { sandbox.loadedId = id; factory = fn } }
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox)
  return { factory, sandbox, registered, events, React }
}

test('client bundle 注册侧边栏入口与主面板', () => {
  const { factory, sandbox, registered, events } = loadBundle()
  const plugin = factory((name) => {
    if (name === 'react') return { createElement: (type) => ({ type }), useRef: () => ({ current: null }), useEffect: () => {} }
    throw new Error(`unexpected module ${name}`)
  })
  assert.equal(sandbox.loadedId, 'dsh-net-hosts')
  assert.equal(plugin.name, 'dsh-net-hosts')
  assert.equal(Array.from(plugin.inject).join(','), 'slots')

  const ctx = {
    effect: (fn) => { fn() },
    slots: {
      inject: (_slot, cb) => cb(),
      register: (options, component) => {
        registered.push({ options, component })
        return () => {}
      },
    },
  }
  plugin.apply(ctx)

  const sidebar = registered.find((entry) => entry.options.name === 'sidebar.panellist')
  assert.ok(sidebar, 'missing sidebar.panellist registration')
  assert.equal(sidebar.options.id, 'dsh-net-hosts')
  assert.equal(sidebar.options.order, 30)
  assert.equal(sidebar.options.label(), '网络连接')

  const main = registered.find((entry) => entry.options.name === 'main')
  assert.ok(main, 'missing main panel registration')
  assert.equal(main.options.key, 'dsh-net-hosts')

  // 图标组件能渲染出 svg，主面板能渲染出容器
  assert.equal(sidebar.component({ size: 16 }).type, 'svg')
  assert.equal(main.component().type, 'div')

  // 通知悬浮胶囊让位
  assert.equal(sandbox.window.__dshNetHostsNativePanel, true)
  assert.deepEqual(events, ['dsh-net-hosts:native-panel'])
})

test('package.json 声明了 web 客户端与 ./client 导出', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.exports['./client'], './lib/client.js')
  assert.ok(fs.existsSync(new URL('../lib/client.js', import.meta.url)))
})
