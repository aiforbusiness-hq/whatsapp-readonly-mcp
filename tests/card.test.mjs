// The in-page draft card must only fill a draft into the chat it was written for.
// Runs the real extension/content.js in a vm with a stub page and chrome (dummy data only).
// Run: node --test tests/card.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "extension", "content.js");
const code = fs.readFileSync(SRC, "utf8");

function makeWorld() {
  const log = [];
  const els = new Map();
  const mkEl = (id) => {
    const h = {};
    const e = {
      id, textContent: "", hidden: false, title: "", style: {}, innerText: "",
      classList: { toggle() {}, contains() { return false; } },
      addEventListener(t, fn) { h[t] = fn; }, _h: h,
      getBoundingClientRect: () => ({ left: 0, top: 500, bottom: 560, right: 800, width: 800, height: 60 }),
      focus() {}, remove() {}
    };
    return e;
  };
  const get = (id) => { if (!els.has(id)) els.set(id, mkEl(id)); return els.get(id); };
  const root = { set innerHTML(_) {}, getElementById: get, querySelector: (s) => get(s) };
  // Page state: which chat is open, with its own composer
  const page = { header: "", presence: "", chatId: null, composers: {} }; // header = chat name; presence = "online" / "typing…"
  const composerFor = (chat) => {
    if (!page.composers[chat]) {
      const c = mkEl("composer:" + chat);
      c.innerText = "";
      c.dispatchEvent = (ev) => { // simulate WhatsApp paste handler
        const t = ev.clipboardData?.getData("text/plain") || "";
        c.innerText = t;
        log.push({ event: "paste_into_composer", composer_of_chat: chat, text: t });
        return true;
      };
      page.composers[chat] = c;
    }
    return page.composers[chat];
  };
  const footer = mkEl("footer");
  const document = {
    hidden: false,
    querySelectorAll: () => [],
    createElement: () => ({ setAttribute() {}, style: {}, attachShadow: () => root, remove() {} }),
    documentElement: { appendChild() {}, classList: { contains: () => false } },
    body: { classList: { contains: () => false, length: 1 } },
    querySelector(sel) {
      if (!page.chatId) return null;
      if (sel === "#main footer") return footer;
      if (sel === '#main footer div[contenteditable="true"]') return composerFor(page.chatId);
      if (sel === "#main header") return page.header ? { textContent: page.header + page.presence, getBoundingClientRect: footer.getBoundingClientRect,
        querySelector: (q) => (q === 'span[dir="auto"]' ? { textContent: page.header } : null) } : null;
      return null;
    },
    createRange: () => ({ selectNodeContents() {} }),
    execCommand: (...a) => { log.push({ event: "execCommand", args: a }); return true; }
  };
  const window = {
    addEventListener() {}, postMessage() {}, innerHeight: 800, innerWidth: 1200,
    getSelection: () => ({ removeAllRanges() {}, addRange() {} })
  };
  // card_drafts replies are held so the harness controls ordering/latency
  const held = [];
  const onChanged = [];
  const chrome = {
    runtime: {
      id: "ext-id",
      sendMessage(msg) {
        if (msg.type === "card_drafts") return new Promise((res) => held.push({ res, askedWhileOpen: page.chatId }));
        if (msg.type === "card_mark") log.push({ event: "card_mark", id: msg.id, status: msg.status });
        if (msg.type === "card_active_chat") return Promise.resolve({ ok: true, chat: page.chatId ? { id: page.chatId } : null });
        return Promise.resolve({ ok: true });
      },
      onMessage: { addListener() {} }
    },
    storage: {
      session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      local: { get: async () => ({}), set: async () => {} },
      onChanged: { addListener: (fn) => onChanged.push(fn) }
    }
  };
  let tick = null;
  const ctx = {
    document, window, chrome, location: { origin: "https://web.whatsapp.com" },
    AB_LANG_READY: Promise.resolve(), localizeDOM() {}, tr: (zh, en) => en,
    setInterval: (fn) => { tick = fn; return 1; }, clearInterval() {},
    setTimeout: () => 0, // fillComposer fallback and timers not needed
    matchMedia: () => ({ matches: false }),
    DataTransfer: class { constructor() { this.d = {}; } setData(k, v) { this.d[k] = v; } getData(k) { return this.d[k]; } },
    ClipboardEvent: class { constructor(t, o) { this.type = t; Object.assign(this, o); } },
    navigator: { clipboard: { writeText: async () => {} } },
    Date, Promise, String, Number, Math, JSON, Object, Array, Map, Set, URL
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: "content.js" });
  const flushMicro = () => new Promise((r) => setImmediate(r));
  return { log, get, page, held, onChanged, tick: () => tick(), flushMicro };
}

const ALICE = "60111111111@c.us", BOB = "60122222222@c.us";
const aliceDraft = { id: "draft-alice-1", chat_id: ALICE, chat_name: "Alice (dummy)", text: "DUMMY-PRIVATE: Alice, your invoice is 4200", status: "pending", created_at: new Date().toISOString() };


test("switching chat while the card is refreshing never fills the old chat's draft", async () => {
  const w = makeWorld();
  w.page.header = "Alice (dummy)"; w.page.chatId = ALICE;
  w.tick(); await w.flushMicro();
  w.held.shift().res({ ok: true, chat: { id: ALICE }, drafts: [aliceDraft] }); await w.flushMicro();
  // switch to Bob
  w.page.header = "Bob (dummy)"; w.page.chatId = BOB;
  w.tick(); await w.flushMicro(); // refresh for Bob sent, reply held (slow)
  const cardVisible = !w.get(".wrap").hidden, cardText = w.get("text").textContent;
  w.get("fill")._h.click({ isTrusted: true }); await w.flushMicro();
  assert.equal(cardVisible, false, "old card hidden as soon as the chat changes");
  assert.ok(!w.log.some((e) => e.event === "paste_into_composer"), JSON.stringify(w.log));
  assert.ok(!w.log.some((e) => e.event === "card_mark"));
});

test("a stale reply arriving last cannot put the old chat's draft on screen", async () => {


  const w = makeWorld();
  w.page.header = "Alice (dummy)"; w.page.chatId = ALICE;
  w.tick(); await w.flushMicro();
  w.held.shift().res({ ok: true, chat: { id: ALICE }, drafts: [aliceDraft] }); await w.flushMicro();
  w.onChanged.forEach((fn) => fn({ drafts: {} }, "local")); await w.flushMicro(); // refresh #2 (Alice) in flight
  w.page.header = "Bob (dummy)"; w.page.chatId = BOB;
  w.tick(); await w.flushMicro(); // refresh #3 (Bob)
  const [r2, r3] = [w.held.shift(), w.held.shift()];
  r3.res({ ok: true, chat: { id: BOB }, drafts: [] }); await w.flushMicro();
  const hiddenAfterBob = w.get(".wrap").hidden;
  r2.res({ ok: true, chat: { id: ALICE }, drafts: [aliceDraft] }); await w.flushMicro();
  // several more ticks with the same header: no new refresh is asked (until 15 s fallback)
  for (let i = 0; i < 5; i++) { w.tick(); await w.flushMicro(); }
  const pendingAsks = w.held.length;
  const cardVisible = !w.get(".wrap").hidden;
  w.get("fill")._h.click({ isTrusted: true }); await w.flushMicro();
  assert.equal(cardVisible, false, "stale reply ignored");
  assert.ok(!w.log.some((e) => e.event === "paste_into_composer"), JSON.stringify(w.log));
});

test("the card names the chat, and fills only when the open chat matches", async () => {
  const w = makeWorld();
  w.page.header = "Alice (dummy)"; w.page.chatId = ALICE;
  w.tick(); await w.flushMicro();
  w.held.shift().res({ ok: true, chat: { id: ALICE }, drafts: [aliceDraft] }); await w.flushMicro();
  assert.match(w.get("meta").textContent, /Alice \(dummy\)/);
  w.get("fill")._h.click({ isTrusted: true }); for (let i = 0; i < 5; i++) await w.flushMicro();
  assert.ok(w.log.some((e) => e.event === "paste_into_composer" && e.composer_of_chat === ALICE));
});

test("a draft shows as the yellow bar; View opens it; after Fill in it collapses back to the bar", async () => {
  const w = makeWorld();
  w.page.header = "Alice (dummy)"; w.page.chatId = ALICE;
  w.tick(); await w.flushMicro();
  const fresh = { ...aliceDraft, id: "draft-alice-bar", status: "pending" }; // other tests mark the shared one as filled in
  w.held.shift().res({ ok: true, chat: { id: ALICE }, drafts: [fresh] }); await w.flushMicro();
  assert.equal(w.get(".card").hidden, true, "starts collapsed");
  assert.equal(w.get("expand").hidden, false, "yellow bar visible");
  assert.match(w.get("barWho").textContent, /Alice \(dummy\)/);
  assert.equal(w.get("barOk").hidden, true);
  w.get("expand")._h.click({ isTrusted: true });
  assert.equal(w.get(".card").hidden, false, "View opens the card");
  w.get("fill")._h.click({ isTrusted: true }); for (let i = 0; i < 5; i++) await w.flushMicro();
  assert.ok(w.log.some((e) => e.event === "paste_into_composer" && e.composer_of_chat === ALICE));
  assert.equal(w.get(".card").hidden, true, "collapsed after filling");
  assert.equal(w.get("expand").hidden, false, "bar stays after filling");
  assert.equal(w.get("barOk").hidden, false, "bar says Filled in");
});

test("'online' / 'typing…' changing in the header does not hide the card or block filling", async () => {
  const w = makeWorld();
  w.page.header = "Alice (dummy)"; w.page.chatId = ALICE;
  w.tick(); await w.flushMicro();
  w.held.shift().res({ ok: true, chat: { id: ALICE }, drafts: [aliceDraft] }); await w.flushMicro();
  for (const p of ["online", "typing…", "", "online"]) { w.page.presence = p; w.tick(); await w.flushMicro(); }
  assert.equal(w.get(".wrap").hidden, false, "card stays while the chat stays the same");
  w.get("fill")._h.click({ isTrusted: true });
  w.page.presence = "typing…"; w.tick(); // presence changes while the click waits for the open-chat answer
  for (let i = 0; i < 5; i++) await w.flushMicro();
  assert.ok(w.log.some((e) => e.event === "paste_into_composer" && e.composer_of_chat === ALICE), JSON.stringify(w.log));
});
