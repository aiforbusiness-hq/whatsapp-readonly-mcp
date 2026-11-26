#!/bin/sh
# 用 Chrome 本身把 logo-plain.svg（黄色 AI+，不带任何别家的标志）画成各种尺寸的 PNG（插件图示 16/32/48/128 + Claude 桌面版 .mcpb 用的 512）。
# 不下载任何东西；只用电脑上已装的 Google Chrome（无画面模式）。
# 用法：sh extension/icons/make-icons.sh
set -eu
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP=$(mktemp -d)
SVG=$(cat logo-plain.svg)
render() { # $1 尺寸  $2 输出
  printf '<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block;width:%spx;height:%spx}</style></head><body>%s</body></html>' "$1" "$1" "$SVG" > "$TMP/i.html"
  "$CHROME" --headless=new --disable-gpu --no-first-run --hide-scrollbars --force-device-scale-factor=1 \
    --default-background-color=00000000 --window-size="$1,$1" --screenshot="$2" "file://$TMP/i.html" >/dev/null 2>&1
}
for s in 16 32 48 128; do render $s "$PWD/icon$s.png"; done
# Claude 桌面版扩展（.mcpb）和 Claude Code / ChatGPT 插件：同一个图示
render 512 "$PWD/../../mcpb/icon.png"
render 512 "$PWD/../../plugins/chat-assistant/assets/icon.png"
rm -r "$TMP"
echo "icons written"
