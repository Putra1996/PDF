/**
 * Audit mendasar fitur OCR (regresi khusus OCR).
 *
 * Menjalankan alat "OCR PDF" sungguhan (Tesseract offline) di Chromium,
 * lalu memeriksa hasil PDF-nya: lapisan teks, lebar kata, urutan teks,
 * pemetaan koordinat (rotasi & CropBox), duplikasi teks, serta
 * keyst invigorasi metadata/anotasi/bookmark.
 *
 * Jalankan:  node tools/mkfixtures-ocr.mjs && node tools/audit-ocr.mjs
 *
 * Env:
 *   SERVE_DIR    - direktori statis yang dilayani (default: repo ini)
 *   FIXTURES_DIR - folder fixture OCR (default: fixtures/ocr)
 *   SHOT_DIR     - folder screenshot bukti (default: docs/audit-ocr-2026-11-23)
 *   PORT         - porta server lokal
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "./browser.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.SERVE_DIR || path.join(HERE, ".."));
const FIX = path.resolve(process.env.FIXTURES_DIR || path.join(ROOT, "fixtures", "ocr"));
const SHOTS = path.resolve(process.env.SHOT_DIR || path.join(ROOT, "docs", "audit-ocr-2026-11-23"));
const FIX_URL = process.env.FIXTURE_URL || "/fixtures/ocr";
const PORT = Number(process.env.PORT || 8071);

const results = [];
let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  ok ? pass++ : fail++;
  console.log(`${ok ? "\u2713" : "\u2717"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".pdf": "application/pdf", ".png": "image/png",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".gz": "application/octet-stream",
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

async function main() {
  const srv = await server();
  const browser = await chromium();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
  await page.waitForTimeout(1500);

  /* ---- jalankan alat OCR ---- */
  async function jalankanOcr(file, opsi = {}) {
    await page.click("#tab-tools");
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const c = [...document.querySelectorAll("#toolCategories .tool-card")].find((n) =>
        n.textContent.includes("OCR PDF")
      );
      c?.click();
    });
    await page.waitForTimeout(600);
    await page.evaluate((o) => {
      for (const [id, val] of Object.entries(o)) {
        const el = document.getElementById("f_" + id);
        if (!el) continue;
        if (el.type === "checkbox") el.checked = !!val;
        else el.value = String(val);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }, opsi);
    await page.setInputFiles("#toolInput", file);
    await page.waitForTimeout(1200);
    const t0 = Date.now();
    await page.click("#toolRunBtn");
    let progres = [];
    for (let i = 0; i < 120; i++) {
      await page.waitForTimeout(1000);
      const n = await page.evaluate(() => document.querySelectorAll("#toolResults > *").length);
      if (n > 0) break;
      if (i % 5 === 0) {
        progres.push(await page.evaluate(() => ({
          bar: document.querySelector("#progressBar")?.style.width || "",
          teks: document.querySelector("#toolOverlayText")?.textContent || "",
        })));
      }
    }
    const durasi = ((Date.now() - t0) / 1000).toFixed(1);
    const href = await page.evaluate(() => {
      const a = document.querySelector("#toolResults a");
      return a ? a.href : null;
    });
    if (!href) return { bytes: null, durasi, progres };
    const arr = await page.evaluate(async (u) => {
      const r = await fetch(u);
      return Array.from(new Uint8Array(await r.arrayBuffer()));
    }, href);
    await page.click("#toolBackBtn").catch(() => {});
    await page.waitForTimeout(400);
    return { bytes: Buffer.from(arr), durasi, progres };
  }

  /* ---- analisis PDF hasil ---- */
  async function analisis(buf) {
    const b64 = buf.toString("base64");
    return page.evaluate(async ({ b64 }) => {
      const bin = atob(b64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const doc = await pdfjsLib.getDocument({ data: u8 }).promise;
      const halaman = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const p = await doc.getPage(i);
        const tc = await p.getTextContent();
        const items = tc.items
          .filter((it) => it.str && it.str.trim())
          .map((it) => ({
            s: it.str, x: +it.transform[4].toFixed(2), y: +it.transform[5].toFixed(2),
            w: +(it.width || 0).toFixed(2), h: +(it.height || 0).toFixed(2),
            rot: +((Math.atan2(it.transform[1], it.transform[0]) * 180) / Math.PI).toFixed(1),
          }));
        const vp = p.getViewport({ scale: 1 });
        const c = document.createElement("canvas");
        c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        await p.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
        halaman.push({
          items,
          teks: items.map((it) => it.s).join(" "),
          teksRapi: items.map((it) => it.s).join("").replace(/\s+/g, " "),
          w: Math.round(vp.width), h: Math.round(vp.height),
          png: c.toDataURL("image/png"),
        });
      }
      /* struktur: jumlah anotasi & bookmark */
      const meta = await doc.getMetadata().catch(() => ({}));
      const p1 = await doc.getPage(1);
      let daftarAnn = [];
      if (typeof p1.getAnnotations === "function") daftarAnn = (await p1.getAnnotations()) || [];
      else if (p1.annotations) {
        const a = p1.annotations;
        daftarAnn = a && typeof a.then === "function" ? (await a) || [] : a;
      }
      const annots = daftarAnn.length;
      let fields = [];
      if (typeof doc.getFieldObjects === "function") {
        const fo = (await doc.getFieldObjects()) || {};
        fields = Array.isArray(fo) ? fo.map((f) => f.name) : Object.keys(fo);
      }
      const outlines = typeof doc.getOutline === "function" ? (await doc.getOutline()) || [] : [];
      return {
        numPages: doc.numPages,
        halaman,
        ukuran: bin.length,
        annots,
        outline: outlines.map((o) => o.title),
        fields,
      };
    }, { b64 });
  }

  fs.mkdirSync(SHOTS, { recursive: true });
  const simpan = (nama, dataUrl) =>
    fs.writeFileSync(path.join(SHOTS, nama), Buffer.from(dataUrl.split(",")[1], "base64"));

  /* ============ 1. Halaman digital -> dilewati, isi asli utuh ============ */
  {
    const r = await jalankanOcr(path.join(FIX, "sertifikat.pdf"), { mode: "searchable", existing: "skip" });
    check("OCR menghasilkan berkas", !!r.bytes, r.bytes ? `${r.bytes.length} byte, ${r.durasi}s` : "gagal");
    if (r.bytes) {
      const a = await analisis(r.bytes);
      const h = a.halaman[0];
      check("Halaman berteks asli TIDAK di-OCR ulang", h.items.length <= 12, `item=${h.items.length}`);
      check("Teks asli utuh di hasil", /SERTIFIKAT/.test(h.teksRapi), h.teks.slice(0, 60));
      check("Halaman hasil tetap 1 halaman", a.numPages === 1, `halaman=${a.numPages}`);
      check("Berkas hasil tetap ramping (tidak di-raster)", a.ukuran < 20000, `${a.ukuran} byte`);
      check("Anotasi tautan tetap ada", a.annots >= 1, `anotasi=${a.annots}`);
      check("Bookmark tetap ada", a.outline.join(",").includes("Sertifikat"), a.outline.join(","));
      check("Field formulir tetap ada", a.fields.join(",").includes("Nama Peserta"), a.fields.join(","));
      simpan("ocr-sertifikat-skip.png", h.png);
    }
  }

  /* ============ 2. PDF pindai -> lapisan teks tak terlihat ============ */
  let pindaiFile = path.join(FIX, "pindai.pdf");
  let pindaiRotasiFile = path.join(FIX, "pindai-rotasi.pdf");
  {
    const made = await page.evaluate(async (url) => {
      const buf = await (await fetch(url)).arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
      const p = await doc.getPage(1);
      const vp = p.getViewport({ scale: 2 });
      const c = document.createElement("canvas");
      c.width = vp.width; c.height = vp.height;
      await p.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      const jpg = c.toDataURL("image/jpeg", 0.92);
      const bin = atob(jpg.split(",")[1]);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const out = await PDFLib.PDFDocument.create();
      const img = await out.embedJpg(u8);
      const pg = out.addPage([595, 842]);
      pg.drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
      const res = await out.save();
      return Array.from(new Uint8Array(res));
    }, FIX_URL + "/sertifikat.pdf");
    fs.writeFileSync(pindaiFile, Buffer.from(made));

    /* PDF pindai dengan /Rotate 90 (meniru hasil scanner yang memutar
       halaman): gambar sudah tegak saat ditampilkan. */
    const madeRot = await page.evaluate(async (url) => {
      const buf = await (await fetch(url)).arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
      const p = await doc.getPage(1);
      const vp = p.getViewport({ scale: 1 });
      const c = document.createElement("canvas");
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      await p.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      const jpg = c.toDataURL("image/jpeg", 0.92);
      const bin = atob(jpg.split(",")[1]);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const out = await PDFLib.PDFDocument.create();
      const img = await out.embedJpg(u8);
      const pg = out.addPage([595, 842]);
      pg.setRotation(PDFLib.degrees(90));
      pg.drawImage(img, { x: 595, y: 0, width: vp.width, height: vp.height, rotate: PDFLib.degrees(90) });
      const res = await out.save();
      return Array.from(new Uint8Array(res));
    }, FIX_URL + "/rotasi90.pdf");
    fs.writeFileSync(pindaiRotasiFile, Buffer.from(madeRot));

    const r = await jalankanOcr(pindaiFile, { mode: "searchable", existing: "skip" });
    check("OCR PDF pindai berhasil", !!r.bytes, r.bytes ? `${r.bytes.length} byte, ${r.durasi}s` : "gagal");
    if (r.bytes) {
      const a = await analisis(r.bytes);
      const h = a.halaman[0];
      check("Lapisan teks ditambahkan", h.items.length > 10, `item=${h.items.length}`);
      check("OCR membedakan judul sertifikat dengan akurat", /SERTIFIKAT\s*WEBINAR\s*PGRI/.test(h.teks), h.teks.slice(0, 70));
      check("Teks terbaca: nama sekolah", /Nusawungu|Klumpri/.test(h.teksRapi), h.teks.slice(0, 70));
      const kata = h.items.filter((i) => i.s.length > 3 && i.w > 0);
      const lebarRata = kata.reduce((s, i) => s + i.w, 0) / (kata.length || 1);
      check("Lebar kata wajar (tidak menyusut drastis)", lebarRata > 8, `rata=${lebarRata.toFixed(1)}pt`);
      check("Semua kata punya lebar > 0", h.items.every((i) => i.w > 0), "");
      const atas = h.items.filter((i) => i.y > 700).length;
      check("Posisi teks sesuai halaman", atas >= 3, `kata di y>700: ${atas}`);
      /* kata tidak boleh tumpang tindih: kelompokkan per baris (y toleran)
         laluEnsure tidak ada yang saling menimpa */
      const baris = [];
      for (const it of h.items.slice().sort((a2, b2) => b2.y - a2.y || a2.x - b2.x)) {
        const b = baris.find((g) => Math.abs(g.y - it.y) < 3);
        if (b) b.items.push(it); else baris.push({ y: it.y, items: [it] });
      }
      const tumpang = [];
      for (const b of baris) {
        const urut = b.items.slice().sort((a2, b2) => a2.x - b2.x);
        for (let i = 1; i < urut.length; i++) {
          const overhang = urut[i - 1].x + urut[i - 1].w - urut[i].x;
          if (overhang > 1.5) tumpang.push(`${urut[i - 1].s}|${urut[i].s}:${overhang.toFixed(1)}pt`);
        }
      }
      check("Kata tidak tumpang tindih", tumpang.length === 0, `tumpang=${tumpang.length} ${tumpang.slice(0, 3).join(" ")}`);
      simpan("ocr-pindai-searchable.png", h.png);
    }
  }

  /* ============ 3. Paksa OCR pada halaman berteks -> tanpa duplikasi ============ */
  {
    const r = await jalankanOcr(path.join(FIX, "sertifikat.pdf"), { mode: "searchable", existing: "force" });
    check("Paksa OCR pada halaman berteks berhasil", !!r.bytes, r.bytes ? `${r.bytes.length} byte` : "gagal");
    if (r.bytes) {
      const a = await analisis(r.bytes);
      const h = a.halaman[0];
      check("Teks hasil OCR menggantikan teks asli", h.items.length > 10, `item=${h.items.length}`);
      check("Tidak ada duplikasi teks asli+OCR", (h.teksRapi.match(/SERTIFIKAT/gi) || []).length <= 2,
        `kemunculan SERTIFIKAT=${(h.teksRapi.match(/SERTIFIKAT/gi) || []).length}`);
      check("Halaman tetap 1 halaman", a.numPages === 1, `halaman=${a.numPages}`);
      simpan("ocr-paksa-searchable.png", h.png);
    }
  }

  /* ============ 4. Mode dokumen bersih ============ */
  {
    const r = await jalankanOcr(pindaiFile, { mode: "clean", existing: "skip" });
    check("Mode dokumen bersih berhasil", !!r.bytes, r.bytes ? `${r.bytes.length} byte` : "gagal");
    if (r.bytes) {
      const a = await analisis(r.bytes);
      const h = a.halaman[0];
      check("Teks terlihat di mode bersih", h.items.length > 5, `item=${h.items.length}`);
      check("Halaman bersih tanpa gambar pindai (berkas kecil)", a.ukuran < 120000, `${a.ukuran} byte`);
      simpan("ocr-mode-bersih.png", h.png);
    }
  }

  /* ============ 5. Mode overlay (teks terlihat di atas gambar) ============ */
  {
    const r = await jalankanOcr(pindaiFile, { mode: "overlay", existing: "skip" });
    check("Mode overlay berhasil", !!r.bytes, r.bytes ? `${r.bytes.length} byte` : "gagal");
    if (r.bytes) {
      const a = await analisis(r.bytes);
      const h = a.halaman[0];
      check("Overlay: teks ada dan terlihat", h.items.length > 5, `item=${h.items.length}`);
      check("Overlay: gambar pindai tetap ada (berkas > 40KB)", a.ukuran > 40000, `${a.ukuran} byte`);
      simpan("ocr-overlay.png", h.png);
    }
  }

  /* ============ 6. Halaman berotasi ============ */
  {
    const r = await jalankanOcr(path.join(FIX, "rotasi90.pdf"), { mode: "searchable", existing: "force" });
    check("OCR halaman berotasi berhasil", !!r.bytes, r.bytes ? `${r.bytes.length} byte` : "gagal");
    if (r.bytes) {
      const a = await analisis(r.bytes);
      const h = a.halaman[0];
      check("Halaman berotasi: ukuran landscape", h.w > h.h, `${h.w}x${h.h}`);
      check("Halaman berotasi: teks terbaca", h.items.length > 3, `item=${h.items.length}`);
      check("Halaman berotasi: isi sesuai sumber", /BEROTASI/i.test(h.teksRapi), h.teks.slice(0, 60));
      /* halaman berotasi yang dibangun ulang: rotasi dihapus dan teks
         diletakkan mendatar di halaman baru (ikut gambar) */
      const miring = h.items.filter((it) => Math.abs(it.rot || 0) > 5).length;
      check("Halaman berotasi (dibangun ulang): teks mendatar di halaman baru",
        miring === 0, `miring=${miring}/${h.items.length}`);
      simpan("ocr-rotasi.png", h.png);
    }
  }

  /* ============ 7. CropBox ============ */
  {
    const r = await jalankanOcr(path.join(FIX, "crop.pdf"), { mode: "searchable", existing: "force" });
    check("OCR halaman tercrop berhasil", !!r.bytes, r.bytes ? `${r.bytes.length} byte` : "gagal");
    if (r.bytes) {
      const a = await analisis(r.bytes);
      const h = a.halaman[0];
      const xMin = h.items.length ? Math.min(...h.items.map((i) => i.x)) : 0;
      check("Halaman tercrop: teks tidak bergeser keluar area", xMin > -5 && xMin < 60, `xMin=${xMin}`);
      simpan("ocr-crop.png", h.png);
    }
  }

  /* ============ 8. Multi halaman + mesin paralel ============ */
  {
    const r = await jalankanOcr(path.join(FIX, "enam-halaman.pdf"), { mode: "searchable", existing: "force", workers: 2 });
    check("OCR multi halaman berhasil", !!r.bytes, r.bytes ? `${r.bytes.length} byte, ${r.durasi}s` : "gagal");
    if (r.bytes) {
      const a = await analisis(r.bytes);
      check("Semua halaman terproses", a.numPages === 6, `halaman=${a.numPages}`);
      check("Setiap halaman punya lapisan teks", a.halaman.every((h) => h.items.length > 0),
        a.halaman.map((h) => h.items.length).join(","));
      check("Halaman pertama berisi 'HALAMAN 1'", /HALAMAN\s*1/.test(a.halaman[0].teksRapi), a.halaman[0].teks.slice(0, 60));
      check("Urutan halaman terjaga", /HALAMAN\s*6/.test(a.halaman[5].teksRapi), a.halaman[5].teks.slice(0, 60));
      check("Progres bergerak selama proses",
        (r.progres || []).some((p) => /%|OCR|Mengenali/.test(p.bar + p.teks)),
        JSON.stringify((r.progres || []).slice(0, 3)));
    }
  }

  /* ============ 8b. PDF pindai berotasi (jalur in-place) ============ */
  {
    const r = await jalankanOcr(pindaiRotasiFile, { mode: "searchable", existing: "skip" });
    check("OCR PDF pindai berotasi berhasil", !!r.bytes, r.bytes ? `${r.bytes.length} byte` : "gagal");
    if (r.bytes) {
      const a = await analisis(r.bytes);
      const h = a.halaman[0];
      check("Pindai berotasi: halaman tetap landscape", h.w > h.h, `${h.w}x${h.h}`);
      check("Pindai berotasi: teks terbaca", /BEROTASI/i.test(h.teksRapi), h.teks.slice(0, 70));
      const miring = h.items.filter((it) => Math.abs(it.rot || 0) > 5).length;
      check("Pindai berotasi: teks OCR ikut miring seperti isi halaman",
        miring >= 3, `miring=${miring}/${h.items.length}`);
      simpan("ocr-pindai-rotasi.png", h.png);
    }
  }

  /* ============ 9. Error runtime ============ */
  const fatal = errors.filter((e) => !/favicon|net::ERR_|Failed to load resource/i.test(e));
  check("Tidak ada error JavaScript", fatal.length === 0, fatal.slice(0, 2).join(" | "));

  await browser.close();
  srv.close();

  console.log(`\n== HASIL: ${pass} lulus, ${fail} gagal ==`);
  if (fail) {
    console.log("\nGagal:");
    for (const r of results.filter((r) => !r.ok)) console.log(` - ${r.name} ${r.detail}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("Harness gagal:", e);
  process.exitCode = 2;
});
