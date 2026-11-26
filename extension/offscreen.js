// 看不见的插件页面：把文件片段接起来，做成 Chrome 可以下载的网址。只听插件自己的背景程序。
const boxes = new Map(); // id -> { parts, url }
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.target !== "offscreen" || sender.id !== chrome.runtime.id || sender.tab) return false;
  const b = boxes.get(msg.box) || { parts: [], url: null };
  if (msg.type === "add") {
    b.parts.push(new Blob([Uint8Array.from(atob(msg.data), (c) => c.charCodeAt(0))]));
    boxes.set(msg.box, b);
    reply({ ok: true });
  } else if (msg.type === "make") {
    const blob = new Blob(b.parts, { type: "application/octet-stream" }); // 不让 Chrome 猜类型、改副档名
    b.url = URL.createObjectURL(blob);
    boxes.set(msg.box, b);
    reply({ ok: true, url: b.url, size: blob.size });
  } else if (msg.type === "frame") {
    // 影片预览：在这个看不见的页面里取一格画面，重新画成小 JPEG（不播放声音，不显示给任何人）
    frame(b.parts, msg.mime).then((r) => reply({ ok: !!r.data, ...r }), (e) => reply({ ok: false, why: String(e?.message || e).slice(0, 80) }));
    return true;
  } else if (msg.type === "drop") {
    if (b.url) URL.revokeObjectURL(b.url);
    boxes.delete(msg.box);
    reply({ ok: true });
  }
  return false;
});

// 1. 直接从 MP4 拿第一张画面，用 Chrome 的 WebCodecs 解码（不靠播放器：Chrome 对看不见的页面常常不解码影片）
// 2. 不行再用 <video>
async function frame(parts, mime) {
  if (!parts.length || !/^video\/(mp4|3gpp|quicktime|webm)$/.test(mime || "")) return { why: "type" };
  const blob = new Blob(parts, { type: mime });
  let why = "";
  try { const d = await firstFrameMp4(blob); if (d) return { data: d, how: "webcodecs" }; why = "webcodecs: none"; } catch (e) { why = "webcodecs: " + String(e?.message || e).slice(0, 60); }
  try { const d = await viaVideo(blob); if (d) return { data: d, how: "video" }; why += "; video: none"; } catch (e) { why += "; video: " + String(e?.message || e).slice(0, 60); }
  return { why };
}
const toJpeg = async (src, w, h) => {
  const f = Math.min(1, 360 / Math.max(w, h));
  const cv = new OffscreenCanvas(Math.max(1, Math.round(w * f)), Math.max(1, Math.round(h * f)));
  cv.getContext("2d").drawImage(src, 0, 0, cv.width, cv.height);
  const out = await cv.convertToBlob({ type: "image/jpeg", quality: 0.75 });
  if (out.size > 60000) return null;
  const u8 = new Uint8Array(await out.arrayBuffer()); let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
};
// 最小的 MP4 读法：只找第一条影像轨的 avcC、第一个样本的位置和大小
async function firstFrameMp4(blob) {
  if (typeof VideoDecoder === "undefined" || blob.size > 150 * 1024 * 1024) return null;
  const buf = new Uint8Array(await blob.arrayBuffer()), dv = new DataView(buf.buffer);
  const kids = (from, to) => {
    const out = [];
    for (let p = from; p + 8 <= to;) {
      let size = dv.getUint32(p), head = 8;
      const type = String.fromCharCode(buf[p + 4], buf[p + 5], buf[p + 6], buf[p + 7]);
      if (size === 1) { if (p + 16 > to) break; size = Number(dv.getBigUint64(p + 8)); head = 16; } else if (size === 0) size = to - p;
      if (size < head || p + size > to) break;
      out.push({ type, start: p + head, end: p + size });
      p += size;
    }
    return out;
  };
  const one = (list, t) => list.find((x) => x.type === t);
  const moov = one(kids(0, buf.length), "moov"); if (!moov) return null;
  for (const trak of kids(moov.start, moov.end).filter((x) => x.type === "trak")) {
    const mdia = one(kids(trak.start, trak.end), "mdia"); if (!mdia) continue;
    const md = kids(mdia.start, mdia.end), hdlr = one(md, "hdlr");
    if (!hdlr || String.fromCharCode(...buf.subarray(hdlr.start + 8, hdlr.start + 12)) !== "vide") continue;
    const minf = one(md, "minf"), stbl = minf && one(kids(minf.start, minf.end), "stbl"); if (!stbl) continue;
    const st = kids(stbl.start, stbl.end), stsd = one(st, "stsd"), stsz = one(st, "stsz"), stco = one(st, "stco") || one(st, "co64");
    if (!stsd || !stsz || !stco) continue;
    const entry = kids(stsd.start + 8, stsd.end)[0];
    if (!entry || !/^avc[13]$/.test(entry.type)) return null;          // 只做 H.264（WhatsApp 影片几乎都是）
    const w = dv.getUint16(entry.start + 24), h = dv.getUint16(entry.start + 26);
    const avcC = one(kids(entry.start + 78, entry.end), "avcC"); if (!avcC) return null;
    const desc = buf.slice(avcC.start, avcC.end);
    const hex = (n) => n.toString(16).padStart(2, "0");
    const codec = `avc1.${hex(desc[1])}${hex(desc[2])}${hex(desc[3])}`;
    const size = dv.getUint32(stsz.start + 4) || dv.getUint32(stsz.start + 12);
    const off = stco.type === "co64" ? Number(dv.getBigUint64(stco.start + 8)) : dv.getUint32(stco.start + 8);
    if (!size || off + size > buf.length || !w || !h) return null;
    const support = await VideoDecoder.isConfigSupported({ codec, description: desc, codedWidth: w, codedHeight: h });
    if (!support.supported) throw new Error("not supported " + codec);
    let got = null, err = null;
    const dec = new VideoDecoder({ output: (f) => { if (!got) got = f; else f.close(); }, error: (e) => { err = e; } });
    try {
      dec.configure({ codec, description: desc, codedWidth: w, codedHeight: h });
      dec.decode(new EncodedVideoChunk({ type: "key", timestamp: 0, data: buf.subarray(off, off + size) }));
      await Promise.race([dec.flush(), new Promise((_, no) => setTimeout(() => no(new Error("timeout")), 8000))]);
      if (!got) throw err || new Error("no frame");
      return await toJpeg(got, got.displayWidth || w, got.displayHeight || h);
    } finally { got?.close(); try { dec.close(); } catch (_) {} }
  }
  return null;
}
async function viaVideo(blob) {
  const url = URL.createObjectURL(blob);
  const v = document.createElement("video");
  v.muted = true; v.preload = "auto"; v.playsInline = true;
  try {
    const wait = (ev) => new Promise((ok, no) => { v.addEventListener(ev, ok, { once: true }); v.addEventListener("error", () => no(new Error("cannot play")), { once: true }); });
    const time = (ms) => new Promise((_, no) => setTimeout(() => no(new Error("timeout")), ms));
    v.src = url;
    await Promise.race([wait("loadeddata"), time(8000)]);
    if (v.duration > 1) { v.currentTime = Math.min(1, v.duration / 3); await Promise.race([wait("seeked"), time(5000)]); }
    if (!v.videoWidth || !v.videoHeight) return null;
    return await toJpeg(v, v.videoWidth, v.videoHeight);
  } finally { v.removeAttribute("src"); v.load(); URL.revokeObjectURL(url); }
}
