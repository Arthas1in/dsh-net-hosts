/**
 * dsh-net-hosts — 浏览器半区（侧边栏入口）
 *
 * 这个文件是 DSH 的 client bundle 格式（不是 ESM）：由宿主通过 /plugins 提供，
 * 页面启动时先注册 factory，真正执行时用平台模块表里的 react。
 *
 * 它做两件事：
 *   1. 在左侧栏注册一个「网络」面板项（sidebar.panellist），图标是地球；
 *   2. 在主区域注册同名主面板（main），里面挂载已有的无框架界面（ui.js，embedded 模式）。
 *
 * 这样网络面板就成了 DSH 的一个原生侧边栏页面，而不是浮在页面上的弹窗。
 * 悬浮胶囊仍然保留；检测到本文件生效后，胶囊会自动让位（见 ui.js 里的 native 事件）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-net-hosts',
  factory: (require) => {
    const React = require('react')

    let uiPromise = null

    function loadUi() {
      if (window.__DSH_NET_HOSTS_UI__) return Promise.resolve(window.__DSH_NET_HOSTS_UI__)
      if (uiPromise) return uiPromise
      uiPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script')
        script.src = `/net-hosts/ui.js?v=${Date.now()}`
        script.async = true
        script.onload = () => {
          if (window.__DSH_NET_HOSTS_UI__) resolve(window.__DSH_NET_HOSTS_UI__)
          else reject(new Error('ui.js 未导出 __DSH_NET_HOSTS_UI__'))
        }
        script.onerror = () => reject(new Error('ui.js 加载失败'))
        ;(document.head || document.documentElement).appendChild(script)
      })
      return uiPromise
    }

    function NetworkGlyph(props) {
      const size = (props && props.size) || 18
      return React.createElement(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        React.createElement('circle', { cx: 12, cy: 12, r: 9 }),
        React.createElement('path', { d: 'M3.6 9h16.8M3.6 15h16.8' }),
        React.createElement('path', { d: 'M12 3c2.5 2.6 3.8 5.7 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3Z' }),
      )
    }

    function NetworkPanel() {
      const hostRef = React.useRef(null)
      React.useEffect(() => {
        let stopped = false
        let api = null
        loadUi().then((ui) => {
          if (stopped || !hostRef.current) return
          api = ui.mount(hostRef.current, { embedded: true })
        }).catch((error) => {
          try { console.warn('[dsh-net-hosts] 面板加载失败：', error && error.message) } catch { /* ignore */ }
        })
        return () => {
          stopped = true
          if (api) api.destroy()
        }
      }, [])
      return React.createElement('div', {
        ref: hostRef,
        className: 'dsh-net-hosts-embed',
        style: { width: '100%', height: '100%', minHeight: 0, position: 'relative' },
      })
    }

    const plugin = {
      name: 'dsh-net-hosts',
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'dsh-net-hosts',
          order: 30,
          label: () => '网络连接',
        }, NetworkGlyph)), 'dsh-net-hosts: sidebar entry')

        ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'dsh-net-hosts',
        }, NetworkPanel)), 'dsh-net-hosts: main panel')

        // 两个入口都注册成功后，才告诉页面里的悬浮胶囊退场；
        // 注册失败就让胶囊留着当回退入口。
        try {
          window.__dshNetHostsNativePanel = true
          window.dispatchEvent(new CustomEvent('dsh-net-hosts:native-panel'))
        } catch { /* ignore */ }
      },
    }

    return plugin
  },
})
