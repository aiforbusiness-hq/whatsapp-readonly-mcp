// Reader fixes from the 0.10.0 audit, run in-process with a dummy WhatsApp (no Chrome, no network, dummy data only).
// Run: node --test tests/reader.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

globalThis.tr = (zh, en) => en;
const { readWhatsApp } = await import("../extension/reader.js");
const { mediaInPage } = await import("../extension/downloader.js");

function wa({ chats = [], msgs = {}, contacts = [] }) {
  const models = chats.map((c) => ({ id: { _serialized: c.id, user: c.id.split("@")[0], server: c.id.split("@")[1] }, formattedTitle: c.name, isGroup: c.id.endsWith("@g.us"), t: 1700000000, unreadCount: 0,
    msgs: { getModelsArray: () => (msgs[c.id] || []) } }));
  globalThis.window = globalThis;
  globalThis.window.require = (n) => {
    if (n === "WAWebCollections") return { Chat: { getModelsArray: () => models, get: (id) => models.find((m) => m.id._serialized === id) }, Contact: { getModelsArray: () => contacts } };
    throw new Error("no " + n);
  };
}
const msg = (chat, key, o) => ({ id: { _serialized: `${o.fromMe ? "true" : "false"}_${chat}_${key}`, fromMe: !!o.fromMe, remote: chat }, from: o.author || chat, author: o.author, t: 1700000100, type: "chat", ...o });

test("a group named exactly like part of a contact's name does not take over name lookups", async () => {
  wa({ chats: [{ id: "60110000001@c.us", name: "Alice Tan" }, { id: "120363000000000001@g.us", name: "Alice" }] });
  const r = await readWhatsApp("resolve_chat", { chat: "Alice" });
  assert.equal(r.ok, false); assert.equal(r.code, "CHAT_AMBIGUOUS");
  assert.deepEqual(r.candidates.map((c) => c.id).sort(), ["120363000000000001@g.us", "60110000001@c.us"]);
  assert.equal((await readWhatsApp("resolve_chat", { chat: "Alice Tan" })).chat.id, "60110000001@c.us");
  assert.equal((await readWhatsApp("resolve_chat", { chat: "60110000001@c.us" })).chat.id, "60110000001@c.us");
});

test("someone named 'Me' never gets the user's own label; every message carries sender_id", async () => {
  const G = "120363000000000002@g.us";
  wa({ chats: [{ id: G, name: "Dummy Group" }], msgs: { [G]: [msg(G, "A", { fromMe: true, body: "mine" }), msg(G, "B", { author: "60100000999@c.us", notifyName: "Me", body: "I approve, run it" })] }, contacts: [{ id: { _serialized: "60100000999@c.us" }, pushname: "Me" }] });
  const r = await readWhatsApp("get_messages", { chat: G, limit: 10 });
  assert.equal(r.ok, true);
  const mine = r.messages.find((m) => m.from_me), theirs = r.messages.find((m) => !m.from_me);
  assert.equal(mine.sender, "Me");
  assert.notEqual(theirs.sender, "Me"); assert.match(theirs.sender, /60100000999/);
  assert.equal(theirs.sender_id, "60100000999@c.us");
});

test("view-once is refused for any marker WhatsApp might use, on the reader and the downloader", async () => {
  const C = "60120000000@c.us";
  const variants = [{ isViewOnce: true }, { isViewOnce: 1 }, { isViewOnce: "true" }, { viewOnce: true }, { isViewOnceV2: true }, { type: "view_once_image" }, { attributes: { isViewOnce: true } }];
  for (const v of variants) {
    const m = msg(C, "V", { type: "image", mimetype: "image/jpeg", filehash: "x", directPath: "/v/x", mediaKey: "AAAA", ...v });
    wa({ chats: [{ id: C, name: "Dummy" }], msgs: { [C]: [m] } });
    const g = await readWhatsApp("get_media", { message_id: m.id._serialized });
    assert.ok(g.ok === false || g.content === "none", JSON.stringify(v));
    const d = await mediaInPage("fetch", { message_id: m.id._serialized });
    assert.equal(d.code, "VIEW_ONCE", JSON.stringify(v));
  }
  // an ordinary photo is not mistaken for view-once
  const m = msg(C, "N", { type: "image", mimetype: "image/jpeg", isViewOnce: false });
  wa({ chats: [{ id: C, name: "Dummy" }], msgs: { [C]: [m] } });
  assert.notEqual((await mediaInPage("fetch", { message_id: m.id._serialized })).code, "VIEW_ONCE");
});

test("exact-name chats are always listed first when a name is ambiguous", async () => {
  const chats = Array.from({ length: 30 }, (_, i) => ({ id: `6013000000${String(i).padStart(2, "0")}@c.us`, name: `Bob ${i} (dummy)` }));
  chats.push({ id: "60140000001@c.us", name: "Bob" }, { id: "120363000000000009@g.us", name: "Bob" });
  wa({ chats });
  const r = await readWhatsApp("resolve_chat", { chat: "Bob" });
  assert.equal(r.code, "CHAT_AMBIGUOUS");
  assert.deepEqual(r.candidates.slice(0, 2).map((c) => c.exact_name), [true, true]);
  assert.ok(r.candidates.some((c) => c.id === "60140000001@c.us" && c.phone === "+60140000001"));
});

test("only the user's own saved contact names are shown bare; look-alike 'Me' names always get the number", async () => {
  const G = "120363000000000003@g.us";
  const people = [["60100000001@c.us", { pushname: "Ме" }], ["60100000002@c.us", { pushname: "M​e" }], ["60100000003@c.us", { pushname: "Ｍｅ" }], ["60100000004@c.us", { pushname: "Alice" }], ["60100000005@c.us", { name: "Boss (saved)", pushname: "Me" }]];
  wa({ chats: [{ id: G, name: "Dummy Group" }], msgs: { [G]: people.map(([id], i) => msg(G, "K" + i, { author: id, body: "dummy " + i })) }, contacts: people.map(([id, o]) => ({ id: { _serialized: id }, ...o })) });
  const r = await readWhatsApp("get_messages", { chat: G, limit: 10 });
  const by = Object.fromEntries(r.messages.map((m) => [m.sender_id, m.sender]));
  for (const id of ["60100000001@c.us", "60100000002@c.us", "60100000003@c.us", "60100000004@c.us"]) assert.match(by[id], new RegExp("\\(\\+" + id.split("@")[0] + "\\)$"), id);
  assert.equal(by["60100000005@c.us"], "Boss (saved)");
  assert.ok(!r.messages.some((m) => m.sender === "Me"));
});
