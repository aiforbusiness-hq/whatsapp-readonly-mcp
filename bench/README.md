# Benchmark: this plugin vs browser automation (Playwright MCP, Claude in Chrome)

**Question:** to answer a WhatsApp question, how much time and how many tokens does an AI need when it uses this plugin, compared with reading WhatsApp Web through a browser tool (Playwright MCP or Claude in Chrome)?

## Setup

- **Same page for both.** A WhatsApp-Web-like page with 12 made-up chats ([`fixture.mjs`](fixture.mjs), [`page.mjs`](page.mjs)), served on this computer. No real chats are used.
- **This plugin:** the real Chrome extension in a test Chromium, paired with the real MCP server (test ports). Claude only gets the plugin's tools.
- **Browser automation:** Claude only gets a browser ([Playwright MCP](https://github.com/microsoft/playwright-mcp) `@playwright/mcp@0.0.86`) opened on the same page, and reads it itself (accessibility snapshots, clicks). The page is served as `web.whatsapp.com`, mapped to this computer.
- **Claude in Chrome:** Claude only gets the [Claude in Chrome](https://claude.com/chrome) tools (`claude -p --chrome`), driving a tab in your real Chrome. Because that Chrome may have your real WhatsApp signed in, the page is served at a plain `http://127.0.0.1:<port>/` address instead, and every URL Claude opens is logged. In all fully logged runs Claude only visited that local address.
- **Same model and app:** `claude -p` (Claude Code CLI), no other tools, no project or user settings, an empty working folder. Each run is a fresh session.
- **Three questions:** who is waiting for my reply; summarise a group; find a message with an invoice number. Each answer is checked automatically for the right names and facts.
- **Measured per run:** wall-clock time from start to answer, and total tokens (fresh input + cache writes + cache reads + output) from Claude Code's JSON output. Cost and turns are recorded too.
- Methods alternate run by run, so changes in server speed affect all of them. The Claude in Chrome runs were done in a separate session the same day (3 trial runs + 15 runs; URL logging in the first 2 trial runs missed some batched calls).

## Results

See [`results/summary.json`](results/summary.json) (medians) and the chart in the main README. Raw runs are in [`results/raw-*.jsonl`](results/), one line per run.

Notes for reading the numbers:
- About 15k of each plugin run's tokens are the fixed cost of Claude Code's own instructions; browser runs pay that too.
- The test page has only 12 short chats. Real WhatsApp Web has hundreds of chats and much longer pages, which makes browser reading slower and more expensive, while the plugin reads only what it is asked for.

## Run it yourself

```bash
node bench/run.mjs --runs 5
node bench/run.mjs --runs 5 --methods chrome --chrome-device <deviceId>   # optional, needs Claude in Chrome connected
node bench/chart.mjs
```

Needs Playwright's Chromium (or `CHROMIUM_PATH`), `openssl`, `npx`, and the `claude` CLI logged in. It never touches your real WhatsApp, the real ports 47821–47830 or `~/.whatsapp-readonly-mcp`.
