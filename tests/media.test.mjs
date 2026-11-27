// Non-text messages. Fake WhatsApp data only; runs the real reader.js inside headless Chrome on a throwaway profile.
// Run: node --test tests/media.test.mjs
import test from "node:test";
import { extConnect } from "./ext-client.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const CHROME = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "/usr/bin/google-chrome"].find((p) => p && existsSync(p));

test("textOf is the same in reader.js and indexer.js", () => {
  const cut = (s) => s.slice(s.indexOf("// --- textOf"), s.indexOf("// --- end textOf"));
  assert.ok(cut(read("extension/reader.js")).length > 500);
  assert.equal(cut(read("extension/reader.js")), cut(read("extension/indexer.js")));
});

test("the reader still cannot send, download, open chats or use the network", () => {
  const code = read("extension/reader.js").replace(/^\s*\/\/.*$/gm, "");
  for (const bad of [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /downloadMedia/, /downloadAndMaybeDecrypt/, /sendSeen/, /markSeen/, /sendMsg|sendMessage|addAndSend/, /"readwrite"/, /\.put\s*\(/, /\.click\s*\(/, /createObjectURL/]) assert.ok(!bad.test(code), String(bad));
});

test("MCP: a picture becomes an image attachment, a file becomes a resource, text stays text", async () => {
  const { TOOLS } = await import("../plugins/aiforbusiness-chat-assistant/server/lib/tools.js");
  const t = TOOLS.find((x) => x.name === "get_media");
  const c = t.content({ ok: true, content: "full", image: { mime: "image/jpeg", data: "QUJD", width: 2, height: 1 } });
  assert.deepEqual(c[1], { type: "image", data: "QUJD", mimeType: "image/jpeg" });
  assert.ok(!c[0].text.includes("QUJD"));
  const f = t.content({ ok: true, content: "full", file: { mime: "application/pdf", name: "价目 表.pdf", data: "QUJD" } });
  assert.equal(f[1].resource.blob, "QUJD"); new URL(f[1].resource.uri);
  assert.equal(t.content({ ok: true, content: "none" }).length, 1);
  assert.notEqual(t.readOnly, false);
  assert.equal((await t.run({ request: async () => ({ ok: false, code: "OP_NOT_ALLOWED" }) }, {})).code, "UPDATE_NEEDED");
});

const PAGE = `<!doctype html><script type="module">
import { readWhatsApp } from "/extension/reader.js";
const b64 = (u8) => { let s=""; for (let i=0;i<u8.length;i+=0x8000) s+=String.fromCharCode.apply(null,u8.subarray(i,i+0x8000)); return btoa(s); };
const sha = async (u8) => b64(new Uint8Array(await crypto.subtle.digest("SHA-256", u8)));
const pic = async (w,h,type) => { const c=new OffscreenCanvas(w,h), g=c.getContext("2d"); for(let i=0;i<400;i++){g.fillStyle="hsl("+i*7+",80%,50%)";g.fillRect(Math.random()*w,Math.random()*h,w/6,h/6);} return c.convertToBlob({type:type||"image/png"}); };
const bytes = async (b) => new Uint8Array(await b.arrayBuffer());
const done = (r) => fetch("/result",{method:"POST",body:JSON.stringify(r)});
try {
  const big = await pic(3000,2000), small = b64(await bytes(await pic(60,40,"image/jpeg")));
  const diskPic = await bytes(await pic(500,300)), sticker = await pic(128,128,"image/webp");
  const csv = new TextEncoder().encode("item,price\\nkopi,2.50"), pdf = new TextEncoder().encode("%PDF-1.4 fake"), secret = new TextEncoder().encode("encrypted bytes");
  const huge = new Uint8Array(900000).fill(7);
  const C1="111@c.us", k=(n,me)=>(me?"true_":"false_")+C1+"_"+n; let t=1700000000;
  const M=(n,o,me)=>({ id:{_serialized:k(n,me),fromMe:!!me}, from:C1, t:t++, ...o });
  const msgs=[
    M("text",{type:"chat",body:"hello"}),
    M("mem",{type:"image",body:small,caption:"menu",mimetype:"image/png",size:big.size,width:3000,height:2000,mediaObject:{mediaBlob:{_blob:big}}}),
    M("disk",{type:"image",body:small,mimetype:"image/png",filehash:await sha(diskPic)}),
    M("diskbad",{type:"image",body:small,mimetype:"image/png",filehash:await sha(new Uint8Array([1,2]))}),
    M("none",{type:"image",mimetype:"image/jpeg"}),
    M("once",{type:"image",body:small,caption:"private",isViewOnce:true,mediaObject:{mediaBlob:big}}),
    M("sticker",{type:"sticker",mimetype:"image/webp",mediaData:{mediaBlob:{_blob:sticker}}}),
    M("csv",{type:"document",filename:"prices.csv",caption:"prices.csv",mimetype:"text/csv",filehash:await sha(csv)}),
    M("pdf",{type:"document",filename:"quote.pdf",mimetype:"application/pdf",pageCount:3,size:pdf.length,filehash:await sha(pdf)}),
    M("huge",{type:"document",filename:"big.zip",mimetype:"application/zip",filehash:await sha(huge),mediaData:{mediaBlob:new Blob([huge])}}),
    M("voice",{type:"ptt",duration:"75",mimetype:"audio/ogg; codecs=opus",mediaData:{mediaBlob:new Blob([huge])}}),
    M("video",{type:"video",body:small,duration:12,caption:"tour",mimetype:"video/mp4"}),
    M("loc",{type:"location",body:small,lat:3.139,lng:101.6869,loc:"KLCC"}),
    M("card",{type:"vcard",vcardFormattedName:"Ali",body:"BEGIN:VCARD\\nFN:Ali\\nitem1.TEL;waid=60123:+60 12-3\\nEND:VCARD"}),
    M("poll",{type:"poll_creation",pollName:"Lunch?",pollOptions:[{name:"Rice"},{name:"Mee"}]}),
    M("event",{type:"event_creation",eventName:"Class",eventStartTime:1700000000}),
    M("call",{type:"call_log",callOutcome:"Missed",isVideoCall:true}),
    M("button",{type:"buttons_response",body:"Yes please"}),
    M("sys",{type:"gp2",body:"x"}),
  ];
  const before = JSON.stringify(msgs.map(m=>[m.id,m.body,m.type]));
  await new Promise((res,rej)=>{ const r=indexedDB.open("lru-media-storage-idb",3); r.onupgradeneeded=()=>r.result.createObjectStore("lru-media-array-buffer-cache"); r.onsuccess=async()=>{ const tx=r.result.transaction("lru-media-array-buffer-cache","readwrite"), s=tx.objectStore("lru-media-array-buffer-cache"); s.put({data:diskPic.buffer,size:diskPic.length},msgs[2].filehash); s.put({data:secret.buffer},msgs[3].filehash); s.put(csv.buffer,msgs[7].filehash); s.put({blob:new Blob([pdf])},msgs[8].filehash); tx.oncomplete=()=>{r.result.close();res();}; tx.onerror=rej; }; });
  const idb = await new Promise((res)=>{ const r=indexedDB.open("model-storage",1); r.onupgradeneeded=()=>r.result.createObjectStore("message",{keyPath:"id"}); r.onsuccess=()=>{ const tx=r.result.transaction("message","readwrite"); tx.objectStore("message").put({id:k("old"),from:C1,t:1600000000,type:"document",filename:"old.pdf",mimetype:"application/pdf"}); tx.oncomplete=()=>{r.result.close();res();}; }; });
  const chat={id:{_serialized:C1,server:"c.us",user:"111"},formattedTitle:"Test",unreadCount:2,t,msgs:{getModelsArray:()=>msgs}};
  window.require=()=>({Chat:{getModelsArray:()=>[chat]}});
  const calls=[]; const of=window.fetch; window.fetch=(...a)=>{calls.push(String(a[0]));return of(...a);};
  const out={list:await readWhatsApp("get_messages",{chat:"Test",limit:100}),search:await readWhatsApp("search_messages",{keyword:"klcc"}),media:{}};
  for (const m of [...msgs.map(x=>x.id._serialized),k("old"),"false_111@c.us_nope","junk"]) out.media[m.replace(/^.*@c.us_/,"")]=await readWhatsApp("get_media",{message_id:m});
  out.calls=calls; out.same = before===JSON.stringify(msgs.map(m=>[m.id,m.body,m.type])) && chat.unreadCount===2; out.small=small;
  out.dbv = (await indexedDB.databases()).map(d=>d.name+":"+d.version).sort();
  out.dom = document.body ? document.body.children.length : 0;
  window.fetch=of; await done(out);
} catch(e) { await done({error:String(e&&e.stack||e)}); }
</script>`;

test("real reader in Chrome: every kind of message", { skip: !CHROME && "Chrome not installed", timeout: 60000 }, async () => {
  let got; const result = new Promise((r) => { got = r; });
  const srv = createServer((req, res) => {
    if (req.url === "/result") { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { res.end(); got(JSON.parse(b)); }); return; }
    if (req.url === "/extension/reader.js") { res.setHeader("content-type", "text/javascript"); return res.end(read("extension/reader.js")); }
    res.setHeader("content-type", "text/html"); res.end(req.url === "/" ? PAGE : "");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const dir = mkdtempSync(join(tmpdir(), "wa-media-"));
  const p = spawn(CHROME, ["--headless=new", ...(process.env.CI ? ["--no-sandbox"] : []), "--no-first-run", "--disable-extensions", "--disable-background-networking", `--user-data-dir=${dir}`, `http://127.0.0.1:${srv.address().port}/`], { stdio: "ignore" });
  try {
    const r = await result;
    assert.equal(r.error, undefined);
    const by = Object.fromEntries(r.list.messages.map((m) => [m.id.replace(/^.*@c.us_/, ""), m])), md = r.media;
    const text = (n) => by[n].text;
    assert.equal(text("text"), "hello"); assert.equal(text("mem"), "[image] menu"); assert.equal(text("once"), "[image] (view once)");
    assert.equal(text("csv"), "[document] prices.csv"); assert.equal(text("voice"), "[ptt] (1:15)"); assert.equal(text("video"), "[video] (0:12) tour");
    assert.equal(text("loc"), "[location] KLCC"); assert.equal(text("card"), "[vcard] Ali"); assert.equal(text("poll"), "[poll_creation] Lunch? Rice / Mee");
    assert.equal(text("event"), "[event_creation] Class"); assert.equal(text("call"), "[call_log] video call Missed"); assert.equal(text("button"), "[buttons_response] Yes please");
    assert.ok(!by.sys && by.old);
    assert.deepEqual(by.loc.location, { lat: 3.139, lng: 101.6869, name: "KLCC" });
    assert.deepEqual(by.card.contacts, [{ name: "Ali", phones: ["+60 12-3"] }]);
    assert.deepEqual(by.poll.poll.options, ["Rice", "Mee"]);
    assert.equal(by.voice.media.seconds, 75); assert.equal(by.pdf.media.pages, 3); assert.equal(by.mem.media.on_this_computer, "full"); assert.equal(by.video.media.on_this_computer, "preview");
    assert.ok(!JSON.stringify(r.list).includes(r.small), "preview bytes must not leak into the text list");
    assert.equal(r.search.count, 1);
    // pictures
    assert.equal(md.mem.content, "full"); assert.ok(md.mem.image.width <= 1568 && md.mem.image.data.length < 700000);
    assert.equal(md.disk.content, "full"); assert.equal(md.disk.image.width, 500);
    assert.equal(md.diskbad.content, "preview"); assert.equal(md.diskbad.image.data, r.small);
    assert.equal(md.none.content, "none"); assert.ok(!md.none.image);
    assert.equal(md.once.content, "none"); assert.ok(!md.once.image && !JSON.stringify(md.once).includes("private"));
    assert.equal(md.sticker.content, "full");
    // files
    assert.equal(md.csv.file_text, "item,price\nkopi,2.50"); assert.equal(Buffer.from(md.pdf.file.data, "base64").toString(), "%PDF-1.4 fake");
    assert.ok(!md.huge.file && /too big/.test(md.huge.note));
    // sound, video, others
    assert.equal(md.voice.content, "none"); assert.ok(!md.voice.file); assert.equal(md.video.content, "preview"); assert.match(md.video.note, /cannot watch/);
    assert.equal(md.loc.content, "none"); assert.equal(md.old.content, "none");
    for (const n of ["sys", "nope", "junk"]) assert.equal(md[n].code, "MESSAGE_NOT_FOUND");
    // nothing touched
    assert.deepEqual(r.calls, []); assert.ok(r.same); assert.equal(r.dom, 0);
    assert.deepEqual(r.dbv, ["lru-media-storage-idb:3", "model-storage:1"]);
  } finally { p.kill("SIGKILL"); srv.close(); srv.closeAllConnections(); await new Promise((r) => setTimeout(r, 300)); try { rmSync(dir, { recursive: true, force: true }); } catch (_) {} }
});

test("end to end over MCP: get_media reaches the extension and comes back as an image, also from a second AI session", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wa-mm-")), base = 52000 + (process.pid % 300) * 10, all = [];
  const start = () => {
    const p = spawn(process.execPath, [join(ROOT, "plugins/aiforbusiness-chat-assistant/server/server.js")], { env: { ...process.env, WA_READONLY_DATA_DIR: dir, WA_READONLY_TEST_PORT_BASE: String(base) }, stdio: ["pipe", "pipe", "ignore"] });
    all.push(p); let buf = "", n = 1; const w = new Map();
    p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); w.get(m.id)?.(m.result); } });
    return (method, params) => new Promise((r) => { w.set(n, r); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n++, method, params }) + "\n"); });
  };
  let ws;
  try {
    const a = start(); await a("initialize", { clientInfo: { name: "A" } });
    const st = await a("tools/call", { name: "get_status", arguments: {} });
    const b = start(); await b("initialize", { clientInfo: { name: "B" } });
    ws = extConnect(base, { onRequest: (m) => (m.op === "get_media" && m.params.message_id === "x" ? { ok: true, content: "full", image: { mime: "image/jpeg", data: "QUJD".repeat(150000), width: 1, height: 1 } } : { ok: false, code: "BAD" }) });
    for (let i = 0; i < 100 && ws.state !== "need_pair"; i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal((await ws.pair(st.structuredContent.pairing_code)).ok, true);
    for (const s of [a, b]) {
      const r = await s("tools/call", { name: "get_media", arguments: { message_id: "x" } });
      assert.equal(r.content[1].type, "image"); assert.equal(r.content[1].data.length, 600000); assert.equal(r.structuredContent, undefined); assert.ok(r.content[0].text.length < 300);
    }
    const l = await a("tools/list", {}); assert.equal(l.tools.find((t) => t.name === "get_media").annotations.readOnlyHint, true);
  } finally { ws?.close(); all.forEach((p) => p.kill("SIGKILL")); rmSync(dir, { recursive: true, force: true }); }
});

test("download is reachable only from a paired MCP request, and only talks to WhatsApp's media server", () => {
  const bg = read("extension/background.js");
  assert.equal(bg.split("downloadMedia(").length - 1, 1);
  const req = bg.slice(bg.indexOf('case "request": {'), bg.indexOf("// 用户在仪表板 / 弹窗按了「不用回」"));
  assert.ok(req.includes('msg.op === "download_media"') && req.indexOf("NOT_PAIRED") < req.indexOf("downloadMedia("));
  assert.ok(!/READ_OPS = new Set\([^)]*download_media/.test(bg));
  for (const f of ["popup.js", "dashboard.js", "content.js", "sidebar.js", "indexer.js", "reader.js", "actions.js"]) assert.ok(!/mediaInPage|downloadMedia\(|chrome\.downloads/.test(read("extension/" + f)), f);
  const dl = read("extension/downloader.js").replace(/^\s*\/\/.*$/gm, "");
  assert.deepEqual([...dl.matchAll(/https?:\/\/[^"'`\s]+/g)].map((x) => x[0]), ["https://mmg.whatsapp.net"]);
  for (const bad of [/\.downloadMedia\(/, /sendSeen|markSeen|markPlayed|rmr/i, /"readwrite"/, /\.click\(/, /sendMsg|addAndSend/]) assert.ok(!bad.test(dl), String(bad));
  for (const f of ["background.js", "media.js", "offscreen.js", "wa.js"]) assert.ok(!/acceptDanger|fetch\("http/.test(read("extension/" + f)));
});
