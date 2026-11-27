// The extension and the local program prove their identity to each other (protocol v3). The extension and the tests both use this file; it uses only WebCrypto and spake2.js.
//
// Already paired (handshake):
//   extension → hello {v:3, ne}                ne = 32 random bytes
//   program → hello_auth {v:3, ns, proof}      proof = HMAC(secret, "wa-srv|port|ne|ns")
//   extension checks proof (port = the port the extension itself connected to) → auth {proof: HMAC(secret, "wa-ext|port|ne|ns")}
//   program checks → hello_ok. The secret itself never goes over the wire; port is bound into the proof, so relaying through another program does not help.
//
// First pairing (6-digit pairing code, never sent over the wire): SPAKE2 (RFC 9382, P-256)
//   w = SHA-256("wa-pair-w|3|port|pairing code") mod n
//   extension → pair_start {v:3, ne, pa}       pa = x·G + w·M
//   program → pair_srv {ns, pb, mac}           pb = y·G + w·N; K = y·(pa − w·M)
//                                              h = SHA-256(port, ne, ns, pa, pb, K, w); mac = HMAC(h, "srv")
//   extension computes K = x·(pb − w·N), checks mac (wrong code / fake program → mismatch, stop) → pair_ext {mac: HMAC(h, "ext")}
//   program checks → paired {iv, ct}: the secret is encrypted with a key derived from h (HKDF + AES-GCM)
//   Each attempt can guess only one code (even a full recording does not allow offline guessing), so 6 digits are enough:
//   the program accepts pairing only within 3 minutes after the AI gives the code, changes the code after 5 tries, allows at most 12 tries per start, and closes after success.
//   Chance of a correct guess: at most 12 / 1,000,000 per start.
import { spakeStart, spakeFinish, scalar, wBytes } from "./spake2.js";
const enc = new TextEncoder();
export const CODE_DIGITS = 6;
export const PROTOCOL = 3;

export const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
export const unb64 = (s) => Uint8Array.from(atob(String(s)), (c) => c.charCodeAt(0));
export const rand = (n = 32) => crypto.getRandomValues(new Uint8Array(n));
export const normCode = (c) => String(c || "").replace(/\D/g, "");
export const isB64Of = (s, n) => typeof s === "string" && s.length <= 200 && /^[A-Za-z0-9+/]+=*$/.test(s) && (() => { try { return unb64(s).length === n; } catch (_) { return false; } })();

async function hmac(keyBytes, text) {
  const k = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(text)));
}
// Constant-time comparison (time does not depend on content)
export function sameBytes(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
export const sameB64 = (a, b) => { try { return sameBytes(unb64(a), unb64(b)); } catch (_) { return false; } };

export async function helloProof(secret, role, port, ne, ns) {
  return b64(await hmac(enc.encode(String(secret)), `wa-${role}|${port}|${ne}|${ns}`));
}

const sha = async (text) => new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)));
const hex = (u8) => [...u8].map((x) => x.toString(16).padStart(2, "0")).join("");
export const pakeW = async (port, code) => scalar(await sha(`wa-pair-w|3|${port}|${normCode(code)}`));
async function transcript(port, ne, ns, pa, pb, k, w) {
  return sha(`wa-pair|3|${port}|${ne}|${ns}|${pa}|${pb}|${b64(k)}|${hex(wBytes(w))}`);
}
// Extension side: start pairing
export async function extStart(port, code) {
  const w = await pakeW(port, code);
  const { x, pub } = spakeStart("A", w, rand(48));
  return { port, w, x, ne: b64(rand(32)), pa: b64(pub) };
}
// Extension side: got pair_srv. Right code and genuine program → { ok, mac, h }; otherwise { ok: false }
export async function extFinish(st, ns, pb, mac) {
  let k;
  try { k = spakeFinish("A", st.x, st.w, unb64(pb)); } catch (_) { return { ok: false }; }
  const h = await transcript(st.port, st.ne, ns, st.pa, pb, k, st.w);
  if (!sameB64(mac, b64(await hmac(h, "srv")))) return { ok: false };
  return { ok: true, h, mac: b64(await hmac(h, "ext")) };
}
export async function unwrapSecret(h, ne, ns, iv, ct) {
  const salt = await sha(`wa-pair-salt|${ne}|${ns}`);
  const hk = await crypto.subtle.importKey("raw", h, "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: enc.encode("wa-pair-wrap") }, hk, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv), additionalData: salt }, key, unb64(ct));
  return new TextDecoder().decode(pt);
}
export const validSecret = (s) => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);
