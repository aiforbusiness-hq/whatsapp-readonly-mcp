# Benchmark: this plugin vs browser automation

**Question:** to answer a WhatsApp question, how much time and how many tokens does an AI need when it uses this plugin, compared with reading WhatsApp Web through a browser tool?

## Setup

- **Same page for both.** A WhatsApp-Web-like page with 12 made-up chats ([`fixture.mjs`](fixture.mjs), [`page.mjs`](page.mjs)), served on this computer as `web.whatsapp.com`. No real chats are used.
- **This plugin:** the real Chrome extension in a test Chromium, paired with the real MCP server (test ports). Claude only gets the plugin's tools.
- **Browser automation:** Claude only gets a browser ([Playwright MCP](https://github.com/microsoft/playwright-mcp) `@playwright/mcp@0.0.86`) opened on the same page, and reads it itself (accessibility snapshots, clicks).
- **Same model and app:** `claude -p` (Claude Code CLI), no other tools, no project or user settings, an empty working folder. Each run is a fresh session.
- **Three questions:** who is waiting for my reply; summarise a group; find a message with an invoice number. Each answer is checked automatically for the right names and facts.
- **Measured per run:** wall-clock time from start to answer, and total tokens (fresh input + cache writes + cache reads + output) from Claude Code's JSON output. Cost and turns are recorded too.
- Methods alternate run by run, so changes in server speed affect both.

## Results

See [`results/summary.json`](results/summary.json) (medians) and the chart in the main README. Raw runs are in [`results/raw-*.jsonl`](results/), one line per run.

Notes for reading the numbers:
- About 15k of each plugin run's tokens are the fixed cost of Claude Code's own instructions; browser runs pay that too.
- The test page has only 12 short chats. Real WhatsApp Web has hundreds of chats and much longer pages, which makes browser reading slower and more expensive, while the plugin reads only what it is asked for.

## Run it yourself

```bash
node bench/run.mjs --runs 5
node bench/chart.mjs
```

Needs Playwright's Chromium (or `CHROMIUM_PATH`), `openssl`, `npx`, and the `claude` CLI logged in. It never touches your real WhatsApp, the real ports 47821–47830 or `~/.whatsapp-readonly-mcp`.
