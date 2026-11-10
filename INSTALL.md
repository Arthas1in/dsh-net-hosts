# 安装 / 分享 dsh-net-hosts

这是一个 DSH 插件：看清本机每个软件在连哪些 host。只读、只在本地跑，不联网上传任何数据。

## 环境要求

- **macOS**（依赖系统自带的 `lsof`；Linux 理论可用但未测试，Windows 不可用）
- **DeepSeek Harness ≥ 0.2.0**
- 想显示域名，需要本机运行 **Clash / mihomo**（Clash Verge Rev、ClashX 均可）；不开代理只能看到 IP 或反向 DNS 名。

## 方式 A：DSH 桌面版用户（最简单）

1. 把整个 `dsh-net-hosts` 文件夹放到一个**固定位置**（例如 `~/dsh-plugins/dsh-net-hosts`，之后别删别挪）。
2. 双击文件夹里的 **`install-desktop.command`**。
   如果 macOS 提示“无法打开”，右键 → 打开；或在终端里执行：
   ```bash
   cd ~/dsh-plugins/dsh-net-hosts
   bash install-desktop.command
   ```
3. 完全退出 DeepSeek Harness（`⌘Q`）再打开。
4. 刷新页面一次；DSH 左侧栏（「上下文洞察」下面）会出现「**网络连接**」，点它进入。悬浮胶囊是回退入口，检测到侧边栏页面后会自动隐藏。

脚本只做两件事（都会先备份）：

- 在 `~/.dsh/profiles/desktop/node_modules/` 里建一个指向本文件夹的软链；
- 在 `~/.dsh/profiles/desktop/cordis.patch.yml` 末尾追加一条挂载声明。

> 如果把文件夹挪了位置，重新跑一次脚本即可。
> 不想用脚本，就按下面「方式 C」手动装。

## 方式 B：有 `dsh` 命令行的环境（web profile）

```bash
# 用打好的包
dsh plugin --profile web add ./dsh-net-hosts-0.4.0.tgz

# 或发布到 npm 之后
dsh plugin --profile web add dsh-net-hosts
```

装完启动 `dsh web`，左侧栏会出现「网络连接」。
桌面版的 `desktop` profile 由 Electron 管理，CLI 不允许直接操作，请用方式 A。

## 方式 D：从 dsh-market 安装（已上架后最简单）

DSH 里打开「插件 → 浏览更多插件」，搜 `dsh-net-hosts` / 「网络连接」，点安装即可。
装之前先按「卸载」删掉手动安装（软链 + patch 段），否则会出现两个同名入口。

## 方式 C：发布到 npm（让所有人一条命令安装）

```bash
cd dsh-net-hosts
npm login
npm publish --access public
```

之后别人：

```bash
dsh plugin --profile web add dsh-net-hosts
```

桌面版用户仍然需要方式 A（或把包解压到 profile 的 `node_modules/dsh-net-hosts`，再往 `cordis.patch.yml` 加挂载声明）。

## 手动安装到桌面版（脚本的等价操作）

```bash
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE="$DSH_HOME/profiles/desktop"
mkdir -p "$PROFILE/node_modules"
ln -sfn "$PWD" "$PROFILE/node_modules/dsh-net-hosts"
cat >> "$PROFILE/cordis.patch.yml" <<'YAML'

# dsh-net-hosts
- insert:
    - id: dsh-net-hosts
      name: dsh-net-hosts
YAML
```

然后重启 DSH。

## 卸载

```bash
PROFILE="$HOME/.dsh/profiles/desktop"
rm -f "$PROFILE/node_modules/dsh-net-hosts"
# 再手工删掉 cordis.patch.yml 里 "# dsh-net-hosts" 那一段
```

重启 DSH 即消失。目录里的 `cordis.patch.yml.bak-dsh-net-hosts` 是安装前的备份。

## 常见问题

- **找不到入口**：先刷新页面（`⌘R`），左侧栏应有「网络连接」；回退方案是按 `⌘⇧N` 打开悬浮面板。仍没有就重启 DSH。
- **主机名一列是 `—`**：没有 PTR 记录，或代理没开。域名只对「走本地 Clash/mihomo 代理」的连接有效。
- **看不到其他用户的连接**：插件以当前用户运行，非 root 看不到别人的进程，界面底部会标注。
- **数据安全**：插件只执行本机 `lsof`、读取本地代理的控制接口，所有 HTTP 接口只监听本机、只读，不上传任何数据。

## 分享包里有什么

```
dsh-net-hosts/
  install-desktop.command   # 桌面版一键安装
  cordis.patch.yml          # 挂载声明
  lib/                      # 插件代码（宿主 + 界面 + 代理解析）
  docs/                     # 截图
  README.md                 # 使用说明
  INSTALL.md                # 本文件
  LICENSE
```
