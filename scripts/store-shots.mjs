// Chrome Web Store screenshots (1280x800) from the made-up chats in bench/fixture.mjs.
//   node scripts/store-shots.mjs      -> dist/store/*.png
// Real extension in a headless test Chromium, paired with the real MCP server on test ports.
// Never touches the real WhatsApp, ports 47821-47830 or ~/.whatsapp-readonly-mcp.
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:https";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, readdirSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPage } from "../bench/page.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist/store"); mkdirSync(OUT, { recursive: true });
const BASE = 32300; // test port band
const ID = "hmajmekaiaiilhneebgbnchonfkblndb";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const dir = mkdtempSync(join(tmpdir(), "wa-shots-"));
const procs = [];
process.on("exit", () => { for (const p of procs) try { p.kill("SIGKILL"); } catch (_) {} });

execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=web.whatsapp.com", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem")], { stdio: "ignore" });
const PAGE = buildPage();
const srv = createServer({ key: readFileSync(join(dir, "k.pem")), cert: readFileSync(join(dir, "c.pem")) }, (req, res) => {
  res.setHeader("content-type", "text/html");
  res.end(req.headers.host === "web.whatsapp.com" && req.url.split("?")[0] === "/" ? PAGE : "");
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));

const extDir = join(dir, "ext");
cpSync(join(ROOT, "extension"), extDir, { recursive: true });
const bg = join(extDir, "background.js"); writeFileSync(bg, readFileSync(bg, "utf8").replaceAll("47821", String(BASE)));
const ch = spawn(findChromium(), ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${join(dir, "profile")}`, `--load-extension=${extDir}`,
  `--disable-extensions-except=${extDir}`, "--no-first-run", "--window-size=1280,800", "--hide-scrollbars",
  `--host-resolver-rules=MAP web.whatsapp.com:443 127.0.0.1:${srv.address().port}`, "--ignore-certificate-errors", "https://web.whatsapp.com/"], { stdio: ["ignore", "ignore", "pipe"] });
procs.push(ch);
const wsUrl = await new Promise((r) => { let s = ""; ch.stderr.on("data", (d) => { s += d; const m = /DevTools listening on (ws:\S+)/.exec(s); if (m) r(m[1]); }); });
const http = "http://" + new URL(wsUrl).host;

async function session(match) {
  let t; for (let i = 0; i < 60 && !t; i++) { t = (await (await fetch(http + "/json")).json()).find((x) => x.type === "page" && x.url.startsWith(match)); if (!t) await sleep(250); }
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  let n = 0; const w = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); w.get(m.id)?.(m); };
  const send = (method, params = {}) => new Promise((r) => { const id = ++n; w.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  return {
    eval: async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value,
    shot: async (file, w = 1280, h = 800) => {
      await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      await sleep(800);
      const r = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
      writeFileSync(join(OUT, file), Buffer.from(r.result.data, "base64"));
      console.log("->", join("dist/store", file));
    },
    close: () => ws.close()
  };
}

// MCP server (leader) on test ports with its own data folder
const env = { ...process.env, WA_READONLY_DATA_DIR: join(dir, "data"), WA_READONLY_TEST_PORT_BASE: String(BASE) };
const leader = spawn(process.execPath, [join(ROOT, "plugins/aiforbusiness-chat-assistant/server/server.js")], { env, stdio: ["pipe", "pipe", "ignore"] });
procs.push(leader);
let buf = "", n = 1; const w = new Map();
leader.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); w.get(m.id)?.(m.result); } });
const rpc = (method, params) => new Promise((r) => { const id = n++; w.set(id, r); leader.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
const call = async (name, args = {}) => JSON.parse((await rpc("tools/call", { name, arguments: args })).content[0].text);
await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "claude-ai" } });
await sleep(2500);
const st = await call("get_status");
await fetch(http + `/json/new?chrome-extension://${ID}/popup.html`, { method: "PUT" });
const pop = await session(`chrome-extension://${ID}/popup.html`);
let pr; for (let i = 0; i < 20 && !pr?.ok; i++) {
  await sleep(500);
  pr = await pop.eval(`Promise.race([chrome.runtime.sendMessage({type:"state",force:true}).then(()=>chrome.runtime.sendMessage(${JSON.stringify({ type: "pair", code: st.pairing_code })})), new Promise((r) => setTimeout(() => r(null), 4000))])`);
}
if (!pr?.ok) throw new Error("pairing failed");
for (let i = 0; i < 40; i++) { const s = await call("get_status"); if (s.paired && s.whatsapp?.open) break; await sleep(500); }

// What an AI would do: read, then save drafts (nothing is sent)
await call("list_awaiting_reply");
await call("get_messages", { chat: "Parents 4B" });
await call("search_messages", { query: "invoice" });
await call("get_messages", { chat: "Aisha Rahman" });
await call("save_draft", { chat: "Aisha Rahman", text: "Hi Aisha, got your RM500 deposit, thank you! Your seat for the December AI class is confirmed. See you there 😊" });
await call("get_messages", { chat: "Jason Lim" });
await call("save_draft", { chat: "Jason Lim", text: "Hi Jason, yes sure. Tomorrow 10am to 12pm works, see you then." });
await call("get_messages", { chat: "Kak Ros" });
await call("save_draft", { chat: "Kak Ros", text: "Hai Kak Ros, barang dah pos semalam. Patut sampai dalam 2 hari ya." });
await sleep(1500);

// Extension pages as full tabs
for (const [view, file] of [["overview", "1-overview.png"], ["activity", "2-ai-activity.png"], ["data", "4-my-data.png"]]) {
  await fetch(http + `/json/new?chrome-extension://${ID}/dashboard.html%23${view}`, { method: "PUT" });
  const s = await session(`chrome-extension://${ID}/dashboard.html#${view}`);
  await sleep(2000);
  await s.shot(file); s.close();
}
await pop.eval(`chrome.runtime.sendMessage({type:"state",force:true})`); await sleep(1500);
await pop.shot("popup-raw.png", 380, 600);
pop.close();

// Composed images: popup and how it works on a branded background, and the small promo tile
const b64 = (f) => "data:image/png;base64," + readFileSync(f).toString("base64");
const LOGO = b64(join(ROOT, "docs/images/logo.png"));
const FONT = "-apple-system,Segoe UI,Helvetica,Arial,sans-serif";
async function compose(file, w, h, html) {
  await fetch(http + "/json/new?about:blank", { method: "PUT" });
  const s = await session("about:blank");
  await s.eval(`document.documentElement.innerHTML = ${JSON.stringify(`<body style="margin:0;width:${w}px;height:${h}px;overflow:hidden;font-family:${FONT}">${html}</body>`)}; new Promise((r) => setTimeout(r, 500))`);
  await s.shot(file, w, h); s.close();
}
const side = (title, lines) => `<div style="flex:1;padding:0 56px 0 72px;color:#111b21"><img src="${LOGO}" style="width:64px;height:64px;border-radius:14px"><h1 style="font-size:44px;line-height:1.15;margin:28px 0 20px">${title}</h1>` +
  lines.map((l) => `<p style="font-size:21px;line-height:1.45;margin:0 0 12px;color:#3b4a54">${l}</p>`).join("") + `</div>`;
await compose("3-popup.png", 1280, 800, `<div style="display:flex;align-items:center;height:100%;background:#fff8e1">${side("Who is waiting for your reply?",
  ["Ask Claude or ChatGPT. It reads your open WhatsApp Web and lists the chats that need you.", "Replies are saved as drafts. You check each one and press send yourself."])}
  <div style="width:460px;display:flex;justify-content:center"><img src="${b64(join(OUT, "popup-raw.png"))}" style="width:380px;border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.18)"></div></div>`);
await compose("5-how-it-works.png", 1280, 800, `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;background:#fff8e1;color:#111b21;text-align:center">
  <h1 style="font-size:40px;margin:0 0 10px">Your AI and WhatsApp Web, directly on your computer</h1>
  <p style="font-size:20px;color:#3b4a54;margin:0 0 28px">No server in between. Local 127.0.0.1 only. Never sends a message by itself.</p>
  <img src="${b64(join(ROOT, "docs/images/architecture.png"))}" style="max-width:1120px;max-height:560px;border-radius:14px;box-shadow:0 12px 36px rgba(0,0,0,.12)"></div>`);
await compose("promo-440x280.png", 440, 280, `<div style="display:flex;flex-direction:column;justify-content:center;height:100%;padding:0 34px;box-sizing:border-box;background:#f5c83b;color:#111b21">
  <div style="display:flex;align-items:center;gap:14px"><img src="${LOGO}" style="width:56px;height:56px;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.15)"><div style="font-size:15px;font-weight:700;letter-spacing:.06em">AI FOR BUSINESS</div></div>
  <div style="font-size:31px;font-weight:800;line-height:1.1;margin:18px 0 10px">Chat Assistant</div>
  <div style="font-size:16px;line-height:1.35">Claude or ChatGPT reads your WhatsApp Web and drafts replies. Never sends.</div></div>`);
process.exit(0);
