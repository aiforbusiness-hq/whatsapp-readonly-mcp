// A WhatsApp-Web-like test page built from the made-up chats in fixture.mjs.
// - People and browser agents see a chat list; clicking a chat shows its messages.
// - The Chrome extension reads the same data through window.require("WAWebCollections"),
//   the way it reads the real WhatsApp Web.
import { CHATS } from "./fixture.mjs";

export function buildPage(nowSec = Math.floor(Date.now() / 1000)) {
  const data = CHATS.map((c) => ({
    ...c,
    msgs: c.msgs.map((m, i) => ({ ...m, t: nowSec - m.ago * 60, i }))
  }));
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const hhmm = (t) => new Date(t * 1000).toTimeString().slice(0, 5);
  const sorted = [...data].sort((a, b) => b.msgs.at(-1).t - a.msgs.at(-1).t);
  const list = sorted.map((c) => {
    const last = c.msgs.at(-1);
    return `<div class="chat" role="listitem" tabindex="0" data-id="${c.id}"><div class="row"><span class="name">${esc(c.name)}</span><span class="time">${hhmm(last.t)}</span></div>` +
      `<div class="row"><span class="last">${last.me ? "You: " : last.by ? esc(last.by) + ": " : ""}${esc(last.text)}</span>${c.unread ? `<span class="badge" aria-label="${c.unread} unread messages">${c.unread}</span>` : ""}</div></div>`;
  }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>WhatsApp</title><style>
body{margin:0;font:14px -apple-system,Segoe UI,Helvetica,Arial,sans-serif;display:flex;height:100vh}
#side{width:340px;border-right:1px solid #ddd;overflow:auto}#side h1{font-size:18px;margin:12px 16px}
.chat{padding:10px 16px;border-bottom:1px solid #eee;cursor:pointer}.row{display:flex;justify-content:space-between;gap:8px}
.name{font-weight:600}.time{color:#667781;font-size:12px}.last{color:#667781;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.badge{background:#25d366;color:#fff;border-radius:10px;padding:0 6px;font-size:12px}
#main{flex:1;display:flex;flex-direction:column;background:#efeae2}#main header{background:#f0f2f5;padding:12px 16px;font-weight:600}
#msgs{flex:1;overflow:auto;padding:12px 40px}.m{background:#fff;border-radius:8px;padding:6px 10px;margin:6px 0;max-width:60%}
.m.me{background:#d9fdd3;margin-left:auto}.m .by{font-size:12px;font-weight:600;color:#027eb5}.m .t{font-size:11px;color:#667781;text-align:right}
footer{background:#f0f2f5;padding:10px 16px}footer div{background:#fff;border-radius:8px;padding:10px;color:#667781}
</style></head><body>
<div id="side" role="list" aria-label="Chat list"><h1>Chats</h1>${list}</div>
<div id="main"><header id="title">Select a chat</header><div id="msgs" role="log" aria-label="Messages"></div><footer><div contenteditable="true" aria-label="Type a message">Type a message</div></footer></div>
<script>
const DATA = ${JSON.stringify(data)};
const esc = ${esc.toString()};
const hhmm = ${hhmm.toString()};
function open(id) {
  const c = DATA.find((x) => x.id === id);
  document.getElementById("title").textContent = c.name;
  document.getElementById("msgs").innerHTML = c.msgs.map((m) =>
    '<div class="m' + (m.me ? ' me' : '') + '">' + (m.by ? '<div class="by">' + esc(m.by) + '</div>' : '') + esc(m.text) + '<div class="t">' + hhmm(m.t) + '</div></div>').join("");
}
document.querySelectorAll(".chat").forEach((el) => el.addEventListener("click", () => open(el.dataset.id)));

// What the extension reads (same shape as WhatsApp Web's internal models)
const contacts = [];
const chats = DATA.map((c) => {
  const [user, server] = c.id.split("@");
  const msgs = c.msgs.map((m) => {
    const authorId = m.by ? "6019" + String(contacts.length + 100000) + "@c.us" : null;
    if (m.by && !contacts.find((k) => k.name === m.by)) contacts.push({ id: { _serialized: authorId }, name: m.by });
    const author = m.by ? contacts.find((k) => k.name === m.by).id._serialized : undefined;
    return { id: { _serialized: (m.me ? "true_" : "false_") + c.id + "_M" + m.i, fromMe: !!m.me }, from: m.me ? "me@c.us" : (author || c.id),
      author, t: m.t, type: "chat", body: m.text };
  });
  return { id: { _serialized: c.id, user, server }, formattedTitle: c.name, name: c.name, unreadCount: c.unread, t: c.msgs.at(-1).t,
    isGroup: !!c.group, archive: false, pin: false, msgs: { getModelsArray: () => msgs, on() {} } };
});
window.require = (n) => {
  if (n === "WAWebCollections") return {
    Chat: { getModelsArray: () => chats, on() {}, get: (id) => chats.find((c) => c.id._serialized === id), getActive: () => null },
    Contact: { getModelsArray: () => contacts }
  };
  throw new Error("no " + n);
};
</script></body></html>`;
}
