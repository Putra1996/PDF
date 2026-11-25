/**
 * Generator fixture untuk audit SEMUA fitur.
 *
 *   sample.pdf    - 3 halaman A4 berteks (untuk alat-alat PDF)
 *   satu.pdf      - 1 halaman A4 berteks
 *   formulir.pdf  - PDF berisi field formulir AcroForm
 *   rusak.pdf     - PDF tidak valid (untuk uji penanganan error)
 *   nolbyte.pdf   - berkas 0 byte
 *   terkunci.pdf  - PDF terenkripsi (dibuat lewat tool "Lindungi PDF")
 *   gambar.png    - PNG kecil untuk jpg2pdf / scan / watermark gambar
 *   halaman.html  - HTML sederhana untuk html2pdf
 *   docu.docx / presentasi.pptx / tabel.xlsx - berkas Office minimal
 *
 * Jalankan:
 *   node tools/mkfixtures-semua.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import http from "node:http";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(path.join(HERE, ".."));
const OUT = path.resolve(process.argv[2] || process.env.FIXTURES_DIR || path.join(ROOT, "fixtures", "semua"));

const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".png": "image/png", ".pdf": "application/pdf",
  ".wasm": "application/wasm", ".mjs": "text/javascript; charset=utf-8",
};

fs.mkdirSync(OUT, { recursive: true });

/* ---------- PDF teks ---------- */
async function pdfTeks(nama, halaman, label = "Uji") {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < halaman; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`${label} halaman ${i + 1}`, { x: 60, y: 760, size: 20, font, color: rgb(0.05, 0.05, 0.1) });
    p.drawText("Kata kunci rahasia untuk uji penyensoran.", { x: 60, y: 720, size: 12, font });
    p.drawText("Baris isi dokumen kedua.", { x: 60, y: 700, size: 12, font });
    p.drawRectangle({ x: 60, y: 300, width: 200, height: 90, borderColor: rgb(0.1, 0.3, 0.8), borderWidth: 2 });
  }
  fs.writeFileSync(path.join(OUT, nama), await doc.save());
}

/* ---------- PDF dengan kata kunci di halaman tertentu ---------- */
async function pdfSpesial(nama, halaman) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < halaman; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`Halaman uji ${i + 1}`, { x: 60, y: 760, size: 18, font });
    p.drawText("Teks biasa yang harus tetap utuh.", { x: 60, y: 720, size: 12, font });
    if (i === 1) p.drawText("KATA RAHASIA untuk dihapus.", { x: 60, y: 690, size: 12, font });
  }
  fs.writeFileSync(path.join(OUT, nama), await doc.save());
}

/* ---------- PDF formulir ---------- */
async function pdfFormulir() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([595, 842]);
  p.drawText("Formulir uji", { x: 60, y: 760, size: 20, font });
  p.drawText("Nama:", { x: 60, y: 700, size: 12, font });
  p.drawText("Kota:", { x: 60, y: 660, size: 12, font });
  const form = doc.getForm();
  const nama = form.createTextField("nama");
  nama.setText("");
  nama.addToPage(p, { x: 110, y: 692, width: 300, height: 22, borderWidth: 1 });
  const kota = form.createTextField("kota");
  kota.setText("");
  kota.addToPage(p, { x: 110, y: 652, width: 300, height: 22, borderWidth: 1 });
  fs.writeFileSync(path.join(OUT, "formulir.pdf"), await doc.save());
}

/* ---------- PNG kecil ---------- */
function pngSedikit() {
  /* PNG 64x64 dengan pola, ditulis manual (tanpa pustaka gambar) */
  const W = 64, H = 64;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  let o = 0;
  for (let y = 0; y < H; y++) {
    raw[o++] = 0;
    for (let x = 0; x < W; x++) {
      raw[o++] = 40 + ((x * 4) % 200);
      raw[o++] = 90 + ((y * 3) % 150);
      raw[o++] = 160 - ((x + y) % 120);
    }
  }
  const zlib = require("node:zlib");
  const idat = zlib.deflateSync(raw);
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0)),
  ]);
  fs.writeFileSync(path.join(OUT, "gambar.png"), png);
}

/* ---------- HTML ---------- */
function htmlSederhana() {
  fs.writeFileSync(path.join(OUT, "halaman.html"),
    `<!doctype html><html lang="id"><head><meta charset="utf-8">
<title>Uji HTML</title></head><body>
<h1>Judul Uji HTML</h1><p>Paragraf isi dokumen untuk uji konversi ke PDF.</p>
<table border="1"><tr><th>Kolom A</th><th>Kolom B</th></tr>
<tr><td>1</td><td>2</td></tr></table></body></html>`, "utf8");
}

/* ---------- berkas Office (dibuat lewat JSZip di peramban) ---------- */
async function buatOffice() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || "/").split("?")[0]);
    const f = path.join(ROOT, url === "/" ? "index.html" : url);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end("404"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(8155, "127.0.0.1", r));
  const { chromium } = await import("./browser.mjs");
  const browser = await chromium();
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:8155/index.html", { waitUntil: "load" });
  await page.waitForTimeout(700);
  const out = await page.evaluate(async () => {
    const b64 = (u8) => { let s = ""; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
    const zipBytes = async (files) => {
      const z = new JSZip();
      for (const [name, content] of Object.entries(files)) z.file(name, content);
      return b64(await z.generateAsync({ type: "uint8array" }));
    };
    const docx = await zipBytes({
      "[Content_Types].xml": '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      "_rels/.rels": '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      "word/document.xml": '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Judul Dokumen Uji</w:t></w:r></w:p><w:p><w:r><w:t>Paragraf isi dokumen word untuk uji konversi.</w:t></w:r></w:p></w:body></w:document>',
    });
    const pptx = await zipBytes({
      "[Content_Types].xml": '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>',
      "_rels/.rels": '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
      "ppt/presentation.xml": '<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>',
      "ppt/_rels/presentation.xml.rels": '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>',
      "ppt/slides/slide1.xml": '<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide uji presentasi</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
    });
    const xlsx = await zipBytes({
      "[Content_Types].xml": '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
      "_rels/.rels": '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      "xl/workbook.xml": '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Lembar1" sheetId="1" r:id="rId1"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels": '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      "xl/worksheets/sheet1.xml": '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Judul</t></is></c><c r="B1" t="inlineStr"><is><t>Nilai</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Baris</t></is></c><c r="B2"><v>42</v></c></row></sheetData></worksheet>',
    });
    return { docx, pptx, xlsx };
  });
  await browser.close();
  server.close();
  for (const [k, v] of Object.entries(out)) {
    fs.writeFileSync(path.join(OUT, { docx: "docu.docx", pptx: "presentasi.pptx", xlsx: "tabel.xlsx" }[k]),
      Buffer.from(v, "base64"));
  }
}

/* ---------- berkas rusak ---------- */
function rusakDanNol() {
  fs.writeFileSync(path.join(OUT, "rusak.pdf"),
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");
  fs.writeFileSync(path.join(OUT, "nolbyte.pdf"), Buffer.alloc(0));
}

await pdfTeks("sample.pdf", 3);
await pdfTeks("satu.pdf", 1);
/* PDF untuk uji redaksi: kata target hanya ada di halaman 2,
   supaya halaman lain bisa dipakai memastikan isinya utuh. */
await pdfSpesial("redact.pdf", 3);
await pdfFormulir();
pngSedikit();
htmlSederhana();
await buatOffice();
rusakDanNol();

console.log("Fixture dibuat di " + OUT);
console.log(fs.readdirSync(OUT).map((f) => " - " + f + " (" + fs.statSync(path.join(OUT, f)).size + " B)").join("\n"));
