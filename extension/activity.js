// 本机活动纪录：AI（Claude / ChatGPT）通过 MCP 叫了插件做什么、什么时候。
// 只存在 chrome.storage.local（这台电脑），不上网，保留 90 天、最多 1000 条。
// 不存信息内容：只存指令名、哪个 AI、对话名称（如有）、结果数量、花多久。
const KEY = "activity";
const KEEP_MS = 90 * 24 * 3600 * 1000;
const MAX = 1000;
const MARKS = "marks"; // { last_sync, last_dashboard, last_popup, last_ai_request }

let queue = Promise.resolve();
const serial = (fn) => (queue = queue.then(fn, fn));

export function logRequest(entry) {
  return serial(async () => {
    const r = await chrome.storage.local.get([KEY, MARKS]);
    const cutoff = Date.now() - KEEP_MS;
    const list = (Array.isArray(r[KEY]) ? r[KEY] : []).filter((x) => Date.parse(x.time) >= cutoff);
    list.unshift(entry);
    const marks = r[MARKS] || {};
    marks.last_ai_request = entry.time;
    if (entry.ok) marks.last_sync = entry.time;
    try { await chrome.storage.local.set({ [KEY]: list.slice(0, MAX), [MARKS]: marks }); }
    catch (_) { try { await chrome.storage.local.set({ [KEY]: list.slice(0, 200), [MARKS]: marks }); } catch (_) {} } // 空间满了就只留最近 200 条
  });
}

export function mark(name) {
  return serial(async () => {
    const r = await chrome.storage.local.get(MARKS);
    const marks = r[MARKS] || {};
    marks[name] = new Date().toISOString();
    await chrome.storage.local.set({ [MARKS]: marks });
  });
}

export async function getActivity() {
  const r = await chrome.storage.local.get([KEY, MARKS]);
  const cutoff = Date.now() - KEEP_MS; // 保留期限读的时候也算（不只写的时候）
  return { log: (Array.isArray(r[KEY]) ? r[KEY] : []).filter((x) => Date.parse(x.time) >= cutoff), marks: r[MARKS] || {} };
}

// 跟写入排同一个队：清空之后，正在写的那一笔不会把旧纪录写回来
export function clearActivity() {
  return serial(() => chrome.storage.local.remove(KEY));
}

// 把请求参数变成可以存的摘要：不存草稿内容、不存搜寻以外的长文字
export function summarizeParams(op, p) {
  const out = {};
  if (p.chat) out.chat = String(p.chat).slice(0, 80);
  if (p.limit) out.limit = Number(p.limit) || undefined;
  if (op === "search_messages" && p.query) out.query = String(p.query).slice(0, 40);
  if (p.keyword) out.keyword = String(p.keyword).slice(0, 40);
  if (p.unread_only) out.unread_only = true;
  if (p.groups_only) out.groups_only = true;
  if (op === "save_draft") out.draft_chars = String(p.text || "").length;
  return out;
}

export function summarizeResult(op, r) {
  if (!r || !r.ok) return { ok: false, code: r?.code || "ERROR" };
  const n = r.count ?? r.matched ?? r.messages?.length ?? r.chats?.length ?? r.drafts?.length ?? null;
  const out = { ok: true };
  if (n != null) out.count = n;
  if (r.chat?.name) out.chat = String(r.chat.name).slice(0, 80);
  return out;
}
