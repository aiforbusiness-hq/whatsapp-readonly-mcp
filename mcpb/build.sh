#!/bin/sh
# Builds the Claude Desktop extension: dist/aiforbusiness-chat-assistant.mcpb (just a zip with manifest.json at the root)
# Downloads nothing; uses only the system's built-in zip.
set -eu
cd "$(dirname "$0")/.."
OUT="dist/aiforbusiness-chat-assistant.mcpb"
STAGE="dist/mcpb-stage"
mkdir -p dist
[ -d "$STAGE" ] && rm -r "$STAGE"
mkdir -p "$STAGE/server/lib"
cp mcpb/manifest.json "$STAGE/manifest.json"
cp mcpb/icon.png "$STAGE/icon.png"
cp plugins/aiforbusiness-chat-assistant/server/server.js plugins/aiforbusiness-chat-assistant/server/package.json "$STAGE/server/"
cp plugins/aiforbusiness-chat-assistant/server/lib/*.js "$STAGE/server/lib/"
[ -f "$OUT" ] && rm "$OUT"
(cd "$STAGE" && zip -qrX "../aiforbusiness-chat-assistant.mcpb" .)
echo "Built: $OUT"
unzip -l "$OUT"
