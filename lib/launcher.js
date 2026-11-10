/**
 * dsh-net-hosts — 页面内的悬浮入口
 *
 * 由宿主注入（HTTP 版走 tapIndex，桌面版走 webserver/index-inject）。
 * 只做四件事：建一个 Shadow DOM 容器、按当前版本加载 ui.js、挂上左下角的
 * 「网络」按钮、偶尔问一下服务端界面有没有更新。任何一步失败都只 warn，
 * 绝不抛到页面上 —— DSH 外壳的生命周期比这个插件长。
 */
(function () {
  'use strict'

  if (typeof window === 'undefined' || typeof document === 'undefined') return
  if (window.__dshNetHostsMounted) return
  window.__dshNetHostsMounted = true

  var HOST_ID = 'dsh-net-hosts-surface'
  var UI_SRC = '/net-hosts/ui.js'
  var HEALTH = '/net-hosts/api/health'
  var started = false
  var stamp = ''

  function warn(error) {
    try { console.warn('[dsh-net-hosts]', error && error.message ? error.message : error) } catch { /* ignore */ }
  }

  function removeHost() {
    var host = document.getElementById(HOST_ID)
    if (host) host.remove()
  }

  function mount() {
    if (started) return
    started = true

    try {
      var parent = document.body || document.documentElement
      if (!parent) { started = false; return }

      removeHost()
      var host = document.createElement('div')
      host.id = HOST_ID
      host.setAttribute('data-dsh-plugin', 'net-hosts')
      parent.appendChild(host)

      var script = document.createElement('script')
      script.src = stamp ? UI_SRC + '?v=' + encodeURIComponent(stamp) : UI_SRC
      script.async = true
      script.onload = function () {
        try {
          if (!window.__DSH_NET_HOSTS_UI__) throw new Error('ui.js 未导出 __DSH_NET_HOSTS_UI__')
          window.__dshNetHostsApi = window.__DSH_NET_HOSTS_UI__.mountLauncher(host)
          window.__dshNetHostsLauncher = 1
          window.__dshNetHostsUiStamp = stamp
        } catch (error) {
          warn(error)
          try { host.remove() } catch { /* ignore */ }
          started = false
        }
      }
      script.onerror = function () {
        warn('ui.js 加载失败')
        try { host.remove() } catch { /* ignore */ }
        started = false
      }
      ;(document.head || document.documentElement).appendChild(script)
    } catch (error) {
      warn(error)
      started = false
    }
  }

  function reload(next) {
    stamp = next || ''
    started = false
    window.__dshNetHostsLauncher = 0
    removeHost()
    mount()
  }

  // 界面脚本不是 ESM 模块，插件的热重载不会替换它；用 mtime 指纹判断有没有新版本。
  function watch() {
    setInterval(function () {
      try {
        fetch(HEALTH, { cache: 'no-store' }).then(function (response) { return response.json() }).then(function (data) {
          if (data && data.ok && data.ui && data.ui !== stamp) reload(data.ui)
        }).catch(function () { /* 服务没起来时安静等待下一轮 */ })
      } catch { /* ignore */ }
    }, 45000)
  }

  function boot() {
    var run = function () {
      try {
        fetch(HEALTH, { cache: 'no-store' }).then(function (response) { return response.json() }).then(function (data) {
          if (data && data.ok && data.ui) stamp = data.ui
        }).catch(function () { /* 拿不到指纹就直接加载 */ }).then(function () {
          mount()
          watch()
        })
      } catch {
        mount()
        watch()
      }
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run, { once: true })
    } else {
      run()
    }
  }

  boot()
})()
