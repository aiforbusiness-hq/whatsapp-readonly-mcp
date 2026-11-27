// Bridge: opens a local WebSocket, waits for the extension, pairs, and forwards read-only requests.
// Every AI session starts its own copy of this program. One copy (the leader) holds the port and the
// extension connection; the others (followers) pass their requests through it. See hub.js.
// Only one leader (singleton): a copy never starts a second one next to a slow leader, and if two ever exist
// (lost race), the one on the higher port steps down and joins the other.
//
// Security:
// - binds to 127.0.0.1 only
// - accepts only Origin = chrome-extension://<our fixed extension ID>; Host must be 127.0.0.1:<port> (blocks DNS rebinding)
// - first use needs a 6-digit pairing code; the code is never sent over the connection, and each try can test only one
//   guess (SPAKE2, see auth.js). Pairing is only accepted for 3 minutes after the code was shown to the AI, a code
//   allows MAX_WRONG tries, pairing is switched off again after one success, and at most PAIR_BUDGET tries per run
// - after pairing, a 32-byte random secret is kept in ~/.whatsapp-readonly-mcp/secret (owner-readable only); the
//   secret is never sent in clear: both sides prove they hold it (auth.js), so a program squatting on a port learns nothing
// - before authentication a connection may send only small messages, and only a few may wait at once
// - no outbound network requests; message content is never logged
import { randomBytes, randomInt } from "node:crypto";
import { CODE_DIGITS, PROTOCOL, nonce, isB64Of, sameB64, helloProof, serverPair, wrapSecret, validSecret } from "./auth.js";
import { mkdirSync, readFileSync, writeFileSync, chmodSync, readdirSync, unlinkSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { listenOn } from "./ws.js";
import { loadToken, acceptHub, connectHub } from "./hub.js";

// Developer-mode build (fixed by the manifest "key") and the Chrome Web Store build (ID given by the store).
export const EXTENSION_ID = "hmajmekaiaiilhneebgbnchonfkblndb";
export const STORE_EXTENSION_ID = "cmpndcpodgfcdlabhcopofojdneafpgg";
export const ALLOWED_ORIGINS = [EXTENSION_ID, STORE_EXTENSION_ID].map((id) => `chrome-extension://${id}`);
export const ALLOWED_ORIGIN = ALLOWED_ORIGINS[0];
// The base port can be changed for tests only; the extension always looks at 47821-47830.
const BASE = /^\d{4,5}$/.test(process.env.WA_READONLY_TEST_PORT_BASE || "") ? Number(process.env.WA_READONLY_TEST_PORT_BASE) : 47821;
export const PORTS = Array.from({ length: 10 }, (_, i) => BASE + i);
const HOST = "127.0.0.1";
const CODE_TTL_MS = 3 * 60 * 1000;   // a code works for 3 minutes after the AI shows it
const MAX_WRONG = 5;            // tries on one code before it changes
const PAIR_BUDGET = 12;         // tries for the whole life of this program (codes that expire or change included)
const NEED_PAIR_IDLE_MS = 2 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20000;
// downloads answer within ~40 s (finished, or "still downloading"); everything else within 20 s
const timeoutFor = (op) => (op === "download_media" ? 50000 : REQUEST_TIMEOUT_MS);
const RETRY_MS = 3000;
const SINGLE_CHECK_MS = 5000;
const OPS = new Set(["status", "list_chats", "get_messages", "search_messages", "list_awaiting_reply", "get_media", "download_media", "save_draft", "list_drafts"]);
// writes / outside effects: never repeated automatically after the hub changed
const WRITE_OPS = new Set(["save_draft", "download_media"]);
const MAX_PREAUTH = 8;            // connections that have not proved themselves yet
const PREAUTH_MAX_MESSAGE = 64 * 1024;

const log = (...a) => process.stderr.write("[whatsapp-readonly] " + a.join(" ") + "\n");

export class Bridge {
  constructor({ dataDir } = {}) {
    this.dataDir = dataDir || process.env.WA_READONLY_DATA_DIR || join(homedir(), ".whatsapp-readonly-mcp");
    this.port = null;
    this.conns = new Set(); // { ws, state: "new" | "need_pair" | "ready" }
    this.pending = new Map();
    this.nextId = 1;
    this.newCode();
    this.waiters = [];
    this.role = "none";          // "leader" | "follower" | "none"
    this.link = null;            // follower: connection to the leader
    this.linkPending = new Map();
    this.followers = new Set();  // leader: { line, name }
    this.joinWaiters = [];
  }

  // Which AI app this copy belongs to (from MCP initialize)
  get clientName() { return this._clientName || null; }
  set clientName(v) {
    this._clientName = v;
    if (this.role === "follower") this.link?.send({ type: "client", name: v });
    else this.pushClients();
  }
  // Every AI app sharing this connection (leader only)
  clients() {
    return [...new Set([this.clientName, ...[...this.followers].map((f) => f.name)].filter(Boolean))].slice(0, 40);
  }
  pushClients() {
    for (const c of this.conns) if (c.state === "ready") c.ws.send({ type: "clients", clients: this.clients() });
  }

  // The code is only usable after it was shown to the AI (get_status or a NOT_PAIRED answer), for CODE_TTL_MS
  armPairing() { this.currentCode(); this.armedUntil = Date.now() + CODE_TTL_MS; this.codeExpires = Math.max(this.codeExpires || 0, this.armedUntil); }
  newCode() {
    this.code = String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, "0");
    this.codeExpires = Date.now() + CODE_TTL_MS;
    this.wrong = 0;
  }
  currentCode() {
    if (Date.now() > this.codeExpires) this.newCode();
    return this.code;
  }

  secretPath() { return join(this.dataDir, "secret"); }
  readSecret() {
    try { const s = readFileSync(this.secretPath(), "utf8").trim(); return validSecret(s) ? s : null; } catch (_) { return null; }
  }
  writeSecret(s) {
    mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    try { chmodSync(this.dataDir, 0o700); } catch (_) {}
    // new file (never follows an existing link), then rename into place
    const tmp = this.secretPath() + "." + randomBytes(6).toString("hex");
    writeFileSync(tmp, s, { mode: 0o600, flag: "wx" });
    renameSync(tmp, this.secretPath());
  }

  // Join an existing hub, or become it. Keeps retrying, so a busy moment at startup is never permanent.
  async start() {
    if (this.joining) return;
    this.joining = true;
    for (;;) {
      try {
        await this.join();
        this.startError = null;
        break;
      } catch (e) {
        if (this.startError !== e.message) log("Not connected yet:", e.message);
        this.startError = e.message;
        await new Promise((r) => setTimeout(r, RETRY_MS));
      }
    }
    this.joining = false;
    for (const fn of this.joinWaiters.splice(0)) fn();
  }

  // A port that accepts connections but stays silent, and that a running copy says it holds: a leader that is
  // only slow (busy computer, just woke up). Wait for it instead of starting a second one.
  checkBusy(port, report) {
    if (report.silent && this.noted().some((n) => n.port === port)) throw new Error("the running local server is busy");
  }

  async join() {
    this.token = loadToken(this.dataDir);
    // 1. somebody already runs a hub? (checked on all ports at once)
    const reports = PORTS.map(() => ({}));
    const links = await Promise.all(PORTS.map((port, i) => connectHub({ port, token: this.token, report: reports[i] })));
    const at = links.findIndex(Boolean);
    links.forEach((l, i) => { if (l && i !== at) l.close(); });
    if (at >= 0) return this.becomeFollower(links[at], PORTS[at]);
    PORTS.forEach((port, i) => this.checkBusy(port, reports[i]));
    // 2. no hub: take the first free port. Every copy tries the same order, so they all compete for the same port.
    for (const port of PORTS) {
      try {
        await this.becomeLeader(port);
        return;
      } catch (e) {
        if (e.code !== "EADDRINUSE") throw e;
        // another copy may have just won this port
        const report = {};
        const link = await connectHub({ port, token: this.token, report });
        if (link) return this.becomeFollower(link, port);
        this.checkBusy(port, report);
      }
    }
    throw new Error("all 10 local ports are in use");
  }

  async becomeLeader(port) {
    const { server } = await listenOn({
      host: HOST,
      port,
      checkUpgrade: (req, p) => {
        const origin = req.headers.origin;
        const host = req.headers.host;
        const ok = ALLOWED_ORIGINS.includes(origin) && host === `${HOST}:${p}`;
        if (!ok) log("Rejected connection: wrong origin", JSON.stringify(String(origin || "(none)").slice(0, 80)));
        return ok;
      },
      onUpgrade: (req, socket, head) => acceptHub(req, socket, head, { token: this.token, port, onFollower: (line) => this.onFollower(line) }),
      onConnection: (ws) => this.onConnection(ws)
    });
    this.role = "leader";
    this.port = port;
    this.server = server;
    this.registerPort();
    if (port !== PORTS[0]) this.singleTimer = setInterval(() => this.checkSingle(), SINGLE_CHECK_MS).unref();
    if (!this.peerTimer) { this.peerTimer = setInterval(() => this.pushPeers(), 5000); this.peerTimer.unref(); }
    log(`Local server started: ws://${HOST}:${port} (only accepts extensions ${EXTENSION_ID} and ${STORE_EXTENSION_ID})`);
  }

  // Leader not on the first port: is there another leader on a lower port? Then step down and join it.
  // Only this direction, so two leaders can never both step down.
  async checkSingle() {
    if (this.checking || this.role !== "leader" || this.pending.size) return; // not in the middle of a request
    this.checking = true;
    try {
      const lower = PORTS.filter((p) => p < this.port);
      const links = await Promise.all(lower.map((port) => connectHub({ port, token: this.token })));
      const at = this.pending.size ? -1 : links.findIndex(Boolean);
      links.forEach((l, i) => { if (l && i !== at) l.close(); });
      if (at >= 0) this.stepDown(links[at], lower[at]);
    } finally { this.checking = false; }
  }
  stepDown(link, port) {
    log(`Another local server already runs on port ${port}; joining it`);
    clearInterval(this.singleTimer);
    this.unregisterPort();
    this.server.close();
    this.server = null;
    this.becomeFollower(link, port);
    for (const c of [...this.conns]) c.ws.close(1001);   // the extension connects to the remaining leader
    for (const f of [...this.followers]) f.line.close(); // the other copies rejoin by themselves
    this.wake();                                         // own requests waiting here go through the hub instead
  }

  becomeFollower(line, port) {
    this.role = "follower";
    this.link = line;
    this.port = port;
    if (this.clientName) line.send({ type: "client", name: this.clientName });
    line.onmessage = (m) => {
      const p = m && m.type === "result" ? this.linkPending.get(m.id) : null;
      if (p) { this.linkPending.delete(m.id); p.resolve(m.result); }
    };
    line.onclose = () => {
      if (this.link !== line) return;
      this.link = null;
      this.role = "none";
      const lost = [...this.linkPending.values()];
      this.linkPending.clear();
      for (const p of lost) p.resolve({ lost: true });
      log("Hub closed, taking over or rejoining");
      setTimeout(() => this.start(), 20 + randomInt(0, 200)); // small spread so copies do not race
    };
    if (line.closed) line.onclose();
    log(`Joined the running local server on port ${port}`);
  }

  // Leader: one more AI session shares this connection
  onFollower(line) {
    const f = { line, name: null };
    this.followers.add(f);
    line.onclose = () => { this.followers.delete(f); this.pushClients(); };
    line.onmessage = async (m) => {
      if (m?.type === "client") { f.name = String(m.name || "ai").slice(0, 80); this.pushClients(); return; }
      if (m?.type !== "call") return;
      let result;
      try {
        if (m.what === "info") result = await this.localInfo(Math.min(Number(m.waitMs) || 0, 5000));
        else if (m.what === "request" && OPS.has(m.op)) result = await this.localRequest(m.op, m.params || {}, { waitMs: Math.min(Number(m.waitMs) || 0, 12000), client: f.name });
        else result = { ok: false, code: "OP_NOT_ALLOWED", reason: "Not allowed" };
      } catch (e) { result = { ok: false, code: "SERVER_ERROR", reason: "Local server error: " + (e?.message || e) }; }
      line.send({ type: "result", id: m.id, result });
    };
  }

  // Wait until this copy has joined or become the hub
  async joined(ms) {
    if (this.role !== "none") return true;
    await new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      this.joinWaiters.push(() => { clearTimeout(t); resolve(); });
    });
    return this.role !== "none";
  }
  notStarted() {
    return { ok: false, code: "SERVER_NOT_STARTED", reason: `The local server is not connected yet (${this.startError || "still starting"}). It keeps retrying by itself. If this stays, other programs or older AI sessions are holding its ports: close old AI sessions and try again.` };
  }
  async viaHub(call, ms) {
    const link = this.link;
    if (!link || link.closed) return { lost: true };
    const id = this.nextId++;
    return await new Promise((resolve) => {
      const timer = setTimeout(() => { this.linkPending.delete(id); resolve({ ok: false, code: "TIMEOUT", reason: "The running local server did not answer in time. Try again." }); }, ms);
      this.linkPending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); } });
      link.send({ type: "call", id, ...call });
    });
  }

  // Connection info for get_status (pairing code included while unpaired); same answer from every copy
  async info(waitMs = 0) {
    for (let i = 0; i < 2; i++) {
      if (!(await this.joined(6000))) return null;
      if (this.role === "leader") return this.localInfo(waitMs);
      const r = await this.viaHub({ what: "info", waitMs }, 10000);
      if (!r?.lost) return r?.ok === false ? null : r;
    }
    return null;
  }
  async localInfo(waitMs) {
    let s = this.summary();
    if (!s.paired && s.ever_paired && waitMs) { await this.waitReady(waitMs); s = this.summary(); }
    if (!s.paired) this.armPairing();
    return { ...s, code: s.paired ? null : this.currentCode(), ai_apps: this.clients() };
  }

  async request(op, params, { waitMs = 12000 } = {}) {
    for (let i = 0; i < 2; i++) {
      if (!(await this.joined(6000))) return this.notStarted();
      if (this.role === "leader") {
        const own = await this.localRequest(op, params, { waitMs, client: this.clientName });
        if (!own?.lost) return own;
        continue; // stepped down before anything was sent: ask the new leader
      }
      const r = await this.viaHub({ what: "request", op, params, waitMs }, timeoutFor(op) + waitMs + 5000);
      if (!r?.lost) return r;
      // The hub closed while we waited. Reads are safe to repeat; a draft might already be saved, so never repeat it.
      if (WRITE_OPS.has(op)) return { ok: false, code: "HUB_CHANGED", reason: "The connection switched while saving, so it is not known whether the draft was saved. Check list_drafts before saving again." };
    }
    return this.notStarted();
  }

  // When several local servers run (e.g. Claude desktop + Claude Code), they register their ports with each other
  // so the extension only connects to ports that are really in use
  portsDir() { return join(this.dataDir, "ports"); }
  registerPort() {
    try {
      mkdirSync(this.portsDir(), { recursive: true, mode: 0o700 });
      writeFileSync(join(this.portsDir(), String(process.pid)), String(this.port), { mode: 0o600 });
      if (this.signalsSet) return;
      this.signalsSet = true;
      const cleanup = () => this.unregisterPort();
      process.on("exit", cleanup);
      for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { cleanup(); process.exit(0); });
    } catch (_) {}
  }
  unregisterPort() {
    try { unlinkSync(join(this.portsDir(), String(process.pid))); } catch (_) {}
  }
  // Notes left by other copies that are still running: which port each one holds
  noted() {
    const out = [];
    try {
      for (const name of readdirSync(this.portsDir())) {
        const pid = Number(name);
        if (!pid || pid === process.pid) continue;
        try { process.kill(pid, 0); } catch (_) { try { unlinkSync(join(this.portsDir(), name)); } catch (_) {} continue; }
        const port = Number(readFileSync(join(this.portsDir(), name), "utf8"));
        if (PORTS.includes(port)) out.push({ pid, port });
      }
    } catch (_) {}
    return out;
  }
  peers() {
    return this.noted().map((n) => n.port).filter((p) => p !== this.port);
  }
  // Send the list every time (not only when it changes): another server may restart on the same port,
  // and the extension needs to hear about it again to reconnect.
  pushPeers() {
    const peers = this.peers().sort();
    if (!peers.length) return;
    for (const c of this.conns) if (c.state === "ready") c.ws.send({ type: "peers", peers });
  }

  onConnection(ws) {
    if ([...this.conns].filter((x) => x.state !== "ready").length >= MAX_PREAUTH) return ws.close(1013);
    ws.maxMessage = PREAUTH_MAX_MESSAGE;
    const c = { ws, state: "new" };
    this.conns.add(c);
    const authTimer = setTimeout(() => { if (c.state !== "ready") ws.close(1008); }, 10 * 60 * 1000);
    const helloTimer = setTimeout(() => { if (c.state === "new" || c.state === "auth") ws.close(1008); }, 10000);
    // waiting to pair but not pairing: do not hold a slot for long (the extension reconnects by itself)
    const idleTimer = setInterval(() => { if (c.state === "need_pair" && !c.pairing && Date.now() - (c.lastPairAt || c.since) > NEED_PAIR_IDLE_MS) ws.close(1000); }, 15000);
    c.since = Date.now();
    ws.onclose = () => {
      clearTimeout(helloTimer); clearTimeout(authTimer); clearInterval(idleTimer);
      this.conns.delete(c);
      // answers can only come from this connection: fail its open requests now instead of waiting for the timeout
      for (const [id, p] of this.pending) if (p.conn === c) { this.pending.delete(id); clearTimeout(p.timer); p.resolve({ ok: false, code: "EXTENSION_DISCONNECTED", reason: "The Chrome extension disconnected before answering. Try again." }); }
      if (c.state === "ready") log("Extension disconnected");
    };
    const ready = (msg) => {
      c.state = "ready";
      ws.maxMessage = undefined;
      ws.send({ ...msg, v: PROTOCOL, server: "aiforbusiness-chat-assistant-mcp", client: this.clientName, clients: this.clients(), peers: this.peers() });
      this.wake();
    };
    ws.onmessage = (text) => {
      let m;
      try { m = JSON.parse(text); } catch (_) { return; }
      if (!m || typeof m !== "object") return;
      if (m.type === "hello") {
        if (c.state !== "new" && c.state !== "need_pair") return;
        if (m.v !== PROTOCOL || !isB64Of(m.ne, 32)) {
          ws.send({ type: "update_needed", v: PROTOCOL, reason: "The Chrome extension is older than this AI plugin. Update the extension." });
          return ws.close(1008);
        }
        const s = this.readSecret();
        if (s && m.paired !== false) {
          c.ne = m.ne; c.ns = nonce(); c.state = "auth";
          ws.send({ type: "hello_auth", v: PROTOCOL, ns: c.ns, proof: helloProof(s, "srv", this.port, c.ne, c.ns) });
        } else {
          c.state = "need_pair";
          ws.send({ type: "need_pair", v: PROTOCOL, server: "aiforbusiness-chat-assistant-mcp" });
          log("Extension connected, waiting for pairing");
        }
      } else if (m.type === "auth") {
        if (c.state !== "auth") return;
        const s = this.readSecret();
        if (s && sameB64(m.proof, helloProof(s, "ext", this.port, c.ne, c.ns))) {
          ready({ type: "hello_ok" });
          log("Extension connected (paired)");
        } else {
          ws.close(1008);
        }
      } else if (m.type === "want_pair") {
        // the extension's secret did not match ours (e.g. it was reset): pair again
        if (c.state !== "auth") return;
        c.state = "need_pair";
        ws.send({ type: "need_pair", v: PROTOCOL, server: "aiforbusiness-chat-assistant-mcp" });
      } else if (m.type === "pair_start") {
        if (c.state !== "need_pair" || c.pairing) return;
        if (this.lockedOut) {
          return ws.send({ type: "pair_failed", code: "LOCKED", reason: "Too many pairing tries, so pairing is paused. Fully quit all your AI apps (Claude / ChatGPT) and open them again." });
        }
        if (!(Date.now() < (this.armedUntil || 0))) {
          return ws.send({ type: "pair_failed", code: "NOT_ARMED", reason: "Ask your AI \"WhatsApp status\" first to get a pairing code." });
        }
        if (m.v !== PROTOCOL || !isB64Of(m.ne, 32) || !isB64Of(m.pa, 65)) return ws.send({ type: "pair_failed", code: "BAD", reason: "Bad pairing message" });
        const now = Date.now();
        if (now - (c.lastPairAt || 0) < 300) return ws.send({ type: "pair_failed", code: "BAD", reason: "Too fast. Try again." });
        c.lastPairAt = now;
        // every start counts as a try until it succeeds: against this code, and against the whole life of the program
        this.pairBudget = (this.pairBudget ?? PAIR_BUDGET) - 1;
        if (this.pairBudget < 0) { this.lockedOut = true; return ws.send({ type: "pair_failed", code: "LOCKED", reason: "Too many pairing tries, so pairing is paused. Fully quit all your AI apps (Claude / ChatGPT) and open them again." }); }
        const before = this.code;
        this.wrongTry(ws, false);
        if (this.lockedOut || this.code !== before) return;
        const code = this.currentCode();
        const ns = nonce();
        let r;
        try { r = serverPair(this.port, m.ne, ns, m.pa, code); } catch (_) { return ws.send({ type: "pair_failed", code: "BAD", reason: "Bad pairing message" }); }
        c.pairing = { ...r, ne: m.ne, ns, code };
        ws.send({ type: "pair_srv", v: PROTOCOL, ns, pb: r.pb, mac: r.mac });
      } else if (m.type === "pair_abort") {
        c.pairing = null; // the extension found the code did not match (already counted at pair_start)
      } else if (m.type === "pair_ext") {
        const p = c.pairing;
        if (c.state !== "need_pair" || !p?.extMac) return;
        c.pairing = null;
        if (p.code !== this.code || Date.now() > this.codeExpires || !sameB64(m.mac, p.extMac)) {
          return ws.send({ type: "pair_failed", code: "WRONG", reason: "Wrong pairing code" });
        }
        // reuse an existing secret (paired by another local server) so all servers share it
        let s = this.readSecret();
        if (!s) { s = randomBytes(32).toString("hex"); this.writeSecret(s); }
        let w;
        try { w = wrapSecret(p.h, p.ne, p.ns, s); } catch (_) { return ws.send({ type: "pair_failed", reason: "Bad pairing message" }); }
        this.newCode(); // a pairing code is single-use
        this.wrong = 0; this.rounds = 0; this.pairBudget = PAIR_BUDGET;
        this.armedUntil = 0; // pairing off again until a code is shown to the AI
        ready({ type: "paired", iv: w.iv, ct: w.ct });
        log("Paired");
      } else if (m.type === "response") {
        if (c.state !== "ready") return;
        const p = this.pending.get(m.id);
        if (p && p.conn === c) { this.pending.delete(m.id); clearTimeout(p.timer); p.resolve(m.result); }
      } else if (m.type === "ping") {
        // before authentication: no information about which AI apps are running
        ws.send(c.state === "ready" ? { type: "pong", client: this.clientName, clients: this.clients() } : { type: "pong" });
      }
    };
  }

  // A failed or unfinished pairing try. After MAX_WRONG the code changes; after 3 such rounds pairing pauses.
  wrongTry(ws, quiet) {
    this.wrong++;
    if (this.wrong < MAX_WRONG) return;
    this.wrong = 0;
    this.rounds = (this.rounds || 0) + 1;
    if (this.rounds >= 3) this.lockedOut = true; // stop other local programs from guessing forever
    this.newCode();
    if (!quiet) ws.send({ type: "pair_failed", code: "CODE_CHANGED", reason: "Too many tries, so the pairing code has changed. Ask your AI \"WhatsApp status\" again to get a new code." });
    log("Too many pairing tries; new code");
  }

  wake() {
    const w = this.waiters.splice(0);
    for (const fn of w) fn();
  }

  readyConn() {
    for (const c of this.conns) if (c.state === "ready") return c;
    return null;
  }

  async waitReady(ms) {
    if (this.readyConn()) return true;
    await new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      this.waiters.push(() => { clearTimeout(t); resolve(); });
    });
    return !!this.readyConn();
  }

  summary() {
    const states = [...this.conns].map((c) => c.state);
    return {
      port: this.port,
      extension_connected: states.length > 0,
      paired: states.includes("ready"),
      waiting_for_pair: states.includes("need_pair"),
      ever_paired: !!this.readSecret()
    };
  }

  async localRequest(op, params, { waitMs, client }) {
    const ok = await this.waitReady(waitMs);
    if (this.role !== "leader") return { lost: true }; // stepped down while waiting; nothing was sent
    if (!ok) {
      const s = this.summary();
      if (s.waiting_for_pair) {
        this.armPairing();
        return { ok: false, code: "NOT_PAIRED", reason: `The Chrome extension is connected but not paired yet. Ask the user to open the "AI for Business Chat Assistant" extension (or the AI+ dashboard in WhatsApp Web) and enter pairing code ${this.currentCode()}` };
      }
      if (!s.ever_paired) this.armPairing();
      return {
        ok: false, code: "EXTENSION_NOT_CONNECTED",
        reason: "The Chrome extension is not connected to this local server. Check: (1) Chrome is open and the \"AI for Business Chat Assistant\" extension is enabled, (2) click the extension icon to reconnect now." +
          (s.ever_paired ? "" : ` First-time setup needs pairing. Pairing code: ${this.currentCode()}`)
      };
    }
    const c = this.readyConn();
    const id = this.nextId++;
    return await new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, code: "TIMEOUT", reason: "The extension did not answer in time. The WhatsApp tab may be stuck; reload it and try again." });
      }, timeoutFor(op));
      this.pending.set(id, { resolve, timer, conn: c });
      c.ws.send({ type: "request", id, op, params: params || {}, client: client || null });
    });
  }
}

