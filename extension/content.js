// WhatsApp 页面里的「AI 草稿」预览卡。
// - 只在你打开的对话有草稿时出现，浮在输入框上方（挂在 <body> 最后，不改 WhatsApp 自己的画面结构）
// - 「填入输入框」：你亲手点（event.isTrusted）才把文字放进输入框；**不按发送、不按 Enter**
//   发送由你自己按 WhatsApp 的发送键
// - 不读、不送任何东西到外面；文字只用 textContent 显示
(() => {
  // 插件更新后会再放一份进来：先把旧的那份拿掉（旧的程序也会自己停）
  document.querySelectorAll("[data-wa-readonly-card]").forEach((n) => n.remove());
  try { chrome.runtime.sendMessage({ type: "wa_opened" }).catch(() => {}); } catch (_) {}

  // 即时索引（indexer.js，在 WhatsApp 页面里）送来的「变动」：只写有变动的对话（每个对话一个 key：c:<id>），
  // 加上一份小的总览（wa_meta：总数、统计、等你回、最近 100 个）。都放 chrome.storage.session（只在记忆体）。
  const IDX = "ab-wa-index-v2";
  let pending = null, flushTimer = null;
  // 页面送来的东西先检查形状和大小：只收看起来像对话 id 的 key、普通资料，太大就丢掉
  const okId = (id) => typeof id === "string" && id.length <= 120 && /^[\w.@:-]+$/.test(id);
  const small = (o, max) => { try { return o && typeof o === "object" && !Array.isArray(o) && JSON.stringify(o).length <= max; } catch (_) { return false; } };
  const merge = (d) => {
    if (!pending) pending = { reset: false, upserts: new Map(), removes: new Set(), meta: null };
    if (d.reset === true) { pending.reset = true; pending.upserts.clear(); pending.removes.clear(); }
    for (const r of (Array.isArray(d.upserts) ? d.upserts : []).slice(0, 5000)) {
      if (!r || !okId(r.id) || !small(r, 4000) || typeof r.name !== "string") continue;
      pending.upserts.set(r.id, r); pending.removes.delete(r.id);
    }
    for (const id of (Array.isArray(d.removes) ? d.removes : []).slice(0, 5000)) if (okId(id)) { pending.removes.add(id); pending.upserts.delete(id); }
    if (d.meta && small(d.meta, 400000)) pending.meta = d.meta;
  };
  const flush = async () => {
    flushTimer = null;
    if (!pending || !chrome.runtime?.id) return;
    const p = pending; pending = null;
    try {
      if (p.reset) {
        const all = await chrome.storage.session.get(null);
        const old = Object.keys(all).filter((k) => k.startsWith("c:") && !p.upserts.has(k.slice(2)));
        if (old.length) await chrome.storage.session.remove(old);
      }
      const set = {};
      for (const [id, r] of p.upserts) set["c:" + id] = r;
      if (p.meta) set.wa_meta = p.meta;
      if (Object.keys(set).length) await chrome.storage.session.set(set);
      if (p.removes.size) await chrome.storage.session.remove([...p.removes].map((id) => "c:" + id));
    } catch (_) {}
  };
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.__ab !== IDX) return;
    if (e.data.ready === false) { merge({ meta: { v: 2, at: new Date().toISOString(), ready: false } }); }
    else if (e.data.meta || e.data.upserts) merge(e.data);
    else return;
    if (!flushTimer) flushTimer = setTimeout(flush, 400);
  });
  // 设定：超过 X 天的等待自动当作「不用回」→ 告诉索引
  const sendConfig = () => {
    try {
      chrome.storage.local.get("auto_ignore_days").then((r) => window.postMessage({ __ab: IDX, want: "config", autoIgnoreDays: Number(r.auto_ignore_days) || 0 }, location.origin)).catch(() => {});
    } catch (_) {}
  };
  sendConfig();
  setTimeout(sendConfig, 3000); // 索引可能比这里晚载入
  try { chrome.storage.onChanged.addListener((c, area) => { if (area === "local" && c.auto_ignore_days) sendConfig(); }); } catch (_) {}
  // 插件重新载入后，存的那份可能没了：请索引全部重送一次
  try { chrome.storage.session.get("wa_meta").then((r) => { if (!r.wa_meta) window.postMessage({ __ab: IDX, want: "all" }, location.origin); }).catch(() => {}); } catch (_) {}
  // 弹窗刚打开：叫索引马上更新一次
  try {
    chrome.runtime.onMessage.addListener((m, sender) => {
      if (sender.id === chrome.runtime.id && m?.type === "wa_refresh_index") window.postMessage({ __ab: IDX, want: "now" }, location.origin);
    });
  } catch (_) {}

  const host = document.createElement("div");
  host.setAttribute("data-wa-readonly-card", "");
  host.style.cssText = "position:fixed;z-index:2147483000;left:0;top:0;width:0;height:0;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
<style>
:host { all: initial; }
.wrap { position: fixed; font: 14px/1.45 "Inter Tight", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif;
  --bg:#faf5ee; --fg:#221b10; --muted:#6b6253; --line:#e4dacb; --primary:#f5c83b; --on-primary:#221b10; --chip:#f2ebdf; --focus:#221b10; --accent:#221b10; }
.dark .wrap, .wrap.dark { --bg:#1c160d; --fg:#faf5ee; --muted:#b9ae9c; --line:#3d3322; --primary:#f5c83b; --on-primary:#221b10; --chip:#2a2316; --focus:#f5c83b; --accent:#f5c83b; }
.card { background:var(--bg); color:var(--fg); border:1px solid var(--line); border-top:3px solid var(--primary); border-radius:4px;
  box-shadow:0 6px 24px rgba(0,0,0,.18); padding:10px 12px 10px; }
.head { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
.badge { display:inline-flex; align-items:center; gap:4px; font-weight:700; font-size:12px; color:var(--accent); }
.meta { color:var(--muted); font-size:12px; white-space:nowrap; }
.spacer { flex:1; }
.safe { display:inline-flex; align-items:center; gap:4px; font-size:11px; color:var(--muted); background:var(--chip); border-radius:999px; padding:2px 8px; white-space:nowrap; }
.text { white-space:pre-wrap; word-break:break-word; max-height:132px; overflow:auto; padding:8px 10px;
  background:var(--chip); border-radius:3px; margin-bottom:8px; }
.row { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
button { font:inherit; font-size:13px; border-radius:3px; padding:6px 12px; min-height:32px; cursor:pointer;
  border:1px solid var(--line); background:var(--bg); color:var(--fg); display:inline-flex; align-items:center; gap:6px;
  transition: background-color .15s ease, border-color .15s ease; }
button:hover { border-color:var(--fg); }
button:focus-visible { outline:2px solid var(--focus); outline-offset:2px; }
button.primary { background:var(--primary); border-color:var(--primary); color:var(--on-primary); font-weight:600; }
button.primary:hover { filter:brightness(1.06); }
button.ghost { border-color:transparent; background:transparent; color:var(--muted); }
.msg { font-size:12px; color:var(--muted); margin-left:4px; }
.pill { border-radius:999px; padding:4px 12px; min-height:28px; font-size:12px; font-weight:700; color:var(--on-primary);
  border:1px solid var(--primary); background:var(--primary); box-shadow:0 2px 10px rgba(0,0,0,.12); }
svg { width:14px; height:14px; flex:none; }
[hidden] { display:none !important; }
/* 对话里的「不用回」小按钮：在对话标题下方靠右 */
.nr { position: fixed; display: flex; align-items: center; gap: 8px; padding: 4px 6px 4px 12px; border-radius: 18px;
  background: #ffffff; border: 1px solid #d1d7db; box-shadow: 0 1px 3px rgba(11,20,26,.12);
  font: 13px/1.3 "Segoe UI", "Helvetica Neue", Helvetica, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; color: #3b4a54; }
.nr-btn { font: inherit; font-weight: 600; border: 0; border-radius: 14px; padding: 4px 10px; cursor: pointer; background: #e7fce3; color: #008069; }
.nr-btn:hover { background: #d9fdd3; }
.nr-btn:focus-visible { outline: 2px solid #00a884; outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { button { transition:none; } }
</style>
<div class="nr" id="nr" hidden>
  <span class="nr-txt" id="nrTxt"></span>
  <button class="nr-btn" id="nrBtn"></button>
</div>
<div class="wrap" hidden>
  <div class="card" role="region" aria-label="AI 草稿预览">
    <div class="head">
      <span class="badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.9 2.1 2.1.9-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/></svg>AI 草稿</span>
      <span class="meta" id="meta"></span>
      <span class="spacer"></span>
      <span class="safe"><svg style="width:13px;height:13px" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l8.5 3.2V12c0 5.3-3.7 8.6-8.5 10-4.8-1.4-8.5-4.7-8.5-10V5.2z" fill="#25d366"/><path d="M8.3 12.2l2.6 2.6 5-5.2" fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>只预览 · 不会自动发送</span>
      <button class="ghost" id="collapse" aria-label="收起草稿"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
    </div>
    <div class="text" id="text"></div>
    <div class="row">
      <button class="primary" id="fill"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 5v14M5 12l7 7 7-7"/></svg><span id="fillLabel">填入输入框</span></button>
      <button id="copy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>复制</button>
      <button class="ghost" id="dismiss">不用了</button>
      <span class="msg" id="msg" aria-live="polite"></span>
    </div>
  </div>
  <button class="pill" id="expand" hidden>AI 草稿 · 点开看</button>
</div>`;
  AB_LANG_READY.then(() => localizeDOM(root, {
    "AI 草稿预览": "AI draft preview", "收起草稿": "Collapse draft", "AI 草稿": "AI draft",
    "只预览 · 不会自动发送": "Preview only · never sent automatically", "填入输入框": "Fill in", "复制": "Copy",
    "不用了": "Dismiss", "AI 草稿 · 点开看": "AI draft · click to view"
  }));
  document.documentElement.appendChild(host);

  const $ = (id) => root.getElementById(id);
  const wrap = root.querySelector(".wrap");
  const card = root.querySelector(".card");
  let current = null;      // 现在显示的草稿
  let collapsed = false;
  let confirmReplace = false;
  let lastHeader = "";

  const footer = () => document.querySelector("#main footer");
  const composer = () => document.querySelector('#main footer div[contenteditable="true"]');

  function ago(iso) {
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (s < 60) return tr("刚刚", "just now");
    if (s < 3600) return Math.floor(s / 60) + tr(" 分钟前", " min ago");
    if (s < 86400) return Math.floor(s / 3600) + tr(" 小时前", " h ago");
    return Math.floor(s / 86400) + tr(" 天前", " days ago");
  }

  function place() {
    const f = footer();
    if (!current || !f) { wrap.hidden = true; return; }
    const r = f.getBoundingClientRect();
    if (!r.width) { wrap.hidden = true; return; }
    wrap.hidden = false;
    wrap.classList.toggle("dark", document.body.classList.contains("dark") || document.documentElement.classList.contains("dark") ||
      (!document.body.classList.length && matchMedia("(prefers-color-scheme: dark)").matches));
    wrap.style.left = r.left + 12 + "px";
    wrap.style.width = Math.max(240, r.width - 24) + "px";
    wrap.style.bottom = window.innerHeight - r.top + 8 + "px";
    card.hidden = collapsed;
    $("expand").hidden = !collapsed;
  }

  function show(d) {
    if (!d) { current = null; place(); return; }
    if (!current || current.id !== d.id) { collapsed = false; confirmReplace = false; $("msg").textContent = ""; }
    current = d;
    $("text").textContent = d.text;
    const st = d.status === "inserted" ? tr(" · 已填入", " · filled in") : d.status === "copied" ? tr(" · 已复制", " · copied") : "";
    $("meta").textContent = (d.chat_name ? tr("给 ", "For ") + d.chat_name + " · " : "") + ago(d.created_at) + st; // 看得到这份草稿是给谁的
    $("fillLabel").textContent = confirmReplace ? tr("替换输入框里的字？再点一次", "Replace the text in the box? Click again") : tr("填入输入框", "Fill in");
    place();
  }

  // 只显示「现在打开的这个对话」的草稿：每次问都编号，过时的回覆（问的时候是别的对话）丢掉
  let seq = 0;
  // 对话的名字（不是整个标头：标头里还有「在线上」「输入中…」，会一直变）
  const headerText = () => {
    const h = document.querySelector("#main header");
    if (!h) return "";
    const t = h.querySelector('span[dir="auto"]');
    return t ? t.textContent || "" : h.textContent || "";
  };
  async function refresh() {
    const my = ++seq, hdr = headerText();
    let r = null;
    if (!chrome.runtime?.id) { show(null); return; } // 插件重新载入过：旧卡片收起来
    try { r = await chrome.runtime.sendMessage({ type: "card_drafts" }); } catch (_) { if (my === seq) show(null); return; }
    if (my !== seq || hdr !== headerText()) return; // 等回覆的时候换过对话
    const d = r?.drafts?.[0] || null;
    show(d && r?.chat?.id && d.chat_id === r.chat.id ? d : null);
    activeChatId = r?.chat?.id || null;
    renderNoReply();
  }

  // ---------- 对话里的「不用回」按钮 ----------
  // 打开的对话如果在「等你回」：显示「不用回」；按了之后显示「已标为不用回 · 复原」。
  // 对方再传新信息就会自动回到「等你回」（记录的是对方最后一条信息的时间）。
  let activeChatId = null, nrRow = null;
  async function renderNoReply() {
    const box = $("nr");
    if (!activeChatId || !chrome.runtime?.id) { box.hidden = true; return; }
    let row = null, ig = {}, days = 0;
    try {
      row = (await chrome.storage.session.get("c:" + activeChatId))["c:" + activeChatId] || null;
      const l = await chrome.storage.local.get(["ignored_waiting", "auto_ignore_days"]);
      ig = l.ignored_waiting || {}; days = Number(l.auto_ignore_days) || 0;
    } catch (_) {}
    nrRow = row;
    const waiting = row && row.awaiting_my_reply === true && !row.is_official && row.since;
    const autoOld = waiting && days > 0 && Date.now() - Date.parse(row.since) > days * 86400000;
    if (!waiting || autoOld) { box.hidden = true; return; }
    const marked = ig[row.id] && ig[row.id] === (row.last || row.since);
    $("nrTxt").textContent = marked ? tr("已标为不用回", "Marked No reply needed") : tr("在等你回", "Waiting for your reply");
    $("nrBtn").textContent = marked ? tr("复原", "Undo") : tr("不用回", "No reply needed");
    $("nrBtn").title = marked ? "" : tr("先不算在「等你回」里，对方再传新信息才会回来", "Hide from \"Waiting\" until they send a new message");
    box.hidden = false;
    placeNoReply();
  }
  function placeNoReply() {
    const box = $("nr");
    const h = document.querySelector("#main header");
    if (box.hidden || !h) { if (!h) box.hidden = true; return; }
    const r = h.getBoundingClientRect();
    box.style.top = Math.round(r.bottom + 10) + "px";
    box.style.right = Math.round(window.innerWidth - r.right + 16) + "px";
  }
  $("nrBtn").addEventListener("click", async (e) => {
    if (!e.isTrusted || !nrRow) return;
    try {
      const cur = (await chrome.storage.local.get("ignored_waiting")).ignored_waiting || {};
      const key = nrRow.last || nrRow.since;
      if (cur[nrRow.id] && cur[nrRow.id] === key) delete cur[nrRow.id]; else cur[nrRow.id] = key;
      await chrome.storage.local.set({ ignored_waiting: cur });
    } catch (_) {}
    renderNoReply();
  });
  try {
    chrome.storage.onChanged.addListener((c, area) => {
      if ((area === "local" && (c.ignored_waiting || c.auto_ignore_days)) || (area === "session" && activeChatId && c["c:" + activeChatId])) renderNoReply();
    });
  } catch (_) {}

  const mark = (status, d = current) => { try { if (d) chrome.runtime.sendMessage({ type: "card_mark", id: d.id, status }).catch(() => {}); } catch (_) {} };

  // 把草稿放进输入框：模拟「贴上」，不模拟任何按键，不按发送
  function fillComposer(text) {
    const box = composer();
    if (!box) return false;
    box.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(box);
    sel.removeAllRanges();
    sel.addRange(range);
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    setTimeout(() => {
      const now = (box.innerText || "").replace(/\s+/g, "");
      if (!now.includes(text.replace(/\s+/g, "").slice(0, 20))) document.execCommand("insertText", false, text);
    }, 80);
    return true;
  }

  $("fill").addEventListener("click", async (e) => {
    if (!e.isTrusted || !current) return; // 只认真人点击
    // 按下去的那一刻再确认：打开的对话就是这份草稿的对话，不然不填（换了对话还没更新的卡片）
    const want = current;
    let a = null;
    try { a = await chrome.runtime.sendMessage({ type: "card_active_chat" }); } catch (_) {}
    // 以 WhatsApp 自己说的「现在打开的对话」为准（卡片在等待时被收起来也没关系）
    if (!a?.chat?.id || a.chat.id !== want.chat_id) {
      $("msg").textContent = tr("对话换了，这份草稿不是给这个对话的。", "The chat changed; this draft is not for this chat.");
      confirmReplace = false; show(null); refresh(); return;
    }
    const box = composer();
    if (!box) { $("msg").textContent = tr("找不到输入框", "Can't find the message box"); return; }
    const existing = (box.innerText || "").trim();
    if (existing && !confirmReplace) { confirmReplace = true; show(want); return; }
    confirmReplace = false;
    if (fillComposer(want.text)) {
      mark("inserted", want);
      $("msg").textContent = tr("✓ 已填入。看一下、改一改，再自己按发送。", "✓ Filled in. Check it, edit if needed, then press send yourself.");
      want.status = "inserted";
      show(want);
    }
  });
  $("copy").addEventListener("click", async (e) => {
    if (!e.isTrusted || !current) return;
    try { await navigator.clipboard.writeText(current.text); $("msg").textContent = tr("已复制", "Copied"); mark("copied"); }
    catch (_) { $("msg").textContent = tr("复制失败，请手动选取", "Couldn't copy. Please select the text manually."); }
  });
  $("dismiss").addEventListener("click", (e) => {
    if (!e.isTrusted || !current) return;
    mark("dismissed");
    show(null);
  });
  $("collapse").addEventListener("click", (e) => { if (e.isTrusted) { collapsed = true; place(); } });
  $("expand").addEventListener("click", (e) => { if (e.isTrusted) { collapsed = false; place(); } });

  // 换对话 → 重新问；草稿清单变了 → 重新问；每 15 秒保底一次
  let lastAsk = 0;
  const tick = setInterval(() => {
    // 插件被重新载入了：这一份收起来，新的那份会接手
    if (!chrome.runtime?.id) { clearInterval(tick); host.remove(); return; }
    if (document.hidden) return;
    const h = headerText();
    const changed = h !== lastHeader;
    lastHeader = h;
    if (changed) { seq++; confirmReplace = false; show(null); } // 换对话：先把旧卡片收起来
    if (changed || Date.now() - lastAsk > 15000) { lastAsk = Date.now(); h ? refresh() : (show(null), (activeChatId = null), renderNoReply()); }
    else place();
  }, 1200);
  chrome.storage.onChanged.addListener((c, area) => { if (area === "local" && c.drafts) refresh(); });
  window.addEventListener("resize", () => { place(); placeNoReply(); });
})();
