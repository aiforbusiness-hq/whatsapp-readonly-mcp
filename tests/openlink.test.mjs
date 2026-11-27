// save_draft and list_drafts give an "Open in WhatsApp" link for unused drafts; nothing else gets one.
// Run: node --test tests/openlink.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { TOOLS } from "../plugins/aiforbusiness-chat-assistant/server/lib/tools.js";

const tool = (n) => TOOLS.find((t) => t.name === n);
const ID = "0f8c2a4e-1b2c-4d3e-8f90-123456789abc";

test("save_draft returns open_link for the saved draft", async () => {
  const bridge = { clientName: "test", request: async (op) => (op === "save_draft" ? { ok: true, draft_id: ID, chat: { id: "x@c.us" } } : { ok: false }) };
  const r = await tool("save_draft").run(bridge, { chat: "x", text: "dummy" });
  assert.equal(r.open_link, "https://web.whatsapp.com/#ai-draft=" + ID);
});

test("a failed save has no link", async () => {
  const bridge = { request: async () => ({ ok: false, code: "CHAT_NOT_FOUND" }) };
  const r = await tool("save_draft").run(bridge, { chat: "x", text: "dummy" });
  assert.equal(r.open_link, undefined);
});

test("list_drafts links only unused drafts with a proper id", async () => {
  const drafts = [{ id: ID, status: "pending" }, { id: ID, status: "replied" }, { id: "not-an-id", status: "pending" }];
  const bridge = { request: async () => ({ ok: true, drafts }) };
  const r = await tool("list_drafts").run(bridge, {});
  assert.equal(r.drafts[0].open_link, "https://web.whatsapp.com/#ai-draft=" + ID);
  assert.equal(r.drafts[1].open_link, undefined);
  assert.equal(r.drafts[2].open_link, undefined);
});

test("the link page script only reacts to a real draft id in the address", async () => {
  const { readFileSync } = await import("node:fs");
  const vm = await import("node:vm");
  const src = readFileSync(new URL("../extension/link.js", import.meta.url), "utf8");
  for (const [hash, expect] of [["#ai-draft=" + ID, true], ["#ai-draft=../../x", false], ["", false], ["#ai-draft=" + ID + "&send=1", false]]) {
    const sent = [];
    vm.runInNewContext(src, { location: { hash, pathname: "/", search: "" }, history: { replaceState() {} }, window: { stop() {} },
      chrome: { runtime: { sendMessage: async (m) => { sent.push(m); return {}; } } } });
    assert.equal(sent.length > 0, expect, hash);
    if (expect) assert.equal(JSON.stringify(sent[0]), JSON.stringify({ type: "open_draft_link", id: ID }));
  }
});
