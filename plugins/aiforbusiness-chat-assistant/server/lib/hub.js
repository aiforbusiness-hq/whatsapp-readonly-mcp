// Shared hub: lets any number of local servers (one per AI session) share one extension connection.
// The first server to start holds the port ("leader"); later ones join it ("followers") and pass
// their requests through it. If the leader exits, a follower takes over its port.
//
// Security:
// - uses the leader's existing 127.0.0.1 port, no extra listener
// - not reachable from a web page: needs the custom "wa-hub/1" upgrade, and any request carrying an Origin is refused
// - both sides prove they know a private token (hub-token, owner-readable only) with HMAC; the token is never sent
// - followers may only use the same operations as the extension accepts (nothing that can send)
import { request as httpRequest } from "node:http";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, linkSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export const HUB_PROTO = "wa-hub/1";
const HOST = "127.0.0.1";
const HANDSHAKE_MS = 1500;
const MAX_LINE = 32 * 1024 * 1024;

const hmac = (token, role, cn, sn, port) => createHmac("sha256", token).update([role, cn, sn, port].join("|")).digest("hex");
const same = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};
const isNonce = (s) => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);

// Create the token once, atomically (several servers may start at the same moment)
export function loadToken(dataDir) {
  const f = join(dataDir, "hub-token");
  const read = () => { try { const t = readFileSync(f, "utf8").trim(); return /^[0-9a-f]{64}$/.test(t) ? t : null; } catch (_) { return null; } };
  const have = read();
  if (have) return have;
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const tmp = f + "." + process.pid + "." + randomBytes(4).toString("hex");
  writeFileSync(tmp, randomBytes(32).toString("hex"), { mode: 0o600 });
  try { linkSync(tmp, f); } catch (e) {
    // disks without hard links: create-if-missing still never overwrites another copy's token
    if (e.code !== "EEXIST") try { writeFileSync(f, readFileSync(tmp, "utf8"), { mode: 0o600, flag: "wx" }); } catch (e2) { if (e2.code !== "EEXIST") throw e2; }
  } finally { try { unlinkSync(tmp); } catch (_) {} }
  const t = read();
  if (!t) throw new Error("hub-token is not readable");
  return t;
}

// Newline-delimited JSON over a socket
class Line {
  constructor(socket, head) {
    this.socket = socket;
    this.chunks = [];
    this.size = 0;
    this.closed = false;
    this.onmessage = () => {};
    this.onclose = () => {};
    socket.setNoDelay(true);
    socket.on("data", (d) => this._data(d));
    socket.on("end", () => socket.destroy()); // the other side left; upgraded sockets stay half-open otherwise
    socket.on("close", () => this._closed());
    socket.on("error", () => this._closed());
    if (head && head.length) setImmediate(() => this._data(head));
  }
  _data(d) {
    let i;
    while (!this.closed && (i = d.indexOf(10)) >= 0) {
      this.chunks.push(d.subarray(0, i));
      const text = Buffer.concat(this.chunks).toString("utf8");
      this.chunks = []; this.size = 0;
      d = d.subarray(i + 1);
      let m; try { m = JSON.parse(text); } catch (_) { return this.close(); }
      try { this.onmessage(m); } catch (_) {}
    }
    if (this.closed || !d.length) return;
    this.chunks.push(d);
    this.size += d.length;
    if (this.size > (this.maxLine || MAX_LINE)) this.close();
  }
  _closed() { if (this.closed) return; this.closed = true; this.onclose(); }
  send(o) { if (!this.closed) this.socket.write(JSON.stringify(o) + "\n"); }
  close() { try { this.socket.destroy(); } catch (_) {} this._closed(); }
}

// Leader side. Returns true when this upgrade was a hub request (handled or refused).
export function acceptHub(req, socket, head, { token, port, onFollower }) {
  if (String(req.headers.upgrade || "").toLowerCase() !== HUB_PROTO) return false;
  const cn = req.headers["x-hub-nonce"];
  if (req.headers.origin !== undefined || req.headers.host !== `${HOST}:${port}` || !isNonce(cn)) {
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    return true;
  }
  const sn = randomBytes(32).toString("hex");
  socket.on("error", () => {});
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    `Upgrade: ${HUB_PROTO}\r\nConnection: Upgrade\r\n` +
    `X-Hub-Nonce: ${sn}\r\nX-Hub-Proof: ${hmac(token, "server", cn, sn, port)}\r\n\r\n`
  );
  const line = new Line(socket, head);
  line.maxLine = 4096; // before the proof: only the small auth message
  const timer = setTimeout(() => line.close(), 3000);
  line.onclose = () => clearTimeout(timer);
  line.onmessage = (m) => {
    clearTimeout(timer);
    if (m?.type !== "auth" || !same(m.proof, hmac(token, "client", cn, sn, port))) return line.close();
    line.onmessage = () => {};
    line.maxLine = undefined;
    onFollower(line);
    line.send({ type: "ok" });
  };
  return true;
}

// Follower side. Resolves to a Line once both sides are verified; null when there is no hub on that port.
// report.silent is set when something accepted the connection but did not answer in time (maybe a hub that is busy).
export function connectHub({ port, token, report }) {
  return new Promise((resolve) => {
    let done = false, line = null, req = null, accepted = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!v) { try { line ? line.close() : req?.destroy(); } catch (_) {} }
      resolve(v);
    };
    const timer = setTimeout(() => { if (accepted && report && !done) report.silent = true; finish(null); }, HANDSHAKE_MS);
    const cn = randomBytes(32).toString("hex");
    req = httpRequest({ host: HOST, port, path: "/hub", agent: false,
      headers: { Connection: "Upgrade", Upgrade: HUB_PROTO, Host: `${HOST}:${port}`, "X-Hub-Nonce": cn } });
    req.on("socket", (s) => s.once("connect", () => { accepted = true; }));
    req.on("error", () => finish(null));
    req.on("response", (res) => { res.resume(); finish(null); });
    req.on("upgrade", (res, socket, head) => {
      const sn = res.headers["x-hub-nonce"];
      if (done || !isNonce(sn) || !same(res.headers["x-hub-proof"] || "", hmac(token, "server", cn, sn, port))) { socket.destroy(); return finish(null); }
      line = new Line(socket, head);
      line.onclose = () => finish(null);
      line.onmessage = (m) => {
        if (m?.type !== "ok") return finish(null);
        line.onmessage = () => {}; line.onclose = () => {};
        finish(line);
      };
      line.send({ type: "auth", proof: hmac(token, "client", cn, sn, port) });
    });
    req.end();
  });
}
