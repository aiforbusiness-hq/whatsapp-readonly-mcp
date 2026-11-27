<p align="center"><img src="docs/images/logo.png" width="112" alt="AI for Business Chat Assistant logo"></p>

<h1 align="center">WhatsApp Readonly MCP</h1>

<p align="center"><b>🔒 Secure&nbsp;&nbsp;·&nbsp;&nbsp;🛡️ Private&nbsp;&nbsp;·&nbsp;&nbsp;✋ Never sends by itself</b></p>

**The secure, private WhatsApp MCP: your AI talks straight to your own WhatsApp Web. No relay, no servers in between, never sends a message by itself.**

![How it works: your AI app, the local plugin and the Chrome extension with WhatsApp Web, all on your computer, connected over 127.0.0.1. No relay or outside server.](docs/images/architecture.png)

[![tests](https://github.com/aiforbusiness-hq/whatsapp-readonly-mcp/actions/workflows/test.yml/badge.svg)](https://github.com/aiforbusiness-hq/whatsapp-readonly-mcp/actions/workflows/test.yml)
![secure: no send tool](https://img.shields.io/badge/secure-no%20send%20tool-brightgreen)
![private: no relay](https://img.shields.io/badge/private-no%20relay%2C%20no%20server-brightgreen)
![license: MIT](https://img.shields.io/badge/license-MIT-blue)
![runs locally](https://img.shields.io/badge/data-stays%20on%20your%20computer-green)
![zero dependencies](https://img.shields.io/badge/dependencies-0-lightgrey)

WhatsApp Readonly MCP is a **[Model Context Protocol](https://modelcontextprotocol.io) (MCP) server plus a Chrome extension** for WhatsApp Web. It reads your chats and saves reply drafts, and **never sends a message by itself**. The Chrome extension reads the WhatsApp Web tab you already have open. The local MCP server gives that data to your AI app on the same computer. Nothing goes through our servers. We run none.

In the stores the product is called **AI for Business Chat Assistant**, by AI for Business.

> **Unofficial.** Not affiliated with, endorsed or sponsored by WhatsApp or Meta. "WhatsApp" is used only to say which website this works with. WhatsApp's terms limit automated access, so try it with a spare or work number first.

[Compatibility](#compatibility) · [Install](#install) · [Tools](#mcp-tools) · [Secure & private](#-secure--private-by-design) · [FAQ](#faq) · [Privacy](PRIVACY.md) · [Security policy](SECURITY.md) · [Disclaimer](#disclaimer) · [Development](docs/DEVELOPMENT.md)

---

## Why this exists

For people who use AI every day and often need its help with WhatsApp: who is waiting for a reply, what a busy group said, a first draft of an answer. It is a convenience, not a way around WhatsApp.

- **Never sends a message by itself.** It reads your chats and saves reply drafts; you read each draft and press send yourself.
- **Not for spam or bulk messaging.** There is no send, broadcast, forward or auto-reply feature, and there never will be.
- **Doesn't get around WhatsApp.** It reads the WhatsApp Web tab you already use, logged in as you. No new linked device, no unofficial account, no scraping of other people's chats.
- **Only on your own computer.** It works only on the computer where your Claude or ChatGPT desktop app is open, with WhatsApp Web open in Chrome. Nothing runs in the cloud.

## 🔒 Secure & private by design

Most WhatsApp MCP servers log in as a new linked device and include a "send message" tool. This one is different:

| | WhatsApp Readonly MCP | Typical WhatsApp MCP / bot |
|---|---|---|
| Can send, reply, forward, delete | **No: there is no code for it** | Yes |
| Marks messages as read | **No** | Often |
| How it connects | The WhatsApp Web tab you already use | A new linked device or session |
| Where data goes | Only your computer and the AI app you chose | Depends on the project |
| Outside servers, analytics | **None** | Varies |
| Dependencies | **0** (hand-written MCP + WebSocket) | Many |

- **Never sends.** The code has no send, Enter key, mark-as-read or delete path. Filling a draft into the box and opening a chat only react to real clicks (`event.isTrusted`).
- **Local only.** The server listens on `127.0.0.1` only and accepts the extension's fixed origin only. Any web page is refused.
- **Pairing.** A 6-digit code with SPAKE2 (RFC 9382, P-256): each try can test one guess only, even for a program that records everything. The code lasts 3 minutes, with 5 tries per code and 12 per run. After pairing, both sides prove they hold a 256-bit secret with HMAC. The secret never crosses the wire.
- **Downloads are checked.** Only types that can be checked completely are saved: photos, video, audio, text, PDF and modern Office. Programs, archives, macros, dangerous PDF actions, DDE fields and spreadsheet formulas are refused. A check that cannot finish refuses the file.
- **No outside network.** No analytics, update checks, remote code or web fonts. The only outside request is `download_media` fetching one file from WhatsApp's own media server.
- **You can wipe it.** The dashboard's **My data** page shows everything stored and clears it, after a confirmation.

Full design notes: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## What you can ask

- "Who is waiting for my reply?"
- "Summarise what the parents' group talked about today."
- "Find the message where Alex sent the invoice."
- "Draft a polite reply to the last customer who asked about prices."
- "Download the PDF in that message."

You do not have to say "WhatsApp": the AI reads your chats and saves reply drafts on its own when a question is about messages, customers or replies. A draft appears above the WhatsApp message box and first on the extension's Overview page, and **you** press send.

## Install

### Option A: let your AI install it

Copy this into **Claude Code**, **Codex** or **ChatGPT (Work mode)**:

```text
Install AI for Business Chat Assistant from https://github.com/aiforbusiness-hq/whatsapp-readonly-mcp on this computer.
Go one step at a time, tell me each result, and stop if anything fails. Never send, delete or mark any WhatsApp message.
1. Check "node -v" is 18 or newer; if not, tell me to install Node.js LTS from nodejs.org and stop.
2. Into my Downloads folder, download SHA256SUMS.txt and the two files it lists from the repo's releases/latest/download/,
   check the checksums (stop if any differ), then unzip the .zip.
3. Install the plugin for this app. Claude Code: "claude plugin marketplace add aiforbusiness-hq/whatsapp-readonly-mcp",
   then "claude plugin install aiforbusiness-chat-assistant@aiforbusiness". Codex/ChatGPT: the same with "codex plugin marketplace add"
   and "codex plugin add". If I use Claude Desktop, open the downloaded .mcpb file and tell me to press Install.
4. Open chrome://extensions and guide me: Developer mode on, Load unpacked, choose the unzipped "extension" folder (show its path).
5. Tell me to restart this app, open web.whatsapp.com, and ask "What's my WhatsApp status?" for the 6-digit pairing code.
```

Only using Claude Desktop? Do Option B.

### Option B: install it yourself

#### 1. Chrome extension

1. Download the release zip, or build it yourself: `sh mcpb/build.sh && sh scripts/build-release.sh`. The zip lands in `dist/`.
2. Open `chrome://extensions`, turn on **Developer mode**, press **Load unpacked**, and choose the `extension` folder.
3. Open `https://web.whatsapp.com` and log in.

#### 2. Connect your AI app (pick one)

**Claude Desktop:** double-click `aiforbusiness-chat-assistant.mcpb`, then press **Install**.

**Claude Code:**

```
/plugin marketplace add aiforbusiness-hq/whatsapp-readonly-mcp
/plugin install aiforbusiness-chat-assistant@aiforbusiness
```

**ChatGPT desktop / Codex:**

```bash
codex plugin marketplace add aiforbusiness-hq/whatsapp-readonly-mcp
```

```bash
codex plugin add aiforbusiness-chat-assistant@aiforbusiness
```

**Any other MCP client** (stdio):

```json
{ "mcpServers": { "whatsapp-readonly": { "command": "node", "args": ["/path/to/plugins/aiforbusiness-chat-assistant/server/server.js"] } } }
```

#### 3. Pair once

Ask your AI: "What's my WhatsApp status?" It shows a 6-digit code such as `123 456`. Click the extension icon in Chrome and type the code within 3 minutes. You only do this once.

Step-by-step guide with troubleshooting: [`docs/INSTALL.md`](docs/INSTALL.md)

## MCP tools

| Tool | Type | What it does |
|---|---|---|
| `get_status` | read | Is WhatsApp Web open, is the extension connected and paired; gives a pairing code if not |
| `list_chats` | read | List chats, with filters for unread, groups or a keyword |
| `get_messages` | read | Latest messages of one chat (up to 100) |
| `search_messages` | read | Search stored messages, including captions, file names, locations, contacts and polls |
| `list_awaiting_reply` | read | Chats where the other person spoke last and you have not replied |
| `get_media` | read | Look at a photo, sticker or file already on this computer |
| `download_media` | download | Save one photo, video, voice note or document to Downloads, after a malware check |
| `save_draft` | draft | Save a reply draft. It is never sent |
| `list_drafts` | read | Drafts, and what you actually sent, for comparison |

Every tool declares MCP annotations (`readOnlyHint`, `destructiveHint: false`, `idempotentHint`, `openWorldHint`), so the AI app can tell reading from writing.

## Compatibility

| App | Mode | Works | How |
|---|---|:---:|---|
| Claude Desktop | Chat | ✅ | `aiforbusiness-chat-assistant.mcpb` desktop extension |
| Claude Code | CLI / desktop | ✅ | Plugin marketplace in this repo |
| ChatGPT desktop | **Work** | ✅ | Plugin marketplace in this repo (installed through Codex) |
| ChatGPT desktop | **Chat** | ❌ | Chat mode can't use local plugins. Switch to Work |
| Codex | CLI / desktop | ✅ | Plugin marketplace in this repo |
| Claude or ChatGPT on the web or phone | — | ❌ | They can't reach a program on your computer |
| Any other MCP client | stdio | ✅ | `node plugins/aiforbusiness-chat-assistant/server/server.js` |

Needs Google Chrome (version 116 or newer), WhatsApp Web logged in, and Node.js 18 or newer. Runs on macOS and Windows.

## FAQ

**Can Claude read my WhatsApp messages?**
Yes. With this extension and MCP server, Claude Desktop or Claude Code can read the WhatsApp Web chats open in your Chrome, on your own computer.

**Can ChatGPT read WhatsApp?**
Yes, through the ChatGPT desktop app or Codex with this plugin installed.

**Can the AI send WhatsApp messages with this?**
No. There is no send feature at all. The AI can only save drafts. You read a draft and press send yourself.

**Is my WhatsApp data uploaded anywhere?**
Not to us. Data stays on your computer. When you ask your AI a question, that AI app sends what it reads to its own provider (Anthropic or OpenAI) to answer you, as with anything else you ask it.

**Does it work on my phone?**
The extension needs WhatsApp Web in Chrome on a computer that stays on. You can then ask from your phone through a remote session of an AI app running on that computer, such as Claude Code Remote Control. The normal Claude or ChatGPT phone apps cannot reach it.

**Will WhatsApp ban my account?**
It might. This tool only reads, which lowers the risk, but WhatsApp's terms limit automated access. Use a spare or work number first.

**Does it mark messages as read?**
No. Reading through the extension does not open the chat or send read receipts.

**Does it need the WhatsApp Business API?**
No. It reads the normal WhatsApp Web you already use. No API key, no Meta developer account.

## Disclaimer

- **Use at your own risk. We are not liable for any loss.** This software is provided "as is", without warranty of any kind (see the [MIT License](LICENSE)). AI for Business is not responsible for any loss or damage from using it, including lost data, missed or wrong messages, or any action WhatsApp takes on your account.
- **For research and study.** This project is meant for personal research, study and learning how AI can help with your own chats. It is not meant for commercial use.
- **For business or commercial messaging, use an official route:** the [WhatsApp Business Platform (official API, WABA)](https://business.whatsapp.com/products/business-platform) or an authorised third-party WhatsApp API provider.
- **Unofficial.** Not affiliated with, endorsed or sponsored by WhatsApp, Meta, Anthropic or OpenAI. All trademarks and logos belong to their owners and are used only to show what this works with.
- **You are responsible** for following WhatsApp's Terms of Service and the laws that apply to you, including privacy law for other people's messages.

## License

[MIT](LICENSE) © 2026 AI for Business

