// 界面语言：浏览器是中文就用中文，其他用英文（i18n.js）
await AB_LANG_READY;
localizeDOM(document, {
  "只读，绝不发送": "Read-only, never sends",
  "连接中…": "Connecting…", "配对码": "Pairing code", "配对": "Pair",
  "在 AI（Claude 或 ChatGPT）里问「WhatsApp 状态」，它会给你 6 位数配对码（3 分钟内有效）。": "Ask your AI (Claude or ChatGPT) \"WhatsApp status\". It gives you a 6-digit pairing code.",
  "分类": "Views", "等我回": "Waiting", "AI 草稿": "AI drafts", "全部": "All",
  "打开仪表板": "Open dashboard", "在 WhatsApp Web 里打开仪表板": "Open the dashboard in WhatsApp Web",
  "重新读取": "Refresh", "搜对话": "Search chats", "搜对话名称 / 内容": "Search chat names / messages",
  "打开对话会标已读，对方会看到蓝勾。": "Opening a chat marks it as read; they will see blue ticks.",
  "草稿只存在这台电脑，保留 90 天。": "Drafts stay on this computer for 90 days.", "请让电脑开着，Chrome 和 WhatsApp Web 也保持打开，AI 才读得到。": "Keep your computer on, with Chrome and WhatsApp Web open, so your AI can read it.", "清空草稿": "Clear drafts"
});
// 弹窗：等我回 / AI 草稿 / 全部对话。
// 没有任何发信息按钮。「打开对话」只在你点时执行（会标已读）。
// 不把对话内容写进 console。
const $ = (s) => document.querySelector(s);
const listEl = $("#list");
const statusEl = $("#status");
const kwEl = $("#kw");

const state = { tab: "waiting", waiting: [], drafts: [], chats: [], loaded: false, error: null };

const ICON = {
  open: '<path d="M14 3h7v7"/><path d="M10 14L21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'
};
function svg(name) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "2"); s.setAttribute("aria-hidden", "true");
  s.innerHTML = ICON[name]; // 固定图示，不含任何对话内容
  return s;
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text; // 对话内容只用 textContent
  return e;
}
function ago(iso) {
  if (!iso) return "";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return tr("刚刚", "just now");
  if (s < 3600) return Math.floor(s / 60) + tr(" 分钟前", " min ago");
  if (s < 86400) return Math.floor(s / 3600) + tr(" 小时前", " h ago");
  if (s < 86400 * 7) return Math.floor(s / 86400) + tr(" 天前", " days ago");
  return new Date(iso).toLocaleDateString(AB_LANG === "zh" ? "zh-CN" : "en-GB");
}
function waited(h) {
  if (h == null) return "";
  if (h < 1) return tr("等了不到 1 小时", "waiting < 1 h");
  if (h < 48) return tr(`等了 ${Math.round(h)} 小时`, `waiting ${Math.round(h)} h`);
  return tr(`等了 ${Math.round(h / 24)} 天`, `waiting ${Math.round(h / 24)} days`);
}
// 最多等 15 秒；背景程序没回应也不会一直显示「正在读取」
const send = (msg, ms = 15000) => Promise.race([
  chrome.runtime.sendMessage(msg).catch(() => null),
  new Promise((resolve) => setTimeout(() => resolve({ ok: false, code: "TIMEOUT", reason: tr("插件太久没回应，请按右上角重新读取", "The extension took too long. Press refresh at the top right") }), ms))
]);

function button(label, icon, cls, onClick) {
  const b = el("button", "btn" + (cls ? " " + cls : ""));
  if (icon) b.append(svg(icon));
  b.append(document.createTextNode(label));
  b.addEventListener("click", (e) => { if (e.isTrusted) onClick(e, b); });
  return b;
}
async function openChat(chatId, fb) {
  fb.textContent = tr("打开中…", "Opening…");
  const r = await send({ type: "open_chat", chat_id: chatId });
  fb.textContent = r?.ok ? tr("已打开", "Opened") : (r?.reason || tr("打不开", "Couldn't open"));
}

const pendingDraftChats = () => new Set(state.drafts.filter((d) => d.status === "pending").map((d) => d.chat_id));

function renderWaiting(kw) {
  const hasDraft = pendingDraftChats();
  const rows = state.waiting.filter((c) => !kw || c.name.toLowerCase().includes(kw) || (c.their_last_message || "").toLowerCase().includes(kw));
  if (rows.length >= 2 && !kw) {
    const li = el("li", "ignored-note");
    const b = button(tr("全部标为不用回", "Mark all as No reply needed"), "", "link-btn", (e, btn) => {
      if (!ignoreAllArmed) {
        ignoreAllArmed = true;
        btn.textContent = tr(`确定把 ${rows.length} 个都标为不用回？再点一次`, `Mark all ${rows.length}? Click again`);
        setTimeout(() => { ignoreAllArmed = false; btn.textContent = tr("全部标为不用回", "Mark all as No reply needed"); }, 4000);
        return;
      }
      ignoreAllArmed = false;
      ignoreMany(rows);
    });
    li.append(el("span", "", tr(`${rows.length} 个在等你回`, `${rows.length} waiting for your reply`)), b);
    listEl.append(li);
  }
  if (state.ignored) {
    const li = el("li", "ignored-note");
    li.append(el("span", "", tr(`另外 ${state.ignored} 个你标了「不用回」`, `${state.ignored} more marked \"No reply needed\"`)), button(tr("全部还原", "Restore all"), "", "link-btn", clearIgnored));
    listEl.append(li);
  }
  // 查失败就说出来，不要假装「没有人在等你回」
  if (state.waitingError && !state.waiting.length) return empty(tr("查不到谁在等你回", "Couldn't check who's waiting"), state.waitingError);
  if (!kw && !state.allLoaded && (state.waitingTotal || 0) > state.waiting.length) {
    const li = el("li", "ignored-note");
    li.append(el("span", "", tr(`显示等最久的 ${state.waiting.length} 个，共 ${state.waitingTotal} 个`, `Showing the ${state.waiting.length} longest-waiting of ${state.waitingTotal}`)),
      button(tr("显示全部", "Show all"), "", "link-btn", async () => { await loadAllChats(); await fromSnapshot(); render(); }));
    listEl.append(li);
  }
  if (!rows.length) return empty(state.waiting.length ? tr("没有符合的对话", "No matching chats") : tr("没有人在等你回", "No one is waiting for your reply"), state.waiting.length ? "" : tr("对方最后发、你还没回的对话会出现在这里。", "Chats where they spoke last and you haven't replied show up here."));
  for (const c of rows) {
    const li = el("li", "item");
    const l1 = el("div", "line1");
    l1.append(el("span", "name", c.name));
    if (c.is_group) l1.append(el("span", "tag", tr("群", "Group")));
    l1.append(el("span", "time", waited(c.waiting_hours)));
    const l2 = el("div", "line2");
    const who = c.is_group && c.their_last_sender ? c.their_last_sender + "：" : "";
    l2.append(el("span", "preview", c.their_last_message ? who + c.their_last_message : tr("（电脑里没存这条信息）", "(message not stored on this computer)")));
    if (hasDraft.has(c.id)) l2.append(el("span", "tag draft", tr("有草稿", "Has draft")));
    if (c.unread > 0) l2.append(el("span", "unread", String(c.unread)));
    const fb = el("span", "feedback");
    const act = el("div", "actions");
    act.append(button(tr("打开对话", "Open chat"), "open", "", () => openChat(c.id, fb)),
      Object.assign(button(tr("不用回", "No reply needed"), "", "", () => ignoreChat(c)), { title: tr("先不算在「等我回」里，对方再传新信息才会回来", "Hide from \"Waiting for you\" until they send a new message") }), fb);
    li.append(l1, l2, act);
    listEl.append(li);
  }
}

// 「不用回」：跟 WhatsApp 里的仪表板共用同一份清单（chrome.storage.local 的 ignored_waiting）
async function ignoreChat(c) {
  const { ignored_waiting: cur = {} } = await chrome.storage.local.get("ignored_waiting");
  cur[c.id] = c.last || c.since;
  await chrome.storage.local.set({ ignored_waiting: cur });
  load();
}
let ignoreAllArmed = false;
async function ignoreMany(list) {
  const { ignored_waiting: cur = {} } = await chrome.storage.local.get("ignored_waiting");
  for (const c of list) cur[c.id] = c.last || c.since;
  await chrome.storage.local.set({ ignored_waiting: cur });
  load();
}
async function clearIgnored() {
  await chrome.storage.local.remove("ignored_waiting");
  load();
}

const STATUS = {
  pending: [tr("待用", "Unused"), "draft"], inserted: [tr("已填入", "Filled in"), "draft"], copied: [tr("已复制", "Copied"), "draft"],
  replied: [tr("已回复", "Replied"), ""], dismissed: [tr("不用了", "Dismissed"), ""], superseded: [tr("已被新草稿取代", "Replaced by a newer draft"), ""]
};
function renderDrafts(kw) {
  const rows = state.drafts.filter((d) => !kw || d.chat_name.toLowerCase().includes(kw) || d.text.toLowerCase().includes(kw));
  if (!rows.length) return empty(state.drafts.length ? tr("没有符合的草稿", "No matching drafts") : tr("还没有 AI 草稿", "No AI drafts yet"), state.drafts.length ? "" : tr("在 Claude 或 ChatGPT 说「帮我起草回复给某某」，草稿会出现在这里和 WhatsApp 输入框上方。", "Ask Claude or ChatGPT \"draft a reply to …\". Drafts show up here and above the WhatsApp message box."));
  for (const d of rows) {
    // 新草稿：还没用、之后还没回、7 天内存的 → 淡黄底 + 「新」
    const fresh = d.status === "pending" && !d.actual_reply && Date.now() - Date.parse(d.created_at) < 7 * 86400000;
    const li = el("li", fresh ? "item new" : "item");
    const l1 = el("div", "line1");
    l1.append(el("span", "name", d.chat_name));
    const [label, cls] = fresh ? [tr("新", "New"), "new"] : STATUS[d.status] || [d.status, ""];
    l1.append(el("span", "tag " + cls, label), el("span", "time", ago(d.created_at)));
    const txt = el("div", "draft-text", d.text);
    txt.tabIndex = 0;
    txt.setAttribute("role", "button");
    txt.setAttribute("aria-label", tr("展开 / 收起草稿全文", "Show / hide the full draft"));
    const toggle = () => txt.classList.toggle("open");
    txt.addEventListener("click", toggle);
    txt.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    li.append(l1, txt);
    if (d.actual_reply) {
      const a = el("div", "actual");
      a.append(el("b", null, tr("你实际回了：", "You actually sent: ")), document.createTextNode(d.actual_reply.text || tr("（非文字）", "(not text)")));
      li.append(a);
    }
    const fb = el("span", "feedback");
    const act = el("div", "actions");
    act.append(
      button(tr("打开对话", "Open chat"), "open", "primary", () => openChat(d.chat_id, fb)),
      button(tr("复制", "Copy"), "copy", "", async () => {
        try { await navigator.clipboard.writeText(d.text); fb.textContent = tr("已复制", "Copied"); send({ type: "card_mark", id: d.id, status: "copied" }); }
        catch (_) { fb.textContent = tr("复制失败", "Copy failed"); }
      }),
      fb
    );
    li.append(act);
    listEl.append(li);
  }
}

function renderAll(kw) {
  if (kw && !state.allLoaded && state.meta) { loadAllChats().then(render); }
  const hasDraft = pendingDraftChats();
  const rows = state.chats.filter((c) => !kw || c.name.toLowerCase().includes(kw) || (c.last_preview || "").toLowerCase().includes(kw));
  if (!rows.length) return empty(tr("没有符合的对话", "No matching chats"), "");
  const more = !state.allLoaded && state.totalChats > rows.length && !kw;
  for (const c of rows) {
    const li = el("li", "item");
    const l1 = el("div", "line1");
    l1.append(el("span", "name", c.name));
    if (c.is_group) l1.append(el("span", "tag", tr("群", "Group")));
    if (c.is_official) l1.append(el("span", "tag", tr("官方", "Official")));
    l1.append(el("span", "time", ago(c.last_time)));
    const l2 = el("div", "line2");
    const who = c.last_preview == null ? "" : c.last_from_me ? tr("我：", "Me: ") : "";
    l2.append(el("span", "preview", c.last_preview == null ? tr("（电脑里没存信息）", "(no messages stored on this computer)") : who + c.last_preview));
    if (c.awaiting_my_reply === true) l2.append(el("span", "tag wait", tr("等我回", "Waiting")));
    if (hasDraft.has(c.id)) l2.append(el("span", "tag draft", tr("有草稿", "Has draft")));
    if (c.unread > 0) l2.append(el("span", "unread", String(c.unread)));
    li.append(l1, l2);
    listEl.append(li);
  }
  if (more) {
    const li = el("li", "ignored-note");
    li.append(el("span", "", tr(`显示最近 ${rows.length} 个，共 ${state.totalChats} 个对话`, `Showing the latest ${rows.length} of ${state.totalChats} chats`)),
      button(tr("显示全部", "Show all"), "", "link-btn", async () => { await loadAllChats(); render(); }));
    listEl.append(li);
  }
}

function empty(title, body) {
  const li = el("li", "empty");
  li.append(el("strong", null, title));
  if (body) li.append(document.createTextNode(body));
  listEl.append(li);
}

function render() {
  listEl.replaceChildren();
  $("#nWaiting").textContent = state.loaded ? (state.waitingTotal ?? state.waiting.length) : "–";
  $("#nDrafts").textContent = state.drafts.filter((d) => ["pending", "inserted", "copied"].includes(d.status)).length;
  $("#nAll").textContent = state.loaded ? (state.totalChats || state.chats.length) : "–";
  $("#clearDrafts").hidden = state.tab !== "drafts" || !state.drafts.length;
  $("#noteTick").hidden = state.tab === "drafts";
  $("#noteLocal").hidden = state.tab !== "drafts";
  const kw = kwEl.value.trim().toLowerCase();
  if (state.tab === "drafts") return renderDrafts(kw);
  if (state.error) {
    statusEl.className = "status err";
    statusEl.replaceChildren(el("span", "", state.error));
    // WhatsApp Web 没开 / 睡着 / 太久没回应：给一个按钮直接打开
    if (["WA_TAB_NOT_OPEN", "WA_TAB_ASLEEP", "WA_TIMEOUT", "TIMEOUT"].includes(state.errorCode)) {
      statusEl.append(button(tr("打开 WhatsApp Web", "Open WhatsApp Web"), "open", "primary open-wa", async () => {
        await send({ type: "open_whatsapp" });
        window.close();
      }));
    }
    return;
  }
  statusEl.className = "status";
  if (!state.loaded) { statusEl.textContent = tr("正在读取…", "Reading…"); return; }
  statusEl.textContent = "";
  if (state.tab === "waiting") renderWaiting(kw); else renderAll(kw);
}

// 即时索引（chrome.storage.session）：wa_meta 是小总览，打开马上画；c:<id> 是每个对话，搜寻 / 看全部时才读
const SNAP_FRESH_MS = 90000;
async function fromSnapshot() {
  let meta = null, ig = {};
  try {
    meta = (await chrome.storage.session.get("wa_meta")).wa_meta;
    ig = (await chrome.storage.local.get("ignored_waiting")).ignored_waiting || {};
  } catch (_) { return false; }
  if (!meta || !meta.recent || meta.ready === false || Date.now() - Date.parse(meta.at) > SNAP_FRESH_MS) return false;
  state.meta = meta;
  if (!state.allLoaded) state.chats = meta.recent.filter((r) => !r.archived);
  state.totalChats = meta.total_chats;
  const isIgn = (w) => ig[w.id] && ig[w.id] === (w.last || w.since);
  if (!state.allLoaded) {
    state.waiting = meta.waiting.filter((w) => !isIgn(w));
    // 被标「不用回」的：直接查那几个对话，不扫全部
    let ignNow = 0;
    const ids = Object.keys(ig);
    if (ids.length) {
      try {
        const got = await chrome.storage.session.get(ids.map((id) => "c:" + id));
        for (const id of ids) { const r = got["c:" + id]; if (r && r.awaiting_my_reply === true && !r.archived && isIgn(r)) ignNow++; }
      } catch (_) {}
    }
    state.ignored = ignNow;
    state.waitingTotal = Math.max(0, (meta.waiting_total || 0) - ignNow);
  } else {
    const now = Date.now();
    let days = 0;
    try { days = Number((await chrome.storage.local.get("auto_ignore_days")).auto_ignore_days) || 0; } catch (_) {}
    const cut = days > 0 ? now - days * 86400000 : -Infinity;
    const all = state.chats.filter((r) => r.awaiting_my_reply === true && r.since && !r.is_official && Date.parse(r.since) >= cut)
      .map((r) => ({ ...r, waiting_hours: (now - Date.parse(r.since)) / 3600000 }))
      .sort((a, b) => b.waiting_hours - a.waiting_hours);
    state.waiting = all.filter((w) => !isIgn(w));
    state.ignored = all.length - state.waiting.length;
    state.waitingTotal = state.waiting.length;
  }
  state.waitingError = null;
  if (!meta.total_chats) { state.error = tr("WhatsApp Web 开着，但没读到对话：可能还没登入，或还在载入。", "WhatsApp Web is open but no chats were read: maybe not logged in yet, or still loading."); state.errorCode = null; }
  else { state.error = null; state.errorCode = null; state.loaded = true; }
  return true;
}
// 读全部对话（每个对话一个 key）；只在搜寻或按「显示全部」时
async function loadAllChats() {
  try {
    const all = await chrome.storage.session.get(null);
    const rows = [];
    for (const k in all) if (k.startsWith("c:") && !all[k].archived) rows.push(all[k]);
    rows.sort((a, b) => (b.last_time || "").localeCompare(a.last_time || ""));
    state.chats = rows;
    state.allLoaded = true;
  } catch (_) {}
}
let snapTimer = null;
try {
  chrome.storage.onChanged.addListener((c, area) => {
    if ((area === "session" && (c.wa_meta || (state.allLoaded && Object.keys(c).some((k) => k.startsWith("c:"))))) || (area === "local" && c.ignored_waiting)) {
      clearTimeout(snapTimer);
      snapTimer = setTimeout(async () => {
        if (state.allLoaded) await loadAllChats();
        if (await fromSnapshot()) render();
      }, 400);
    }
  });
} catch (_) {}

async function load() {
  state.error = null;
  state.errorCode = null;
  send({ type: "wa_refresh_index" });
  const drafts = send({ type: "ui_drafts" });
  if (await fromSnapshot()) {
    // 先用摘要马上画出来；草稿清单也很快
    render();
    const d = await drafts;
    state.drafts = d?.ok ? d.drafts : [];
    render();
    return;
  }
  render();
  const [w, c, d] = await Promise.all([
    send({ type: "ui_read", op: "list_awaiting_reply", params: { limit: 200 } }),
    send({ type: "ui_read", op: "list_chats", params: { limit: 500 } }),
    send({ type: "ui_drafts" })
  ]);
  state.drafts = d?.ok ? d.drafts : [];
  if (!c?.ok) {
    state.error = c?.reason || tr("读取失败", "Couldn't read");
    state.errorCode = c?.code || null;
  } else if (!c.total_chats) {
    state.error = tr("WhatsApp Web 开着，但没读到对话：可能还没登入，或还在载入。", "WhatsApp Web is open but no chats were read: maybe not logged in yet, or still loading.");
  } else {
    state.chats = c.chats;
    state.waiting = w?.ok ? w.chats : [];
    state.waitingError = w?.ok ? null : (w?.reason || tr("查不到谁在等你回", "Couldn't check who's waiting"));
    state.ignored = w?.ok ? (w.ignored_by_user || 0) : 0;
    state.loaded = true;
  }
  render();
}

document.querySelectorAll(".tab").forEach((b) =>
  b.addEventListener("click", () => {
    state.tab = b.dataset.tab;
    document.querySelectorAll(".tab").forEach((x) => {
      x.classList.toggle("active", x === b);
      x.setAttribute("aria-selected", String(x === b));
    });
    render();
  })
);
kwEl.addEventListener("input", render);
$("#refresh").addEventListener("click", async () => {
  const b = $("#refresh");
  b.classList.add("spin");
  try { await load(); } finally { b.classList.remove("spin"); }
});
$("#clearDrafts").addEventListener("click", async (e) => {
  if (!e.isTrusted) return;
  const b = e.currentTarget;
  if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = tr("确定清空全部草稿？再点一次", "Clear all drafts? Click again"); return; }
  await send({ type: "ui_clear_drafts" });
  b.dataset.confirm = ""; b.textContent = tr("清空草稿", "Clear drafts");
  state.drafts = [];
  render();
});
chrome.storage.onChanged.addListener(async (ch, area) => {
  if (area === "local" && ch.drafts) {
    const d = await send({ type: "ui_drafts" });
    if (d?.ok) { state.drafts = d.drafts; render(); }
  }
});

// ---------- 连接 Claude ----------
const claudeEl = $("#claude");
const pairBox = $("#pairBox");
const pairMsg = $("#pairMsg");
let firstState = true;
async function refreshClaude() {
  const s = await send({ type: "state", force: firstState });
  firstState = false;
  // 绿 = 已连上；黄 = 连接中 / 要配对；红 = 没连上
  if (!s) { claudeEl.textContent = tr("没连上", "Not connected"); claudeEl.className = "conn bad"; return; }
  // 跟 WhatsApp 里的仪表板一样：已连上 / 要配对 / 还没连上过 / AI 没开
  if (s.ready > 0) { claudeEl.textContent = tr("已连上 AI", "AI connected"); claudeEl.className = "conn ok"; pairBox.hidden = s.need_pair === 0; }
  else if (s.need_pair > 0) { claudeEl.textContent = tr("要配对", "Needs pairing"); claudeEl.className = "conn warn"; pairBox.hidden = false; }
  else if (s.connecting > 0) { claudeEl.textContent = tr("连接中…", "Connecting…"); claudeEl.className = "conn warn"; pairBox.hidden = true; }
  else if (!s.paired) { claudeEl.textContent = tr("还没连上 AI", "AI not connected yet"); claudeEl.className = "conn warn"; pairBox.hidden = false; }
  else { claudeEl.textContent = tr("AI 没开", "AI is closed"); claudeEl.className = "conn bad"; pairBox.hidden = true; claudeEl.title = tr("打开 Claude 或 ChatGPT 就会自动连上，不用再配对", "Open Claude or ChatGPT and it reconnects by itself; no need to pair again"); }
}
$("#pairBtn").addEventListener("click", async (e) => {
  if (!e.isTrusted) return;
  const code = $("#code").value.replace(/\D/g, "");
  if (code.length !== 6) { pairMsg.textContent = tr("配对码是 6 位数字", "The pairing code is 6 digits"); return; }
  pairMsg.textContent = tr("配对中…", "Pairing…");
  const r = await send({ type: "pair", code }, 45000);
  pairMsg.textContent = r?.ok ? tr("配对成功", "Paired") : (r?.reason || tr("配对失败", "Pairing failed"));
  if (r?.ok) $("#code").value = "";
  refreshClaude();
});

load();
refreshClaude();
setInterval(refreshClaude, 3000);

// 仪表板：切到 WhatsApp Web 分页，在里面打开
document.getElementById("dash").addEventListener("click", (e) => {
  if (!e.isTrusted) return;
  chrome.runtime.sendMessage({ type: "open_dashboard" }).finally(() => window.close());
});
