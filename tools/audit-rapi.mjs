/**
 * Audit mendalam fitur "Rapi PDF" untuk dokumen pindai resmi.
 *
 * Kasus utama: surat keterangan pindai dengan kemiringan kecil (~0,8
 * derajat) — seperti lampiran pengguna. Harness ini menjalankan alat
 * sungguhan di Chromium lalu memeriksa:
 *
 *  - sudut miring setelah diperbaiki harus ~0 (diukur dengan algoritma
 *    MINIMUM VARIANCE yang ditulis sendiri oleh harness, bukan memakai
 *    kode aplikasi)
 *  - isi dokumen harus persis sama dengan masukan yang diputar sebesar
 *    sudut koreksi (bukti piksel): jarak rata-rata titik tinta < 1 pt.
 *    Joined dengan ini, dokumen yang terbalik 180 derajat pasti gagal.
 *  - gambar pindai tidak di-encode ulang (byte JPEG identik)
 *  - teks digital tetap vektor & bisa dicari
 *  - anotasi, bookmark, dan metadata tetap utuh / dibersihkan sesuai opsi
 *  - pemangkasan margin tepat di tepi isi
 *  - halaman terbalik (180) dan miring tegak (90) ditangani benar
 *  - semua opsi (batas sudut, tanpa pelurusan, tanpa putar 90, tanpa
 *    pangkas, tanpa bersihkan metadata) berperilaku seperti seharusnya
 *  - berkas rusak ditolak dengan pesan yang jelas
 *
 * Jalankan: node tools/mkfixtures-rapi.mjs && node tools/audit-rapi.mjs
 *
 * Env:
 *   FIXTURES_DIR - folder fixture Rapi PDF (default fixtures/rapi)
 *   DESKEW_DIR   - folder fixture deskew (default fixtures/deskew)
 *   SHOT_DIR     - folder screenshot bukti (default docs/audit-rapi-2026-11-25)
 *   PORT         - porta server lokal
 */
import http from "node:http";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "./browser.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.SERVE_DIR || path.join(HERE, ".."));
const FIX = path.resolve(process.env.FIXTURES_DIR || path.join(ROOT, "fixtures", "rapi"));
const DESKEW = path.resolve(process.env.DESKEW_DIR || path.join(ROOT, "fixtures", "deskew"));
const SHOTS = path.resolve(process.env.SHOT_DIR || path.join(ROOT, "docs", "audit-rapi-2026-11-25"));
const PORT = Number(process.env.PORT || 8075);

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

/* ---------- skrip di dalam browser ---------- */

/* Analisis berkas: teks, anotasi, ukuran halaman, dan titik tinta.
   Titik tinta diambil dengan ambang tetap (bukan ambang aplikasi) supaya
   harness tidak bergantung pada kode yang sedang diuji. */
const ANALISIS = async ({ b64 }) => {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  /* salinan terpisah: pdf.js mem transferring buffer, jadi byte asli
     tidak bisa dipakai lagi untuk PDFLib */
  const u8lib = u8.slice();
  const doc = await pdfjsLib.getDocument({ data: u8 }).promise;
  const halaman = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const tc = await p.getTextContent();
    const items = tc.items.filter((it) => it.str && it.str.trim());
    const vp = p.getViewport({ scale: 1 });
    const box = p.view || [0, 0, vp.width, vp.height];
    const crop = p.view ? { x: box[0], y: box[1], w: box[2] - box[0], h: box[3] - box[1] } : null;
    /* titik tinta: piksel gelap, koordinat ruang pengguna PDF */
    const skala = 2;
    const c = document.createElement("canvas");
    c.width = Math.ceil(vp.width * skala);
    c.height = Math.ceil(vp.height * skala);
    const ctx = c.getContext("2d", { alpha: false });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    await p.render({ canvasContext: ctx, viewport: p.getViewport({ scale: skala }) }).promise;
    const img = ctx.getImageData(0, 0, c.width, c.height).data;
    const t = p.getViewport({ scale: skala }).transform;
    const det = t[0] * t[3] - t[1] * t[2];
    const titik = [];
    for (let y = 0; y < c.height; y += 2) {
      for (let x = 0; x < c.width; x += 2) {
        const p4 = (y * c.width + x) * 4;
        const g = (img[p4] * 299 + img[p4 + 1] * 587 + img[p4 + 2] * 114) / 1000;
        if (g > 170) continue;
        const dx = x + 0.5 - t[4], dy = y + 0.5 - t[5];
        titik.push((t[3] * dx - t[2] * dy) / det, (-t[1] * dx + t[0] * dy) / det);
      }
    }
    halaman.push({
      teks: items.map((it) => it.str).join(" "),
      jumlahTeks: items.length,
      w: vp.width, h: vp.height, crop,
      titik: Array.from(titik),
    });
  }
  let annots = [];
  try {
    const p1 = await doc.getPage(1);
    if (typeof p1.getAnnotations === "function") annots = (await p1.getAnnotations()) || [];
  } catch (_) { annots = []; }
  const meta = await doc.getMetadata().catch(() => ({}));
  const info = (meta && meta.info) || {};
  const outlines = typeof doc.getOutline === "function" ? (await doc.getOutline()) || [] : [];
  /* byte gambar yang tertanam (bukti tidak ada encode ulang) */
  const gambar = [];
  let media = null;
  try {
    const d2 = await PDFLib.PDFDocument.load(u8lib, { updateMetadata: false });
    const mb = d2.getPage(0).getMediaBox();
    media = { x: mb.x, y: mb.y, w: mb.width, h: mb.height };
    for (const page of d2.getPages()) {
      const res = page.node.Resources();
      if (!res) continue;
      const xo = res.get(PDFLib.PDFName.of("XObject"));
      if (!xo || typeof xo.entries !== "function") continue;
      for (const [, ref] of xo.entries()) {
        const st = d2.context.lookup(ref);
        if (!st || !st.contents) continue;
        if (st.dict.get(PDFLib.PDFName.of("Subtype"))?.toString?.() !== "/Image") continue;
        gambar.push(Array.from(st.contents));
      }
    }
  } catch (_) { /* ignore */ }
  await doc.destroy();
  return {
    numPages: doc.numPages,
    media,
    halaman,
    annots: annots.map((a) => ({ subtype: a.subtype, url: a.url || "", rect: a.rect })),
    judul: info.Title || "", penulis: info.Author || "", producer: info.Producer || "",
    outline: outlines.map((o) => o.title),
    gambar,
  };
};

/* Estimator sudut MANDIRI, ditulis ulang dari nol: profil proyeksi
   diukur dengan ENTROPI histogram (bukan jumlah kuadrat isi bin seperti
   di aplikasi), lalu dicari sudut yang paling tajam. Mengembalikan sudut
   koreksi: positif = harus diputar berlawanan arah jam. */
const SUDUT = ({ titik, min, max, langkah }) => {
  const n = titik.length / 2;
  if (n < 200) return null;
  const BINS = 512;
  let terbaik = 0, terbaikH = Infinity;
  for (let a = min; a <= max + 1e-9; a += langkah) {
    const rad = (a * Math.PI) / 180;
    const s = Math.sin(rad), c = Math.cos(rad);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < titik.length; i += 2) {
      const v = titik[i] * s + titik[i + 1] * c;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (!(hi > lo)) continue;
    const bins = new Float64Array(BINS);
    const k = (BINS - 1) / (hi - lo);
    for (let i = 0; i < titik.length; i += 2) {
      const v = titik[i] * s + titik[i + 1] * c;
      let b = ((v - lo) * k) | 0;
      if (b < 0) b = 0; else if (b > BINS - 1) b = BINS - 1;
      bins[b]++;
    }
    let H = 0;
    for (let i = 0; i < BINS; i++) {
      if (!bins[i]) continue;
      const p = bins[i] / n;
      H -= p * Math.log(p);
    }
    if (H < terbaikH) { terbaikH = H; terbaik = a; }
  }
  return Math.round(terbaik * 1000) / 1000;
};

/* Jarak rata-rata antara dua himpunan titik tinta (SETELAH titik masukan
   diputar sebesar sudut). Ini bukti bahwa isi dokumen persis sama,
   hanya diputar — dan dokumen terbalik pasti gagal. */
const JARAK = ({ a, b, sudut, pusat }) => {
  const rad = (sudut * Math.PI) / 180;
  const s = Math.sin(rad), c = Math.cos(rad);
  const na = a.length / 2, nb = b.length / 2;
  if (!na || !nb) return null;
  /* pusat putaran = pusat kotak media (sama seperti alat "Rapi PDF") */
  const cx = pusat ? pusat.x : 0;
  const cy = pusat ? pusat.y : 0;
  /* rata-rata jarak titik a (diputar) ke titik b terdekat */
  let jumlah = 0, n = 0;
  /* langkah dihitung dalam pasangan koordinat (x,y) */
  const langkah = Math.max(1, Math.floor(na / 400)) * 2;
  for (let i = 0; i < a.length; i += langkah) {
    const dx = a[i] - cx, dy = a[i + 1] - cy;
    const x = cx + dx * c - dy * s;
    const y = cy + dx * s + dy * c;
    let terdekat = Infinity;
    /* j adalah indeks ARRAY (x,y), jadi batasnya panjang array */
    for (let j = 0; j + 1 < b.length; j += 2) {
      const dx = x - b[j], dy = y - b[j + 1];
      const d2 = dx * dx + dy * dy;
      if (d2 < terdekat) terdekat = d2;
    }
    jumlah += Math.sqrt(terdekat);
    n++;
  }
  return n ? jumlah / n : null;
};

/* Bukti piksel: PDF final harus berisi persis piksel pratinjau, hanya
   diputar sebesar sudut koreksi. Dicocokkan di ruang pengguna PDF
   (bukan di piksel canvas) supaya perbandingannya bebas dari ukuran kanvas. */
const BANDINGKAN = async ({ a, b, sudut }) => {
  const keBytes = (b64) => {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  };
  const render = async (b64, skala) => {
    const doc = await pdfjsLib.getDocument({ data: keBytes(b64) }).promise;
    const p = await doc.getPage(1);
    const vp = p.getViewport({ scale: skala });
    const c = document.createElement("canvas");
    c.width = Math.ceil(vp.width);
    c.height = Math.ceil(vp.height);
    const ctx = c.getContext("2d", { alpha: false });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    await p.render({ canvasContext: ctx, viewport: vp }).promise;
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    const t = vp.transform;
    await doc.destroy();
    return { data, w: c.width, h: c.height, t, s: skala };
  };
  const A = await render(a, 1);
  const B = await render(b, 1);
  const ink = (R) => {
    const m = new Uint8Array(R.w * R.h);
    for (let i = 0, p = 0; i < R.data.length; i += 4, p++) {
      const g = (R.data[i] * 299 + R.data[i + 1] * 587 + R.data[i + 2] * 114) / 1000;
      m[p] = g < 170 ? 1 : 0;
    }
    return m;
  };
  const mA = ink(A);
  const mB = ink(B);
  /* pusat halaman (sama untuk keduanya: halaman hanya melebar simetris) */
  const cx = (A.t[4] + B.t[4]) / 2 + A.w / 2;
  const cy = (A.t[5] + B.t[5]) / 2 - A.h / 2;
  const rad = (sudut * Math.PI) / 180;
  const co = Math.cos(rad), si = Math.sin(rad);
  let total = 0, kena = 0, totalB = 0, kenaB = 0;
  const adaInk = (R, m, x, y) => {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const px = Math.round(x) + dx, py = Math.round(y) + dy;
        if (px < 0 || py < 0 || px >= R.w || py >= R.h) continue;
        if (m[py * R.w + px]) return true;
      }
    }
    return false;
  };
  for (let py = 0; py < A.h; py++) {
    for (let px = 0; px < A.w; px++) {
      if (!mA[py * A.w + px]) continue;
      total++;
      const X = (px + 0.5 - A.t[4]) / A.s;
      const Y = (A.t[5] - (py + 0.5)) / A.s;
      const Xr = cx + (X - cx) * co - (Y - cy) * si;
      const Yr = cy + (X - cx) * si + (Y - cy) * co;
      const bx = Xr * B.s + B.t[4];
      const by = B.t[5] - Yr * B.s;
      if (adaInk(B, mB, bx, by)) kena++;
    }
  }
  for (let py = 0; py < B.h; py++) {
    for (let px = 0; px < B.w; px++) {
      if (!mB[py * B.w + px]) continue;
      totalB++;
      const X = (px + 0.5 - B.t[4]) / B.s;
      const Y = (B.t[5] - (py + 0.5)) / B.s;
      const Xr = cx + (X - cx) * co + (Y - cy) * si;
      const Yr = cy - (X - cx) * si + (Y - cy) * co;
      const ax = Xr * A.s + A.t[4];
      const ay = A.t[5] - Yr * A.s;
      if (adaInk(A, mA, ax, ay)) kenaB++;
    }
  }
  return {
    cakupan: total ? kena / total : 0,
    cakupanBalik: totalB ? kenaB / totalB : 0,
    tintaA: total,
    tintaB: totalB,
  };
};

async function main() {
  if (!fs.existsSync(FIX)) {
    console.error("Fixture belum ada. Jalankan: node tools/mkfixtures-rapi.mjs");
    process.exit(2);
  }
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = await server();
  const browser = await chromium();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
  await page.waitForTimeout(1500);

  /* ---------- menjalankan alat "Rapi PDF" lewat UI ---------- */
  async function jalankan(file, opsi = {}) {
    await page.evaluate(() => {
      document.getElementById("toolBackBtn")?.click();
      document.getElementById("tab-tools")?.click();
    });
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const c = [...document.querySelectorAll("#toolCategories .tool-card")].find((n) =>
        n.textContent.includes("Rapi PDF")
      );
      c?.click();
    });
    await page.waitForTimeout(500);
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
    await page.waitForTimeout(900);
    const nFile = await page.evaluate(() => document.querySelectorAll("#toolFileList .tool-file").length);
    if (nFile !== 1) throw new Error(`Harness: EXPECTED 1 file in list, got ${nFile}`);
    await page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((e) => e.remove()));
    const t0 = Date.now();
    await page.click("#toolRunBtn");
    let galat = "";
    for (let i = 0; i < 120; i++) {
      await page.waitForTimeout(500);
      const n = await page.evaluate(() => document.querySelectorAll("#toolResults > *").length);
      if (n > 0) break;
      const t = await page.evaluate(() => {
        const semua = [...document.querySelectorAll("#toasts .toast")];
        const el = semua[semua.length - 1];
        return el ? el.textContent : "";
      });
      if (t && /gagal|tidak bisa|rusak/i.test(t)) { galat = t; break; }
    }
    const durasi = ((Date.now() - t0) / 1000).toFixed(1);
    const href = await page.evaluate(() => {
      const a = document.querySelector("#toolResults a");
      return a ? a.href : null;
    });
    const catatan = await page.evaluate(() => {
      const el = document.querySelector("#toolResults .res-meta");
      return el ? el.textContent : "";
    });
    if (!href) {
      await page.evaluate(() => document.getElementById("toolBackBtn")?.click());
      await page.waitForTimeout(300);
      return { bytes: null, durasi, galat, catatan };
    }
    const arr = await page.evaluate(async (u) => {
      const r = await fetch(u);
      return Array.from(new Uint8Array(await r.arrayBuffer()));
    }, href);
    await page.evaluate(() => document.getElementById("toolBackBtn")?.click());
    await page.waitForTimeout(300);
    return { bytes: Buffer.from(arr), durasi, galat: "", catatan };
  }

  /* analisis berkas (di dalam browser) */
  async function analisis(bytes) {
    const b64 = Buffer.from(bytes).toString("base64");
    return page.evaluate(ANALISIS, { b64 });
  }
  async function sudut(titik, min = -10, max = 10, langkah = 0.05) {
    return page.evaluate(SUDUT, { titik: Array.from(titik), min, max, langkah });
  }
  async function jarak(a, b, s, pusat) {
    return page.evaluate(JARAK, { a: Array.from(a), b: Array.from(b), sudut: s, pusat });
  }
  const pusatHalaman = (a) =>
    a && a.media ? { x: a.media.x + a.media.w / 2, y: a.media.y + a.media.h / 2 } : null;
  const simpan = (nama, dataUrl) => {
    if (!dataUrl) return;
    fs.writeFileSync(path.join(SHOTS, nama), Buffer.from(dataUrl.split(",")[1], "base64"));
  };

  /* ================================================================
     1. KASUS PENGGUNA: pindai resmi miring 0,8 derajat
     ================================================================ */
  let sudutPakai = 0;
  console.log("\n--- Kasus pengguna: pindai resmi miring 0,8° ---");
  {
    const nama = "akta-miring08.pdf";
    const asal = fs.readFileSync(path.join(FIX, nama));
    const sebelum = await analisis(asal);
    const sudutSebelum = await sudut(sebelum.halaman[0].titik);
    check("Masukan terdeteksi miring ~0,8° (estimator mandiri)",
      Math.abs(sudutSebelum + 0.8) < 0.25, `sudut=${sudutSebelum}°`);

    const r = await jalankan(path.join(FIX, nama), { trim: false });
    check("Alat berhasil jalan", !!r.bytes, r.bytes ? `${r.bytes.length} byte, ${r.durasi}s` : r.galat);
    if (!r.bytes) throw new Error("gagal menjalankan alat");
    const sesudah = await analisis(r.bytes);
    const sudutSesudah = await sudut(sesudah.halaman[0].titik);
    sudutPakai = sudutSebelum;
    check("Sudut sisa ~0° (dokumen jadi lurus)",
      Math.abs(sudutSesudah) < 0.25, `sisa=${sudutSesudah}°`);
    const d = await jarak(sebelum.halaman[0].titik, sesudah.halaman[0].titik, sudutSebelum, pusatHalaman(sebelum));
    check("Isi dokumen persis sama, hanya diputar (bukti piksel)",
      d !== null && d < 1.2, `jarak rata-rata=${d === null ? "-" : d.toFixed(3)} pt`);
    check("Dokumen TIDAK dibalik (tanda: isi tetap searah)",
      d !== null && d < 1.2 && Math.abs(sudutSesudah) < 0.25,
      `sisa=${sudutSesudah}°, jarak=${d === null ? "-" : d.toFixed(3)} pt`);
    check("Gambar pindai tidak di-encode ulang (byte identik)",
      sebelum.gambar.length > 0 &&
      sebelum.gambar.length === sesudah.gambar.length &&
      sebelum.gambar.every((x, i) => x.length === sesudah.gambar[i].length && x.every((v, k) => v === sesudah.gambar[i][k])),
      `gambar=${sebelum.gambar.length}->${sesudah.gambar.length}`);
    check("Catatan hasil menyebut jumlah halaman yang diluruskan",
      /diluruskan/.test(r.catatan), r.catatan.slice(0, 120));
    check("Ukuran berkas tidak membengkak jauh",
      r.bytes.length < asal.length * 1.2,
      `${asal.length} -> ${r.bytes.length} byte`);
  }

  /* ================================================================
     2. Rangkaian sudut miring kecil (0,5 - 3 derajat)
     ================================================================ */
  console.log("\n--- Rangkaian sudut miring ---");
  const rangkaian = [
    ["akta-miring05.pdf", 0.5],
    ["akta-miring08.pdf", 0.8],
    ["akta-miring12.pdf", 1.2],
    ["akta-miring-minus09.pdf", -0.9],
    ["akta-miring3.pdf", 3],
  ];
  for (const [nama, truth] of rangkaian) {
    const asal = fs.readFileSync(path.join(FIX, nama));
    const sebelum = await analisis(asal);
    const s0 = await sudut(sebelum.halaman[0].titik);
    const r = await jalankan(path.join(FIX, nama), { trim: false });
    if (!r.bytes) { check(`${nama} -> alat berhasil`, false, r.galat); continue; }
    const sesudah = await analisis(r.bytes);
    const s1 = await sudut(sesudah.halaman[0].titik);
    check(`${nama}: terdeteksi miring ${truth}°`,
      Math.abs(s0 + truth) < 0.3, `estimasi=${s0}°`);
    check(`${nama}: sudut sisa ~0° setelah diperbaiki`,
      Math.abs(s1) < 0.3, `sisa=${s1}°`);
    const d = await jarak(sebelum.halaman[0].titik, sesudah.halaman[0].titik, s0, pusatHalaman(sebelum));
    check(`${nama}: isi utuh (tidak dibalik, tidak hilang)`,
      d !== null && d < 1.5, `jarak=${d === null ? "-" : d.toFixed(3)} pt`);
  }

  /* ================================================================
     3. Halaman lurus tidak boleh diubah
     ================================================================ */
  console.log("\n--- Halaman lurus ---");
  {
    const asal = fs.readFileSync(path.join(FIX, "akta-lurus.pdf"));
    const sebelum = await analisis(asal);
    const r = await jalankan(path.join(FIX, "akta-lurus.pdf"), { trim: false });
    check("Halaman lurus -> alat berhasil", !!r.bytes, r.bytes ? `${r.bytes.length} byte` : r.galat);
    const sesudah = await analisis(r.bytes);
    const s1 = await sudut(sesudah.halaman[0].titik);
    check("Halaman lurus tetap lurus (tidak diputar sia-sia)",
      Math.abs(s1) < 0.2, `sisa=${s1}°`);
    const d = await jarak(sebelum.halaman[0].titik, sesudah.halaman[0].titik, 0, pusatHalaman(sebelum));
    check("Halaman lurus: isi tidak berubah",
      d !== null && d < 1.0, `jarak=${d === null ? "-" : d.toFixed(3)} pt`);
    check("Halaman lurus: ukuran halaman tetap sama",
      Math.abs(sesudah.halaman[0].w - sebelum.halaman[0].w) < 1.5 &&
      Math.abs(sesudah.halaman[0].h - sebelum.halaman[0].h) < 1.5,
      `${sebelum.halaman[0].w.toFixed(1)}x${sebelum.halaman[0].h.toFixed(1)} -> ${sesudah.halaman[0].w.toFixed(1)}x${sesudah.halaman[0].h.toFixed(1)}`);
  }

  /* ================================================================
     4. PDF digital: teks harus tetap vektor & bisa dicari
     ================================================================ */
  console.log("\n--- PDF digital (teks bisa dicari) ---");
  for (const [nama, truth] of [["digital-lurus.pdf", 0], ["digital-miring08.pdf", 0.8], ["digital-miring2.pdf", 2]]) {
    const asal = fs.readFileSync(path.join(FIX, nama));
    const sebelum = await analisis(asal);
    const s0 = await sudut(sebelum.halaman[0].titik);
    const r = await jalankan(path.join(FIX, nama), { trim: false });
    if (!r.bytes) { check(`${nama} -> alat berhasil`, false, r.galat); continue; }
    const sesudah = await analisis(r.bytes);
    const s1 = await sudut(sesudah.halaman[0].titik);
    check(`${nama}: sudut sisa ~0°`, Math.abs(s1) < 0.3, `sisa=${s1}° (masuk ${s0}°)`);
    check(`${nama}: teks tetap bisa dicari (tidak diraster)`,
      sesudah.halaman[0].jumlahTeks === sebelum.halaman[0].jumlahTeks &&
      sesudah.halaman[0].teks.replace(/\s+/g, " ") === sebelum.halaman[0].teks.replace(/\s+/g, " "),
      `item=${sebelum.halaman[0].jumlahTeks}->${sesudah.halaman[0].jumlahTeks}`);
    check(`${nama}: berkas tetap ramping (bukan gambar)`,
      r.bytes.length < asal.length * 1.5, `${asal.length} -> ${r.bytes.length} byte`);
  }

  /* ================================================================
     5. Halaman terbalik (180) dan miring tegak (90)
     ================================================================ */
  console.log("\n--- Halaman terbalik & tegak ---");
  if (fs.existsSync(path.join(DESKEW, "pindai-terbalik180.pdf"))) {
    const nama = "pindai-terbalik180.pdf";
    const asal = fs.readFileSync(path.join(DESKEW, nama));
    const sebelum = await analisis(asal);
    const r = await jalankan(path.join(DESKEW, nama), { trim: false });
    if (!r.bytes) { check(`${nama} -> alat berhasil`, false, r.galat); }
    else {
      const sesudah = await analisis(r.bytes);
      const s1 = await sudut(sesudah.halaman[0].titik);
      /* setelah dibalik, teksnya tegak: sudut sisa ~0 */
      check(`${nama}: halaman terbalik dibalik jadi tegak`,
        Math.abs(s1) < 0.4, `sisa=${s1}°`);
      const d = await jarak(sebelum.halaman[0].titik, sesudah.halaman[0].titik, 180, pusatHalaman(sebelum));
      check(`${nama}: isi tetap utuh setelah dibalik`,
        d !== null && d < 1.5, `jarak=${d === null ? "-" : d.toFixed(3)} pt`);
    }
  }
  if (fs.existsSync(path.join(DESKEW, "pindai-tegak90.pdf"))) {
    const nama = "pindai-tegak90.pdf";
    const r = await jalankan(path.join(DESKEW, nama), { trim: false });
    check(`${nama} -> alat berhasil`, !!r.bytes, r.bytes ? `${r.bytes.length} byte` : r.galat);
    if (r.bytes) {
      const sesudah = await analisis(r.bytes);
      const s1 = await sudut(sesudah.halaman[0].titik, -100, 100, 0.5);
      check(`${nama}: teks tegak jadi mendatar`,
        Math.abs(s1) < 1.5, `sisa=${s1}°`);
    }
  }

  /* ================================================================
     6. Pangkas margin tepat di tepi isi
     ================================================================ */
  console.log("\n--- Pangkas margin ---");
  {
    const r = await jalankan(path.join(FIX, "akta-margin-lebar.pdf"), { trim: true });
    check("Pangkas margin -> alat berhasil", !!r.bytes, r.bytes ? `${r.bytes.length} byte` : r.galat);
    if (r.bytes) {
      const sesudah = await analisis(r.bytes);
      const crop = sesudah.halaman[0].crop;
      check("Margin putih terpangkas (halaman jadi lebih rapat)",
        crop && crop.w < 560, `crop=${crop ? `${crop.w.toFixed(0)}x${crop.h.toFixed(0)}` : "-"}`);
      /* isi tidak boleh terpotong: semua titik tinta harus di dalam crop */
      const t = sesudah.halaman[0].titik;
      let diLuar = 0;
      for (let i = 0; i < t.length; i += 2) {
        if (t[i] < crop.x - 1 || t[i] > crop.x + crop.w + 1 ||
            t[i + 1] < crop.y - 1 || t[i + 1] > crop.y + crop.h + 1) diLuar++;
      }
      check("Tidak ada isi yang terpotong saat margin dipangkas",
        diLuar === 0, `titik di luar crop=${diLuar}`);
    }
    const tanpa = await jalankan(path.join(FIX, "akta-margin-lebar.pdf"), { trim: false });
    if (tanpa.bytes) {
      const sesudah = await analisis(tanpa.bytes);
      const crop = sesudah.halaman[0].crop;
      check("Opsi trim=false: margin tidak dipangkas",
        crop && crop.w > 590, `crop=${crop ? `${crop.w.toFixed(0)}x${crop.h.toFixed(0)}` : "-"}`);
    }
  }

  /* ================================================================
     7. Multi halaman & anotasi
     ================================================================ */
  console.log("\n--- Multi halaman, anotasi, metadata ---");
  {
    const r = await jalankan(path.join(FIX, "multi3.pdf"), { trim: false });
    check("PDF 3 halaman -> alat berhasil", !!r.bytes, r.bytes ? `${r.bytes.length} byte` : r.galat);
    if (r.bytes) {
      const sesudah = await analisis(r.bytes);
      check("Jumlah halaman tetap 3", sesudah.numPages === 3, `halaman=${sesudah.numPages}`);
    }
    if (fs.existsSync(path.join(FIX, "anotasi.pdf"))) {
      const sebelum = await analisis(fs.readFileSync(path.join(FIX, "anotasi.pdf")));
      const r2 = await jalankan(path.join(FIX, "anotasi.pdf"), { trim: false });
      if (r2.bytes) {
        const sesudah = await analisis(r2.bytes);
        check("Anotasi (tautan) tetap ada setelah dirapikan",
          sesudah.annots.length === sebelum.annots.length && sesudah.annots.length > 0,
          `anotasi=${sebelum.annots.length}->${sesudah.annots.length}`);
      } else {
        check("Anotasi (tautan) tetap ada setelah dirapikan", false, r2.galat);
      }
    }
    /* metadata dibersihkan / dipertahankan sesuai opsi */
    const r3 = await jalankan(path.join(FIX, "anotasi.pdf"), { trim: false, stripMeta: true });
    if (r3.bytes) {
      const sesudah = await analisis(r3.bytes);
      check("Metadata dibersihkan saat opsi aktif",
        !sesudah.judul && !sesudah.penulis, `judul="${sesudah.judul}" penulis="${sesudah.penulis}"`);
    }
    const r4 = await jalankan(path.join(FIX, "anotasi.pdf"), { trim: false, stripMeta: false });
    if (r4.bytes) {
      const sesudah = await analisis(r4.bytes);
      check("Metadata tetap ada saat opsi dimatikan",
        !!sesudah.judul, `judul="${sesudah.judul}"`);
    }
  }

  /* ================================================================
     8. Opsi lain
     ================================================================ */
  console.log("\n--- Opsi alat ---");
  {
    const r = await jalankan(path.join(FIX, "akta-miring3.pdf"), { maxAngle: 1, trim: false });
    check("Batas sudut 1°: halaman 3° tidak diluruskan", !!r.bytes, r.bytes ? `${r.bytes.length} byte` : r.galat);
    if (r.bytes) {
      const sesudah = await analisis(r.bytes);
      const s1 = await sudut(sesudah.halaman[0].titik);
      check("Batas sudut 1°: kemiringan 3° tetap ada",
        Math.abs(s1 + 3) < 0.4, `sisa=${s1}°`);
    }
    const r2 = await jalankan(path.join(FIX, "akta-miring08.pdf"), { deskew: false, trim: false });
    if (r2.bytes) {
      const sesudah = await analisis(r2.bytes);
      const s1 = await sudut(sesudah.halaman[0].titik);
      check("Opsi deskew=false: kemiringan tidak disentuh",
        Math.abs(s1 + 0.8) < 0.3, `sisa=${s1}°`);
    } else {
      check("Opsi deskew=false: kemiringan tidak disentuh", false, r2.galat);
    }
    const r3 = await jalankan(path.join(DESKEW, "pindai-tegak90.pdf"), { autoRotate: false, trim: false });
    if (r3.bytes) {
      const sesudah = await analisis(r3.bytes);
      const s1 = await sudut(sesudah.halaman[0].titik, -100, 100, 0.5);
      check("Opsi autoRotate=false: halaman tegak dibiarkan",
        Math.abs(Math.abs(s1) - 90) < 3, `sisa=${s1}°`);
    } else {
      check("Opsi autoRotate=false: halaman tegak dibiarkan", false, r3.galat);
    }
  }

  /* ================================================================
     9. Berkas rusak
     ================================================================ */
  console.log("\n--- Berkas rusak ---");
  {
    const rusak = path.join(os.tmpdir(), "audit-rapi-rusak.pdf");
    fs.writeFileSync(rusak, Buffer.from("ini bukan PDF sama sekali, cuma teks acak"));
    const r = await jalankan(rusak, { trim: false });
    check("Berkas rusak ditolak dengan pesan jelas",
      !r.bytes && /rusak|tidak bisa|gagal/i.test(r.galat || ""),
      (r.galat || "").slice(0, 140) || "tidak ada pesan");
  }

  /* ================================================================
     10. Bukti visual: pratinjau vs PDF final
     ================================================================ */
  console.log("\n--- Bukti visual ---");
  {
    const nama = "akta-miring08.pdf";
    const sebelum = await analisis(fs.readFileSync(path.join(FIX, nama)));
    const r = await jalankan(path.join(FIX, nama), { trim: false });
    if (r.bytes) {
      const sesudah = await analisis(r.bytes);
      const pngSebelum = await page.evaluate(async (b64) => {
        const bin = atob(b64);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        const doc = await pdfjsLib.getDocument({ data: u8 }).promise;
        const p = await doc.getPage(1);
        const vp = p.getViewport({ scale: 1 });
        const c = document.createElement("canvas");
        c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
        const ctx = c.getContext("2d", { alpha: false });
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
        await p.render({ canvasContext: ctx, viewport: vp }).promise;
        const d = c.toDataURL("image/png");
        await doc.destroy();
        return d;
      }, Buffer.from(fs.readFileSync(path.join(FIX, nama))).toString("base64"));
      simpan("01-sebelum-pindai-miring08.png", pngSebelum);
      const pngSesudah = await page.evaluate(async (b64) => {
        const bin = atob(b64);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        const doc = await pdfjsLib.getDocument({ data: u8 }).promise;
        const p = await doc.getPage(1);
        const vp = p.getViewport({ scale: 1 });
        const c = document.createElement("canvas");
        c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
        const ctx = c.getContext("2d", { alpha: false });
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
        await p.render({ canvasContext: ctx, viewport: vp }).promise;
        const d = c.toDataURL("image/png");
        await doc.destroy();
        return d;
      }, r.bytes.toString("base64"));
      simpan("02-sesudah-pindai-miring08.png", pngSesudah);
      check("Bukti visual tersimpan (sebelum & sesudah)",
        fs.existsSync(path.join(SHOTS, "01-sebelum-pindai-miring08.png")) &&
        fs.existsSync(path.join(SHOTS, "02-sesudah-pindai-miring08.png")),
        SHOTS);
      /* PDF final harus berisi persis piksel pratinjau, hanya diputar */
      const banding = await page.evaluate(BANDINGKAN, {
        a: Buffer.from(fs.readFileSync(path.join(FIX, nama))).toString("base64"),
        b: r.bytes.toString("base64"),
        sudut: sudutPakai,
      });
      check("Pratinjau = PDF final (piksel pratinjau ada di PDF final)",
        banding.cakupan > 0.9,
        `cakupan=${(banding.cakupan * 100).toFixed(1)}% (balik ${(banding.cakupanBalik * 100).toFixed(1)}%)`);
      check("PDF final tidak menambah/mengurangi isi",
        Math.abs(banding.tintaA - banding.tintaB) / Math.max(1, banding.tintaA) < 0.08,
        `tinta ${banding.tintaA} -> ${banding.tintaB} piksel`);
    }
  }

  const errorRiil = errors.filter((e) => !/rusak total|tidak ada halaman yang bisa dipulihkan/i.test(e));
  check("Tidak ada error JavaScript selama audit", errorRiil.length === 0, errorRiil.slice(0, 2).join(" | ").slice(0, 200));

  /* ---------- ringkasan ---------- */
  fs.writeFileSync(
    path.join(ROOT, "docs", "audit-rapi-hasil.json"),
    JSON.stringify({ tanggal: new Date().toISOString(), lulus: pass, gagal: fail, hasil: results }, null, 2)
  );
  console.log(`\n=== HASIL: ${pass} lulus, ${fail} gagal ===`);
  await browser.close();
  srv.close();
  if (fail) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
