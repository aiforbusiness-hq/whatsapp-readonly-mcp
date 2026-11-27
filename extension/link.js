// 「在 WhatsApp 打开」链接：https://web.whatsapp.com/#ai-draft=<草稿 id>
// AI 存草稿后给用户这个链接。用户点了，Chrome 会开一个新的 WhatsApp 分页；
// 这里在页面载入前就交给背景程序：已经有 WhatsApp 分页就用那个（这个新分页关掉，免得两个分页抢登入），
// 然后打开那个对话、把草稿填进输入框。不发送。
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
