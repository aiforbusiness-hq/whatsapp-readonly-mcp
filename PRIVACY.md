# Privacy Policy – AI for Business Chat Assistant

Effective: 26 November 2026

AI for Business Chat Assistant ("the extension") is a Chrome extension with a small local program ("the plugin") for Claude and ChatGPT. It lets your own AI app read the WhatsApp Web page you already have open in Chrome and save reply drafts.

**Unofficial.** This product is not affiliated with, endorsed or sponsored by WhatsApp LLC or Meta Platforms, Inc. "WhatsApp" is a trademark of its owner and is used here only to say which website the extension works with.

## What the extension reads

- Only the page `https://web.whatsapp.com` in your own Chrome.
- Chat list, messages, and information about photos, videos and files in your chats, when your AI app asks for them through the local plugin, or to show the extension's own dashboard on that page.

## Where your data is kept

Everything stays on your computer:

- In Chrome's storage for the extension: reply drafts, the AI activity log, the list of downloaded files, "No reply needed" marks, settings, a temporary chat-list cache (in memory only), and the pairing key.
- In the folder `~/.whatsapp-readonly-mcp` on your computer: the pairing key and small connection files used by the local plugin.
- Files you ask the AI to download are saved in your Downloads folder, under "AI for Business Chat Assistant".

The extension talks to the local plugin only through `127.0.0.1` (your own computer), protected by a pairing code.

## What we receive

Nothing. We (AI for Business) run no server for this product. The extension and plugin contain no analytics, no tracking, no ads and no remote code.

The only internet request the extension makes on its own is this: when your AI app asks to download one photo, video or file, the extension fetches that one file from WhatsApp's own media servers, the same place WhatsApp Web gets it from.

## Your AI app

When you ask Claude or ChatGPT about your chats, that AI app sends what it reads to its provider (Anthropic or OpenAI) to answer you, as it does with anything else you ask. Their own privacy policies apply to that. You choose which AI app to connect and what to ask.

## What we never do

- Sell or share your data with anyone.
- Use your data for advertising, credit checks or lending.
- Let any person read your data.
- Send messages, mark messages as read, or change anything in your WhatsApp account. The product has no code that can do this.

The use of information received from Chrome APIs complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.

## How long data is kept, and how to delete it

- The downloaded-files list keeps at most 40 items and 60 days.
- Other items stay until you clear them. Some lists, like the activity log, also drop their oldest entries on their own.
- To clear it: open the extension's dashboard, go to **My data**, and press **Clear** for one item or **Clear everything**. You are always asked to confirm.
- Removing the extension from Chrome deletes all of its stored data. To remove the pairing key too, delete the folder `~/.whatsapp-readonly-mcp`.
- Files already saved in your Downloads folder are yours; delete them yourself if you want.

## Changes and contact

If this policy changes, the new version will be published at the same address with a new date.

Questions: open an issue at https://github.com/aiforbusiness-hq/whatsapp-readonly-mcp/issues
