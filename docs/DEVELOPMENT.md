# Development

Notes for people who work on the code. Users only need the [README](../README.md).

## Test cases

62 automated tests run on every push (see the badge). One more end-to-end test runs locally in a throwaway Chromium before each release. All tests use fake WhatsApp data, test ports and a test data folder. They never touch a real account or a real pairing.

```bash
node --test tests/*.test.mjs
```

```bash
CHROMIUM_PATH=/path/to/chromium node --test tests/download.e2e.mjs
```

| File | What it proves |
|---|---|
| [`pake.test.mjs`](../tests/pake.test.mjs) | Pairing (SPAKE2): both sides use the same code file; the right code pairs; a wrong code fails; bad curve points are refused; a recorded try cannot be used to test other codes offline |
| [`rogue.test.mjs`](../tests/rogue.test.mjs) | A fake local program learns nothing and can do nothing; it never gets the code; a relay on another port cannot reuse proofs; pairing is closed unless a code was just shown, with a fixed try budget |
| [`hub.test.mjs`](../tests/hub.test.mjs) | 25 AI sessions share one connection; a crashed leader is replaced without losing requests; drafts are never saved twice; wrong tokens, web origins and wrong hosts are refused; it listens on `127.0.0.1` only |
| [`scan.test.mjs`](../tests/scan.test.mjs) | Malware check: programs refused by content and by name; disguised files, hidden archives, web pages, dangerous PDF actions, Office macros, DDE and spreadsheet formulas refused; unfinished checks refuse the file; a hostile PDF cannot freeze the extension |
| [`media.test.mjs`](../tests/media.test.mjs) | The reader cannot send, open chats or use the network; every message type is read correctly in a real headless Chrome; pictures reach the AI over MCP; downloads only happen on a paired MCP request, only from WhatsApp's media server |
| [`reader.test.mjs`](../tests/reader.test.mjs) | Name lookups cannot be hijacked by look-alike groups or people named "Me"; view-once media is always refused; ambiguous names list exact matches first |
| [`card.test.mjs`](../tests/card.test.mjs) | A draft is only ever filled into the chat it was written for, even while you switch chats |
| [`storage.test.mjs`](../tests/storage.test.mjs) | Clearing drafts or the activity log is never undone by a write in flight; two AI apps saving at once keep both drafts; hostile file names are handled fast |
| [`i18n.test.mjs`](../tests/i18n.test.mjs) | Screens are in English by default, even in a Chinese browser; Chinese only when the user picks it; clearing settings goes back to English |
| [`download.e2e.mjs`](../tests/download.e2e.mjs) | End to end in a real Chromium with the real extension and server: pair, download, refuse malware, and check the My data page |

## Repository layout

| Path | What |
|---|---|
| `extension/` | Chrome extension (Manifest V3) |
| `plugins/aiforbusiness-chat-assistant/` | Plugin for Claude Code and ChatGPT/Codex, with the local MCP server in `server/` |
| `mcpb/` | Claude Desktop extension (`.mcpb`) build |
| `.claude-plugin/`, `.agents/plugins/` | Plugin marketplaces for Claude Code and Codex |
| `tests/` | Automated tests |
| `docs/` | Install guide, architecture, store listing text |

## Making a release

```bash
sh scripts/release.sh
```

It checks that every version number matches, runs the tests, builds `dist/aiforbusiness-chat-assistant.mcpb` and the release zip, tags `v<version>`, pushes the tag and publishes a GitHub Release with both files and `SHA256SUMS.txt`. Add `--dry-run` to build and check without tagging or publishing. Bump the version in all manifests first.

## Contributing

Issues and pull requests are welcome. Every change must keep the never-send rule: no code that sends, marks as read, deletes or changes anything in WhatsApp, and no outside network requests. Run `node --test tests/*.test.mjs` before opening a pull request.
