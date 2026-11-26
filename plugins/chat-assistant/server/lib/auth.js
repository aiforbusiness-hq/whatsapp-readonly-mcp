// Mutual authentication with the Chrome extension (protocol v3). Must match extension/pairing.js exactly;
// tests/rogue.test.mjs and tests/pake.test.mjs check that both sides agree.
// - Paired: both sides prove they hold the secret with HMAC over fresh nonces and the port. The secret is never sent.
// - First pairing: a 6-digit code that is never sent, using SPAKE2 (RFC 9382, P-256; spake2.js). Each try tests only
//   one guess, even for a program that records everything, so a short code with few tries is safe. Then the secret
//   is sent encrypted with a key from the SPAKE2 result.
import { createHmac, createHash, hkdfSync, createCipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { spakeStart, spakeFinish, scalar, wBytes } from "./spake2.js";

export const CODE_DIGITS = 6;
export const PROTOCOL = 3;
export const b64 = (b) => Buffer.from(b).toString("base64");
export const nonce = () => b64(randomBytes(32));
export const normCode = (c) => String(c || "").replace(/\D/g, "");
export const isB64Of = (s, n) => typeof s === "string" && s.length <= 200 && /^[A-Za-z0-9+/]+=*$/.test(s) && Buffer.from(s, "base64").length === n;
export const validSecret = (s) => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);

export function sameB64(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = Buffer.from(a, "base64"), y = Buffer.from(b, "base64");
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}

export const helloProof = (secret, role, port, ne, ns) => createHmac("sha256", String(secret)).update(`wa-${role}|${port}|${ne}|${ns}`).digest("base64");

const sha = (t) => createHash("sha256").update(t).digest();
export const pakeW = (port, code) => scalar(sha(`wa-pair-w|3|${port}|${normCode(code)}`));
const transcript = (port, ne, ns, pa, pb, k, w) => sha(`wa-pair|3|${port}|${ne}|${ns}|${pa}|${pb}|${b64(k)}|${Buffer.from(wBytes(w)).toString("hex")}`);
const mac = (h, role) => createHmac("sha256", h).update(role).digest("base64");

// Server side of one pairing try. Throws on an invalid point from the extension.
export function serverPair(port, ne, ns, pa, code) {
  const w = pakeW(port, code);
  const { x, pub } = spakeStart("B", w, randomBytes(48));
  const k = spakeFinish("B", x, w, new Uint8Array(Buffer.from(pa, "base64")));
  const pb = b64(pub);
  const h = transcript(port, ne, ns, pa, pb, k, w);
  return { pb, h, mac: mac(h, "srv"), extMac: mac(h, "ext") };
}
// Encrypt the secret for the extension with a key only the two sides of this pairing can compute
export function wrapSecret(h, ne, ns, secret) {
  const salt = sha(`wa-pair-salt|${ne}|${ns}`);
  const key = Buffer.from(hkdfSync("sha256", h, salt, "wa-pair-wrap", 32));
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(salt);
  const ct = Buffer.concat([c.update(secret, "utf8"), c.final(), c.getAuthTag()]);
  return { iv: b64(iv), ct: b64(ct) };
}
