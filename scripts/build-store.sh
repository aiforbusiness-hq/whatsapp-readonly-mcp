#!/bin/sh
# Builds the Chrome Web Store upload: dist/chrome-web-store-v<version>.zip
# manifest.json sits at the zip root. The "key" field is removed, because the
# store refuses it and gives the extension its own ID.
# Downloads nothing; uses only node and the system's built-in zip.
set -eu
cd "$(dirname "$0")/.."
VER=$(node -p 'require("./extension/manifest.json").version')
STAGE=dist/store-stage
OUT="dist/chrome-web-store-v$VER.zip"
rm -rf "$STAGE" "$OUT"
mkdir -p "$STAGE/icons"
cp extension/*.js extension/*.html extension/*.css "$STAGE/"
cp extension/icons/*.png "$STAGE/icons/"
cp -R extension/_locales "$STAGE/"
node -e '
const fs = require("fs");
const m = JSON.parse(fs.readFileSync("extension/manifest.json", "utf8"));
delete m.key;
fs.writeFileSync(process.argv[1], JSON.stringify(m, null, 2) + "\n");
' "$STAGE/manifest.json"
(cd "$STAGE" && zip -qrX "../chrome-web-store-v$VER.zip" .)
rm -rf "$STAGE"
unzip -l "$OUT" | tail -n 3
echo "-> $OUT"
