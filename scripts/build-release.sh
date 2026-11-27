#!/bin/sh
# Builds the zip for students: dist/AIforBusiness-Chat-Assistant-v<version>.zip
# Contains: extension/, plugins/aiforbusiness-chat-assistant/ (Claude Code / ChatGPT plugin), aiforbusiness-chat-assistant.mcpb, INSTALL.md, PRIVACY.md
# Downloads nothing; uses only the system's built-in zip.
set -eu
cd "$(dirname "$0")/.."
VER=$(node -p 'require("./extension/manifest.json").version')
NAME="AIforBusiness-Chat-Assistant"
STAGE="dist/release-stage/$NAME"
OUT="dist/$NAME-v$VER.zip"

# Chrome refuses to load scripts that contain noncharacters such as U+FFFE/U+FFFF, or the U+2028/2029 line separators: check first
python3 - <<'PY'
import glob, sys
bad = []
for f in glob.glob("extension/*.js"):
    s = open(f, encoding="utf-8").read()
    if any(0xFDD0 <= ord(c) <= 0xFDEF or (ord(c) & 0xFFFE) == 0xFFFE or ord(c) in (0x2028, 0x2029) for c in s): bad.append(f)
if bad: sys.exit("These files contain characters Chrome does not accept: " +", ".join(bad))
PY
./mcpb/build.sh > /dev/null
[ -d dist/release-stage ] && rm -r dist/release-stage
mkdir -p "$STAGE/extension/icons"
cp extension/*.js extension/*.html extension/*.css extension/manifest.json "$STAGE/extension/"
cp extension/icons/*.png extension/icons/*.svg "$STAGE/extension/icons/"
cp -R extension/_locales "$STAGE/extension/"
cp dist/aiforbusiness-chat-assistant.mcpb "$STAGE/"
cp docs/INSTALL.md "$STAGE/INSTALL.md"
cp PRIVACY.md LICENSE "$STAGE/"
# Claude Code / ChatGPT (Codex) plugin: the unzipped folder is itself the plugin marketplace; the plugin holds only settings, icon, skills and the local program
P=plugins/aiforbusiness-chat-assistant
mkdir -p "$STAGE/.claude-plugin" "$STAGE/.agents/plugins" "$STAGE/$P/.claude-plugin" "$STAGE/$P/assets" "$STAGE/$P/server/lib"
cp .claude-plugin/marketplace.json "$STAGE/.claude-plugin/"
cp .agents/plugins/marketplace.json "$STAGE/.agents/plugins/"
cp $P/.claude-plugin/plugin.json "$STAGE/$P/.claude-plugin/"
cp $P/plugin.json $P/mcp.json $P/README.md "$STAGE/$P/"
cp -R $P/skills "$STAGE/$P/"
mkdir -p "$STAGE/$P/.codex-plugin" && cp $P/.codex-plugin/plugin.json $P/.codex-plugin/mcp.json "$STAGE/$P/.codex-plugin/"
cp $P/assets/icon.png "$STAGE/$P/assets/"
cp $P/server/server.js $P/server/package.json "$STAGE/$P/server/"
cp $P/server/lib/*.js "$STAGE/$P/server/lib/"
# No hidden files (.DS_Store etc.); keep only the .claude-plugin / .agents folders the plugin marketplace needs
find "$STAGE" -name '.*' -type f -delete
[ -f "$OUT" ] && rm "$OUT"
(cd dist/release-stage && zip -qrX "../$NAME-v$VER.zip" "$NAME")
# SHA-256 for students to check (send it separately through the teacher's channel, not in the same place as the zip)
(cd dist && shasum -a 256 "$NAME-v$VER.zip" aiforbusiness-chat-assistant.mcpb > SHA256SUMS.txt)
echo "Built: $OUT"
cat dist/SHA256SUMS.txt
unzip -l "$OUT" | tail -n +1
