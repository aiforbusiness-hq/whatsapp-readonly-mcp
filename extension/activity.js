// Local activity log: what the AI (Claude / ChatGPT) asked the extension to do over MCP, and when.
// Stored only in chrome.storage.local (this computer), never online; kept 90 days, at most 1000 entries.
// No message content: only the command name, which AI, chat name (if any), result count, and time taken.
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
    catch (_) { try { await chrome.storage.local.set({ [KEY]: list.slice(0, 200), [MARKS]: marks }); } catch (_) {} } // If storage is full, keep only the latest 200
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
  const cutoff = Date.now() - KEEP_MS; // Apply the retention limit on read too (not only on write)
  return { log: (Array.isArray(r[KEY]) ? r[KEY] : []).filter((x) => Date.parse(x.time) >= cutoff), marks: r[MARKS] || {} };
}

// Same queue as writes: after clearing, a write in progress cannot put old entries back
export function clearActivity() {
  return serial(() => chrome.storage.local.remove(KEY));
}

// Turn request params into a storable summary: no draft text, no long text other than the search query
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
