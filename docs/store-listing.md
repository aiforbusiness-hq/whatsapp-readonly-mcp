# Store listing text (Chrome Web Store and Claude directory)

Copy these into the store forms. Keep them in line with `PRIVACY.md`.

## Name

AI for Business Chat Assistant

Do not put "WhatsApp", "Whats" or "WA" in the name, the short name or the icon.

## Short description (132 characters max)

Unofficial helper for WhatsApp Web: Claude or ChatGPT reads your chats and drafts replies. Never sends. Not affiliated with Meta.

## Long description

AI for Business Chat Assistant lets Claude or ChatGPT on your computer read the WhatsApp Web page you already have open in Chrome.

Ask your AI things like "who is waiting for my reply?" or "what did this group talk about today?". It can also write a reply and save it as a draft. The draft appears above the message box, and you press send yourself.

- Never sends: no send, reply, forward, delete or mark-as-read feature.
- Stays on your computer: talks to your AI app only through 127.0.0.1, after you pair with a 6-digit code.
- No analytics, no ads, no remote code. We run no server and receive nothing.
- My data page: see what is stored and clear it, with a confirmation.

Unofficial: not affiliated with, endorsed or sponsored by WhatsApp or Meta. It reads WhatsApp Web's page, which may change when WhatsApp updates. WhatsApp's terms limit automated access, so try it with a spare or work number first.

Needs the "AI for Business Chat Assistant" plugin in Claude Desktop, Claude Code or ChatGPT/Codex.

## Single purpose

Let the user's own AI app (Claude or ChatGPT, running on the same computer) read the user's open WhatsApp Web chats and save reply drafts for the user to send manually.

## Permission justifications

| Permission | Why it is needed |
|---|---|
| Host `https://web.whatsapp.com/*` | The only site the extension works on. It reads the open WhatsApp Web page and shows the dashboard and drafts there. |
| `scripting` | Runs the read-only reader inside the WhatsApp Web tab when the AI asks, and restarts it in tabs that were open before the extension was installed or updated. |
| `storage` | Keeps drafts, the AI activity log, settings and the pairing key on this computer. |
| `alarms` | Checks every 30 seconds whether the local AI plugin is running, so it reconnects without the user doing anything. |
| `downloads` | Saves the one photo, video or file the AI was asked to download into the Downloads folder. |
| `offscreen` | Builds the file to save from its downloaded parts (Chrome's service worker cannot create a download link). |

## Remote code

No. All code is inside the package. The Content Security Policy allows scripts only from the extension itself.

## Data usage form (Chrome)

- Declare: **Personal communications** and **Website content**. They are handled on the user's computer and given only to the user's own AI app when the user asks.
- Tick all three certifications: no sale to third parties; no use unrelated to the single purpose; no use for credit or lending.
- Privacy policy URL: `https://github.com/aiforbusiness-hq/whatsapp-readonly-mcp/blob/main/PRIVACY.md`

## Before submitting

- The GitHub repository `aiforbusiness-hq/whatsapp-readonly-mcp` must be public (it is private for now).
- LICENSE: MIT (added).
- Screenshots must use a test number with made-up chats. Show no real names or messages.
