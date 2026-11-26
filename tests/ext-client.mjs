// Test stand-in for the Chrome extension's connection logic (protocol v3), built on the real extension/pairing.js.
import { b64, rand, isB64Of, sameB64, helloProof, extStart, extFinish, unwrapSecret, validSecret, PROTOCOL } from "../extension/pairing.js";

// Connect like the extension: hello with a nonce, verify the server's proof, answer with ours.
// opts.secret: the stored secret (or null). Returns a handle with .msgs, .ready, .secret, .ws, .pair(code).
export function extConnect(port, opts = {}) {
  const x = { port, secret: opts.secret || null, msgs: [], ready: false, verified: false, state: "connecting", expect: null, onRequest: opts.onRequest || null };
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { origin: opts.origin || "chrome-extension://hmajmekaiaiilhneebgbnchonfkblndb" } });
  x.ws = ws;
  ws.onopen = async () => { x.ne = b64(rand()); ws.send(JSON.stringify({ type: "hello", v: PROTOCOL, ne: x.ne, paired: !!x.secret })); };
  ws.onclose = () => { x.closed = true; };
  ws.onmessage = async (ev) => {
    const m = JSON.parse(ev.data);
    x.msgs.push(m);
    if (x.expect && x.expect.types.includes(m.type)) { const f = x.expect.f; x.expect = null; return f(m); }
    if (m.type === "hello_auth") {
      if (!x.secret || !isB64Of(m.ns, 32) || !sameB64(m.proof, await helloProof(x.secret, "srv", port, x.ne, m.ns))) { x.state = "need_pair"; return ws.send(JSON.stringify({ type: "want_pair" })); }
      x.verified = true;
      ws.send(JSON.stringify({ type: "auth", proof: await helloProof(x.secret, "ext", port, x.ne, m.ns) }));
    } else if (m.type === "hello_ok") {
      if (x.verified) { x.ready = true; x.state = "ready"; }
    } else if (m.type === "need_pair") {
      x.state = "need_pair";
    } else if (m.type === "request" && x.ready && x.onRequest) {
      const result = await x.onRequest(m);
      if (result !== undefined) ws.send(JSON.stringify({ type: "response", id: m.id, result }));
    }
  };
  const expect = (types, ms, fn) => new Promise((resolve) => {
    const t = setTimeout(() => { x.expect = null; resolve(null); }, ms);
    x.expect = { types, f: (m) => { clearTimeout(t); resolve(m); } };
    fn();
  });
  x.pair = async (code) => {
    const st = await extStart(port, code);
    const srv = await expect(["pair_srv", "pair_failed"], 15000, () => ws.send(JSON.stringify({ type: "pair_start", v: PROTOCOL, ne: st.ne, pa: st.pa })));
    if (!srv || srv.type !== "pair_srv") return { ok: false, msg: srv };
    const f = await extFinish(st, srv.ns, srv.pb, srv.mac);
    if (!f.ok) { ws.send(JSON.stringify({ type: "pair_abort" })); return { ok: false, wrong: true }; }
    const fin = await expect(["paired", "pair_failed"], 10000, () => ws.send(JSON.stringify({ type: "pair_ext", mac: f.mac })));
    if (!fin || fin.type !== "paired") return { ok: false, msg: fin };
    const secret = await unwrapSecret(f.h, st.ne, srv.ns, fin.iv, fin.ct);
    if (!validSecret(secret)) return { ok: false };
    x.secret = secret; x.ready = true; x.verified = true; x.state = "ready";
    return { ok: true, secret };
  };
  x.send = (o) => ws.send(JSON.stringify(o));
  x.close = () => { try { ws.close(); } catch (_) {} };
  return x;
}
