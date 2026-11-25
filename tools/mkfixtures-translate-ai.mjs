/**
 * Generator fixture untuk audit terjemahan AI daring
 * (tools/audit-translate-ai.mjs).
 *
 * Fixture:
 *  - gabungan.pdf  : satu kalimat sengaja DIPATAH dua baris
 *                    ("...untuk tahun" / "anggaran berikutnya ...")
 *                    -> alat harus menerjemahkan sebagai SATU
 *                    satuan kalimat, bukan dua baris terpisah.
 *  - angka-url.pdf : baris berisi angka ("1.500.000"), kode, dan URL
 *                    -> baris seperti ini tidak boleh dikirim ke
 *                    server AI sama sekali.
 *  - en.pdf       : teks bahasa Inggris (untuk uji en->id).
 *
 * Baris dibuat dengan posisi yang pasti supaya pengelompokan
 * baris di alat bisa diuji dengan teliti.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || path.join(path.resolve(HERE, ".."), "fixtures", "terjemah-ai");
fs.mkdirSync(OUT, { recursive: true });

function halaman(doc, font, bold, judul, baris, ukuran = 11) {
  const p = doc.addPage([595, 842]);
  p.drawText(judul, { x: 60, y: 780, size: 16, font: bold, color: rgb(0.08, 0.1, 0.2) });
  let y = 740;
  for (const b of baris) {
    p.drawText(b, { x: 60, y, size: ukuran, font, color: rgb(0.1, 0.1, 0.15) });
    y -= 18;
  }
  return p;
}

/* 1. Kalimat yang patah dua baris + isi normal */
{
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const b = await doc.embedFont(StandardFonts.HelveticaBold);
  halaman(doc, f, b, "Rencana Kerja 2026", [
    "Dokumen ini menjelaskan rencana kerja untuk tahun",
    "anggaran berikutnya beserta rincian biayanya.",
    "Seluruh kegiatan dijalankan langsung di dalam peramban.",
    "Tim kami akan meninjau biaya operasional setiap kuartal.",
  ]);
  fs.writeFileSync(path.join(OUT, "gabungan.pdf"), await doc.save());
}

/* 2. Baris angka / kode / URL (tidak boleh dikirim ke server) */
{
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const b = await doc.embedFont(StandardFonts.HelveticaBold);
  halaman(doc, f, b, "Rekapitulasi Anggaran", [
    "1.500.000",
    "2026",
    "https://contoh.id/dokumen/2026/laporan",
    "Jumlah dana tersedia tercantum pada tabel berikut.",
  ]);
  fs.writeFileSync(path.join(OUT, "angka-url.pdf"), await doc.save());
}

/* 3. Teks bahasa Inggris */
{
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const b = await doc.embedFont(StandardFonts.HelveticaBold);
  halaman(doc, f, b, "Annual Report", [
    "This document explains the work plan for the next",
    "budget year together with a detailed breakdown.",
    "Every activity runs directly inside the browser.",
  ]);
  fs.writeFileSync(path.join(OUT, "en.pdf"), await doc.save());
}

console.log("Fixture terjemahan AI dibuat di: " + OUT);
