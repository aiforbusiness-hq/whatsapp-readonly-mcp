// 唯一会改变 WhatsApp 画面的动作：打开一个对话（等于你自己在左边点那个对话）。
// - 只在用户亲手点插件弹窗的「打开对话」时执行（background.js 检查来源是弹窗）
// - 打开对话会让 WhatsApp 标已读、对方看到蓝勾：这是用户自己要读、要回的
// - 这里没有发信息、没有填字、没有按 Enter
// 在 MAIN world 执行，必须自给自足。
// 在 WhatsApp 页面里没有 tr()：文字由插件这边先选好语言再传进来（en = true 用英文）
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
