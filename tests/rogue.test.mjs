// The extension must never trust a local program that has not proved it holds the pairing secret.
// Runs the real extension/background.js (copied, with its ports moved to test ports) against:
//   - a rogue listener that speaks the protocol but knows no secret
//   - a relay that forwards to the real server from another port
//   - the real local server (in-process Bridge), to show the honest path still works
// Never touches ports 47821-47830 or ~/.whatsapp-readonly-mcp. Dummy data only.
// Run: node --test tests/rogue.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = 44000 + (process.pid % 200) * 10;
const dir = mkdtempSync(join(tmpdir(), "wa-rogue-"));
process.env.WA_READONLY_DATA_DIR = join(dir, "data");
process.env.WA_READONLY_TEST_PORT_BASE = String(BASE);
cpSync(join(ROOT, "extension"), join(dir, "ext"), { recursive: true });
const bgPath = join(dir, "ext", "background.js");
const src = readFileSync(bgPath, "utf8");
assert.ok(src.includes("47821 + i"));
writeFileSync(bgPath, src.replaceAll("47821", String(BASE)));

const DUMMY_DRAFT = { id: "x1", chat_id: "dummy@c.us", chat_name: "Dummy Contact", is_group: false, text: "DUMMY PRIVATE DRAFT TEXT", created_at: new Date().toISOString(), source: "ai", note: null, status: "pending" };
const local = { drafts: [DUMMY_DRAFT] };
const area = (store) => ({
  async get(k) { if (k == null) return { ...store }; const r = {}; for (const x of [].concat(k)) if (x in store) r[x] = store[x]; return r; },
  async set(o) { Object.assign(store, o); },
  async remove(k) { for (const x of [].concat(k)) delete store[x]; },
  async getBytesInUse() { return 0; },
  setAccessLevel() {}
});
let onMessage = null;
const ev = () => ({ addListener() {} });
globalThis.chrome = {
  runtime: { id: "hmajmekaiaiilhneebgbnchonfkblndb", getManifest: () => ({ version: "test" }), getURL: (p) => "chrome-extension://hmajmekaiaiilhneebgbnchonfkblndb/" + p,
    onMessage: { addListener(fn) { onMessage = fn; } }, onStartup: ev(), onInstalled: ev(), sendMessage: async () => ({}) },
  storage: { local: area(local), session: area({}) },
  alarms: { create() {}, onAlarm: ev() },
  tabs: { query: async () => [], sendMessage: async () => ({}) },
  scripting: { executeScript: async () => [] },
  i18n: { getUILanguage: () => "en" }
};

// In-memory WebSocket for the extension. A port is either a scripted rogue, or a pipe to a real local test port.
const NativeWS = globalThis.WebSocket;
const fakes = [];
const routes = new Map(); // dialed port -> real port to pipe to
globalThis.WebSocket = class FakeWS {
  constructor(url) {
    this.port = Number(new URL(url).port); this.sent = []; fakes.push(this);
    const real = routes.get(this.port);
    if (real) {
      this.real = new NativeWS(`ws://127.0.0.1:${real}`, { headers: { Origin: "chrome-extension://hmajmekaiaiilhneebgbnchonfkblndb" } });
      this.real.onopen = () => this.onopen?.();
      this.real.onmessage = (e) => this.onmessage?.({ data: e.data });
      this.real.onclose = () => this.onclose?.();
      this.real.onerror = () => {};
    }
  }
  send(s) { this.sent.push(JSON.parse(s)); if (this.real?.readyState === 1) this.real.send(s); }
  close() { this.closed = true; this.real?.close(); }
  say(obj) { return this.onmessage({ data: JSON.stringify(obj) }); }
};

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error("timeout"); await tick(50); } };
const POPUP = { id: "hmajmekaiaiilhneebgbnchonfkblndb", url: "chrome-extension://hmajmekaiaiilhneebgbnchonfkblndb/popup.html" };
const WA = { id: "hmajmekaiaiilhneebgbnchonfkblndb", tab: { id: 1, incognito: false }, url: "https://web.whatsapp.com/" };
const ask = (msg, sender = POPUP) => new Promise((r) => onMessage(msg, sender, r));

const { Bridge } = await import(pathToFileURL(join(ROOT, "plugins/chat-assistant/server/lib/bridge.js")).href);
routes.set(BASE, BASE); // the real server sits on the first test port
const bridge = new Bridge();
await bridge.start();
await until(() => bridge.role === "leader");
await import(pathToFileURL(bgPath).href);

test.after(() => { process.exitCode = process.exitCode || 0; rmSync(dir, { recursive: true, force: true }); setTimeout(() => process.exit(), 50); });

test("honest path: pairing with the 6-digit code, then reconnect by proof; the secret never crosses the wire", async () => {
  onMessage({ type: "wa_opened" }, WA, () => {});
  await until(() => [...bridge.conns].some((c) => c.state === "need_pair"));
  const code = (await bridge.localInfo(0)).code; // the AI is shown the code: pairing is armed now
  assert.match(code, /^\d{6}$/);
  const r = await ask({ type: "pair", code: code.match(/.{1,3}/g).join(" ") });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(local.secret, /^[0-9a-f]{64}$/);
  const all = JSON.stringify(fakes.flatMap((f) => f.sent));
  assert.ok(!all.includes(local.secret), "secret sent in clear");
  assert.ok(!all.includes(code), "pairing code sent");
  // AI request reaches the extension
  const got = await bridge.request("list_drafts", { include_actual: false }, { waitMs: 3000 });
  assert.equal(got.ok, true); assert.equal(got.drafts[0].text, DUMMY_DRAFT.text);
  // a new connection (e.g. after a restart) gets in by proof only
  const real = fakes.find((f) => f.port === BASE);
  real.close(); await tick(300);
  onMessage({ type: "wa_opened" }, WA, () => {});
  await until(() => [...bridge.conns].some((c) => c.state === "ready"));
  const again = JSON.stringify(fakes.filter((f) => f.port === BASE).flatMap((f) => f.sent));
  assert.ok(!again.includes(local.secret));
});

test("a rogue listener learns nothing and can do nothing", async () => {
  const secretBefore = local.secret;
  const rogue = fakes.find((f) => f.port === BASE + 9);
  rogue.onopen(); await tick();
  const hello = rogue.sent.find((m) => m.type === "hello");
  assert.ok(hello && hello.v === 3 && !("secret" in hello));
  assert.ok(!JSON.stringify(rogue.sent).includes(secretBefore));
  // claims to be paired without proof
  await rogue.say({ type: "hello_ok", server: "rogue" });
  await rogue.say({ type: "hello_auth", v: 3, ns: Buffer.alloc(32, 7).toString("base64"), proof: Buffer.alloc(32, 1).toString("base64") });
  await tick(200);
  assert.ok(rogue.sent.some((m) => m.type === "want_pair"));
  assert.ok(!rogue.sent.some((m) => m.type === "auth"));
  await rogue.say({ type: "request", id: 7, op: "list_drafts", params: { include_actual: false } });
  await tick(200);
  const resp = rogue.sent.find((m) => m.type === "response" && m.id === 7);
  assert.ok(!resp || resp.result.ok === false);
  assert.ok(!JSON.stringify(rogue.sent).includes(DUMMY_DRAFT.text));
  // pretends to deliver a secret
  await rogue.say({ type: "paired", v: 3, iv: "AAAAAAAAAAAAAAAA", ct: "AAAA", secret: "a".repeat(64) });
  await tick(100);
  assert.equal(local.secret, secretBefore);
});

test("a rogue asking for pairing never gets the code, and cannot pass the code check", async () => {
  const rogue = fakes.find((f) => f.port === BASE + 8);
  rogue.onopen(); await tick();
  await rogue.say({ type: "need_pair", v: 3, server: "rogue2" });
  const done = ask({ type: "pair", code: "123456" });
  await until(() => rogue.sent.some((m) => m.type === "pair_start"));
  const start = rogue.sent.find((m) => m.type === "pair_start");
  assert.ok(!JSON.stringify(start).includes("123456"));
  await rogue.say({ type: "pair_srv", v: 3, ns: Buffer.alloc(32, 3).toString("base64"), pb: start.pa, mac: Buffer.alloc(32, 9).toString("base64") });
  const r = await done;
  assert.equal(r.ok, false);
  assert.ok(rogue.sent.some((m) => m.type === "pair_abort"));
  assert.ok(!rogue.sent.some((m) => m.type === "pair_ext"));
  assert.ok(!JSON.stringify(rogue.sent).includes("123456"));
});

test("a relay on another port cannot reuse the real server's proof", async () => {
  for (const f of fakes.filter((x) => x.port === BASE + 5)) f.onclose?.(); // forget the idle fake on that port
  routes.set(BASE + 5, BASE); // the extension dials BASE+5; the "relay" pipes it to the real server on BASE
  onMessage({ type: "state", force: true }, POPUP, () => {});
  await tick(1500);
  const relayed = fakes.filter((f) => f.port === BASE + 5);
  assert.ok(relayed.length);
  const sent = relayed.flatMap((f) => f.sent);
  assert.ok(sent.some((m) => m.type === "want_pair"), "proof bound to the real port must fail on another port");
  assert.ok(!sent.some((m) => m.type === "auth"));
});

test("the server: no pre-auth info, small pre-auth messages only, response only from the asked connection", async () => {
  const ws = new NativeWS(`ws://127.0.0.1:${BASE}`, { headers: { Origin: "chrome-extension://hmajmekaiaiilhneebgbnchonfkblndb" } });
  const msgs = []; ws.onmessage = (e) => msgs.push(JSON.parse(e.data));
  await new Promise((r) => (ws.onopen = r));
  ws.send(JSON.stringify({ type: "ping" }));
  await tick(200);
  assert.deepEqual(msgs.find((m) => m.type === "pong"), { type: "pong" });
  // old protocol: refused
  ws.send(JSON.stringify({ type: "hello", secret: "x" }));
  await tick(200);
  assert.ok(msgs.some((m) => m.type === "update_needed"));
  // too big before authentication: closed
  const ws2 = new NativeWS(`ws://127.0.0.1:${BASE}`, { headers: { Origin: "chrome-extension://hmajmekaiaiilhneebgbnchonfkblndb" } });
  let closed = false; ws2.onclose = () => { closed = true; };
  await new Promise((r) => (ws2.onopen = r));
  ws2.send("x".repeat(200 * 1024));
  await until(() => closed, 3000);
});

test("pairing is closed unless a code was just shown, and has a fixed budget per run", async () => {
  const { extConnect } = await import("./ext-client.mjs");
  bridge.armedUntil = 0;
  const x = extConnect(BASE);
  await until(() => x.state === "need_pair", 5000);
  const r = await x.pair("000000");
  assert.equal(r.ok, false); assert.equal(r.msg?.code, "NOT_ARMED"); // no sample to guess offline
  // armed, but every start counts: after the budget is used up, pairing stops for good (until restart)
  bridge.armPairing();
  let locked = false;
  for (let i = 0; i < 20 && !locked; i++) {
    const y = extConnect(BASE); await until(() => y.state === "need_pair", 5000);
    const t = await y.pair("000000");
    if (t.msg?.code === "LOCKED") locked = true;
    if (t.msg?.code === "CODE_CHANGED" || t.wrong || t.msg?.code === "LOCKED") { /* counted */ }
    y.close(); await tick(350);
  }
  assert.ok(locked, "budget must lock pairing");
  x.close();
});
