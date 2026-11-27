# AI for Business Chat Assistant

A Chrome extension + a local MCP program. It lets Claude (Desktop / Claude Code) or ChatGPT (Desktop / Codex) read your own open **WhatsApp Web**. It finds who is waiting for your reply, sums up group chats and drafts replies. **The program never sends messages.** A person presses send.

Student install guide: [`docs/INSTALL.md`](INSTALL.md) · Privacy policy: [`PRIVACY.md`](../PRIVACY.md) · Store listing: [`docs/store-listing.md`](store-listing.md)

> Unofficial tool: it is not affiliated with, or endorsed by, WhatsApp / Meta. "WhatsApp" is used only to say which website it works with.

## Architecture

```
Claude / ChatGPT ──stdio(MCP)──▶ plugins/aiforbusiness-chat-assistant/server/server.js ──ws://127.0.0.1:47821-47830──▶ Chrome extension ──▶ web.whatsapp.com
```

Each AI conversation starts its own copy of server.js, with no limit on how many. The first copy takes a port and connects to the extension (the main copy). The others go through it (secondary copies). If the main copy closes, a secondary copy takes over, trying ports from the first one up (`lib/hub.js`). There is only ever one main copy at a time. If the main copy is slow to answer, a new copy waits and does not start a second main. If two main copies ever appear, the one on the higher port steps down and joins the other.

- `extension/` Chrome extension (MV3). Fixed ID `hmajmekaiaiilhneebgbnchonfkblndb` when loaded unpacked (the `key` in the manifest); the Chrome Web Store build has ID `cmpndcpodgfcdlabhcopofojdneafpgg`. The plugin accepts only these two
  - `indexer.js` live index (MAIN world, always running): the work depends only on "chats that changed", not on the total number of chats
    - One summary per chat, recomputed only when it changes (uses WhatsApp's own change events; a signature check once a minute is the safety net)
    - Totals, unread counts and messages per day / per hour are running totals: when a chat changes, the old values are subtracted and the new ones added. The waiting-for-reply list stays sorted by waiting time (binary-search insert)
    - Slow-changing stats, such as reply times and most active chats, are computed at most once a minute
    - Only changes are sent out: `content.js` writes to `chrome.storage.session` (memory only): one key `c:<id>` per chat (all chats, no limit) + a fixed-size overview `wa_meta` (totals, stats, the 100 people waiting longest, the 100 most recent chats)
    - The popup / dashboard / AI read only `wa_meta` when they open. They read all `c:*` only for "Show all", search or filters
    - Measured (fake data): handling one chat change takes about 2 ms with 500 / 5000 / 20000 chats; `wa_meta` is about 80 KB in each case
  - `reader.js` read-only reader (MAIN world, injected when needed): reads a chat's messages, searches, and so on; `WAWebCollections` + IndexedDB `model-storage` (readonly)
  - `actions.js` the only screen action: open a chat (accepts only a real person's click in the popup)
  - `content.js` AI draft preview card inside the WhatsApp page (closed shadow DOM, floating above the message box; "Fill message box" = paste the text, does not press send)
  - `drafts.js` draft list (`chrome.storage.local`, 90 days)
  - `activity.js` AI activity log (each MCP request: time, which AI, command, count; no message content is stored; 90 days / 1000 entries)
  - `sidebar.js` "AI" icon in WhatsApp's left sidebar → full-page dashboard (an iframe of the extension page, `use_dynamic_url`)
  - `dashboard.html/js/css` dashboard: overview stats, AI activity log, drafts vs. actual replies, data safety diagram, export (CSV / JSON, saved on this computer)
  - `background.js` connects to the local program, handles pairing, passes commands on
- `plugins/aiforbusiness-chat-assistant/` Claude Code / ChatGPT (Codex) plugin: holds only the plugin settings, icon and `server/` (the local MCP program, **zero external packages**: hand-written MCP stdio + a minimal WebSocket server)
- `.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json` plugin marketplaces (point to the plugin folder above)
- `mcpb/` Claude Desktop extension (.mcpb) settings
- `scripts/build-release.sh` builds the zip for students

## MCP tools

| Tool | Type | What it does |
|---|---|---|
| `get_status` | Read-only | Connection / pairing status; gives a 6-digit pairing code when not paired |
| `list_chats` | Read-only | Lists chats (unread / groups / keyword) |
| `get_messages` | Read-only | Reads the last N messages of a chat (≤100) |
| `search_messages` | Read-only | Searches stored messages (including photo captions, file names, locations, contacts, polls) |
| `get_media` | Read-only | Looks at the photo / sticker / file in a message (uses only what is already on the computer, no download; often only a small blurry preview) |
| `download_media` | Download | Downloads the photo / video / voice message / file in a message and saves it to "Downloads / AI for Business Chat Assistant". It runs only when the AI calls it through MCP. It saves only types that can be fully checked (photos, videos, audio, text, PDF, newer Office files). Each part is checked before saving (`scan.js`). Archives and all other types are never saved. The dashboard's "Files downloaded by AI" shows previews |
| `list_awaiting_reply` | Read-only | The other person wrote last and I have not replied |
| `save_draft` | Writes draft list | Saves a reply draft (does not send) |
| `list_drafts` | Read-only | Drafts + time + the actual reply (for research comparison) |

## Language

- Chrome extension: English by default. It uses Chinese only when the user picks "Chinese" in the dashboard under "Settings → Language". With "Same as browser", it uses Chinese when the browser is in Chinese (zh-*) (`tr(zh, en)` and `localizeDOM()` in `extension/i18n.js`; the extension name and description are in `_locales/`)
- AI plugin / local program (`plugins/aiforbusiness-chat-assistant`): all English; the AI answers in the user's own language

## Security design

- The program has no code to send, press Enter, mark as read or delete. Filling text and opening a chat accept only real clicks with `event.isTrusted`
- The WebSocket binds only to `127.0.0.1`. It accepts only `Origin: chrome-extension://<fixed ID>` with `Host: 127.0.0.1:<port>`. 6-digit pairing code (SPAKE2, each attempt can guess only one code; valid for 3 minutes after the AI gives it, the code changes after 5 tries, at most 12 tries per start) → 64-character random secret (`~/.whatsapp-readonly-mcp/secret`, permissions 600)
- Several server.js copies share one connection: on the same 127.0.0.1 port, both sides check each other with `~/.whatsapp-readonly-mcp/hub-token` (permissions 600; the token itself is not sent). Any request with an `Origin` (any web page) is refused. Only those 9 commands can be called. During a handover, reads are retried and saving a draft never happens twice
- Extension CSP: `connect-src ws://127.0.0.1:*`. The only permissions are `scripting`, `storage`, `alarms`, `downloads`, `offscreen` + `https://web.whatsapp.com/*`
- There is only one kind of outside network request: when the AI calls `download_media` through MCP, the WhatsApp tab fetches that one file from WhatsApp's own media server (accepted only if the SHA-256 matches; `downloader.js`, `media.js`). Apart from that, zero outside network requests: no analytics, update checks, remote code or web fonts

## Development

```
sh extension/icons/make-icons.sh         # use Chrome to render logo.svg as the extension / Claude icons
./mcpb/build.sh                           # build the .mcpb
./scripts/build-release.sh                # build the student zip (dist/)
node --test tests/media.test.mjs          # non-text message tests (fake data + headless Chrome)
node --test tests/scan.test.mjs            # malicious file checks (fake files)
node --test tests/rogue.test.mjs           # local connection: a fake program cannot get the secret or do anything (real extension code + real local program)
node --test tests/download.e2e.mjs        # download: real extension + test Chromium + fake WhatsApp (set CHROMIUM_PATH; about 1 minute)
node --test tests/hub.test.mjs            # shared connection tests (own port and folder, does not touch the real pairing); needs Node 22+
```

Plugins (the root of this repo / of the student zip is itself the plugin marketplace):

- Claude Code: `/plugin marketplace add <folder or aiforbusiness-hq/whatsapp-readonly-mcp>` → `/plugin install aiforbusiness-chat-assistant@aiforbusiness` (`plugins/aiforbusiness-chat-assistant/.claude-plugin/plugin.json`, `${CLAUDE_PLUGIN_ROOT}`)
- ChatGPT Desktop / Codex: `codex plugin marketplace add <same as above>` → `codex plugin add aiforbusiness-chat-assistant@aiforbusiness` (`plugins/aiforbusiness-chat-assistant/plugin.json` + `mcp.json` stdio, `${PLUGIN_ROOT}`)
- Claude Desktop: `dist/aiforbusiness-chat-assistant.mcpb`

## Files

- `docs/INSTALL.md` student install guide; `docs/store-listing.md` store listing; `PRIVACY.md` privacy policy
- `keys/` extension signing private key (`*.pem`) is **never committed to git** (only Xun has it; needed only to build a .crx); git holds only the public key `pub.b64` and the extension ID

## Status / known limits

- Four connection states, the same in the dashboard and popup: connected, needs pairing (the pairing code can be entered right in the dashboard), never connected yet (shows setup steps), AI not open (paired before; opening the AI connects automatically). After the extension reloads, old pages show a prompt to refresh
- The "No reply needed" list (`ignored_waiting` in `chrome.storage.local`) applies to the dashboard, the popup and MCP `list_awaiting_reply` (`include_ignored: true` shows all)
- Dashboard stats count only messages WhatsApp Web has already loaded onto the computer. The "Chat timeline" export is sorted by time and can optionally include AI drafts (placed at the time each draft was created)
- Tested on Mac: reading, pairing, Claude Code, Claude Desktop. **Not yet tested: Windows, ChatGPT Desktop, "Open chat", "Fill message box"**
- For each chat, only the messages WhatsApp Web has already stored on the computer can be read
- Unofficial reading method: it may break when WhatsApp changes; there is a risk of account restriction
- The icon has a WhatsApp-style mark in the bottom-right corner. It is only fit for private sharing with students and must be removed before listing on the Chrome Web Store

© AI for Business (aiclassmalaysia.com). All rights reserved. For students only.
