# Install guide: AI for Business Chat Assistant

Let **Claude** or **ChatGPT** help you with WhatsApp: who is waiting for your reply, what a group talked about, and drafts of your replies.

- **Never sends a message by itself.** There is no send feature. You always press send yourself.
- **Your data stays on your computer.** No server in between, no account to create. (What your AI reads goes to Claude or ChatGPT to answer you, the same as pasting a chat into it.)
- Works on Mac and Windows. Takes about 15 minutes.

> **Read first:** this is an unofficial tool, not affiliated with or approved by WhatsApp or Meta. It reads WhatsApp Web's own page. WhatsApp may limit accounts that use automation (reading only lowers the risk; it does not remove it). **Try it with a spare or work number first.** When WhatsApp updates its website, reading may stop until we release an update.

Prefer to let your AI do it? See [Option A in the README](../README.md#option-a-let-your-ai-install-it).

---

## What you need

1. **Google Chrome** on your computer.
2. **web.whatsapp.com** open in Chrome and logged in (scan the QR code with your phone).
3. One of these AI apps:
   - **Claude Desktop** (easiest)
   - **ChatGPT desktop** in **Work** mode, or **Codex** (needs Node.js, see step 3B)
   - **Claude Code**
4. The release zip `AIforBusiness-Chat-Assistant-v<version>.zip` from [Releases](https://github.com/aiforbusiness-hq/whatsapp-readonly-mcp/releases/latest), unzipped to a place you **won't move**:
   - Mac: `Documents/AIforBusiness-Chat-Assistant`
   - Windows: `C:\Users\<your name>\Documents\AIforBusiness-Chat-Assistant`
   - **Don't** unzip it under `C:\`, `C:\Users\Public`, the Mac's `/Users/Shared` or a USB drive: other users of the computer could change the program there.
   - Check the zip wasn't changed: compare it with `SHA256SUMS.txt` from the same release. Mac Terminal: `shasum -a 256 <file>.zip`. Windows PowerShell: `Get-FileHash <file>.zip`. The result must match exactly.

Inside you'll find: the `extension` folder, the `plugins` folder, `aiforbusiness-chat-assistant.mcpb` and this guide.

---

## Step 1: install the Chrome extension (about 3 minutes)

1. Type `chrome://extensions` in Chrome's address bar and press Enter.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** (top left) and choose the unzipped **`extension`** folder.
4. **AI for Business Chat Assistant** (yellow "AI+" icon) appears. Done.
5. Click the puzzle icon at the top right of Chrome and **pin** it to the toolbar.

> If the **Errors** button shows "connection failed", ignore it: the extension is looking for the AI side, which isn't running yet.

> The extension is in English. To switch it to Chinese: the yellow **AI+** in WhatsApp Web's left bar → **Settings** → **Language** → the Chinese option.

## Step 2: check the extension can read WhatsApp

1. Make sure the web.whatsapp.com tab is open and logged in.
2. Click the extension icon in the toolbar.
3. You should see the **Waiting / AI drafts / All** tabs and your chats. The top right shows red **AI not connected yet**: that's normal until step 3.

## Step 3: connect your AI (pick one)

### 3A. Claude Desktop (easiest)

1. Double-click **`aiforbusiness-chat-assistant.mcpb`**.
2. Claude Desktop shows an install screen. Press **Install**. If it warns the extension isn't reviewed, continue only if you downloaded the file from the official Releases page and the SHA-256 matches.
3. Done. Nothing else to install.

### 3B. ChatGPT desktop (Work) or Codex

This installs it as a ChatGPT **plugin**. Install **Node.js** first: download the **LTS** version from nodejs.org and click through the installer.

1. Open the ChatGPT desktop app, switch to **Work**, and start a new chat.
2. Paste this, replacing `<folder>` with where you unzipped it (for example Mac `~/Documents/AIforBusiness-Chat-Assistant`, Windows `C:\Users\<your name>\Documents\AIforBusiness-Chat-Assistant`):

```text
Please install the AI for Business Chat Assistant plugin. The plugin marketplace is in this folder: <folder>
1. Check "node -v" (must be 18 or newer). If it's missing, stop and tell me to install the LTS version from nodejs.org.
2. Run: codex plugin marketplace add "<folder>"
3. Run: codex plugin add aiforbusiness-chat-assistant@aiforbusiness
4. Run: codex plugin list, and confirm aiforbusiness-chat-assistant@aiforbusiness shows installed, enabled.
5. Tell me to fully quit and reopen ChatGPT, then ask "What's my WhatsApp status?" in a new Work chat to get the pairing code.
Don't change any file in this folder and don't install anything else.
```

3. As it says, **fully quit ChatGPT and open it again**.
4. You'll also see **AI for Business Chat Assistant** on ChatGPT's **Plugins** page, where you can turn it off or remove it.

> This plugin only works in the ChatGPT **desktop app**, in **Work** mode (or Codex). ChatGPT's Chat mode, the website and the phone app can't reach a program on your computer.

### 3C. Claude Code

Install Node.js first (as in 3B), then type in Claude Code:

```
/plugin marketplace add aiforbusiness-hq/whatsapp-readonly-mcp
/plugin install aiforbusiness-chat-assistant@aiforbusiness
```

Restart Claude Code. `/plugin` shows it and lets you turn it off or remove it.

## Step 4: pair (once, about 1 minute)

1. Start a new chat in your AI and ask: **"What's my WhatsApp status?"**
2. The AI replies with a **6-digit pairing code** (for example `123 456`; the space is optional). The code is only used on your computer and never sent over the internet. It is **valid for 3 minutes**; if it runs out, ask again for a new one.
3. Click the extension icon in Chrome → type the code into the yellow **Needs pairing** box → press **Pair**.
4. The top right turns green: **AI connected**. Done.

From now on your AI connects by itself. No need to pair again.

---

## How to use it

Just ask your AI. You don't need to say "WhatsApp". For example:

- "Who is waiting for my reply?" (the AI also drafts replies for the clear ones)
- "Summarise what the XX group talked about this week in 3 points"
- "Reply to XX, say tomorrow is fine"

The AI reads the chats and saves replies as drafts without asking first. Drafts are **never sent**. If a reply needs a fact it doesn't know (a price, a date), it asks you first.

**After a draft is saved:**

1. Click the **Open in WhatsApp** link under the draft in your AI's reply. Or use **Open & fill in** on the dashboard's Overview or in the popup's **AI drafts** tab. Opening a chat marks it as read, so the other person sees blue ticks.
2. The chat opens with the draft filled into the message box, and a yellow **AI draft** bar sits on top of the box.
3. Check it, edit it, then **press send yourself**.
4. Don't want it? Click the bar's **View** → **Dismiss**.
5. To delete a draft completely: **Remove** in the popup's **AI drafts** tab or on the dashboard, then click again to confirm.

Drafts stay only on your computer, for 90 days.

### Dashboard

WhatsApp Web's left bar (Chats, Status and so on) gets a **yellow "AI+" icon** below Meta AI. Click it to open the dashboard:

- **Overview:** **new AI drafts** at the top (yellow background, "New" tag, **Open & fill in** goes straight to the chat); then who is waiting for your reply, unread chats, the "your data stays on your computer" diagram, messages per day, and when people usually message you.
- **AI activity:** what Claude or ChatGPT read, and when.
- **Drafts vs actual:** each AI draft next to what you actually sent afterwards.
- **Export:** a chat timeline and CSV / JSON of drafts and activity, saved to your Downloads folder.
- **My data:** what is stored, with buttons to clear it.

Press ✕ at the top right or Esc to go back to WhatsApp.

---

## Troubleshooting

| You see | What to do |
|---|---|
| Yellow **AI not connected yet** | Not paired yet: do steps 3 and 4 (you can also type the code at the top of the dashboard) |
| Red **AI is closed** | You paired before; Claude or ChatGPT just isn't open. Open it and it connects by itself |
| Dashboard says the extension was just updated and this page lost connection | Reload the WhatsApp tab (⌘R / Ctrl+R) |
| Someone keeps appearing under "waiting" but needs no reply | Click **No reply needed** next to them, or open that chat and click **No reply needed** under the title. They come back only when they send a new message, and the AI won't list them either |
| Lots of very old chats under "waiting" | Dashboard → **Settings** → auto "No reply needed" → 7 / 14 / 30 days. Older ones stop counting until the other person writes again |
| Yellow **Needs pairing** | Type the pairing code as in step 4 |
| The AI says WhatsApp Web isn't open | Open web.whatsapp.com in Chrome and log in |
| The AI says only some messages are stored | Normal: WhatsApp Web keeps only recent messages on the computer. Older ones you scrolled on your phone aren't there |
| Some chats "can't be judged" for waiting | Those chats have no messages stored on the computer, so it doesn't guess |
| Too many wrong pairing codes | Fully quit the AI app, open it again, and ask "What's my WhatsApp status?" for a new code |
| Windows firewall prompt | The program only uses 127.0.0.1 on your computer; it still works if you choose **Cancel** |
| You moved the unzipped folder | Load the Chrome extension again with **Load unpacked**. The ChatGPT and Claude Code plugins aren't affected (they were copied when installed); reinstall them when you update |

## Upgrading from the old name "WhatsApp Assistant"

Since 0.12.0 it is called **AI for Business Chat Assistant** and works the same. Remove the old AI plugin first, or you'll have two (plugin names `whatsapp-assistant` or `chat-assistant` are old ones):

1. Claude Desktop: Settings → Extensions → remove "AI for Business – WhatsApp Assistant", then double-click the new `aiforbusiness-chat-assistant.mcpb`.
2. ChatGPT / Codex: `codex plugin remove whatsapp-assistant@aiforbusiness` (or `chat-assistant@aiforbusiness`), then install as in step 3B.
3. Claude Code: `/plugin uninstall whatsapp-assistant@aiforbusiness` (or `chat-assistant@aiforbusiness`), then install as in step 3C.
4. Chrome extension: load the new `extension` folder as in step 1. No need to pair again.

## Disclaimer

- **Use at your own risk. We are not liable for any loss.** Provided "as is", without warranty (see the MIT License). AI for Business is not responsible for any loss from using it, including lost data, missed or wrong replies, or any action WhatsApp takes on your account.
- **For research and study, not for commercial use.**
- **For business messaging, use the official WhatsApp Business Platform (WABA) or an authorised third-party WhatsApp API provider.**
- **Unofficial:** not affiliated with WhatsApp, Meta, Anthropic or OpenAI.
- Follow WhatsApp's terms and the law where you live, including privacy for other people's messages.

## Uninstall

1. `chrome://extensions` → remove the extension.
2. Claude Desktop: Settings → Extensions → remove. ChatGPT: Plugins page → remove (or `codex plugin remove aiforbusiness-chat-assistant@aiforbusiness`). Claude Code: `/plugin uninstall aiforbusiness-chat-assistant@aiforbusiness`.
3. Delete the pairing key folder: Mac `~/.whatsapp-readonly-mcp`, Windows `C:\Users\<your name>\.whatsapp-readonly-mcp`.
4. Delete the unzipped folder.
