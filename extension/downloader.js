// 下载一条信息里的图片 / 影片 / 语音 / 文件。在 WhatsApp Web 页面环境（MAIN world）里执行，会被转成文字注入，必须自给自足。
//
// 只有 AI 通过 MCP 叫 download_media 时才会执行（background.js 的 request 通道）；弹窗、仪表板、网页都叫不到。
// 安全规则（不能破）：
// - 只下载指定的那一条；不点开对话、不标已读、不发已播放回条、不改 WhatsApp 的资料、不叫对方手机重传
// - 网络只去 WhatsApp 自己的媒体服务器（WhatsApp 自己的下载程序，或 https://mmg.whatsapp.net）
// - 内容必须跟信息里的 SHA-256 一样才收
// - 「看一次」的信息一律不下载
export async function mediaInPage(op, p) {
  const MAX = 200 * 1024 * 1024;
  const fail = (code, reason) => ({ ok: false, code, reason });
  const HOLD = Symbol.for("aifb.media");
  const hold = window[HOLD] || (window[HOLD] = new Map()); // 暂放，取完就删
  const toB64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const drop = (t) => { clearTimeout(hold.get(t)?.timer); hold.delete(t); };

  if (op === "chunk") {
    const h = hold.get(p.token);
    return h ? toB64(h.bytes.subarray(p.from, p.from + p.len)) : null;
  }
  if (op === "end") { drop(p.token); return true; }
  if (op !== "fetch") return fail("BAD_OP", "Unknown command");

  // 「看一次」：WhatsApp 的任何标记都算（记忆体里的信息，或硬盘里存的原始资料，栏位名称 / 型别可能不同）
  const isOnce = (m) => {
    if (!m || typeof m !== "object") return false;
    if (m.isViewOnce === true || m.isViewOnce === 1 || m.isViewOnce === "true" || /view_?once/i.test(String(m.type || "") + " " + String(m.subtype || ""))) return true;
    const a = m.attributes && typeof m.attributes === "object" ? m.attributes : null;
    for (const [o, keys] of [[m, Object.keys(m)], [a, a ? Object.keys(a) : []]]) {
      for (const k of keys) if (/view_?once/i.test(k)) { const v = o[k]; if (v && v !== "false" && v !== "0") return true; }
    }
    return false;
  };
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const keyStr = (m) => (typeof m?.id === "string" ? m.id : m?.id?._serialized || null);
  const key = str(p.message_id);
  const chatId = key.split("_")[1];
  let C;
  try { C = window.require("WAWebCollections"); } catch (_) { return fail("WA_NOT_READY", "WhatsApp Web hasn't finished loading"); }
  const chat = (C?.Chat || C?.ChatCollection)?.getModelsArray?.().find((c) => c.id?._serialized === chatId);
  let m = chat?.msgs?.getModelsArray?.().find((x) => keyStr(x) === key) || null;
  if (!m) m = await fromDb();
  if (!m) return fail("MESSAGE_NOT_FOUND", "No message with this id on this computer. Use the id from get_messages or search_messages.");
  if (isOnce(m)) return fail("VIEW_ONCE", "View-once message: not downloaded, on purpose.");
  const APP = { image: "Image", sticker: "Image", video: "Video", ptv: "Video", audio: "Audio", ptt: "Audio", document: "Document" }[m.type];
  if (!APP) return fail("NO_MEDIA", "This message has no photo or file.");
  if (Number(m.size) > MAX) return fail("TOO_BIG", "The file is bigger than 200 MB. Ask the user to download it in WhatsApp.");
  const filehash = str(m.filehash);
  if (!filehash) return fail("NO_DETAILS", "WhatsApp Web did not keep the download details of this message. Ask the user to open the chat in WhatsApp, then try again.");

  const good = async (v) => {
    try {
      const b = v instanceof Blob ? (v.size <= MAX ? new Uint8Array(await v.arrayBuffer()) : null)
        : v instanceof ArrayBuffer ? new Uint8Array(v)
        : ArrayBuffer.isView(v) ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : null;
      if (!b || !b.length || b.length > MAX) return null;
      return toB64(new Uint8Array(await crypto.subtle.digest("SHA-256", b))) === filehash ? b : null;
    } catch (_) { return null; }
  };
  const within = (promise, ms) => Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
  let bytes = null, source = null, gone = false;

  // 1. 已经在记忆体里
  for (const o of [m.mediaObject?.mediaBlob, m.mediaData?.mediaBlob]) {
    if (!bytes && o) { bytes = await good(o._blob instanceof Blob ? o._blob : o); if (bytes) source = "already on this computer"; }
  }
  // 2. WhatsApp Web 自己的媒体缓存
  if (!bytes) { bytes = await fromCache().catch(() => null); if (bytes) source = "already on this computer"; }
  // 3. 用 WhatsApp Web 自己的下载程序（不经过信息物件，所以不改它的状态）
  if (!bytes && m.directPath && m.mediaKey) {
    const ctl = new AbortController();
    try {
      const mgr = window.require("WAWebDownloadManager")?.downloadManager;
      if (typeof mgr?.downloadAndMaybeDecrypt === "function") {
        const qpl = { addAnnotations() { return this; }, addPoint() { return this; } };
        bytes = await good(await within(mgr.downloadAndMaybeDecrypt({
          directPath: m.directPath, encFilehash: m.encFilehash, filehash, mediaKey: m.mediaKey,
          mediaKeyTimestamp: m.mediaKeyTimestamp, type: m.type, signal: ctl.signal, downloadQpl: qpl
        }), 150000));
        if (bytes) source = "downloaded by WhatsApp Web";
      }
    } catch (_) { ctl.abort(); }
  }
  // 4. 直接从 WhatsApp 的媒体服务器拿加密文件，在这台电脑解密（WhatsApp 的公开加密格式）
  if (!bytes && m.directPath && m.mediaKey) {
    try { bytes = await direct(); if (bytes) source = "downloaded from WhatsApp's media server"; } catch (_) {}
  }
  if (!bytes) {
    return gone
      ? fail("EXPIRED", "WhatsApp no longer keeps this file on its server. Ask the user to open it on their phone or in WhatsApp Web (that can ask the sender to upload it again), then try again.")
      : fail("DOWNLOAD_FAILED", "WhatsApp Web could not download this file. Ask the user to open the chat in WhatsApp, then try again.");
  }

  const token = crypto.randomUUID();
  hold.set(token, { bytes, timer: setTimeout(() => hold.delete(token), 10 * 60 * 1000) });
  const mime = str(m.mimetype).split(";")[0].toLowerCase() || "application/octet-stream";
  // WhatsApp 放在信息里的小预览图（影片、PDF 第一页）。只收 JPEG / PNG / WebP，插件还会重新画一次
  let preview = null;
  for (const v of [m.body, m.thumbnail, m.mediaData?.preview?._b64, m.mediaObject?.contentInfo?._preview?._b64, m.mediaData?.preview]) {
    if (!preview && typeof v === "string" && v.length > 80 && v.length < 400000 && /^(\/9j\/|iVBORw0KGgo|UklGR)[A-Za-z0-9+/=\r\n]+$/.test(v)) preview = v.replace(/\s/g, "");
  }
  return {
    ok: true, token, size: bytes.length, mime, kind: m.type, source, file_name: str(m.filename) || null, filehash, preview,
    time: m.t ? new Date(m.t * 1000).toISOString() : null,
    chat: { id: chatId, name: chat?.formattedTitle || chat?.name || chatId }
  };

  function open(name) {
    return (async () => {
      if (!(await indexedDB.databases()).some((d) => d.name === name)) return null;
      return await new Promise((resolve) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => { r.result.onversionchange = () => r.result.close(); resolve(r.result); };
        r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (_) {} resolve(null); };
        r.onerror = r.onblocked = () => resolve(null);
      });
    })().catch(() => null);
  }
  function get(db, store, k) {
    return new Promise((resolve) => {
      try { const r = db.transaction(store, "readonly").objectStore(store).get(k); r.onsuccess = () => resolve(r.result); r.onerror = () => resolve(null); } catch (_) { resolve(null); }
    });
  }
  async function fromDb() {
    const db = await open("model-storage");
    if (!db) return null;
    try { return db.objectStoreNames.contains("message") ? await get(db, "message", key) : null; } finally { db.close(); }
  }
  async function fromCache() {
    const db = await open("lru-media-storage-idb");
    if (!db) return null;
    try {
      for (const s of db.objectStoreNames) for (const k of [filehash, str(m.encFilehash)]) {
        const v = k ? await get(db, s, k) : null;
        if (!v) continue;
        for (const x of [v, ...(Object.getPrototypeOf(v) === Object.prototype ? Object.values(v) : [])]) { const b = await good(x); if (b) return b; }
      }
    } finally { db.close(); }
    return null;
  }
  async function direct() {
    const url = new URL(m.directPath, "https://mmg.whatsapp.net");
    if (url.protocol !== "https:" || url.host !== "mmg.whatsapp.net") return null;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 150000);
    let enc;
    try {
      const res = await fetch(url.href, { credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", cache: "no-store", signal: ctl.signal });
      if ([403, 404, 410].includes(res.status)) gone = true;
      if (!res.ok || Number(res.headers.get("content-length")) > MAX + 1024) { ctl.abort(); return null; }
      // 一边收一边数：超过上限就停（服务器没给长度也一样）
      const rd = res.body.getReader(); const parts = []; let n = 0;
      for (;;) {
        const { value, done } = await rd.read();
        if (done) break;
        n += value.length;
        if (n > MAX + 1024) { ctl.abort(); return null; }
        parts.push(value);
      }
      enc = new Uint8Array(n); let o = 0; for (const p of parts) { enc.set(p, o); o += p.length; }
    } finally { clearTimeout(t); }
    if (enc.length < 26 || enc.length > MAX + 1024) return null;
    const raw = typeof m.mediaKey === "string" ? Uint8Array.from(atob(m.mediaKey), (c) => c.charCodeAt(0)) : new Uint8Array(m.mediaKey);
    const hk = await crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveBits"]);
    const k = new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: new TextEncoder().encode(`WhatsApp ${APP} Keys`) }, hk, 112 * 8));
    const iv = k.slice(0, 16), body = enc.subarray(0, enc.length - 10), mac = enc.subarray(enc.length - 10);
    const signed = new Uint8Array(16 + body.length); signed.set(iv); signed.set(body, 16);
    const hm = new Uint8Array(await crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", k.slice(48, 80), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), signed));
    if (!mac.every((x, i) => x === hm[i])) return null;
    const aes = await crypto.subtle.importKey("raw", k.slice(16, 48), "AES-CBC", false, ["decrypt"]);
    return await good(await crypto.subtle.decrypt({ name: "AES-CBC", iv }, aes, body));
  }
}
