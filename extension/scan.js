// 防恶意文件：看文件「真正的内容」，不信对方取的名字或 WhatsApp 写的类型。
//
// 原则：白名单。AI 只代为存下「看得完、查得完」的文件：
//   照片（JPEG / PNG / GIF / WebP / BMP / HEIC / AVIF）、影片、声音 / 语音、纯文字（TXT / CSV / JSON / XML…）、
//   PDF（解开所有压缩流检查）、新版 Office（DOCX / XLSX / PPTX / ODF，逐个部分解开检查）。
// 其他一律不存（压缩档、旧版 Office、RTF、SVG、网页、程序、认不出的格式），请用户自己在 WhatsApp 里判断。
// 任何一项检查做不完（加密、太大、不认识的压缩方式），也不存：宁可错杀。
//
// media.js 一边接收文件片段一边检查（scanner().push），最后 finish()；PDF 和 Office 再用 deepCheck() 解开检查。
// 纯函数，不用 chrome.*，方便测试。Chrome 自己的安全检查和电脑的防毒仍然是最后一道；仪表板永远不提供「打开」按钮。

// 程式 / 脚本 / 网页 / 会执行程序码的格式：看名字就拒绝（每一段路径都看）
export const PROGRAM = /\.(exe|msi|msix|msixbundle|appx|appxbundle|com|scr|pif|bat|cmd|ps1|psm1|vbs|vbe|js|jse|mjs|cjs|wsf|wsh|hta|reg|lnk|url|cpl|inf|sys|dll|ocx|jar|class|app|dmg|pkg|mpkg|command|tool|sh|bash|zsh|csh|ksh|fish|py|pyc|pyw|rb|pl|php|scpt|scptd|applescript|workflow|terminal|webloc|inetloc|fileloc|mobileconfig|iso|img|vhd|vhdx|apk|xapk|apks|aab|ipa|appimage|deb|rpm|desktop|xll|docm|xlsm|xlsb|pptm|dotm|xltm|potm|ppam|xlam|sldm|chm|html?|xhtml?|shtml|mht|mhtml|svgz?|xht|settingcontent-ms|library-ms|search-ms|searchconnector-ms|gadget|msc|msp|msu|mst|scf|application|appref-ms|xbap|vsto|ws|rdp|diagcab|one|onepkg|jnlp|iqy|slk|wsc|sct|vb|vba|ps1xml|psc1|psd1|msh|msh1|msh2|mshxml|website|appinstaller|accdb|accde|accdr|accdt|mdb|mde|ade|adp|mda|mdz|theme|themepack|deskthemepack|xlm|hlp|shs|shb|elf|run|out|so|dylib|kext|plugin|prefpane|saver|widget|bundle|framework|action|osax)$/i;
export const isProgramName = (n) => String(n || "").split(/[/\\]/).some((seg) => PROGRAM.test(seg.replace(/[\s.\u0000]+$/, "")));

const LABEL = {
  exe: ["程序", "program"], script: ["脚本", "script"], html: ["网页", "web page"], svg: ["SVG 图", "SVG image"],
  jpeg: ["JPEG 图片", "JPEG image"], png: ["PNG 图片", "PNG image"], gif: ["GIF 图片", "GIF image"], webp: ["WebP 图片", "WebP image"],
  bmp: ["BMP 图片", "BMP image"], avif: ["AVIF 图片", "AVIF image"], heic: ["HEIC 图片", "HEIC image"],
  video: ["影片", "video"], audio: ["声音", "audio"], pdf: ["PDF", "PDF"], office: ["Office 文件", "Office file"], ole: ["旧版 Office 文件", "old Office file"],
  rtf: ["RTF 文件", "RTF document"], zip: ["压缩档 (ZIP)", "ZIP archive"], rar: ["压缩档 (RAR)", "RAR archive"], "7z": ["压缩档 (7z)", "7z archive"], gz: ["压缩档 (GZ)", "GZ archive"],
  tar: ["压缩档 (TAR)", "TAR archive"], xml: ["XML", "XML"], text: ["文字", "text"], unknown: ["认不出", "unknown"]
};
export const typeLabel = (t, en) => (LABEL[t] || LABEL.unknown)[en ? 1 : 0];

const FAMILY = { jpeg: "image", png: "image", gif: "image", webp: "image", bmp: "image", avif: "image", heic: "image", video: "av", audio: "av", pdf: "pdf", office: "office", ole: "ole", zip: "archive", rar: "archive", "7z": "archive", gz: "archive", tar: "archive", text: "text", xml: "text", rtf: "rtf", svg: "svg", html: "html", exe: "exe", script: "exe" };
const EXT_FAMILY = {
  image: /\.(jpe?g|jfif|png|gif|webp|bmp|avif|heic|heif)$/i, av: /\.(mp4|m4v|3gp|3gpp|mov|webm|mkv|avi|ogg|oga|opus|mp3|m4a|aac|amr|wav|flac)$/i,
  pdf: /\.pdf$/i, office: /\.(docx|xlsx|pptx|odt|ods|odp)$/i, ole: /\.(doc|xls|ppt|msg|pub|vsd|dot|xlt|pot)$/i,
  archive: /\.(zip|rar|7z|gz|tgz|tar|bz2|xz|cab)$/i, text: /\.(txt|csv|tsv|md|json|xml|log|vcf|ics)$/i, rtf: /\.rtf$/i
};
const MIME_FAMILY = (m) => /^image\/svg/.test(m) ? "svg" : /^image\//.test(m) ? "image" : /^(video|audio)\//.test(m) ? "av" : m === "application/pdf" ? "pdf"
  : /officedocument|opendocument/.test(m) ? "office" : /^application\/(msword|vnd\.ms-)/.test(m) ? "ole" : /zip|rar|7z|gzip|x-tar/.test(m) ? "archive" : /^text\/html|xhtml/.test(m) ? "html" : /^text\//.test(m) ? "text" : null;
export function expectedFamily(name, mime) {
  for (const [f, re] of Object.entries(EXT_FAMILY)) if (re.test(name || "")) return f;
  return /\.[A-Za-z0-9]{1,8}$/.test(name || "") ? "other" : MIME_FAMILY(String(mime || "").toLowerCase());
}
// 白名单：可以存的真正类型，和名字没有对的副档名时补上的副档名
const ALLOWED = { jpeg: "jpg", png: "png", gif: "gif", webp: "webp", bmp: "bmp", avif: "avif", heic: "heic", video: "mp4", audio: "m4a", pdf: "pdf", office: null, text: "txt", xml: "xml" };
const EXT_OK = { jpeg: /\.(jpe?g|jfif)$/i, png: /\.png$/i, gif: /\.gif$/i, webp: /\.webp$/i, bmp: /\.bmp$/i, avif: /\.avif$/i, heic: /\.(heic|heif)$/i,
  video: /\.(mp4|m4v|3gp|3gpp|mov|webm|mkv)$/i, audio: /\.(ogg|oga|opus|mp3|m4a|aac|amr|wav|flac|mp4)$/i, pdf: /\.pdf$/i,
  office: /\.(docx|xlsx|pptx|odt|ods|odp)$/i, text: /\.(txt|csv|tsv|md|json|log|vcf|ics)$/i, xml: /\.xml$/i };

const at = (h, sig, off = 0) => h.length >= off + sig.length && sig.every((b, i) => h[off + i] === b);
const latin1 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return s; };
// 网页 / 会执行的内容（文字和 XML 整个文件都看，不只看开头）
const ACTIVE = /<([a-z0-9_.-]+:)?(script|iframe|frame|object|embed|form|foreignobject|handler|html|body|meta|link|base)\b|javascript:|vbscript:|xmlns(:[a-z0-9_.-]+)?\s*=\s*["']?http:\/\/www\.w3\.org\/1999\/xhtml|\son[a-z]+\s*=|<\?xml-stylesheet/i;

// 看开头几个 byte 认出真正的类型
export function sniff(h) {
  if (at(h, [0x4d, 0x5a])) return "exe";                                   // Windows 程序 (MZ)
  if (at(h, [0x7f, 0x45, 0x4c, 0x46])) return "exe";                       // Linux 程序 (ELF)
  if ([[0xfe, 0xed, 0xfa, 0xce], [0xfe, 0xed, 0xfa, 0xcf], [0xce, 0xfa, 0xed, 0xfe], [0xcf, 0xfa, 0xed, 0xfe], [0xca, 0xfe, 0xba, 0xbe], [0xbe, 0xba, 0xfe, 0xca]].some((s) => at(h, s))) return "exe"; // Mac 程序 / Java
  if (at(h, [0x64, 0x65, 0x78, 0x0a])) return "exe";                       // Android
  if (at(h, [0x4c, 0, 0, 0, 0x01, 0x14, 0x02, 0])) return "exe";           // Windows 捷径 .lnk
  if (at(h, [0x23, 0x21, 0x41, 0x4d, 0x52])) return "audio";               // #!AMR 语音
  if (at(h, [0x23, 0x21])) return "script";                                // #!/bin/sh
  if (at(h, [0xff, 0xd8, 0xff])) return "jpeg";
  if (at(h, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (at(h, [0x47, 0x49, 0x46, 0x38])) return "gif";
  if (at(h, [0x52, 0x49, 0x46, 0x46])) return at(h, [0x57, 0x45, 0x42, 0x50], 8) ? "webp" : at(h, [0x57, 0x41, 0x56, 0x45], 8) ? "audio" : at(h, [0x41, 0x56, 0x49, 0x20], 8) ? "video" : "unknown";
  if (at(h, [0x42, 0x4d]) && h.length > 26 && h[14] && !h[15] && !h[16]) return "bmp";
  if (at(h, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = latin1(h.subarray(8, 12));
    return /^avi[fs]$/.test(brand) ? "avif" : /^(heic|heix|heim|heis|hevc|mif1|msf1)$/.test(brand) ? "heic" : /^M4[AB] $/.test(brand) ? "audio" : "video";
  }
  if (at(h, [0x1a, 0x45, 0xdf, 0xa3])) return "video";                     // webm / mkv
  if (at(h, [0x4f, 0x67, 0x67, 0x53]) || at(h, [0x66, 0x4c, 0x61, 0x43]) || at(h, [0x49, 0x44, 0x33]) || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0)) return "audio";
  if (at(h, [0x50, 0x4b, 0x03, 0x04]) || at(h, [0x50, 0x4b, 0x05, 0x06]) || at(h, [0x50, 0x4b, 0x07, 0x08])) return "zip";
  if (at(h, [0x52, 0x61, 0x72, 0x21])) return "rar";
  if (at(h, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return "7z";
  if (at(h, [0x1f, 0x8b]) || at(h, [0x42, 0x5a, 0x68]) || at(h, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return "gz";
  if (at(h, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "ole";
  if (h.length > 262 && latin1(h.subarray(257, 262)) === "ustar") return "tar";
  const head1k = latin1(h.subarray(0, 1024));
  if (head1k.includes("%PDF-")) return "pdf";                              // 阅读器在前 1024 bytes 找得到就会开
  if (/^\s*\{\\rt/i.test(head1k)) return "rtf";                            // Word 接受 {\rt 开头
  const t = latin1(h.subarray(0, 2048)).replace(/^(\xef\xbb\xbf|\xff\xfe|\xfe\xff)/, "").replace(/\0/g, "").trimStart().toLowerCase();
  if (/^<(!doctype\s+html|html|head|body|script|iframe|meta|a\s|form|object|embed)/.test(t) || (/^</.test(t) && ACTIVE.test(t))) return "html";
  if (/^<svg/.test(t) || (/^<\?xml/.test(t) && /<svg/.test(t))) return "svg";
  if (/^<\?xml/.test(t)) return "xml";
  if (t && /^[\x09\x0a\x0d\x20-\x7e\x80-\xff]*$/.test(latin1(h.subarray(0, 512)).replace(/^(\xff\xfe|\xfe\xff)/, "").replace(/\0/g, ""))) return "text";
  return "unknown";
}

const W = {
  SVG: ["SVG 图片可以带程序码，所以不显示预览。", "SVG images can carry code, so no preview is shown."]
};
const B = {
  PROGRAM_FILE: ["这个文件其实是程序或脚本（看内容，不是看名字），所以不存。", "This file is really a program or script (judged by its content, not its name), so it is not saved."],
  WEB_PAGE: ["这个文件其实是网页或带程序码（HTML / 脚本），打开时可以执行程序码或假装成登入页，所以不存。", "This file is really a web page or carries code (HTML / script). Opening it can run code or show a fake sign-in page, so it is not saved."],
  TYPE_NOT_ALLOWED: ["这类文件（%t）没办法完整检查，AI 不代为存。要的话请在 WhatsApp 里自己下载，先确认是认识的人传的。", "This kind of file (%t) cannot be fully checked, so the AI does not save it. If the user trusts the sender, they can download it in WhatsApp themselves."],
  DISGUISED: ["名字说是「%e」，内容其实是「%r」。这是伪装的文件，所以不存。", "The name says %e but the content is really %r. It is disguised, so it is not saved."],
  HIDDEN_ARCHIVE: ["这个文件后面藏了一个压缩档，所以不存。", "This file has an archive hidden inside it, so it is not saved."],
  MACRO_FILE: ["这个 Office 文件带巨集、内嵌程序物件或连到外面的范本，会自动执行程序，所以不存。", "This Office file contains macros, embedded objects or a link to an outside template that can run code, so it is not saved."],
  DANGEROUS_PDF: ["这个 PDF 带程序码（JavaScript）、会叫电脑执行程序，或夹带别的文件，所以不存。", "This PDF contains code (JavaScript), tries to start programs, or carries other files, so it is not saved."],
  SPREADSHEET_FORMULA: ["这个表格文件（CSV）里有公式或指令（= + - @ 开头的格子），用 Excel 打开可能执行程序，所以不存。", "This spreadsheet file (CSV) has cells that start with = + - or @ (formulas or commands). Opening it in Excel can run commands, so it is not saved."],
  NOT_CHECKABLE: ["这个文件加密了、太大或太复杂，没办法完整检查，所以不存。", "This file is encrypted, too large or too complex to check fully, so it is not saved."]
};
const say = (table, code, fill = {}) => {
  const f = (s) => s.replace(/%(\w)/g, (_, k) => fill[k] ?? "");
  return { code, zh: f(table[code][0]), en: f(table[code][1]) };
};
export const warning = (code) => say(W, code);
export const block = (code, fill) => say(B, code, fill);

// ZIP 的「中央目录结尾」：在文件最后 64 KB 里，而且注解长度刚好到文件结尾 → 真的有一个压缩档（可能藏在图片后面）
function hasEocd(tail) {
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06 && i + 22 + (tail[i + 20] | (tail[i + 21] << 8)) === tail.length) return true;
  }
  return false;
}

// 一边接收一边检查：push(每一段 Uint8Array)，最后 finish(档名, WhatsApp 写的类型)
// CSV / TSV：Excel 会把 = + - @ 开头的格子当公式（可以叫电脑执行指令）。普通数字（-5、+60.1）不算
const FORMULA_CELL = (cell) => {
  const c = cell.replace(/^[\s"']+/, "");
  if (!/^[=+\-@\uff1d\uff0b\uff0d\uff20]/.test(c)) return false;
  return !/^[+\-]?\d[\d.,\s]*%?["']?\s*$/.test(c);
};
const csvLineBad = (line) => line.split(/[,;\t]/).some(FORMULA_CELL) || /^\s*[\t\r]*[=+@]/.test(line);
export function scanner() {
  let head = null, real = null, total = 0, active = false, formula = false, csvCarry = "";
  const csvDec = new TextDecoder("utf-8"); // 全形的 ＝ ＋ 也要看得到
  let carry = new Uint8Array(0), tail = new Uint8Array(0);
  return {
    real: () => real,
    push(u8) {
      if (!head) { head = u8.subarray(0, 4096).slice(); real = sniff(head); }
      total += u8.length;
      // 文字 / XML：整个文件都找会执行的内容（跨两段的也看得到）
      if (real === "text" || real === "xml") {
        const buf = new Uint8Array(carry.length + u8.length); buf.set(carry); buf.set(u8, carry.length);
        if (!active && ACTIVE.test(latin1(buf).replace(/\0/g, ""))) active = true;
        carry = buf.subarray(Math.max(0, buf.length - 512)).slice();
        // 表格公式：一行一行看（最后半行留到下一段）
        if (!formula) {
          const lines = (csvCarry + csvDec.decode(u8, { stream: true }).replace(/\0/g, "")).split(/\r\n|\n|\r/);
          csvCarry = lines.pop().slice(-100000);
          if (lines.some(csvLineBad)) formula = true;
        }
      }
      // 留最后 64 KB：找藏在后面的压缩档
      const keep = Math.min(65557, tail.length + u8.length);
      const t = new Uint8Array(keep);
      const fromNew = Math.min(u8.length, keep), fromOld = keep - fromNew;
      t.set(tail.subarray(tail.length - fromOld), 0);
      t.set(u8.subarray(u8.length - fromNew), fromOld);
      tail = t;
    },
    // 程序：看到第一段就可以停，不用把整个文件接完
    early(name) {
      if (real === "exe" || real === "script") return block("PROGRAM_FILE");
      if (real === "html") return block("WEB_PAGE");
      return isProgramName(name) ? block("PROGRAM_FILE") : null;
    },
    // 结果：block（不存）或可以存（saveName = 存档用的名字，副档名跟真正类型一致）；deep = 还要做哪种深入检查
    finish(name, mime) {
      if (!head) real = "unknown";
      // 新版 Office 其实是 ZIP：名字或类型说是 Office 才当 Office（之后 deepCheck 逐个部分检查）
      if (real === "zip" && (EXT_OK.office.test(name || "") || /officedocument|opendocument/i.test(String(mime || "")))) real = "office";
      const warnings = [];
      let b = this.early(name);
      if (!b && active) b = block("WEB_PAGE");
      // 会用 Excel 打开的文字表格：有公式 / 指令就不存
      const sheet = /\.(csv|tsv|tab|prn|dif|sylk)$/i.test(name || "") || /^text\/(csv|tab-separated-values)/i.test(String(mime || ""));
      if (!b && (real === "text" || real === "xml") && sheet && (formula || csvLineBad(csvCarry))) b = block("SPREADSHEET_FORMULA");
      if (!b && !(real in ALLOWED)) b = block("TYPE_NOT_ALLOWED", { t: typeLabel(real) + " / " + typeLabel(real, true) });
      if (!b && real !== "office" && hasEocd(tail)) b = block("HIDDEN_ARCHIVE");
      const want = expectedFamily(name, mime), got = FAMILY[real];
      if (!b && want && want !== "other" && want !== got) {
        const ex = { image: ["图片", "a picture"], av: ["影片 / 声音", "video or audio"], pdf: ["PDF", "a PDF"], office: ["Office 文件", "an Office file"], ole: ["Office 文件", "an Office file"], archive: ["压缩档", "an archive"], text: ["文字文件", "a text file"], rtf: ["RTF", "an RTF document"], svg: ["SVG", "an SVG"], html: ["网页", "a web page"] }[want] || ["?", "?"];
        b = { code: "DISGUISED", zh: B.DISGUISED[0].replace("%e", ex[0]).replace("%r", typeLabel(real)), en: B.DISGUISED[1].replace("%e", ex[1]).replace("%r", typeLabel(real, true)) };
      }
      if (!b && real === "office" && !EXT_OK.office.test(name || "")) b = block("TYPE_NOT_ALLOWED", { t: "Office" });
      // 名字没有对的副档名：补上（例如「报价」→「报价.pdf」），打开时用的是对的程序
      let saveName = name;
      if (!b && real !== "office" && !EXT_OK[real]?.test(name || "")) saveName = (name || "file") + "." + ALLOWED[real];
      return { real, block: b, warnings, size: total, saveName, deep: !b && (real === "pdf" || real === "office") ? real : null };
    }
  };
}

// 预览：只有真的是普通图片才可以拿来画缩图（不用 SVG：SVG 可以带程序码）
export const PREVIEWABLE = new Set(["jpeg", "png", "gif", "webp", "bmp", "avif"]);
export const DEEP_MAX = 50 * 1024 * 1024; // PDF / Office 在这个大小内才检查得完；超过就不存

// ---------- 深入检查：PDF ----------
// 每一个 stream：找出它的字典（成对的 << >>，#xx 解码），依 /Filter 解开（Flate / ASCIIHex / ASCII85，串接也行，
// PNG predictor 还原），再找危险指令。任何解不开的（LZW、RunLength、加密…）→ partial（不存）。
const PDF_BAD = /\/(JavaScript|JS|Launch|EmbeddedFiles?|RichMedia|XFA|SubmitForm|ImportData|GoToE|GoToR)(?![A-Za-z0-9])/;
const pdfNames = (t) => t.replace(/#([0-9a-fA-F]{2})/g, (_, x) => String.fromCharCode(parseInt(x, 16)));
// lenient：资料坏在中间时，用已经解出来的部分（PDF 阅读器也是这样读，看到的就是这些），不当作看不了
async function inflateWith(u8, cap, format = "deflate", lenient = false) {
  const ds = new DecompressionStream(format);
  const w = ds.writable.getWriter(); w.write(u8).catch(() => {}); w.close().catch(() => {});
  const r = ds.readable.getReader(); const out = []; let n = 0;
  try {
    for (;;) {
      const { value, done } = await r.read();
      if (done) break;
      out.push(value); n += value.length;
      if (n > cap) { r.cancel().catch(() => {}); return { over: true }; }
    }
  } catch (_) { if (!lenient) return { bad: true }; }
  const all = new Uint8Array(n); let o = 0; for (const p of out) { all.set(p, o); o += p.length; }
  return { data: all };
}
function asciiHex(u8) {
  let s = latin1(u8).replace(/\s+/g, "");
  const end = s.indexOf(">"); if (end >= 0) s = s.slice(0, end);
  if (/[^0-9a-f]/i.test(s)) return null;
  const out = new Uint8Array(Math.ceil(s.length / 2));
  for (let i = 0; i < s.length; i += 2) out[i / 2] = parseInt((s.slice(i, i + 2) + "0").slice(0, 2), 16);
  return out;
}
function ascii85(u8) {
  let s = latin1(u8).replace(/\s+/g, "");
  if (s.startsWith("<~")) s = s.slice(2);
  const end = s.indexOf("~>"); if (end >= 0) s = s.slice(0, end);
  const out = []; let tuple = 0, n = 0;
  for (const ch of s) {
    if (ch === "z" && n === 0) { out.push(0, 0, 0, 0); continue; }
    const c = ch.charCodeAt(0) - 33;
    if (c < 0 || c > 84) return null;
    tuple = tuple * 85 + c; n++;
    if (n === 5) { out.push(Math.floor(tuple / 16777216) & 255, (tuple >>> 16) & 255, (tuple >>> 8) & 255, tuple & 255); tuple = 0; n = 0; }
  }
  if (n) { for (let i = n; i < 5; i++) tuple = tuple * 85 + 84; for (let i = 0; i < n - 1; i++) out.push(Math.floor(tuple / 2 ** (24 - 8 * i)) & 255); }
  return new Uint8Array(out);
}
function unPng(u8, columns, colors, bpc) {
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8)), row = Math.ceil((columns * colors * bpc) / 8);
  if (row <= 0 || row > 1e6) return null;
  const rows = Math.floor(u8.length / (row + 1)), out = new Uint8Array(rows * row);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let r = 0; r < rows; r++) {
    const t = u8[r * (row + 1)], src = r * (row + 1) + 1, o = r * row;
    for (let i = 0; i < row; i++) {
      const x = u8[src + i], a = i >= bpp ? out[o + i - bpp] : 0, up = r ? out[o - row + i] : 0, c = r && i >= bpp ? out[o - row + i - bpp] : 0;
      out[o + i] = t === 1 ? x + a : t === 2 ? x + up : t === 3 ? x + ((a + up) >> 1) : t === 4 ? x + paeth(a, up, c) : x;
    }
  }
  return out;
}
// 从 "stream" 往前找成对的 << ... >>（字典里可以再有字典）
function dictBefore(s, idx) {
  let j = idx - 1;
  while (j > 0 && /\s/.test(s[j])) j--;
  if (s[j] !== ">" || s[j - 1] !== ">") return null;
  let depth = 0;
  for (let k = j; k > Math.max(0, idx - 8192); k--) { // 字典最多看 8 KB
    if (s[k] === ">" && s[k - 1] === ">") { depth++; k--; continue; }
    if (s[k] === "<" && s[k - 1] === "<") { depth--; k--; if (!depth) return s.slice(k, j + 1); }
  }
  return null;
}
// 压缩过的二进位资料（字型、图片）偶然会出现「/JS」这种字：在资料里只认较长的名字，后面还要是 PDF 的分隔字元
const PDF_BAD_IN_DATA = /\/(JavaScript|Launch|EmbeddedFiles?|RichMedia|XFA|SubmitForm|ImportData|GoToE|GoToR)(?=[\s\0\f\v\/<>\[\]()%{}]|$)/;
export async function pdfDeepCheck(u8) {
  const s = latin1(u8);
  const found = { bad: false, partial: false, why: "" };
  const partial = (why) => { found.partial = true; found.why = why; };
  const spans = []; // stream 资料的位置；资料以外的部分（物件、字典）用完整的规则检查
  let budget = 64 * 1024 * 1024, count = 0;
  const re = /stream(\r\n|\n|\r)/g; let m;
  let tokens = 0;
  while ((m = re.exec(s)) && !found.bad) {
    // 每一个「stream」字都算，避免故意塞满几百万个假的让检查卡住
    if (++tokens > 20000) { partial("too many stream markers"); break; }
    const start = m.index + m[0].length;
    const rawDict = dictBefore(s, m.index);
    if (rawDict == null) continue; // 不是 stream 关键字（例如内容里的字）
    const dict = pdfNames(rawDict);
    const lenM = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
    let end = lenM ? start + Number(lenM[1]) : -1;
    if (!(end > start && end <= s.length && /^\s*endstream/.test(s.slice(end, end + 20)))) {
      end = s.indexOf("endstream", start);
      if (end < 0) { partial("stream without end"); break; }
      re.lastIndex = end + 9;
      if (s[end - 1] === "\n") end--; // 「endstream」前面的换行不是资料
      if (s[end - 1] === "\r") end--;
    } else re.lastIndex = end;
    spans.push([start, end]);
    const objStm = /\/Type\s*\/ObjStm/.test(dict); // 物件串流：里面是真的物件，用完整规则
    const fm = /\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9]+)/.exec(dict);
    const filters = fm ? (fm[1].match(/\/[A-Za-z0-9]+/g) || []).map((x) => x.slice(1)) : [];
    if (++count > 5000 || budget <= 0) { partial("too many streams"); break; }
    const IMAGE = /^(DCTDecode|DCT|JPXDecode|CCITTFaxDecode|CCF|JBIG2Decode)$/;
    if (filters.some((f) => IMAGE.test(f))) { if (objStm || /\/Type\s*\/XRef/.test(dict)) partial("image filter on objects"); continue; }
    let data = u8.subarray(start, end);
    for (const f of filters) {
      if (f === "FlateDecode" || f === "Fl") { const r = await inflateWith(data, Math.min(budget, 32 * 1024 * 1024), "deflate", true); if (r.over || r.bad) { partial("cannot unpack a stream"); data = null; break; } data = r.data; }
      else if (f === "ASCIIHexDecode" || f === "AHx") { data = asciiHex(data); if (!data) { partial("bad hex stream"); break; } }
      else if (f === "ASCII85Decode" || f === "A85") { data = ascii85(data); if (!data) { partial("bad ascii85 stream"); break; } }
      else { partial("unknown filter " + f.slice(0, 20)); data = null; break; } // LZW / RunLength / Crypt / 其他：看不了
    }
    if (!data) { if (found.partial) break; continue; }
    const pred = /\/Predictor\s+(\d+)/.exec(dict);
    if (pred && Number(pred[1]) >= 10) {
      const num = (k, d) => Number((new RegExp("/" + k + "\\s+(\\d+)").exec(dict) || [])[1] || d);
      data = unPng(data, num("Columns", 1), num("Colors", 1), num("BitsPerComponent", 8));
      if (!data) { partial("bad predictor"); break; }
    } else if (pred && Number(pred[1]) === 2) { partial("TIFF predictor"); break; }
    budget -= data.length;
    const t = pdfNames(latin1(data));
    if ((objStm ? PDF_BAD : PDF_BAD_IN_DATA).test(t)) { found.bad = true; found.why = "in stream"; }
    if (objStm && /\/Encrypt(?![A-Za-z0-9])/.test(t)) partial("encrypted");
  }
  // stream 以外：物件和字典
  let outside = "", o = 0;
  for (const [a, b] of spans) { outside += s.slice(o, a) + " "; o = Math.max(o, b); }
  outside = pdfNames(outside + s.slice(o));
  if (PDF_BAD.test(outside)) { found.bad = true; found.why = "in objects"; }
  // 没压缩的 stream 资料里如果出现「N N obj」，阅读器修复文件时可能当成物件来读：用完整规则检查
  for (const [a, b] of spans) {
    if (found.bad) break;
    const raw = pdfNames(s.slice(a, b));
    if ((/\d+\s+\d+\s+obj\b/.test(raw) ? PDF_BAD : PDF_BAD_IN_DATA).test(raw)) { found.bad = true; found.why = "in raw stream"; }
  }
  if (/\/Encrypt(?![A-Za-z0-9])/.test(outside)) partial("encrypted"); // 加密的 PDF：里面看不到
  return found;
}

// ---------- 深入检查：新版 Office（DOCX / XLSX / PPTX / ODF 都是 ZIP） ----------
// 照中央目录（解压程式真正用的那一份）读每个部分，解开检查：巨集、内嵌物件、ActiveX、连到外面的范本、程序文件。
// 任何读不懂的（ZIP64、加密、奇怪的压缩方式、太多部分）→ 不存。
const EXT_REL = /\/(oleObject|attachedTemplate|frame|subDocument|externalLinkPath|aFChunk|package)["']/i;
export async function officeDeepCheck(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const res = { bad: false, partial: false, why: "" };
  const fail = (why) => Object.assign(res, { partial: true, why });
  const bad = (why) => Object.assign(res, { bad: true, why });
  let e = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50 && i + 22 + dv.getUint16(i + 20, true) === u8.length) { e = i; break; }
  if (e < 0) return fail("no central directory");
  const count = dv.getUint16(e + 10, true), cdSize = dv.getUint32(e + 12, true), cdOff = dv.getUint32(e + 16, true);
  if (count === 0xffff || cdOff === 0xffffffff || count > 5000 || cdOff + cdSize > e) return fail("zip64 or too many parts");
  const dec = new TextDecoder("utf-8", { fatal: false });
  let p = cdOff, budget = 128 * 1024 * 1024, ctypes = false;
  for (let k = 0; k < count; k++) {
    if (p + 46 > e || dv.getUint32(p, true) !== 0x02014b50) return fail("broken directory");
    const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    const names = [dec.decode(u8.subarray(p + 46, p + 46 + nlen))];
    // 额外栏位里的 Unicode 名字（0x7075），解压程式会用它
    for (let x = p + 46 + nlen; x + 4 <= p + 46 + nlen + xlen;) {
      const id = dv.getUint16(x, true), sz = dv.getUint16(x + 2, true);
      if (id === 0x7075 && sz > 5) names.push(dec.decode(u8.subarray(x + 9, x + 4 + sz)));
      x += 4 + sz;
    }
    p += 46 + nlen + xlen + clen;
    if (flags & 1) return fail("encrypted part");
    if (csize === 0xffffffff || lho === 0xffffffff) return fail("zip64");
    for (const n of names) {
      const low = n.toLowerCase().replace(/\\/g, "/");
      if (isProgramName(low)) return bad("program inside: " + n.slice(-60));
      if ((/(^|\/)(vbaproject|vbadata)[^/]*$|(^|\/)activex\/|(^|\/)embeddings\/|(^|\/)macrosheets\/|(^|\/)(basic|scripts)\/|\.(bin|ole)$/.test(low)) && !/(^|\/)printersettings\d*\.bin$/.test(low)) return bad("macro / embedded object: " + n.slice(-60));
      if (low === "[content_types].xml" || low === "meta-inf/manifest.xml" || low === "mimetype") ctypes = true;
    }
    if (lho + 30 > u8.length || dv.getUint32(lho, true) !== 0x04034b50) return fail("broken part");
    const ds = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    if (ds + csize > u8.length) return fail("broken part");
    let data;
    if (method === 0) data = u8.subarray(ds, ds + csize);
    else if (method === 8) { const r = await inflateWith(u8.subarray(ds, ds + csize), Math.min(budget, 64 * 1024 * 1024), "deflate-raw"); if (r.over || r.bad) return fail("cannot unpack part"); data = r.data; }
    else return fail("unknown packing");
    budget -= data.length;
    if (budget < 0) return fail("too big");
    if (at(data, [0xd0, 0xcf, 0x11, 0xe0])) return bad("embedded OLE object");
    if (sniff(data.subarray(0, 4096)) === "exe") return bad("program inside");
    const n0 = names[0].toLowerCase();
    if (/\.(xml|rels)$/.test(n0)) {
      const t = dec.decode(data);
      if (n0 === "[content_types].xml" && /macroenabled|vbaproject|ms-office\.vbaproject|activex|macrosheet/i.test(t)) return bad("macro content type");
      for (const rel of t.match(/<Relationship\b[^>]*>/gi) || []) if (/TargetMode\s*=\s*["']External["']/i.test(rel) && EXT_REL.test(rel)) return bad("link to an outside template or object");
      if (/<script\b|xlink:href\s*=\s*["']\s*(javascript|vbscript|ms-|file):/i.test(t)) return bad("script");
      // DDE：Word 栏位 / Excel 外部连结可以叫电脑执行指令
      // Word 会把一个栏位拆成好几段：全部接起来再看
      const instr = [...t.matchAll(/<w:instrText\b[^>]*>([^<]*)</gi)].map((x) => x[1]).join("") + " " + [...t.matchAll(/\binstr\s*=\s*"([^"]*)"/gi)].map((x) => x[1]).join(" ");
      if (/<ddeLink\b|<oleLink\b/i.test(t) || /\b(DDE|DDEAUTO|INCLUDETEXT|INCLUDEPICTURE|IMPORT|LINK)\b/i.test(instr)) return bad("DDE or outside link field");
      if (/<(\w+:)?f\b[^>]*>[^<]*\|/i.test(t)) return bad("DDE formula"); // Excel 公式里的「程式|指令」
    }
  }
  if (!ctypes) return fail("not an Office file");
  return res;
}

// media.js 用：依 finish() 的 deep 做深入检查。回传 block 或 null
export async function deepCheck(kind, u8) {
  if (!u8 || u8.length > DEEP_MAX) return block("NOT_CHECKABLE");
  if (kind === "pdf") {
    const r = await pdfDeepCheck(u8);
    if (r.bad) return block("DANGEROUS_PDF");
    if (r.partial) return block("NOT_CHECKABLE");
  } else if (kind === "office") {
    const r = await officeDeepCheck(u8);
    if (r.bad) return block("MACRO_FILE");
    if (r.partial) return block("NOT_CHECKABLE");
  }
  return null;
}

// ---------- 图片尺寸：解码前先看标头，太大的不解（防止一张小图要求几 GB 记忆体） ----------
export const MAX_PIXELS = 40e6;
export function imageDims(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const t = sniff(u8.subarray(0, 64));
  try {
    if (t === "png" && u8.length >= 24) return { w: dv.getUint32(16), h: dv.getUint32(20) };
    if (t === "gif" && u8.length >= 13) {
      // 逻辑画面 + 每一格画面的大小都算（解码器会照最大的那格配记忆体）
      let w = dv.getUint16(6, true), h = dv.getUint16(8, true);
      let i = 13 + (u8[10] & 0x80 ? 3 * (2 << (u8[10] & 7)) : 0);
      for (let n = 0; i < u8.length && n < 4096; n++) {
        const b = u8[i];
        if (b === 0x2c) {
          if (i + 10 > u8.length) break;
          w = Math.max(w, dv.getUint16(i + 1, true) + dv.getUint16(i + 5, true)); h = Math.max(h, dv.getUint16(i + 3, true) + dv.getUint16(i + 7, true));
          const flags = u8[i + 9]; i += 10 + (flags & 0x80 ? 3 * (2 << (flags & 7)) : 0) + 1;
          while (i < u8.length && u8[i]) i += u8[i] + 1;
          i++;
        } else if (b === 0x21) { i += 2; while (i < u8.length && u8[i]) i += u8[i] + 1; i++; }
        else break;
      }
      return { w, h };
    }
    if (t === "bmp" && u8.length >= 26) return { w: Math.abs(dv.getInt32(18, true)), h: Math.abs(dv.getInt32(22, true)) };
    if (t === "webp" && u8.length >= 30) {
      const kind = latin1(u8.subarray(12, 16));
      if (kind === "VP8 ") return { w: dv.getUint16(26, true) & 0x3fff, h: dv.getUint16(28, true) & 0x3fff };
      if (kind === "VP8L") { const b = dv.getUint32(21, true); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
      if (kind === "VP8X") return { w: (u8[24] | (u8[25] << 8) | (u8[26] << 16)) + 1, h: (u8[27] | (u8[28] << 8) | (u8[29] << 16)) + 1 };
    }
    if (t === "jpeg") {
      for (let i = 2; i + 9 < u8.length;) {
        if (u8[i] !== 0xff) { i++; continue; }
        const mk = u8[i + 1];
        if (mk === 0xd8 || mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7) || mk === 0xff) { i++; continue; }
        const len = dv.getUint16(i + 2);
        if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return { w: dv.getUint16(i + 7), h: dv.getUint16(i + 5) };
        i += 2 + len;
      }
    }
  } catch (_) {}
  return null; // 认不出尺寸：不解码
}
export const safeToDecode = (u8) => { const d = imageDims(u8); return !!d && d.w > 0 && d.h > 0 && d.w * d.h <= MAX_PIXELS; };
