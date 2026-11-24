/**
 * Generator fixture untuk audit pratinjau urutan halaman (Gabung PDF).
 *
 *  - alpha.pdf : 3 halaman, tiap halaman teks "ALFA n"
 *  - beta.pdf  : 4 halaman, tiap halaman teks "BETA n"
 *  - gamma.pdf : 1 halaman, teks "GAMMA 1"
 *
 * Teks tiap halaman berbeda dan menyebut asal berkasnya, jadi urutan
 * halaman pada hasil gabung bisa dibaca langsung dari teksnya.
 *
 * Jalankan: node tools/mkfixtures-merge.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(process.env.FIXTURES_DIR || path.join(HERE, "..", "fixtures", "merge"));

fs.mkdirSync(OUT, { recursive: true });

/* pdf-lib dimuat dari vendor repo (bukan npm) supaya fixture bisa
   dibuat tanpa memasang dependensi. */
const vendorPdfLib = path.join(HERE, "..", "vendor", "pdf-lib.min.js");
const src = fs.readFileSync(vendorPdfLib, "utf8");
const mod = { exports: {} };
new Function("module", "exports", src)(mod, mod.exports);
const { PDFDocument, StandardFonts, rgb } = mod.exports;

async function buat(nama, label, jumlah) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 1; i <= jumlah; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`${label} ${i}`, {
      x: 60, y: 760, size: 34, font: fontBold, color: rgb(0.1, 0.2, 0.55),
    });
    p.drawText(`Halaman ${i} dari ${label.toLowerCase()}`, {
      x: 60, y: 710, size: 15, font, color: rgb(0.25, 0.25, 0.25),
    });
    /* kotak & angka besar supaya thumbnail tiap halaman jelas berbeda */
    p.drawRectangle({ x: 60, y: 300, width: 160, height: 200, color: rgb(0.15, 0.35, 0.75) });
    p.drawText(String(i), { x: 125, y: 375, size: 64, font: fontBold, color: rgb(1, 1, 1) });
    /* pita penanda file, supaya asal berkas terbaca di thumbnail */
    p.drawRectangle({ x: 0, y: 812, width: 595, height: 30, color: rgb(0.85, 0.3, 0.2) });
    p.drawText(label, { x: 20, y: 819, size: 13, font: fontBold, color: rgb(1, 1, 1) });
  }
  fs.writeFileSync(path.join(OUT, nama), await doc.save());
  console.log("dibuat:", nama, jumlah, "halaman");
}

await buat("alpha.pdf", "ALFA", 3);
await buat("beta.pdf", "BETA", 4);
await buat("gamma.pdf", "GAMMA", 1);
console.log("-> " + OUT);
