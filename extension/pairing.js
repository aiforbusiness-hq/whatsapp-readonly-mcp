// 插件和本机程序互相证明身份（协定 v3）。插件和测试都用这个文件；只用 WebCrypto 和 spake2.js。
//
// 已配对（打招呼）：
//   插件 → hello {v:3, ne}                     ne = 32 bytes 随机
//   程序 → hello_auth {v:3, ns, proof}         proof = HMAC(secret, "wa-srv|port|ne|ns")
//   插件验证 proof（port = 插件自己连的端口）→ auth {proof: HMAC(secret, "wa-ext|port|ne|ns")}
//   程序验证 → hello_ok。密钥本身永远不在线路上传；port 绑在证明里，别的程序转发也没用。
//
// 第一次配对（6 位数配对码，不会在线路上传）：SPAKE2（RFC 9382，P-256）
//   w = SHA-256("wa-pair-w|3|port|配对码") mod n
//   插件 → pair_start {v:3, ne, pa}            pa = x·G + w·M
//   程序 → pair_srv {ns, pb, mac}              pb = y·G + w·N；K = y·(pa − w·M)
//                                              h = SHA-256(port、ne、ns、pa、pb、K、w)；mac = HMAC(h, "srv")
//   插件算 K = x·(pb − w·N)，验证 mac（码不对 / 假程序 → 不一样，停）→ pair_ext {mac: HMAC(h, "ext")}
//   程序验证 → paired {iv, ct}：密钥用 h 导出的金钥加密（HKDF + AES-GCM）
//   每一次尝试只能猜一个码（录下所有资料也没办法离线猜），所以 6 位数就够：
//   程序只在 AI 刚给码后 3 分钟内接受配对，同一个码最多试 5 次就换，每次启动最多 12 次，成功后关掉。
//   被猜中的机会：每次启动最多 12 / 1,000,000。
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
// 比较时间不随内容变
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
// 插件这边：开始配对
export async function extStart(port, code) {
  const w = await pakeW(port, code);
  const { x, pub } = spakeStart("A", w, rand(48));
  return { port, w, x, ne: b64(rand(32)), pa: b64(pub) };
}
// 插件这边：收到 pair_srv。码对、程序是真的 → { ok, mac, h }；不然 { ok: false }
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
