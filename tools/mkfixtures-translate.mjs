/**
 * Generator fixture untuk audit terjemahan (tools/audit-translate.mjs).
 *
 * Fixture audit terjemahan:
 *  - indonesia.pdf   : 3 halaman teks Indonesia (bisa diuji id->en)
 *  - inggris.pdf     : teks Inggris (bisa diuji en->id)
 *  - satu-kalimat.pdf: satu halaman, satu baris
 *  - tanpa-teks.pdf  : PDF tanpa teks sama sekali
 *
 * Setiap halaman sengaja memakai header & footer yang sama supaya
 * cache kalimat (LRU) bisa diuji: baris yang sama tidak boleh
 * diterjemahkan dua kali.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || path.join(path.resolve(HERE, ".."), "fixtures", "terjemah");
fs.mkdirSync(OUT, { recursive: true });

const HEADER = "Laporan Tahunan_bbox_validator_5483";
const FOOTER = "Halaman ini bagian dari dokumen pengujian terjemahan.";

function halaman(doc, font, bold, judul, baris) {
  const p = doc.addPage([595, 842]);
  p.drawText(HEADER, { x: 60, y: 790, size: 9, font: bold, color: rgb(0.35, 0.35, 0.45) });
  p.drawText(judul, { x: 60, y: 740, size: 16, font: bold, color: rgb(0.08, 0.1, 0.2) });
  let y = 700;
  for (const b of baris) {
    p.drawText(b, { x: 60, y, size: 11, font, color: rgb(0.1, 0.1, 0.15) });
    y -= 18;
  }
  p.drawText(FOOTER, { x: 60, y: 60, size: 9, font, color: rgb(0.4, 0.4, 0.5) });
  return p;
}

/* 1. Tiga halaman bahasa Indonesia */
{
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const b = await doc.embedFont(StandardFonts.HelveticaBold);
  halaman(doc, f, b, "Ringkasan Eksekutif", [
    "Dokumen ini menjelaskan rencana kerja untuk tahun anggaran berikutnya.",
    "Tim kami akan meninjau biaya operasional pada setiap kuartal.",
    "Seluruh proses berjalan di dalam peramban tanpa mengirim data ke internet.",
    "Pengguna dapat memilih bahasa tujuan sebelum memulai pekerjaan.",
    "Hasil akhir disimpan sebagai berkas Markdown yang mudah dibaca.",
  ]);
  halaman(doc, f, b, "Metode Penelitian", [
    "Data dikumpulkan dari tiga belas wilayah selama enam bulan.",
    "Setiap responden memberi jawaban anonim tanpa data pribadi.",
    "Analisis dilakukan dengan metode perbandingan antarwilayah.",
    "Hasilnya menunjukkan peningkatan yang konsisten pada semua variabel.",
    "Kesimpulan dibahas bersama seluruh anggota tim penelitian.",
  ]);
  halaman(doc, f, b, "Kesimpulan dan Saran", [
    "Pekerjaan yang tersisa harus diselesaikan sebelum akhir tahun.",
    "Kami menyarankan menambah sumber daya manusia pada tim teknis.",
    "Pengujian otomatis perlu dijalankan setiap kali ada perubahan kode.",
    "Dokumen ini dapat diterjemahkan ke berbagai bahasa target.",
    "Semua perhitungan dilakukan secara lokal di perangkat pengguna.",
  ]);
  fs.writeFileSync(path.join(OUT, "indonesia.pdf"), await doc.save());
}

/* 2. Dua halaman bahasa Inggris */
{
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const b = await doc.embedFont(StandardFonts.HelveticaBold);
  halaman(doc, f, b, "Executive Summary", [
    "This document explains the work plan for the next fiscal year.",
    "Our team will review operational costs during every quarter.",
    "The whole process runs inside the browser without sending data anywhere.",
    "Users can choose the target language before starting the work.",
    "The final result is saved as a Markdown file that is easy to read.",
  ]);
  halaman(doc, f, b, "Conclusions", [
    "Remaining work must be finished before the end of the year.",
    "We suggest adding more people to the technical team.",
    "Automated tests should run whenever the code changes.",
    "This document can be translated into many target languages.",
    "All calculations are performed locally on the user's device.",
  ]);
  fs.writeFileSync(path.join(OUT, "inggris.pdf"), await doc.save());
}

/* 3. Satu halaman, satu baris */
{
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([300, 120]);
  p.drawText("Selamat pagi, apa kabar?", { x: 20, y: 60, size: 12, font: f });
  fs.writeFileSync(path.join(OUT, "satu-kalimat.pdf"), await doc.save());
}

/* 4. Dokumen besar (20 halaman) untuk mengukur-throughput */
{
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const b = await doc.embedFont(StandardFonts.HelveticaBold);
  const kalimat = [
    "Dokumen ini menjelaskan rencana kerja untuk tahun anggaran berikutnya.",
    "Tim kami akan meninjau biaya operasional pada setiap kuartal.",
    "Seluruh proses berjalan di dalam peramban tanpa mengirim data ke internet.",
    "Pengguna dapat memilih bahasa tujuan sebelum memulai pekerjaan.",
    "Hasil akhir disimpan sebagai berkas Markdown yang mudah dibaca.",
    "Setiap laporan memuat ringkasan singkat dan bagian discussion.",
    "Anggaran disusun berdasarkan data tahun sebelumnya dan asumsi terbaru.",
    "Pelaporan dilakukan secara rutin setiap akhir bulan kerja.",
  ];
  for (let i = 1; i <= 20; i++) {
    halaman(doc, f, b, "Bagian " + i, kalimat);
  }
  fs.writeFileSync(path.join(OUT, "besar.pdf"), await doc.save());
}

/* 5. Tanpa teks (hanya gambar kecil) */
{
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  fs.writeFileSync(path.join(OUT, "tanpa-teks.pdf"), await doc.save());
}

console.log("Fixture terjemahan dibuat di", OUT);
for (const f of fs.readdirSync(OUT)) {
  console.log(" -", f, fs.statSync(path.join(OUT, f)).size, "B");
}
