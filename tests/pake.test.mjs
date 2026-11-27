// SPAKE2 pairing (protocol v3): both copies of spake2.js are identical, honest pairing works, a wrong code fails,
// bad points are refused, and a recorded try does not let anyone test other codes offline.
// Run: node --test tests/pake.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import * as E from "../extension/pairing.js";
import * as S from "../plugins/aiforbusiness-chat-assistant/server/lib/auth.js";
import { spakeStart, spakeFinish, _test } from "../extension/spake2.js";

const PORT = 47821, ne = S.nonce(), ns = S.nonce();

test("the extension and the server use the very same SPAKE2 file", () => {
  assert.equal(readFileSync(new URL("../extension/spake2.js", import.meta.url), "utf8"), readFileSync(new URL("../plugins/aiforbusiness-chat-assistant/server/lib/spake2.js", import.meta.url), "utf8"));
  assert.equal(E.CODE_DIGITS, 6); assert.equal(S.CODE_DIGITS, 6); assert.equal(E.PROTOCOL, S.PROTOCOL);
});

test("curve math sanity: n·G is infinity, the constants are on the curve", () => {
  const { G, M, NN, mul, affine, onCurve, N } = _test;
  assert.equal(mul(N, G)[2], 0n);
  for (const p of [M, NN]) { const [x, y] = affine(p); assert.ok(onCurve(x, y)); }
});

test("same code: both sides agree and the secret arrives; different code: refused", async () => {
  const st = await E.extStart(PORT, "123 456");
  const srv = S.serverPair(PORT, st.ne, ns, st.pa, "123456");
  const f = await E.extFinish(st, ns, srv.pb, srv.mac);
  assert.equal(f.ok, true); assert.ok(S.sameB64(f.mac, srv.extMac));
  const secret = randomBytes(32).toString("hex");
  const w = S.wrapSecret(srv.h, st.ne, ns, secret);
  assert.equal(await E.unwrapSecret(f.h, st.ne, ns, w.iv, w.ct), secret);
  // wrong code typed by the user
  const st2 = await E.extStart(PORT, "123457");
  const srv2 = S.serverPair(PORT, st2.ne, ns, st2.pa, "123456");
  assert.equal((await E.extFinish(st2, ns, srv2.pb, srv2.mac)).ok, false);
  // proof bound to the port: the same code on another port does not match
  const st3 = await E.extStart(PORT + 1, "123456");
  assert.equal((await E.extFinish(st3, ns, S.serverPair(PORT, st3.ne, ns, st3.pa, "123456").pb, srv.mac)).ok, false);
});

test("invalid points from the other side are refused", async () => {
  const st = await E.extStart(PORT, "123456");
  for (const bad of [Buffer.alloc(65), Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]), Buffer.alloc(33, 2)]) {
    assert.throws(() => S.serverPair(PORT, ne, ns, bad.toString("base64"), "123456"));
    assert.equal((await E.extFinish(st, ns, bad.toString("base64"), "AAAA")).ok, false);
  }
});

test("a program that records one try cannot test other codes offline", async () => {
  // the attacker plays the extension with its own guess; the server answers with the real code
  const real = "654321", guess = "111111";
  const st = await E.extStart(PORT, guess);
  const srv = S.serverPair(PORT, st.ne, ns, st.pa, real);
  // knowing everything it sent and received, it re-checks other codes against the server's answer: none matches,
  // not even the real one (that needs the server's private number)
  let hits = 0;
  for (const c of [real, guess, "000000", "999999"]) {
    const w = await E.pakeW(PORT, c);
    const k = (() => { try { return spakeFinish("A", st.x, w, Buffer.from(srv.pb, "base64")); } catch (_) { return null; } })();
    if (k) { const again = await E.extFinish({ ...st, w }, ns, srv.pb, srv.mac); if (again.ok) hits++; }
  }
  assert.equal(hits, 0);
});
