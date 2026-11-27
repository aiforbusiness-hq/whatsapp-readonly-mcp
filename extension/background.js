// 背景程序：连到本机 MCP 程序（ws://127.0.0.1，固定 10 个端口里找），配对，
// 收到读取请求就在 WhatsApp 分页里执行只读读取器，把结果传回去。
//
// 安全：
// - 只连 127.0.0.1（manifest 的 CSP 也锁死 connect-src ws://127.0.0.1:*）
// - 只执行白名单里的读取指令 + 草稿清单读写；没有任何发信息 / 标已读 / 打开对话的指令可以从本机程序执行
// - 「打开对话」只接受插件自己的画面（弹窗、仪表板）里用户亲手点（isTrusted）发来的请求；本机程序 / AI 不能叫
// - 不把对话内容写进 console 或硬盘；唯一例外：AI 通过 MCP 叫 download_media 时，把那一个文件存进「下载」文件夹（media.js），并在 media_log 记文件名、检查结果和重新画过的小缩图（仪表板「AI 下载的文件」）。
//   这个指令只接在已配对的 MCP 请求上，弹窗 / 仪表板 / 网页都叫不到
import "./i18n.js"; // tr()：中文 / 英文
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

// 打招呼：只送一个随机数，不送密钥。本机程序要先证明它有密钥，插件才回证明（见 pairing.js）
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
    // 已经连上过的本机程序断了：可能只是 AI 重新启动，或另一个 AI 正在接手同一个端口 → 很快再试两次
    if (entry.state === "ready" || entry.state === "need_pair") for (const ms of [900, 3000]) setTimeout(() => { tryConnect(port); tryConnect(PORTS[0]); }, ms); // 接手的从第一个端口开始占
    // 连不上（那个本机程序已经关了）→ 忘掉这个端口，免得一直重试、在「错误」页一直记「连线失败」
    if (entry.state === "connecting" && port !== PORTS[0]) forgetPort(port);
  };
  ws.onerror = () => {}; // 端口没人听很正常，不吵
  ws.onmessage = async (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (_) { return; }
    if (!msg || typeof msg !== "object") return;
    // 配对过程中等待的回覆
    if (entry.expect && entry.expect.types.includes(msg.type)) { const fn = entry.expect.resolve; entry.expect = null; fn(msg); return; }
    switch (msg.type) {
      case "hello_auth": {
        // 本机程序证明它有密钥（绑这个端口）；证明不对 = 不是我们配对过的程序：什么都不送，改走配对
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
        if (!entry.verified || entry.state !== "connecting") return; // 没先证明自己的程序，一律不当成已配对
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
        entry.old = msg.v !== PROTOCOL; // 版本不同的本机程序：不送任何配对资料给它
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
        // 几个 AI 共用一条连线：每个请求自己带是哪个 AI 问的
        const client = msg.client ? String(msg.client).slice(0, 80) : entry.client || "ai";
        if (!entry.clients.length) entry.client = client;
        try {
          if (msg.op === "get_media") result = await vetMedia(await readOp(msg.op, msg.params || {})); // 文件也要先检查
          else if (READ_OPS.has(msg.op)) result = await skipIgnored(msg.op, msg.params || {}, await readOp(msg.op, msg.params || {}));
          else if (msg.op === "download_media") result = await downloadMedia(msg.params || {});
          else if (DRAFT_OPS.has(msg.op)) result = await draftOp(msg.op, msg.params || {});
          else result = { ok: false, code: "OP_NOT_ALLOWED", reason: tr("插件只做只读读取和存草稿，不接受这个指令", "The extension only reads and saves drafts; it does not accept this command") };
        } catch (e) {
          // 出错也一定回覆，AI 不会一直等
          result = { ok: false, code: "EXTENSION_ERROR", reason: tr("插件出错：", "Extension error: ") + String(e?.message || e) };
        }
        send(ws, { type: "response", id: msg.id, result });
        // 本机活动纪录（不存信息内容）
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

// 用户在仪表板 / 弹窗按了「不用回」的对话：不算「在等你回」，直到对方再传新信息
// （AI 用 list_awaiting_reply 也一样；要看全部可以传 include_ignored: true）
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

// ---------- 草稿 ----------
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
      note: tr("已存成草稿，没有发送。用户在 WhatsApp 打开这个对话时，输入框上方会出现预览，由用户决定要不要填入、自己按发送。", "Saved as a draft, not sent. When the user opens this chat in WhatsApp, a preview appears above the message box; the user decides whether to fill it in and presses send themselves.")
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
      // 用对话里我发的信息补上「真人实际回复」（之后读不到时，已存的照样保留）
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

// WhatsApp 页面里的预览卡：问「现在打开的对话有没有草稿」
async function draftsForActive(tabId) {
  const a = await runRead("active_chat", {}, tabId);
  if (!a.ok || !a.chat?.id) return { ok: true, chat: null, drafts: [] };
  const g = await runRead("get_messages", { chat: a.chat.id, limit: 20 }, tabId);
  if (g.ok) await reconcile(a.chat.id, g.messages);
  const list = (await listDrafts({ chatId: a.chat.id, limit: 5 }))
    .filter((d) => d.status === "pending" || d.status === "inserted" || d.status === "copied");
  return { ok: true, chat: a.chat, drafts: list };
}

// 这条连线上有哪些 AI（新版本机程序会给整份名单；旧版只有一个 client）
function setClients(entry, msg) {
  if (msg.client) entry.client = String(msg.client).slice(0, 80);
  if (Array.isArray(msg.clients)) entry.clients = [...new Set(msg.clients.filter((x) => typeof x === "string" && x).map((x) => x.slice(0, 80)))].slice(0, 40);
}

function connectPeers(peers) {
  if (!Array.isArray(peers)) return;
  for (const p of peers) if (PORTS.includes(p)) tryConnect(p);
}

// 找本机程序。没人听的端口，Chrome 会在「错误」页记一笔「连线失败」（无害，但吵）。所以：
// - 本机程序从第一个端口 47821 开始占；已连上的程序会告诉插件其他程序的端口（peers）
// - 背景闹钟只试 47821 + 上次连过的端口；一直找不到就放慢到每 2 分钟一次
// - 只有用户点开插件弹窗时，才把 10 个端口全部找一遍
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
  if (misses >= 10 && tick % 4 !== 0) return; // 放慢
  const ports = new Set([PORTS[0], ...(await knownPorts())]);
  for (const p of ports) tryConnect(p);
  setTimeout(() => { misses = anyReady() ? 0 : misses + 1; }, 3000);
}
// 用户打开弹窗 / 仪表板：把还没连上的端口都找一遍（就算已经有一个 AI 连着，另一个 AI 可能刚打开）
function connectAll(force = false) {
  const now = Date.now();
  if (now - lastScan < (force ? 3000 : 15000)) return;
  lastScan = now;
  misses = 0; // 用户刚打开画面：恢复正常速度去找
  for (const port of PORTS) tryConnect(port);
}

// 插件安装 / 更新 / Chrome 重新打开：把程序重新放进已经开着的 WhatsApp 分页，
// 不用用户手动重新整理（旧的那份会自己收起来，见 sidebar.js / content.js）
// 让内容脚本能写 chrome.storage.session（索引摘要放这里：只在记忆体）
try { chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" }); } catch (_) {}

// ---------- 即时索引（indexer.js）存在 chrome.storage.session 的资料 ----------
// wa_meta：小总览（总数、统计、等你回、最近 100 个）；c:<id>：每个对话一份摘要（全部对话，没有上限）
const SNAP_FRESH_MS = 90000;
async function getMeta() {
  try {
    const { wa_meta: m } = await chrome.storage.session.get("wa_meta");
    if (m && m.recent && m.ready !== false && Date.now() - Date.parse(m.at) < SNAP_FRESH_MS) return m;
  } catch (_) {}
  return null;
}
async function allChatRows() { // 只在需要「全部对话」时读（搜寻、过滤、超过 100 个）
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
// 列表类的读取先用索引（很快）；索引太旧或没有才去 WhatsApp 现读
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
    const limit = Math.max(1, Math.min(Number(p.limit) || 50, 200));
    let list = meta.waiting;
    if (limit > list.length && meta.waiting_total > list.length) {
      const now = Date.now();
      const days = Number((await chrome.storage.local.get("auto_ignore_days")).auto_ignore_days) || 0;
      const cut = days > 0 ? now - days * 86400000 : -Infinity;
      list = (await allChatRows()).filter((r) => r.awaiting_my_reply === true && r.since && !r.archived && !r.is_official && Date.parse(r.since) >= cut)
        .map((r) => ({ id: r.id, name: r.name, is_group: r.is_group, since: r.since, last: r.last, unread: r.unread,
          their_last_message: r.their_last_message, their_last_sender: r.their_last_sender,
          waiting_hours: Math.round(((now - Date.parse(r.since)) / 3600000) * 10) / 10 }))
        .sort((a, b) => b.waiting_hours - a.waiting_hours);
    }
    const out = list.filter((w) => p.include_groups !== false || !w.is_group).slice(0, limit);
    return { ok: true, count: out.length, unknown_chats: meta.unknown_chats,
      note: meta.unknown_chats ? tr(`${meta.unknown_chats} 个对话电脑里没有存信息，还在后台检查`, `${meta.unknown_chats} chats have no messages stored on this computer yet; still checking in the background`) : undefined,
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

// ---------- 我的资料 ----------
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
    askIndexRefresh(); // WhatsApp 开着的话，重新整理一份（只存在 Chrome 关掉就消失的暂存区）
  }
  if (want.has("pairing")) {
    await chrome.storage.local.remove(["secret", "lastPorts"]);
    for (const e of sockets.values()) { try { e.ws.close(); } catch (_) {} }
  }
  return { ok: true, cleared: [...want] };
}

// 配对：配对码只在这里用来算 SPAKE2，不会送出去。本机程序要先证明它知道同一个码（假程序做不到，每次也只能猜一个码），
// 然后密钥用一次性的金钥加密送过来（见 pairing.js）
function expect(entry, types, ms, sendFn) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { if (entry.expect?.resolve === done) entry.expect = null; resolve(null); }, ms);
    const done = (m) => { clearTimeout(t); resolve(m); };
    entry.expect = { types, resolve: done };
    sendFn();
  });
}
// 只显示插件自己的文字：本机程序（可能是假的）送来的说明不直接给用户看
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
  // 码不对，或对方不是真的本机程序：算出来的不一样，什么都不送
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
  // 其他还没配对的本机程序：重新打招呼（它们共用同一把密钥）
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

// 保持连线：每 20 秒打一次招呼（Chrome 才不会让背景程序睡着）
setInterval(() => {
  for (const e of sockets.values()) if (e.state !== "connecting") send(e.ws, { type: "ping" });
}, 20000);

// 背景程序睡着后，每 30 秒被闹钟叫醒再找本机程序
chrome.alarms.create("reconnect", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "reconnect") probe(); });
chrome.runtime.onStartup.addListener(() => { probe(); purgeOld(); });
chrome.runtime.onInstalled.addListener(() => { probe(); attachToOpenWhatsAppTabs(); });

// 仪表板资料：草稿（先补上实际回复）、统计、活动纪录、连线
// WhatsApp 读不到（没开 / 睡着 / 卡住）就不要一个一个对话去试，免得要等好几分钟
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

// 导出用：有草稿的那些对话，按时间排好的信息（收到 + 我发出），只给仪表板，只存成用户自己下载的文件
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
    // 还没开 WhatsApp Web：开一个，载入好后侧栏程序会自动打开仪表板
    await chrome.storage.local.set({ open_dash_at: Date.now() });
    await chrome.tabs.create({ url: "https://web.whatsapp.com/" });
    return { ok: true, opened: "new_tab" };
  }
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  try { await chrome.tabs.sendMessage(tab.id, { type: "open_panel" }); }
  catch (_) {
    // 分页里的程序是旧的（插件刚更新过）→ 重新整理那一页，载入后自动打开
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
// 仪表板：插件自己的页面（独立分页，或嵌在 WhatsApp 页面里的 iframe）。网页本身不能冒充：
// 没有 externally_connectable，网页无法送讯息给插件；内容脚本的 sender.url 是 https://web.whatsapp.com
const EXT_ORIGIN = new URL(chrome.runtime.getURL("")).origin;
const fromDash = (sender) => {
  try {
    const u = new URL(sender.url || "");
    return u.origin === EXT_ORIGIN && u.pathname === "/dashboard.html";
  } catch (_) { return false; }
};
// 插件自己的弹窗页（也可能被开在分页里）。网页和内容脚本的 sender.url 不会是插件网址
const fromPopup = (sender) => typeof sender.url === "string" && sender.url.startsWith(POPUP_URL);
// WhatsApp 分页里的内容脚本；无痕视窗一律不算（插件也设成不在无痕视窗执行）
const fromWaPage = (sender) => !!sender.tab && !sender.tab.incognito && typeof sender.url === "string" && sender.url.startsWith("https://web.whatsapp.com/");

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return false;
  // 页面预览卡
  if (msg?.type === "card_drafts" && fromWaPage(sender)) {
    draftsForActive(sender.tab.id).then(reply, (e) => reply({ ok: false, reason: String(e?.message || e) }));
    return true;
  }
  // 草稿卡按「填入」时：这个分页现在打开的是哪个对话
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
  // 弹窗
  // WhatsApp 页面里的仪表板：给它画面（HTML）和样式（CSS），由内容脚本放进 closed shadow DOM
  if (msg?.type === "dash_assets" && fromWaPage(sender)) {
    dashAssets().then(reply, () => reply({ ok: false }));
    return true;
  }
  if (msg?.type === "dash_data" && (fromDash(sender) || fromWaPage(sender))) {
    connectAll(true); // 打开仪表板：顺便重新连线
    // 先拿资料再记「这次打开」，这样画面上显示的是「上一次打开」
    dashData().then((r) => { mark("last_dashboard"); reply(r); }, (e) => reply({ ok: false, reason: String(e?.message || e) }));
    return true;
  }
  if (msg?.type === "dash_timeline" && (fromDash(sender) || fromWaPage(sender))) {
    timeline(msg.chat_ids, msg.since).then(reply, (e) => reply({ ok: false, reason: String(e?.message || e) }));
    return true;
  }
  // 仪表板：只问连线状态（每几秒一次，顺便叫背景程序找本机程序）
  if (msg?.type === "dash_state" && (fromDash(sender) || fromWaPage(sender))) {
    probe(); // 只试主端口 + 上次连过的，不扫全部（免得「错误」页一直记）
    if (!sockets.has(PORTS[0]) && Date.now() - lastMainTry > 30000) { lastMainTry = Date.now(); tryConnect(PORTS[0]); } // 主端口（通常是 Claude）没连着就补试，最多 30 秒一次
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
  // 「AI 下载的文件」：只能在文件夹中显示（不打开）、清空纪录（不删文件）
  if (msg?.type === "dash_show_file" && (fromDash(sender) || fromWaPage(sender))) {
    showFile(Number(msg.download_id)).then(reply, () => reply({ ok: false }));
    return true;
  }
  // 「我的资料」：这个插件在这台电脑存了什么、清除（不删已下载的文件）
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
  // 「仪表板」= 在 WhatsApp Web 页面里打开（不另开插件页面）
  if (msg?.type === "open_dashboard" && (fromPopup(sender) || fromDash(sender))) {
    openDashboardInWhatsApp().then(reply, () => reply({ ok: false }));
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
  // 删一条草稿：只有插件自己的弹窗和仪表板可以（AI 没有这个工具）
  if (msg?.type === "remove_draft" && (fromPopup(sender) || fromDash(sender) || fromWaPage(sender))) {
    removeDraft(String(msg.id || "")).then((ok) => reply({ ok }), (e) => reply({ ok: false, reason: String(e?.message || e) }));
    return true;
  }
  if (msg?.type === "ui_clear_drafts" && fromPopup(sender)) {
    clearDrafts().then(() => reply({ ok: true }), (e) => reply({ ok: false, reason: String(e?.message || e) }));
    return true;
  }
  // WhatsApp 页面刚打开：马上去连本机程序
  if (msg?.type === "wa_opened" && fromWaPage(sender)) {
    connectAll(true);
    reply({ ok: true });
    return false;
  }
  if (msg?.type === "wa_refresh_index" && fromPopup(sender)) { askIndexRefresh(); reply({ ok: true }); return false; }
  if (msg?.type === "state" && (fromPopup(sender) || fromDash(sender))) {
    if (fromPopup(sender)) mark("last_popup");
    connectAll(!!msg.force); // 用户点开弹窗：全部端口找一遍
    // 给连线一点时间
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
