# AI for Business Chat Assistant (WhatsApp Readonly MCP)

Lets Claude read the WhatsApp Web chats you already have open in Google Chrome, on your own computer. Ask who is waiting for your reply, get a summary of a group, search old messages, or have Claude write a reply. Claude saves the reply as a draft. It is never sent: you read the draft in WhatsApp and press send yourself.

> Unofficial: not affiliated with, endorsed or sponsored by WhatsApp or Meta.

## Why this exists

A convenience for people who use AI a lot and often need help with WhatsApp. It reads chats and saves drafts, but never sends a message by itself, has no bulk or auto-reply feature and is not for spam. It reads the WhatsApp Web tab you already use (no new linked device) and works only on the computer where your Claude or ChatGPT desktop app is open.

## Install

```
/plugin install aiforbusiness-chat-assistant --marketplace aiforbusiness-hq/whatsapp-readonly-mcp
```

## What you need

1. Google Chrome with WhatsApp Web (`https://web.whatsapp.com`) logged in.
2. The companion Chrome extension "AI for Business Chat Assistant", from the `extension` folder of [the repository](https://github.com/aiforbusiness-hq/whatsapp-readonly-mcp).
3. Node.js 18 or newer.

The first time, ask Claude "What's my WhatsApp status?". Claude shows a 6-digit pairing code. Click the extension icon in Chrome and type the code within 3 minutes.

## Tools

| Tool | What it does |
|---|---|
| `get_status` | Is WhatsApp Web open and the extension paired; gives a pairing code if not |
| `list_chats` | List chats, filtered by unread, groups or a keyword |
| `get_messages` | Latest messages of one chat (up to 100) |
| `search_messages` | Search stored messages |
| `list_awaiting_reply` | Chats where the other person spoke last |
| `get_media` | Look at a photo or file already on this computer |
| `download_media` | Save one photo, video, voice note or document to Downloads, after a malware check |
| `save_draft` | Save a reply draft (never sent) |
| `list_drafts` | Drafts, and what you actually sent |

## Works on its own

You do not have to say "WhatsApp". Ask "who is waiting for my reply?", "did Aisha reply?" or "reply to Jason, say tomorrow is fine", and Claude reads the chats and saves reply drafts by itself. Drafts are never sent. The plugin's `whatsapp-read-and-draft` skill and the server instructions tell Claude when to use the tools. New drafts show first on the extension's Overview page, highlighted in yellow.

## What it runs, sends and fetches

- **Runs:** `node ${CLAUDE_PLUGIN_ROOT}/server/server.js`, a local MCP server over stdio. Plain, readable JavaScript with no dependencies and nothing installed from a registry.
- **Connects to:** only the Chrome extension, over a WebSocket on `127.0.0.1` (ports 47821 to 47830) on your own computer. It accepts only the extension's fixed origin, after pairing with SPAKE2 and a 6-digit code.
- **Stores:** a pairing key and small connection files in `~/.whatsapp-readonly-mcp` on your computer.
- **Sends to the internet:** nothing. No analytics, no update checks, no remote code. The only outside request in the whole product is made by the Chrome extension: when you ask Claude to download one file, the extension fetches that file from WhatsApp's own media server.
- **Never:** sends, forwards, deletes or marks WhatsApp messages as read. There is no code for it.

What Claude reads through these tools goes to Claude to answer you, like anything else you ask it.

## Disclaimer

Use at your own risk; we are not liable for any loss. Provided "as is" under the MIT License. For research and study, not for commercial use. For business messaging, use the official WhatsApp Business Platform (WABA) or an authorised third-party WhatsApp API provider. Unofficial: not affiliated with WhatsApp, Meta, Anthropic or OpenAI.

Privacy policy: [PRIVACY.md](https://github.com/aiforbusiness-hq/whatsapp-readonly-mcp/blob/main/PRIVACY.md) · License: MIT
