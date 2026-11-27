// Draft list: kept in the extension's own local storage (chrome.storage.local), never online.
// Kept 90 days; old ones are deleted automatically. The user can clear all from the popup.
// Each draft:
//   id, chat_id, chat_name, is_group, text, created_at, source (which AI wrote it), note,
//   context_last_their_msg_time (time of the other person's last message when the AI drafted),
//   status: pending | inserted | copied | dismissed | replied
//   inserted_at / copied_at / dismissed_at,
//   actual_reply: { time, text }  ← the first message you actually sent afterwards
//   actual_messages: [{ time, text, type }]  ← the whole round of messages you sent afterwards (see reconcile); reply_closed
const KEY = "drafts";
const KEEP_MS = 90 * 24 * 3600 * 1000;
const MAX_DRAFTS = 2000;
const MAX_TEXT = 4000;

// Every change to the draft list runs one at a time in a queue (nothing cuts into read, change, write; old data cannot come back after clearing)
let queue = Promise.resolve();
const serial = (fn) => { const p = queue.then(() => fn()); queue = p.catch(() => {}); return p; };

async function loadAll() {
  const r = await chrome.storage.local.get(KEY);
  const list = Array.isArray(r[KEY]) ? r[KEY] : [];
  const cutoff = Date.now() - KEEP_MS;
  return list.filter((d) => Date.parse(d.created_at) >= cutoff);
}
async function saveAll(list) {
  list.sort((a, b) => b.created_at.localeCompare(a.created_at));
  let keep = list.slice(0, MAX_DRAFTS);
  // Storage full: delete the oldest half, then try again
  for (let i = 0; i < 3; i++) {
    try { await chrome.storage.local.set({ [KEY]: keep }); return; }
    catch (e) {
      if (!/quota/i.test(String(e?.message || e)) || keep.length < 10) throw new Error(tr("插件储存空间满了，请到仪表板导出后清空草稿", "Extension storage is full. Export your data, then clear drafts"));
      keep = keep.slice(0, Math.floor(keep.length / 2));
    }
  }
}

export function purgeOld() {
  return serial(async () => saveAll(await loadAll()));
}

export function addDraft(args) { return serial(() => addDraftNow(args)); }
async function addDraftNow({ chat, text, source, note, contextTime }) {
  const t = String(text || "").trim();
  if (!t) return { ok: false, code: "BAD_PARAM", reason: tr("草稿是空的", "The draft is empty") };
  if (t.length > MAX_TEXT) return { ok: false, code: "BAD_PARAM", reason: tr(`草稿太长（最多 ${MAX_TEXT} 字）`, `The draft is too long (max ${MAX_TEXT} characters)`) };
  const list = await loadAll();
  const now = new Date().toISOString();
  // Older "pending" drafts in the same chat: mark them as replaced by the new draft
  for (const d of list) if (d.chat_id === chat.id && d.status === "pending") { d.status = "superseded"; d.superseded_at = now; }
  const d = {
    id: crypto.randomUUID(),
    chat_id: chat.id,
    chat_name: chat.name,
    is_group: !!chat.is_group,
    text: t,
    created_at: now,
    source: String(source || "ai").slice(0, 80),
    note: note ? String(note).slice(0, 500) : null,
    context_last_their_msg_time: contextTime || null,
    status: "pending"
  };
  list.push(d);
  await saveAll(list);
  return { ok: true, draft: d };
}

export async function listDrafts({ chatId, since, status, limit } = {}) {
  let list = await loadAll();
  if (chatId) list = list.filter((d) => d.chat_id === chatId);
  if (since) list = list.filter((d) => d.created_at >= since);
  if (status) list = list.filter((d) => d.status === status);
  list.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return list.slice(0, Math.max(1, Math.min(Number(limit) || 200, 2000)));
}

export function updateDraft(id, patch) { return serial(() => updateDraftNow(id, patch)); }
async function updateDraftNow(id, patch) {
  const list = await loadAll();
  const d = list.find((x) => x.id === id);
  if (!d) return null;
  Object.assign(d, patch);
  await saveAll(list);
  return d;
}

// User deletes a draft in the extension (popup / dashboard): really remove it from the list, not just mark it "dismissed"
export function removeDraft(id) {
  return serial(async () => {
    const list = await loadAll();
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) return false;
    list.splice(i, 1);
    await saveAll(list);
    return true;
  });
}

export function clearDrafts() {
  return serial(() => chrome.storage.local.remove(KEY));
}

// Update drafts from the chat: what I actually sent after the draft (for comparison research).
// Users often don't use the draft as-is and send several messages themselves, so collect "one round of reply":
//   start = when the draft was created
//   end = the other person speaks again after my reply, or the same chat gets a newer draft, or 6 hours pass after my first message
//   collect at most 20 messages
// actual_reply = first message (old field, kept); actual_messages = the whole round; reply_closed = the round has ended
const ROUND_MS = 6 * 3600 * 1000;
const MAX_ROUND = 20;
export function reconcile(chatId, messages) { return serial(() => reconcileNow(chatId, messages)); }
async function reconcileNow(chatId, messages) {
  const msgs = (messages || []).filter((m) => m.time).sort((a, b) => a.time.localeCompare(b.time));
  if (!msgs.length) return false;
  const list = await loadAll();
  const sameChat = list.filter((d) => d.chat_id === chatId).sort((a, b) => a.created_at.localeCompare(b.created_at));
  let changed = false;
  for (let i = 0; i < sameChat.length; i++) {
    const d = sameChat[i];
    if (d.reply_closed) continue;
    const nextDraftAt = sameChat[i + 1]?.created_at || null;
    const round = [];
    let closed = false;
    for (const m of msgs) {
      if (m.time <= d.created_at) continue;
      if (nextDraftAt && m.time >= nextDraftAt) { if (round.length) closed = true; break; }
      if (m.from_me) {
        if (round.length && Date.parse(m.time) - Date.parse(round[0].time) > ROUND_MS) { closed = true; break; }
        round.push({ id: m.id || null, time: m.time, text: m.text, type: m.type || "chat" });
        if (round.length >= MAX_ROUND) { closed = true; break; }
      } else if (round.length) { closed = true; break; }
    }
    if (!closed && round.length && Date.now() - Date.parse(round[0].time) > ROUND_MS) closed = true;
    if (!round.length) continue;
    const before = JSON.stringify([d.actual_messages, d.reply_closed]);
    d.actual_reply = { time: round[0].time, text: round[0].text };
    d.actual_messages = round;
    d.reply_closed = closed;
    if (d.status !== "dismissed" && d.status !== "superseded") d.status = "replied";
    if (JSON.stringify([d.actual_messages, d.reply_closed]) !== before) changed = true;
  }
  if (changed) await saveAll(list);
  return changed;
}
