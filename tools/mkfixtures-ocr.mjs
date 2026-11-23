/**
 * Generator fixture untuk audit OCR (tools/audit-ocr.mjs).
 *
 * Fixture audit OCR:
 *  - sertifikat.pdf : PDF digital (teks asli) + anotasi tautan + bookmark
 *  - rotasi90.pdf    : halaman dengan /Rotate 90
 *  - crop.pdf        : CropBox lebih kecil dari MediaBox
 *  - enam-halaman.pdf: dokumen multi halaman untuk uji mesin paralel
 *  - pindai.pdf      : dibuat di browser (hasil raster, tanpa teks)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, PDFName, PDFHexString, rgb, degrees } from "pdf-lib";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || path.join(path.resolve(HERE, ".."), "fixtures", "ocr");
fs.mkdirSync(OUT, { recursive: true });

/* 1. Sertifikat digital + anotasi + bookmark */
{
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.TimesRoman);
  const b = await doc.embedFont(StandardFonts.TimesRomanBold);
  const p = doc.addPage([595, 842]);
  p.drawRectangle({ x: 0, y: 0, width: 595, height: 842, borderColor: rgb(0.1, 0.15, 0.4), borderWidth: 3 });
  p.drawText("SERTIFIKAT WEBINAR PGRI", { x: 70, y: 706, size: 14, font: b, color: rgb(0, 0, 0) });
  p.drawText("Nomor: 456/SE/TEK/33.01/05/XXXIII/2026", { x: 70, y: 660, size: 12, font: f, color: rgb(0, 0, 0) });
  p.drawText("Diberikan kepada: Para Hutama Putra, S.Pd.", { x: 70, y: 626, size: 12, font: f, color: rgb(0, 0, 0) });
  p.drawText("SD Negeri Klumpri 04 Nusawungu", { x: 70, y: 600, size: 12, font: b, color: rgb(0, 0, 0) });
  p.drawText("atas partisipasinya sebagai peserta webinar Strategi Efektif", { x: 70, y: 548, size: 10, font: f, color: rgb(0, 0, 0) });
  p.drawText("Mengelola Digitalisasi Pembelajaran direspective seminar", { x: 70, y: 530, size: 10, font: f, color: rgb(0, 0, 0) });
  p.drawRectangle({ x: 200, y: 495, width: 330, height: 45, borderColor: rgb(0.1, 0.2, 0.8), borderWidth: 1.5 });

  /* anotasi tautan (harus tetap ada setelah OCR) */
  const link = doc.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [70, 654, 300, 676],
    Border: [0, 0, 0],
    A: { Type: "Action", S: "URI", URI: "https://pgri.example/sertifikat" },
  });
  const linkRef = doc.context.register(link);

  /* field formulir (widget + AcroForm) — harus tetap terisi & terbaca */
  const field = doc.context.obj({
    Type: "Annot",
    Subtype: "Widget",
    FT: "Tx",
    T: PDFHexString.fromText("Nama Peserta"),
    Rect: [70, 300, 400, 330],
    F: 4,
    V: PDFHexString.fromText("Hutama Putra"),
    DA: "/Helv 12 Tf 0 g",
    P: p.ref,
    MK: { BC: [0, 0, 0], BG: [1, 1, 1] },
    BS: { W: 1, S: "S" },
  });
  const fieldRef = doc.context.register(field);
  p.node.set(PDFName.of("Annots"), doc.context.obj([linkRef, fieldRef]));

  const acroRef = doc.context.register(doc.context.obj({
    Fields: [fieldRef],
    DA: "/Helv 0 Tf 0 g",
    NeedAppearances: true,
  }));
  doc.catalog.set(PDFName.of("AcroForm"), acroRef);

  /* bookmark (harus tetap ada setelah OCR) */
  const outlinesRef = doc.context.register(doc.context.obj({ Type: "Outlines" }));
  const itemRef = doc.context.register(doc.context.obj({}));
  doc.context.assign(outlinesRef, doc.context.obj({
    Type: "Outlines", First: itemRef, Last: itemRef, Count: 1,
  }));
  doc.context.assign(itemRef, doc.context.obj({
    Title: PDFHexString.fromText("Sertifikat Webinar"),
    Parent: outlinesRef,
    Dest: [p.ref, PDFName.of("Fit")],
  }));
  doc.catalog.set(PDFName.of("Outlines"), outlinesRef);

  fs.writeFileSync(path.join(OUT, "sertifikat.pdf"), await doc.save());
}

/* 2. Halaman berotasi 90 derajat */
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([595, 842]);
  p.setRotation(degrees(90));
  /* isi halaman dimiringkan -90 supaya tampil tegak setelah rotasi
     halaman (meniru PDF hasil pindai yang ber-/Rotate 90). */
  p.drawText("HALAMAN BEROTASI 90 DERAJAT", { x: 500, y: 120, size: 18, font, rotate: degrees(90) });
  p.drawText("Baris kedua untuk uji pemetaan koordinat", { x: 460, y: 120, size: 14, font, rotate: degrees(90) });
  fs.writeFileSync(path.join(OUT, "rotasi90.pdf"), await doc.save());
}

/* 3. CropBox lebih kecil dari MediaBox */
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([595, 842]);
  p.setCropBox(50, 100, 450, 650);
  p.drawText("TEKS DI DALAM AREA CROP", { x: 80, y: 600, size: 18, font });
  p.drawText("Baris kedua di area crop", { x: 80, y: 570, size: 14, font });
  fs.writeFileSync(path.join(OUT, "crop.pdf"), await doc.save());
}

/* 4. Multi halaman */
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 6; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`HALAMAN ${i + 1} DOKUMEN HASIL PINDAI`, { x: 60, y: 700, size: 18, font });
    p.drawText(`Nomor halaman ${i + 1} untuk pengujian mesin paralel`, { x: 60, y: 660, size: 13, font });
  }
  fs.writeFileSync(path.join(OUT, "enam-halaman.pdf"), await doc.save());
}

console.log("fixture OCR dibuat di", OUT);
