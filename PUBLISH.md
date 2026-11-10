# 上架 dsh-market：Arthas1in 的操作清单

dsh-market 不维护目录，它运行时读取
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
的 `plugins.json`。所以「在市场里能装」= 满足三件事：

1. 代码在一个**公开 GitHub 仓库**里（带 `dsh-plugin` topic，且仓库创建满 24 小时）；
2. 包**发布到 npm**（市场走预构建安装，最快）；
3. 往 awesome-dsh-plugin 提一个 PR，新增一个描述文件。

预计节奏：**今天推仓库 + 发 npm，明天提 PR**（CI 会检查仓库年龄），合并后市场里就能搜到。

---

## 0. 本地已经准备好的东西

- Git 仓库已初始化并提交（`git log` 可见 `dsh-net-hosts 0.4.0` 提交）。
- `market-submission/Arthas1in__dsh-net-hosts.yml` 已按你的账号填好。
- `.github/workflows/release.yml`：以后打 `v*` tag 会自动把 `dsh-net-hosts.tgz` 传到 Release。
- npm 包名 `dsh-net-hosts` 目前未被占用（发布前再确认一次）。

---

## 1. 建仓库并推上去

在浏览器打开 **https://github.com/new**：

- Repository name：`dsh-net-hosts`
- 可见性：**Public**
- 不要勾选 “Add a README / .gitignore / license”（本地已有）

创建后，在终端执行：

```bash
cd dsh-net-hosts   # 本地克隆目录
git remote add origin https://github.com/Arthas1in/dsh-net-hosts.git
git push -u origin main
```

> 用 HTTPS 推送时，GitHub 不再接受账号密码，要填 **Personal Access Token**（Settings → Developer settings → Personal access tokens → Fine-grained tokens，勾选该仓库的 Contents: Read and write）。
> 或者本机配过 SSH 的话用 `git@github.com:Arthas1in/dsh-net-hosts.git`。

推送后，在仓库页面点 **⚙️ 旁边的 About → 齿轮 → Topics**，加：

```
dsh-plugin
```

（必须，CI 会检查。）

---

## 2. 发布到 npm

先确认包名仍然可用：

```bash
npm view dsh-net-hosts version
```

- 输出 `404` → 可用，继续。
- 输出了版本号 → 名字被占了，见文末「如果包名被占」。

登录并发布：

```bash
cd dsh-net-hosts   # 本地克隆目录
npm login --cache /tmp/npm-cache-dsh     # 浏览器里完成登录 / 2FA
npm publish --access public --cache /tmp/npm-cache-dsh
```

`prepublishOnly` 会先跑 19 项测试，失败就不会发出去。

验证：

```bash
npm view dsh-net-hosts version          # 应显示 0.4.0
npm view dsh-net-hosts dist.tarball     # 有 registry.npmjs.org 的地址
```

> 发布后 1～2 分钟 npm 才完全可查；市场安装也依赖 npm 的 CDN，稍等一会儿。

---

## 3. 明天：给 awesome-dsh-plugin 提 PR

仓库满 24 小时后（CI 硬性要求），做这一步。

1. 打开 https://github.com/awesome-dsh-plugin/awesome-dsh-plugin → **Fork**。
2. 在你 fork 的仓库里：**Add file → Create new file**，文件名：

   ```
   data/plugins/Arthas1in__dsh-net-hosts.yml
   ```

3. 内容直接复制本地 `market-submission/Arthas1in__dsh-net-hosts.yml`：

   ```yaml
   url: https://github.com/Arthas1in/dsh-net-hosts
   name: Arthas1in/dsh-net-hosts
   category: dev
   description:
     en: 'Shows which hosts each local app connects to. Domains are restored through the local Clash/mihomo controller, and first/last-seen times are recorded to the second.'
     zh: '看清本机每个软件在连哪些 host：经本地 Clash/mihomo 还原域名，并给出精确到秒的首次/最近时间。'
   icon: https://raw.githubusercontent.com/Arthas1in/dsh-net-hosts/main/icon.png
   ```

4. Commit（可以直接提交到 fork 的 main），然后 **Contribute → Open pull request**。
   标题用：`Add dsh-net-hosts`。
5. CI 会检查：仓库年龄、topic、`package.json` 里的 `dsh.bundle`、描述格式、icon 可访问。红了就按日志改，通常是 topic 没加或仓库不满 1 天。

合并后，`https://awesome-dsh-plugin.com/plugins.json` 会更新（有缓存，可能几小时），dsh-market 里就能搜到并一键安装。

---

## 4. 在 dsh-market 里安装自己

**先卸载本机的手动安装**，否则同一个插件会被挂载两次：

```bash
PROFILE="$HOME/.dsh/profiles/desktop"
rm -f "$PROFILE/node_modules/dsh-net-hosts"
# 编辑 $PROFILE/cordis.patch.yml，删掉文件末尾这段：
# # 本机网络连接面板（本地开发：link 到工作区）
# - insert:
#     - id: dsh-net-hosts
#       name: dsh-net-hosts
```

然后 DSH 里打开 **插件 → 浏览更多插件**（dsh-market），搜「网络连接」或 `dsh-net-hosts`，点安装。
装完刷新页面：左侧栏出现「网络连接」。

安装到的是 desktop profile，路径是 `~/.dsh/profiles/desktop/node_modules/dsh-net-hosts`，升级也由市场管。

### 上架前想验证「市场同款安装」

```bash
# web profile（有 dsh CLI 的环境）
dsh plugin --profile web add dsh-net-hosts
```

或者在本机模拟：

```bash
cd /tmp && npm pack dsh-net-hosts
# 解压到 profile 的 node_modules，再按 INSTALL.md 手动加挂载声明
```

---

## 如果包名被占

改成带 scope 的包名，例如 `@arthas1in/dsh-net-hosts`，需要同步改三处：

1. `package.json` → `"name": "@arthas1in/dsh-net-hosts"`
2. `cordis.patch.yml` → `name: "@arthas1in/dsh-net-hosts"`
3. `lib/client.js` 的 bundle id（`window.__ModuleLoader__.load({ id: ... })`）也要与包名一致；`package.json` 的 `dsh.client` 不用改。

然后 `npm publish --access public` 照样可用（scope 包默认私有，必须带 `--access public`）。

---

## 常见卡点

| 现象 | 原因 / 处理 |
| --- | --- |
| `npm` 报 `cache folder contains root-owned files` | 本机 npm 缓存里有 15 个 root 文件。要么 `sudo chown -R "$(id -u):$(id -g)" ~/.npm`，要么给命令加 `--cache /tmp/npm-cache-dsh` 绕开（推荐先用后者） |
| `npm publish` 报 `ENEEDAUTH` | 没登录或 2FA 过期，重新 `npm login` |
| `npm publish` 报 `403 ... 2FA` | 账号开了 2FA，按提示输入一次性验证码 |
| CI 报仓库太新 | 建仓满 24 小时后再提 PR |
| CI 报缺 topic | 仓库 About 里加 `dsh-plugin` |
| 市场搜不到 | 合并后等缓存刷新；确认 `plugins.json` 里已有条目 |
| 装完侧边栏没有入口 | 刷新页面（`⌘R`）；仍没有就重启 DSH |
| 装完出现两个入口/报重复 | 手动安装没删干净，见第 4 步 |

---

## 需要我代劳的部分

我能做的：改代码、跑测试、打包、生成提交文件、检查 npm 包内容。
不能做的：代替你登录 GitHub / npm、点「Fork」和「Open pull request」——这几步必须由你账号完成。
