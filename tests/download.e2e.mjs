// download_media end to end: real MCP server + real extension in a real (throwaway) Chromium + fake WhatsApp site and fake media server.
// Nothing here touches the real WhatsApp, the real pairing or the user's Chrome.
// Run: CHROMIUM_PATH=... node --test tests/download.e2e.mjs   (needs a Chromium that allows --load-extension, and openssl)
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:https";
import { createHash, createHmac, createCipheriv, hkdfSync, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ID = "hmajmekaiaiilhneebgbnchonfkblndb";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const c = join(homedir(), "Library/Caches/ms-playwright");
  try {
    for (const d of readdirSync(c).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
      for (const a of readdirSync(join(c, d))) for (const app of ["Google Chrome for Testing", "Chromium"]) {
        const p = join(c, d, a, `${app}.app/Contents/MacOS/${app}`);
        if (existsSync(p)) return p;
      }
    }
  } catch (_) {}
  return null;
}
const CHROMIUM = findChromium();
const sha = (b) => createHash("sha256").update(b).digest("base64");
const APP = { image: "Image", video: "Video", ptt: "Audio", document: "Document" };
function encrypt(plain, type) {
  const key = randomBytes(32), k = Buffer.from(hkdfSync("sha256", key, Buffer.alloc(32), `WhatsApp ${APP[type]} Keys`, 112));
  const c = createCipheriv("aes-256-cbc", k.subarray(16, 48), k.subarray(0, 16));
  const body = Buffer.concat([c.update(plain), c.final()]);
  const mac = createHmac("sha256", k.subarray(48, 80)).update(k.subarray(0, 16)).update(body).digest().subarray(0, 10);
  return { key: key.toString("base64"), enc: Buffer.concat([body, mac]) };
}

function zipOf(entries) {
  const local = [], central = []; let off = 0;
  for (const [name, data] of entries) {
    const n = Buffer.from(name), d = Buffer.from(data), h = Buffer.alloc(30), c = Buffer.alloc(46);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt32LE(d.length, 18); h.writeUInt32LE(d.length, 22); h.writeUInt16LE(n.length, 26);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt32LE(d.length, 20); c.writeUInt32LE(d.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    local.push(h, n, d); central.push(c, n); off += 30 + n.length + d.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...local, cd, end]);
}

test("download_media end to end", { skip: !CHROMIUM && "no Chromium for testing", timeout: 240000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "wa-e2e-")), downloads = join(dir, "dl"), base = 30000 + (process.pid % 200) * 10 /* own band, see tests/hub.test.mjs */;
  const extDir = join(dir, "ext"), profile = join(dir, "profile"), procs = [], hits = [], hosts = new Set();
  cpSync(join(ROOT, "extension"), extDir, { recursive: true });
  for (const f of ["background.js"]) { const p = join(extDir, f), s = readFileSync(p, "utf8"); assert.ok(s.includes("47821 + i")); writeFileSync(p, s.replaceAll("47821", String(base))); }
  mkdirSync(join(profile, "Default"), { recursive: true }); mkdirSync(downloads);
  writeFileSync(join(profile, "Default/Preferences"), JSON.stringify({ download: { default_directory: downloads, prompt_for_download: false }, safebrowsing: { enabled: false } }));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=web.whatsapp.com", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem")], { stdio: "ignore" });

  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const clip = join(dir, "clip.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=10:duration=2", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-movflags", "+faststart", clip]);
  const clip2 = join(dir, "clip2.mp4"); // moov at the end, like many phone videos
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=360x640:rate=15:duration=3", "-f", "lavfi", "-i", "sine=duration=3", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-profile:v", "high", "-c:a", "aac", "-shortest", clip2]);
  const plain = { realvid: readFileSync(clip), realvid2: readFileSync(clip2), video: Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), randomBytes(20 * 1024 * 1024 + 123)]), pdf: Buffer.from("%PDF-1.4 hello"), img: png, voice: Buffer.concat([Buffer.from("OggS"), randomBytes(700000)]), slow: Buffer.from("slow,file\n1,2"), evil: Buffer.from("just a note"), viaWa: Buffer.from("from whatsapp itself"), bad: randomBytes(5000), gone: randomBytes(50), redirect: randomBytes(60), exe: Buffer.concat([Buffer.from("MZ"), randomBytes(500)]), fakejpg: Buffer.concat([Buffer.from("MZ"), randomBytes(5000)]), zipexe: zipOf([["holiday/photo1.jpg", "x"], ["holiday/view.scr", "MZ"]]), jspdf: Buffer.from("%PDF-1.4\n<< /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>"), macro: zipOf([["[Content_Types].xml", "<Types/>"], ["word/document.xml", "<w/>"], ["word/vbaProject.bin", "x"]]), docx: zipOf([["[Content_Types].xml", "<Types/>"], ["word/document.xml", "<w/>"]]) };
  const files = {}, msgs = [];
  const add = (n, type, o = {}, opt = {}) => {
    const e = encrypt(plain[n] || Buffer.from("x"), APP[type] ? type : "document");
    if (opt.tamper) e.enc[10] ^= 1;
    files[`/v/${n}.enc`] = { data: e.enc, ...opt };
    msgs.push({ id: { _serialized: `false_111@c.us_${n}`, fromMe: false }, from: "111@c.us", t: 1700000000 + msgs.length, type, filehash: sha(plain[n] || Buffer.from("x")), directPath: `/v/${n}.enc`, mediaKey: e.key, ...o });
  };
  add("video", "video", { mimetype: "video/mp4", size: plain.video.length, body: png.toString("base64") });
  add("pdf", "document", { mimetype: "application/pdf", filename: "quote.pdf" });
  add("img", "image", { mimetype: "image/png" });
  add("voice", "ptt", { mimetype: "audio/ogg; codecs=opus" });
  add("slow", "document", { mimetype: "text/csv", filename: "slow.csv" }, { delay: 44000 });
  add("evil", "document", { mimetype: "text/plain", filename: "../../..\u202e/x/evil.txt" });
  add("viaWa", "document", { mimetype: "text/plain", filename: "wa.txt", viaWa: true });
  add("bad", "document", { mimetype: "application/zip", filename: "bad.zip" }, { tamper: true });
  add("gone", "document", { mimetype: "application/zip", filename: "gone.zip" }, { status: 404 });
  add("redirect", "document", { mimetype: "application/zip", filename: "r.zip" }, { status: 302 });
  add("exe", "document", { mimetype: "application/x-msdownload", filename: "setup.exe" });
  add("realvid", "video", { mimetype: "video/mp4" });
  add("realvid2", "video", { mimetype: "video/mp4" });
  add("fakejpg", "image", { mimetype: "image/jpeg" });
  add("zipexe", "document", { mimetype: "application/zip", filename: "holiday.zip" });
  add("jspdf", "document", { mimetype: "application/pdf", filename: "menu.pdf" });
  add("macro", "document", { mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", filename: "offer.docx" });
  add("docx", "document", { mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", filename: "plan.docx" });
  add("host1", "document", { mimetype: "text/plain", directPath: "https://evil.test/v/host1.enc" });
  add("host2", "document", { mimetype: "text/plain", directPath: "//evil.test/v/host2.enc" });
  add("once", "image", { isViewOnce: true });
  add("big", "document", { size: 300 * 1024 * 1024 });
  msgs.push({ id: { _serialized: "false_111@c.us_chat" }, from: "111@c.us", t: 1, type: "chat", body: "hi" });

  const PAGE = `<!doctype html><meta charset="utf-8"><body><script>
    const msgs = ${JSON.stringify(msgs)}; window.touched = [];
    for (const m of msgs) { m.downloadMedia = () => window.touched.push("downloadMedia"); }
    const chat = { id: { _serialized: "111@c.us", server: "c.us", user: "111" }, formattedTitle: "Test", unreadCount: 3, t: 1, sendSeen: () => window.touched.push("seen"), msgs: { getModelsArray: () => msgs, on() {} } };
    window.chat = chat;
    window.require = (n) => {
      if (n === "WAWebCollections") return { Chat: { getModelsArray: () => [chat], on() {}, get: () => chat }, Contact: { getModelsArray: () => [] } };
      if (n === "WAWebDownloadManager") return { downloadManager: { async downloadAndMaybeDecrypt(a) {
        const wa = msgs.find((m) => m.directPath === a.directPath && m.viaWa);
        if (wa) return new TextEncoder().encode("from whatsapp itself").buffer;
        if (a.directPath.includes("pdf")) return new TextEncoder().encode("wrong bytes").buffer;
        throw new Error("changed");
      } } };
      throw new Error("no " + n);
    };
  </script></body>`;
  const srv = createServer({ key: readFileSync(join(dir, "k.pem")), cert: readFileSync(join(dir, "c.pem")) }, async (req, res) => {
    const host = req.headers.host; hosts.add(host);
    if (host === "mmg.whatsapp.net") {
      hits.push({ url: req.url, cookie: req.headers.cookie, referer: req.headers.referer });
      const f = files[req.url.split("?")[0]];
      res.setHeader("access-control-allow-origin", "https://web.whatsapp.com");
      if (!f) { res.statusCode = 404; return res.end(); }
      if (f.status === 302) res.setHeader("location", "https://evil.test/x");
      if (f.status) { res.statusCode = f.status; return res.end(); }
      if (f.delay) await sleep(f.delay);
      return res.end(f.data);
    }
    res.setHeader("content-type", "text/html"); res.end(host === "web.whatsapp.com" && req.url === "/" ? PAGE : "");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));

  const startMcp = () => {
    const p = spawn(process.execPath, [join(ROOT, "plugins/aiforbusiness-chat-assistant/server/server.js")], { env: { ...process.env, WA_READONLY_DATA_DIR: join(dir, "data"), WA_READONLY_TEST_PORT_BASE: String(base) }, stdio: ["pipe", "pipe", "ignore"] });
    procs.push(p); let buf = "", n = 1; const w = new Map();
    p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); w.get(m.id)?.(m.result); } });
    const rpc = (method, params) => new Promise((r) => { w.set(n, r); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n++, method, params }) + "\n"); });
    const call = async (name, args = {}) => { const r = await rpc("tools/call", { name, arguments: args }); return { ...JSON.parse(r.content[0].text), _content: r.content }; };
    return { rpc, call };
  };
  const step = (...x) => process.env.E2E_LOG && console.log("[e2e]", ...x);
  const get = async (n, who = a) => { step("download", n); const r = await who.call("download_media", { message_id: `false_111@c.us_${n}` }); step(n, "->", r.code || r.status, r.source || r.reason || ""); return r; };
  let a, cdp;
  try {
    a = startMcp(); await a.rpc("initialize", { clientInfo: { name: "A" } });
    const list = (await a.rpc("tools/list", {})).tools.find((t) => t.name === "download_media");
    assert.equal(list.annotations.readOnlyHint, false); assert.equal(list.annotations.openWorldHint, true);
    const st = await a.call("get_status");
    const ch = spawn(CHROMIUM, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, `--load-extension=${extDir}`, `--disable-extensions-except=${extDir}`, "--no-first-run", "--ignore-certificate-errors", `--host-resolver-rules=MAP web.whatsapp.com:443 127.0.0.1:${srv.address().port},MAP mmg.whatsapp.net:443 127.0.0.1:${srv.address().port},MAP evil.test:443 127.0.0.1:${srv.address().port}`, "https://web.whatsapp.com/"], { stdio: ["ignore", "ignore", "pipe"] });
    procs.push(ch);
    const wsUrl = await new Promise((r) => { let s = ""; ch.stderr.on("data", (d) => { s += d; const m = /DevTools listening on (ws:\S+)/.exec(s); if (m) r(m[1]); }); });
    step("chromium up");
    const http = "http://" + new URL(wsUrl).host;
    const evalIn = async (match, expression) => {
      let t; for (let i = 0; i < 60 && !t; i++) { t = (await (await fetch(http + "/json")).json()).find((x) => x.type === "page" && x.url.startsWith(match)); if (!t) await sleep(250); }
      const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
      const v = await new Promise((r) => { ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === 1) r(m); }; ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } })); });
      ws.close(); if (v.result.exceptionDetails) throw new Error(JSON.stringify(v.result.exceptionDetails).slice(0, 400)); return v.result.result.value;
    };
    await sleep(2500);
    await fetch(http + `/json/new?chrome-extension://${ID}/popup.html`, { method: "PUT" });
    const ext = (msg) => evalIn(`chrome-extension://${ID}/popup.html`, `Promise.race([chrome.runtime.sendMessage(${JSON.stringify(msg)}), new Promise((r) => setTimeout(() => r("no answer"), 4000))])`);
    step("popup open", JSON.stringify((await (await fetch(http + "/json")).json()).map((x) => x.type + " " + x.url.slice(0, 90))));
    let pr; for (let i = 0; i < 20 && !pr?.ok; i++) { await sleep(500); try { await ext({ type: "state", force: true }); pr = await ext({ type: "pair", code: st.pairing_code }); } catch (e) { step("pair error", String(e).slice(0, 200)); } step("pair", JSON.stringify(pr)); }
    assert.equal(pr?.ok, true, JSON.stringify(pr));
    assert.ok((await a.call("get_status")).paired);

    step("paired");
    // reading never downloads anything
    const before = hits.length;
    assert.ok((await a.call("get_messages", { chat: "Test", limit: 50 })).ok);
    assert.equal((await a.call("get_media", { message_id: "false_111@c.us_video" })).content, "preview");
    assert.equal(hits.length, before); assert.deepEqual(readdirSync(downloads), []);

    // only MCP can ask: popup, extension pages and the web page cannot
    for (const m of [{ type: "download_media", params: { message_id: "false_111@c.us_img" } }, { type: "request", op: "download_media", params: { message_id: "false_111@c.us_img" } }, { type: "ui_read", op: "download_media", params: { message_id: "false_111@c.us_img" } }]) await Promise.race([ext(m).catch(() => {}), sleep(1500)]);
    await evalIn("https://web.whatsapp.com", `window.postMessage({type:"download_media",op:"download_media",message_id:"false_111@c.us_img"},"*")`);
    await sleep(800); assert.equal(hits.length, before); assert.deepEqual(readdirSync(downloads), []);

    // video: 20 MB in several pieces, byte for byte
    const v = await get("video"); assert.equal(v.status, "saved", JSON.stringify(v));
    assert.ok(readFileSync(v.path).equals(plain.video)); assert.match(basename(v.path), /^video-2023.*\.mp4$/); assert.equal(basename(dirname(v.path)), "AI for Business Chat Assistant"); assert.equal(v._content.length, 1);
    const n1 = hits.length; assert.equal((await get("video")).path, v.path); assert.equal(hits.length, n1, "no second download");
    // WhatsApp's downloader gave wrong bytes -> refused, direct route used
    const p = await get("pdf"); assert.equal(p.source, "downloaded from WhatsApp's media server"); assert.ok(readFileSync(p.path).equals(plain.pdf)); assert.equal(Buffer.from(p._content[1].resource.blob, "base64").toString(), plain.pdf.toString());
    const im = await get("img"); assert.equal(im._content[1].type, "image"); assert.ok(readFileSync(im.path).equals(png));
    const vo = await get("voice"); assert.ok(readFileSync(vo.path).equals(plain.voice)); assert.match(vo.path, /\.ogg$/);
    // a second AI session
    const b = startMcp(); await b.rpc("initialize", { clientInfo: { name: "B" } });
    const w = await get("viaWa", b); assert.equal(w.source, "downloaded by WhatsApp Web"); assert.equal(w.file_text, "from whatsapp itself");
    // same name twice never overwrites; two sessions asking together download once
    const n2 = hits.length; const [e1, e2] = await Promise.all([get("evil"), get("evil", b)]);
    assert.equal(e1.path, e2.path); assert.equal(hits.length, n2 + 1);
    assert.equal(dirname(e1.path), dirname(v.path)); assert.equal(basename(e1.path), "_.._.._x_evil.txt");
    // refused
    assert.equal((await get("bad")).code, "DOWNLOAD_FAILED"); assert.equal((await get("gone")).code, "EXPIRED"); assert.equal((await get("redirect")).code, "DOWNLOAD_FAILED");
    assert.equal((await get("host1")).code, "DOWNLOAD_FAILED"); assert.equal((await get("host2")).code, "DOWNLOAD_FAILED"); assert.ok(!hosts.has("evil.test"));
    assert.equal((await get("once")).code, "VIEW_ONCE"); assert.equal((await get("big")).code, "TOO_BIG"); assert.equal((await get("chat")).code, "NO_MEDIA"); assert.equal((await get("nope")).code, "MESSAGE_NOT_FOUND");
    assert.equal((await get("exe")).code, "PROGRAM_FILE");
    // malware checks look at the content, not the name
    assert.equal((await get("realvid")).status, "saved"); assert.equal((await get("realvid2")).status, "saved");
    assert.equal((await get("fakejpg")).code, "PROGRAM_FILE");
    const z = await get("zipexe"); assert.equal(z.code, "TYPE_NOT_ALLOWED"); // archives are never saved
    assert.equal((await get("jspdf")).code, "DANGEROUS_PDF");
    assert.equal((await get("macro")).code, "MACRO_FILE");
    const dx = await get("docx"); assert.equal(dx.status, "saved", JSON.stringify(dx)); assert.ok(readFileSync(dx.path).equals(plain.docx));
    assert.equal(im.checks.real_type, "PNG image"); assert.deepEqual(im.checks.warnings, []);
    // slow: answers in time, then the same call gives the result
    const t0 = Date.now(), s1 = await get("slow"); assert.equal(s1.status, "downloading", JSON.stringify(s1)); assert.ok(Date.now() - t0 < 50000);
    const s2 = await get("slow"); assert.equal(s2.status, "saved"); assert.equal(s2.file_text, plain.slow.toString());
    assert.equal(hits.filter((h) => h.url.includes("slow")).length, 1);
    // nothing in WhatsApp was touched, nothing left behind, no cookies or referrer sent
    assert.deepEqual(await evalIn("https://web.whatsapp.com", "({t:window.touched,u:chat.unreadCount,h:window[Symbol.for('aifb.media')].size})"), { t: [], u: 3, h: 0 });
    assert.ok(hits.every((h) => !h.cookie && !h.referer));
    assert.ok(readdirSync(join(downloads, "AI for Business Chat Assistant")).every((f) => !/\.(crdownload|exe)$/.test(f)));
    assert.ok(readdirSync(join(downloads, "AI for Business Chat Assistant")).every((f) => !/fakejpg|holiday|menu|offer/.test(f)));
    step(readdirSync(join(downloads, "AI for Business Chat Assistant")).join(" | "));
    // dashboard: list with redrawn previews, refused files shown, no open button
    await fetch(http + `/json/new?chrome-extension://${ID}/dashboard.html#files`, { method: "PUT" });
    await sleep(1500);
    const dash = await evalIn(`chrome-extension://${ID}/dashboard.html`, `(async () => {
      const d = await chrome.runtime.sendMessage({ type: "dash_data" });
      location.hash = "files"; await new Promise((r) => setTimeout(r, 300));
      for (let i = 0; i < 40 && !document.querySelector("#v-files .file canvas[width]:not([width='300'])"); i++) await new Promise((r) => setTimeout(r, 250));
      const cards = [...document.querySelectorAll("#v-files .file")];
      return { media: d.media.map((x) => ({ id: x.message_id.split("_").pop(), status: x.status, thumb: !!x.thumb, jpeg: (x.thumb || "").startsWith("/9j/"), block: x.block?.code || null, warn: x.warnings.map((w) => w.code), exists: x.exists, note: x.thumb_note })),
        visible: !document.getElementById("v-files").hidden, cards: cards.length, drawn: [...document.querySelectorAll("#v-files canvas")].filter((c) => c.width > 0 && c.width !== 300).length,
        blockedCards: document.querySelectorAll("#v-files .file.blocked").length, lang: document.documentElement.lang, title: document.title, langPref: getUiLangPref(), buttons: [...document.querySelectorAll("#v-files button")].map((b) => b.textContent) };
    })()`);
    step(JSON.stringify(dash));
    const by = Object.fromEntries(dash.media.map((x) => [x.id, x]));
    assert.ok(dash.visible);
    // English by default (tests/i18n.test.mjs covers a Chinese browser)
    assert.equal(dash.langPref, "en"); assert.equal(dash.lang, "en"); assert.equal(dash.title, "AI for Business Chat Assistant dashboard");
    assert.equal(by.img.status, "saved"); assert.ok(by.img.jpeg, "image preview is a redrawn JPEG"); assert.equal(by.img.exists, true);
    assert.ok(by.video.jpeg, "video preview from WhatsApp's own small picture");
    assert.ok(by.realvid.jpeg, "video preview from a frame of the video itself " + by.realvid.note);
    assert.ok(by.realvid2.jpeg, "video with moov at the end and sound " + by.realvid2.note);
    assert.equal(by.realvid.note, "frame: webcodecs"); assert.equal(by.realvid2.note, "frame: webcodecs");
    assert.equal(by.fakejpg.status, "blocked"); assert.equal(by.fakejpg.block, "PROGRAM_FILE"); assert.equal(by.fakejpg.thumb, false);
    assert.equal(by.zipexe.block, "TYPE_NOT_ALLOWED"); assert.equal(by.jspdf.block, "DANGEROUS_PDF"); assert.equal(by.macro.block, "MACRO_FILE");
    assert.equal(dash.cards, dash.media.length); assert.ok(dash.drawn >= 2, "previews drawn"); assert.ok(dash.blockedCards >= 3);
    if (process.env.E2E_SHOT) { // optional picture of the page, for a person to look at
      const t = (await (await fetch(http + "/json")).json()).find((x) => x.url.startsWith(`chrome-extension://${ID}/dashboard.html`));
      const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
      const send = (id, method, params) => new Promise((r) => { ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id === id) r(m.result); }); ws.send(JSON.stringify({ id, method, params })); });
      await send(1, "Emulation.setDeviceMetricsOverride", { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
      await sleep(400);
      writeFileSync(process.env.E2E_SHOT, Buffer.from((await send(2, "Page.captureScreenshot", { format: "png" })).data, "base64")); ws.close();
    }
    assert.ok(dash.buttons.every((t) => !/^(open|打开)/i.test(t)), "no open button");
    // "My data": every clear asks first (real mouse clicks; a script click is not accepted), Cancel keeps everything
    {
      const t = (await (await fetch(http + "/json")).json()).find((x) => x.url.startsWith(`chrome-extension://${ID}/dashboard.html`));
      const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
      let nid = 10; const pend = new Map();
      ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
      const send = (method, params) => new Promise((r) => { const id = nid++; pend.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
      const ev = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
      const click = async (sel) => {
        const r = await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
        for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", clickCount: 1 });
        await sleep(400);
      };
      const summary = () => ev(`chrome.runtime.sendMessage({ type: "dash_data_summary" })`);
      await send("Page.bringToFront", {});
      await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
      await ev(`location.hash = "data"; new Promise((r) => setTimeout(r, 800))`);
      assert.equal(await ev(`document.querySelectorAll("#dataList li").length`), 7);
      const before = await summary();
      assert.ok(before.media.count > 0 && before.pairing.paired, JSON.stringify(before));
      await ev(`document.getElementById("clearAllData").click(); new Promise((r) => setTimeout(r, 300))`);
      assert.equal(await ev(`document.getElementById("confirmBack").hidden`), true, "a script click does not open the clear dialog");
      await click("#clearAllData");
      assert.equal(await ev(`document.getElementById("confirmBack").hidden`), false, "asks before clearing");
      await click("#confirmNo");
      assert.equal(await ev(`document.getElementById("confirmBack").hidden`), true);
      assert.equal((await summary()).media.count, before.media.count, "Cancel keeps everything");
      await click("#clearAllData"); await click("#confirmYes"); await sleep(800);
      const after = await summary();
      for (const k of ["drafts", "activity", "media", "ignored"]) assert.equal(after[k].count, 0, k);
      assert.equal(after.pairing.paired, false);
      assert.ok(readdirSync(join(downloads, "AI for Business Chat Assistant")).length > 0, "downloaded files are not deleted");
      ws.close();
    }
  } finally { procs.forEach((p) => p.kill("SIGKILL")); srv.close(); srv.closeAllConnections(); await sleep(500); try { rmSync(dir, { recursive: true, force: true }); } catch (_) {} }
});
