/**
 * Fixture untuk audit alat "Tanda tangani PDF".
 *
 *   kosong.pdf   - satu halaman A4 kosong (tanpa teks) supaya kotak tinta
 *                  tanda tangan di PDF hasil bisa diukur akurat
 *   putar90.pdf  - satu halaman A4 dengan /Rotate 90
 *   putar180.pdf - satu halaman A4 dengan /Rotate 180
 *   putar270.pdf - satu halaman A4 dengan /Rotate 270
 *   multi.pdf    - tiga halaman berbeda ukuran (A4, A5, A4 landscape)
 *   teks.pdf     - dua halaman A4 BERTEKS (untuk memastikan pratinjau
 *                  benar-benar menampilkan isi halaman, bukan kanvas kosong)
 *
 * Jalankan: node tools/mkfixtures-sign.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(path.join(HERE, ".."));

const { PDFDocument, degrees, rgb } = require("pdf-lib");

const A4 = [595.28, 841.89];
const A5 = [419.53, 595.28];

/**
 * Buat fixture tanda tangan.
 * @param {string} dir - folder tujuan
 * @returns {Promise<{kosong:string, putar90:string, putar180:string, putar270:string, multi:string}>}
 */
export async function buatFixture(dir) {
  fs.mkdirSync(dir, { recursive: true });

  /* Halaman A4 kosong */
  const d1 = await PDFDocument.create();
  d1.addPage([A4[0], A4[1]]);
  const kosong = path.join(dir, "kosong.pdf");
  fs.writeFileSync(kosong, await d1.save());

  /* Halaman A4 dengan rotasi 90 / 180 / 270 derajat */
  const putar = {};
  for (const sudut of [90, 180, 270]) {
    const d = await PDFDocument.create();
    const p = d.addPage([A4[0], A4[1]]);
    p.setRotation(degrees(sudut));
    const f = path.join(dir, "putar" + sudut + ".pdf");
    fs.writeFileSync(f, await d.save());
    putar["putar" + sudut] = f;
  }

  /* Dua halaman A4 berisi teks — dipakai untuk memastikan pratinjau
     benar-benar menampilkan isi halaman (bukan kanvas kosong). */
  const d4 = await PDFDocument.create();
  for (let i = 0; i < 2; i++) {
    const p = d4.addPage([A4[0], A4[1]]);
    p.drawText("Halaman uji render " + (i + 1), {
      x: 60, y: A4[1] - 120, size: 28, color: rgb(0.05, 0.05, 0.05),
    });
    p.drawText("Baris isi dokumen untuk memastikan pratinjau bukan kanvas kosong.",
      { x: 60, y: A4[1] - 170, size: 12, color: rgb(0.2, 0.2, 0.2) });
    p.drawRectangle({
      x: 60, y: 200, width: 260, height: 90,
      borderColor: rgb(0.1, 0.3, 0.8), borderWidth: 2,
    });
  }
  const teks = path.join(dir, "teks.pdf");
  fs.writeFileSync(teks, await d4.save());

  /* Tiga halaman dengan ukuran berbeda */
  const d3 = await PDFDocument.create();
  d3.addPage([A4[0], A4[1]]);
  d3.addPage([A5[0], A5[1]]);
  d3.addPage([A4[1], A4[0]]);
  const multi = path.join(dir, "multi.pdf");
  fs.writeFileSync(multi, await d3.save());

  return Object.assign({ kosong: kosong, multi: multi, teks: teks }, putar);
}

if (import.meta.url === "file://" + process.argv[1]) {
  const dir = path.resolve(process.argv[2] || path.join(ROOT, "fixtures", "ttd"));
  const f = await buatFixture(dir);
  console.log("Fixture dibuat: " + Object.values(f).join(", "));
}
