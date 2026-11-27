// Benchmark: this plugin vs browser automation, on the same made-up WhatsApp Web page.
//
//   node bench/run.mjs [--runs 3] [--methods plugin,browser] [--model <id>]
//
// For each question in fixture.mjs and each method, runs `claude -p` and records wall time,
// tokens and cost from Claude Code's JSON output. Raw results: bench/results/raw-<time>.jsonl
//
// - plugin:  Claude gets only this plugin's MCP tools (real extension + real MCP server).
// - browser: Claude gets only a browser (Playwright MCP) opened on the same page, and reads it itself.
// Both use a fake web.whatsapp.com served on this computer (test ports, made-up chats).
// Never touches the real WhatsApp, ports 47821-47830 or ~/.whatsapp-readonly-mcp.
// Needs: Chrome for Testing / Chromium (Playwright's), openssl, npx, and the `claude` CLI logged in.
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:https";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, readdirSync, existsSync, appendFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPage } from "./page.mjs";
import { TASKS } from "./fixture.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const RUNS = Number(arg("runs", 3));
const METHODS = arg("methods", "plugin,browser").split(",");
const MODEL = arg("model", "");
const PW = "@playwright/mcp@0.0.86";
const BASE = 32100; // test port band, away from the real 47821-47830 and from the test suites
const ID = "hmajmekaiaiilhneebgbnchonfkblndb";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("[bench]", ...a);

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const c = join(homedir(), "Library/Caches/ms-playwright");
  for (const d of readdirSync(c).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse())
    for (const a of readdirSync(join(c, d))) for (const app of ["Google Chrome for Testing", "Chromium"]) {
      const p = join(c, d, a, `${app}.app/Contents/MacOS/${app}`);
      if (existsSync(p)) return p;
    }
  throw new Error("no Chromium found; set CHROMIUM_PATH");
}

const dir = mkdtempSync(join(tmpdir(), "wa-bench-"));
const procs = [];
process.on("exit", () => { for (const p of procs) try { p.kill("SIGKILL"); } catch (_) {} });
process.on("SIGINT", () => process.exit(1));

// 1. The fake WhatsApp Web page over HTTPS
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=web.whatsapp.com", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem")], { stdio: "ignore" });
const PAGE = buildPage();
const srv = createServer({ key: readFileSync(join(dir, "k.pem")), cert: readFileSync(join(dir, "c.pem")) }, (req, res) => {
  res.setHeader("content-type", "text/html");
  res.end(req.headers.host === "web.whatsapp.com" && req.url.split("?")[0] === "/" ? PAGE : "");
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const PORT = srv.address().port;
const CHROMIUM = findChromium();
const chromeArgs = [`--host-resolver-rules=MAP web.whatsapp.com:443 127.0.0.1:${PORT}`, "--ignore-certificate-errors"];
const work = join(dir, "work"); mkdirSync(work); // empty folder: no project instructions get loaded

// 2. Plugin method: real extension in a test Chromium, paired with the real MCP server
async function setupPlugin() {
  const extDir = join(dir, "ext"), profile = join(dir, "profile"), data = join(dir, "data");
  cpSync(join(ROOT, "extension"), extDir, { recursive: true });
  const bg = join(extDir, "background.js"); writeFileSync(bg, readFileSync(bg, "utf8").replaceAll("47821", String(BASE)));
  const ch = spawn(CHROMIUM, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, `--load-extension=${extDir}`,
    `--disable-extensions-except=${extDir}`, "--no-first-run", ...chromeArgs, "https://web.whatsapp.com/"], { stdio: ["ignore", "ignore", "pipe"] });
  procs.push(ch);
  const wsUrl = await new Promise((r) => { let s = ""; ch.stderr.on("data", (d) => { s += d; const m = /DevTools listening on (ws:\S+)/.exec(s); if (m) r(m[1]); }); });
  const http = "http://" + new URL(wsUrl).host;
  const evalIn = async (match, expression) => {
    let t; for (let i = 0; i < 60 && !t; i++) { t = (await (await fetch(http + "/json")).json()).find((x) => x.type === "page" && x.url.startsWith(match)); if (!t) await sleep(250); }
    const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
    const v = await new Promise((r) => { ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === 1) r(m); }; ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } })); });
    ws.close(); return v.result?.result?.value;
  };
  // a leader MCP server that stays up; each `claude -p` run starts its own server that joins it
  const env = { ...process.env, WA_READONLY_DATA_DIR: data, WA_READONLY_TEST_PORT_BASE: String(BASE) };
  const leader = spawn(process.execPath, [join(ROOT, "plugins/aiforbusiness-chat-assistant/server/server.js")], { env, stdio: ["pipe", "pipe", "ignore"] });
  procs.push(leader);
  let buf = "", n = 1; const w = new Map();
  leader.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); w.get(m.id)?.(m.result); } });
  const rpc = (method, params) => new Promise((r) => { const id = n++; w.set(id, r); leader.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
  const call = async (name, args = {}) => JSON.parse((await rpc("tools/call", { name, arguments: args })).content[0].text);
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "bench" } });
  await sleep(2500);
  const st = await call("get_status");
  await fetch(http + `/json/new?chrome-extension://${ID}/popup.html`, { method: "PUT" });
  let pr; for (let i = 0; i < 20 && !pr?.ok; i++) {
    await sleep(500);
    pr = await evalIn(`chrome-extension://${ID}/popup.html`, `Promise.race([chrome.runtime.sendMessage({type:"state",force:true}).then(()=>chrome.runtime.sendMessage(${JSON.stringify({ type: "pair", code: st.pairing_code })})), new Promise((r) => setTimeout(() => r(null), 4000))])`);
  }
  if (!pr?.ok) throw new Error("pairing failed: " + JSON.stringify(pr));
  for (let i = 0; i < 40; i++) { const s = await call("get_status"); if (s.paired && s.whatsapp?.open) break; await sleep(500); }
  const check = await call("list_chats", { limit: 3 });
  if (!check.ok || !check.chats?.length) throw new Error("plugin cannot read the test page: " + JSON.stringify(check).slice(0, 300));
  const cfg = join(dir, "mcp-plugin.json");
  writeFileSync(cfg, JSON.stringify({ mcpServers: { wa: { command: process.execPath, args: [join(ROOT, "plugins/aiforbusiness-chat-assistant/server/server.js")],
    env: { WA_READONLY_DATA_DIR: data, WA_READONLY_TEST_PORT_BASE: String(BASE) } } } }));
  log("plugin ready: extension paired, test page readable");
  return { cfg, allow: "mcp__wa", hint: "" };
}

// 3. Browser method: Playwright MCP with its own Chromium on the same page
async function setupBrowser() {
  execFileSync("npx", ["-y", PW, "--help"], { stdio: "ignore" }); // download once, outside the timing
  const pw = join(dir, "playwright.json");
  writeFileSync(pw, JSON.stringify({ browser: { browserName: "chromium", isolated: true,
    launchOptions: { executablePath: CHROMIUM, headless: true, args: chromeArgs }, contextOptions: { ignoreHTTPSErrors: true } } }));
  const cfg = join(dir, "mcp-browser.json");
  writeFileSync(cfg, JSON.stringify({ mcpServers: { browser: { command: "npx", args: ["-y", PW, "--config", pw] } } }));
  log("browser ready: Playwright MCP", PW);
  return { cfg, allow: "mcp__browser", hint: " WhatsApp Web is open and logged in at https://web.whatsapp.com — use the browser to read it." };
}

function runClaude(method, setup, task) {
  const prompt = task.prompt + setup.hint + " Only read; never send, type or click anything that sends.";
  const args = ["-p", prompt, "--output-format", "json", "--mcp-config", setup.cfg, "--strict-mcp-config", "--tools", "", "--allowedTools", setup.allow, "--setting-sources", "", "--max-turns", "40"];
  if (MODEL) args.push("--model", MODEL);
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn("claude", args, { cwd: work, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    const kill = setTimeout(() => p.kill("SIGKILL"), 10 * 60 * 1000);
    p.on("close", () => {
      clearTimeout(kill);
      const wall = Date.now() - t0;
      let j = null; try { j = JSON.parse(out); } catch (_) {}
      const u = Object.values(j?.modelUsage || {}).reduce((a, m) => ({
        input: a.input + (m.inputTokens || 0), cache_write: a.cache_write + (m.cacheCreationInputTokens || 0),
        cache_read: a.cache_read + (m.cacheReadInputTokens || 0), output: a.output + (m.outputTokens || 0) }), { input: 0, cache_write: 0, cache_read: 0, output: 0 });
      const answer = String(j?.result || "");
      resolve({
        time: new Date().toISOString(), method, task: task.id, wall_ms: wall, api_ms: j?.duration_api_ms ?? null, turns: j?.num_turns ?? null,
        tokens: { ...u, total: u.input + u.cache_write + u.cache_read + u.output }, cost_usd: j?.total_cost_usd ?? null,
        model: Object.keys(j?.modelUsage || {}).join(","), correct: !!j && task.check(answer.toLowerCase()), error: j ? (j.is_error ? j.subtype : null) : "no JSON output",
        answer: answer.slice(0, 600)
      });
    });
  });
}

const setups = {};
if (METHODS.includes("plugin")) setups.plugin = await setupPlugin();
if (METHODS.includes("browser")) setups.browser = await setupBrowser();
mkdirSync(join(ROOT, "bench/results"), { recursive: true });
const out = join(ROOT, "bench/results", `raw-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
log("writing", out);
for (let r = 1; r <= RUNS; r++)
  for (const task of TASKS)
    for (const method of METHODS) { // methods alternate, so time-of-day effects hit both
      const res = { run: r, ...(await runClaude(method, setups[method], task)) };
      appendFileSync(out, JSON.stringify(res) + "\n");
      log(`run ${r} ${task.id} ${method}: ${(res.wall_ms / 1000).toFixed(1)}s, ${res.tokens.total} tokens, correct=${res.correct}${res.error ? " error=" + res.error : ""}`);
    }
log("done:", out);
process.exit(0);
