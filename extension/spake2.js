// SPAKE2 (RFC 9382) on P-256, pure JavaScript (BigInt), no dependencies.
// The SAME file is used by the Chrome extension (extension/spake2.js) and the local server
// (plugins/chat-assistant/server/lib/spake2.js); tests/pake.test.mjs checks that both copies are identical.
//
// Why: with a short (6-digit) pairing code, a normal "prove you know the code" message can be cracked offline
// in seconds. With SPAKE2 each pairing try tests exactly ONE guess, even for an attacker that records everything,
// so 6 digits plus a few tries per code is safe.
// Only math and byte encoding live here; hashing and random bytes come from the caller (WebCrypto / node:crypto).
// Note: BigInt math is not constant-time. The keys are fresh for every try and never reused, and an attacker
// would need precise timing of another process on the same computer, so this is accepted.

const P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;
const GX = 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n;
const GY = 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n;

const md = (a, m = P) => { const r = a % m; return r < 0n ? r + m : r; };
function pow(b, e, m = P) {
  let r = 1n; b = md(b, m);
  while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; }
  return r;
}
const inv = (a) => pow(a, P - 2n);

// Jacobian points [X, Y, Z]; Z = 0 is the point at infinity
const INF = [0n, 1n, 0n];
function dbl([X, Y, Z]) {
  if (Z === 0n || Y === 0n) return INF;
  const delta = md(Z * Z), gamma = md(Y * Y), beta = md(X * gamma);
  const alpha = md(3n * (X - delta) * (X + delta));
  const X3 = md(alpha * alpha - 8n * beta);
  const Z3 = md((Y + Z) * (Y + Z) - gamma - delta);
  const Y3 = md(alpha * (4n * beta - X3) - 8n * gamma * gamma);
  return [X3, Y3, Z3];
}
function add(p1, p2) {
  if (p1[2] === 0n) return p2;
  if (p2[2] === 0n) return p1;
  const [X1, Y1, Z1] = p1, [X2, Y2, Z2] = p2;
  const Z1Z1 = md(Z1 * Z1), Z2Z2 = md(Z2 * Z2);
  const U1 = md(X1 * Z2Z2), U2 = md(X2 * Z1Z1);
  const S1 = md(Y1 * Z2 * Z2Z2), S2 = md(Y2 * Z1 * Z1Z1);
  const H = md(U2 - U1), r = md(S2 - S1);
  if (H === 0n) return r === 0n ? dbl(p1) : INF;
  const HH = md(H * H), HHH = md(H * HH), V = md(U1 * HH);
  const X3 = md(r * r - HHH - 2n * V);
  const Y3 = md(r * (V - X3) - S1 * HHH);
  const Z3 = md(Z1 * Z2 * H);
  return [X3, Y3, Z3];
}
// Montgomery ladder (same steps for every bit)
function mul(k, pt) {
  let r0 = INF, r1 = pt;
  for (let i = 255; i >= 0; i--) {
    if ((k >> BigInt(i)) & 1n) { r0 = add(r0, r1); r1 = dbl(r1); }
    else { r1 = add(r0, r1); r0 = dbl(r0); }
  }
  return r0;
}
const neg = ([X, Y, Z]) => [X, md(-Y), Z];
function affine([X, Y, Z]) {
  if (Z === 0n) return null;
  const zi = inv(Z), zi2 = md(zi * zi);
  return [md(X * zi2), md(Y * zi2 * zi)];
}
const onCurve = (x, y) => x >= 0n && x < P && y >= 0n && y < P && md(y * y) === md(x * x * x - 3n * x + B);

const toBig = (u8) => { let r = 0n; for (const b of u8) r = (r << 8n) | BigInt(b); return r; };
const toBytes = (v, len = 32) => { const o = new Uint8Array(len); for (let i = len - 1; i >= 0; i--) { o[i] = Number(v & 0xffn); v >>= 8n; } return o; };
function encode(pt) {
  const a = affine(pt);
  if (!a) throw new Error("point at infinity");
  const o = new Uint8Array(65); o[0] = 4; o.set(toBytes(a[0]), 1); o.set(toBytes(a[1]), 33);
  return o;
}
// Only full (uncompressed) points that are really on the curve are accepted
function decode(u8) {
  if (!(u8 instanceof Uint8Array) || u8.length !== 65 || u8[0] !== 4) throw new Error("bad point");
  const x = toBig(u8.subarray(1, 33)), y = toBig(u8.subarray(33));
  if (!onCurve(x, y)) throw new Error("point not on curve");
  return [x, y, 1n];
}
function decompress(hex) {
  const pre = parseInt(hex.slice(0, 2), 16), x = BigInt("0x" + hex.slice(2));
  const rhs = md(x * x * x - 3n * x + B);
  let y = pow(rhs, (P + 1n) / 4n);
  if (md(y * y) !== rhs) throw new Error("bad constant");
  if (Number(y & 1n) !== (pre & 1)) y = P - y;
  return [x, y, 1n];
}
// RFC 9382 section 6, P-256 constants (nobody knows their discrete log)
const G = [GX, GY, 1n];
const M = decompress("02886e2f97ace46e55ba9dd7242579f2993b64e16ef3dcab95afd497333d8fa12f");
const NN = decompress("03d8bbd6c639c62937b04d997f38c3770719c629d7014d49a24b4f98baa1292b49");

// Scalar from at least 48 random / hash bytes, in 1..n-1
export const scalar = (bytes) => { if (!bytes || bytes.length < 32) throw new Error("need bytes"); return (toBig(bytes) % (N - 1n)) + 1n; };
// role "A" = the extension (uses M), "B" = the local server (uses N)
export function spakeStart(role, w, randomBytes48) {
  const x = scalar(randomBytes48);
  const pub = encode(add(mul(x, G), mul(w, role === "A" ? M : NN)));
  return { x, pub };
}
// Shared point from the other side's message; throws on anything that is not a valid point
export function spakeFinish(role, x, w, peerPub) {
  const peer = decode(peerPub);
  const k = mul(x, add(peer, neg(mul(w, role === "A" ? NN : M))));
  if (k[2] === 0n) throw new Error("bad shared point");
  return encode(k);
}
export const wBytes = (w) => toBytes(w);
export const _test = { G, M, NN, mul, add, encode, decode, onCurve, affine, N };
