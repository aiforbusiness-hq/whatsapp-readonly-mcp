// Language: English by default. Chinese only when the user picks Chinese in the dashboard settings,
// or picks "Same as browser" and the browser UI language is Chinese (zh, zh-CN, zh-TW…).
// Loaded first everywhere (background, popup, content scripts, dashboard page).
// tr(zh, en) returns the string for the current language.
// localizeDOM(root, dict) swaps Chinese text and title / aria-label / placeholder attributes in static HTML
// using a { "Chinese text": "English" } dictionary (only when the language is English).
(() => {
  if (globalThis.__abI18n) return;
  globalThis.__abI18n = true;
  const detect = () => {
    let ui = "en";
    try { ui = (chrome?.i18n?.getUILanguage?.() || navigator.language || "en").toLowerCase(); } catch (_) {}
    return ui.startsWith("zh") ? "zh" : "en";
  };
  // Language the user picked in dashboard "Settings": en (default) / zh / auto (same as browser), stored as ui_lang in chrome.storage.local
  let pref = "en";
  let LANG = "en";
  const apply = (p) => {
    pref = p === "zh" || p === "auto" ? p : "en";
    LANG = pref === "auto" ? detect() : pref;
    globalThis.AB_LANG = LANG;
  };
  apply("en");
  globalThis.tr = (zh, en) => (LANG === "zh" ? zh : en);
  globalThis.getUiLangPref = () => pref;
  globalThis.AB_LANG_READY = (async () => {
    try { apply((await chrome.storage.local.get("ui_lang")).ui_lang); } catch (_) {}
  })();
  try { chrome.storage.onChanged.addListener((c, area) => { if (area === "local" && c.ui_lang) apply(c.ui_lang.newValue); }); } catch (_) {}
  globalThis.localizeDOM = (root, dict) => {
    if (!root || !dict) return;
    const doc = root.ownerDocument || root;
    if (LANG === "zh") { if (doc.documentElement && root === doc) doc.documentElement.lang = "zh-CN"; return; } // HTML source text is Chinese; replaced only when English
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const texts = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n);
    for (const n of texts) {
      const raw = n.nodeValue;
      const key = raw.trim();
      if (key && dict[key] != null) n.nodeValue = raw.replace(key, dict[key]);
    }
    const els = root.querySelectorAll ? root.querySelectorAll("[title],[aria-label],[placeholder],[alt]") : [];
    for (const el of els) for (const a of ["title", "aria-label", "placeholder", "alt"]) {
      const v = el.getAttribute(a);
      if (v && dict[v.trim()] != null) el.setAttribute(a, dict[v.trim()]);
    }
    if (doc.documentElement && root === doc) doc.documentElement.lang = "en";
  };
})();
