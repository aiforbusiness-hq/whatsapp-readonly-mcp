// Minimal WebSocket server (RFC 6455) using only Node built-ins; no dependencies.
// Supports text frames, ping/pong and close only; enough for the extension.
import { createServer } from "node:http";
import { createHash } from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_PAYLOAD = 32 * 1024 * 1024;

export class WsConn {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.fragBytes = 0;
    this.maxMessage = undefined; // a smaller limit (bytes) while the peer has not authenticated
    this.closed = false;
    this.onmessage = () => {};
    this.onclose = () => {};
    socket.on("data", (d) => this._data(d));
    socket.on("end", () => socket.destroy()); // the other side left; upgraded sockets stay half-open otherwise
    socket.on("close", () => this._closed());
    socket.on("error", () => this._closed());
  }
  _closed() {
    if (this.closed) return;
    this.closed = true;
    this.onclose();
  }
  limit() { return Math.min(this.maxMessage || MAX_PAYLOAD, MAX_PAYLOAD); }
  _data(d) {
    if (this.closed) return;
    // collect pieces and join them only once enough bytes have arrived (no re-copying on every piece)
    (this.parts ||= []).push(d);
    this.partBytes = (this.partBytes || 0) + d.length;
    if (this.buf.length + this.partBytes > this.limit() + 14) return this.close(1009); // one frame can never be bigger
    if (this.buf.length + this.partBytes < (this.need || 2)) return;
    this.buf = Buffer.concat([this.buf, ...this.parts]);
    this.parts = []; this.partBytes = 0; this.need = 2;
    for (;;) {
      if (this.buf.length < 2) { this.need = 2; return; }
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) { this.need = 4; return; }
        len = this.buf.readUInt16BE(2); off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) { this.need = 10; return; }
        const big = this.buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_PAYLOAD)) return this.close(1009);
        len = Number(big); off = 10;
      }
      if (!masked) return this.close(1002); // frames from a browser are always masked
      if (len > this.limit()) return this.close(1009);
      if (this.buf.length < off + 4 + len) { this.need = off + 4 + len; return; }
      const mask = this.buf.subarray(off, off + 4);
      const payload = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);

      if (opcode === 0x8) return this.close(1000);
      if (opcode === 0x9) { this._send(0xa, payload); continue; }
      if (opcode === 0xa) continue;
      if (opcode === 0x1 || opcode === 0x0) {
        if (opcode === 0x0 && !this.frags.length) return this.close(1002); // continuation without a start
        if (opcode === 0x1 && this.frags.length) return this.close(1002);  // new message before the last one ended
        this.fragBytes += payload.length;
        if (this.fragBytes > this.limit()) return this.close(1009); // whole message, not just one frame
        this.frags.push(payload);
        if (fin) {
          const text = Buffer.concat(this.frags).toString("utf8");
          this.frags = []; this.fragBytes = 0;
          try { this.onmessage(text); } catch (_) {}
        }
        continue;
      }
      return this.close(1003); // no binary frames
    }
  }
  _send(opcode, payload) {
    if (this.closed) return;
    const len = payload.length;
    let header;
    if (len < 126) header = Buffer.from([0x80 | opcode, len]);
    else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
    this.socket.write(Buffer.concat([header, payload]));
  }
  send(obj) {
    this._send(0x1, Buffer.from(JSON.stringify(obj), "utf8"));
  }
  close(code = 1000) {
    if (this.closed) return;
    const p = Buffer.alloc(2); p.writeUInt16BE(code, 0);
    try { this._send(0x8, p); } catch (_) {}
    try { this.socket.end(); } catch (_) {}
    this._closed();
  }
}

// Start the server on one port, bound to 127.0.0.1 only. The upgrade is allowed only if checkUpgrade(req) returns true.
// onUpgrade may claim an upgrade first (used by the hub). Rejects with EADDRINUSE when the port is taken.
export function listenOn({ host, port, checkUpgrade, onUpgrade, onConnection }) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      // ignore plain HTTP requests
      res.writeHead(404, { "content-type": "text/plain" });
      res.end();
    });
    server.on("upgrade", (req, socket, head) => {
      socket.on("error", () => {});
      if (onUpgrade && onUpgrade(req, socket, head)) return;
      const reject403 = () => { socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); };
      const key = req.headers["sec-websocket-key"];
      if (!key || (req.headers.upgrade || "").toLowerCase() !== "websocket") return reject403();
      if (!checkUpgrade(req, port)) return reject403();
      const accept = createHash("sha1").update(key + GUID).digest("base64");
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
      );
      socket.setNoDelay(true);
      onConnection(new WsConn(socket), req);
    });
    server.once("error", reject);
    server.listen(port, host, () => { server.on("error", () => {}); resolve({ server, port }); });
  });
}
