#!/bin/bash
# dsh-net-hosts 一键安装（DSH 桌面版 / desktop profile）
# 双击运行，或：bash install-desktop.command
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE="$DSH_HOME/profiles/desktop"

echo "插件目录: $DIR"
echo "DSH 配置: $PROFILE"

if [ ! -f "$DIR/lib/index.js" ]; then
  echo "✗ 这里不像插件目录（缺 lib/index.js）。请把脚本放在插件文件夹里运行。"
  exit 1
fi

if [ ! -d "$PROFILE" ]; then
  echo "✗ 没找到 desktop profile。请先打开一次 DeepSeek Harness，让它创建 profile。"
  exit 1
fi

mkdir -p "$PROFILE/node_modules"
ln -sfn "$DIR" "$PROFILE/node_modules/dsh-net-hosts"
echo "✓ 已链接到 profile 的 node_modules"

PATCH="$PROFILE/cordis.patch.yml"
touch "$PATCH"

if grep -q "id: dsh-net-hosts" "$PATCH" 2>/dev/null; then
  echo "✓ 挂载声明已存在，跳过"
else
  BACKUP="$PATCH.bak-dsh-net-hosts"
  cp "$PATCH" "$BACKUP"
  cat >> "$PATCH" <<'YAML'

# dsh-net-hosts：查看本机软件连了哪些 host
- insert:
    - id: dsh-net-hosts
      name: dsh-net-hosts
YAML
  echo "✓ 已写入挂载声明（备份：$BACKUP）"
fi

echo
echo "完成。请完全退出 DeepSeek Harness（⌘Q）再打开。"
echo "打开后左下角会出现「网络」胶囊；也可以按 ⌘⇧N 打开面板。"
