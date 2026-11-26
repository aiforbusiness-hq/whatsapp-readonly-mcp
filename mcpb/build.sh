#!/bin/sh
# 打包 Claude Desktop 扩展：dist/chat-assistant.mcpb（就是一个 zip，根目录放 manifest.json）
# 不下载任何东西；只用系统自带的 zip。
set -eu
cd "$(dirname "$0")/.."
OUT="dist/chat-assistant.mcpb"
STAGE="dist/mcpb-stage"
mkdir -p dist
[ -d "$STAGE" ] && rm -r "$STAGE"
mkdir -p "$STAGE/server/lib"
cp mcpb/manifest.json "$STAGE/manifest.json"
cp mcpb/icon.png "$STAGE/icon.png"
cp plugins/chat-assistant/server/server.js plugins/chat-assistant/server/package.json "$STAGE/server/"
cp plugins/chat-assistant/server/lib/*.js "$STAGE/server/lib/"
[ -f "$OUT" ] && rm "$OUT"
(cd "$STAGE" && zip -qrX "../chat-assistant.mcpb" .)
echo "已打包：$OUT"
unzip -l "$OUT"
