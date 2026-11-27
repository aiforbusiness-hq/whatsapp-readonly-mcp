#!/bin/sh
# Build and publish a release on GitHub.
#
#   sh scripts/release.sh            check, test, build, tag v<version>, push the tag, publish the GitHub Release
#   sh scripts/release.sh --dry-run  check, test and build only (no tag, no push, no release)
#
# Before running: bump "version" in every manifest (the script refuses if they differ),
# commit everything, and be on main. Needs: node, zip, python3, git, gh (logged in).
set -eu
cd "$(dirname "$0")/.."

DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1
REPO="aiforbusiness-hq/whatsapp-readonly-mcp"
P=plugins/aiforbusiness-chat-assistant

say() { printf '\n== %s\n' "$*"; }
die() { printf '\nSTOP: %s\n' "$*" >&2; exit 1; }

say "1/6 Versions"
VER=$(node -p 'require("./extension/manifest.json").version')
for f in mcpb/manifest.json $P/plugin.json $P/.claude-plugin/plugin.json $P/.codex-plugin/plugin.json $P/server/package.json; do
  v=$(node -p "require('./$f').version")
  [ "$v" = "$VER" ] || die "$f is $v, extension/manifest.json is $VER"
done
grep -q "version: \"$VER\"" $P/server/server.js || die "server.js SERVER_INFO version is not $VER"
echo "all $VER"

say "2/6 Git state"
if [ $DRY -eq 0 ]; then
  [ -z "$(git status --porcelain)" ] || die "uncommitted changes; commit first"
  [ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || die "not on main"
  git fetch -q origin main
  [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || die "main is not pushed to origin (or is behind); push first"
  git rev-parse -q --verify "refs/tags/v$VER" >/dev/null && die "tag v$VER already exists"
  gh release view "v$VER" -R "$REPO" >/dev/null 2>&1 && die "GitHub release v$VER already exists"
fi
echo "ok"

say "3/6 Tests"
node --test tests/*.test.mjs
if command -v claude >/dev/null 2>&1; then
  claude plugin validate "$P" >/dev/null && claude plugin validate . >/dev/null && echo "plugin + marketplace valid"
fi

say "4/6 Build"
sh mcpb/build.sh >/dev/null
sh scripts/build-release.sh >/dev/null
ZIP="dist/AIforBusiness-Chat-Assistant-v$VER.zip"
MCPB="dist/aiforbusiness-chat-assistant.mcpb"
[ -f "$ZIP" ] && [ -f "$MCPB" ] && [ -f dist/SHA256SUMS.txt ] || die "build output missing"
cat dist/SHA256SUMS.txt

if [ $DRY -eq 1 ]; then say "Dry run done: nothing tagged or published"; exit 0; fi

say "5/6 Tag v$VER"
git tag -a "v$VER" -m "v$VER"
git push origin "v$VER"

say "6/6 GitHub Release"
NOTES=$(mktemp)
{
  echo "## AI for Business Chat Assistant v$VER"
  echo
  echo "Read-only WhatsApp Web helper for Claude and ChatGPT. Never sends."
  echo
  echo "**Files**"
  echo "- \`AIforBusiness-Chat-Assistant-v$VER.zip\`: Chrome extension, plugin for Claude Code and ChatGPT Work, install guide"
  echo "- \`aiforbusiness-chat-assistant.mcpb\`: Claude Desktop extension (double-click to install)"
  echo "- \`SHA256SUMS.txt\`: checksums"
  echo
  echo "**Changes since the last release**"
  PREV=$(git describe --tags --abbrev=0 "v$VER^" 2>/dev/null || true)
  if [ -n "$PREV" ]; then git log --format='- %s' "$PREV..v$VER"; else git log --format='- %s' -n 10 "v$VER"; fi
} > "$NOTES"
gh release create "v$VER" -R "$REPO" --title "v$VER" --notes-file "$NOTES" "$ZIP" "$MCPB" dist/SHA256SUMS.txt
rm -f "$NOTES"
say "Published: https://github.com/$REPO/releases/tag/v$VER"
