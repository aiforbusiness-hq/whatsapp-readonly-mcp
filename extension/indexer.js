// Live chat index. Runs inside the WhatsApp Web page (MAIN world), read-only.
//
// Design (work only ever proportional to what CHANGED, never to the total number of chats):
// - One summary per chat, recomputed only when that chat changes. Changes come from WhatsApp's own
//   collection events when available; a cheap full signature sweep runs once a minute as a safety net.
// - Totals (chats, unread, waiting, daily / hourly message counts, reply times) are kept as running
//   aggregates: when a chat changes, its old contribution is subtracted and the new one added.
// - The extension receives DELTAS: only the changed chat summaries + removed ids, plus a small
//   "meta" (totals, stats, the waiting list, the 100 most recent chats). Every chat is kept (no cap);
//   screens read the small meta to open instantly and read individual chats only when needed.
//
// Safety: only reads model properties and does readonly IndexedDB lookups. Never sends, opens chats,
// marks as read, clicks, or makes network requests.
(() => {
  if (window.__abWaIndexer) return;
  window.__abWaIndexer = true;

  const CHANNEL = "ab-wa-index-v2";
  const TICK_MS = 2000;          // flush pending changes
  const SWEEP_MS = 60000;        // safety-net full signature sweep
  const HEARTBEAT_MS = 20000;    // let the extension know the index is alive
  const RECENT_DAYS = 30;
  const RECENT_N = 100;          // most recent chats kept in meta for instant open
  let autoIgnoreDays = 0;        // setting: waits older than this count as "no reply needed" (0 = off)
  const IDB_PER_TICK = 8;        // background fill-in for chats with nothing loaded in memory

  const SYSTEM_TYPES = new Set(["notification_template", "e2e_notification", "gp2", "notification", "protocol", "ciphertext", "revoked"]);
  const isSystem = (m) => !m || SYSTEM_TYPES.has(m.type) || m.isNotification === true;
  const isOfficial = (c) => c?.id?._serialized === "0@c.us" || c?.id?.server === "newsletter" || c?.id?.server === "broadcast";
  const isGroupChat = (c) => c?.isGroup === true || c?.id?.server === "g.us" || /@g\.us$/.test(c?.id?._serialized || "");
  const iso = (t) => (t ? new Date(t * 1000).toISOString() : null);
  const keyStr = (m) => { const id = m?.id; if (!id) return null; return typeof id === "string" ? id : id._serialized || null; };
  const fromMeOf = (m) => {
    const id = m?.id;
    if (id && typeof id === "object" && "fromMe" in id) return !!id.fromMe;
    const s = keyStr(m);
    return s ? s.startsWith("true_") : false;
  };
  // --- textOf (keep the same in reader.js and indexer.js; tests check it) ---
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
  const nameOfChat = (c) => c.formattedTitle || c.name || c.contact?.name || c.id?.user || "(no name)";
  const loadedMsgs = (c) => { try { return typeof c?.msgs?.getModelsArray === "function" ? c.msgs.getModelsArray() : []; } catch (_) { return []; } };
  const dayKey = (t) => { const d = new Date(t * 1000); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

  let C = null, ChatCol = null, hasEvents = false;
  const connect = () => {
    if (ChatCol) return ChatCol;
    try { if (typeof window.require === "function") C = window.require("WAWebCollections"); } catch (_) { C = null; }
    const col = C?.Chat || C?.ChatCollection;
    if (!col || typeof col.getModelsArray !== "function") return null;
    ChatCol = col;
    // Event-driven: mark only the chats WhatsApp says changed
    try {
      if (typeof col.on === "function") {
        hasEvents = true;
        col.on("change", (c) => markDirty(c));
        col.on("add", (c) => markDirty(c));
        col.on("remove", (c) => { const id = c?.id?._serialized; if (id) removed.add(id); });
      }
    } catch (_) {}
    return ChatCol;
  };

  let contactNames = null, contactsAt = 0;
  const senderName = (m) => {
    if (fromMeOf(m)) return "Me";
    if (!contactNames || Date.now() - contactsAt > 300000) {
      contactNames = new Map(); contactsAt = Date.now();
      try {
        for (const ct of C?.Contact?.getModelsArray?.() || []) {
          // 只有用户自己存的联系人名字（ct.name）可信；对方自己取的名字谁都可以改
          if (ct.id?._serialized && ct.name) contactNames.set(ct.id._serialized, { n: ct.name, saved: true });
          else if (ct.id?._serialized && (ct.pushname || ct.verifiedName)) contactNames.set(ct.id._serialized, { n: ct.pushname || ct.verifiedName, saved: false });
        }
      } catch (_) {}
    }
    const w = (x) => (x == null ? null : typeof x === "string" ? x : x._serialized || null);
    const author = w(m.author) || w(m.from);
    const num = author ? author.split("@")[0] : "";
    const c = author && contactNames.get(author);
    const n = String(c?.n || m.notifyName || "").trim().slice(0, 100);
    // 「Me」只给用户自己。对方自己取的名字一律加上号码
    const looksLikeMe = /^(me|you|myself|我|自己|本人)$/i.test(n.normalize("NFKC").replace(/[^\p{L}]/gu, ""));
    return !n ? num : c?.saved && !looksLikeMe ? n : `${n} (+${num})`;
  };

  // ---------- per-chat summary ----------
  const idbLast = new Map(); // id -> { t, last }
  const sigOf = (c) => {
    const id = c.id?._serialized;
    let n = 0; try { n = c.msgs?.length ?? 0; } catch (_) {}
    const k = idbLast.get(id);
    return `${c.t}|${c.unreadCount}|${n}|${c.archive ? 1 : 0}|${c.pin ? 1 : 0}|${c.formattedTitle || c.name || ""}|${k ? k.t + ":" + (k.last ? k.last.t : 0) : ""}`;
  };

  function summarize(c) {
    const id = c.id?._serialized;
    const official = isOfficial(c);
    const group = isGroupChat(c);
    const unread = c.unreadCount > 0 ? c.unreadCount : 0;
    const arr = loadedMsgs(c).filter((m) => !isSystem(m) && m.t).sort((a, b) => a.t - b.t);
    const last = arr[arr.length - 1] || null;
    let lastInfo = last ? { t: last.t, mine: fromMeOf(last), text: textOf(last).slice(0, 300), sender: group && !fromMeOf(last) ? senderName(last) : null } : null;
    if (!lastInfo) { const k = idbLast.get(id); if (k && k.t === c.t && k.last) lastInfo = k.last; }

    let awaiting = null;
    if (official) awaiting = false;
    else if (unread > 0) awaiting = true;
    else if (lastInfo) awaiting = !lastInfo.mine;

    let since = null;
    for (let i = arr.length - 1; i >= 0 && !fromMeOf(arr[i]); i--) since = arr[i].t;
    if (!since && awaiting) since = lastInfo?.t || c.t || null;

    const cutoff = Date.now() / 1000 - RECENT_DAYS * 86400;
    const recent = [], replies = [];
    let runStart = null;
    for (const m of arr) {
      const mine = fromMeOf(m);
      if (m.t >= cutoff) recent.push([m.t, mine ? 1 : 0]);
      if (!group) {
        if (!mine && runStart === null) runStart = m.t;
        else if (mine && runStart !== null) { if (m.t >= cutoff) replies.push([m.t, (m.t - runStart) / 60]); runStart = null; }
      }
    }
    return {
      t: c.t || 0,
      row: {
        id, name: nameOfChat(c), is_group: group, is_official: official, archived: !!c.archive, pinned: !!c.pin,
        unread, last_time: iso(c.t),
        last_preview: lastInfo ? lastInfo.text.slice(0, 200) : null,
        last_from_me: lastInfo ? lastInfo.mine : null,
        awaiting_my_reply: awaiting,
        their_last_message: lastInfo && !lastInfo.mine ? lastInfo.text : null,
        their_last_sender: lastInfo && !lastInfo.mine ? lastInfo.sender : null,
        since: iso(since), last: iso(lastInfo?.t || c.t),
        loaded: arr.length, oldest_loaded: arr.length ? arr[0].t : null
      },
      recent, replies
    };
  }

  // ---------- running aggregates (delta add / subtract) ----------
  const cache = new Map();          // id -> { sig, t, row, recent, replies }
  const daily = new Map();          // dayKey -> [received, sent]
  const hourly = new Map();         // dayKey -> Int32Array(24) received per hour
  const counters = { groups: 0, people: 0, unreadChats: 0, unreadMsgs: 0, unknown: 0, loaded: 0 };
  // Waiting lists kept sorted by "since" (oldest first) so the longest-waiting are always at the front.
  // Insert / remove is a binary search; reading the first 100 or counting "> 24 h" never scans everything.
  const waitAll = [], waitPeople = []; // [since(ms), id]
  const bsearch = (arr, v) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m][0] < v) lo = m + 1; else hi = m; } return lo; };
  const wAdd = (arr, since, id) => { arr.splice(bsearch(arr, since), 0, [since, id]); };
  const wDel = (arr, since, id) => { for (let i = bsearch(arr, since); i < arr.length && arr[i][0] === since; i++) if (arr[i][1] === id) { arr.splice(i, 1); return; } };
  const activeIds = new Set();      // chats with messages in the last 30 days (for top chats / replies)
  const counted = (row) => !row.is_official && !row.archived;

  function contribute(e, sign) {
    const r = e.row;
    if (!counted(r)) return;
    r.is_group ? (counters.groups += sign) : (counters.people += sign);
    if (r.unread) { counters.unreadChats += sign; counters.unreadMsgs += sign * r.unread; }
    if (r.awaiting_my_reply === null) counters.unknown += sign;
    counters.loaded += sign * r.loaded;
    for (const [t, mine] of e.recent) {
      const k = dayKey(t);
      let d = daily.get(k); if (!d) { d = [0, 0]; daily.set(k, d); }
      d[mine ? 1 : 0] += sign;
      if (!mine) { let h = hourly.get(k); if (!h) { h = new Int32Array(24); hourly.set(k, h); } h[new Date(t * 1000).getHours()] += sign; }
    }
    if (r.awaiting_my_reply === true && r.since) {
      const since = Date.parse(r.since);
      if (sign > 0) { wAdd(waitAll, since, r.id); if (!r.is_group) wAdd(waitPeople, since, r.id); }
      else { wDel(waitAll, since, r.id); if (!r.is_group) wDel(waitPeople, since, r.id); }
    }
    if (sign > 0) { if (e.recent.length || e.replies.length) activeIds.add(r.id); }
    else activeIds.delete(r.id);
  }

  // ---------- 100 most recent chats (amortised O(1): a chat's time only moves forward) ----------
  let recentIds = [];
  function touchRecent(id, t) {
    const i = recentIds.indexOf(id);
    if (i >= 0) recentIds.splice(i, 1);
    if (recentIds.length < RECENT_N || t > (cache.get(recentIds[recentIds.length - 1])?.t || 0)) {
      let j = recentIds.findIndex((x) => (cache.get(x)?.t || 0) < t);
      if (j < 0) j = recentIds.length;
      recentIds.splice(j, 0, id);
      if (recentIds.length > RECENT_N) recentIds.length = RECENT_N;
    }
  }
  function refillRecent() { // only after removals or the periodic sweep
    recentIds = [...cache.entries()].sort((a, b) => b[1].t - a[1].t).slice(0, RECENT_N).map(([id]) => id);
  }

  // ---------- change tracking ----------
  const dirty = new Map();  // id -> chat model
  const removed = new Set();
  const markDirty = (c) => { const id = c?.id?._serialized; if (id) dirty.set(id, c); };
  let lastSweep = 0, lastPost = 0, firstPost = true, needRefill = false;
  let pendingUpserts = new Map(), pendingRemoves = new Set();

  function apply(id, c) {
    const sig = sigOf(c);
    const old = cache.get(id);
    if (old && old.sig === sig) return;
    const s = summarize(c);
    if (old) contribute(old, -1);
    const e = { sig, ...s };
    cache.set(id, e);
    contribute(e, +1);
    touchRecent(id, e.t);
    pendingUpserts.set(id, e.row);
  }

  function sweep() { // cheap signature pass over all chats, once a minute (and at start)
    let chats; try { chats = ChatCol.getModelsArray(); } catch (_) { return; }
    const seen = new Set();
    for (const c of chats) { const id = c.id?._serialized; if (!id) continue; seen.add(id); if (cache.get(id)?.sig !== sigOf(c)) dirty.set(id, c); }
    for (const id of cache.keys()) if (!seen.has(id)) removed.add(id);
    lastSweep = Date.now();
  }

  // ---------- meta (small; built from aggregates, never by scanning all chats) ----------
  // Reply-time and top-chat stats change slowly: recompute at most once a minute (or when asked)
  let slow = null, slowAt = 0;
  function slowStats(force) {
    if (slow && !force && Date.now() - slowAt < 60000) return slow;
    const now = Date.now() / 1000, cutoff = now - RECENT_DAYS * 86400, cutoff7 = now - 7 * 86400;
    const replyMins = [], top = [];
    for (const id of activeIds) {
      const e = cache.get(id); if (!e || !counted(e.row)) continue;
      for (const [t, mins] of e.replies) if (t >= cutoff) replyMins.push(mins);
      let inW = 0, outW = 0;
      for (const [t, mine] of e.recent) if (t >= cutoff7) mine ? outW++ : inW++;
      if (inW + outW) top.push({ id, name: e.row.name, is_group: e.row.is_group, received: inW, sent: outW });
    }
    replyMins.sort((a, b) => a - b);
    const q = (f) => (replyMins.length ? Math.round(replyMins[Math.min(replyMins.length - 1, Math.floor(f * replyMins.length))]) : null);
    top.sort((a, b) => b.received + b.sent - (a.received + a.sent));
    slow = { reply: { count: replyMins.length, median: q(0.5), p90: q(0.9) }, top: top.slice(0, 8) };
    slowAt = Date.now();
    return slow;
  }

  const waitEntry = (id, now) => {
    const r = cache.get(id)?.row; if (!r) return null;
    return { id, name: r.name, is_group: r.is_group, since: r.since, last: r.last, unread: r.unread,
      their_last_message: r.their_last_message, their_last_sender: r.their_last_sender,
      waiting_hours: Math.round(((now - Date.parse(r.since) / 1000) / 3600) * 10) / 10 };
  };

  // Small and fixed-size: built from running aggregates, never by scanning all chats
  function buildMeta(forceSlow) {
    const now = Date.now() / 1000;
    const days14 = [];
    for (let i = 13; i >= 0; i--) { const k = dayKey(now - i * 86400); const d = daily.get(k) || [0, 0]; days14.push({ date: k, received: d[0], sent: d[1] }); }
    const hours = Array.from({ length: 24 }, () => 0);
    for (let i = 0; i < 30; i++) { const h = hourly.get(dayKey(now - i * 86400)); if (h) for (let x = 0; x < 24; x++) hours[x] += h[x]; }
    for (const k of daily.keys()) if (k < dayKey(now - 40 * 86400)) { daily.delete(k); hourly.delete(k); }
    const s = slowStats(forceSlow);
    // Auto "no reply needed": the lists are sorted oldest-first, so waits older than the cut-off are
    // simply a prefix we skip (binary search, no scan)
    const cut = autoIgnoreDays > 0 ? (now - autoIgnoreDays * 86400) * 1000 : -Infinity;
    const startAll = autoIgnoreDays > 0 ? bsearch(waitAll, cut) : 0;
    const startPeople = autoIgnoreDays > 0 ? bsearch(waitPeople, cut) : 0;
    const over24 = Math.max(0, bsearch(waitPeople, (now - 86400) * 1000) - startPeople);
    return {
      v: 2, at: new Date().toISOString(),
      wa_version: (window.Debug && window.Debug.VERSION) || null,
      total_chats: cache.size, unknown_chats: counters.unknown,
      recent: recentIds.map((id) => cache.get(id)?.row).filter(Boolean),
      waiting: waitAll.slice(startAll, startAll + RECENT_N).map(([, id]) => waitEntry(id, now)).filter(Boolean),
      waiting_total: waitAll.length - startAll,
      auto_ignored: startAll, auto_ignore_days: autoIgnoreDays,
      stats: {
        ok: true, read_at: new Date().toISOString(),
        totals: { chats: counters.groups + counters.people, people: counters.people, groups: counters.groups,
          unread_chats: counters.unreadChats, unread_messages: counters.unreadMsgs,
          waiting_people: waitPeople.length - startPeople, waiting_over_24h: over24 },
        daily: days14, hours_received_30d: hours,
        reply_minutes_30d: s.reply, top_chats_7d: s.top,
        waiting_longest: waitPeople.slice(startPeople, startPeople + RECENT_N).map(([, id]) => waitEntry(id, now)).filter(Boolean),
        coverage: { loaded_messages: counters.loaded, oldest_loaded: null }
      }
    };
  }

  // ---------- readonly IndexedDB fill-in for chats with nothing in memory ----------
  let dbP = null;
  const openDb = () => {
    if (dbP) return dbP;
    dbP = (async () => {
      if (typeof indexedDB?.databases !== "function") return null;
      const list = await indexedDB.databases();
      if (!list.some((d) => d.name === "model-storage")) return null;
      return await new Promise((resolve) => {
        const r = indexedDB.open("model-storage"); // no version: never upgrades
        r.onsuccess = () => { const db = r.result; db.onversionchange = () => { db.close(); dbP = null; }; resolve(db); };
        r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (_) {} resolve(null); };
        r.onerror = () => resolve(null);
        r.onblocked = () => resolve(null);
      });
    })().catch(() => null);
    return dbP;
  };
  const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  async function idbLastFor(chatId) {
    const db = await openDb();
    if (!db || !db.objectStoreNames.contains("message")) return null;
    const store = db.transaction("message", "readonly").objectStore("message");
    let best = null;
    for (const pre of ["false_" + chatId + "_", "true_" + chatId + "_"]) {
      try { for (const m of await reqP(store.getAll(IDBKeyRange.bound(pre, pre + "\uffff")))) if (!isSystem(m) && m.t && (!best || m.t > best.t)) best = m; } catch (_) {}
    }
    return best ? { t: best.t, mine: fromMeOf(best), text: textOf(best).slice(0, 300), sender: null } : null;
  }
  const unknownQueue = new Set(); // chats whose waiting state is unknown, filled a few at a time
  let idbBusy = false;
  async function fillUnknown() {
    if (idbBusy) return;
    idbBusy = true;
    try {
      let n = 0;
      for (const id of unknownQueue) {
        if (n++ >= IDB_PER_TICK) break;
        unknownQueue.delete(id);
        const e = cache.get(id); if (!e || e.row.awaiting_my_reply !== null) continue;
        const last = await idbLastFor(id).catch(() => null);
        idbLast.set(id, { t: e.t, last });
        let c = null; try { c = ChatCol.get ? ChatCol.get(id) : null; } catch (_) {}
        if (c) dirty.set(id, c);
      }
    } finally { idbBusy = false; }
  }

  // ---------- main loop ----------
  function tick(force) {
    if (!connect()) {
      if (Date.now() - lastPost > HEARTBEAT_MS) { lastPost = Date.now(); window.postMessage({ __ab: CHANNEL, ready: false }, location.origin); }
      return;
    }
    // With WhatsApp's change events, only a once-a-minute safety sweep; without them, a cheap signature sweep each tick
    if (firstPost || !hasEvents || Date.now() - lastSweep > SWEEP_MS) sweep();
    for (const [id, c] of dirty) { try { apply(id, c); } catch (_) {} }
    dirty.clear();
    for (const id of removed) {
      const e = cache.get(id);
      if (e) { contribute(e, -1); cache.delete(id); pendingRemoves.add(id); pendingUpserts.delete(id); needRefill = true; }
    }
    removed.clear();
    if (needRefill) { refillRecent(); needRefill = false; }
    for (const [id, row] of pendingUpserts) if (row.awaiting_my_reply === null && !row.is_official) unknownQueue.add(id);

    const changed = pendingUpserts.size || pendingRemoves.size;
    if (changed || force || Date.now() - lastPost > HEARTBEAT_MS) {
      const msg = { __ab: CHANNEL, reset: firstPost, upserts: [...pendingUpserts.values()], removes: [...pendingRemoves], meta: buildMeta(false) };
      firstPost = false;
      pendingUpserts = new Map(); pendingRemoves = new Set();
      lastPost = Date.now();
      try { window.postMessage(msg, location.origin); } catch (_) {}
    }
    if (unknownQueue.size) fillUnknown();
  }

  window.addEventListener("message", (e) => {
    if (e.source === window && e.data && e.data.__ab === CHANNEL && e.data.want === "now") tick(true);
    if (e.source === window && e.data && e.data.__ab === CHANNEL && e.data.want === "config") {
      const d = Number(e.data.autoIgnoreDays) || 0;
      if (d !== autoIgnoreDays) { autoIgnoreDays = d; tick(true); }
    }
    // the extension was reloaded and lost its stored copy: send everything again
    if (e.source === window && e.data && e.data.__ab === CHANNEL && e.data.want === "all") { firstPost = true; for (const [id, e2] of cache) pendingUpserts.set(id, e2.row); tick(true); }
  });
  setInterval(() => tick(false), TICK_MS);
  tick(false);
})();
