/**
 * Generator fixture untuk audit fitur "Rapi PDF" (deskew).
 *
 * Fixture dibuat di Chromium sungguhan supaya benar-benar seperti hasil
 * pindai: teks dirender ke canvas lalu diputar miring, lalu dijadikan
 * gambar (scan) atau vektor (PDF digital yang content stream-nya
 * diputar).
 *
 * Jalankan: node tools/mkfixtures-deskew.mjs
 *
 * Env:
 *   FIXTURES_DIR - folder tujuan (default: fixtures/deskew)
 *   PORT         - porta server lokal
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "./browser.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.SERVE_DIR || path.join(HERE, ".."));
const FIX = path.resolve(process.env.FIXTURES_DIR || path.join(ROOT, "fixtures", "deskew"));
const PORT = Number(process.env.PORT || 8074);

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".pdf": "application/pdf", ".png": "image/png",
  ".wasm": "application/wasm", ".json": "application/json",
};

function server() {
  const s = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || "/").split("?")[0]);
    let f = path.join(ROOT, url === "/" ? "index.html" : url);
    if (!f.startsWith(ROOT)) return res.writeHead(403).end();
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
    if (!fs.existsSync(f)) return res.writeHead(404).end("nf");
    res.writeHead(200, { "content-type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => s.listen(PORT, "127.0.0.1", () => r(s)));
}

/* Isi teks untuk halaman contoh (bahasa Indonesia). */
const BARIS = [
  "LAPORAN KEGIATAN TAHUN 2026",
  "",
  "1. Pendahuluan",
  "Dokumen ini disusun sebagai ringkasan kegiatan yang telah",
  "dilaksanakan selama periode Januari sampai Desember 2026 oleh",
  "Tim pelaflora dan lapangan dariifa Wayan ning di lapangan.",
  "",
  "2. Laporan Kegiatan",
  "a) Pengajuan 7/2026 - validator",
  "   |- 21/03/2026 08.15  identifier PROPOSAL-4412",
  "   |- 22/03/2026 10.42  identifier APPROVAL-7710",
  "   |- 23/03/2026 14.07  identifier REPORT-0093",
  "",
  "3. Evaluasi",
  "Secara keseluruhan capaian berada pada angka 87,4 persen dengan",
  "catatan bahwa tiga kegiatan murni ditunda karena cuaca buruk.",
  "Rincian expenditures dapat dilihat pada lampiran halaman 12.",
  "",
  "4. Penutup",
  "Demikian laporan ini disusun sebagai bahancedent pemMwconference",
  "semoga dapat bermanfaat bagi semua pihak yang berkepentingan.",
];async function main() {
  const srv = await server();
  const browser = await chromium();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on("pageerror", (e) => console.error("pageerror:", String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
  await page.waitForTimeout(1500);

  /* Helper: untuk memutar content stream PDF (dipakai juga di tool-pdf.js) */
  await page.addScriptTag({
    content: `
      window.__putarContent = function (doc, page, sudut) {
        const { PDFName, PDFArray } = window.PDFLib;
        const box = page.getMediaBox();
        const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
        const rad = (sudut * Math.PI) / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        const a = cos, b = sin, c = -sin, d = cos;
        const e = cx - a * cx - c * cy, f = cy - b * cx - d * cy;
        const fmt = (n) => (Math.round(n * 100000) / 100000).toString();
        const ctx = doc.context;
        const awal = ctx.register(ctx.stream("q\\n" + [a,b,c,d,e,f].map(fmt).join(" ") + " cm\\n"));
        const akhir = ctx.register(ctx.stream("Q\\n"));
        const isi = page.node.get(PDFName.of("Contents"));
        const arr = isi instanceof PDFArray ? isi.asArray().slice() : (isi ? [isi] : []);
        page.node.set(PDFName.of("Contents"), ctx.obj([awal, ...arr, akhir]));
        return true;
      };
      window.__gambarHalaman = function (baris, opts) {
        const o = opts || {};
        const W = 1190, H = 1684;           /* A4 pada 144 dpi */
        const m = o.margin == null ? 120 : o.margin;
        const canvas = document.createElement("canvas");
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, W, H);
        ctx.save();
        if (o.rot) {
          ctx.translate(W / 2, H / 2);
          ctx.rotate((-o.rot * Math.PI) / 180);   /* user-space CCW positif */
          ctx.translate(-W / 2, -H / 2);
        }
        ctx.fillStyle = "#101010";
        ctx.font = (o.bold ? "bold " : "") + (o.size || 26) + "px Helvetica, Arial, sans-serif";
        ctx.textBaseline = "alphabetic";
        let y = m + (o.size || 26);
        for (const b of baris) {
          if (b) ctx.fillText(b, m + (o.indent || 0), y);
          y += (o.leading || 42);
        }
        ctx.restore();
        return canvas;
      };
      window.__canvasKeJpeg = function (canvas, q) {
        return canvas.toDataURL("image/jpeg", q == null ? 0.92 : q);
      };
    `,
  });

  fs.mkdirSync(FIX, { recursive: true });

  /* ---- 1. Fixture pindai miring (gambar) ---- */
  const raster = async (nama, rot, opsi = {}) => {
    const dataUrl = await page.evaluate(
      ({ baris, rot, opsi }) => {
        const c = window.__gambarHalaman(baris, Object.assign({}, opsi, { rot }));
        return window.__canvasKeJpeg(c, opsi.jpegQuality);
      },
      { baris: BARIS, rot, opsi }
    );
    const bytes = await page.evaluate(async (d) => {
      const bin = atob(d.split(",")[1]);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const out = await PDFLib.PDFDocument.create();
      const img = await out.embedJpg(u8);
      const p = out.addPage([595.28, 841.89]);
      p.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
      const res = await out.save({ useObjectStreams: false });
      return Array.from(new Uint8Array(res));
    }, dataUrl);
    fs.writeFileSync(path.join(FIX, nama), Buffer.from(bytes));
    console.log("  " + nama + " (" + bytes.length + " byte, rot=" + rot + "°)");
  };

  console.log("Fixture pindai (gambar):");
  await raster("pindai-lurus.pdf", 0);
  await raster("pindai-miring3.pdf", 3);
  await raster("pindai-miring-minus25.pdf", -2.5);
  await raster("pindai-miring6.pdf", 6);
  await raster("pindai-tegak90.pdf", 90);
  await raster("pindai-tegak-minus90.pdf", -90);
  await raster("pindai-terbalik180.pdf", 180);

  /* ---- 2. Fixture vektor miring (PDF digital, content stream diputar) ---- */
  const vektor = async (nama, rot) => {
    const bytes = await page.evaluate(
      async ({ baris, rot }) => {
        const W = 595.28, H = 841.89;
        const doc = await PDFLib.PDFDocument.create();
        const page = doc.addPage([W, H]);
        const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
        const bold = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
        let y = H - 70;
        for (const b of baris) {
          if (b) {
            page.drawText(b, {
              x: 60, y, size: 11, font: b === baris[0] ? bold : font,
              color: PDFLib.rgb(0.06, 0.06, 0.06),
            });
          }
          y -= 16;
        }
        /* tautan + bookmark supaya bisa diawasi */
        page.node.set(
          PDFLib.PDFName.of("Annots"),
          doc.context.obj([
            doc.context.obj({
              Type: "Annot", Subtype: "Link", Rect: [60, H - 120, 260, H - 100],
              Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: "https://example.id/laporan" },
            }),
          ])
        );
        if (rot) window.__putarContent(doc, page, rot);
        const res = await doc.save({ useObjectStreams: false });
        return Array.from(new Uint8Array(res));
      },
      { baris: BARIS, rot }
    );
    fs.writeFileSync(path.join(FIX, nama), Buffer.from(bytes));
    console.log("  " + nama + " (" + bytes.length + " byte, rot=" + rot + "°)");
  };

  console.log("Fixture vektor (PDF digital):");
  await vektor("vektor-lurus.pdf", 0);
  await vektor("vektor-miring3.pdf", 3);
  await vektor("vektor-miring-minus4.pdf", -4);

  /* ---- 3. Fixture foto (tanpa teks) -> harus TIDAK diputar ---- */
  {
    const dataUrl = await page.evaluate(() => {
      const W = 1190, H = 1684;
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#f2efe8"; ctx.fillRect(0, 0, W, H);
      let seed = 987654321;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      for (let i = 0; i < 26000; i++) {
        const x = rnd() * W, y = rnd() * H, r = 1 + rnd() * 5;
        const g = 90 + Math.floor(rnd() * 120);
        ctx.fillStyle = "rgb(" + g + "," + (g - 8) + "," + (g - 20) + ")";
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
      return c.toDataURL("image/jpeg", 0.9);
    });
    const bytes = await page.evaluate(async (d) => {
      const bin = atob(d.split(",")[1]);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const out = await PDFLib.PDFDocument.create();
      const img = await out.embedJpg(u8);
      const p = out.addPage([595.28, 841.89]);
      p.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
      const res = await out.save({ useObjectStreams: false });
      return Array.from(new Uint8Array(res));
    }, dataUrl);
    fs.writeFileSync(path.join(FIX, "foto-tanpa-teks.pdf"), Buffer.from(bytes));
    console.log("  foto-tanpa-teks.pdf (" + bytes.length + " byte)");
  }

  /* ---- 4. Fixture halaman kosong ---- */
  {
    const bytes = await page.evaluate(async () => {
      const out = await PDFLib.PDFDocument.create();
      out.addPage([595.28, 841.89]);
      out.addPage([595.28, 841.89]);
      const res = await out.save({ useObjectStreams: false });
      return Array.from(new Uint8Array(res));
    });
    fs.writeFileSync(path.join(FIX, "kosong.pdf"), Buffer.from(bytes));
    console.log("  kosong.pdf (" + bytes.length + " byte)");
  }

  await browser.close();
  srv.close();
  console.log("\nFixture selesai -> " + FIX);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
