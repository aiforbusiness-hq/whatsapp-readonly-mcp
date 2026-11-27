// 找到用户已开的 WhatsApp Web 分页，在里面执行只读读取器。
// 不开新分页、不重新整理页面。
import { readWhatsApp } from "./reader.js";
import { openChatInPage } from "./actions.js";

export async function findWhatsAppTab(includeAsleep = false) {
  // 无痕视窗不算（插件设成不在无痕视窗执行；万一被打开也不混两个账号）
  let tabs = (await chrome.tabs.query({ url: "https://web.whatsapp.com/*" })).filter((t) => !t.incognito);
  // Chrome 重新打开后，上次的分页可能是「睡着」的（没载入），在里面执行会一直卡住
  if (!includeAsleep) tabs = tabs.filter((t) => !t.discarded && t.status !== "unloaded");
  if (!tabs.length) return null;
  // 多个分页时，优先用最近用过的那个
  tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  return tabs[0];
}

async function exec(tabId, func, args) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func, args });
  return res?.result;
}

export const runRead = (op, params, tabId) => runInWa(readWhatsApp, [op, params || {}], 10000, tabId);

// 在 WhatsApp 分页里执行一个自给自足的函数
export async function runInWa(func, args, ms, tabId) {
  const id = tabId ?? (await findWhatsAppTab())?.id;
  if (id == null) {
    const asleep = await findWhatsAppTab(true);
    return asleep
      ? { ok: false, code: "WA_TAB_ASLEEP", reason: tr("WhatsApp Web 分页还没载入：请点一下那个分页把它叫醒", "The WhatsApp Web tab isn't loaded yet: click that tab to wake it up") }
      : { ok: false, code: "WA_TAB_NOT_OPEN", reason: tr("WhatsApp Web 没开：请在 Chrome 打开 web.whatsapp.com 并登入", "WhatsApp Web is not open: open web.whatsapp.com in Chrome and log in") };
  }
  try {
    // 最多等这么久，不要一直卡住
    const timeout = new Promise((resolve) => setTimeout(() => resolve({ ok: false, code: "WA_TIMEOUT", reason: tr("WhatsApp Web 太久没回应（可能还在载入）。等一下再试", "WhatsApp Web took too long to answer (it may still be loading). Try again in a moment") }), ms));
    const r = await Promise.race([exec(id, func, args), timeout]);
    if (func !== readWhatsApp && r?.ok) r.tabId = id;
    return r ??
      { ok: false, code: "NO_RESULT", reason: tr("读取没有回传结果，请重新整理 WhatsApp 分页再试", "Reading returned nothing. Reload the WhatsApp tab and try again") };
  } catch (e) {
    return { ok: false, code: "INJECT_FAILED", reason: tr("没办法在 WhatsApp 分页里读取：", "Can't read inside the WhatsApp tab: ") + (e?.message || e) };
  }
}

// 只给「用户亲手点打开对话」用。打开后把 WhatsApp 分页切到前面。
export async function openChat(chatId, tabId) {
  const tab = tabId != null ? await chrome.tabs.get(tabId).catch(() => null) : await findWhatsAppTab();
  if (!tab) return { ok: false, reason: tr("WhatsApp Web 没开", "WhatsApp Web is not open") };
  let r;
  try {
    r = await Promise.race([
      exec(tab.id, openChatInPage, [String(chatId), tr("zh", "en") === "en"]),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, reason: tr("WhatsApp Web 太久没回应，请在左边自己点这个对话", "WhatsApp Web took too long; click the chat on the left yourself") }), 8000))
    ]);
  } catch (e) { r = { ok: false, reason: String(e?.message || e) }; }
  try {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } catch (_) {}
  return r || { ok: false, reason: tr("没有回应", "No response") };
}

// 弹窗「打开 WhatsApp Web」：有分页就切过去（睡着的也叫醒），没有就开一个
export async function focusOrOpenWhatsApp() {
  const tab = await findWhatsAppTab(true);
  if (!tab) { await chrome.tabs.create({ url: "https://web.whatsapp.com/" }); return { ok: true }; }
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  if (tab.discarded || tab.status === "unloaded") await chrome.tabs.reload(tab.id);
  return { ok: true };
}
