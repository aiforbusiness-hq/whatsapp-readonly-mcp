// Background script: connects to the local MCP program (ws://127.0.0.1, searched across 10 fixed ports), pairs,
// and on each read request runs the read-only reader in the WhatsApp tab and sends the result back.
//
// Security:
// - Connects only to 127.0.0.1 (the manifest CSP also locks connect-src to ws://127.0.0.1:*)
// - Runs only allowlisted read commands + draft list read/write; the local program cannot run any send / mark-read / open-chat command
// - "Open chat" is accepted only from a real user click (isTrusted) in the extension's own screens (popup, dashboard); the local program / AI cannot call it
// - Never writes chat content to the console or disk; only exception: when the AI calls download_media over MCP, that one file is saved to the Downloads folder (media.js), and media_log records the file name, check result and a redrawn small thumbnail (dashboard "Files downloaded by AI").
//   This command is wired only to paired MCP requests; the popup / dashboard / web pages cannot call it
import "./i18n.js"; // tr(): Chinese / English
import { runRead, openChat, findWhatsAppTab, focusOrOpenWhatsApp } from "./wa.js";
import { downloadMedia, getMediaLog, clearMediaLog, showFile, vetMedia } from "./media.js";
import { addDraft, listDrafts, updateDraft, removeDraft, clearDrafts, reconcile, purgeOld } from "./drafts.js";
import { logRequest, mark, getActivity, clearActivity, summarizeParams, summarizeResult } from "./activity.js";
import { b64, rand, normCode, isB64Of, sameB64, helloProof, extStart, extFinish, unwrapSecret, validSecret, CODE_DIGITS, PROTOCOL } from "./pairing.js";

const PORTS = Array.from({ length: 10 }, (_, i) => 47821 + i);
const READ_OPS = new Set(["status", "list_chats", "get_messages", "search_messages", "list_awaiting_reply", "get_media"]);
const DRAFT_OPS = new Set(["save_draft", "list_drafts"]);
const sockets = new Map(); // port -> { ws, state: "connecting" | "need_pair" | "ready", server }

async function getSecret() {
  const { secret } = await chrome.storage.local.get("secret");
  return validSecret(secret) ? secret : null;
}

function send(ws, obj) {
  try { ws.send(JSON.stringify(obj)); } catch (_) {}
}

// Hello: send only a random nonce, never the key. The local program must prove it has the key before the extension sends its proof (see pairing.js)
async function hello(entry) {
  entry.ne = b64(rand());
  entry.verified = false;
  send(entry.ws, { type: "hello", v: PROTOCOL, ne: entry.ne, paired: !!(await getSecret()), ext_version: chrome.runtime.getManifest().version });
}

function tryConnect(port) {
  if (sockets.has(port)) return;
  let ws;
  try { ws = new WebSocket(`ws://127.0.0.1:${port}`); } catch (_) { return; }
  const entry = { ws, port, state: "connecting", server: null, client: null, clients: [], expect: null, verified: false, old: false };
  sockets.set(port, entry);
  ws.onopen = () => hello(entry);
  ws.onclose = () => {
    if (sockets.get(port) === entry) sockets.delete(port);
    // A local program that was connected dropped: maybe the AI just restarted, or another AI is taking over the same port, so retry twice soon
    if (entry.state === "ready" || entry.state === "need_pair") for (const ms of [900, 3000]) setTimeout(() => { tryConnect(port); tryConnect(PORTS[0]); }, ms); // The one taking over starts from the first port
    // Can't connect (that local program has closed): forget this port, so we don't keep retrying and logging "connection failed" on the Errors page
    if (entry.state === "connecting" && port !== PORTS[0]) forgetPort(port);
  };
  ws.onerror = () => {}; // A port with no listener is normal; stay quiet
  ws.onmessage = async (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (_) { return; }
    if (!msg || typeof msg !== "object") return;
    // Replies awaited during pairing
    if (entry.expect && entry.expect.types.includes(msg.type)) { const fn = entry.expect.resolve; entry.expect = null; fn(msg); return; }
    switch (msg.type) {
      case "hello_auth": {
        // Local program proves it has the key (bound to this port); wrong proof = not a program we paired with: send nothing, go to pairing
        if (entry.state !== "connecting" || msg.v !== PROTOCOL || !isB64Of(msg.ns, 32)) return;
        const sec = await getSecret();
        if (!sec || !sameB64(msg.proof, await helloProof(sec, "srv", port, entry.ne, msg.ns))) {
          entry.state = "need_pair";
          rememberPorts();
          send(ws, { type: "want_pair" });
          return;
        }
        entry.verified = true;
        send(ws, { type: "auth", proof: await helloProof(sec, "ext", port, entry.ne, msg.ns) });
        break;
      }
      case "hello_ok":
        if (!entry.verified || entry.state !== "connecting") return; // A program that has not proved itself first is never treated as paired
        entry.state = "ready";
        mark("last_connected");
        setClients(entry, msg);
        rememberPorts();
        entry.server = msg.server || null;
        connectPeers(msg.peers);
        break;
      case "clients":
        if (entry.state === "ready") setClients(entry, msg);
        break;
      case "peers":
        if (entry.state === "ready") connectPeers(msg.peers);
        break;
      case "need_pair":
        if (entry.verified) return;
        entry.old = msg.v !== PROTOCOL; // Local program on a different version: send it no pairing data
        entry.state = "need_pair";
        rememberPorts();
        entry.server = msg.server || null;
        break;
      case "update_needed":
        entry.old = true;
        break;
      case "pong":
        if (entry.state === "ready") setClients(entry, msg);
        break;
      case "ping":
        send(ws, { type: "pong" });
        break;
      case "request": {
        if (entry.state !== "ready") return send(ws, { type: "response", id: msg.id, result: { ok: false, code: "NOT_PAIRED", reason: tr("插件还没配对", "The extension is not paired yet") } });
        let result;
        const t0 = Date.now();
        // Several AIs share one connection: each request says which AI asked
        const client = msg.client ? String(msg.client).slice(0, 80) : entry.client || "ai";
        if (!entry.clients.length) entry.client = client;
        try {
          if (msg.op === "get_media") result = await vetMedia(await readOp(msg.op, msg.params || {})); // Files are checked first too
          else if (READ_OPS.has(msg.op)) result = await skipIgnored(msg.op, msg.params || {}, await readOp(msg.op, msg.params || {}));
          else if (msg.op === "download_media") result = await downloadMedia(msg.params || {});
          else if (DRAFT_OPS.has(msg.op)) result = await draftOp(msg.op, msg.params || {});
          else result = { ok: false, code: "OP_NOT_ALLOWED", reason: tr("插件只做只读读取和存草稿，不接受这个指令", "The extension only reads and saves drafts; it does not accept this command") };
        } catch (e) {
          // Always reply, even on error, so the AI never waits forever
          result = { ok: false, code: "EXTENSION_ERROR", reason: tr("插件出错：", "Extension error: ") + String(e?.message || e) };
        }
        send(ws, { type: "response", id: msg.id, result });
        // Local activity log (no message content)
        logRequest({
          time: new Date(t0).toISOString(), ms: Date.now() - t0, port,
          client, op: String(msg.op || "").slice(0, 40),
          params: summarizeParams(msg.op, msg.params || {}), result: summarizeResult(msg.op, result),
          ok: !!result?.ok
        }).catch(() => {});
        break;
      }
    }
  };
}

// Chats the user marked "no reply needed" in the dashboard / popup: not counted as "waiting for you" until the other person sends a new message
// (same for the AI with list_awaiting_reply; pass include_ignored: true to see all)
async function skipIgnored(op, params, r) {
  if (op !== "list_awaiting_reply" || !r?.ok || params.include_ignored) return r;
  const { ignored_waiting: ig } = await chrome.storage.local.get("ignored_waiting");
  if (!ig) return r;
  const keep = r.chats.filter((c) => !(ig[c.id] && ig[c.id] === (c.last || c.since)));
  const n = r.chats.length - keep.length;
  if (!n) return r;
  return { ...r, chats: keep, count: keep.length, ignored_by_user: n,
    note: [r.note, tr(`另外 ${n} 个对话用户标了「不用回」，没列出来（对方再传新信息就会回来）`, `${n} more chats were marked \"No reply needed\" by the user and are not listed (they come back when the other person sends a new message)`)].filter(Boolean).join("；") };
}

// "Open in WhatsApp" link: use the WhatsApp tab already open (close the newly opened one), open the draft's chat, then have the page fill in the draft
async function openDraftLink(id, linkTab) {
  const d = (await listDrafts({ limit: 2000 })).find((x) => x.id === id);
  if (!d) return { ok: false };
  const others = (await chrome.tabs.query({ url: "https://web.whatsapp.com/*" }))
    .filter((t) => t.id !== linkTab.id && !t.incognito)
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  const target = others[0] || linkTab;
  const close = target.id !== linkTab.id;
  if (close) setTimeout(() => chrome.tabs.remove(linkTab.id).catch(() => {}), 300);
  openDraftIn(target, d).catch(() => {});
  return { ok: true, close };
}
// Open the draft's chat and fill it in (used by the link, popup and dashboard "Open"). Fills only, never sends
async function openDraftIn(target, d) {
  if (target.discarded || target.status === "unloaded") await chrome.tabs.reload(target.id).catch(() => {});
  // Wait for WhatsApp Web to load (a new or just-woken tab takes a moment), at most 60 seconds
  for (let i = 0; i < 60; i++) {
    const s = await runRead("status", {}, target.id).catch(() => null);
    if (s?.ok && s.logged_in_guess !== false) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  // An open dashboard covers the chat: close it first, then open the chat and fill in
  await chrome.tabs.sendMessage(target.id, { type: "close_panel" }).catch(() => {});
  const o = await openChat(d.chat_id, target.id);
  if (o?.ok) chrome.tabs.sendMessage(target.id, { type: "ab_fill_draft", id: d.id }).catch(() => {});
  return o;
}

// ---------- Drafts ----------
async function draftOp(op, p) {
  if (op === "save_draft") {
    const r = await runRead("resolve_chat", { chat: p.chat });
    if (!r.ok) return r;
    const g = await runRead("get_messages", { chat: r.chat.id, limit: 20 });
    let contextTime = null;
    if (g.ok) {
      const theirs = g.messages.filter((m) => !m.from_me);
      contextTime = theirs.length ? theirs[theirs.length - 1].time : null;
    }
    const a = await addDraft({ chat: r.chat, text: p.text, source: p.source, note: p.note, contextTime });
    if (!a.ok) return a;
    return {
      ok: true, draft_id: a.draft.id, chat: r.chat, created_at: a.draft.created_at,
      note: tr("已存成草稿，没有发送。用户在 WhatsApp 打开这个对话时，输入框上方会出现预览，由用户决定要不要填入、自己按发送。", "Saved as a draft, not sent. Give the user open_link as a clickable link: it opens this chat in WhatsApp Web with the draft filled in, and the user presses send themselves.")
    };
  }
  if (op === "list_drafts") {
    let chatId = null;
    if (p.chat) {
      const r = await runRead("resolve_chat", { chat: p.chat });
      if (!r.ok) return r;
      chatId = r.chat.id;
    }
    let list = await listDrafts({ chatId, since: p.since, status: p.status, limit: p.limit });
    if (p.include_actual !== false) {
      // Fill in the "actual human reply" from my messages in the chat (if it can't be read later, what's saved is kept)
      const chats = [...new Set(list.filter((d) => !d.actual_reply).map((d) => d.chat_id))].slice(0, 40);
      let changed = false;
      for (const id of chats) {
        const g = await runRead("get_messages", { chat: id, limit: 100 });
        if (waDown(g)) break;
        if (g.ok && (await reconcile(id, g.messages))) changed = true;
      }
      if (changed) list = await listDrafts({ chatId, since: p.since, status: p.status, limit: p.limit });
    }
    return { ok: true, count: list.length, kept_days: 90, drafts: list };
  }
  return { ok: false, code: "BAD_OP", reason: tr("未知的草稿指令", "Unknown draft command") };
}

// Preview card in the WhatsApp page: asks "does the open chat have a draft?"
async function draftsForActive(tabId) {
  const a = await runRead("active_chat", {}, tabId);
  if (!a.ok || !a.chat?.id) return { ok: true, chat: null, drafts: [] };
  const g = await runRead("get_messages", { chat: a.chat.id, limit: 20 }, tabId);
  if (g.ok) await reconcile(a.chat.id, g.messages);
  const list = (await listDrafts({ chatId: a.chat.id, limit: 5 }))
    .filter((d) => d.status === "pending" || d.status === "inserted" || d.status === "copied");
  return { ok: true, chat: a.chat, drafts: list };
}

// Which AIs are on this connection (newer local programs give the full list; older ones only one client)
function setClients(entry, msg) {
  if (msg.client) entry.client = String(msg.client).slice(0, 80);
  if (Array.isArray(msg.clients)) entry.clients = [...new Set(msg.clients.filter((x) => typeof x === "string" && x).map((x) => x.slice(0, 80)))].slice(0, 40);
}

function connectPeers(peers) {
  if (!Array.isArray(peers)) return;
  for (const p of peers) if (PORTS.includes(p)) tryConnect(p);
}

// Find local programs. For a port with no listener, Chrome logs "connection failed" on the Errors page (harmless but noisy). So:
// - Local programs take ports starting from 47821; a connected program tells the extension the other programs' ports (peers)
// - The background alarm only tries 47821 + the last connected ports; if nothing is found for a while, slow down to once every 2 minutes
// - Only when the user opens the extension popup are all 10 ports searched
let lastScan = 0;
let lastMainTry = 0;
let misses = 0;
let tick = 0;
async function knownPorts() {
  const { lastPorts } = await chrome.storage.local.get("lastPorts");
  return Array.isArray(lastPorts) ? lastPorts.filter((p) => PORTS.includes(p)) : [];
}
function anyReady() {
  return [...sockets.values()].some((e) => e.state === "ready" || e.state === "need_pair");
}
async function probe() {
  tick++;
  if (anyReady()) { misses = 0; return; }
  if (misses >= 10 && tick % 4 !== 0) return; // Slow down
  const ports = new Set([PORTS[0], ...(await knownPorts())]);
  for (const p of ports) tryConnect(p);
  setTimeout(() => { misses = anyReady() ? 0 : misses + 1; }, 3000);
}
// User opens the popup / dashboard: search all ports not yet connected (even if one AI is connected, another may have just started)
function connectAll(force = false) {
  const now = Date.now();
  if (now - lastScan < (force ? 3000 : 15000)) return;
  lastScan = now;
  misses = 0; // User just opened a screen: back to normal search speed
  for (const port of PORTS) tryConnect(port);
}

// Extension install / update / Chrome reopen: re-inject the scripts into WhatsApp tabs already open,
// so the user doesn't have to reload by hand (the old copy shuts itself down, see sidebar.js / content.js)
// Let content scripts write chrome.storage.session (the index summary lives here: memory only)
try { chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" }); } catch (_) {}

// ---------- Live index (indexer.js) data stored in chrome.storage.session ----------
// wa_meta: small overview (totals, stats, waiting for you, latest 100); c:<id>: one summary per chat (all chats, no limit)
const SNAP_FRESH_MS = 90000;
async function getMeta() {
  try {
    const { wa_meta: m } = await chrome.storage.session.get("wa_meta");
    if (m && m.recent && m.ready !== false && Date.now() - Date.parse(m.at) < SNAP_FRESH_MS) return m;
  } catch (_) {}
  return null;
}
async function allChatRows() { // Read only when "all chats" is needed (search, filter, more than 100)
  const all = await chrome.storage.session.get(null);
  const rows = [];
  for (const k in all) if (k.startsWith("c:")) rows.push(all[k]);
  rows.sort((a, b) => (b.last_time || "").localeCompare(a.last_time || ""));
  return rows;
}
async function askIndexRefresh() {
  const tab = await findWhatsAppTab().catch(() => null);
  if (tab) chrome.tabs.sendMessage(tab.id, { type: "wa_refresh_index" }).catch(() => {});
}
const stripRow = ({ loaded, oldest_loaded, their_last_message, their_last_sender, since, last, ...r }) => r;
// List reads use the index first (fast); only read WhatsApp live if the index is too old or missing
async function readFast(op, p) {
  const meta = await getMeta();
  if (!meta) return runRead(op, p);
  if (op === "status") return { ok: true, wa_version: meta.wa_version, logged_in_guess: meta.total_chats > 0, total_chats: meta.total_chats, from_index: true };
  if (op === "list_chats") {
    const limit = Math.max(1, Math.min(Number(p.limit) || 200, 500));
    const kw = String(p.keyword || "").trim().toLowerCase();
    const simple = !kw && !p.unread_only && !p.groups_only && !p.include_archived;
    let rows = simple && limit <= meta.recent.filter((r) => !r.archived).length ? meta.recent : await allChatRows();
    if (!p.include_archived) rows = rows.filter((r) => !r.archived);
    if (p.unread_only) rows = rows.filter((r) => r.unread > 0);
    if (p.groups_only) rows = rows.filter((r) => r.is_group);
    if (kw) rows = rows.filter((r) => r.name.toLowerCase().includes(kw) || (r.last_preview || "").toLowerCase().includes(kw));
    return { ok: true, read_at: meta.at, wa_version: meta.wa_version, total_chats: meta.total_chats, matched: rows.length,
      count: Math.min(rows.length, limit), chats: rows.slice(0, limit).map(stripRow) };
  }
  if (op === "list_awaiting_reply") {
    // Order for the AI: newest waiting first (today's customer matters more than an ad from months ago);
    // remove "no reply needed" before applying the limit, or the result is empty when the first few are all marked
    const limit = Math.max(1, Math.min(Number(p.limit) || 50, 200));
    const now = Date.now();
    let list = meta.waiting;
    if (meta.waiting_total > list.length) {
      const days = Number((await chrome.storage.local.get("auto_ignore_days")).auto_ignore_days) || 0;
      const cut = days > 0 ? now - days * 86400000 : -Infinity;
      list = (await allChatRows()).filter((r) => r.awaiting_my_reply === true && r.since && !r.archived && !r.is_official && Date.parse(r.since) >= cut)
        .map((r) => ({ id: r.id, name: r.name, is_group: r.is_group, since: r.since, last: r.last, unread: r.unread,
          their_last_message: r.their_last_message, their_last_sender: r.their_last_sender,
          waiting_hours: Math.round(((now - Date.parse(r.since)) / 3600000) * 10) / 10 }));
    }
    list = [...list].sort((a, b) => Date.parse(b.since) - Date.parse(a.since));
    if (p.include_groups === false) list = list.filter((w) => !w.is_group);
    let ignored = 0;
    if (!p.include_ignored) {
      const ig = (await chrome.storage.local.get("ignored_waiting")).ignored_waiting || {};
      const keep = list.filter((c) => !(ig[c.id] && ig[c.id] === (c.last || c.since)));
      ignored = list.length - keep.length;
      list = keep;
    }
    const out = list.slice(0, limit);
    const notes = [
      meta.unknown_chats ? tr(`${meta.unknown_chats} 个对话电脑里没有存信息，还在后台检查`, `${meta.unknown_chats} chats have no messages stored on this computer yet; still checking in the background`) : "",
      ignored ? tr(`另外 ${ignored} 个对话用户标了「不用回」，没列出来（对方再传新信息就会回来）`, `${ignored} more chats were marked "No reply needed" by the user and are not listed (they come back when the other person sends a new message)`) : ""
    ].filter(Boolean);
    return { ok: true, count: out.length, total_waiting: list.length, order: "newest_first", unknown_chats: meta.unknown_chats,
      ...(ignored ? { ignored_by_user: ignored } : {}),
      note: notes.length ? notes.join("；") : undefined,
      chats: out };
  }
  return runRead(op, p);
}
const FAST_OPS = new Set(["status", "list_chats", "list_awaiting_reply"]);
const readOp = (op, p) => (FAST_OPS.has(op) ? readFast(op, p) : runRead(op, p));

async function attachToOpenWhatsAppTabs() {
  let tabs = [];
  try { tabs = (await chrome.tabs.query({ url: "https://web.whatsapp.com/*" })).filter((t) => !t.incognito); } catch (_) {}
  for (const t of tabs) {
    if (t.discarded || t.status === "unloaded") continue;
    try { await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["i18n.js", "content.js", "dashboard.js", "sidebar.js"] }); } catch (_) {}
    try { await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["indexer.js"], world: "MAIN" }); } catch (_) {}
  }
}
async function forgetPort(port) {
  const { lastPorts } = await chrome.storage.local.get("lastPorts");
  if (Array.isArray(lastPorts) && lastPorts.includes(port)) await chrome.storage.local.set({ lastPorts: lastPorts.filter((p) => p !== port) });
}
async function rememberPorts() {
  const ports = [...sockets.entries()].filter(([, e]) => e.state !== "connecting").map(([p]) => p);
  if (ports.length) await chrome.storage.local.set({ lastPorts: ports });
}

// ---------- My data ----------
const DATA_KINDS = ["drafts", "activity", "media", "index", "ignored", "settings", "pairing"];
async function dataSummary() {
  const L = await chrome.storage.local.get(null);
  const S = await chrome.storage.session.get(null).catch(() => ({}));
  const bytes = async (area, keys) => { try { return keys.length ? await chrome.storage[area].getBytesInUse(keys) : 0; } catch (_) { return 0; } };
  const idx = Object.keys(S).filter((k) => k.startsWith("c:") || k === "wa_meta");
  const n = (v) => (Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : 0);
  return {
    ok: true,
    drafts: { count: n(L.drafts), bytes: await bytes("local", ["drafts"]) },
    activity: { count: n(L.activity), bytes: await bytes("local", ["activity", "marks"]) },
    media: { count: n(L.media_log), bytes: await bytes("local", ["media_log"]) },
    index: { count: idx.filter((k) => k.startsWith("c:")).length, bytes: await bytes("session", idx) },
    ignored: { count: n(L.ignored_waiting), bytes: await bytes("local", ["ignored_waiting"]) },
    settings: { count: ["ui_lang", "auto_ignore_days"].filter((k) => k in L).length, bytes: await bytes("local", ["ui_lang", "auto_ignore_days", "open_dash_at"]) },
    pairing: { paired: !!L.secret, bytes: await bytes("local", ["secret", "lastPorts"]) }
  };
}
async function clearData(kinds) {
  const want = new Set(kinds.filter((k) => DATA_KINDS.includes(k)));
  if (!want.size) return { ok: false, reason: "nothing to clear" };
  if (want.has("drafts")) await clearDrafts();
  if (want.has("activity")) await clearActivity();
  if (want.has("media")) await clearMediaLog();
  if (want.has("ignored")) await chrome.storage.local.remove("ignored_waiting");
  if (want.has("settings")) await chrome.storage.local.remove(["ui_lang", "auto_ignore_days", "open_dash_at"]);
  if (want.has("index")) {
    const S = await chrome.storage.session.get(null).catch(() => ({}));
    const keys = Object.keys(S).filter((k) => k.startsWith("c:") || k === "wa_meta");
    if (keys.length) await chrome.storage.session.remove(keys);
    askIndexRefresh(); // If WhatsApp is open, rebuild it (kept only in temporary storage that clears when Chrome closes)
  }
  if (want.has("pairing")) {
    await chrome.storage.local.remove(["secret", "lastPorts"]);
    for (const e of sockets.values()) { try { e.ws.close(); } catch (_) {} }
  }
  return { ok: true, cleared: [...want] };
}

// Pairing: the pairing code is used here only to compute SPAKE2 and is never sent. The local program must first prove it knows the same code (a fake one can't, and gets only one guess each time),
// then the key is sent encrypted with a one-time key (see pairing.js)
function expect(entry, types, ms, sendFn) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { if (entry.expect?.resolve === done) entry.expect = null; resolve(null); }, ms);
    const done = (m) => { clearTimeout(t); resolve(m); };
    entry.expect = { types, resolve: done };
    sendFn();
  });
}
// Show only the extension's own text: messages from the local program (which may be fake) are never shown to the user directly
function pairFailText(code) {
  return {
    LOCKED: tr("配对试太多次，暂停了。请完全关掉 AI（Claude / ChatGPT）再打开，然后重新问「WhatsApp 状态」。", "Too many pairing tries, so pairing is paused. Fully quit your AI app (Claude / ChatGPT), reopen it, then ask \"WhatsApp status\" again."),
    NOT_ARMED: tr("请先在 AI 里问「WhatsApp 状态」拿配对码（3 分钟内有效）。", "First ask your AI \"WhatsApp status\" for a pairing code (valid for 3 minutes)."),
    CODE_CHANGED: tr("配对码已经换了。请在 AI 里重新问「WhatsApp 状态」拿新码。", "The pairing code has changed. Ask your AI \"WhatsApp status\" again for a new code.")
  }[code] || tr("配对码不对或已过期。请在 AI 里重新问「WhatsApp 状态」拿新码。", "Wrong or expired pairing code. Ask your AI \"WhatsApp status\" again for a new code.");
}
async function pairOne(entry, code) {
  const st = await extStart(entry.port, code);
  const srv = await expect(entry, ["pair_srv", "pair_failed"], 15000, () => send(entry.ws, { type: "pair_start", v: PROTOCOL, ne: st.ne, pa: st.pa }));
  if (!srv) return { ok: false, reason: tr("本机程序没有回应", "The local server did not respond") };
  if (srv.type === "pair_failed") return { ok: false, reason: pairFailText(srv.code) };
  if (!isB64Of(srv.ns, 32) || !isB64Of(srv.pb, 65) || typeof srv.mac !== "string") return { ok: false, reason: tr("本机程序回覆不对", "The local server answered wrongly") };
  // Wrong code, or not the real local program: the results differ, so send nothing
  const fin1 = await extFinish(st, srv.ns, srv.pb, srv.mac);
  if (!fin1.ok) {
    send(entry.ws, { type: "pair_abort" });
    return { ok: false, wrong: true, reason: tr("配对码不对", "Wrong pairing code") };
  }
  const fin = await expect(entry, ["paired", "pair_failed"], 10000, () => send(entry.ws, { type: "pair_ext", mac: fin1.mac }));
  if (!fin) return { ok: false, reason: tr("本机程序没有回应", "The local server did not respond") };
  if (fin.type === "pair_failed") return { ok: false, reason: pairFailText(fin.code) };
  let secret = null;
  try { secret = await unwrapSecret(fin1.h, st.ne, srv.ns, fin.iv, fin.ct); } catch (_) {}
  if (!validSecret(secret)) return { ok: false, reason: tr("配对资料不对", "Bad pairing data") };
  await chrome.storage.local.set({ secret });
  entry.verified = true;
  entry.state = "ready";
  setClients(entry, fin);
  connectPeers(fin.peers);
  mark("last_connected");
  // Other local programs not yet paired: say hello again (they share the same key)
  for (const e of sockets.values()) if (e !== entry && e.state === "need_pair" && !e.old) { e.state = "connecting"; hello(e); }
  return { ok: true };
}
async function pair(code) {
  code = normCode(code);
  if (code.length !== CODE_DIGITS) return { ok: false, reason: tr(`配对码是 ${CODE_DIGITS} 位数字`, `The pairing code is ${CODE_DIGITS} digits`) };
  const all = [...sockets.values()].filter((e) => e.state === "need_pair");
  const candidates = all.filter((e) => !e.old);
  if (!candidates.length) {
    if (all.length) return { ok: false, reason: tr("AI 那边的插件是旧版本。请更新 AI 的插件，然后完全关掉再打开 AI。", "The AI plugin is an older version. Update it, then fully quit and reopen your AI app.") };
    return { ok: false, reason: tr("找不到在等配对的本机程序。请先在 AI（Claude 或 ChatGPT）里问一次「WhatsApp 状态」，让它启动本机程序。", "No local server is waiting to pair. First ask your AI (Claude or ChatGPT) \"WhatsApp status\" so it starts the local server.") };
  }
  let last = null;
  for (const e of candidates) {
    if (e.pairing) continue;
    e.pairing = true;
    let r;
    try { r = await pairOne(e, code); } catch (err) { r = { ok: false, reason: String(err?.message || err) }; } finally { e.pairing = false; }
    if (r.ok) return r;
    last = r;
  }
  return last || { ok: false, reason: tr("配对失败", "Pairing failed") };
}

function state() {
  const list = [...sockets.entries()].map(([port, e]) => ({ port, state: e.state }));
  return {
    ready: list.filter((x) => x.state === "ready").length,
    need_pair: list.filter((x) => x.state === "need_pair").length,
    connecting: list.filter((x) => x.state === "connecting").length,
    servers: [...sockets.entries()].filter(([, e]) => e.state !== "connecting").flatMap(([port, e]) => (e.clients.length ? e.clients : [e.client || null]).map((client) => ({ port, state: e.state, client })))
  };
}

// Keep alive: ping every 20 seconds (so Chrome doesn't put the background script to sleep)
setInterval(() => {
  for (const e of sockets.values()) if (e.state !== "connecting") send(e.ws, { type: "ping" });
}, 20000);

// After the background script sleeps, an alarm wakes it every 30 seconds to look for local programs
chrome.alarms.create("reconnect", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "reconnect") probe(); });
chrome.runtime.onStartup.addListener(() => { probe(); purgeOld(); });
chrome.runtime.onInstalled.addListener(() => { probe(); attachToOpenWhatsAppTabs(); });

// Dashboard data: drafts (actual replies filled in first), stats, activity log, connections
// If WhatsApp can't be read (not open / asleep / stuck), don't try chat by chat, or it takes minutes
const TAB_LEVEL = new Set(["WA_TAB_NOT_OPEN", "WA_TAB_ASLEEP", "WA_TIMEOUT", "WA_NOT_READY", "WA_NO_COLLECTIONS", "WA_NO_CHATS", "INJECT_FAILED", "NO_RESULT"]);
const waDown = (r) => !r?.ok && TAB_LEVEL.has(r?.code);

async function dashData() {
  const all = await listDrafts({ limit: 2000 });
  askIndexRefresh();
  const probeWa = (await getMeta()) ? { ok: true } : await runRead("status", {});
  const recent = Date.now() - 14 * 86400000;
  const chats = [...new Set(all.filter((d) => !d.reply_closed && Date.parse(d.created_at) >= recent).map((d) => d.chat_id))].slice(0, 40);
  if (!waDown(probeWa)) for (const id of chats) {
    const g = await runRead("get_messages", { chat: id, limit: 100 });
    if (waDown(g)) break;
    if (g.ok) await reconcile(id, g.messages);
  }
  const [drafts, stats, activity, bytes, media] = await Promise.all([
    listDrafts({ limit: 2000 }),
    waDown(probeWa) ? probeWa : getMeta().then((m) => m?.stats || runRead("stats", { days: 14 })),
    getActivity(),
    chrome.storage.local.getBytesInUse(null).catch(() => null),
    getMediaLog().catch(() => [])
  ]);
  return {
    ok: true, now: new Date().toISOString(), version: chrome.runtime.getManifest().version,
    connection: { ...state(), paired: !!(await getSecret()) }, drafts, stats, activity, media, storage_bytes: bytes
  };
}

// For export: messages in chats that have drafts, in time order (received + sent by me); dashboard only, saved only as a file the user downloads
async function timeline(chatIds, since) {
  const ids = [...new Set((Array.isArray(chatIds) ? chatIds : []).map(String))].slice(0, 60);
  const out = [];
  let unreadable = 0;
  for (const id of ids) {
    const g = await runRead("get_messages", { chat: id, limit: 100 });
    if (waDown(g)) { unreadable += ids.length - ids.indexOf(id); break; }
    if (!g.ok) { unreadable++; continue; }
    for (const m of g.messages) if (m.time && (!since || m.time >= since)) out.push({ chat_id: id, chat_name: g.chat?.name || null, ...m });
  }
  return { ok: true, messages: out, unreadable_chats: unreadable };
}

async function openDashboardInWhatsApp() {
  const tab = await findWhatsAppTab();
  if (!tab) {
    // WhatsApp Web not open yet: open one; once loaded, the sidebar script opens the dashboard automatically
    await chrome.storage.local.set({ open_dash_at: Date.now() });
    await chrome.tabs.create({ url: "https://web.whatsapp.com/" });
    return { ok: true, opened: "new_tab" };
  }
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  try { await chrome.tabs.sendMessage(tab.id, { type: "open_panel" }); }
  catch (_) {
    // The script in the tab is old (extension just updated): reload that page and open automatically after load
    await chrome.storage.local.set({ open_dash_at: Date.now() });
    await chrome.tabs.reload(tab.id);
  }
  return { ok: true };
}

let assetsCache = null;
async function dashAssets() {
  if (!assetsCache) {
    const [html, css] = await Promise.all(["dashboard.html", "dashboard.css"].map((f) => fetch(chrome.runtime.getURL(f)).then((r) => r.text())));
    assetsCache = { ok: true, html, css };
  }
  return assetsCache;
}

const POPUP_URL = chrome.runtime.getURL("popup.html");
// Dashboard: the extension's own page (its own tab, or an iframe inside the WhatsApp page). Web pages can't fake it:
// with no externally_connectable, web pages can't message the extension; a content script's sender.url is https://web.whatsapp.com
const EXT_ORIGIN = new URL(chrome.runtime.getURL("")).origin;
const fromDash = (sender) => {
  try {
    const u = new URL(sender.url || "");
    return u.origin === EXT_ORIGIN && u.pathname === "/dashboard.html";
  } catch (_) { return false; }
};
// The extension's own popup page (may also be opened in a tab). sender.url of web pages and content scripts is never an extension URL
const fromPopup = (sender) => typeof sender.url === "string" && sender.url.startsWith(POPUP_URL);
// Content script in a WhatsApp tab; incognito windows never count (the extension is also set not to run in incognito)
const fromWaPage = (sender) => !!sender.tab && !sender.tab.incognito && typeof sender.url === "string" && sender.url.startsWith("https://web.whatsapp.com/");

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return false;
  // Page preview card
  if (msg?.type === "card_drafts" && fromWaPage(sender)) {
    draftsForActive(sender.tab.id).then(reply, (e) => reply({ ok: false, reason: String(e?.message || e) }));
    return true;
  }
  // When "Fill in" is clicked on a draft card: which chat this tab has open now
  if (msg?.type === "card_active_chat" && fromWaPage(sender)) {
    runRead("active_chat", {}, sender.tab.id).then(reply, () => reply({ ok: false }));
    return true;
  }
  if (msg?.type === "card_mark" && (fromWaPage(sender) || fromPopup(sender))) {
    const allowed = { inserted: "inserted_at", copied: "copied_at", dismissed: "dismissed_at" };
    const f = allowed[msg.status];
    if (!f) { reply({ ok: false }); return false; }
    updateDraft(String(msg.id), { status: msg.status, [f]: new Date().toISOString() }).then((d) => reply({ ok: !!d }));
    return true;
  }
  // Popup
  // Dashboard inside the WhatsApp page: give it the markup (HTML) and styles (CSS); the content script puts them in a closed shadow DOM
  if (msg?.type === "dash_assets" && fromWaPage(sender)) {
    dashAssets().then(reply, () => reply({ ok: false }));
    return true;
  }
  if (msg?.type === "dash_data" && (fromDash(sender) || fromWaPage(sender))) {
    connectAll(true); // Opening the dashboard: reconnect as well
    // Get the data before recording "this open", so the screen shows the "last opened" time
    dashData().then((r) => { mark("last_dashboard"); reply(r); }, (e) => reply({ ok: false, reason: String(e?.message || e) }));
    return true;
  }
  if (msg?.type === "dash_timeline" && (fromDash(sender) || fromWaPage(sender))) {
    timeline(msg.chat_ids, msg.since).then(reply, (e) => reply({ ok: false, reason: String(e?.message || e) }));
    return true;
  }
  // Dashboard: asks only for connection status (every few seconds, also prompting the background script to look for local programs)
  if (msg?.type === "dash_state" && (fromDash(sender) || fromWaPage(sender))) {
    probe(); // Try only the main port + last connected ones, not all (so the Errors page doesn't keep logging)
    if (!sockets.has(PORTS[0]) && Date.now() - lastMainTry > 30000) { lastMainTry = Date.now(); tryConnect(PORTS[0]); } // If the main port (usually Claude) isn't connected, try it again, at most once every 30 seconds
    getSecret().then((sec) => setTimeout(() => reply({ ...state(), paired: !!sec }), 400));
    return true;
  }
  if (msg?.type === "dash_pair" && (fromDash(sender) || fromWaPage(sender))) {
    pair(msg.code).then(reply, (e) => reply({ ok: false, reason: String(e?.message || e) }));
    return true;
  }
  if (msg?.type === "dash_clear_activity" && (fromDash(sender) || fromWaPage(sender))) {
    clearActivity().then(() => reply({ ok: true }), (e) => reply({ ok: false, reason: String(e?.message || e) }));
    return true;
  }
  // "Files downloaded by AI": can only show in folder (not open) and clear the log (files are not deleted)
  if (msg?.type === "dash_show_file" && (fromDash(sender) || fromWaPage(sender))) {
    showFile(Number(msg.download_id)).then(reply, () => reply({ ok: false }));
    return true;
  }
  // "My data": what this extension stores on this computer, and clearing it (downloaded files are not deleted)
  if (msg?.type === "dash_data_summary" && (fromDash(sender) || fromWaPage(sender))) {
    dataSummary().then(reply, () => reply({ ok: false }));
    return true;
  }
  if (msg?.type === "dash_clear_data" && (fromDash(sender) || fromWaPage(sender))) {
    clearData(Array.isArray(msg.kinds) ? msg.kinds : []).then(reply, (e) => reply({ ok: false, reason: String(e?.message || e) }));
    return true;
  }
  if (msg?.type === "dash_clear_media" && (fromDash(sender) || fromWaPage(sender))) {
    clearMediaLog().then(() => reply({ ok: true }), () => reply({ ok: false }));
    return true;
  }
  // "Dashboard" = open inside the WhatsApp Web page (no separate extension page)
  if (msg?.type === "open_dashboard" && (fromPopup(sender) || fromDash(sender))) {
    openDashboardInWhatsApp().then(reply, () => reply({ ok: false }));
    return true;
  }
  // "Open in WhatsApp" link (link.js): acts only if the draft id matches; only opens the chat and fills in, never sends
  if (msg?.type === "open_draft_link" && fromWaPage(sender)) {
    openDraftLink(String(msg.id || ""), sender.tab).then(reply, () => reply({ ok: false }));
    return true;
  }
  // Draft "Open" in the popup / dashboard: open the chat and fill in the draft
  if (msg?.type === "open_draft" && (fromPopup(sender) || fromDash(sender) || fromWaPage(sender))) {
    (async () => {
      const d = (await listDrafts({ limit: 2000 })).find((x) => x.id === String(msg.id || ""));
      if (!d) return { ok: false, reason: tr("找不到这份草稿", "Can't find this draft") };
      const tab = await findWhatsAppTab(true);
      if (!tab) return { ok: false, reason: tr("WhatsApp Web 没开", "WhatsApp Web is not open") };
      return openDraftIn(tab, d);
    })().then(reply, (e) => reply({ ok: false, reason: String(e?.message || e) }));
    return true;
  }
  if (msg?.type === "open_chat") {
    if (!fromPopup(sender) && !fromDash(sender) && !fromWaPage(sender)) { reply({ ok: false, reason: tr("只接受插件画面里的点击", "Only clicks inside the extension are accepted") }); return false; }
    openChat(String(msg.chat_id)).then(reply, (e) => reply({ ok: false, reason: String(e?.message || e) }));
    return true;
  }
  if (msg?.type === "open_whatsapp" && fromPopup(sender)) {
    focusOrOpenWhatsApp().then(reply, () => reply({ ok: false }));
    return true;
  }
  if (msg?.type === "ui_read" && fromPopup(sender) && READ_OPS.has(msg.op)) {
    readOp(msg.op, msg.params || {}).then((r) => skipIgnored(msg.op, msg.params || {}, r)).then(reply, (e) => reply({ ok: false, reason: String(e?.message || e) }));
    return true;
  }
  if (msg?.type === "ui_drafts" && fromPopup(sender)) {
    listDrafts({ limit: 300 }).then((drafts) => reply({ ok: true, drafts }));
    return true;
  }
  // Delete a draft: only the extension's own popup and dashboard can (the AI has no such tool)
  if (msg?.type === "remove_draft" && (fromPopup(sender) || fromDash(sender) || fromWaPage(sender))) {
    removeDraft(String(msg.id || "")).then((ok) => reply({ ok }), (e) => reply({ ok: false, reason: String(e?.message || e) }));
    return true;
  }
  if (msg?.type === "ui_clear_drafts" && fromPopup(sender)) {
    clearDrafts().then(() => reply({ ok: true }), (e) => reply({ ok: false, reason: String(e?.message || e) }));
    return true;
  }
  // WhatsApp page just opened: connect to local programs right away
  if (msg?.type === "wa_opened" && fromWaPage(sender)) {
    connectAll(true);
    reply({ ok: true });
    return false;
  }
  if (msg?.type === "wa_refresh_index" && fromPopup(sender)) { askIndexRefresh(); reply({ ok: true }); return false; }
  if (msg?.type === "state" && (fromPopup(sender) || fromDash(sender))) {
    if (fromPopup(sender)) mark("last_popup");
    connectAll(!!msg.force); // User opened the popup: search all ports
    // Give the connection a moment
    getSecret().then((sec) => setTimeout(() => reply({ ...state(), paired: !!sec }), 600));
    return true;
  }
  if (msg?.type === "pair" && fromPopup(sender)) {
    pair(msg.code).then(reply, (e) => reply({ ok: false, reason: String(e?.message || e) }));
    return true;
  }
  if (msg?.type === "unpair" && (fromPopup(sender) || fromDash(sender) || fromWaPage(sender))) {
    chrome.storage.local.remove(["secret", "lastPorts"]).then(() => {
      for (const e of sockets.values()) { try { e.ws.close(); } catch (_) {} }
      reply({ ok: true });
    });
    return true;
  }
  return false;
});

probe();
