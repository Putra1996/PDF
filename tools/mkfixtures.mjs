// Generator fixture PDF memakai pdf-lib (struktur xref dijamin valid).
import fs from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const dir = process.env.FIXTURES_DIR || (new URL("./fixtures/", import.meta.url).pathname);
fs.mkdirSync(dir, { recursive: true });

async function build(pages, out) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const p of pages) {
    const page = doc.addPage([595, 842]);
    if (p.band) {
      page.drawRectangle({
        x: 56, y: 842 - p.band.top, width: 483, height: p.band.height,
        color: rgb(0.85, 0.88, 0.98),
      });
    }
    for (const line of p.lines) {
      page.drawText(line.t, {
        x: 56, y: 842 - line.y, size: line.size || 11,
        font: line.bold ? bold : font, color: rgb(0.12, 0.14, 0.2),
      });
    }
  }
  const bytes = await doc.save();
  fs.writeFileSync(dir + out, bytes);
  console.log("  " + out, bytes.length, "bytes");
}

await build(
  [
    {
      band: { top: 82, height: 96 },
      lines: [
        { t: "Laporan Tahunan 2024", size: 22, bold: true, y: 105 },
        { t: "Bagian 1 - Pendahuluan", size: 14, bold: true, y: 150 },
        { t: "Dokumen contoh untuk pengujian tampilan antarmuka.", y: 185 },
        { t: "Halaman pertama dari tiga halaman.", y: 205 },
      ],
    },
    {
      lines: [
        { t: "Bagian 2 - Data", size: 14, bold: true, y: 100 },
        { t: "Tabel data dan ringkasan keuangan.", y: 130 },
      ],
    },
    {
      lines: [
        { t: "Bagian 3 - Lampiran", size: 14, bold: true, y: 100 },
        { t: "Penutup dokumen contoh.", y: 130 },
      ],
    },
  ],
  "sample.pdf"
);

const dense = [];
for (let pg = 0; pg < 3; pg++) {
  const lines = [{ t: `Halaman ${pg + 1} - Dokumen Padat`, size: 14, bold: true, y: 70 }];
  let y = 105;
  for (let i = 0; i < 29; i++) {
    lines.push({
      t: `Baris ${pg * 29 + i + 1} - Teks contoh untuk menguji kepadatan tata letak dokumen.`,
      size: 10, y,
    });
    y += 24;
  }
  dense.push({ lines });
}
await build(dense, "dense90.pdf");

console.log("fixtures:", fs.readdirSync(dir).join(", "));
