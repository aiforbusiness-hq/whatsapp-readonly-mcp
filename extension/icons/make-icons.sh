#!/bin/sh
# Uses Chrome itself to render logo-plain.svg (yellow AI+, no other brand's logo) as PNGs in several sizes (extension icons 16/32/48/128 + 512 for the Claude Desktop .mcpb).
# Downloads nothing; uses only the Google Chrome already installed on the computer (headless mode).
# Usage: sh extension/icons/make-icons.sh
set -eu
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP=$(mktemp -d)
SVG=$(cat logo-plain.svg)
render() { # $1 size  $2 output
  printf '<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block;width:%spx;height:%spx}</style></head><body>%s</body></html>' "$1" "$1" "$SVG" > "$TMP/i.html"
  "$CHROME" --headless=new --disable-gpu --no-first-run --hide-scrollbars --force-device-scale-factor=1 \
    --default-background-color=00000000 --window-size="$1,$1" --screenshot="$2" "file://$TMP/i.html" >/dev/null 2>&1
}
for s in 16 32 48 128; do render $s "$PWD/icon$s.png"; done
# Claude Desktop extension (.mcpb) and Claude Code / ChatGPT plugin: same icon
render 512 "$PWD/../../mcpb/icon.png"
render 512 "$PWD/../../plugins/aiforbusiness-chat-assistant/assets/icon.png"
rm -r "$TMP"
echo "icons written"
