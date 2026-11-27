// Read-only reader: runs in the WhatsApp Web page (MAIN world).
// Injected by chrome.scripting.executeScript({ world: "MAIN", func: readWhatsApp }).
// Note: this function is turned into text and injected, so it must be self-contained and cannot use outside variables.
//
// Safety rules (must not break):
// - Only read properties, getModelsArray(), and IndexedDB readonly transactions
//   Never call anything that changes state (no send / reply / forward / delete / markSeen / sendSeen / open chat)
// - No clicks, no typing, no DOM changes
// - No network requests
// - IndexedDB: open only after confirming the database exists (open on a missing one creates it = a write), no version (no upgrade), readonly only
export async function readWhatsApp(op, params) {
  const p = params || {};
  const SYSTEM_TYPES = new Set([
    "notification_template", "e2e_notification", "gp2",
    "notification", "protocol", "ciphertext", "revoked"
  ]);
  const isSystem = (m) => !m || SYSTEM_TYPES.has(m.type) || m.isNotification === true;
  const isOfficial = (c) =>
    c?.id?._serialized === "0@c.us" ||
    c?.id?.server === "newsletter" ||
    c?.id?.server === "broadcast";
  // In newer WhatsApp Web isGroup is often false; check whether the id ends in @g.us
  const isGroupChat = (c) => c?.isGroup === true || c?.id?.server === "g.us" || /@g\.us$/.test(c?.id?._serialized || "");
  const iso = (t) => (t ? new Date(t * 1000).toISOString() : null);
  // --- textOf (keep the same in reader.js and indexer.js; tests check it) ---
  // "View once": any WhatsApp marker counts (in-memory message or raw data stored on disk; field names / types may differ)
  const isOnce = (m) => {
    if (!m || typeof m !== "object") return false;
    if (m.isViewOnce === true || m.isViewOnce === 1 || m.isViewOnce === "true" || /view_?once/i.test(String(m.type || "") + " " + String(m.subtype || ""))) return true;
    const a = m.attributes && typeof m.attributes === "object" ? m.attributes : null;
    for (const [o, keys] of [[m, Object.keys(m)], [a, a ? Object.keys(a) : []]]) {
      for (const k of keys) if (/view_?once/i.test(k)) { const v = o[k]; if (v && v !== "false" && v !== "0") return true; }
    }
    return false;
  };
  // body is real text only for these types; for photos, videos, locations it is a tiny preview picture
  const TEXT_BODY = new Set(["chat", "buttons_response", "list_response", "template_button_reply", "interactive", "interactive_response", "buttons", "list", "hsm"]);
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const clock = (sec) => { const n = Math.round(Number(sec)); return n > 0 ? Math.floor(n / 60) + ":" + String(n % 60).padStart(2, "0") : ""; };
  const vcardNames = (m) => {
    const list = Array.isArray(m.vcardList) ? m.vcardList : [];
    if (list.length) return list.map((v) => str(v?.displayName)).filter(Boolean);
    const fn = /^FN[^:\r\n]*:(.*)$/im.exec(str(m.body));
    return [str(m.vcardFormattedName) || (fn ? fn[1].trim() : "")].filter(Boolean);
  };
  const textOf = (m) => {
    if (!m) return "";
    const type = m.type || "chat";
    if (type === "chat") return m.body ? String(m.body) : m.type ? "[chat]" : "";
    const tag = (...parts) => [`[${type}]`, ...parts.map(str).filter(Boolean)].join(" ");
    if (isOnce(m)) return tag("(view once)");
    if (TEXT_BODY.has(type)) return tag(m.title, m.body || m.caption, m.footer);
    switch (type) {
      case "document": { const f = str(m.filename), c = str(m.caption); return tag(f, c !== f ? c : ""); }
      case "ptt": case "audio": case "video": case "ptv": return tag(clock(m.duration) && `(${clock(m.duration)})`, m.caption);
      case "location": return tag(str(m.loc) || (m.lat != null ? `${m.lat},${m.lng}` : ""), m.caption);
      case "vcard": case "multi_vcard": return tag(vcardNames(m).join(", "));
      case "poll_creation": return tag(m.pollName, (Array.isArray(m.pollOptions) ? m.pollOptions : []).map((o) => str(o?.name)).filter(Boolean).join(" / "));
      case "event_creation": return tag(m.eventName, m.eventDescription);
      case "call_log": return tag(m.isVideoCall ? "video call" : "voice call", String(m.callOutcome || ""), clock(m.callDuration));
      case "product": return tag(m.title, m.description);
      case "order": return tag(m.orderTitle, m.itemCount ? `${m.itemCount} items` : "", m.message);
      case "groups_v4_invite": return tag(m.inviteGrpName, m.comment);
      default: return tag(m.caption);
    }
  };
  // --- end textOf ---
  const clamp = (v, def, max) => Math.max(1, Math.min(Number(v) || def, max));
  const fail = (code, reason, extra) => Object.assign({ ok: false, code, reason }, extra || {});

  // A message id may be an object (in memory) or a string "true_<chatId>_<msgId>[_<author>]" (in the database)
  const keyStr = (m) => {
    const id = m?.id;
    if (!id) return null;
    if (typeof id === "string") return id;
    return id._serialized || null;
  };
  const fromMeOf = (m) => {
    const id = m?.id;
    if (id && typeof id === "object" && "fromMe" in id) return !!id.fromMe;
    const s = keyStr(m);
    return s ? s.startsWith("true_") : false;
  };
  const chatIdOfKey = (s) => {
    if (!s) return null;
    const parts = s.split("_");
    return parts.length >= 3 ? parts[1] : null;
  };
  const wid = (x) => (x == null ? null : typeof x === "string" ? x : x._serialized || null);

  // 1. Find WhatsApp Web's internal collections
  if (typeof window.require !== "function") {
    return fail("WA_NOT_READY", "WhatsApp Web hasn't finished loading, or its internals changed (window.require not found)");
  }
  let C;
  try {
    C = window.require("WAWebCollections");
  } catch (e) {
    return fail("WA_NO_COLLECTIONS", "Can't get WhatsApp's internal chat collection (WAWebCollections): " + (e?.message || e));
  }
  const ChatCol = C?.Chat || C?.ChatCollection;
  if (!ChatCol || typeof ChatCol.getModelsArray !== "function") {
    return fail("WA_NO_CHATS", "Chat collection not found; WhatsApp Web may have changed");
  }
  const allChats = ChatCol.getModelsArray();
  const version = (window.Debug && window.Debug.VERSION) || null;
  const nameOfChat = (c) => c.formattedTitle || c.name || c.contact?.name || c.id?.user || "(no name)";
  const chatById = new Map(allChats.map((c) => [c.id?._serialized, c]));

  // Contact names (who spoke in a group)
  let contactName = null;
  const looksLikeMe = (n) => /^(me|you|myself|我|自己|本人)$/i.test(n.normalize("NFKC").replace(/[^\p{L}]/gu, ""));
  const senderName = (m) => {
    if (fromMeOf(m)) return "Me";
    if (!contactName) {
      contactName = new Map();
      const contacts = typeof C?.Contact?.getModelsArray === "function" ? C.Contact.getModelsArray() : [];
      for (const ct of contacts) {
        // Only contact names the user saved (ct.name) are trusted; names people give themselves (pushname etc.) can be set to anything
        if (ct.id?._serialized && ct.name) contactName.set(ct.id._serialized, { n: ct.name, saved: true });
        else if (ct.id?._serialized && (ct.pushname || ct.verifiedName)) contactName.set(ct.id._serialized, { n: ct.pushname || ct.verifiedName, saved: false });
      }
    }
    const author = wid(m.author) || wid(m.from);
    const num = author ? author.split("@")[0] : "";
    const c = author && contactName.get(author);
    const n = String(c?.n || m.notifyName || m.senderObj?.pushname || "").trim().slice(0, 100);
    // "Me" is only for the user. Self-given names (which can be Me, the Chinese for "me", or look-alikes) always get the number added, so the AI can tell they are not the user
    return !n ? num : c?.saved && !looksLikeMe(n) ? n : `${n} (+${num})`;
  };

  const shapeMsg = (m) => ({
    id: keyStr(m),
    from_me: fromMeOf(m),
    sender: senderName(m),
    sender_id: fromMeOf(m) ? undefined : (wid(m.author) || wid(m.from) || undefined), // who wrote it: the number, which a name change cannot fake
    time: iso(m.t),
    type: m.type || "chat",
    text: textOf(m).slice(0, 2000),
    ...detailsOf(m)
  });

  // ---------- photos, files, voice, location, contacts ... ----------
  const MEDIA = new Set(["image", "video", "ptv", "sticker", "document", "ptt", "audio"]);
  const num = (v) => (v !== undefined && v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);
  const B64_IMAGE = /^(\/9j\/|iVBORw0KGgo|UklGR)[A-Za-z0-9+/=\r\n]+$/;
  // WhatsApp keeps a small preview picture inside the message itself
  const previewOf = (m) => {
    if (isOnce(m)) return null;
    for (const v of [m.body, m.thumbnail, m.mediaData?.preview?._b64, m.mediaObject?.contentInfo?._preview?._b64, m.mediaData?.preview]) {
      if (typeof v === "string" && v.length > 80 && v.length < 400000 && B64_IMAGE.test(v)) return v.replace(/\s/g, "");
    }
    return null;
  };
  const asBlob = (v) => {
    if (typeof Blob === "undefined" || !v) return null;
    if (v instanceof Blob) return v;
    if (v._blob instanceof Blob) return v._blob;
    return null;
  };
  // The full file, if WhatsApp Web already holds it in memory (only looks; never asks WhatsApp to download)
  const memoryBlob = (m) => asBlob(m.mediaObject?.mediaBlob) || asBlob(m.mediaData?.mediaBlob);
  const mediaOf = (m) => {
    if (!MEDIA.has(m.type)) return null;
    const once = isOnce(m);
    return {
      kind: m.type === "ptt" ? "voice message" : m.type === "ptv" ? "video message" : m.type,
      mime: str(m.mimetype).split(";")[0] || undefined,
      size_bytes: num(m.size),
      file_name: once ? undefined : str(m.filename) || undefined,
      seconds: num(m.duration),
      width: num(m.width), height: num(m.height),
      pages: num(m.pageCount),
      view_once: once || undefined,
      // quick look only; get_media also checks WhatsApp's media cache on disk
      on_this_computer: once ? "no" : memoryBlob(m) ? "full" : previewOf(m) ? "preview" : "unknown"
    };
  };
  const detailsOf = (m) => {
    const media = mediaOf(m);
    if (media) return { media };
    switch (m.type) {
      case "location": return { location: { lat: num(m.lat), lng: num(m.lng), name: str(m.loc) || undefined, live: m.isLive === true || undefined } };
      case "vcard": case "multi_vcard": {
        const cards = Array.isArray(m.vcardList) && m.vcardList.length ? m.vcardList : [{ displayName: vcardNames(m)[0], vcard: m.body }];
        return { contacts: cards.slice(0, 50).map((v) => ({
          name: str(v?.displayName) || undefined,
          phones: [...str(v?.vcard).matchAll(/^(?:item\d+\.)?TEL[^:\r\n]*:(.+)$/gim)].map((x) => x[1].trim()).slice(0, 10)
        })) };
      }
      case "poll_creation": return { poll: { question: str(m.pollName), options: (Array.isArray(m.pollOptions) ? m.pollOptions : []).map((o) => str(o?.name)).filter(Boolean).slice(0, 50) } };
      case "event_creation": return { event: { name: str(m.eventName), description: str(m.eventDescription) || undefined, start: iso(num(m.eventStartTime)), place: str(m.eventLocation?.name || m.eventLocation?.degreesLatitude && `${m.eventLocation.degreesLatitude},${m.eventLocation.degreesLongitude}`) || undefined, cancelled: m.eventIsCanceled === true || undefined } };
      default: return {};
    }
  };

  // ---------- one photo / file ----------
  const toB64 = (bytes) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const sameHash = async (bytes, want) => {
    try { return !!want && toB64(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))) === want; } catch (_) { return false; }
  };
  // WhatsApp Web's own media cache on disk. Every candidate must match the file's SHA-256, so wrong or encrypted data is never returned.
  const diskBytes = async (m, max) => {
    const want = str(m.filehash);
    if (!want || typeof indexedDB?.databases !== "function") return null;
    const name = "lru-media-storage-idb";
    if (!(await indexedDB.databases()).some((d) => d.name === name)) return null;
    const db = await new Promise((resolve) => {
      const r = indexedDB.open(name); // no version: never upgrades
      r.onsuccess = () => { r.result.onversionchange = () => r.result.close(); resolve(r.result); };
      r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (_) {} resolve(null); };
      r.onerror = r.onblocked = () => resolve(null);
    });
    if (!db) return null;
    try {
      const keys = [...new Set([want, str(m.encFilehash)].filter(Boolean))];
      for (const s of db.objectStoreNames) for (const k of keys) {
        let v = null;
        try { v = await reqP(db.transaction(s, "readonly").objectStore(s).get(k)); } catch (_) {}
        const parts = !v ? [] : [v, ...(Object.getPrototypeOf(v) === Object.prototype ? Object.values(v) : [])];
        for (const x of parts) {
          let b = null;
          if (x instanceof ArrayBuffer) b = new Uint8Array(x);
          else if (ArrayBuffer.isView(x)) b = new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
          else if (x instanceof Blob && x.size <= max) b = new Uint8Array(await x.arrayBuffer());
          if (b && b.length && b.length <= max && (await sameHash(b, want))) return b;
        }
      }
    } finally { db.close(); }
    return null;
  };
  // Shrink a picture so it fits in one AI answer (off screen; nothing on the page changes)
  // Read the size in the header before decoding: a tiny file can ask for GBs of memory (every GIF frame counts). Unknown size = no decode
  const MAX_PIXELS = 40e6;
  const imageDims = (u8) => {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const at = (sig, off = 0) => u8.length >= off + sig.length && sig.every((x, i) => u8[off + i] === x);
    try {
      if (at([0x89, 0x50, 0x4e, 0x47]) && u8.length >= 24) return { w: dv.getUint32(16), h: dv.getUint32(20) };
      if (at([0x47, 0x49, 0x46, 0x38]) && u8.length >= 13) {
        let w = dv.getUint16(6, true), h = dv.getUint16(8, true);
        let i = 13 + (u8[10] & 0x80 ? 3 * (2 << (u8[10] & 7)) : 0);
        for (let n = 0; i < u8.length && n < 4096; n++) {
          if (u8[i] === 0x2c) {
            if (i + 10 > u8.length) break;
            w = Math.max(w, dv.getUint16(i + 1, true) + dv.getUint16(i + 5, true)); h = Math.max(h, dv.getUint16(i + 3, true) + dv.getUint16(i + 7, true));
            const f = u8[i + 9]; i += 10 + (f & 0x80 ? 3 * (2 << (f & 7)) : 0) + 1;
            while (i < u8.length && u8[i]) i += u8[i] + 1;
            i++;
          } else if (u8[i] === 0x21) { i += 2; while (i < u8.length && u8[i]) i += u8[i] + 1; i++; }
          else break;
        }
        return { w, h };
      }
      if (at([0x42, 0x4d]) && u8.length >= 26) return { w: Math.abs(dv.getInt32(18, true)), h: Math.abs(dv.getInt32(22, true)) };
      if (at([0x52, 0x49, 0x46, 0x46]) && at([0x57, 0x45, 0x42, 0x50], 8) && u8.length >= 30) {
        const k = String.fromCharCode(u8[12], u8[13], u8[14], u8[15]);
        if (k === "VP8 ") return { w: dv.getUint16(26, true) & 0x3fff, h: dv.getUint16(28, true) & 0x3fff };
        if (k === "VP8L") { const x = dv.getUint32(21, true); return { w: (x & 0x3fff) + 1, h: ((x >> 14) & 0x3fff) + 1 }; }
        if (k === "VP8X") return { w: (u8[24] | (u8[25] << 8) | (u8[26] << 16)) + 1, h: (u8[27] | (u8[28] << 8) | (u8[29] << 16)) + 1 };
      }
      if (at([0xff, 0xd8, 0xff])) {
        for (let i = 2; i + 9 < u8.length;) {
          if (u8[i] !== 0xff) { i++; continue; }
          const mk = u8[i + 1];
          if (mk === 0xd8 || mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7) || mk === 0xff) { i++; continue; }
          if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return { w: dv.getUint16(i + 7), h: dv.getUint16(i + 5) };
          i += 2 + dv.getUint16(i + 2);
        }
      }
    } catch (_) {}
    return null;
  };
  const smallImage = async (blob) => {
    const d = imageDims(new Uint8Array(await blob.arrayBuffer()));
    if (!d || !(d.w > 0 && d.h > 0 && d.w * d.h <= MAX_PIXELS)) return null;
    const bmp = await createImageBitmap(blob);
    try {
      for (const [side, q] of [[1568, 0.85], [1568, 0.7], [1100, 0.7], [800, 0.6]]) {
        const f = Math.min(1, side / Math.max(bmp.width, bmp.height));
        const cv = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * f)), Math.max(1, Math.round(bmp.height * f)));
        const g = cv.getContext("2d");
        g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); // stickers are transparent
        g.drawImage(bmp, 0, 0, cv.width, cv.height);
        const out = await cv.convertToBlob({ type: "image/jpeg", quality: q });
        if (out.size <= 500000) return { mime: "image/jpeg", data: toB64(new Uint8Array(await out.arrayBuffer())), width: cv.width, height: cv.height };
      }
    } finally { bmp.close(); }
    return null;
  };
  const getMedia = async (id) => {
    const key = String(id || "").trim();
    const chat = chatById.get(chatIdOfKey(key));
    let m = chat ? loadedMsgs(chat).find((x) => keyStr(x) === key) : null;
    if (!m) {
      const db = await openModelStorage();
      if (db && db.objectStoreNames.contains("message")) try { m = await reqP(db.transaction("message", "readonly").objectStore("message").get(key)); } catch (_) {}
    }
    if (!m || isSystem(m)) return fail("MESSAGE_NOT_FOUND", "No message with this id on this computer. Use the id from get_messages or search_messages.");
    const out = { ok: true, chat: chat ? { id: chat.id?._serialized, name: nameOfChat(chat), is_group: isGroupChat(chat) } : null, message: shapeMsg(m), content: "none" };
    const media = out.message.media;
    if (!media) return Object.assign(out, { note: "This message has no photo or file; everything in it is shown above." });
    if (media.view_once) return Object.assign(out, { note: "View-once message: not read, on purpose." });
    const image = /^image\//.test(media.mime || "") || m.type === "image" || m.type === "sticker";
    if (m.type === "ptt" || m.type === "audio") return Object.assign(out, { note: "Voice / audio: only its details can be given. AI cannot listen to it here, so do not guess what was said. download_media can save the sound file." });
    const MAX = 25 * 1024 * 1024;
    let blob = null;
    if (m.type !== "video" && m.type !== "ptv") {
      blob = memoryBlob(m);
      if (blob && blob.size > MAX) blob = null;
      if (!blob) { const b = await diskBytes(m, MAX).catch(() => null); if (b) blob = new Blob([b], { type: media.mime || "" }); }
    }
    if (blob && image) {
      try { const pic = await smallImage(blob); if (pic) return Object.assign(out, { content: "full", image: pic }); } catch (_) {}
    } else if (blob) {
      media.on_this_computer = "full";
      if (/^text\/|[/+](json|xml|csv)$/.test(media.mime || "") || /\.(txt|csv|md|json|xml|log|vcf|ics)$/i.test(media.file_name || "")) {
        const t = await blob.text();
        return Object.assign(out, { content: "full", file_text: t.slice(0, 100000), note: t.length > 100000 ? "Only the first 100,000 characters are included." : undefined });
      }
      if (blob.size <= 500000) return Object.assign(out, { content: "full", file: { mime: media.mime || "application/octet-stream", name: media.file_name || "file", data: toB64(new Uint8Array(await blob.arrayBuffer())) } });
      out.note = "The file is on this computer but too big for one AI answer (limit 500 KB). download_media can save it as a file.";
    }
    const pv = previewOf(m);
    if (pv) {
      const mime = pv.startsWith("iVBOR") ? "image/png" : pv.startsWith("UklGR") ? "image/webp" : "image/jpeg";
      return Object.assign(out, { content: "preview", image: { mime, data: pv },
        note: [out.note, "Only a small, blurry preview is available" + (m.type === "video" || m.type === "ptv" ? " (a still from the video; AI cannot watch it here)" : "; the full file is not on this computer; use download_media if the user wants it") + ". Do not guess details you cannot see."].filter(Boolean).join(" ") });
    }
    out.note = out.note || "The file is not on this computer. If the user wants it, use download_media.";
    return out;
  };

  // ---------- IndexedDB (read-only) ----------
  let dbPromise = null;
  const openModelStorage = () => {
    if (dbPromise) return dbPromise;
    dbPromise = (async () => {
      if (typeof indexedDB?.databases !== "function") return null;
      const list = await indexedDB.databases();
      if (!list.some((d) => d.name === "model-storage")) return null;
      return await new Promise((resolve) => {
        const r = indexedDB.open("model-storage"); // no version: no upgrade
        r.onsuccess = () => {
          const db = r.result;
          db.onversionchange = () => db.close(); // step aside at once when WhatsApp wants to upgrade
          resolve(db);
        };
        r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (_) {} resolve(null); };
        r.onerror = () => resolve(null);
        r.onblocked = () => resolve(null);
      });
    })().catch(() => null);
    return dbPromise;
  };
  const closeDb = async () => { const db = await dbPromise; try { db && db.close(); } catch (_) {} };
  const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  // Does the message store use "true_/false_<chatId>_..." string keys? If so, an empty range result
  // really means "no messages stored", and the slow full scan is pointless.
  let keyStyle = null;
  const fastKeysWork = async (store) => {
    if (keyStyle !== null) return keyStyle;
    try {
      const cur = await reqP(store.openKeyCursor ? store.openKeyCursor() : store.openCursor());
      keyStyle = !!(cur && typeof cur.key === "string" && /^(true|false)_/.test(cur.key));
    } catch (_) { keyStyle = false; }
    return keyStyle;
  };
  const idbForChat = async (chatId, max, allowScan = true) => {
    const db = await openModelStorage();
    if (!db || !db.objectStoreNames.contains("message")) return { available: false, msgs: [] };
    const store = db.transaction("message", "readonly").objectStore("message");
    let out = [];
    // Fast path: use a range query when the key is a "true_/false_<chatId>_..." string
    for (const pre of ["false_" + chatId + "_", "true_" + chatId + "_"]) {
      try {
        out = out.concat(await reqP(store.getAll(IDBKeyRange.bound(pre, pre + "\uffff"))));
      } catch (_) {}
    }
    if (!out.length && allowScan && !(await fastKeysWork(db.transaction("message", "readonly").objectStore("message")))) {
      // Slow path: scan one by one (capped); needed only when the key is not in that format
      out = await scanStore(db, (rec) => chatIdOfKey(keyStr(rec)) === chatId || wid(rec.id?.remote) === chatId, 50000, max * 5);
    }
    return { available: true, msgs: out };
  };

  const scanStore = async (db, pred, maxSteps, maxHits) => {
    const store = db.transaction("message", "readonly").objectStore("message");
    const hits = [];
    let steps = 0;
    await new Promise((resolve) => {
      // Scan newest to oldest (prev) so newer messages come first
      const cur = store.openCursor(null, "prev");
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c || ++steps > maxSteps || hits.length >= maxHits) return resolve();
        try { if (pred(c.value)) hits.push(c.value); } catch (_) {}
        c.continue();
      };
      cur.onerror = () => resolve();
    });
    return hits;
  };

  const loadedMsgs = (c) => (typeof c?.msgs?.getModelsArray === "function" ? c.msgs.getModelsArray() : []);
  const lastReal = (arr) => {
    let best = null;
    for (const m of arr) if (!isSystem(m) && (!best || (m.t || 0) >= (best.t || 0))) best = m;
    return best;
  };

  const chatRow = (c) => {
    const last = lastReal(loadedMsgs(c));
    const unread = c.unreadCount > 0 ? c.unreadCount : 0;
    const official = isOfficial(c);
    let awaiting = null;
    if (official) awaiting = false;
    else if (unread > 0) awaiting = true;
    else if (last) awaiting = !fromMeOf(last);
    return {
      id: c.id?._serialized || null,
      name: nameOfChat(c),
      is_group: isGroupChat(c),
      is_official: official,
      archived: !!c.archive,
      pinned: !!c.pin,
      unread,
      last_time: iso(c.t),
      last_preview: last ? textOf(last).slice(0, 200) : null,
      last_from_me: last ? fromMeOf(last) : null,
      awaiting_my_reply: awaiting,
      _last: last
    };
  };
  const strip = (r) => { const { _last, ...rest } = r; return rest; };
  const byTimeDesc = (a, b) => (b.last_time || "").localeCompare(a.last_time || "");

  const resolveChat = (q) => {
    const s = String(q || "").trim();
    if (!s) return { error: fail("BAD_PARAM", "Give a chat name or chat id") };
    if (chatById.has(s)) return { chat: chatById.get(s) };
    const low = s.toLowerCase();
    // Others can set names (group names): use a name only if exactly one chat matches; an exact match plus other chats containing the name = ask
    const part = allChats.filter((c) => nameOfChat(c).toLowerCase().includes(low));
    if (part.length === 1) return { chat: part[0] };
    if (!part.length) return { error: fail("CHAT_NOT_FOUND", `No chat name contains \"${s}\"`) };
    // Exact-name matches go first and are always listed (never pushed out by the 15 limit); add number / contact status so the user can tell them apart
    const exact = part.filter((c) => nameOfChat(c).toLowerCase() === low);
    const rest = part.filter((c) => !exact.includes(c));
    const list = exact.concat(rest).slice(0, Math.max(15, exact.length));
    return {
      error: fail("CHAT_AMBIGUOUS", `${part.length} chats match \"${s}\"${exact.length ? ` (${exact.length} with exactly this name)` : ""}; ask the user which one and use its id. Chat names can be set by other people.`, {
        candidates: list.map((c) => ({ id: c.id?._serialized, name: nameOfChat(c), is_group: isGroupChat(c), exact_name: exact.includes(c),
          phone: isGroupChat(c) ? null : (c.id?.server === "c.us" ? "+" + c.id.user : null), saved_contact: !!c.contact?.name || !!c.contact?.isMyContact }))
      })
    };
  };

  try {
    // Which chat is open on screen now (read-only property)
    if (op === "active_chat") {
      let a = null;
      try { a = typeof ChatCol.getActive === "function" ? ChatCol.getActive() : null; } catch (_) {}
      if (!a) a = allChats.find((c) => c.active === true) || null;
      return { ok: true, chat: a ? { id: a.id?._serialized, name: nameOfChat(a), is_group: isGroupChat(a) } : null };
    }

    // Turn a name / id into one definite chat (for saving drafts)
    if (op === "resolve_chat") {
      const r = resolveChat(p.chat);
      if (r.error) return r.error;
      const c = r.chat;
      return { ok: true, chat: { id: c.id?._serialized, name: nameOfChat(c), is_group: isGroupChat(c) } };
    }

    if (op === "status") {
      return { ok: true, wa_version: version, logged_in_guess: allChats.length > 0, total_chats: allChats.length };
    }

    if (op === "list_chats") {
      const limit = clamp(p.limit, 200, 500);
      const kw = String(p.keyword || "").trim().toLowerCase();
      let rows = allChats.map(chatRow);
      if (!p.include_archived) rows = rows.filter((r) => !r.archived);
      if (p.unread_only) rows = rows.filter((r) => r.unread > 0);
      if (p.groups_only) rows = rows.filter((r) => r.is_group);
      if (kw) rows = rows.filter((r) => r.name.toLowerCase().includes(kw) || (r.last_preview || "").toLowerCase().includes(kw));
      rows.sort(byTimeDesc);
      return {
        ok: true, read_at: new Date().toISOString(), wa_version: version,
        total_chats: allChats.length, matched: rows.length,
        count: Math.min(rows.length, limit), chats: rows.slice(0, limit).map(strip)
      };
    }

    if (op === "get_messages") {
      const limit = clamp(p.limit, 20, 100);
      const r = resolveChat(p.chat);
      if (r.error) return r.error;
      const c = r.chat;
      const chatId = c.id?._serialized;
      const mem = loadedMsgs(c);
      const idb = await idbForChat(chatId, limit);
      const seen = new Map();
      for (const m of idb.msgs) { const k = keyStr(m); if (k) seen.set(k, m); }
      for (const m of mem) { const k = keyStr(m); if (k) seen.set(k, m); } // in-memory copies are newer, so they win
      const real = [...seen.values()].filter((m) => !isSystem(m)).sort((a, b) => (a.t || 0) - (b.t || 0));
      const msgs = real.slice(-limit).map(shapeMsg);
      return {
        ok: true,
        chat: { id: chatId, name: nameOfChat(c), is_group: isGroupChat(c), unread: c.unreadCount > 0 ? c.unreadCount : 0 },
        count: msgs.length,
        source: { in_memory: mem.length, local_db: idb.available ? idb.msgs.length : "local database not readable" },
        note: msgs.length < limit
          ? "This is all WhatsApp Web has stored on this computer; older messages are only on the phone (the chat is not opened to load more, to avoid blue ticks)"
          : undefined,
        messages: msgs
      };
    }

    if (op === "get_media") return await getMedia(p.message_id);

    if (op === "search_messages") {
      const kw = String(p.keyword || "").trim().toLowerCase();
      if (!kw) return fail("BAD_PARAM", "Give a search keyword");
      const limit = clamp(p.limit, 30, 100);
      const hits = new Map();
      const match = (m) => !isSystem(m) && textOf(m).toLowerCase().includes(kw);
      for (const c of allChats) for (const m of loadedMsgs(c)) if (match(m)) hits.set(keyStr(m), m);
      const db = await openModelStorage();
      let scanned = "local database not readable";
      if (db && db.objectStoreNames.contains("message")) {
        const found = await scanStore(db, match, 50000, limit * 3);
        for (const m of found) { const k = keyStr(m); if (k && !hits.has(k)) hits.set(k, m); }
        scanned = "searched";
      }
      const list = [...hits.values()].sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, limit).map((m) => {
        const cid = (m.id && typeof m.id === "object" && wid(m.id.remote)) || chatIdOfKey(keyStr(m));
        const c = chatById.get(cid);
        return Object.assign(shapeMsg(m), { chat_id: cid, chat_name: c ? nameOfChat(c) : cid, is_group: c ? isGroupChat(c) : null });
      });
      return { ok: true, keyword: p.keyword, count: list.length, local_db: scanned, results: list };
    }

    if (op === "list_awaiting_reply") {
      const limit = clamp(p.limit, 50, 200);
      const includeGroups = p.include_groups !== false;
      let rows = allChats.filter((c) => !c.archive && !isOfficial(c)).map(chatRow);
      // No real messages and no unread ones in memory: look up the last one in the local database
      let unknown = 0;
      // Look up at most 150 chats in the local database, newest first, within ~5 s, so 500+ chats stay fast
      rows.sort(byTimeDesc);
      const started = Date.now();
      let looked = 0;
      for (const r of rows) {
        if (r.awaiting_my_reply !== null) continue;
        if (looked >= 150 || Date.now() - started > 5000) { unknown++; continue; }
        looked++;
        const idb = await idbForChat(r.id, 5, false);
        const last = lastReal(idb.msgs);
        if (last) { r._last = last; r.awaiting_my_reply = !fromMeOf(last); }
        else unknown++;
      }
      rows = rows.filter((r) => r.awaiting_my_reply === true && (includeGroups || !r.is_group));
      rows.sort(byTimeDesc);
      const now = Date.now();
      const out = rows.slice(0, limit).map((r) => {
        const last = r._last;
        const theirTime = last && !fromMeOf(last) ? last.t : null;
        const since = theirTime || (r.last_time ? new Date(r.last_time).getTime() / 1000 : null);
        return {
          id: r.id, name: r.name, is_group: r.is_group, unread: r.unread,
          last: iso(last?.t) || r.last_time,
          their_last_message: last && !fromMeOf(last) ? textOf(last).slice(0, 500) : null,
          their_last_sender: last && !fromMeOf(last) ? senderName(last) : null,
          since: iso(since),
          waiting_hours: since ? Math.round(((now / 1000 - since) / 3600) * 10) / 10 : null
        };
      });
      return {
        ok: true, count: out.length, unknown_chats: unknown,
        note: unknown ? `${unknown} chats have no messages stored on this computer, so they can't be judged and are not counted` : undefined,
        chats: out
      };
    }

    // Dashboard stats: use only messages already loaded in memory, return numbers only (no message content)
    if (op === "stats") {
      const now = Date.now() / 1000;
      const DAY = 86400;
      const days = Math.max(7, Math.min(Number(p.days) || 14, 30));
      const dayKey = (t) => { const d = new Date(t * 1000); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
      const daily = new Map();
      for (let i = days - 1; i >= 0; i--) daily.set(dayKey(now - i * DAY), { date: dayKey(now - i * DAY), received: 0, sent: 0 });
      const hours = Array.from({ length: 24 }, () => 0);
      const replyMins = [];
      const perChat = [];
      let loaded = 0, oldest = null;
      let unreadChats = 0, unreadMsgs = 0, groups = 0, people = 0;
      const waiting = [];
      for (const c of allChats) {
        if (isOfficial(c) || c.archive) continue;
        const grp = isGroupChat(c);
        grp ? groups++ : people++;
        if (c.unreadCount > 0) { unreadChats++; unreadMsgs += c.unreadCount; }
        const arr = loadedMsgs(c).filter((m) => !isSystem(m) && m.t).sort((a, b) => a.t - b.t);
        loaded += arr.length;
        if (arr.length && (oldest === null || arr[0].t < oldest)) oldest = arr[0].t;
        let inW = 0, outW = 0, runStart = null;
        for (const m of arr) {
          const mine = fromMeOf(m);
          if (m.t >= now - days * DAY) {
            const row = daily.get(dayKey(m.t));
            if (row) mine ? row.sent++ : row.received++;
          }
          if (m.t >= now - 30 * DAY && !mine) hours[new Date(m.t * 1000).getHours()]++;
          if (m.t >= now - 7 * DAY) mine ? outW++ : inW++;
          if (!grp) {
            if (!mine && runStart === null) runStart = m.t;
            else if (mine && runStart !== null) {
              if (m.t >= now - 30 * DAY) replyMins.push((m.t - runStart) / 60);
              runStart = null;
            }
          }
        }
        if (inW + outW) perChat.push({ id: c.id?._serialized, name: nameOfChat(c), is_group: grp, received: inW, sent: outW });
        const last = arr[arr.length - 1];
        const waitingNow = c.unreadCount > 0 || (last && !fromMeOf(last));
        if (waitingNow && !grp) {
          let since = null;
          for (let i = arr.length - 1; i >= 0 && !fromMeOf(arr[i]); i--) since = arr[i].t;
          since = since || c.t || null;
          if (since) waiting.push({ id: c.id?._serialized, name: nameOfChat(c), since: iso(since), last: iso(last?.t || c.t), waiting_hours: Math.round(((now - since) / 3600) * 10) / 10, unread: c.unreadCount > 0 ? c.unreadCount : 0 });
        }
      }
      replyMins.sort((a, b) => a - b);
      const q = (f) => (replyMins.length ? Math.round(replyMins[Math.min(replyMins.length - 1, Math.floor(f * replyMins.length))]) : null);
      waiting.sort((a, b) => b.waiting_hours - a.waiting_hours);
      perChat.sort((a, b) => b.received + b.sent - (a.received + a.sent));
      return {
        ok: true, read_at: new Date().toISOString(), wa_version: version,
        totals: { chats: groups + people, people, groups, unread_chats: unreadChats, unread_messages: unreadMsgs,
          waiting_people: waiting.length, waiting_over_24h: waiting.filter((w) => w.waiting_hours >= 24).length },
        daily: [...daily.values()],
        hours_received_30d: hours,
        reply_minutes_30d: { count: replyMins.length, median: q(0.5), p90: q(0.9) },
        top_chats_7d: perChat.slice(0, 8),
        waiting_longest: waiting.slice(0, 200),
        coverage: { loaded_messages: loaded, oldest_loaded: iso(oldest) }
      };
    }

    return fail("BAD_OP", "Unknown read command: " + op);
  } finally {
    await closeDb();
  }
}
