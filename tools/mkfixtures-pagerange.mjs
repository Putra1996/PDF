/**
 * Generator fixture untuk audit slider rentang halaman.
 *
 *  - empat-halaman.pdf : 4 halaman, tiap halaman teks berbeda
 *  - tujuh-halaman.pdf : 7 halaman, teks berbeda
 *  - rusak.pdf          : bukan PDF (untuk uji pesan galat)
 *
 * Jalankan: node tools/mkfixtures-pagerange.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(process.env.FIXTURES_DIR || path.join(HERE, "..", "fixtures", "pagerange"));

fs.mkdirSync(OUT, { recursive: true });

/* pdf-lib dimuat dari vendor repo (bukan npm) supaya fixture bisa
   dibuat tanpa memasang dependensi. */
const vendorPdfLib = path.join(HERE, "..", "vendor", "pdf-lib.min.js");
const src = fs.readFileSync(vendorPdfLib, "utf8");
const mod = { exports: {} };
new Function("module", "exports", src)(mod, mod.exports);
const { PDFDocument, StandardFonts, rgb, degrees } = mod.exports;

async function buat(nama, jumlah) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 1; i <= jumlah; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`HALAMAN ${i}`, { x: 60, y: 760, size: 28, font: fontBold, color: rgb(0.1, 0.2, 0.55) });
    p.drawText(`Isi unik halaman ${i} untuk uji rentang.`, { x: 60, y: 720, size: 14, font, color: rgb(0.2, 0.2, 0.2) });
    /* tanda posisi supaya perbedaannya jelas secara visual */
    p.drawRectangle({ x: 60, y: 200, width: 120, height: 60, color: rgb(0.85, 0.25, 0.2) });
    p.drawText(String(i), { x: 105, y: 218, size: 26, font: fontBold, color: rgb(1, 1, 1) });
  }
  fs.writeFileSync(path.join(OUT, nama), await doc.save());
  console.log("dibuat:", nama, jumlah, "halaman");
}

await buat("empat-halaman.pdf", 4);
await buat("tujuh-halaman.pdf", 7);

/* berkas rusak: teks acak yang bukan PDF */
fs.writeFileSync(path.join(OUT, "rusak.pdf"), "Ini bukan PDF sama sekali.\n");
console.log("dibuat: rusak.pdf");
