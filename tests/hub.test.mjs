// Shared-connection tests. Uses its own data folder and its own ports: never touches the real pairing or running sessions.
// Run: node --test tests/hub.test.mjs
import test from "node:test";
import * as P from "../extension/pairing.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer, connect } from "node:net";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "../plugins/aiforbusiness-chat-assistant/server/server.js");
const ORIGIN = "chrome-extension://hmajmekaiaiilhneebgbnchonfkblndb";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 12000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error("timeout: " + fn); await sleep(50); } };
// Test ports: each file has its own band below 32768, outside the ranges Linux (32768+) and macOS (49152+)
// use for outgoing connections. hub 20000-25999, rogue 26000-27999, media 28000-29999, e2e 30000-31999.
let base = 20000 + (process.pid % 24) * 240;

function env() {
  const dir = mkdtempSync(join(tmpdir(), "wa-hub-"));
  const b = (base += 20);
  const all = [];
  const start = (name) => {
    const p = spawn(process.execPath, [SERVER], { env: { ...process.env, WA_READONLY_DATA_DIR: dir, WA_READONLY_TEST_PORT_BASE: String(b) }, stdio: ["pipe", "pipe", "pipe"] });
    const s = { p, err: "", n: 1, wait: new Map() };
    all.push(s);
    p.stderr.on("data", (d) => { s.err += d; });
    let buf = "";
    p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); s.wait.get(m.id)?.(m); } });
    s.rpc = (method, params) => new Promise((res) => { const id = s.n++; s.wait.set(id, res); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
    s.call = async (tool, args = {}) => (await s.rpc("tools/call", { name: tool, arguments: args })).result.structuredContent;
    s.ready = s.rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name } });
    s.leader = () => /Local server started/.test(s.err);
    s.kill = () => new Promise((r) => { p.once("exit", r); p.kill("SIGKILL"); });
    return s;
  };
  return { dir, b, all, start, stop: () => { for (const s of all) s.p.kill("SIGKILL"); rmSync(dir, { recursive: true, force: true }); } };
}

// fake extension: reconnects like the real one, speaks protocol v2 (extension/pairing.js)
function ext(port, secret, { delay = 0, silent = false } = {}) {
  const x = { seen: [], secret, stop: false, clients: [], msgs: [], silent };
  const go = () => {
    if (x.stop) return;
    const ws = (x.ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { Origin: ORIGIN } }));
    let ne, verified = false;
    ws.onopen = () => { ne = P.b64(P.rand()); ws.send(JSON.stringify({ type: "hello", v: P.PROTOCOL, ne, paired: !!x.secret })); };
    ws.onclose = () => { x.ready = false; setTimeout(go, 300); };
    ws.onerror = () => {};
    ws.onmessage = async (e) => {
      const m = JSON.parse(e.data); x.msgs.push(m);
      if (x.expect && x.expect.types.includes(m.type)) { const f = x.expect.f; x.expect = null; return f(m); }
      if (m.clients && (m.type === "hello_ok" || m.type === "paired" || m.type === "clients" || m.type === "pong")) x.clients = m.clients;
      if (m.type === "hello_auth") {
        if (!x.secret || !P.sameB64(m.proof, await P.helloProof(x.secret, "srv", port, ne, m.ns))) return ws.send(JSON.stringify({ type: "want_pair" }));
        verified = true;
        ws.send(JSON.stringify({ type: "auth", proof: await P.helloProof(x.secret, "ext", port, ne, m.ns) }));
      }
      if (m.type === "hello_ok" && verified) x.ready = true;
      if (m.type === "request") {
        if (!x.ready) return;
        x.seen.push({ op: m.op, client: m.client });
        if (x.silent) return;
        await sleep(delay);
        ws.send(JSON.stringify({ type: "response", id: m.id, result: { ok: true, op: m.op, asked_by: m.client, chats: [], messages: [], drafts: [], total_chats: 0 } }));
      }
    };
  };
  go();
  x.pairWith = async (code) => {
    const ws = x.ws;
    const exp = (types, fn) => new Promise((res) => { const t = setTimeout(() => res(null), 15000); x.expect = { types, f: (m) => { clearTimeout(t); res(m); } }; fn(); });
    const st = await P.extStart(port, code);
    const srv = await exp(["pair_srv", "pair_failed"], () => ws.send(JSON.stringify({ type: "pair_start", v: P.PROTOCOL, ne: st.ne, pa: st.pa })));
    if (srv?.type !== "pair_srv") return false;
    const f = await P.extFinish(st, srv.ns, srv.pb, srv.mac);
    if (!f.ok) return false;
    const fin = await exp(["paired", "pair_failed"], () => ws.send(JSON.stringify({ type: "pair_ext", mac: f.mac })));
    if (fin?.type !== "paired") return false;
    x.secret = await P.unwrapSecret(f.h, st.ne, srv.ns, fin.iv, fin.ct);
    if (fin.clients) x.clients = fin.clients;
    x.ready = true;
    return true;
  };
  x.close = () => { x.stop = true; x.ws.close(); };
  return x;
}
async function paired(e, ws) {
  const code = (await until(async () => { const r = await e.call("get_status"); return JSON.stringify(r).match(/"pairing_code":"(\d{3} \d{3})"/); }))[1];
  await until(async () => ws.msgs.some((m) => m.type === "need_pair"));
  assert.ok(await ws.pairWith(code));
  await until(() => ws.ready);
}
const raw = (port, headers) => new Promise((res) => {
  const r = request({ host: "127.0.0.1", port, path: "/hub", agent: false, headers });
  r.on("response", (x) => { x.resume(); res({ status: x.statusCode }); });
  r.on("upgrade", (x, socket) => res({ status: 101, headers: x.headers, socket }));
  r.on("error", () => res({ status: 0 }));
  r.end();
});
const HUB = (port, extra = {}) => ({ Connection: "Upgrade", Upgrade: "wa-hub/1", Host: `127.0.0.1:${port}`, "X-Hub-Nonce": "a".repeat(64), ...extra });

test("25 servers share one port; every one answers; names listed; pairing code from a follower works", async () => {
  const e = env(); let x;
  try {
    const list = Array.from({ length: 25 }, (_, i) => e.start(i % 2 ? "Claude" : "ChatGPT"));
    await Promise.all(list.map((s) => s.ready));
    await until(() => list.every((s) => /Joined|Local server started/.test(s.err)));
    assert.equal(list.filter((s) => s.leader()).length, 1);
    x = ext(e.b, null);
    await until(() => x.msgs.some((m) => m.type === "need_pair"));
    await paired(list.find((s) => !s.leader()), x);
    const rs = await Promise.all(list.map((s) => s.call("list_chats")));
    assert.ok(rs.every((r) => r.ok), JSON.stringify(rs.find((r) => !r.ok)));
    await until(() => x.clients.length === 2);
    assert.deepEqual([...x.clients].sort(), ["ChatGPT", "Claude"]);
    assert.equal(x.seen.length, 25);
    assert.ok(x.seen.some((s) => s.client === "Claude") && x.seen.some((s) => s.client === "ChatGPT"));
    if (process.platform !== "win32") assert.equal(statSync(join(e.dir, "hub-token")).mode & 0o777, 0o600);
  } finally { x?.close(); e.stop(); }
});

test("leader killed again and again: a follower takes over the same port, requests keep working", async () => {
  const e = env(); let x;
  try {
    const list = Array.from({ length: 8 }, (_, i) => e.start("AI" + i));
    await Promise.all(list.map((s) => s.ready));
    await until(() => list.every((s) => /Joined|Local server started/.test(s.err)));
    x = ext(e.b, null);
    await until(() => x.msgs.some((m) => m.type === "need_pair"));
    await paired(list[0], x);
    let alive = list;
    for (let k = 0; k < 5; k++) {
      const lead = alive.find((s) => s.leader());
      alive = alive.filter((s) => s !== lead);
      await lead.kill();
      const rs = await Promise.all(alive.map((s) => s.call("list_chats")));
      assert.ok(rs.every((r) => r.ok), JSON.stringify(rs.find((r) => !r.ok)));
      assert.equal(alive.filter((s) => s.leader()).length, 1);
    }
  } finally { x?.close(); e.stop(); }
});

test("leader dies mid-request: reads retry, save_draft is never repeated", async () => {
  const e = env(); let x;
  try {
    const list = [e.start("A"), e.start("B"), e.start("C")];
    await Promise.all(list.map((s) => s.ready));
    await until(() => list.every((s) => /Joined|Local server started/.test(s.err)));
    x = ext(e.b, null);
    await until(() => x.msgs.some((m) => m.type === "need_pair"));
    await paired(list[0], x);
    const lead = list.find((s) => s.leader());
    const [f1, f2] = list.filter((s) => s !== lead);
    x.silent = true;
    const read = f1.call("list_chats"), save = f2.call("save_draft", { chat: "x", text: "y" });
    await until(() => x.seen.length === 2);
    x.silent = false;
    await lead.kill();
    assert.equal((await read).ok, true);
    const r = await save;
    assert.equal(r.code, "HUB_CHANGED");
    await sleep(500);
    assert.equal(x.seen.filter((s) => s.op === "save_draft").length, 1);
  } finally { x?.close(); e.stop(); }
});

test("hub refuses: wrong token, any Origin, wrong Host, bad nonce, extra ops; websocket refuses web origins", async () => {
  const e = env();
  try {
    const s = e.start("A"); await s.ready; await until(() => s.leader());
    assert.equal((await raw(e.b, HUB(e.b, { Origin: "https://evil.test" }))).status, 403);
    assert.equal((await raw(e.b, HUB(e.b, { Origin: ORIGIN }))).status, 403);
    assert.equal((await raw(e.b, HUB(e.b, { Host: `evil.test:${e.b}` }))).status, 403);
    assert.equal((await raw(e.b, HUB(e.b, { "X-Hub-Nonce": "zz" }))).status, 403);
    for (const Origin of ["https://web.whatsapp.com", "null", "chrome-extension://" + "a".repeat(32)]) {
      const ws = new WebSocket(`ws://127.0.0.1:${e.b}`, { headers: { Origin } });
      assert.equal(await new Promise((r) => { ws.onopen = () => r("open"); ws.onerror = () => r("refused"); }), "refused");
    }
    // the Chrome Web Store build of the extension is accepted as well
    const store = new WebSocket(`ws://127.0.0.1:${e.b}`, { headers: { Origin: "chrome-extension://cmpndcpodgfcdlabhcopofojdneafpgg" } });
    assert.equal(await new Promise((r) => { store.onopen = () => r("open"); store.onerror = () => r("refused"); }), "open");
    store.close();
    // reflected / wrong proof: closed without an answer
    for (const proof of ["0".repeat(64), "x", null]) {
      const u = await raw(e.b, HUB(e.b)); assert.equal(u.status, 101);
      u.socket.on("error", () => {}); // the server may drop the line while we still write: that is the point
      let got = ""; u.socket.on("data", (d) => { got += d; });
      u.socket.write(JSON.stringify({ type: "auth", proof: proof ?? u.headers["x-hub-proof"] }) + "\n");
      u.socket.write(JSON.stringify({ type: "call", id: 1, what: "info" }) + "\n");
      await new Promise((r) => u.socket.on("close", r));
      assert.equal(got, "");
    }
    // a command before signing in is refused too
    const u0 = await raw(e.b, HUB(e.b)); u0.socket.on("error", () => {}); u0.socket.write(JSON.stringify({ type: "call", id: 1, what: "info" }) + "\n");
    await new Promise((r) => { u0.socket.on("close", r); u0.socket.resume(); });
    // right token, forbidden op
    const { connectHub, loadToken } = await import("../plugins/aiforbusiness-chat-assistant/server/lib/hub.js");
    assert.equal(await connectHub({ port: e.b, token: "f".repeat(64) }), null);
    const line = await connectHub({ port: e.b, token: loadToken(e.dir) });
    for (const op of ["send_message", "mark_read", "open_chat", "constructor"]) {
      const r = await new Promise((res) => { line.onmessage = (m) => res(m.result); line.send({ type: "call", id: 9, what: "request", op, params: {} }); });
      assert.equal(r.code, "OP_NOT_ALLOWED");
    }
    line.close();
    // token never crosses the wire; a fake hub on the port gets nothing usable
    assert.ok(!s.err.includes(readFileSync(join(e.dir, "hub-token"), "utf8").trim()));
  } finally { e.stop(); }
});

test("a fake program on the first port is ignored; all 10 ports busy keeps retrying and recovers", async () => {
  const e = env();
  const blocks = await Promise.all(Array.from({ length: 10 }, (_, i) => new Promise((r) => { const s = createServer((c) => { c.on("error", () => {}); c.end("HTTP/1.1 101 x\r\nUpgrade: wa-hub/1\r\nConnection: Upgrade\r\nX-Hub-Nonce: " + "b".repeat(64) + "\r\nX-Hub-Proof: " + "c".repeat(64) + "\r\n\r\n"); }); s.listen(e.b + i, "127.0.0.1", () => r(s)); })));
  try {
    const s = e.start("A"); await s.ready;
    const r = await s.call("list_chats");
    assert.equal(r.code, "SERVER_NOT_STARTED");
    blocks[4].close();
    await until(() => s.leader());
    const t = e.start("B"); await t.ready;
    await until(() => /Joined the running local server on port/.test(t.err));
    assert.notEqual((await t.call("get_status")).code, "SERVER_NOT_STARTED");
  } finally { blocks.forEach((b) => b.close()); e.stop(); }
});

test("chats that close are released by the shared helper (no leftover sockets or names)", async () => {
  const e = env(); let x;
  try {
    const lead = e.start("Lead"); await lead.ready; await until(() => lead.leader());
    x = ext(e.b, null);
    await until(() => x.msgs.some((m) => m.type === "need_pair"));
    await paired(lead, x);
    const fs = Array.from({ length: 6 }, () => e.start("Gone"));
    await until(() => x.clients.includes("Gone"));
    await until(() => fs.every((f) => /Joined/.test(f.err)));
    for (const f of fs.slice(0, 3)) f.p.stdin.end();
    for (const f of fs.slice(3)) f.p.kill("SIGKILL");
    await until(() => !x.clients.includes("Gone"), 5000);
    x.ws.close();
    await until(async () => (await lead.call("get_status")).local_program.shared_with.length === 1);
  } finally { x?.close(); e.stop(); }
});

test("only listens on 127.0.0.1", async () => {
  const e = env();
  try {
    const s = e.start("A"); await s.ready; await until(() => s.leader());
    const { networkInterfaces } = await import("node:os");
    for (const a of Object.values(networkInterfaces()).flat().filter((i) => i.family === "IPv4" && !i.internal)) {
      const ok = await new Promise((r) => { const c = connect({ host: a.address, port: e.b, timeout: 1500 }, () => { c.destroy(); r(true); }); c.on("error", () => r(false)); c.on("timeout", () => { c.destroy(); r(false); }); });
      assert.equal(ok, false);
    }
  } finally { e.stop(); }
});

// ---- only one leader, ever ----
const leadersNow = async (e) => {
  const { connectHub, loadToken } = await import("../plugins/aiforbusiness-chat-assistant/server/lib/hub.js");
  const token = loadToken(e.dir);
  const ls = await Promise.all(Array.from({ length: 10 }, (_, i) => connectHub({ port: e.b + i, token })));
  const ports = ls.map((l, i) => (l ? e.b + i : 0)).filter(Boolean);
  ls.forEach((l) => l?.close());
  return ports;
};

test("singleton: a leader that is too slow to answer never gets a second leader next to it", { skip: process.platform === "win32" }, async () => {
  const e = env();
  try {
    const a = e.start("A"); await a.ready; await until(() => a.leader());
    a.p.kill("SIGSTOP");
    const b = e.start("B"), c = e.start("C");
    await sleep(7000);
    assert.ok(!b.leader() && !c.leader(), "a second leader started");
    a.p.kill("SIGCONT");
    await until(() => /Joined/.test(b.err) && /Joined/.test(c.err));
    assert.deepEqual(await leadersNow(e), [e.b]);
  } finally { for (const s of e.all) s.p.kill("SIGCONT"); e.stop(); }
});

test("singleton: a crashed leader's leftover note never blocks a new start", async () => {
  const e = env();
  try {
    const a = e.start("A"); await a.ready; await until(() => a.leader());
    await a.kill();
    const b = e.start("B"); await b.ready;
    await until(() => b.leader(), 4000);
    assert.deepEqual(await leadersNow(e), [e.b]);
  } finally { e.stop(); }
});

test("singleton: two leaders on different ports merge into one, requests keep working", { skip: process.platform === "win32" }, async () => {
  const e = env(); let x, y;
  const block = createServer((c) => c.destroy());
  await new Promise((r) => block.listen(e.b, "127.0.0.1", r));
  try {
    // B can only take the second port, with a follower
    const b = e.start("B"); await b.ready; await until(() => b.leader());
    const f = e.start("F"); await f.ready; await until(() => /Joined/.test(f.err));
    assert.deepEqual(await leadersNow(e), [e.b + 1]);
    // first port frees up and a copy that cannot see B (it is paused and its note is gone) takes it
    b.p.kill("SIGSTOP");
    rmSync(join(e.dir, "ports"), { recursive: true, force: true });
    await new Promise((r) => block.close(r));
    const a = e.start("A"); await a.ready; await until(() => a.leader());
    b.p.kill("SIGCONT");
    await until(async () => (await leadersNow(e)).length === 1, 25000);
    assert.deepEqual(await leadersNow(e), [e.b]);
    x = ext(e.b, null);
    await until(() => x.msgs.some((m) => m.type === "need_pair"));
    await paired(f, x);
    const rs = await Promise.all([a, b, f].map((s) => s.call("list_chats")));
    assert.ok(rs.every((r) => r.ok), JSON.stringify(rs));
    // and the merged copies can still take over later
    await a.kill();
    const r2 = await Promise.all([b, f].map((s) => s.call("list_chats")));
    assert.ok(r2.every((r) => r.ok), JSON.stringify(r2));
    assert.deepEqual(await leadersNow(e), [e.b]);
  } finally { x?.close(); block.close(); for (const s of e.all) s.p.kill("SIGCONT"); e.stop(); }
});

test("singleton: 20 rounds of kills with new starts at the same moment always end with one leader on one port", async () => {
  const e = env();
  try {
    let alive = Array.from({ length: 4 }, (_, i) => e.start("S" + i));
    await until(async () => (await leadersNow(e)).length === 1);
    for (let k = 0; k < 20; k++) {
      const port = (await leadersNow(e))[0];
      const lead = alive.find((s) => s.leader() && s.p.exitCode === null);
      alive = alive.filter((s) => s !== lead);
      const gone = lead.kill();
      alive.push(e.start("N" + k));
      await gone;
      await until(async () => (await leadersNow(e)).length >= 1);
      await sleep(400);
      const now = await leadersNow(e);
      assert.equal(now.length, 1, `round ${k}: leaders on ${now} (was ${port})`);
    }
  } finally { e.stop(); }
});
