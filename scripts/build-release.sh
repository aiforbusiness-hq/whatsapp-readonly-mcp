#!/bin/sh
# 打包给学员的 zip：dist/AIforBusiness-Chat-Assistant-v<版本>.zip
# 内含：extension/、plugins/chat-assistant/（Claude Code / ChatGPT 插件）、chat-assistant.mcpb、安装说明.md、PRIVACY.md
# 不下载任何东西；只用系统自带的 zip。
set -eu
cd "$(dirname "$0")/.."
VER=$(node -p 'require("./extension/manifest.json").version')
NAME="AIforBusiness-Chat-Assistant"
STAGE="dist/release-stage/$NAME"
OUT="dist/$NAME-v$VER.zip"

# Chrome 拒绝载入含 U+FFFE/U+FFFF 等非字元、U+2028/2029 换行字元的脚本：先检查
python3 - <<'PY'
import glob, sys
bad = []
for f in glob.glob("extension/*.js"):
    s = open(f, encoding="utf-8").read()
    if any(0xFDD0 <= ord(c) <= 0xFDEF or (ord(c) & 0xFFFE) == 0xFFFE or ord(c) in (0x2028, 0x2029) for c in s): bad.append(f)
if bad: sys.exit("这些文件含 Chrome 不接受的字元：" + ", ".join(bad))
PY
./mcpb/build.sh > /dev/null
[ -d dist/release-stage ] && rm -r dist/release-stage
mkdir -p "$STAGE/extension/icons"
cp extension/*.js extension/*.html extension/*.css extension/manifest.json "$STAGE/extension/"
cp extension/icons/*.png extension/icons/*.svg "$STAGE/extension/icons/"
cp -R extension/_locales "$STAGE/extension/"
cp dist/chat-assistant.mcpb "$STAGE/"
cp docs/安装说明.md "$STAGE/安装说明.md"
cp PRIVACY.md LICENSE "$STAGE/"
# Claude Code / ChatGPT（Codex）插件：解压后的文件夹本身就是插件市场；插件本身只有设定、图示和本机程序
P=plugins/chat-assistant
mkdir -p "$STAGE/.claude-plugin" "$STAGE/.agents/plugins" "$STAGE/$P/.claude-plugin" "$STAGE/$P/assets" "$STAGE/$P/server/lib"
cp .claude-plugin/marketplace.json "$STAGE/.claude-plugin/"
cp .agents/plugins/marketplace.json "$STAGE/.agents/plugins/"
cp $P/.claude-plugin/plugin.json "$STAGE/$P/.claude-plugin/"
cp $P/plugin.json $P/mcp.json "$STAGE/$P/"
cp $P/assets/icon.png "$STAGE/$P/assets/"
cp $P/server/server.js $P/server/package.json "$STAGE/$P/server/"
cp $P/server/lib/*.js "$STAGE/$P/server/lib/"
# 不带任何隐藏文件（.DS_Store 等）；只保留插件市场需要的 .claude-plugin / .agents
find "$STAGE" -name '.*' -type f -delete
[ -f "$OUT" ] && rm "$OUT"
(cd dist/release-stage && zip -qrX "../$NAME-v$VER.zip" "$NAME")
# 给学生核对用的 SHA-256（另外透过老师的频道发，不要跟压缩档放在同一个地方）
(cd dist && shasum -a 256 "$NAME-v$VER.zip" chat-assistant.mcpb > SHA256SUMS.txt)
echo "已打包：$OUT"
cat dist/SHA256SUMS.txt
unzip -l "$OUT" | tail -n +1
