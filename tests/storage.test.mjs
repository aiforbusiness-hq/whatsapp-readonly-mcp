// Drafts / activity: concurrent writes never resurrect cleared data or lose a saved draft.
// File names: a hostile long name is handled fast. Dummy data, in-process.
// Run: node --test tests/storage.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

const store = {};
const later = (fn) => new Promise((r) => setTimeout(() => r(fn()), 5)); // every storage call takes a few ms, applied in call order
globalThis.tr = (zh, en) => en;
globalThis.chrome = {
  storage: { local: {
    get: (k) => later(() => { const r = {}; for (const x of [].concat(k)) if (x in store) r[x] = structuredClone(store[x]); return r; }),
    set: (o) => later(() => { Object.assign(store, structuredClone(o)); }),
    remove: (k) => later(() => { for (const x of [].concat(k)) delete store[x]; })
  } }
};
const drafts = await import("../extension/drafts.js");
const activity = await import("../extension/activity.js");

test("clearing drafts while another write is in flight does not bring them back", async () => {
  await drafts.addDraft({ chat: { id: "1@c.us", name: "x" }, text: "dummy draft one" });
  const id = store.drafts[0].id;
  await Promise.all([drafts.updateDraft(id, { status: "copied" }), drafts.clearDrafts()]);
  assert.equal(store.drafts, undefined);
  await drafts.addDraft({ chat: { id: "1@c.us", name: "x" }, text: "dummy draft two" });
  await Promise.all([drafts.reconcile("1@c.us", [{ id: "m", time: new Date(Date.now() + 1000).toISOString(), text: "sent", from_me: true }]), drafts.clearDrafts()]);
  assert.equal(store.drafts, undefined);
});

test("two AI apps saving at once: both drafts are kept", async () => {
  const [a, b] = await Promise.all([
    drafts.addDraft({ chat: { id: "2@c.us", name: "b" }, text: "draft for B" }),
    drafts.addDraft({ chat: { id: "3@c.us", name: "c" }, text: "draft for C" })
  ]);
  assert.ok(a.ok && b.ok);
  assert.deepEqual(store.drafts.map((d) => d.text).sort(), ["draft for B", "draft for C"]);
});

test("removing one draft keeps the others, even with a save in flight", async () => {
  await drafts.clearDrafts();
  const a = await drafts.addDraft({ chat: { id: "4@c.us", name: "d" }, text: "draft for D" });
  const [, removed] = await Promise.all([drafts.addDraft({ chat: { id: "5@c.us", name: "e" }, text: "draft for E" }), drafts.removeDraft(a.draft.id)]);
  assert.equal(removed, true);
  assert.deepEqual(store.drafts.map((d) => d.text), ["draft for E"]);
  assert.equal(await drafts.removeDraft("no-such-id"), false);
  assert.deepEqual(store.drafts.map((d) => d.text), ["draft for E"]);
});

test("clearing the activity log is not undone by a write in flight", async () => {
  await activity.logRequest({ time: new Date().toISOString(), op: "status", ok: true });
  await Promise.all([activity.logRequest({ time: new Date().toISOString(), op: "list_chats", ok: true }), activity.clearActivity()]);
  assert.equal(store.activity, undefined);
  // entries older than the 90-day retention are not returned even if nothing new was written
  store.activity = [{ time: new Date(Date.now() - 100 * 86400000).toISOString(), op: "old" }];
  assert.equal((await activity.getActivity()).log.length, 0);
});

test("a hostile file name with a long run of dots is handled quickly and safely", async () => {
  const { safeName } = await import("../extension/media.js");
  const t0 = performance.now();
  const n = safeName({ file_name: "a" + ".".repeat(200000) + "x" });
  assert.ok(performance.now() - t0 < 200, `took ${performance.now() - t0} ms`);
  assert.ok(n.length <= 120);
  assert.equal(safeName({ file_name: " ..evil.exe.. " }), "evil.exe");
  assert.equal(safeName({ file_name: "../../.ssh/x" }), "_.._.ssh_x");
});
