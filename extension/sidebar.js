// Adds an "AI+" icon to WhatsApp's left sidebar (right below Meta AI); clicking it opens the full-page dashboard.
// - Does not change WhatsApp's own page structure: icon and dashboard live in a closed shadow DOM outside <body>, aligned to the sidebar by position
// - Dashboard does not use an iframe: WhatsApp Web sends Cross-Origin-Embedder-Policy: require-corp, so Chrome blocks the iframe
//   ("refused to connect"). Instead the dashboard goes into another closed shadow DOM layer, which WhatsApp Web cannot read
// - Sidebar not loaded yet / not found: no icon (the bar-chart button in the extension popup also opens the dashboard)
(() => {
  // After an extension update another copy gets injected: remove the old one first
  document.querySelectorAll("[data-wa-assistant-nav]").forEach((n) => n.remove());

  const host = document.createElement("div");
  host.setAttribute("data-wa-assistant-nav", "");
  host.style.cssText = "position:fixed;z-index:2147483100;left:0;top:0;width:0;height:0;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
<style>
:host { all: initial; }
.btn { z-index: 3; position: fixed; display: none; align-items: center; justify-content: center; padding: 0; margin: 0;
  border: 0; border-radius: 50%; background: transparent; cursor: pointer; transition: background-color .15s ease; }
.btn.show { display: flex; }
.btn:hover { background: rgba(11,20,26,.08); }
.btn:focus-visible { outline: 2px solid #00a884; outline-offset: 2px; }
.btn.on, .btn.on:hover { background: transparent; }
/* When open: a short yellow vertical bar (AI+ yellow) at the sidebar's far left, no background fill */
.tab { position: fixed; display: none; width: 4px; border-radius: 0 3px 3px 0; background: #f5c83b; pointer-events: none; z-index: 2; }
.tab.show { display: block; }
.count { position: absolute; top: 1px; right: 0; min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box;
  border-radius: 9px; background: #00a884; color: #fff; border: 2px solid #f0f2f5;
  font: 600 11px/14px "Segoe UI", "Helvetica Neue", Helvetica, -apple-system, sans-serif; text-align: center; display: none; }
.count.show { display: block; }
.logo { width: 28px; height: 28px; display: block; }
.tip { z-index: 4; position: fixed; display: none; pointer-events: none; white-space: nowrap;
  font: 500 13px/1.3 "Segoe UI", "Helvetica Neue", Helvetica, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
  background: #111b21; color: #ffffff; padding: 6px 10px; border-radius: 6px; box-shadow: 0 4px 14px rgba(0,0,0,.2); }
.tip.show { display: block; }
.panel { z-index: 1; position: fixed; top: 0; bottom: 0; right: 0; display: none; background: #f0f2f5; box-shadow: -1px 0 0 #e9edef; }
.panel.show { display: block; }
.loading { font: 14px "Segoe UI", -apple-system, sans-serif; color: #667781; padding: 40px; }
@media (prefers-reduced-motion: reduce) { .btn { transition: none; } }
</style>
<button class="btn" id="btn" aria-label="AI for Business 仪表板" aria-expanded="false">
  <svg class="logo" aria-hidden="true" viewBox="0 0 26 26"><rect width="26" height="26" rx="7" fill="#f5c83b"/><g transform="translate(6.25 4.64) scale(0.034)"><path fill="#111111" fill-rule="evenodd" d="M1 414L121 78H200L320 414H247L222 340H95L68 414ZM159 147L204 284H113Z"/><rect x="324" y="78" width="72" height="337" fill="#111111"/><rect x="438" y="-6" width="46" height="138" rx="6" fill="#ffffff"/><rect x="400" y="41" width="130" height="46" rx="6" fill="#ffffff"/></g></svg>
  <span class="count" id="count" aria-hidden="true"></span>
</button>
<div class="tab" id="tab" aria-hidden="true"></div>
<div class="tip" id="tip" role="tooltip">AI for Business · 仪表板</div>
<div class="panel" id="panel" role="dialog" aria-label="AI for Business 仪表板"></div>`;
  AB_LANG_READY.then(() => localizeDOM(root, { "AI for Business 仪表板": "AI for Business dashboard", "AI for Business · 仪表板": "AI for Business · Dashboard" }));
  document.documentElement.appendChild(host);

  const btn = root.getElementById("btn");
  const tip = root.getElementById("tip");
  const panel = root.getElementById("panel");
  const tab = root.getElementById("tab");
  const countEl = root.getElementById("count");
  let open = false;
  let railRight = 0;
  let dash = null;      // what mount() returns
  let assets = null;    // dashboard HTML / CSS (fetched once from the background script)

  // Find the left sidebar: scan the leftmost strip of the screen top to bottom and collect each icon button
  function railItems() {
    const seen = new Set();
    const items = [];
    for (const x of [32, 30, 36, 28]) {
      for (let y = 8; y < innerHeight - 8; y += 6) {
        for (const el of document.elementsFromPoint(x, y)) {
          if (el === host) continue;
          const c = el.closest('button,[role="button"],a,[tabindex="0"],[tabindex="-1"]');
          if (!c || seen.has(c)) { if (c) break; continue; }
          const r = c.getBoundingClientRect();
          if (r.width >= 24 && r.width <= 64 && r.height >= 24 && r.height <= 64 && r.left < 40) {
            seen.add(c);
            items.push({ c, r });
          }
          break;
        }
      }
      if (items.length >= 3) break;
    }
    return items.sort((a, b) => a.r.top - b.r.top);
  }

  function findRail() {
    const items = railItems();
    if (items.length < 3) return null;
    // Top group (Chats, Calls, Status, Channels, Communities, Meta AI): the ones in the top half, close together
    const top = [];
    for (const it of items) {
      if (it.r.top > innerHeight * 0.6) break;
      if (top.length && it.r.top - top[top.length - 1].r.bottom > 120) break;
      top.push(it);
    }
    if (top.length < 2) return null;
    const last = top[top.length - 1]; // usually Meta AI
    // Spacing: the most common gap between icons in the top group
    const gaps = [];
    for (let i = 1; i < top.length; i++) gaps.push(Math.round(top[i].r.top - top[i - 1].r.bottom));
    gaps.sort((a, b) => a - b);
    const gap = Math.max(4, Math.min(24, gaps[Math.floor(gaps.length / 2)] ?? 8));
    // Sidebar right edge: the tall, narrow layer that holds the icons
    let right = Math.max(...items.map((it) => it.r.right)) + 8;
    // Walk up: the widest "tall, narrow, touching the left edge" layer is the whole sidebar (a narrower one may sit inside; do not stop there,
    // or the dashboard covers the sidebar's right side); 200px or wider is the main view, so stop
    let el = last.c;
    for (let i = 0; i < 14 && el && el !== document.body; i++, el = el.parentElement) {
      const r = el.getBoundingClientRect();
      if (r.width > 200) break;
      if (r.height > innerHeight * 0.6 && r.left <= 8 && r.width >= last.r.width) right = Math.max(right, r.right);
    }
    return { anchor: last.r, gap, right };
  }

  function place() {
    const rail = findRail();
    if (rail) {
      const a = rail.anchor;
      const size = Math.round(Math.max(36, Math.min(40, a.width - 8))); // leave room so the highlight circle does not touch the sidebar's right edge
      btn.style.width = btn.style.height = size + "px";
      btn.style.left = Math.round(a.left + (a.width - size) / 2) + "px";
      btn.style.top = Math.round(a.bottom + rail.gap) + "px";
      btn.style.bottom = "";
      railRight = Math.round(rail.right);
    } else {
      // Sidebar not loaded yet (or not found after a WhatsApp redesign): no icon for now; the extension popup can also open the dashboard
      btn.classList.remove("show");
      if (!open) return;
      railRight = 0;
      panel.style.left = "0px";
      return;
    }
    btn.classList.add("show");
    panel.style.left = railRight + "px";
    // Yellow vertical bar: at the sidebar's far left, vertically centred on the button
    const br = btn.getBoundingClientRect();
    const h = Math.round(br.height * 0.6);
    tab.style.left = "0px";
    tab.style.top = Math.round(br.top + (br.height - h) / 2) + "px";
    tab.style.height = h + "px";
    tab.classList.toggle("show", open && railRight > 0);
  }

  async function showDashboard() {
    panel.replaceChildren(Object.assign(document.createElement("div"), { className: "loading", textContent: tr("载入中…", "Loading…") }));
    panel.classList.add("show");
    // After the extension is reloaded / updated, this page's old script has lost its link to the extension
    if (!chrome.runtime?.id) {
      panel.firstChild.textContent = tr("插件刚更新过，这一页跟插件断线了。请重新整理 WhatsApp 页面（⌘R / Ctrl+R）。", "The extension was just updated, so this page lost its connection. Reload WhatsApp (⌘R / Ctrl+R).");
      return;
    }
    try {
      if (!assets) {
        const r = await chrome.runtime.sendMessage({ type: "dash_assets" });
        if (!r?.ok) throw new Error("no assets");
        assets = r;
      }
    } catch (_) {
      panel.firstChild.textContent = chrome.runtime?.id
        ? tr("仪表板载入失败。请重新整理 WhatsApp 页面再试。", "The dashboard failed to load. Reload WhatsApp and try again.")
        : tr("插件刚更新过，这一页跟插件断线了。请重新整理 WhatsApp 页面（⌘R / Ctrl+R）。", "The extension was just updated, so this page lost its connection. Reload WhatsApp (⌘R / Ctrl+R).");
      return;
    }
    if (!open) return;
    // Second closed shadow DOM layer: dashboard styles do not affect WhatsApp, and WhatsApp cannot read inside
    const box = document.createElement("div");
    box.style.cssText = "position:absolute;inset:0;";
    const sr = box.attachShadow({ mode: "closed" });
    const doc = new DOMParser().parseFromString(assets.html, "text/html");
    doc.querySelectorAll("script,link,title,meta").forEach((n) => n.remove());
    const style = document.createElement("style");
    style.textContent = ":host{all:initial;}\n" + assets.css;
    const page = document.createElement("div");
    page.className = "page";
    page.style.height = "100%";
    for (const n of [...doc.body.childNodes]) page.appendChild(document.importNode(n, true));
    sr.append(style, page);
    panel.replaceChildren(box);
    const api = globalThis.__waAssistantDashboard;
    if (!api) { panel.replaceChildren(Object.assign(document.createElement("div"), { className: "loading", textContent: tr("仪表板程序没载入，请重新整理这一页。", "The dashboard didn't load. Please reload this page.") })); return; }
    dash = api.mount(sr, { embed: true, onClose: () => setOpen(false) });
  }

  function setOpen(v) {
    open = v;
    btn.classList.toggle("on", v);
    tab.classList.toggle("show", v && railRight > 0);
    btn.setAttribute("aria-expanded", String(v));
    tip.classList.remove("show");
    if (v) {
      place();
      showDashboard();
    } else {
      try { dash?.destroy(); } catch (_) {}
      dash = null;
      panel.classList.remove("show");
      panel.replaceChildren();
      btn.focus();
    }
  }

  btn.addEventListener("click", (e) => { if (e.isTrusted) setOpen(!open); });
  btn.addEventListener("mouseenter", () => {
    const r = btn.getBoundingClientRect();
    tip.style.left = r.right + 10 + "px";
    tip.style.top = r.top + r.height / 2 - 14 + "px";
    if (!open) tip.classList.add("show");
  });
  btn.addEventListener("mouseleave", () => tip.classList.remove("show"));

  document.addEventListener("keydown", (e) => { if (open && e.key === "Escape") setOpen(false); }, true);
  // Clicking another sidebar icon (Chats, Status…) closes the dashboard and returns to WhatsApp
  document.addEventListener("pointerdown", (e) => {
    if (open && e.isTrusted && e.clientX < railRight && !e.composedPath().includes(host)) setOpen(false);
  }, true);

  // Number on the icon: unused AI drafts (last 7 days, not replied yet, not dismissed with "Not needed")
  async function updateCount() {
    if (!chrome.runtime?.id) { countEl.classList.remove("show"); return; }
    let n = 0;
    try {
      const { drafts } = await chrome.storage.local.get("drafts");
      const since = Date.now() - 7 * 86400000;
      n = (Array.isArray(drafts) ? drafts : []).filter((d) =>
        (d.status === "pending" || d.status === "inserted" || d.status === "copied") && !d.actual_reply && Date.parse(d.created_at) >= since).length;
    } catch (_) {}
    countEl.textContent = n > 99 ? "99+" : String(n);
    countEl.classList.toggle("show", n > 0);
    const label = n ? tr(`AI for Business 仪表板（${n} 条 AI 草稿还没用）`, `AI for Business dashboard (${n} unused AI drafts)`) : tr("AI for Business 仪表板", "AI for Business dashboard");
    btn.setAttribute("aria-label", label);
    tip.textContent = n ? tr(`AI for Business · ${n} 条草稿还没用`, `AI for Business · ${n} unused drafts`) : tr("AI for Business · 仪表板", "AI for Business · Dashboard");
  }
  try {
    chrome.storage.onChanged.addListener((c, area) => {
      if (area !== "local") return;
      if (c.drafts) updateCount();
      // Language changed: reopen the dashboard so the whole view switches to the new language
      if (c.ui_lang) { updateCount(); if (open) { setOpen(false); setTimeout(() => setOpen(true), 50); } }
    });
  } catch (_) {}
  updateCount();

  // "Dashboard" pressed in the extension popup: open it here
  try {
    chrome.runtime.onMessage.addListener((m, sender) => {
      if (sender.id === chrome.runtime.id && m?.type === "open_panel" && !open) setOpen(true);
      // When opening a draft's chat: an open dashboard would cover the chat, so close it first
      if (sender.id === chrome.runtime.id && m?.type === "close_panel" && open) setOpen(false);
    });
  } catch (_) {}
  // Popup asked to open it but WhatsApp had not loaded yet: open automatically once the sidebar appears (valid for 2 minutes)
  let pendingChecked = false;
  async function maybeOpenPending() {
    if (pendingChecked || !btn.classList.contains("show") || !chrome.runtime?.id) return;
    pendingChecked = true;
    const { open_dash_at: t } = await chrome.storage.local.get("open_dash_at");
    if (t && Date.now() - t < 120000) { await chrome.storage.local.remove("open_dash_at"); if (!open) setOpen(true); }
  }

  const tick = setInterval(() => {
    // Extension was reloaded: this copy is no longer used, so shut it down (the new copy takes over)
    if (!chrome.runtime?.id) { clearInterval(tick); if (!open) host.remove(); return; }
    if (!document.hidden) { place(); maybeOpenPending(); }
  }, 1000);
  window.addEventListener("resize", place);
  place();
})();
