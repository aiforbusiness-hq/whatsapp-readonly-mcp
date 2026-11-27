// "Open in WhatsApp" link: https://web.whatsapp.com/#ai-draft=<draft id>
// After saving a draft, the AI gives the user this link. When clicked, Chrome opens a new WhatsApp tab;
// before the page loads, this hands it to the background script: if a WhatsApp tab exists, use it (close this new tab so two tabs do not fight over the login),
// then open that chat and fill the draft into the message box. Never sends.
(() => {
  const m = /^#ai-draft=([0-9a-f-]{36})$/i.exec(location.hash);
  if (!m) return;
  try { history.replaceState(null, "", location.pathname + location.search); } catch (_) {}
  try {
    chrome.runtime.sendMessage({ type: "open_draft_link", id: m[1].toLowerCase() })
      .then((r) => { if (r?.close) window.stop(); })
      .catch(() => {});
  } catch (_) {}
})();
