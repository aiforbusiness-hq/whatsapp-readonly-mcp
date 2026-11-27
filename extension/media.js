// The AI calls download_media over MCP: save that message's file into the "Downloads / AI for Business Chat Assistant" folder.
// Called only from background.js's MCP request channel. Saving uses Chrome's own downloads (visible, safety-checked, never overwrites old files).
import { runInWa } from "./wa.js";
import { mediaInPage } from "./downloader.js";
import { scanner, isProgramName, PREVIEWABLE, typeLabel, deepCheck, DEEP_MAX, safeToDecode, block as blockMsg } from "./scan.js";

const FOLDER = "AI for Business Chat Assistant";
const CHUNK = 6 * 1024 * 1024;
const WAIT_MS = 40000;          // AI apps usually wait 60 s; if not done, reply "still downloading" and keep waiting on the next ask
const KEEP_MS = 10 * 60 * 1000;
const MAX_ACTIVE = 3;
const ATTACH_MAX = 500000;
const jobs = new Map();         // message_id -> { promise, result, at }
let active = 0;

export async function downloadMedia(params) {
  const id = String(params?.message_id || "").trim();
  if (!id) return { ok: false, code: "BAD_PARAM", reason: "Give the message id from get_messages or search_messages" };
  for (const [k, j] of jobs) if (j.result && Date.now() - j.at > KEEP_MS) jobs.delete(k);
  let job = jobs.get(id);
  if (job?.result && !(await stillThere(job.result))) job = null;
  if (!job) {
    if (active >= MAX_ACTIVE) return { ok: false, code: "BUSY", reason: "3 downloads are already running. Wait a moment and try again." };
    job = { result: null, at: 0 };
    active++;
    job.promise = run(id).catch((e) => ({ ok: false, code: "DOWNLOAD_FAILED", reason: "Download failed: " + String(e?.message || e) }))
      .then(async (r) => { job.result = r; job.at = Date.now(); active--; if (!r.ok) jobs.delete(id); if (!active) await closeOffscreen(); return r; });
    jobs.set(id, job);
  }
  const wait = new Promise((r) => setTimeout(() => r(null), WAIT_MS));
  return (await Promise.race([job.promise, wait])) ||
    { ok: true, status: "downloading", note: "Still downloading. Call download_media again with the same message_id to get the result; it will not download twice." };
}

async function stillThere(r) {
  if (!r.ok) return false;
  const [d] = await chrome.downloads.search({ id: r.download_id });
  return !!d && d.state === "complete" && d.exists !== false;
}

async function run(id) {
  const r = await runInWa(mediaInPage, ["fetch", { message_id: id }], 330000);
  if (!r?.ok) return r;
  const { tabId, token } = r;
  const page = (op, p) => runInWa(mediaInPage, [op, { token, ...p }], 30000, tabId);
  const box = crypto.randomUUID();
  const name = safeName(r);
  const info = { chat: r.chat, message_id: id, file_name: name, mime: r.mime, size_bytes: r.size, source: r.source };
  const refuse = async (b, real) => {
    await logMedia({ ...info, status: "blocked", real: real || null, block: b, warnings: [] });
    return { ok: false, code: b.code, reason: b.en + " If the user trusts the sender, they can download it in WhatsApp themselves. Do not try to get around this." };
  };
  if (isProgramName(name)) { page("end", {}).catch(() => {}); return refuse(scanner().early(name)); }
  if (!(r.size > 0)) { page("end", {}).catch(() => {}); return refuse(blockMsg("NOT_CHECKABLE")); }
  const isImage = /^image\/(jpeg|png|webp|gif|bmp|avif)$/.test(r.mime);
  const isText = /^text\/|[/+](json|xml|csv)$/.test(r.mime) || /\.(txt|csv|md|json|xml|log|vcf|ics)$/i.test(name);
  const av = /^(video|audio)\//.test(r.mime);
  const keep = !av && r.size <= (isImage ? 25 * 1024 * 1024 : ATTACH_MAX) ? [] : null; // small files are also attached for the AI to see
  let deepParts = r.size <= DEEP_MAX ? [] : null; // kept only for PDF / Office, for the unpack check
  const sc = scanner();
  try {
    await openOffscreen();
    for (let from = 0; from < r.size; from += CHUNK) {
      const data = await page("chunk", { from, len: CHUNK });
      if (typeof data !== "string") throw new Error("the WhatsApp tab was reloaded or closed");
      const u8 = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      sc.push(u8);
      if (!from) { const b = sc.early(name); if (b) return refuse(b, sc.finish(name, r.mime).real); } // really a program: no need to receive the rest
      const a = await box_({ type: "add", box, data });
      if (!a?.ok) throw new Error("could not hold the file");
      if (keep) keep.push(u8);
      if (deepParts) { if (sc.real() === "pdf" || sc.real() === "zip") deepParts.push(u8); else deepParts = null; }
    }
    const check = sc.finish(name, r.mime);
    if (check.block) return refuse(check.block, check.real);
    if (check.deep) {
      // PDF: unpack every compressed stream to look for code; Office: unpack each part to look for macros / embedded objects. Not saved if the check cannot finish
      const b = await deepCheck(check.deep, deepParts ? join(deepParts) : null);
      deepParts = null;
      if (b) return refuse(b, check.real);
    }
    const made = await box_({ type: "make", box });
    if (!made?.ok || made.size !== r.size) throw new Error("the file is incomplete");
    const dl = await chrome.downloads.download({ url: made.url, filename: `${FOLDER}/${safeName({ file_name: check.saveName })}`, conflictAction: "uniquify", saveAs: false });
    const d = await finished(dl);
    const checks = { real_type: typeLabel(check.real, true), warnings: check.warnings.map((w) => w.en) };
    const blob = keep && new Blob(keep, { type: r.mime });
    let thumbNote = null;
    let thumb = await makeThumb(blob && PREVIEWABLE.has(check.real) && safeToDecode(join(keep)) ? blob : null, r.preview).catch(() => null);
    if (!thumb && check.real === "video") { // WhatsApp kept no preview: grab one video frame, then redraw it
      const fr = await box_({ type: "frame", box, mime: r.mime }).catch(() => null);
      if (fr?.ok && /^\/9j\//.test(fr.data)) thumb = await makeThumb(null, fr.data).catch(() => null);
      thumbNote = thumb ? "frame: " + fr.how : "no preview: " + String(fr?.why || "frame failed").slice(0, 120); // record only the method / reason, for debugging
    }
    const entry = { ...info, real: check.real, warnings: check.warnings, sha256: r.filehash || null, thumb, thumb_note: thumbNote, download_id: dl };
    if (d.asking) {
      await logMedia({ ...entry, status: "chrome_asks" });
      return { ok: false, code: "CHROME_ASKS", reason: "Chrome says this type of file can be harmful and is asking the user. The user decides in Chrome's downloads list (chrome://downloads). Do not try to get around it." };
    }
    if (d.state !== "complete") return { ok: false, code: "SAVE_FAILED", reason: "Chrome did not save the file" + (d.error ? ` (${d.error})` : "") };
    const out = { ok: true, status: "saved", path: d.filename, download_id: dl, ...info, file_name: d.filename.split(/[\\/]/).pop(), checks };
    await logMedia({ ...entry, status: "saved", path: d.filename, file_name: out.file_name });
    if (check.warnings.length) out.safety_note = "Tell the user these warnings before they open the file: " + checks.warnings.join(" ");
    if (keep) {
      try {
        if (isImage && PREVIEWABLE.has(check.real)) { if (safeToDecode(join(keep))) { const pic = await smallImage(blob); if (pic) out.image = pic; } }
        else if (isText && check.real === "text") out.file_text = (await blob.text()).slice(0, 100000);
        else if (!isImage) out.file = { mime: r.mime, name: out.file_name, data: toB64(new Uint8Array(await blob.arrayBuffer())) };
      } catch (_) {}
    }
    if (av) out.note = "Saved. Audio and video cannot be shown here; a program on this computer can open the file at path.";
    return out;
  } finally {
    page("end", {}).catch(() => {});
    box_({ type: "drop", box }).catch(() => {});
  }
}

// ---------- Dashboard "Files the AI downloaded": stored on this computer only, at most 40 entries, 60 days ----------
// Stores: file name, chat name, type, check result, a redrawn small thumbnail (not the original file). Clearing the log does not delete downloaded files.
const LOG = "media_log", LOG_MAX = 40, LOG_DAYS = 60;
let logQ = Promise.resolve();
function logMedia(e) {
  return (logQ = logQ.then(async () => {
    const r = await chrome.storage.local.get(LOG);
    const cut = Date.now() - LOG_DAYS * 86400000;
    const list = (Array.isArray(r[LOG]) ? r[LOG] : []).filter((x) => Date.parse(x.time) >= cut && !(x.message_id === e.message_id && x.status === e.status));
    list.unshift({ time: new Date().toISOString(), message_id: e.message_id, chat: e.chat?.name ? String(e.chat.name).slice(0, 80) : null, chat_id: e.chat?.id || null,
      file_name: e.file_name, mime: e.mime, size_bytes: e.size_bytes, real: e.real, status: e.status, block: e.block || null, warnings: e.warnings || [],
      sha256: e.sha256 || null, thumb: e.thumb || null, thumb_note: e.thumb_note || null, download_id: e.download_id ?? null, path: e.path || null });
    try { await chrome.storage.local.set({ [LOG]: list.slice(0, LOG_MAX) }); }
    catch (_) { await chrome.storage.local.set({ [LOG]: list.slice(0, 10).map((x, i) => (i ? { ...x, thumb: null } : x)) }).catch(() => {}); }
  }).catch(() => {}));
}
export async function getMediaLog() {
  const r = await chrome.storage.local.get(LOG);
  const cut = Date.now() - LOG_DAYS * 86400000; // the retention limit also applies on read
  const list = (Array.isArray(r[LOG]) ? r[LOG] : []).filter((x) => Date.parse(x.time) >= cut);
  for (const x of list) {
    if (x.status !== "saved" || x.download_id == null) continue;
    const [d] = await chrome.downloads.search({ id: x.download_id }).catch(() => []);
    x.exists = !!d && d.exists !== false && d.state === "complete";
  }
  return list;
}
export const clearMediaLog = () => (logQ = logQ.then(() => chrome.storage.local.remove(LOG)).catch(() => {})); // same queue as writes
// Only "Show in folder"; never open the file for the user (no chrome.downloads.open)
export async function showFile(downloadId) {
  const list = (await chrome.storage.local.get(LOG))[LOG] || [];
  const x = list.find((y) => y.status === "saved" && y.download_id === downloadId);
  if (!x) return { ok: false };
  const [d] = await chrome.downloads.search({ id: downloadId });
  if (!d || d.exists === false) return { ok: false, gone: true };
  chrome.downloads.show(downloadId);
  return { ok: true };
}

// Thumbnail: always redrawn as a new JPEG (max 360 px), so nothing hidden in the original (code, location data) comes along
async function makeThumb(blob, waPreview) {
  let src = blob;
  if (!src && waPreview && /^(\/9j\/|iVBORw0KGgo|UklGR)/.test(waPreview) && waPreview.length < 400000) {
    const u8 = Uint8Array.from(atob(waPreview), (c) => c.charCodeAt(0));
    if (safeToDecode(u8)) src = new Blob([u8]); // check size first: do not decode images that are too big
  }
  if (!src) return null;
  const bmp = await createImageBitmap(src);
  try {
    if (!bmp.width || !bmp.height || bmp.width * bmp.height > 100e6) return null;
    for (const [side, q] of [[360, 0.75], [260, 0.65]]) {
      const f = Math.min(1, side / Math.max(bmp.width, bmp.height));
      const cv = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * f)), Math.max(1, Math.round(bmp.height * f)));
      const g = cv.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height);
      g.drawImage(bmp, 0, 0, cv.width, cv.height);
      const out = await cv.convertToBlob({ type: "image/jpeg", quality: q });
      if (out.size <= 60000) return toB64(new Uint8Array(await out.arrayBuffer()));
    }
  } finally { bmp.close(); }
  return null;
}

// promptForScanning = Chrome wants the user to decide on a deep scan: counts as "Chrome is asking you"
const OK_DANGER = new Set(["safe", "accepted", "allowlistedByPolicy", "deepScannedSafe", "asyncScanning"]);
async function finished(id) {
  for (let i = 0; i < 600; i++) {
    const [d] = await chrome.downloads.search({ id });
    if (!d) return { state: "interrupted" };
    if (d.state !== "in_progress") return d;
    if (d.danger && !OK_DANGER.has(d.danger)) return { asking: true };
    await new Promise((r) => setTimeout(r, 300));
  }
  return { state: "in_progress", error: "timeout" };
}

// ---------- File names: the sender's name cannot be trusted ----------
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4", "video/3gpp": "3gp", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "application/pdf": "pdf" };
export function safeName(r) {
  let raw = String(r.file_name || "");
  if (raw.length > 1024) raw = raw.slice(0, 512) + raw.slice(-512); // shorten first: a sender's name can be very long and slow down the regex
  let n = raw.normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, "") // invisible characters, right-to-left characters (can make .exe look like .jpg)
    .replace(/[<>:"/\\|?*~%]/g, "_").replace(/\s+/g, " ");
  let a = 0, b = n.length; // strip leading / trailing dots and spaces (no regex, fast for long names)
  while (a < b && (n[a] === "." || n[a] === " ")) a++;
  while (b > a && (n[b - 1] === "." || n[b - 1] === " ")) b--;
  n = n.slice(a, b);
  if (!n) {
    const t = (r.time ? new Date(r.time) : new Date()).toISOString().slice(0, 19).replace(/[:T]/g, "-");
    n = `${{ ptt: "voice", ptv: "video" }[r.kind] || r.kind || "file"}-${t}` + (EXT[r.mime] ? "." + EXT[r.mime] : "");
  }
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(n)) n = "_" + n;
  if (n.length > 120) { const x = /\.[A-Za-z0-9]{1,8}$/.exec(n)?.[0] || ""; n = n.slice(0, 120 - x.length) + x; }
  return n;
}

// ---------- The background script cannot make download URLs, so a hidden extension page (offscreen) does it ----------
let opening = null, closing = null;
async function openOffscreen() {
  await closing;
  const has = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (has.length) return;
  opening = opening || chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["BLOBS"], justification: "Save a WhatsApp file the AI was asked to download" }).finally(() => { opening = null; });
  await opening;
}
const closeOffscreen = () => (closing = chrome.offscreen.closeDocument().catch(() => {}).finally(() => { closing = null; }));
const box_ = (msg) => chrome.runtime.sendMessage({ target: "offscreen", ...msg });

const join = (parts) => { let n = 0; for (const p of parts) n += p.length; const all = new Uint8Array(n); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; } return all; };
const toB64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
async function smallImage(blob) {
  const bmp = await createImageBitmap(blob);
  try {
    for (const [side, q] of [[1568, 0.85], [1568, 0.7], [1100, 0.7], [800, 0.6]]) {
      const f = Math.min(1, side / Math.max(bmp.width, bmp.height));
      const cv = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * f)), Math.max(1, Math.round(bmp.height * f)));
      const g = cv.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height);
      g.drawImage(bmp, 0, 0, cv.width, cv.height);
      const out = await cv.convertToBlob({ type: "image/jpeg", quality: q });
      if (out.size <= ATTACH_MAX) return { mime: "image/jpeg", data: toB64(new Uint8Array(await out.arrayBuffer())), width: cv.width, height: cv.height };
    }
  } finally { bmp.close(); }
  return null;
}

// get_media may also hand a small file straight to the AI (reader.js): same checks as download_media; if it fails, give details only, not the file
export async function vetMedia(r) {
  if (!r?.ok || !r.file?.data) return r;
  const name = safeName({ file_name: r.file.name, mime: r.file.mime, kind: "document" });
  let bytes = null;
  try { bytes = Uint8Array.from(atob(r.file.data), (c) => c.charCodeAt(0)); } catch (_) {}
  const sc = scanner();
  let b = isProgramName(name) ? sc.early(name) : null, check = null;
  if (!b && bytes?.length) {
    sc.push(bytes);
    check = sc.finish(name, r.file.mime);
    b = check.block || (check.deep ? await deepCheck(check.deep, bytes) : null);
  }
  if (!b && !check) b = blockMsg("NOT_CHECKABLE");
  const { file, ...rest } = r;
  if (b) return { ...rest, content: "none", file_name: name, blocked: { code: b.code, reason: b.en }, note: "The file was not handed over: " + b.en };
  const saveName = safeName({ file_name: check.saveName });
  return { ...rest, file: { ...file, name: saveName }, checks: { real_type: typeLabel(check.real, true), warnings: [] } };
}
