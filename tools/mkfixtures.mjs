/**
 * Generator fixture PDF untuk harness verifikasi produksi.
 * Menghasilkan sample.pdf (3 halaman) dan dense90.pdf (90 halaman).
 */
import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const OUT =
  process.argv[2] || process.env.FIXTURES_DIR || path.join(process.cwd(), "fixtures");
fs.mkdirSync(OUT, { recursive: true });

async function make(file, pages, label) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`${label} halaman ${i + 1}`, {
      x: 60,
      y: 760,
      size: 28,
      font,
      color: rgb(0.1, 0.2, 0.5),
    });
    page.drawText("PDF fixture untuk audit antarmuka dan alat.", {
      x: 60,
      y: 720,
      size: 12,
      font,
    });
  }
  const bytes = await doc.save();
  const p = path.join(OUT, file);
  fs.writeFileSync(p, bytes);
  console.log(`${p} (${pages} halaman, ${bytes.length} byte)`);
}

await make("sample.pdf", 3, "Uji");
await make("dense90.pdf", 90, "Uji padat");
