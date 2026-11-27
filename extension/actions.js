// The only action that changes the WhatsApp screen: open a chat (the same as you clicking that chat on the left yourself).
// - Runs only when the user clicks "Open chat" in the extension popup by hand (background.js checks that the request came from the popup)
// - Opening a chat makes WhatsApp mark it as read, and the other person sees blue ticks: the user chose to read and reply
// - Nothing here sends a message, types text or presses Enter
// Runs in the MAIN world, so it must be self-contained.
// There is no tr() inside the WhatsApp page: the extension picks the language first and passes the text in (en = true means English)
export async function openChatInPage(chatId, en) {
  const tr = (zh, eng) => (en ? eng : zh);
  if (typeof window.require !== "function") return { ok: false, reason: tr("WhatsApp Web 还没载入完", "WhatsApp Web hasn't finished loading") };
  let C, Cmd;
  try { C = window.require("WAWebCollections"); } catch (_) {}
  try { Cmd = window.require("WAWebCmd")?.Cmd; } catch (_) {}
  const chat = C?.Chat?.get?.(chatId) || C?.Chat?.getModelsArray?.().find((c) => c.id?._serialized === chatId);
  if (!chat) return { ok: false, reason: tr("找不到这个对话", "Can't find this chat") };
  if (!Cmd) return { ok: false, reason: tr("WhatsApp 改版了，没办法帮你打开，请在左边自己点这个对话", "WhatsApp has changed, so this can't be opened for you. Click the chat on the left yourself") };
  const tries = [
    () => Cmd.openChatBottom?.({ chat }),
    () => Cmd.openChatBottom?.(chat),
    () => Cmd.openChatAt?.({ chat }),
    () => Cmd.openChatAt?.(chat)
  ];
  const isOpen = () => {
    try { return C.Chat.getActive?.()?.id?._serialized === chatId; } catch (_) { return false; }
  };
  if (isOpen()) return { ok: true };
  for (const t of tries) {
    try {
      const r = t();
      if (r === undefined) continue;
      await r;
      await new Promise((res) => setTimeout(res, 300));
      if (isOpen()) return { ok: true };
    } catch (_) {}
  }
  return { ok: false, reason: tr("没办法帮你打开，请在 WhatsApp 左边自己点这个对话", "Couldn't open it for you. Click the chat on the left in WhatsApp yourself") };
}
