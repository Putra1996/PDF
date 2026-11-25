/**
 * Generator fixture untuk audit mendalam fitur "Rapi PDF".
 *
 * Fixture meniru hasil pindai dokumen resmi (akta/surat keterangan):
 * teks padat dua kolom, foto, stempel berwarna, dan tanda tangan —
 * lalu dimiringkan (miring kecil seperti hasil pindai alat biasa)
 * dan disimpan sebagai gambar JPEG (tanpa lapisan teks).
 *
 * Sebagian fixture dibuat sebagai PDF digital (ada teks) untuk
 * memastikan perbaikan tidak merusak teks yang bisa dicari.
 *
 * Jalankan: node tools/mkfixtures-rapi.mjs
 *
 * Env:
 *   FIXTURES_DIR - folder tujuan (default fixtures/rapi)
 *   PORT         - porta server lokal
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "./browser.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.SERVE_DIR || path.join(HERE, ".."));
const FIX = path.resolve(process.env.FIXTURES_DIR || path.join(ROOT, "fixtures", "rapi"));
const PORT = Number(process.env.PORT || 8075);

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

/* Isi dokumen contoh: resemble surat keterangan resmi. */
const ISI = {
  judul: "SURAT KETERANGANGAN CATATAN KEPOLISIAN",
  subjudul: "POLICE RECORD",
  kop: [
    "KEPOLISIAN NEGARA REPUBLIK INDONESIA",
    "DAERAH JAWA TENGAH",
    "RESOR KOTA CILACAP",
    "Jl. Ir. H. Juanda 18 Cilacap 53231",
  ],
  isi: [
    ["Nomor", "SKCK / YANMAS / 9995 / IX / YAN 2.3 / 2024 / Intelkam"],
    ["Nama", "PURA HUTAMA PUTRA"],
    ["Tempat, tanggal lahir", "CILACAP, 30 APRIL 1996"],
    ["Jenis Kelamin", "LAKI-LAKI"],
    ["Kebangsaan", "INDONESIA"],
    ["Agama", "ISLAM"],
    ["Pekerjaan", "GURU"],
    ["Nomor Kartu Tanda Penduduk", "3301053004660002"],
    ["Alamat", "KEC. NUSAWUNGGU KAB. CILACAP PROV. JAWA TENGAH"],
  ],
  bawah: [
    "Setelah dilakukan penelitian mengenai saat,__) dikeluarkan surat keterangan ini yang dicantumkan",
    "Keterangan dalam ini diberikan danenersia kepada",
    "Maka dinyatakan sebegai berikut:",
    "Bahwa nama tersebut adalah tidak memiliki catatan atau keterlanjutan dalam",
    "kegagalan kriminal apupun",
    "selama ini berada di Indonesia dari : 30 APRIL 1996",
    "For the purpose or to : MENGIKUTI PPG GURU TERTENTU TAHAP 3 TAHUN 2024",
    "Berlaku dari tanggal : 20 SEPTEMBER 2024",
  ],
};

async function main() {
  const srv = await server();
  const browser = await chromium();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on("pageerror", (e) => console.error("pageerror:", String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
  await page.waitForTimeout(1500);

  await page.addScriptTag({
    content: `
      window.__gambarAkta = function (rot, opsi) {
        const o = opsi || {};
        const W = 1654, H = 2339;         /* A4 pada 200 dpi */
        const m = o.margin == null ? 130 : o.margin;
        const canvas = document.createElement("canvas");
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, W, H);
        ctx.save();
        if (rot) {
          ctx.translate(W / 2, H / 2);
          ctx.rotate((-rot * Math.PI) / 180);
          ctx.translate(-W / 2, -H / 2);
        }
        const hitam = "#111111";
        const serif = "Times New Roman, Georgia, serif";
        const sans = "Helvetica, Arial, sans-serif";

        /* kop surat */
        ctx.fillStyle = hitam;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.font = "bold 42px " + sans;
        let y = m + 20;
        for (const b of ${JSON.stringify(ISI.kop)}) { ctx.fillText(b, W / 2, y); y += 46; }

        /* judul */
        ctx.font = "bold 46px " + sans;
        y += 46;
        ctx.fillText(${JSON.stringify(ISI.judul)}, W / 2, y);
        ctx.font = "bold 34px " + sans;
        y += 46;
        ctx.fillText(${JSON.stringify(ISI.subjudul)}, W / 2, y);

        /* garis pemisah + nomor */
        ctx.textAlign = "left";
        ctx.strokeStyle = hitam;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(m, y + 18); ctx.lineTo(W - m, y + 18); ctx.stroke();
        ctx.font = "30px " + sans;
        ctx.fillText("Nomor: 11 - 0741313", W - m - 250, y + 12);

        /* label + isi dua kolom */
        y += 70;
        ctx.font = "28px " + serif;
        for (const [label, nilai] of ${JSON.stringify(ISI.isi)}) {
          ctx.fillText(label + " : " + nilai, m, y);
          y += 42;
        }

        /* stempel bundar (oranye) */
        ctx.save();
        ctx.translate(W - m - 260, y + 120);
        ctx.rotate(-0.25);
        ctx.strokeStyle = "rgba(226,124,26,0.55)";
        ctx.lineWidth = 7;
        ctx.beginPath(); ctx.arc(0, 0, 150, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, 122, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = "rgba(226,124,26,0.5)";
        ctx.textAlign = "center";
        ctx.font = "bold 28px " + sans;
        ctx.fillText("POLISI", 0, -12);
        ctx.fillText("SEKOLAH", 0, 16);
        ctx.fillText("RESOR", 0, 44);
        ctx.restore();

        /* kotak foto + siluet */
        const fx = W - m - 420, fy = y + 40, fw = 290, fh = 370;
        ctx.fillStyle = "#d8d8d8";
        ctx.fillRect(fx, fy, fw, fh);
        ctx.fillStyle = "#8a8a8a";
        ctx.beginPath(); ctx.arc(fx + fw / 2, fy + 130, 72, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(fx + fw / 2, fy + 280, 108, 82, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = hitam;
        ctx.lineWidth = 2;
        ctx.strokeRect(fx, fy, fw, fh);

        /* paragraf bawah */
        ctx.fillStyle = hitam;
        ctx.font = "26px " + serif;
        y = fy + fh + 42;
        for (const b of ${JSON.stringify(ISI.bawah)}) { ctx.fillText(b, m, y); y += 37; }

        /* tanda tangan */
        ctx.strokeStyle = "#1b2b6b";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(W - m - 320, y + 66);
        ctx.bezierCurveTo(W - m - 260, y + 10, W - m - 190, y + 110, W - m - 120, y + 48);
        ctx.bezierCurveTo(W - m - 80, y + 12, W - m - 60, y + 90, W - m - 20, y + 56);
        ctx.stroke();
        ctx.fillStyle = hitam;
        ctx.textAlign = "center";
        ctx.font = "26px " + serif;
        ctx.fillText("PURA HUTAMA PUTRA", W - m - 170, y + 110);

        ctx.restore();
        return canvas;
      };
    `,
  });

  fs.mkdirSync(FIX, { recursive: true });

  /* ---- 1. Pindai miring (gambar JPEG, tanpa teks) ---- */
  const raster = async (nama, rot, opsi = {}) => {
    const bytes = await page.evaluate(
      async ({ rot, opsi }) => {
        const c = window.__gambarAkta(rot, opsi);
        const url = c.toDataURL("image/jpeg", opsi.jpegQuality == null ? 0.9 : opsi.jpegQuality);
        const bin = atob(url.split(",")[1]);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        const out = await PDFLib.PDFDocument.create();
        const img = await out.embedJpg(u8);
        const p = out.addPage([595.28, 841.89]);
        p.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
        const res = await out.save({ useObjectStreams: false });
        return Array.from(new Uint8Array(res));
      },
      { rot, opsi }
    );
    fs.writeFileSync(path.join(FIX, nama), Buffer.from(bytes));
    console.log("  " + nama + " (" + bytes.length + " byte, miring=" + rot + "°)");
  };

  console.log("Fixture pindai (gambar, miring kecil seperti hasil pindai alat):");
  await raster("akta-lurus.pdf", 0);
  await raster("akta-miring08.pdf", 0.8);      /* kasus pengguna */
  await raster("akta-miring05.pdf", 0.5);
  await raster("akta-miring12.pdf", 1.2);
  await raster("akta-miring-minus09.pdf", -0.9);
  await raster("akta-miring3.pdf", 3);
  await raster("akta-margin-lebar.pdf", 0.8, { margin: 190 });

  /* ---- 2. PDF digital (teks bisa dicari) miring ---- */
  const vektor = async (nama, rot) => {
    const bytes = await page.evaluate(
      async ({ rot }) => {
        const out = await PDFLib.PDFDocument.create();
        const font = await out.embedFont(PDFLib.StandardFonts.Helvetica);
        const bold = await out.embedFont(PDFLib.StandardFonts.HelveticaBold);
        const p = out.addPage([595.28, 841.89]);
        let y = 760;
        p.drawText("SURAT KETERANGAN CATATAN KEPOLISIAN", { x: 90, y, size: 16, font: bold });
        y -= 30;
        for (const b of ["Nama : PURA HUTAMA PUTRA", "Tempat, tanggal lahir : CILACAP, 30 APRIL 1996",
          "Jenis Kelamin : LAKI-LAKI", "Kebangsaan : INDONESIA", "Agama : ISLAM",
          "Pekerjaan : GURU", "Alamat : KEC. NUSAWUNGGU KAB. CILACAP"]) {
          p.drawText(b, { x: 90, y, size: 11, font });
          y -= 18;
        }
        y -= 16;
        for (let i = 0; i < 14; i++) {
          p.drawText("Keterangan mengenai Clearance yang jdbc benar serta ini adalah", { x: 90, y, size: 10, font });
          y -= 15;
        }
        p.drawText("Tanda tangan Reserves", { x: 380, y: 120, size: 10, font });
        /* putar content stream (meniru PDF digital yang dimiringkan alat) */
        const { PDFName, PDFArray } = window.PDFLib;
        const box = p.getMediaBox();
        const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
        const rad = (rot * Math.PI) / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        const a = cos, b = sin, c = -sin, d = cos;
        const e = cx - a * cx - c * cy, f = cy - b * cx - d * cy;
        const fmt = (n) => (Math.round(n * 100000) / 100000).toString();
        const ctx = out.context;
        /* "\n" di dalam string akan jadi karakter "\"+"n" (bukan
           baris baru) sehingga operator "cm" tidak pernah dibaca
           PDF dan halamannya tetap lurus. Pakai NL eksplisit. */
        const NL = String.fromCharCode(10);
        const awal = ctx.register(ctx.stream("q" + NL + [a, b, c, d, e, f].map(fmt).join(" ") + " cm" + NL));
        const akhir = ctx.register(ctx.stream("Q" + NL));
        const isi = p.node.get(PDFName.of("Contents"));
        const arr = isi instanceof PDFArray ? isi.asArray().slice() : isi ? [isi] : [];
        p.node.set(PDFName.of("Contents"), ctx.obj([awal, ...arr, akhir]));
        const res = await out.save({ useObjectStreams: false });
        return Array.from(new Uint8Array(res));
      },
      { rot }
    );
    fs.writeFileSync(path.join(FIX, nama), Buffer.from(bytes));
    console.log("  " + nama + " (" + bytes.length + " byte, miring=" + rot + "°)");
  };

  console.log("Fixture digital (teks bisa dicari):");
  await vektor("digital-lurus.pdf", 0);
  await vektor("digital-miring08.pdf", 0.8);
  await vektor("digital-miring2.pdf", 2);

  /* ---- 3. Multi halaman ---- */
  const bytes = await page.evaluate(
    async ({ rot }) => {
      const out = await PDFLib.PDFDocument.create();
      const font = await out.embedFont(PDFLib.StandardFonts.Helvetica);
      for (let h = 0; h < 3; h++) {
        const p = out.addPage([595.28, 841.89]);
        let y = 780;
        p.drawText("HALAMAN " + (h + 1) + " DOKUMEN RESMI", { x: 60, y, size: 15, font });
        y -= 28;
        for (let i = 0; i < 30; i++) {
          p.drawText("Baris isi halaman " + (h + 1) + " nomor " + (i + 1) + " untuk pengujian pemotongan dan perataan.", { x: 60, y, size: 10, font });
          y -= 15;
        }
      }
      const res = await out.save({ useObjectStreams: false });
      return Array.from(new Uint8Array(res));
    },
    {}
  );
  fs.writeFileSync(path.join(FIX, "multi3.pdf"), Buffer.from(bytes));
  console.log("  multi3.pdf (" + bytes.length + " byte)");

  /* ---- 4. PDF dengan anotasi, bookmark, dan tautan ---- */
  const bytes2 = await page.evaluate(
    async () => {
      const out = await PDFLib.PDFDocument.create();
      const font = await out.embedFont(PDFLib.StandardFonts.Helvetica);
      const p = out.addPage([595.28, 841.89]);
      p.drawText("Dokumen dengan tautan dan bookmark", { x: 60, y: 760, size: 15, font });
      p.drawText("Klik tautan di bawah ini.", { x: 60, y: 720, size: 11, font });
      const { PDFName, PDFString, PDFHexString } = window.PDFLib;
      p.node.set(PDFName.of("Annots"), out.context.obj([
        out.context.obj({
          Type: "Annot", Subtype: "Link", Rect: [60, 705, 240, 722],
          Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFString.of("https://contoh.go.id") },
        }),
      ]));
      out.setTitle("Dokumen Uji Anotasi");
      out.setAuthor("Harness Audit");
      out.setKeywords(["uji", "anotasi"]);
      out.setSubject("Uji bookmark");
      out.catalog.set(PDFName.of("Outlines"), out.context.obj({ Type: "Outlines", Count: 0 }));
      const res = await out.save({ useObjectStreams: false });
      return Array.from(new Uint8Array(res));
    },
    {}
  );
  fs.writeFileSync(path.join(FIX, "anotasi.pdf"), Buffer.from(bytes2));
  console.log("  anotasi.pdf (" + bytes2.length + " byte)");

  await browser.close();
  srv.close();
  console.log("\nFixture dibuat di " + FIX);
}

main().catch((e) => { console.error(e); process.exit(1); });
