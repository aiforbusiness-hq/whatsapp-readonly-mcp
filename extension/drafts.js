// 草稿清单：存在 Chrome 插件自己的本机储存（chrome.storage.local），不上网。
// 保留 90 天，自动删旧的。用户可在弹窗一键清空。
// 每条草稿：
//   id, chat_id, chat_name, is_group, text, created_at, source（哪个 AI 写的）, note,
//   context_last_their_msg_time（AI 起草时对方最后一句的时间）,
//   status: pending | inserted | copied | dismissed | replied
//   inserted_at / copied_at / dismissed_at,
//   actual_reply: { time, text }  ← 你之后真的发出的第一句
//   actual_messages: [{ time, text, type }]  ← 你之后连发的那一轮全部（见 reconcile）；reply_closed
const KEY = "drafts";
const KEEP_MS = 90 * 24 * 3600 * 1000;
const MAX_DRAFTS = 2000;
const MAX_TEXT = 4000;

// 所有会改草稿清单的动作排队一个一个做（读→改→写中间不会被别的动作插进来，清空后也不会被旧资料写回来）
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
  // 储存空间满了：先删掉最旧的一半再试一次
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
  // 同一个对话旧的「待用」草稿 → 标成被新草稿取代
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

export function clearDrafts() {
  return serial(() => chrome.storage.local.remove(KEY));
}

// 用对话里的信息更新草稿：草稿之后我真的发了什么（研究比对用）。
// 用户常常不照用草稿，而是自己连发几条，所以收集「一轮回复」：
//   开始 = 草稿建立时间
//   结束 = 对方在我回复之后又说话，或同一个对话有了下一条草稿，或我第一句之后过了 6 小时
//   最多收 20 条
// actual_reply = 第一句（旧字段，保留）；actual_messages = 这一轮全部；reply_closed = 这一轮已结束
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
