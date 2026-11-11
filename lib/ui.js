/**
 * dsh-net-hosts — 客户端界面（无框架、单文件、Shadow DOM 隔离）
 *
 * 由 launcher.js 通过 `/net-hosts/ui.js` 加载，暴露两个入口：
 *   mountLauncher(shadowRoot)  —— 页面右下/左下角的悬浮入口 + 弹层
 *   mount(target, {standalone}) —— 独立页面模式
 *
 * 所有样式都在 shadow root 内，不污染 DSH 页面；所有数据来自同源接口
 * `/net-hosts/api/snapshot`，因此桌面端（dsh-app:// + IPC 桥）也能直接复用。
 */
(function () {
  'use strict'

  if (window.__DSH_NET_HOSTS_UI__) return

  const REFRESH_MS = 2000
  const HISTORY_MAX = 60

  const SERVICE_PORTS = {
    20: 'FTP-Data', 21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS',
    67: 'DHCP', 68: 'DHCP', 80: 'HTTP', 110: 'POP3', 123: 'NTP', 135: 'MSRPC',
    137: 'NetBIOS', 138: 'NetBIOS', 139: 'NetBIOS', 143: 'IMAP', 161: 'SNMP',
    389: 'LDAP', 443: 'HTTPS', 445: 'SMB', 465: 'SMTPS', 500: 'IKE', 514: 'Syslog',
    587: 'SMTP', 631: 'IPP', 636: 'LDAPS', 853: 'DoT', 873: 'rsync', 993: 'IMAPS',
    995: 'POP3S', 1080: 'SOCKS', 1194: 'OpenVPN', 1883: 'MQTT', 3000: 'Dev',
    3306: 'MySQL', 3389: 'RDP', 4000: 'Dev', 5000: 'Dev', 5173: 'Vite',
    5353: 'mDNS', 5432: 'PostgreSQL', 5555: 'ADB', 5672: 'AMQP', 5900: 'VNC',
    6000: 'X11', 6379: 'Redis', 7000: 'AirPlay', 7890: 'Clash', 7891: 'Clash',
    7897: 'Clash', 8000: 'Dev', 8080: 'HTTP-Alt', 8081: 'HTTP-Alt', 8443: 'HTTPS-Alt',
    8686: 'AirPlay', 8888: 'Dev', 9000: 'Dev', 9090: 'Dev', 9091: 'Dev',
    9200: 'Elasticsearch', 11211: 'Memcached', 27017: 'MongoDB', 32400: 'Plex',
  }

  const STATES = {
    ESTABLISHED: { label: '已建立', tone: 'ok', rank: 0 },
    LISTEN: { label: '监听', tone: 'listen', rank: 1 },
    SYN_SENT: { label: '连接中', tone: 'wait', rank: 2 },
    SYN_RECEIVED: { label: '握手中', tone: 'wait', rank: 2 },
    CLOSE_WAIT: { label: '半关闭', tone: 'idle', rank: 3 },
    FIN_WAIT_1: { label: '关闭中', tone: 'idle', rank: 3 },
    FIN_WAIT_2: { label: '关闭中', tone: 'idle', rank: 3 },
    TIME_WAIT: { label: '等待回收', tone: 'idle', rank: 3 },
    LAST_ACK: { label: '关闭中', tone: 'idle', rank: 3 },
    CLOSED: { label: '已关闭', tone: 'idle', rank: 3 },
  }

  const CSS = `
  :host { all: initial; }
  :host(.nh-fixed) {
    position: fixed; inset: 0; z-index: 2147483000;
    pointer-events: none;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC",
      "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif;
  }
  :host(.nh-standalone) { display: block; min-height: 100%; }
  * { box-sizing: border-box; }

  .nh-shell {
    --nh-bg: #ffffff;
    --nh-bg-soft: #f7f8fa;
    --nh-bg-sunken: #f2f4f7;
    --nh-fg: #14161b;
    --nh-muted: #667085;
    --nh-faint: #98a2b3;
    --nh-border: #e6e8ee;
    --nh-border-strong: #d5d9e2;
    --nh-hover: #f4f6fa;
    --nh-accent: #3b6cf6;
    --nh-accent-soft: rgba(59, 108, 246, 0.10);
    --nh-green: #12a150;
    --nh-green-soft: rgba(18, 161, 80, 0.12);
    --nh-amber: #d97706;
    --nh-amber-soft: rgba(217, 119, 6, 0.13);
    --nh-red: #dc2626;
    --nh-purple: #7c5cff;
    --nh-purple-soft: rgba(124, 92, 255, 0.12);
    --nh-shadow: 0 28px 80px rgba(15, 20, 40, 0.26), 0 4px 14px rgba(15, 20, 40, 0.10);
    --nh-mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
    color-scheme: light;
  }
  @media (prefers-color-scheme: dark) {
    .nh-shell {
      --nh-bg: #17181d;
      --nh-bg-soft: #1d1f25;
      --nh-bg-sunken: #212329;
      --nh-fg: #eceef3;
      --nh-muted: #9ba3b4;
      --nh-faint: #6f7788;
      --nh-border: #2b2e37;
      --nh-border-strong: #3a3e49;
      --nh-hover: #23262e;
      --nh-accent: #7b9bff;
      --nh-accent-soft: rgba(123, 155, 255, 0.14);
      --nh-green: #3ddc88;
      --nh-green-soft: rgba(61, 220, 136, 0.14);
      --nh-amber: #f5a524;
      --nh-amber-soft: rgba(245, 165, 36, 0.14);
      --nh-red: #ff6b6b;
      --nh-purple: #a78bfa;
      --nh-purple-soft: rgba(167, 139, 250, 0.16);
      --nh-shadow: 0 30px 90px rgba(0, 0, 0, 0.62), 0 4px 16px rgba(0, 0, 0, 0.4);
      color-scheme: dark;
    }
  }

  /* ---------------- 悬浮入口 ---------------- */
  .nh-launcher-wrap {
    position: fixed; left: 18px; bottom: 18px; z-index: 2;
    display: flex; pointer-events: auto;
  }
  .nh-launcher-wrap.is-dragging { cursor: grabbing; }
  .nh-launcher-wrap.is-dragging .nh-launcher { transition: none; }
  .nh-launcher {
    position: relative;
    display: flex; align-items: center; gap: 8px;
    height: 38px; padding: 0 14px 0 11px;
    border: 1px solid var(--nh-border);
    border-radius: 999px;
    background: color-mix(in srgb, var(--nh-bg) 86%, transparent);
    color: var(--nh-fg);
    font: 500 13px/1 inherit;
    font-family: inherit;
    box-shadow: 0 6px 20px rgba(15, 20, 40, 0.12);
    backdrop-filter: blur(14px) saturate(1.4);
    -webkit-backdrop-filter: blur(14px) saturate(1.4);
    cursor: grab; pointer-events: auto; touch-action: none; user-select: none;
    transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease;
  }
  .nh-launcher-close {
    position: absolute; top: -7px; right: -7px;
    width: 17px; height: 17px; padding: 0; border-radius: 50%;
    border: 1px solid var(--nh-border);
    background: var(--nh-bg); color: var(--nh-muted);
    font: 600 11px/1 inherit; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    width: 18px; height: 18px;
    opacity: .62; transition: opacity .14s ease, transform .14s ease;
    box-shadow: 0 2px 6px rgba(15, 20, 40, .16);
  }
  .nh-launcher-wrap:hover .nh-launcher-close,
  .nh-launcher-close:hover,
  .nh-launcher-close:focus-visible { opacity: 1; }
  .nh-launcher-close:hover { color: var(--nh-fg); border-color: var(--nh-border-strong); }
  .nh-restore {
    position: fixed; left: 18px; bottom: 18px; z-index: 2;
    display: flex; align-items: center; gap: 10px;
    padding: 8px 10px 8px 12px; border-radius: 10px;
    background: color-mix(in srgb, var(--nh-fg) 92%, transparent);
    color: var(--nh-bg); font: 500 12px/1 inherit;
    box-shadow: 0 8px 22px rgba(15, 20, 40, .25);
    backdrop-filter: blur(8px);
    pointer-events: auto;
  }
  .nh-restore button {
    border: 0; border-radius: 6px; cursor: pointer;
    background: var(--nh-accent); color: #fff;
    font: 600 12px/1 inherit; padding: 6px 10px;
  }
  .nh-restore button:hover { filter: brightness(1.08); }
  .nh-launcher:hover { transform: translateY(-1px); box-shadow: 0 10px 26px rgba(15, 20, 40, .18); border-color: var(--nh-border-strong); }
  .nh-launcher:active { transform: translateY(0) scale(.98); }
  .nh-launcher svg { width: 17px; height: 17px; color: var(--nh-accent); }
  .nh-launcher .nh-lb-badge {
    min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px;
    display: none; align-items: center; justify-content: center;
    background: var(--nh-accent-soft); color: var(--nh-accent);
    font: 600 10.5px/1 inherit; font-variant-numeric: tabular-nums;
  }
  .nh-launcher.has-badge .nh-lb-badge { display: inline-flex; }

  /* ---------------- 遮罩与弹层 ---------------- */
  .nh-overlay {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
    background: rgba(9, 12, 20, 0.34);
    backdrop-filter: blur(5px);
    -webkit-backdrop-filter: blur(5px);
    opacity: 0; pointer-events: none;
    transition: opacity .18s ease;
  }
  .nh-overlay.open { opacity: 1; pointer-events: auto; }

  .nh-panel {
    display: flex; flex-direction: column;
    width: min(1120px, 94vw); height: min(790px, 90vh);
    background: var(--nh-bg);
    color: var(--nh-fg);
    border: 1px solid var(--nh-border);
    border-radius: 18px;
    position: relative;
    box-shadow: var(--nh-shadow);
    overflow: hidden;
    transform: translateY(10px) scale(.985);
    opacity: 0;
    transition: transform .2s cubic-bezier(.2,.9,.3,1), opacity .18s ease;
    font: 400 13px/1.45 inherit;
    font-family: inherit;
    letter-spacing: .1px;
  }
  .nh-overlay.open .nh-panel { transform: none; opacity: 1; }

  /* ---------------- 头部 ---------------- */
  .nh-head {
    display: flex; align-items: center; gap: 14px;
    padding: 16px 18px 14px;
    border-bottom: 1px solid var(--nh-border);
    background: linear-gradient(180deg, var(--nh-bg-soft), var(--nh-bg) 88%);
  }
  .nh-mark {
    width: 34px; height: 34px; flex: none; border-radius: 11px;
    display: grid; place-items: center;
    background: var(--nh-accent-soft); color: var(--nh-accent);
  }
  .nh-mark svg { width: 19px; height: 19px; }
  .nh-title { min-width: 0; }
  .nh-title h1 {
    margin: 0; font-size: 14.5px; font-weight: 650; letter-spacing: .2px;
    display: flex; align-items: center; gap: 8px;
  }
  .nh-title .nh-sub {
    margin: 3px 0 0; font-size: 11.5px; color: var(--nh-muted);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    font-variant-numeric: tabular-nums;
  }
  .nh-tag {
    font: 500 10.5px/1 inherit; color: var(--nh-muted);
    border: 1px solid var(--nh-border); border-radius: 6px;
    padding: 3px 6px; letter-spacing: .3px;
  }
  .nh-head-actions { margin-left: auto; display: flex; align-items: center; gap: 4px; }
  .nh-icon-btn {
    width: 32px; height: 32px; border-radius: 9px;
    display: grid; place-items: center;
    border: 1px solid transparent; background: transparent; color: var(--nh-muted);
    cursor: pointer; transition: background .14s, color .14s, border-color .14s;
  }
  .nh-icon-btn:hover { background: var(--nh-hover); color: var(--nh-fg); border-color: var(--nh-border); }
  .nh-icon-btn svg { width: 16px; height: 16px; }
  .nh-icon-btn.spin svg { animation: nh-spin .8s linear infinite; }
  @keyframes nh-spin { to { transform: rotate(360deg); } }

  /* ---------------- 统计 ---------------- */
  .nh-stats {
    display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)) 148px;
    gap: 1px; background: var(--nh-border);
    border-bottom: 1px solid var(--nh-border);
  }
  .nh-stat {
    background: var(--nh-bg); padding: 11px 16px 10px;
    display: flex; flex-direction: column; gap: 2px; min-width: 0;
  }
  .nh-stat b {
    font-size: 19px; font-weight: 650; line-height: 1.1;
    font-variant-numeric: tabular-nums; letter-spacing: -.2px;
  }
  .nh-stat span { font-size: 11px; color: var(--nh-muted); }
  .nh-stat[data-tone="ok"] b { color: var(--nh-green); }
  .nh-stat[data-tone="listen"] b { color: var(--nh-accent); }
  .nh-spark { background: var(--nh-bg); padding: 8px 12px; display: flex; flex-direction: column; justify-content: center; gap: 2px; }
  .nh-spark svg { width: 100%; height: 34px; display: block; overflow: visible; }
  .nh-spark small { font-size: 10px; color: var(--nh-faint); letter-spacing: .2px; }

  /* ---------------- 工具栏 ---------------- */
  .nh-toolbar {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 14px; border-bottom: 1px solid var(--nh-border);
    background: var(--nh-bg);
  }
  .nh-tabs { display: flex; gap: 2px; background: var(--nh-bg-sunken); padding: 3px; border-radius: 9px; }
  .nh-hint {
    margin: 0 18px 8px; padding: 7px 10px;
    background: var(--nh-accent-soft); color: var(--nh-fg);
    border-radius: 8px; font-size: 12px; line-height: 1.5;
  }
  .nh-hint b { font-weight: 600; color: var(--nh-accent); }
  .nh-when { color: var(--nh-faint); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .nh-rel { display: block; font-size: 10.5px; line-height: 1.4; color: var(--nh-faint); opacity: .85; }
  .nh-app-detail td { background: var(--nh-bg-soft); padding: 12px 16px 14px; }
  .nh-appdom-head { font-size: 12px; color: var(--nh-muted); margin-bottom: 8px; }
  .nh-appdom { max-height: 240px; overflow-y: auto; }
  .nh-mini-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .nh-mini-table .nh-chip { font-size: 11px; padding: 1px 6px; }
  .nh-mini-table th {
    text-align: left; font-weight: 500; color: var(--nh-muted);
    padding: 5px 8px; border-bottom: 1px solid var(--nh-border); white-space: nowrap;
  }
  .nh-mini-table td { padding: 5px 8px; border-bottom: 1px solid var(--nh-border); }
  .nh-mini-table tr:last-child td { border-bottom: none; }
  .nh-appdom-foot { margin-top: 8px; text-align: right; }
  .nh-linkbtn {
    border: none; background: none; color: var(--nh-accent);
    font: 500 12px/1 inherit; cursor: pointer; padding: 5px 2px;
  }
  .nh-linkbtn:hover { text-decoration: underline; }
  .nh-tab {
    border: 0; background: transparent; color: var(--nh-muted);
    font: 550 12px/1 inherit; font-family: inherit;
    padding: 7px 11px; border-radius: 7px; cursor: pointer;
    display: flex; align-items: center; gap: 6px;
    transition: background .14s, color .14s, box-shadow .14s;
  }
  .nh-tab .n {
    font: 500 10.5px/1 inherit; color: var(--nh-faint);
    font-variant-numeric: tabular-nums;
  }
  .nh-tab:hover { color: var(--nh-fg); }
  .nh-tab[aria-selected="true"] {
    background: var(--nh-bg); color: var(--nh-fg);
    box-shadow: 0 1px 3px rgba(15, 20, 40, .12);
  }
  .nh-tab[aria-selected="true"] .n { color: var(--nh-accent); }
  .nh-search {
    margin-left: auto; position: relative; display: flex; align-items: center;
    width: min(280px, 30vw);
  }
  .nh-search svg {
    position: absolute; left: 10px; width: 14px; height: 14px;
    color: var(--nh-faint); pointer-events: none;
  }
  .nh-search input {
    width: 100%; height: 32px; padding: 0 10px 0 30px;
    border: 1px solid var(--nh-border); border-radius: 8px;
    background: var(--nh-bg-soft); color: var(--nh-fg);
    font: 400 12.5px/1 inherit; font-family: inherit; outline: none;
    transition: border-color .14s, box-shadow .14s, background .14s;
  }
  .nh-search input::placeholder { color: var(--nh-faint); }
  .nh-search input:focus {
    border-color: var(--nh-accent); background: var(--nh-bg);
    box-shadow: 0 0 0 3px var(--nh-accent-soft);
  }
  .nh-select {
    height: 32px; padding: 0 26px 0 10px;
    border: 1px solid var(--nh-border); border-radius: 8px;
    background: var(--nh-bg-soft) url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888e9c' stroke-width='2.4' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 9px center;
    color: var(--nh-fg); font: 400 12px/1 inherit; font-family: inherit;
    appearance: none; -webkit-appearance: none; cursor: pointer; outline: none;
    transition: border-color .14s, background-color .14s;
  }
  .nh-select:hover { border-color: var(--nh-border-strong); }
  .nh-select:focus { border-color: var(--nh-accent); box-shadow: 0 0 0 3px var(--nh-accent-soft); }

  /* ---------------- 表格 ---------------- */
  .nh-body { position: relative; flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; }
  .nh-body::-webkit-scrollbar { width: 11px; height: 11px; }
  .nh-body::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, var(--nh-faint) 38%, transparent);
    border-radius: 8px; border: 3px solid var(--nh-bg);
  }
  .nh-body::-webkit-scrollbar-track { background: transparent; }

  table.nh-table {
    width: 100%; border-collapse: separate; border-spacing: 0;
    table-layout: fixed;
    font-size: 12.5px;
  }
  .nh-table thead th {
    position: sticky; top: 0; z-index: 1;
    background: var(--nh-bg-soft);
    border-bottom: 1px solid var(--nh-border);
    padding: 8px 12px; text-align: left;
    font: 550 11px/1.2 inherit; font-family: inherit;
    color: var(--nh-muted); letter-spacing: .25px;
    white-space: nowrap; user-select: none;
    cursor: pointer;
  }
  .nh-table thead th:hover { color: var(--nh-fg); }
  .nh-table thead th .ar { opacity: 0; margin-left: 3px; font-size: 9px; }
  .nh-table thead th.sorted { color: var(--nh-fg); }
  .nh-table thead th.sorted .ar { opacity: 1; color: var(--nh-accent); }
  .nh-table th:first-child, .nh-table td:first-child { padding-left: 16px; }
  .nh-table th:last-child, .nh-table td:last-child { padding-right: 16px; }

  .nh-row { cursor: default; }
  .nh-row td {
    padding: 7px 12px; border-bottom: 1px solid var(--nh-border);
    vertical-align: middle; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis; max-width: 0;
  }
  .nh-row:hover td { background: var(--nh-hover); }
  .nh-row.expanded td { background: var(--nh-hover); border-bottom-color: transparent; }
  .nh-row.is-clickable { cursor: pointer; }
  .nh-row:focus-visible { outline: 2px solid var(--nh-accent); outline-offset: -2px; }

  .nh-state { display: flex; align-items: center; gap: 7px; }
  .nh-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--nh-faint); }
  .nh-dot.ok { background: var(--nh-green); box-shadow: 0 0 0 3px var(--nh-green-soft); }
  .nh-dot.listen { background: var(--nh-accent); box-shadow: 0 0 0 3px var(--nh-accent-soft); }
  .nh-dot.wait { background: var(--nh-amber); box-shadow: 0 0 0 3px var(--nh-amber-soft); }
  .nh-dot.idle { background: var(--nh-faint); }
  .nh-dot.udp { background: var(--nh-purple); box-shadow: 0 0 0 3px var(--nh-purple-soft); }
  .nh-state .lbl { font-weight: 500; }
  .nh-dir {
    font-size: 9.5px; font-weight: 500; letter-spacing: .2px;
    padding: 2px 4px; border-radius: 4px; color: var(--nh-faint);
    border: 1px solid var(--nh-border);
  }
  .nh-dir.in { color: var(--nh-amber); border-color: color-mix(in srgb, var(--nh-amber) 30%, transparent); background: var(--nh-amber-soft); }

  .nh-proc { display: flex; align-items: baseline; gap: 7px; min-width: 0; }
  .nh-proc .nm { font-weight: 500; overflow: hidden; text-overflow: ellipsis; }
  .nh-proc .pid { font: 400 10.5px/1 var(--nh-mono); color: var(--nh-faint); font-variant-numeric: tabular-nums; }

  .nh-addr { font-family: var(--nh-mono); font-size: 11.5px; letter-spacing: -.1px; display: flex; align-items: center; gap: 6px; }
  .nh-addr .ip { overflow: hidden; text-overflow: ellipsis; }
  .nh-addr .ip.is-host { color: var(--nh-muted); }
  .nh-addr .pt { color: var(--nh-muted); }
  .nh-addr.loopback .ip { color: var(--nh-muted); }
  .nh-addr.public .ip { color: var(--nh-fg); }
  .nh-addr.lan .ip { color: var(--nh-accent); }
  .nh-addr .star { color: var(--nh-faint); }

  .nh-hostname { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .nh-hostname .hn { overflow: hidden; text-overflow: ellipsis; }
  .nh-hostname .hn.none { color: var(--nh-faint); }
  .nh-hostname .hn.pending { color: var(--nh-faint); font-style: italic; }
  .nh-hostname .hn.domain { color: var(--nh-fg); font-weight: 500; }
  .nh-star { appearance:none; border:0; background:transparent; padding:0 2px; margin-left:2px; cursor:pointer; color:var(--nh-faint); font-size:13px; line-height:1; }
  .nh-star:hover { color:var(--nh-accent); }
  .nh-star.on { color:#e8a317; }
  .nh-watchonly.on { color:var(--nh-accent); border-color:var(--nh-accent); background:var(--nh-accent-soft); }
  .nh-events .nh-when { white-space:nowrap; }
  .nh-events .nh-life { white-space:nowrap; color:var(--nh-dim); font-variant-numeric: tabular-nums; }
  .nh-events tr.is-closed { opacity: .72; }
  .nh-events tr.is-closed .nh-life { color: var(--nh-faint); }
  .nh-mini.out { color: var(--nh-faint); background: transparent; border: 1px solid var(--nh-line); }
  .nh-hist { display:flex; flex-direction:column; gap:4px; padding:8px 10px 6px; border-bottom:1px solid var(--nh-line); }
  .nh-hist-label { font-size:11px; color:var(--nh-faint); }
  .nh-hist-bars { display:flex; align-items:flex-end; gap:2px; height:34px; }
  .nh-bar { flex:1; border-radius:2px 2px 0 0; background:var(--nh-accent); opacity:.6; }
  .nh-bar.is-empty { background:var(--nh-faint); opacity:.22; }
  .nh-mini {
    flex: none; font: 500 9.5px/1 inherit; letter-spacing: .2px;
    color: var(--nh-accent); background: var(--nh-accent-soft);
    border-radius: 4px; padding: 2.5px 4px;
  }
  .nh-ext {
    width: 12px; height: 12px; color: var(--nh-faint); opacity: 0;
    flex: none;
  }
  .nh-row:hover .nh-ext { opacity: 1; }

  .nh-tagp {
    font: 500 10px/1 var(--nh-mono); letter-spacing: .3px;
    color: var(--nh-muted); background: var(--nh-bg-sunken);
    border-radius: 4px; padding: 3px 5px;
  }
  .nh-tagp.udp { color: var(--nh-purple); background: var(--nh-purple-soft); }

  .nh-badge {
    display: inline-flex; align-items: center; gap: 4px;
    font: 500 10.5px/1 inherit; padding: 3px 6px; border-radius: 5px;
    letter-spacing: .2px;
  }
  .nh-badge.pub { color: var(--nh-amber); background: var(--nh-amber-soft); }
  .nh-badge.lan { color: var(--nh-accent); background: var(--nh-accent-soft); }
  .nh-badge.loc { color: var(--nh-muted); background: var(--nh-bg-sunken); }
  .nh-badge.warn { color: var(--nh-amber); background: var(--nh-amber-soft); }
  .nh-badge.safe { color: var(--nh-muted); background: var(--nh-bg-sunken); }
  .nh-badge.proxy { color: var(--nh-accent); background: var(--nh-accent-soft); }

  .nh-chips { display: flex; gap: 5px; flex-wrap: wrap; overflow: hidden; max-height: 34px; }
  .nh-chip {
    font: 400 10.5px/1 var(--nh-mono); color: var(--nh-muted);
    border: 1px solid var(--nh-border); border-radius: 5px;
    padding: 2px 5px; background: var(--nh-bg-soft);
  }
  .nh-chip.more { border-style: dashed; }
  .nh-chip.dom {
    color: var(--nh-accent); background: var(--nh-accent-soft);
    border-color: color-mix(in srgb, var(--nh-accent) 30%, var(--nh-border));
  }
  .nh-chip.ip { color: var(--nh-faint); border-style: dashed; }
  .nh-ips { font-size: 11.5px; color: var(--nh-muted); line-height: 1.55; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nh-chip.ptr { color: var(--nh-muted); }
  /* 软件视图里域名是主角，允许换行铺开，不裁掉第二行。 */
  .nh-apps .nh-chips { max-height: none; }

  .nh-empty {
    height: 100%; min-height: 220px;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 8px; color: var(--nh-faint); text-align: center; padding: 30px;
  }
  .nh-empty svg { width: 34px; height: 34px; opacity: .55; }
  .nh-empty b { color: var(--nh-muted); font-weight: 550; font-size: 13px; }
  .nh-empty span { font-size: 12px; max-width: 340px; line-height: 1.6; }

  .nh-skel { padding: 10px 16px; }
  .nh-skel i {
    display: block; height: 30px; margin-bottom: 8px; border-radius: 7px;
    background: linear-gradient(90deg, var(--nh-bg-soft) 25%, var(--nh-hover) 37%, var(--nh-bg-soft) 63%);
    background-size: 400% 100%; animation: nh-shimmer 1.2s ease infinite;
  }
  @keyframes nh-shimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }

  /* 详情行 */
  .nh-detail-cell { padding: 0 !important; border-bottom: 1px solid var(--nh-border); background: var(--nh-hover); }
  .nh-detail {
    display: flex; flex-wrap: wrap; align-items: center; gap: 8px 22px;
    padding: 11px 16px 13px; font-size: 11.5px; color: var(--nh-muted);
  }
  .nh-detail .kv { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
  .nh-detail .k { color: var(--nh-faint); font-size: 10.5px; letter-spacing: .3px; }
  .nh-detail .v { color: var(--nh-fg); font-family: var(--nh-mono); font-size: 11px; }
  .nh-detail .grow { flex: 1; }
  .nh-btn {
    height: 26px; padding: 0 9px; border-radius: 6px;
    border: 1px solid var(--nh-border); background: var(--nh-bg); color: var(--nh-fg);
    font: 500 11.5px/1 inherit; font-family: inherit; cursor: pointer;
    display: inline-flex; align-items: center; gap: 5px;
    transition: background .14s, border-color .14s;
  }
  .nh-btn:hover { background: var(--nh-hover); border-color: var(--nh-border-strong); }
  .nh-btn svg { width: 12px; height: 12px; color: var(--nh-muted); }

  /* ---------------- 错误条 ---------------- */
  .nh-error {
    display: flex; align-items: flex-start; gap: 8px;
    margin: 10px 14px 0; padding: 9px 11px;
    border: 1px solid color-mix(in srgb, var(--nh-red) 30%, transparent);
    background: color-mix(in srgb, var(--nh-red) 8%, transparent);
    color: var(--nh-red); border-radius: 8px; font-size: 12px;
  }
  .nh-error svg { width: 14px; height: 14px; flex: none; margin-top: 1px; }
  .nh-error .msg { flex: 1; line-height: 1.5; }
  .nh-error button {
    border: 0; background: transparent; color: inherit; font: inherit;
    text-decoration: underline; cursor: pointer; padding: 0;
  }

  /* ---------------- 底部 ---------------- */
  .nh-foot {
    display: flex; align-items: center; gap: 12px;
    padding: 8px 16px; border-top: 1px solid var(--nh-border);
    font-size: 11px; color: var(--nh-faint); background: var(--nh-bg);
  }
  .nh-live {
    display: inline-flex; align-items: center; gap: 6px;
    border: 0; background: transparent; color: var(--nh-muted);
    font: 500 11px/1 inherit; font-family: inherit; cursor: pointer; padding: 3px 6px;
    border-radius: 5px;
  }
  .nh-live:hover { background: var(--nh-hover); color: var(--nh-fg); }
  .nh-live i {
    width: 6px; height: 6px; border-radius: 50%; background: var(--nh-green);
    box-shadow: 0 0 0 3px var(--nh-green-soft);
  }
  .nh-live.paused i { background: var(--nh-faint); box-shadow: none; }
  .nh-live.paused { color: var(--nh-faint); }
  .nh-foot .spacer { flex: 1; }
  .nh-footbtn {
    border: 0; background: transparent; color: var(--nh-faint);
    font: 500 11px/1 inherit; font-family: inherit; cursor: pointer;
    padding: 3px 7px; border-radius: 6px;
  }
  .nh-footbtn:hover { color: var(--nh-fg); background: var(--nh-elev); }
  .nh-foot .note { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .nh-toast {
    position: absolute; left: 50%; bottom: 52px; transform: translate(-50%, 6px);
    background: color-mix(in srgb, var(--nh-fg) 92%, transparent);
    color: var(--nh-bg); font: 500 12px/1 inherit;
    padding: 8px 14px; border-radius: 8px; opacity: 0; pointer-events: none;
    transition: opacity .16s ease, transform .16s ease;
    box-shadow: 0 6px 18px rgba(0,0,0,.2);
  }
  .nh-toast.show { opacity: 1; transform: translate(-50%, 0); }

  /* 独立页面 */
  .nh-embed {
    height: 100%; min-height: 0;
    background: var(--nh-bg);
  }
  .nh-embed .nh-overlay { height: 100%; }
  .nh-embed .nh-panel {
    width: 100%; height: 100%;
    border: 0; border-radius: 0; box-shadow: none;
    transform: none; opacity: 1;
  }
  :host(.nh-embed-host) { display: block; height: 100%; min-height: 0; }
  .nh-standalone-wrap { padding: 28px 24px 34px; min-height: 100vh; background: var(--nh-bg-sunken); }
  .nh-standalone-wrap .nh-panel {
    width: min(1200px, 100%); height: calc(100vh - 62px); margin: 0 auto;
    transform: none; opacity: 1;
  }
  @media (max-width: 720px) {
    .nh-panel { width: 100vw; height: 100vh; border-radius: 0; border: 0; }
    .nh-overlay { padding: 0; }
    .nh-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .nh-spark { display: none; }
    .nh-search { width: 100%; }
    .nh-toolbar { flex-wrap: wrap; }
    .nh-toolbar .nh-tabs { order: 0; }
    .nh-select { order: 3; }
    .nh-search { order: 2; }
  }
  `

  /* ------------------------------------------------------------------ */
  /* 工具函数                                                            */
  /* ------------------------------------------------------------------ */

  const esc = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

  function fmtNum(n) {
    if (!Number.isFinite(n)) return '—'
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  }

  function relTime(ts) {
    if (!ts) return ''
    const diff = Date.now() - ts
    if (diff < 5000) return '刚刚'
    if (diff < 60000) return `${Math.floor(diff / 1000)} 秒前`
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
    return `${Math.floor(diff / 86400000)} 天前`
  }

  /** 精确到秒的时刻；不是今天就带上月-日。 */
  function clockTime(ts) {
    if (!ts) return '—'
    const d = new Date(ts)
    if (Number.isNaN(d.getTime())) return '—'
    const two = (n) => String(n).padStart(2, '0')
    const time = `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
    const today = new Date()
    return d.toDateString() === today.toDateString()
      ? time
      : `${two(d.getMonth() + 1)}-${two(d.getDate())} ${time}`
  }

  /** 连接存活时长：秒级以内不提分钟，超过一天才有天。 */
  function fmtDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '—'
    const total = Math.floor(ms / 1000)
    if (total < 1) return '<1 秒'
    if (total < 60) return `${total} 秒`
    const minutes = Math.floor(total / 60)
    const seconds = total % 60
    if (minutes < 60) return seconds ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    if (hours < 24) return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`
    return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`
  }

  /** 这条连接活了多久：断开用数据层给的 durationMs，仍在用「此刻 − 建立时间」。 */
  function connectionLife(event, now) {
    if (!event) return null
    if (event.kind === 'close') return { ms: event.durationMs, live: false }
    if (event.kind === 'open') return { ms: Math.max(0, (now || Date.now()) - event.ts), live: true }
    return null
  }

  /** 最近 N 小时每秒建立多少连接，给时间线做一条极简柱状图。 */
  function connectionHistogram(events, now, hours = 12) {
    const buckets = new Array(hours).fill(0)
    const end = now || Date.now()
    const hour = 3600000
    for (const event of events || []) {
      if (event.kind === 'close') continue
      if (!event.ts) continue
      const index = hours - 1 - Math.floor((end - event.ts) / hour)
      if (index < 0 || index >= hours) continue
      buckets[index] += 1
    }
    return buckets
  }

  /** 悬停时看完整日期与「多久之前」。 */
  function clockTitle(ts) {
    if (!ts) return ''
    const d = new Date(ts)
    if (Number.isNaN(d.getTime())) return ''
    const two = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${clockTime(ts)} · ${relTime(ts)}`
  }

  function endpointLabel(ep) {
    if (!ep) return '—'
    if (ep.addr === '*') return ep.port ? `*:${ep.port}` : '*'
    // 经代理且拿不到目标 IP 时，用域名顶上，避免显示成 ":993"。
    const raw = ep.addr || ep.host || ''
    if (!raw) return ep.port == null ? '—' : `:${ep.port}`
    const isV6 = raw.includes(':')
    const host = isV6 ? `[${raw}]` : raw
    return ep.port == null ? host : `${host}:${ep.port}`
  }

  function portService(port) {
    return port && SERVICE_PORTS[port] ? SERVICE_PORTS[port] : ''
  }

  function scopeOf(scope) {
    if (scope === 'loopback') return { key: 'loc', label: '本机' }
    if (scope === 'lan') return { key: 'lan', label: '局域网' }
    if (scope === 'public') return { key: 'pub', label: '公网' }
    return { key: 'loc', label: '任意' }
  }

  function stateMeta(row) {
    if (!row.state) return { label: 'UDP', tone: 'udp', rank: 4 }
    return STATES[row.state] || { label: row.state, tone: 'idle', rank: 5 }
  }

  function hostnameCell(row) {
    if (row.viaProxy) {
      const host = row.target && row.target.host
      if (host) return `<span class="hn domain" title="${esc(host)}">${esc(host)}</span><span class="nh-mini">代理</span>`
      return '<span class="hn none">经代理</span>'
    }
    if (!row.remote || !row.remote.addr || row.remote.addr === '*') {
      return '<span class="hn none">—</span>'
    }
    if (row.hostname) return `<span class="hn" title="${esc(row.hostname)}">${esc(row.hostname)}</span>`
    if (row.remoteScope === 'loopback') return '<span class="hn none">localhost</span>'
    if (row.dnsState === 'pending') return '<span class="hn pending">解析中…</span>'
    return '<span class="hn none">—</span>'
  }

  function copyText(text) {
    const value = String(text == null ? '' : text)
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value).catch(() => fallbackCopy(value))
    }
    return Promise.resolve(fallbackCopy(value))
  }

  function fallbackCopy(value) {
    try {
      const ta = document.createElement('textarea')
      ta.value = value
      ta.setAttribute('readonly', '')
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    } catch (err) { /* ignore */ }
  }

  const ICONS = {
    logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8"/><path d="M12 3c2.5 2.6 3.8 5.7 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3Z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-.6 4"/><path d="M20 5v6h-6"/></svg>',
    external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>',
    empty: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8"/><path d="M12 3c2.5 2.6 3.8 5.7 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3Z"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/></svg>',
  }

  /* ------------------------------------------------------------------ */
  /* 视图                                                                */
  /* ------------------------------------------------------------------ */

  const WATCH_KEY = 'dsh-net-hosts:watch'

  function loadWatch() {
    try {
      const value = JSON.parse(localStorage.getItem(WATCH_KEY) || '[]')
      return new Set(Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [])
    } catch (err) {
      return new Set()
    }
  }

  function saveWatch(set) {
    try { localStorage.setItem(WATCH_KEY, JSON.stringify([...set])) } catch (err) { /* ignore */ }
  }

  /* ---- 兼容旧宿主：界面侧自行推导「新连接事件」 ----
   * 0.5.x 数据层会直接在快照里给出 events / owner*。若宿主进程仍在跑 0.4.x
   * （HMR 不替换 host 模块，必须重启 DSH 才能升级），这里用连续快照的 id
   * 差集补出同样的事件，时间线、关注提醒、秒级时间立刻可用，不必重启。
   * 状态放在 sessionStorage，刷新页面（⌘R）不会把时间线清空。
   */
  const CLIENT_EVENT_KEY = 'dsh-net-hosts:client-events'
  const CLIENT_EVENT_MAX = 400

  function fallbackOwnerName(process) {
    const raw = process || '未知进程'
    if (raw.startsWith('com.apple.')) return '系统组件'
    return raw.replace(/\s+Helper(?:\s*\([^)]*\))?$/, '').replace(/\s+\(.*\)$/, '').trim() || raw
  }

  function loadClientState() {
    try {
      const value = JSON.parse(sessionStorage.getItem(CLIENT_EVENT_KEY) || 'null')
      if (!value || typeof value !== 'object') return null
      return {
        ids: new Set(Array.isArray(value.ids) ? value.ids.filter((x) => typeof x === 'string') : []),
        events: Array.isArray(value.events) ? value.events.filter((e) => e && typeof e === 'object') : [],
        baseline: Boolean(value.baseline),
      }
    } catch (err) {
      return null
    }
  }

  function saveClientState(state) {
    try {
      sessionStorage.setItem(CLIENT_EVENT_KEY, JSON.stringify({
        ids: [...state.ids].slice(-2000),
        events: state.events.slice(-CLIENT_EVENT_MAX),
        baseline: true,
      }))
    } catch (err) { /* 隐私模式忽略 */ }
  }

  function resolveSnapshotEvents(data, view) {
    // 新版数据层自带事件（含 ps 精确归并），不要覆盖。
    if (Array.isArray(data.events)) return
    if (!view.clientState) view.clientState = loadClientState() || { ids: new Set(), events: [], baseline: false }
    const state = view.clientState
    const hadBaseline = state.baseline || state.ids.size > 0
    const nextIds = new Set()
    const added = []
    for (const row of data.rows || []) {
      if (!row.remote || row.remote.wildcard || !row.remote.addr) continue
      nextIds.add(row.id)
      if (!hadBaseline || state.ids.has(row.id)) continue
      const scope = row.viaProxy ? (row.targetScope || row.remoteScope) : row.remoteScope
      if (scope === 'loopback') continue
      const ownerName = row.ownerName || fallbackOwnerName(row.process)
      added.push({
        ts: data.ts || Date.now(),
        id: row.id,
        pid: row.pid ?? null,
        process: row.process || '',
        ownerName,
        ownerKey: row.ownerKey || `app:${ownerName.toLowerCase()}`,
        host: (row.domain || row.hostname || (row.target && row.target.host) || row.remote.addr || '').trim(),
        addr: row.viaProxy && row.target ? (row.target.addr || row.remote.addr) : row.remote.addr,
        port: row.viaProxy && row.target ? (row.target.port ?? row.remote.port) : row.remote.port,
        scope,
        viaProxy: Boolean(row.viaProxy),
        state: row.state || '',
      })
    }
    state.baseline = true
    state.ids = nextIds
    if (hadBaseline) {
      for (const event of added) state.events.push(event)
      if (state.events.length > CLIENT_EVENT_MAX) state.events.splice(0, state.events.length - CLIENT_EVENT_MAX)
    }
    data.events = state.events.slice(-200).reverse()
    view.clientTick = (view.clientTick || 0) + 1
    if (!hadBaseline || added.length || view.clientTick % 10 === 0) {
      saveClientState({ ids: state.ids, events: state.events })
    }
  }

  function createViewModel() {
    return {
      clientState: null,
      clientTick: 0,
      snapshot: null,
      error: null,
      loading: true,
      tab: 'apps',
      appSort: 'connections',
      appSortDir: -1,
      search: '',
      scope: 'all',
      proto: 'all',
      sortKey: 'state',
      sortDir: 1,
      expanded: null,
      appOpen: null,
      watched: new Set(),
      watchOnly: false,
      notified: new Set(),
      mountedAt: 0,
      history: [],
      paused: false,
      lastOkAt: 0,
      lastErrorAt: 0,
      fetching: false,
      clockTimer: null,
    }
  }

  function filterRows(view) {
    const snapshot = view.snapshot
    if (!snapshot) return []
    const needle = view.search.trim().toLowerCase()
    const tokens = needle ? needle.split(/\s+/).filter(Boolean) : []
    return snapshot.rows.filter((row) => {
      if (view.proto !== 'all' && row.proto.toLowerCase() !== view.proto) return false
      if (view.scope !== 'all') {
        const target = row.viaProxy
          ? (row.targetScope || row.remoteScope)
          : (row.remote ? row.remoteScope : row.localScope)
        if (view.scope === 'loopback' && target !== 'loopback') return false
        if (view.scope === 'lan' && target !== 'lan') return false
        if (view.scope === 'public' && target !== 'public') return false
      }
      if (tokens.length) {
        const hay = [
          row.process, row.pid, row.proto, row.state,
          endpointLabel(row.local), endpointLabel(row.remote),
          row.hostname, row.local.addr, row.remote && row.remote.addr,
          row.remote && row.remote.port, row.local.port,
          row.target && row.target.host, row.target && row.target.addr, row.target && row.target.port,
        ].join(' ').toLowerCase()
        for (const token of tokens) if (!hay.includes(token)) return false
      }
      return true
    })
  }

  function sortRows(rows, view) {
    const dir = view.sortDir
    const key = view.sortKey
    const value = (row) => {
      switch (key) {
        case 'state': return stateMeta(row).rank
        case 'process': return (row.process || '').toLowerCase()
        case 'local': return `${row.local.addr}:${String(row.local.port).padStart(5, '0')}`
        case 'remote': {
          const ep = row.viaProxy && row.target ? row.target : row.remote
          return ep ? `${ep.addr}:${String(ep.port).padStart(5, '0')}` : ''
        }
        case 'hostname': return (row.hostname || '').toLowerCase()
        case 'proto': return row.proto
        case 'direction': return row.direction
        default: return 0
      }
    }
    const list = rows.slice()
    list.sort((a, b) => {
      const va = value(a)
      const vb = value(b)
      if (va < vb) return -1 * dir
      if (va > vb) return 1 * dir
      // 稳定次序：状态 → 进程 → 远端
      const ra = stateMeta(a).rank - stateMeta(b).rank
      if (ra) return ra
      const pa = String(a.process || '').localeCompare(String(b.process || ''))
      if (pa) return pa
      return String(a.remote ? a.remote.addr : '').localeCompare(String(b.remote ? b.remote.addr : ''))
    })
    return list
  }

  function visibleHosts(view) {
    const snapshot = view.snapshot
    if (!snapshot) return []
    const needle = view.search.trim().toLowerCase()
    return snapshot.hosts.filter((host) => {
      if (view.scope !== 'all' && host.scope !== view.scope) return false
      if (!needle) return true
      const hay = [host.addr, host.hostname || '', ...(host.ips || [])].join(' ').toLowerCase()
      return hay.includes(needle)
    })
  }

  function visibleListeners(view) {
    const snapshot = view.snapshot
    if (!snapshot) return []
    const needle = view.search.trim().toLowerCase()
    return snapshot.rows.filter((row) => {
      if (!row.remote && row.state !== 'LISTEN') return false
      if (row.state !== 'LISTEN') return false
      if (view.proto !== 'all' && row.proto.toLowerCase() !== view.proto) return false
      if (view.scope !== 'all') {
        const scope = row.localScope
        if (view.scope === 'loopback' && scope !== 'loopback') return false
        if (view.scope === 'lan' && scope !== 'lan') return false
        if (view.scope === 'public' && scope !== 'public' && scope !== 'wildcard') return false
      }
      if (!needle) return true
      const hay = [row.process, row.pid, row.proto, row.local.addr, row.local.port, portService(row.local.port)]
        .join(' ').toLowerCase()
      return hay.includes(needle)
    }).sort((a, b) => (a.local.port || 0) - (b.local.port || 0))
  }

  /**
   * 按「软件」聚合：每个进程占一行，列出它正在连接的域名。
   * 这是「本机软件 → 背后连的 host」的直接答案。
   */
  function visibleApps(view) {
    const snapshot = view.snapshot
    if (!snapshot) return []
    const tokens = view.search.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const apps = new Map()
    // 时间来自数据层的 hostMemory：同一个 host 的 firstSeen / lastSeen 跨轮询保留。
    const times = new Map()
    for (const host of snapshot.hosts || []) times.set(host.addr, host)
    for (const row of snapshot.rows) {
      if (row.state === 'LISTEN') continue
      if (view.proto !== 'all' && row.proto.toLowerCase() !== view.proto) continue
      const scope = row.viaProxy
        ? (row.targetScope || row.remoteScope)
        : (row.remote ? row.remoteScope : row.localScope)
      if (view.scope !== 'all' && scope !== view.scope) continue
      if (!row.remote && !row.viaProxy) continue
      const domain = row.viaProxy && row.target ? (row.target.host || '') : ''
      // `bogon` 是路由器给私网地址的占位 PTR，不是真正的域名，宁可显示 IP。
      const ptr = row.hostname && row.hostname !== '—' && row.hostname !== 'bogon' ? row.hostname : ''
      const host = domain || ptr
      // 旧版数据层没有 owner* 字段：在界面侧按进程名做一次兜底归并，
      // 让宿主进程还没热替换完成时不至于把每个 helper 都拆成一行。
      const fallbackName = row.process || '未知进程'
      const rollName = fallbackName.startsWith('com.apple.') ? '系统组件'
        : fallbackName.replace(/\s+Helper(?:\s*\([^)]*\))?$/, '').replace(/\s+\(.*\)$/, '').trim() || fallbackName
      const key = row.ownerKey || `app:${rollName.toLowerCase()}`
      let app = apps.get(key)
      if (!app) {
        app = {
          key, pid: row.pid, process: fallbackName, name: row.ownerName || rollName,
          processes: new Set(), system: Boolean(row.ownerSystem),
          domains: new Map(), ips: new Set(), ipScopes: new Map(), scopes: new Map(), allScopes: new Map(),
          connections: 0, established: 0, proxied: 0, firstSeen: 0, lastSeen: 0,
        }
        apps.set(key, app)
      }
      if (row.process) app.processes.add(row.process)
      const weight = row.fds > 1 ? row.fds : 1
      app.connections += weight
      if (row.state === 'ESTABLISHED') app.established += weight
      if (row.viaProxy) app.proxied += 1
      if (scope) app.allScopes.set(scope, (app.allScopes.get(scope) || 0) + 1)
      if (host) {
        const previous = app.domains.get(host) || { count: 0, proxy: false, firstSeen: 0, lastSeen: 0 }
        previous.count += 1
        previous.proxy = previous.proxy || Boolean(domain)
        const info = times.get(host)
        if (info) {
          if (info.firstSeen) previous.firstSeen = previous.firstSeen ? Math.min(previous.firstSeen, info.firstSeen) : info.firstSeen
          if (info.lastSeen) previous.lastSeen = Math.max(previous.lastSeen || 0, info.lastSeen)
        }
        app.domains.set(host, previous)
        // 经代理的域名同时记下真实目标 IP，让「主机 / IP」列也能用。
        if (row.viaProxy && row.target && row.target.addr) {
          app.ips.add(row.target.addr)
          app.ipScopes.set(row.target.addr, row.targetScope || scope)
        }
        if (previous.firstSeen) app.firstSeen = app.firstSeen ? Math.min(app.firstSeen, previous.firstSeen) : previous.firstSeen
        if (previous.lastSeen) app.lastSeen = Math.max(app.lastSeen || 0, previous.lastSeen)
        // 网络范围跟着「域名」走：一个软件的大量本地连接不应把它标成本机。
        if (scope) app.scopes.set(scope, (app.scopes.get(scope) || 0) + 1)
      } else if (row.remote && row.remote.addr) {
        app.ips.add(row.remote.addr)
        app.ipScopes.set(row.remote.addr, scope)
        const info = times.get(row.remote.addr)
        if (info) {
          if (info.firstSeen) app.firstSeen = app.firstSeen ? Math.min(app.firstSeen, info.firstSeen) : info.firstSeen
          if (info.lastSeen) app.lastSeen = Math.max(app.lastSeen || 0, info.lastSeen)
        }
      }
    }
    let list = [...apps.values()]
    if (view.watchOnly) list = list.filter((app) => view.watched.has(app.key))
    if (tokens.length) {
      list = list.filter((app) => {
        const hay = [app.name, app.process, ...[...app.processes], app.pid, ...[...app.domains.keys()], ...[...app.ips]].join(' ').toLowerCase()
        return tokens.every((token) => hay.includes(token))
      })
    }
    // 只显示还在活动的软件：纯 CLOSED 的进程不占版面。
    list = list.filter((app) => app.established > 0 || app.domains.size > 0)
    const dir = view.appSortDir || -1
    list.sort((a, b) => {
      if (view.appSort === 'name') return String(a.name).localeCompare(String(b.name)) * dir
      if (view.appSort === 'lastSeen') return ((a.lastSeen || 0) - (b.lastSeen || 0)) * dir
      if (view.appSort === 'domains') return ((a.domains.size - b.domains.size) || (a.established - b.established)) * dir
      if (view.appSort === 'scope') {
        const sa = String([...a.scopes.keys()][0] || '')
        const sb = String([...b.scopes.keys()][0] || '')
        return sa.localeCompare(sb) * dir
      }
      return ((a.established - b.established) || (a.domains.size - b.domains.size)) * dir
    })
    return list
  }

  /* ------------------------------------------------------------------ */
  /* 面板                                                                */
  /* ------------------------------------------------------------------ */

  function mountPanel(target, options = {}) {
    const standalone = Boolean(options.standalone)
    const embedded = Boolean(options.embedded)
    const inline = standalone || embedded
    const view = createViewModel()
    view.watched = loadWatch()
    view.mountedAt = Date.now()
    const root = target.shadowRoot || target.attachShadow({ mode: 'open' })

    const shell = document.createElement('div')
    shell.className = 'nh-shell'
    shell.innerHTML = `
      <style>${CSS}</style>
      ${standalone ? '' : ''}
      <div class="nh-overlay"${inline ? ' style="position:static;inset:auto;opacity:1;pointer-events:auto;padding:0;background:transparent;backdrop-filter:none;height:100%"' : ''}>
        <section class="nh-panel" role="dialog" aria-modal="true" aria-label="本机网络连接" tabindex="-1">
          <header class="nh-head">
            <span class="nh-mark">${ICONS.logo}</span>
            <div class="nh-title">
              <h1>本机网络连接 <span class="nh-tag">实时</span></h1>
              <p class="nh-sub" data-role="sub">正在读取 lsof…</p>
            </div>
            <div class="nh-head-actions">
              <button class="nh-icon-btn" data-act="open" title="在独立页面打开" aria-label="在独立页面打开">${ICONS.external}</button>
              <button class="nh-icon-btn" data-act="refresh" title="立即刷新" aria-label="立即刷新">${ICONS.refresh}</button>
              ${inline ? '' : `<button class="nh-icon-btn" data-act="close" title="关闭 (Esc)" aria-label="关闭">${ICONS.close}</button>`}
            </div>
          </header>

          <div class="nh-stats">
            <div class="nh-stat" data-tone="ok"><b data-role="stat-established">—</b><span>已建立</span></div>
            <div class="nh-stat" data-tone="listen"><b data-role="stat-listening">—</b><span>监听端口</span></div>
            <div class="nh-stat"><b data-role="stat-hosts">—</b><span>对端主机</span></div>
            <div class="nh-stat"><b data-role="stat-processes">—</b><span>活跃进程</span></div>
            <div class="nh-spark">
              <svg viewBox="0 0 148 34" preserveAspectRatio="none" aria-hidden="true" data-role="spark">
                <defs>
                  <linearGradient id="nh-spark-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="var(--nh-accent)" stop-opacity=".26"/>
                    <stop offset="100%" stop-color="var(--nh-accent)" stop-opacity="0"/>
                  </linearGradient>
                </defs>
                <path data-role="spark-area" fill="url(#nh-spark-fill)" d=""></path>
                <path data-role="spark-line" fill="none" stroke="var(--nh-accent)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" d=""></path>
              </svg>
              <small data-role="spark-label">连接趋势</small>
            </div>
          </div>

          <div class="nh-toolbar">
            <div class="nh-tabs" role="tablist">
              <button class="nh-tab" role="tab" data-tab="apps" aria-selected="true">软件 <span class="n" data-role="count-apps"></span></button>
              <button class="nh-tab" role="tab" data-tab="events" aria-selected="false">时间线 <span class="n" data-role="count-events"></span></button>
              <button class="nh-tab" role="tab" data-tab="connections" aria-selected="false">连接明细 <span class="n" data-role="count-connections"></span></button>
              <button class="nh-tab" role="tab" data-tab="hosts" aria-selected="false">域名·IP <span class="n" data-role="count-hosts"></span></button>
              <button class="nh-tab" role="tab" data-tab="listening" aria-selected="false">监听端口 <span class="n" data-role="count-listeners"></span></button>
            </div>
            <div class="nh-search">
              ${ICONS.search}
              <input type="search" data-role="search" placeholder="搜索软件、域名、地址或端口" spellcheck="false" autocomplete="off">
            </div>
            <select class="nh-select" data-role="scope" aria-label="网络范围">
              <option value="all">全部网络</option>
              <option value="public">仅公网</option>
              <option value="lan">仅局域网</option>
              <option value="loopback">仅本机</option>
            </select>
            <select class="nh-select" data-role="proto" aria-label="协议">
              <option value="all">TCP + UDP</option>
              <option value="tcp">仅 TCP</option>
              <option value="udp">仅 UDP</option>
            </select>
            <button class="nh-select nh-watchonly" data-act="watch-only" aria-pressed="false" title="只看已关注的软件">☆ 关注</button>
          </div>

          <div class="nh-hint" data-role="hint"><b>软件</b>：每个 App 一行，右边是它连过的 host；点一行展开，能看到每个 host 第一次和最后一次出现的时刻（精确到秒）。</div>

          <div class="nh-body" data-role="body">
            <div class="nh-skel"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
          </div>

          <footer class="nh-foot">
            <button class="nh-live" data-act="pause" title="暂停 / 继续自动刷新"><i></i><span data-role="live-label">自动刷新 · 2s</span></button>
            <span class="spacer"></span>
            <button class="nh-footbtn" data-act="hide-launcher" hidden title="隐藏左下角的「网络」入口（刷新页面后恢复）">隐藏入口</button>
            <span class="note" data-role="note">只读 · 数据来自 lsof</span>
          </footer>
          <div class="nh-toast" data-role="toast">已复制</div>
        </section>
      </div>
    `
    root.appendChild(shell)

    if (standalone) target.classList.add('nh-standalone')
    if (standalone) shell.classList.add('nh-standalone-wrap')
    if (embedded) {
      target.classList.add('nh-embed-host')
      shell.classList.add('nh-embed')
    }

    const el = (role) => shell.querySelector(`[data-role="${role}"]`)
    const body = el('body')
    const search = el('search')
    const scopeSel = el('scope')
    const protoSel = el('proto')
    const sub = el('sub')
    const toast = el('toast')
    const liveLabel = el('live-label')
    const note = el('note')

    let toastTimer = null

    function showToast(text) {
      toast.textContent = text || '已复制'
      toast.classList.add('show')
      clearTimeout(toastTimer)
      toastTimer = setTimeout(() => toast.classList.remove('show'), 1400)
    }

    function renderStats() {
      const snapshot = view.snapshot
      const summary = snapshot ? snapshot.summary : null
      el('stat-established').textContent = summary ? fmtNum(summary.established) : '—'
      el('stat-listening').textContent = summary ? fmtNum(summary.listening) : '—'
      el('stat-hosts').textContent = summary ? fmtNum(summary.hosts) : '—'
      el('stat-processes').textContent = summary ? fmtNum(summary.processes) : '—'
      el('count-apps').textContent = summary ? fmtNum(summary.processes) : ''
      el('count-connections').textContent = summary ? fmtNum(summary.total) : ''
      el('count-hosts').textContent = summary ? fmtNum(summary.hosts) : ''
      el('count-listeners').textContent = summary ? fmtNum(summary.listening) : ''

      if (snapshot) {
        const bits = [snapshot.hostname || '本机', snapshot.user ? `${snapshot.user}` : '']
        bits.push(`${fmtNum(summary.total)} 个套接字`)
        if (summary.domains) bits.push(`${fmtNum(summary.domains)} 个域名`)
        if (snapshot.durationMs != null) bits.push(`${snapshot.durationMs} ms`)
        if (snapshot.ts) bits.push(`更新于 ${relTime(snapshot.ts)}`)
        sub.textContent = bits.filter(Boolean).join(' · ')
        const proxied = snapshot.proxy && snapshot.proxy.available
        note.textContent = proxied
          ? `只读 · 域名来自 ${snapshot.proxy.name || '本地代理'} 的连接记录`
          : snapshot.limited
            ? '只读 · 非 root 运行，其他用户的进程可能不可见'
            : '只读 · 数据来自 lsof -i'
      }

      const history = view.history
      const sparkLine = el('spark-line')
      const sparkArea = el('spark-area')
      if (history.length > 1) {
        const width = 148
        const height = 34
        const values = history.map((sample) => sample.total)
        const min = Math.min(...values)
        const max = Math.max(...values)
        // 连接数本身波动很小：给值域留出至少 8 条的余量并把区间居中，
        // 否则 1 条连接的变化会被放大成一条贯穿整块的大斜线。
        const padded = Math.max(8, max - min)
        const base = (min + max) / 2 - padded / 2
        const points = values.map((value, index) => {
          const x = (index / (values.length - 1)) * width
          const y = height - 3 - ((value - base) / padded) * (height - 7)
          return [Number(x.toFixed(2)), Number(Math.min(height - 3, Math.max(3, y)).toFixed(2))]
        })
        const line = points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x},${y}`).join(' ')
        sparkLine.setAttribute('d', line)
        sparkArea.setAttribute('d', `${line} L${width},${height} L0,${height} Z`)
        el('spark-label').textContent = `连接趋势 · ${fmtNum(values[values.length - 1])}`
      }
    }

    function renderError() {
      const previous = body.querySelector('.nh-error')
      if (previous) previous.remove()
      if (!view.error) return
      const box = document.createElement('div')
      box.className = 'nh-error'
      box.innerHTML = `${ICONS.alert}<span class="msg">${esc(view.error)}</span><button data-act="refresh">重试</button>`
      body.prepend(box)
    }

    function sortIndicator(key) {
      const active = view.sortKey === key
      return `<span class="ar">${active ? (view.sortDir > 0 ? '▲' : '▼') : '▲'}</span>`
    }

    function th(key, label, extra) {
      const active = view.sortKey === key
      return `<th data-sort="${key}" class="${active ? 'sorted' : ''}" ${extra || ''}>${label}${sortIndicator(key)}</th>`
    }

    function renderConnections() {
      const rows = sortRows(filterRows(view), view)
      if (rows.length === 0) {
        body.innerHTML = emptyState('没有匹配的连接', view.search || view.scope !== 'all' || view.proto !== 'all'
          ? '换个关键词，或把筛选条件放宽试试。'
          : '当前没有活动连接；有新的网络活动后会自动出现。')
        return
      }
      const head = `<thead><tr>
        ${th('state', '状态')}
        ${th('process', '进程')}
        ${th('local', '本地地址')}
        ${th('remote', '远端地址')}
        ${th('hostname', '主机名')}
        ${th('proto', '协议')}
      </tr></thead>`
      const bodyRows = rows.map((row) => connectionRow(row, view.expanded === row.id)).join('')
      const cols = '<colgroup><col style="width:116px"><col style="width:170px"><col style="width:22%"><col style="width:22%"><col><col style="width:86px"></colgroup>'
      body.innerHTML = `<table class="nh-table">${cols}${head}<tbody>${bodyRows}</tbody></table>`
    }

    function connectionRow(row, expanded) {
      const meta = stateMeta(row)
      const local = endpointLabel(row.local)
      const targetEp = row.viaProxy && row.target
        ? {
          addr: row.target.addr || (row.target.host ? '' : row.remote.addr),
          host: row.target.host || '',
          port: row.target.port != null ? row.target.port : row.remote.port,
        }
        : row.remote
      const remote = targetEp ? endpointLabel(targetEp) : '—'
      const service = portService(targetEp ? targetEp.port : row.local.port)
      const remoteScope = row.viaProxy ? (row.targetScope || row.remoteScope) : row.remoteScope
      const dir = row.direction === 'inbound'
        ? '<span class="nh-dir in">入站</span>'
        : row.direction === 'outbound' ? '<span class="nh-dir">出站</span>' : ''
      const remoteTitle = row.viaProxy && row.target && row.target.host
        ? `${remote} · ${row.target.host}${service ? ` · ${service}` : ''}`
        : `${remote}${service ? ` · ${service}` : ''}`
      const remoteAddrText = targetEp ? (targetEp.addr || targetEp.host || '—') : '—'
      const remoteCell = targetEp
        ? `<div class="nh-addr ${esc(remoteScope || '')}" title="${esc(remoteTitle)}"><span class="ip${targetEp.addr ? '' : ' is-host'}">${esc(remoteAddrText)}</span>${targetEp.port != null ? `<span class="pt">:${targetEp.port}</span>` : ''}</div>`
        : `<span class="nh-addr"><span class="star">—</span></span>`
      const detail = expanded ? detailRow(row) : ''
      return `<tr class="nh-row is-clickable${expanded ? ' expanded' : ''}" data-id="${esc(row.id)}" tabindex="0" aria-expanded="${expanded ? 'true' : 'false'}">
        <td><div class="nh-state"><span class="nh-dot ${meta.tone}"></span><span class="lbl">${esc(meta.label)}</span>${dir}</div></td>
        <td><div class="nh-proc" title="${esc(row.process)} (PID ${esc(row.pid)})"><span class="nm">${esc(row.process || '未知进程')}</span><span class="pid">${esc(row.pid == null ? '' : row.pid)}</span></div></td>
        <td><div class="nh-addr ${esc(row.localScope)}" title="${esc(local)}"><span class="ip">${esc(row.local.addr)}</span>${row.local.port != null ? `<span class="pt">:${row.local.port}</span>` : ''}</div></td>
        <td>${remoteCell}</td>
        <td><div class="nh-hostname">${hostnameCell(row)}</div></td>
        <td><span class="nh-tagp${row.proto === 'UDP' ? ' udp' : ''}">${esc(row.proto)}</span>${row.fds > 1 ? ` <span class="nh-tagp">×${row.fds}</span>` : ''}</td>
      </tr>${detail}`
    }

    function detailRow(row) {
      const lookup = row.viaProxy && row.target
        ? (row.target.host || row.target.addr)
        : (row.remote && row.remote.addr)
      const host = view.snapshot && lookup ? view.snapshot.hosts.find((item) => item.addr === lookup) : null
      const targetEp = row.viaProxy && row.target
        ? {
          addr: row.target.addr || (row.target.host ? '' : row.remote.addr),
          host: row.target.host || '',
          port: row.target.port != null ? row.target.port : row.remote.port,
        }
        : row.remote
      const pairs = [
        ['PID', row.pid == null ? '—' : String(row.pid)],
        ['进程', row.process || '—'],
        ['协议', `${row.proto}${row.type ? ` / ${row.type}` : ''}`],
        ['方向', row.direction === 'inbound' ? '入站' : row.direction === 'outbound' ? '出站' : '监听'],
        ['文件描述符', row.fd ? `${row.fd}${row.fds > 1 ? ` (+${row.fds - 1})` : ''}` : '—'],
      ]
      if (targetEp && targetEp.port != null) {
        const svc = portService(targetEp.port)
        pairs.push(['远端端口', svc ? `${targetEp.port} · ${svc}` : String(targetEp.port)])
      }
      if (row.viaProxy) {
        pairs.push(['代理', row.proxy && row.proxy.rule ? `经本地代理 · ${row.proxy.rule}` : '经本地代理'])
        if (row.proxy && row.proxy.chains && row.proxy.chains.length) {
          pairs.push(['链路', row.proxy.chains.join(' → ')])
        }
        if (row.remote) pairs.push(['代理入口', endpointLabel(row.remote)])
      }
      if (host && host.firstSeen) pairs.push(['第一次出现', clockTime(host.firstSeen)])
      if (host && host.lastSeen) pairs.push(['最近活动', `${clockTime(host.lastSeen)} · ${relTime(host.lastSeen)}`])
      const kvs = pairs.map(([k, v]) => `<span class="kv"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></span>`).join('')
      const copyValue = targetEp
        ? `${endpointLabel(row.local)} → ${row.viaProxy && row.target && row.target.host ? `${row.target.host}:${targetEp.port}` : endpointLabel(targetEp)}`
        : endpointLabel(row.local)
      return `<tr class="nh-detail-tr"><td class="nh-detail-cell" colspan="6"><div class="nh-detail">
        ${kvs}
        <span class="grow"></span>
        <button class="nh-btn" data-copy="${esc(copyValue)}">${ICONS.copy}复制地址</button>
        ${targetEp && (targetEp.addr || targetEp.host) ? `<button class="nh-btn" data-filter="${esc(targetEp.addr || targetEp.host)}">只看该主机</button>` : ''}
      </div></td></tr>`
    }

    function renderHosts() {
      const hosts = visibleHosts(view)
      if (hosts.length === 0) {
        body.innerHTML = emptyState('没有对端主机', '当前没有已建立的外部连接。')
        return
      }
      const head = `<thead><tr>
        <th>主机</th>
        <th>网络</th>
        <th>连接</th>
        <th>远端端口</th>
        <th>进程</th>
        <th>最近活动</th>
      </tr></thead>`
      const rows = hosts.map((host) => {
        const badge = scopeOf(host.scope)
        const proxyBadge = host.viaProxy ? '<span class="nh-badge proxy">代理</span>' : ''
        const ips = host.ips || []
        const sub = host.viaProxy
          ? (ips.length ? `<div class="nh-hostname"><span class="hn" title="${esc(ips.join(', '))}">${esc(ips.slice(0, 2).join(', '))}${ips.length > 2 ? ` +${ips.length - 2}` : ''}</span></div>` : '')
          : (host.hostname
            ? `<div class="nh-hostname"><span class="hn" title="${esc(host.hostname)}">${esc(host.hostname)}</span></div>`
            : '')
        const ports = host.ports.slice(0, 6).map((port) => `<span class="nh-chip">${esc(port)}${portService(port) ? `<span title="${esc(portService(port))}"> · ${esc(portService(port))}</span>` : ''}</span>`).join('')
        const more = host.ports.length > 6 ? `<span class="nh-chip more">+${host.ports.length - 6}</span>` : ''
        const procs = host.processes.slice(0, 3).map((item) => {
          const [pid, name] = item.key.split(':')
          return `<span class="nh-chip" title="PID ${esc(pid)} · ${esc(item.count)} 条连接">${esc(name || pid)}</span>`
        }).join('')
        const procsMore = host.processes.length > 3 ? `<span class="nh-chip more">+${host.processes.length - 3}</span>` : ''
        return `<tr class="nh-row is-clickable" data-host="${esc(host.addr)}" tabindex="0">
          <td><div class="nh-addr ${esc(host.scope)}"><span class="ip">${esc(host.addr)}</span>${proxyBadge}</div>${sub}</td>
          <td><span class="nh-badge ${badge.key}">${badge.label}</span></td>
          <td><b style="font-variant-numeric:tabular-nums;font-weight:600">${fmtNum(host.connections)}</b>${host.established !== host.connections ? `<span style="color:var(--nh-faint)"> · ${fmtNum(host.established)} 已建立</span>` : ''}</td>
          <td><div class="nh-chips">${ports}${more}</div></td>
          <td><div class="nh-chips">${procs}${procsMore}</div></td>
          <td class="nh-when" title="${esc(clockTitle(host.lastSeen) || clockTitle(host.firstSeen))}">${clockTime(host.lastSeen)}<span class="nh-rel">首次 ${clockTime(host.firstSeen)}</span></td>
        </tr>`
      }).join('')
      const cols = '<colgroup><col style="width:28%"><col style="width:84px"><col style="width:88px"><col style="width:22%"><col><col style="width:96px"></colgroup>'
      body.innerHTML = `<table class="nh-table">${cols}${head}<tbody>${rows}</tbody></table>`
    }

    function appTh(key, label) {
      const active = view.appSort === key
      return `<th data-appsort="${key}" class="${active ? 'sorted' : ''}">${label}<span class="ar">${active ? (view.appSortDir > 0 ? '▲' : '▼') : '▲'}</span></th>`
    }

    function appDetailRow(app) {
      const rows = [...app.domains.entries()]
        .sort((a, b) => (b[1].lastSeen || 0) - (a[1].lastSeen || 0))
        .map(([name, meta]) => `<tr>
            <td><span class="nh-chip ${meta.proxy ? 'dom' : 'ptr'}">${esc(name)}</span></td>
            <td>${fmtNum(meta.count)}</td>
            <td class="nh-when">${clockTime(meta.firstSeen)}</td>
            <td class="nh-when">${clockTime(meta.lastSeen)}</td>
          </tr>`).join('')
      const ipRows = [...app.ips].map((ip) => `<tr>
            <td><span class="nh-chip ip">${esc(ip)}</span></td>
            <td>—</td><td class="nh-when">—</td><td class="nh-when">—</td>
          </tr>`).join('')
      const empty = !rows && !ipRows
        ? '<tr><td colspan="4" style="color:var(--nh-faint)">还没有拿到 host / 时间，再等一轮刷新。</td></tr>'
        : ''
      return `<tr class="nh-app-detail"><td colspan="6"><div class="nh-appdom">
        <div class="nh-appdom-head">${esc(app.process || '未知进程')} · 每个 host 的出现时间（只统计本次运行）</div>
        <table class="nh-mini-table"><thead><tr><th>host</th><th>连接</th><th>第一次出现</th><th>最近一次</th></tr></thead>
        <tbody>${rows}${ipRows}${empty}</tbody></table>
        <div class="nh-appdom-foot"><button class="nh-linkbtn" data-appdrill="${esc(app.key)}">查看这个软件的全部连接 →</button></div>
      </div></td></tr>`
    }

    function renderApps() {
      const apps = visibleApps(view)
      if (apps.length === 0) {
        body.innerHTML = emptyState('没有正在连接的软件', view.search || view.scope !== 'all' || view.proto !== 'all'
          ? '换个关键词，或把筛选条件放宽试试。'
          : '当前没有已建立的连接；有新的网络活动后会自动出现。')
        return
      }
      const head = `<thead><tr>
        ${appTh('name', '软件')}
        ${appTh('domains', '域名')}
        <th>主机 / IP</th>
        ${appTh('connections', '连接')}
        ${appTh('lastSeen', '最近活动')}
        ${appTh('scope', '网络')}
      </tr></thead>`
      const rows = apps.map((app) => {
        const domains = [...app.domains.entries()].sort((a, b) => b[1].count - a[1].count)
        const chips = domains.slice(0, 6).map(([name, meta]) => {
          const title = `${name} · ${meta.count} 条连接${meta.proxy ? ' · 经代理' : ' · 反向解析'}`
          return `<span class="nh-chip ${meta.proxy ? 'dom' : 'ptr'}" title="${esc(title)}">${esc(name)}</span>`
        }).join('')
        const scopeRank = { public: 0, wildcard: 0, lan: 1, loopback: 3 }
        const ips = [...app.ips]
          .sort((a, b) => (scopeRank[app.ipScopes.get(a)] ?? 2) - (scopeRank[app.ipScopes.get(b)] ?? 2))
        const ipText = ips[0] + (ips.length > 1 ? ` · +${ips.length - 1}` : '')
        const more = domains.length > 6 ? `<span class="nh-chip more">+${domains.length - 6}</span>` : ''
        // 有域名时按域名所在网络算；只有 IP 时取最「外」的那个（公网 > 局域网 > 本机）。
        const ranks = { public: 0, wildcard: 0, lan: 1, loopback: 3 }
        let scopeKey = null
        if (app.scopes.size) {
          scopeKey = [...app.scopes.entries()].sort((a, b) => b[1] - a[1])[0][0]
        } else if (app.ipScopes.size) {
          scopeKey = [...app.ipScopes.values()].sort((a, b) => (ranks[a] ?? 2) - (ranks[b] ?? 2))[0]
        } else if (app.allScopes.size) {
          scopeKey = [...app.allScopes.entries()].sort((a, b) => b[1] - a[1])[0][0]
        }
        const badge = scopeKey ? scopeOf(scopeKey) : null
        const scopeBadge = badge
          ? `<span class="nh-badge ${badge.key}">${badge.label}</span>`
          : '<span style="color:var(--nh-faint)">—</span>'
        const proxy = app.proxied ? '<span class="nh-mini">代理</span>' : ''
        const watched = view.watched.has(app.key)
        const star = `<button class="nh-star${watched ? ' on' : ''}" data-watch="${esc(app.key)}" title="${watched ? '取消关注' : '关注：出现新域名时提醒'}" aria-pressed="${watched}">${watched ? '★' : '☆'}</button>`
        const extra = app.processes.size > 1 ? `<span class="nh-rel">${app.processes.size} 个进程</span>` : ''
        const open = view.appOpen === app.key
        const row = `<tr class="nh-row is-clickable${open ? ' expanded' : ''}" data-app="${esc(app.key)}" data-process="${esc(app.process)}" tabindex="0" aria-expanded="${open ? 'true' : 'false'}">
          <td><div class="nh-proc" title="${esc(app.name)} (PID ${esc(app.pid == null ? '—' : app.pid)})"><span class="nm">${esc(app.name)}</span><span class="pid">${esc(app.pid == null ? '' : app.pid)}</span>${proxy}${extra}${star}</div></td>
          <td><div class="nh-chips">${chips}${more}${domains.length ? '' : '<span style="color:var(--nh-faint)">—</span>'}</div></td>
          <td>${ips.length ? `<div class="nh-ips" title="${esc(ips.join(', '))}">${esc(ipText)}</div>` : '<span style="color:var(--nh-faint)">—</span>'}</td>
          <td><b style="font-variant-numeric:tabular-nums;font-weight:600">${fmtNum(app.established)}</b>${domains.length ? `<span style="color:var(--nh-faint)"> · ${fmtNum(domains.length)} 域名</span>` : ''}</td>
          <td class="nh-when" title="${esc(clockTitle(app.lastSeen))}">${clockTime(app.lastSeen)}<span class="nh-rel">${app.lastSeen ? relTime(app.lastSeen) : ''}</span></td>
          <td>${scopeBadge}</td>
        </tr>`
        return open ? row + appDetailRow(app) : row
      }).join('')
      const cols = '<colgroup><col style="width:21%"><col style="width:31%"><col style="width:17%"><col style="width:92px"><col style="width:100px"><col style="width:72px"></colgroup>'
      body.innerHTML = `<table class="nh-table nh-apps">${cols}${head}<tbody>${rows}</tbody></table>`
    }

    function eventRows(viewModel) {
      const snapshot = viewModel.snapshot
      if (!snapshot || !Array.isArray(snapshot.events)) return []
      const tokens = viewModel.search.trim().toLowerCase().split(/\s+/).filter(Boolean)
      return snapshot.events.filter((event) => {
        if (viewModel.scope !== 'all' && event.scope !== viewModel.scope) return false
        if (!tokens.length) return true
        const hay = [event.ownerName, event.process, event.host, event.addr, event.port].join(' ').toLowerCase()
        return tokens.every((token) => hay.includes(token))
      })
    }

    /** 时间线顶部的一条 12 小时分布：哪一段时间新连接扎堆。 */
    const HIST_HEIGHT = 34

    function histogramStrip(events, nowTs) {
      const buckets = connectionHistogram(events, nowTs)
      const peak = Math.max(1, ...buckets)
      const total = buckets.reduce((sum, n) => sum + n, 0)
      if (!total) return ''
      const bars = buckets.map((count, index) => {
        const hoursAgo = buckets.length - 1 - index
        const height = count ? Math.max(4, Math.round((count / peak) * HIST_HEIGHT)) : 3
        const label = hoursAgo === 0 ? '最近一小时' : `${hoursAgo} 小时前`
        const title = `${label}：${count} 条新连接`
        return `<span class="nh-bar${count ? '' : ' is-empty'}" style="height:${height}px" title="${esc(title)}"></span>`
      }).join('')
      return `<div class="nh-hist"><span class="nh-hist-label">最近 ${buckets.length} 小时 · 新建 ${total} 条</span><div class="nh-hist-bars">${bars}</div></div>`
    }

    function renderEvents() {
      const events = eventRows(view)
      el('count-events').textContent = events.length ? String(events.length) : ''
      if (!events.length) {
        body.innerHTML = emptyState('还没有新连接', view.search || view.scope !== 'all'
          ? '换个关键词，或把筛选条件放宽试试。'
          : '插件启动后新建立的连接会出现在这里；已经存在的连接只作为基线。')
        return
      }
      const nowTs = view.snapshot && view.snapshot.ts ? view.snapshot.ts : Date.now()
      const rows = events.map((event) => {
        const badge = event.viaProxy ? '<span class="nh-mini">代理</span>' : ''
        const closed = event.kind === 'close'
        const host = event.host || event.addr || '—'
        const life = connectionLife(event, nowTs)
        const lifeCell = life
          ? `<td class="nh-life" title="${life.live ? '仍在连接' : '已断开'}">${esc(fmtDuration(life.ms))}${life.live ? '<span class="nh-rel">进行中</span>' : ''}</td>`
          : '<td class="nh-life">—</td>'
        const mark = closed ? '<span class="nh-mini out">已断开</span>' : ''
        return `<tr class="nh-row is-clickable${closed ? ' is-closed' : ''}" data-event-host="${esc(event.host || event.addr || '')}" tabindex="0">
          <td class="nh-when" title="${esc(clockTitle(event.ts))}">${clockTime(event.ts)}<span class="nh-rel">${relTime(event.ts)}</span></td>
          <td><div class="nh-proc" title="${esc(event.process || '')} (PID ${esc(event.pid == null ? '—' : event.pid)})"><span class="nm">${esc(event.ownerName || event.process || '未知进程')}</span></div></td>
          <td><div class="nh-chips"><span class="nh-chip ${event.viaProxy ? 'dom' : 'ptr'}">${esc(host)}</span>${badge}${mark}</div></td>
          <td><div class="nh-addr"><span class="ip">${esc(event.addr || '—')}</span><span class="pt">:${esc(event.port == null ? '' : event.port)}</span></div></td>
          ${lifeCell}
        </tr>`
      }).join('')
      const cols = '<colgroup><col style="width:120px"><col style="width:24%"><col><col style="width:26%"><col style="width:104px"></colgroup>'
      body.innerHTML = `${histogramStrip(events, nowTs)}<table class="nh-table nh-events">${cols}<thead><tr>
        <th>时间</th><th>软件</th><th>连接的域名 / 主机</th><th>远端</th><th>持续</th>
      </tr></thead><tbody>${rows}</tbody></table>`
    }

    function renderListening() {
      const rows = visibleListeners(view)
      if (rows.length === 0) {
        body.innerHTML = emptyState('没有监听端口', '没有匹配当前筛选条件的监听套接字。')
        return
      }
      const head = `<thead><tr>
        <th>端口</th>
        <th>协议</th>
        <th>绑定地址</th>
        <th>暴露面</th>
        <th>进程</th>
      </tr></thead>`
      const bodyRows = rows.map((row) => {
        const wildcard = row.local.wildcard
        const exposure = wildcard
          ? '<span class="nh-badge warn">所有网卡</span>'
          : row.localScope === 'loopback'
            ? '<span class="nh-badge safe">仅本机</span>'
            : `<span class="nh-badge lan">${esc(row.local.addr)}</span>`
        const service = portService(row.local.port)
        return `<tr class="nh-row is-clickable" data-listen="${esc(row.id)}" tabindex="0">
          <td><div class="nh-addr ${esc(row.localScope)}"><span class="ip" style="font-weight:600">${row.local.port == null ? '—' : esc(row.local.port)}</span>${service ? `<span class="pt" style="color:var(--nh-faint);font-family:inherit;font-size:10.5px"> ${esc(service)}</span>` : ''}</div></td>
          <td><span class="nh-tagp${row.proto === 'UDP' ? ' udp' : ''}">${esc(row.proto)}</span></td>
          <td><div class="nh-addr ${esc(row.localScope)}"><span class="ip">${esc(row.local.addr)}</span></div></td>
          <td>${exposure}</td>
          <td><div class="nh-proc"><span class="nm">${esc(row.process || '未知进程')}</span><span class="pid">${esc(row.pid == null ? '' : row.pid)}</span></div></td>
        </tr>`
      }).join('')
      const cols = '<colgroup><col style="width:118px"><col style="width:76px"><col style="width:26%"><col style="width:120px"><col></colgroup>'
      body.innerHTML = `<table class="nh-table">${cols}${head}<tbody>${bodyRows}</tbody></table>`
    }

    function emptyState(title, hint) {
      return `<div class="nh-empty">${ICONS.empty}<b>${esc(title)}</b><span>${esc(hint)}</span></div>`
    }

    const HINTS = {
      apps: '<b>软件</b>：每个 App 一行，右边是它连过的 host；点一行展开，能看到每个 host 第一次和最后一次出现的时刻（精确到秒）。点 ☆ 关注它，出现新域名时会提醒。',
      events: '<b>时间线</b>：连接的建立与断开，精确到秒；“持续”列是这条连接活了多久（进行中的实时累加，断开后定格）。顶部按小时显示最近 12 小时的新建连接。插件刚启动时从空白开始，最多保留 400 条。',
      connections: '<b>连接明细</b>：一条条 socket（某个程序到某个地址的一次连接）。展开一行可以看端口、代理链路和时间。',
      hosts: '<b>域名·IP</b>：把同一个 host 的所有连接合并成一行，回答「这台机器总共在跟谁通信」。',
      listening: '<b>监听端口</b>：本机正在等待别人连进来的端口，比如本机的服务、共享、投屏。',
    }

    function render() {
      const hint = el('hint')
      if (hint) hint.innerHTML = HINTS[view.tab] || HINTS.apps
      renderStats()
      const eventCount = el('count-events')
      if (eventCount) eventCount.textContent = (view.snapshot && view.snapshot.events ? view.snapshot.events.length : 0) || ''
      if (view.tab === 'apps') renderApps()
      else if (view.tab === 'events') renderEvents()
      else if (view.tab === 'connections') renderConnections()
      else if (view.tab === 'hosts') renderHosts()
      else renderListening()
      renderError()
    }

    function setTab(tab) {
      if (view.tab === tab) return
      view.tab = tab
      view.expanded = null
      for (const button of shell.querySelectorAll('.nh-tab')) {
        button.setAttribute('aria-selected', String(button.dataset.tab === tab))
      }
      render()
    }

    function notifyNewEvents(snapshot) {
      if (!view.watched.size || !Array.isArray(snapshot.events)) return
      const fresh = snapshot.events.filter((event) => event.ts > view.mountedAt && !view.notified.has(event.id) && view.watched.has(event.ownerKey)).reverse()
      for (const event of fresh) {
        view.notified.add(event.id)
        const text = `${event.ownerName || event.process} → ${event.host || event.addr || '新连接'}`
        showToast(`新连接：${text}`)
        try {
          if (typeof Notification === 'function' && Notification.permission === 'granted') {
            new Notification('网络连接提醒', { body: text, silent: true })
          }
        } catch (err) { /* ignore */ }
      }
      if (view.notified.size > 800) view.notified = new Set([...view.notified].slice(-400))
    }

    async function fetchSnapshot(fresh) {
      if (view.fetching) return
      view.fetching = true
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 8000)
      try {
        const response = await fetch(`/net-hosts/api/snapshot${fresh ? '?fresh=1' : ''}`, {
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`接口返回 HTTP ${response.status}`)
        const data = await response.json()
        if (!data || !data.ok) throw new Error((data && data.error) || '采集失败')
        resolveSnapshotEvents(data, view)
        view.snapshot = data
        notifyNewEvents(data)
        view.loading = false
        view.error = null
        view.lastOkAt = Date.now()
        const history = view.history
        history.push({ t: data.ts, total: data.summary.total, established: data.summary.established })
        if (history.length > HISTORY_MAX) history.shift()
        render()
      } catch (err) {
        const message = err && err.name === 'AbortError'
          ? '请求超时：lsof 可能正忙'
          : (err && err.message) || '无法连接插件接口'
        if (view.snapshot) {
          view.error = `${message}；正在显示 ${relTime(view.lastOkAt)}的数据`
          renderError()
        } else if (!view.loading) {
          view.error = message
          renderError()
        } else {
          view.loading = false
          view.error = message
          body.innerHTML = emptyState('暂时读不到连接信息', message)
          renderError()
        }
        view.lastErrorAt = Date.now()
      } finally {
        clearTimeout(timer)
        view.fetching = false
      }
    }

    let loop = null
    function start() {
      if (loop) return
      view.paused = false
      liveLabel.textContent = '自动刷新 · 2s'
      shell.querySelector('[data-act="pause"]').classList.remove('paused')
      fetchSnapshot(true)
      loop = setInterval(() => {
        if (view.paused || document.hidden) return
        fetchSnapshot(false)
      }, REFRESH_MS)
    }

    function stop() {
      if (loop) { clearInterval(loop); loop = null }
    }

    /* ---------------- 交互 ---------------- */

    body.addEventListener('click', (event) => {
      const star = event.target.closest('[data-watch]')
      if (star) {
        event.preventDefault()
        event.stopPropagation()
        const key = star.dataset.watch
        if (view.watched.has(key)) view.watched.delete(key)
        else {
          view.watched.add(key)
          try {
            if (typeof Notification === 'function' && Notification.permission === 'default') Notification.requestPermission()
          } catch (err) { /* ignore */ }
        }
        saveWatch(view.watched)
        render()
        return
      }
      const copy = event.target.closest('[data-copy]')
      if (copy) {
        copyText(copy.dataset.copy)
        showToast('已复制到剪贴板')
        return
      }
      const filter = event.target.closest('[data-filter]')
      if (filter) {
        view.search = filter.dataset.filter
        search.value = view.search
        view.tab = 'connections'
        for (const button of shell.querySelectorAll('.nh-tab')) {
          button.setAttribute('aria-selected', String(button.dataset.tab === 'connections'))
        }
        render()
        return
      }
      if (event.target.closest('[data-act="refresh"]')) { fetchSnapshot(true); return }
      const eventRow = event.target.closest('[data-event-host]')
      if (eventRow && eventRow.dataset.eventHost) {
        view.search = eventRow.dataset.eventHost
        search.value = view.search
        view.tab = 'connections'
        for (const button of shell.querySelectorAll('.nh-tab')) {
          button.setAttribute('aria-selected', String(button.dataset.tab === 'connections'))
        }
        render()
        return
      }
      const appHeader = event.target.closest('th[data-appsort]')
      if (appHeader) {
        const key = appHeader.dataset.appsort
        if (view.appSort === key) view.appSortDir *= -1
        else { view.appSort = key; view.appSortDir = key === 'name' ? 1 : -1 }
        render()
        return
      }
      const appDrill = event.target.closest('[data-appdrill]')
      if (appDrill) {
        const key = appDrill.dataset.appdrill
        const app = visibleApps(view).find((item) => item.key === key)
        view.search = app ? app.process : ''
        search.value = view.search
        view.tab = 'connections'
        for (const button of shell.querySelectorAll('.nh-tab')) {
          button.setAttribute('aria-selected', String(button.dataset.tab === 'connections'))
        }
        render()
        return
      }
      const appRow = event.target.closest('tr[data-app]')
      if (appRow) {
        const key = appRow.dataset.app
        view.appOpen = view.appOpen === key ? null : key
        render()
        return
      }
      const header = event.target.closest('th[data-sort]')
      if (header) {
        const key = header.dataset.sort
        if (view.sortKey === key) view.sortDir *= -1
        else { view.sortKey = key; view.sortDir = 1 }
        render()
        return
      }
      const hostRow = event.target.closest('tr[data-host]')
      if (hostRow) {
        view.search = hostRow.dataset.host
        search.value = view.search
        view.tab = 'connections'
        for (const button of shell.querySelectorAll('.nh-tab')) {
          button.setAttribute('aria-selected', String(button.dataset.tab === 'connections'))
        }
        render()
        return
      }
      const row = event.target.closest('tr[data-id]')
      if (row) {
        view.expanded = view.expanded === row.dataset.id ? null : row.dataset.id
        render()
        const expanded = body.querySelector(`tr[data-id="${cssEscape(view.expanded || '')}"]`)
        if (expanded) expanded.scrollIntoView({ block: 'nearest' })
      }
    })

    body.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      const row = event.target.closest('tr[data-id], tr[data-host], tr[data-app]')
      if (!row) return
      event.preventDefault()
      row.click()
    })

    shell.addEventListener('click', (event) => {
      const tab = event.target.closest('.nh-tab')
      if (tab) { setTab(tab.dataset.tab); return }
      const act = event.target.closest('[data-act]')
      if (!act) return
      if (act.dataset.act === 'close') { close() ; return }
      if (act.dataset.act === 'hide-launcher') { close(); if (hideLauncher) hideLauncher(); return }
      if (act.dataset.act === 'refresh') { fetchSnapshot(true); return }
      if (act.dataset.act === 'watch-only') {
        view.watchOnly = !view.watchOnly
        act.classList.toggle('on', view.watchOnly)
        act.setAttribute('aria-pressed', String(view.watchOnly))
        if (view.tab !== 'apps') setTab('apps')
        else render()
        return
      }
      if (act.dataset.act === 'pause') {
        view.paused = !view.paused
        act.classList.toggle('paused', view.paused)
        liveLabel.textContent = view.paused ? '已暂停 · 点击继续' : '自动刷新 · 2s'
        if (!view.paused) fetchSnapshot(true)
        return
      }
      if (act.dataset.act === 'open') {
        try { window.open('/net-hosts/', '_blank', 'noopener,width=1280,height=860') } catch (err) { /* ignore */ }
        return
      }
    })

    search.addEventListener('input', () => {
      view.search = search.value
      render()
    })

    scopeSel.addEventListener('change', () => {
      view.scope = scopeSel.value
      render()
    })

    protoSel.addEventListener('change', () => {
      view.proto = protoSel.value
      render()
    })

    const onKey = (event) => {
      if (!isOpen()) return
      if (event.key === 'Escape') {
        if (view.expanded) { view.expanded = null; render() }
        else close()
        return
      }
      if (event.key === '/' && document.activeElement !== search) {
        event.preventDefault()
        search.focus()
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'r') {
        event.preventDefault()
        fetchSnapshot(true)
      }
    }

    let closeHandler = typeof options.onClose === 'function' ? options.onClose : null
    const hideLauncher = typeof options.onHideLauncher === 'function' ? options.onHideLauncher : null
    const hideBtn = shell.querySelector('[data-act="hide-launcher"]')
    if (hideBtn) hideBtn.hidden = !hideLauncher
    const overlay = shell.querySelector('.nh-overlay')
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) close()
    })

    function isOpen() {
      return inline || overlay.classList.contains('open')
    }

    function open() {
      if (inline) return
      overlay.classList.add('open')
      document.addEventListener('keydown', onKey, true)
      start()
      const panel = shell.querySelector('.nh-panel')
      if (panel) panel.focus?.()
    }

    function close() {
      if (inline) return
      overlay.classList.remove('open')
      document.removeEventListener('keydown', onKey, true)
      stop()
      if (closeHandler) closeHandler()
    }

    function cssEscape(value) {
      if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value)
      return String(value).replace(/["\\]/g, '\\$&')
    }

    // 面板空闲时每 30 秒刷新一次相对时间文案（只在打开时存在，几乎无成本）
    const clock = setInterval(() => {
      if (!isOpen() || !view.snapshot) return
      const summary = view.snapshot.summary
      if (!summary) return
      sub.textContent = [view.snapshot.hostname, view.snapshot.user, `${fmtNum(summary.total)} 个套接字`,
        view.snapshot.durationMs != null ? `${view.snapshot.durationMs} ms` : '',
        `更新于 ${relTime(view.snapshot.ts)}`].filter(Boolean).join(' · ')
    }, 30000)

    const api = {
      open,
      close,
      start,
      stop,
      refresh: () => fetchSnapshot(true),
      get snapshot() { return view.snapshot },
      destroy() { stop(); clearInterval(clock); shell.remove() },
    }

    if (inline) {
      start()
    } else {
      overlay.classList.remove('open')
    }

    return api
  }

  /* ------------------------------------------------------------------ */
  /* 悬浮入口                                                            */
  /* ------------------------------------------------------------------ */

  function mountLauncher(hostOrRoot) {
    // 客户端侧边栏入口已经注册时，悬浮胶囊自动让位，避免同一个功能有两个入口。
    if (window.__dshNetHostsNativePanel) {
      return { open() {}, close() {}, destroy() {} }
    }
    const host = hostOrRoot && hostOrRoot.host ? hostOrRoot.host : hostOrRoot
    const root = host.shadowRoot || host.attachShadow({ mode: 'open' })
    host.classList.add('nh-fixed')
    const shell = document.createElement('div')
    shell.className = 'nh-shell'
    shell.innerHTML = `<style>${CSS}</style>`

    const wrap = document.createElement('div')
    wrap.className = 'nh-launcher-wrap'
    const button = document.createElement('button')
    button.className = 'nh-launcher'
    button.type = 'button'
    button.title = '查看本机网络连接与对端主机（可拖动）'
    button.setAttribute('aria-label', '查看本机网络连接，可拖动位置')
    button.innerHTML = `${ICONS.logo}<span>网络</span><span class="nh-lb-badge" data-role="badge"></span>`
    const dismiss = document.createElement('button')
    dismiss.className = 'nh-launcher-close'
    dismiss.type = 'button'
    dismiss.title = '隐藏这个入口（刷新页面后恢复）'
    dismiss.setAttribute('aria-label', '隐藏网络入口')
    dismiss.textContent = '×'
    wrap.append(button, dismiss)
    shell.appendChild(wrap)
    root.appendChild(shell)

    const overlayHost = document.createElement('div')
    overlayHost.className = 'nh-overlay-host'
    overlayHost.style.cssText = 'position:absolute;inset:0;pointer-events:none;'
    root.appendChild(overlayHost)

    let panel = null
    const badge = button.querySelector('[data-role="badge"]')

    /* ---- 位置：拖动后记住，换页面/刷新仍在原处（localStorage） ---- */
    const POS_KEY = 'dsh-net-hosts:launcher-pos'

    function place(left, top) {
      const width = wrap.offsetWidth || 110
      const height = wrap.offsetHeight || 38
      const x = Math.min(Math.max(8, left), Math.max(8, window.innerWidth - width - 8))
      const y = Math.min(Math.max(8, top), Math.max(8, window.innerHeight - height - 8))
      wrap.style.left = `${x}px`
      wrap.style.top = `${y}px`
      wrap.style.bottom = 'auto'
      return { left: x, top: y }
    }

    function savePos(pos) {
      try { localStorage.setItem(POS_KEY, JSON.stringify(pos)) } catch { /* 隐私模式忽略 */ }
    }

    try {
      const saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null')
      if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) place(saved.left, saved.top)
    } catch { /* ignore */ }

    let drag = null
    let ignoreClick = false

    button.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: wrap.offsetLeft,
        top: wrap.offsetTop,
        moved: false,
        at: null,
      }
      try { button.setPointerCapture(event.pointerId) } catch { /* ignore */ }
    })

    button.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.id) return
      const dx = event.clientX - drag.x
      const dy = event.clientY - drag.y
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true
      if (!drag.moved) return
      wrap.classList.add('is-dragging')
      drag.at = place(drag.left + dx, drag.top + dy)
    })

    button.addEventListener('pointerup', (event) => {
      if (!drag || event.pointerId !== drag.id) return
      const moved = drag.moved
      const at = drag.at
      drag = null
      wrap.classList.remove('is-dragging')
      if (moved) {
        ignoreClick = true
        if (at) savePos(at)
      }
    })

    button.addEventListener('pointercancel', () => {
      drag = null
      wrap.classList.remove('is-dragging')
    })

    const onResize = () => {
      const rect = wrap.getBoundingClientRect()
      place(rect.left, rect.top)
    }
    window.addEventListener('resize', onResize)

    const onNativePanel = () => {
      try {
        if (restoreToast) { restoreToast.remove(); restoreToast = null }
        if (panel) panel.close()
        if (wrap.isConnected) wrap.remove()
      } catch { /* ignore */ }
    }
    window.addEventListener('dsh-net-hosts:native-panel', onNativePanel)

    let restoreToast = null

    function restore() {
      if (restoreToast) { restoreToast.remove(); restoreToast = null }
      if (!wrap.isConnected) shell.appendChild(wrap)
    }

    function hide() {
      if (panel) panel.close()
      wrap.remove()
      if (restoreToast) return
      const toast = document.createElement('div')
      toast.className = 'nh-restore'
      toast.innerHTML = '<span>网络入口已隐藏</span><button type="button" data-restore>恢复</button>'
      toast.querySelector('[data-restore]').addEventListener('click', (event) => {
        event.stopPropagation()
        restore()
      })
      shell.appendChild(toast)
      restoreToast = toast
      setTimeout(() => {
        if (restoreToast === toast) { toast.remove(); restoreToast = null }
      }, 20000)
    }

    dismiss.addEventListener('click', (event) => {
      event.stopPropagation()
      hide()
    })

    // 键盘兜底：⌘⇧N / Ctrl+Shift+N 随时打开面板（入口被隐藏时也会恢复）
    const onHotkey = (event) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return
      if (String(event.key).toLowerCase() !== 'n') return
      event.preventDefault()
      restore()
      ensurePanel().open()
    }
    document.addEventListener('keydown', onHotkey, true)

    function ensurePanel() {
      if (panel) return panel
      overlayHost.style.pointerEvents = 'auto'
      panel = mountPanel(overlayHost, {
        onClose: () => {
          overlayHost.style.pointerEvents = 'none'
          button.classList.remove('is-open')
        },
        onHideLauncher: () => {
          overlayHost.style.pointerEvents = 'none'
          button.classList.remove('is-open')
          hide()
        },
      })
      return panel
    }

    button.addEventListener('click', () => {
      if (ignoreClick) { ignoreClick = false; return }
      const api = ensurePanel()
      if (overlayHost.querySelector('.nh-overlay.open')) api.close()
      else api.open()
    })

    // 启动时静默取一次数据，用已建立连接数当作入口徽标；失败则什么都不显示。
    const bootstrap = () => {
      fetch('/net-hosts/api/snapshot', { cache: 'no-store', credentials: 'same-origin' })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (!data || !data.ok || !data.summary) return
          const count = data.summary.established
          if (!Number.isFinite(count) || count <= 0) return
          badge.textContent = count > 999 ? '999+' : String(count)
          button.classList.add('has-badge')
          button.title = `查看本机网络连接（${count} 条已建立，可拖动）`
        })
        .catch(() => {})
    }
    const timer = setTimeout(bootstrap, 1200)

    return {
      open: () => { button.click() },
      close: () => panel && panel.close(),
      destroy: () => {
        clearTimeout(timer)
        document.removeEventListener('keydown', onHotkey, true)
        window.removeEventListener('resize', onResize)
        window.removeEventListener('dsh-net-hosts:native-panel', onNativePanel)
        if (panel) panel.destroy()
        wrap.remove()
        shell.remove()
        overlayHost.remove()
      },
    }
  }

  window.__DSH_NET_HOSTS_UI__ = { mount: mountPanel, mountLauncher }
})()
