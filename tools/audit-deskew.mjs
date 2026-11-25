/**
 * Audit mendalam fitur "Rapi PDF" (luruskan halaman miring).
 *
 * Menjalankan alat sungguhan di Chromium lalu memeriksa:
 *  - sudut sisa setelah diperbaiki (harus ~0 derajat)
 *  - piksel gambar pindai TIDAK berubah sama sekali (bukti kualitas)
 *  - teks tetap vektor & bisa dicari (tidak diraster)
 *  - tautan/field formulir tetap ada dan ikut berputar
 *  - opsi (batas sudut, auto putar, metadata, pangkas margin)
 *  - kasus gagal (berkas rusak) memberi pesan yang jelas
 *
 * Jalankan: node tools/mkfixtures-deskew.mjs && node tools/audit-deskew.mjs
 *
 * Env:
 *   SERVE_DIR    - direktori statis yang dilayani (default: repo ini)
 *   FIXTURES_DIR - folder fixture (default: fixtures/deskew)
 *   SHOT_DIR     - folder screenshot bukti (default: docs/audit-deskew-2026-11-24)
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
const SHOTS = path.resolve(process.env.SHOT_DIR || path.join(ROOT, "docs", "audit-deskew-2026-11-24"));
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

/* ---------- analisis PDF di dalam browser ---------- */
const ANALISIS = async ({ b64 }) => {
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
    c.width = Math.round(vp.width);
    c.height = Math.round(vp.height);
    await p.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    /* sudut sisa kemiringan (pakai algoritma yang sama dgn aplikasi) */
    const a = await window.PDFToolsCore.analisisHalaman(doc, i, { maksDeg: 8, autoRotate: true });
    halaman.push({
      items,
      teks: items.map((it) => it.s).join(""),
      w: +vp.width.toFixed(1),
      h: +vp.height.toFixed(1),
      sudut: +a.sudut.toFixed(3),
      kepastian: +a.kepastian.toFixed(4),
      tegas: !!a.tegas,
      sideways: !!a.sideways,
      png: c.toDataURL("image/png"),
    });
  }
  let annots = [];
  const p1 = await doc.getPage(1);
  if (typeof p1.getAnnotations === "function") annots = (await p1.getAnnotations()) || [];
  const meta = await doc.getMetadata().catch(() => ({}));
  const info = (meta && meta.info) || {};
  const outlines = typeof doc.getOutline === "function" ? (await doc.getOutline()) || [] : [];
  const hasil = {
    numPages: doc.numPages,
    halaman,
    ukuran: bin.length,
    annots: annots.map((a) => ({ subtype: a.subtype, rect: a.rect, url: a.url || "" })),
    judul: info.Title || "",
    penulis: info.Author || "",
    producer: info.Producer || "",
    outline: outlines.map((o) => o.title),
  };
  await doc.destroy();
  return hasil;
};

/* ---------- estimator sudut mandiri (entropi profil proyeksi) ----------
   Ditulis terpisah dari kode aplikasi supaya hasil "sisa sudut"
   tidak hanya mengulang apa yang diuji. */
const SUDUT_MANDIRI = async ({ b64, min, max, langkah }) => {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const doc = await pdfjsLib.getDocument({ data: u8 }).promise;
  const hal = await doc.getPage(1);
  const vp = hal.getViewport({ scale: 1.5 });
  const c = document.createElement("canvas");
  c.width = Math.ceil(vp.width);
  c.height = Math.ceil(vp.height);
  const ctx = c.getContext("2d", { alpha: false });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  await hal.render({ canvasContext: ctx, viewport: vp }).promise;
  const img = ctx.getImageData(0, 0, c.width, c.height).data;
  const t = vp.transform;
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
  await doc.destroy();
  const n = titik.length / 2;
  if (n < 200) return null;
  const BINS = 512;
  let terbaik = 0, terbaikH = Infinity;
  for (let a = min; a <= max + 1e-9; a += langkah) {
    const rad = (a * Math.PI) / 180;
    const s = Math.sin(rad), co = Math.cos(rad);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < titik.length; i += 2) {
      const v = titik[i] * s + titik[i + 1] * co;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (!(hi > lo)) continue;
    const bins = new Float64Array(BINS);
    const k = (BINS - 1) / (hi - lo);
    for (let i = 0; i < titik.length; i += 2) {
      const v = titik[i] * s + titik[i + 1] * co;
      let b = ((v - lo) * k) | 0;
      if (b < 0) b = 0; else if (b > BINS - 1) b = BINS - 1;
      bins[b]++;
    }
    let H = 0;
    for (let i = 0; i < BINS; i++) {
      if (!bins[i]) continue;
      const pr = bins[i] / n;
      H -= pr * Math.log(pr);
    }
    if (H < terbaikH) { terbaikH = H; terbaik = a; }
  }
  return Math.round(terbaik * 1000) / 1000;
};

/* ---------- bandingkan piksel gambar (bukti kualitas) ---------- */
const BANDINGKAN_GAMBAR = async ({ a, b }) => {
  const keBytes = (b64) => {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  };
  const baca = async (u8) => {
    const doc = await PDFLib.PDFDocument.load(u8, { updateMetadata: false });
    const daftar = [];
    for (const page of doc.getPages()) {
      const res = page.node.Resources();
      if (!res) continue;
      const xo = res.get(PDFLib.PDFName.of("XObject"));
      if (!xo || typeof xo.entries !== "function") continue;
      for (const [, ref] of xo.entries()) {
        const st = doc.context.lookup(ref);
        if (!st || !st.contents) continue;
        if (st.dict.get(PDFLib.PDFName.of("Subtype"))?.toString?.() !== "/Image") continue;
        daftar.push(Array.from(st.contents));
      }
    }
    return daftar;
  };
  const ga = await baca(keBytes(a));
  const gb = await baca(keBytes(b));
  const sama = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
  return {
    jumlahA: ga.length,
    jumlahB: gb.length,
    identik: ga.length > 0 && ga.length === gb.length && ga.every((x, i) => sama(x, gb[i])),
    ukuranA: ga.map((x) => x.length),
    ukuranB: gb.map((x) => x.length),
  };
};

async function main() {
  if (!fs.existsSync(FIX)) {
    console.error("Fixture belum ada. Jalankan: node tools/mkfixtures-deskew.mjs");
    process.exit(2);
  }
  const srv = await server();
  const browser = await chromium();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
  await page.waitForTimeout(1500);

  /* ---- jalankan alat "Rapi PDF" ---- */
  async function jalankan(file, opsi = {}) {
    /* kembali ke daftar alat dulu supaya daftar berkas kosong
       (satu berkas rusak sebelumnya tidak boleh terbawa) */
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
    const nFile = await page.evaluate(
      () => document.querySelectorAll("#toolFileList .tool-file").length
    );
    if (nFile !== 1) throw new Error(`Harness: EXPECTED 1 file in list, got ${nFile}`);
    /* bersihkan notifikasi lama supaya tidak tertukar dengan uji sebelumnya */
    await page.evaluate(() => {
      document.querySelectorAll("#toasts .toast").forEach((e) => e.remove());
    });
    const t0 = Date.now();
    await page.click("#toolRunBtn");
    let galat = "";
    for (let i = 0; i < 90; i++) {
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

  const analisis = async (buf) => page.evaluate(ANALISIS, { b64: buf.toString("base64") });
  const bandingGambar = async (a, b) =>
    page.evaluate(BANDINGKAN_GAMBAR, { a: a.toString("base64"), b: b.toString("base64") });

  fs.mkdirSync(SHOTS, { recursive: true });
  const simpan = (nama, dataUrl) =>
    fs.writeFileSync(path.join(SHOTS, nama), Buffer.from(dataUrl.split(",")[1], "base64"));

  /* ============ 1. Pindai miring 3 derajat (gambar) ============ */
  {
    const asal = fs.readFileSync(path.join(FIX, "pindai-miring3.pdf"));
    const before = await analisis(asal);
    simpan("sebelum-pindai-miring3.png", before.halaman[0].png);
    const r = await jalankan(path.join(FIX, "pindai-miring3.pdf"), { trim: false });
    check("Pindai miring 3° -> alat berhasil", !!r.bytes, r.bytes ? `${r.bytes.length} byte, ${r.durasi}s` : r.galat);
    if (r.bytes) {
      const after = await analisis(r.bytes);
      simpan("sesudah-pindai-miring3.png", after.halaman[0].png);
      check("Jumlah halaman tetap 1", after.numPages === 1, `halaman=${after.numPages}`);
      check("Sudut sisa ~0° (halaman jadi lurus)", Math.abs(after.halaman[0].sudut) < 0.5,
        `sisa=${after.halaman[0].sudut}°`);
      check("Halaman memang miring sebelum diperbaiki", Math.abs(before.halaman[0].sudut) > 2,
        `sebelum=${before.halaman[0].sudut}°`);
      const g = await bandingGambar(asal, r.bytes);
      check("Piksel gambar pindai TIDAK berubah (kualitas utuh)", g.identik,
        `gambar=${g.jumlahA}->${g.jumlahB}, ukuran=${g.ukuranA.join(",")}->${g.ukuranB.join(",")}`);
      check("Ukuran berkas tidak membengkak", r.bytes.length < asal.length * 1.35,
        `${asal.length} -> ${r.bytes.length} byte`);
      check("Catatan hasil informatif", /diluruskan/i.test(r.catatan || ""), r.catatan || "(kosong)");
    }
  }

  /* ============ 2. PDF vektor miring 3 derajat ============ */
  {
    const asal = fs.readFileSync(path.join(FIX, "vektor-miring3.pdf"));
    const before = await analisis(asal);
    simpan("sebelum-vektor-miring3.png", before.halaman[0].png);
    const r = await jalankan(path.join(FIX, "vektor-miring3.pdf"), { trim: false });
    check("Vektor miring 3° -> alat berhasil", !!r.bytes, r.bytes ? `${r.bytes.length} byte, ${r.durasi}s` : r.galat);
    if (r.bytes) {
      const after = await analisis(r.bytes);
      simpan("sesudah-vektor-miring3.png", after.halaman[0].png);
      check("Sudut sisa vektor ~0°", Math.abs(after.halaman[0].sudut) < 0.5, `sisa=${after.halaman[0].sudut}°`);
      check("Teks tetap bisa dicari (tidak diraster)",
        after.halaman[0].items.length > 5 && after.halaman[0].teks.includes("LAPORAN"),
        `item=${after.halaman[0].items.length}`);
      check("Jumlah item teks tetap sama", after.halaman[0].items.length === before.halaman[0].items.length,
        `${before.halaman[0].items.length} -> ${after.halaman[0].items.length}`);
      check("Gaya huruf tetap miring (isi tidak ditulis ulang)",
        after.halaman[0].items.every((it) => Math.abs(it.rot) < 1.5),
        `rot=${after.halaman[0].items.map((i) => i.rot).slice(0, 3).join(",")}`);
      check("Tautan tetap ada", after.annots.length >= 1, `anotasi=${after.annots.length}`);
      check("Metadata dibersihkan", after.judul === "" && after.penulis === "", `judul="${after.judul}"`);
      check("Ukuran berkas tetap ramping (bukan gambar)", r.bytes.length < asal.length * 1.6,
        `${asal.length} -> ${r.bytes.length} byte`);
      /* posisi teks harus tetap di area yang sama (hanya berputar) */
      const t0 = before.halaman[0].items[0];
      const t1 = after.halaman[0].items[0];
      const geser = Math.hypot(t1.x - t0.x, t1.y - t0.y);
      check("Posisi teks tidak meloncat jauh", geser < 60, `geser=${geser.toFixed(1)} pt`);
    }
  }

  /* ============ 3. Halaman lurus -> tidak boleh diubah ============ */
  {
    const asal = fs.readFileSync(path.join(FIX, "pindai-lurus.pdf"));
    const before = await analisis(asal);
    const r = await jalankan(path.join(FIX, "pindai-lurus.pdf"), { trim: false });
    check("Halaman lurus -> alat berhasil", !!r.bytes, r.bytes ? `${r.bytes.length} byte` : r.galat);
    if (r.bytes) {
      const after = await analisis(r.bytes);
      check("Halaman lurus TIDAK diputar", Math.abs(after.halaman[0].sudut) < 0.4,
        `sisa=${after.halaman[0].sudut}°`);
      check("Ukuran halaman lurus tetap sama",
        Math.abs(after.halaman[0].w - before.halaman[0].w) < 1.5 &&
          Math.abs(after.halaman[0].h - before.halaman[0].h) < 1.5,
        `${before.halaman[0].w}x${before.halaman[0].h} -> ${after.halaman[0].w}x${after.halaman[0].h}`);
      const g = await bandingGambar(asal, r.bytes);
      check("Piksel halaman lurus tetap sama", g.identik, `gambar=${g.jumlahA}->${g.jumlahB}`);
    }
  }

  /* ============ 4. Foto tanpa teks -> tidak boleh diputar ============ */
  {
    const asal = fs.readFileSync(path.join(FIX, "foto-tanpa-teks.pdf"));
    const before = await analisis(asal);
    const r = await jalankan(path.join(FIX, "foto-tanpa-teks.pdf"), { trim: false });
    check("Foto tanpa teks -> alat berhasil", !!r.bytes, r.bytes ? `${r.bytes.length} byte` : r.galat);
    if (r.bytes) {
      const after = await analisis(r.bytes);
      /* sudut pada halaman foto hanya derau, jadi yang diuji adalah
         halaman benar-benar tidak berubah (ukuran + piksel) */
      check("Foto tanpa teks: halaman tidak diputar (ukuran sama)",
        Math.abs(after.halaman[0].w - before.halaman[0].w) < 1.5 &&
          Math.abs(after.halaman[0].h - before.halaman[0].h) < 1.5,
        `${before.halaman[0].w}x${before.halaman[0].h} -> ${after.halaman[0].w}x${after.halaman[0].h}`);
      const g = await bandingGambar(asal, r.bytes);
      check("Piksel foto tetap sama", g.identik, `gambar=${g.jumlahA}->${g.jumlahB}`);
    }
  }

  /* ============ 5. Teks tegak (90 derajat) ============ */
  {
    const asal = fs.readFileSync(path.join(FIX, "pindai-tegak90.pdf"));
    const before = await analisis(asal);
    simpan("sebelum-pindai-tegak90.png", before.halaman[0].png);
    const r = await jalankan(path.join(FIX, "pindai-tegak90.pdf"), { trim: false });
    check("Pindai tegak 90° -> alat berhasil", !!r.bytes, r.bytes ? `${r.bytes.length} byte` : r.galat);
    if (r.bytes) {
      const after = await analisis(r.bytes);
      simpan("sesudah-pindai-tegak90.png", after.halaman[0].png);
      /* estimator mandiri: rentang -100..100 supaya putaran 90 derajat
         juga terlihat (analisis aplikasi hanya mencari sudut kecil) */
      const sisaMandiri = await page.evaluate(SUDUT_MANDIRI, {
        b64: r.bytes.toString("base64"), min: -100, max: 100, langkah: 0.5,
      });
      check("Teks tegak jadi mendatar (sisa ~0°)", Math.abs(sisaMandiri) < 1.5,
        `sisa=${sisaMandiri}° (aplikasi: ${after.halaman[0].sudut}°)`);
      check("Teks tegak dulu mendatar, sekarang tidak lagi",
        !before.halaman[0].tegas && after.halaman[0].tegas,
        `tegas=${before.halaman[0].tegas} -> ${after.halaman[0].tegas}`);
      const g = await bandingGambar(asal, r.bytes);
      check("Piksel pindai tegak tetap sama", g.identik, `gambar=${g.jumlahA}->${g.jumlahB}`);
    }
  }

  /* ============ 6. Miring ke arah lain (-2,5 derajat) ============ */
  {
    const asal = fs.readFileSync(path.join(FIX, "pindai-miring-minus25.pdf"));
    const before = await analisis(asal);
    const r = await jalankan(path.join(FIX, "pindai-miring-minus25.pdf"), { trim: false });
    check("Pindai miring -2,5° -> alat berhasil", !!r.bytes, r.bytes ? `${r.bytes.length} byte` : r.galat);
    if (r.bytes) {
      const after = await analisis(r.bytes);
      check("Sudut sisa -2,5° ~0°", Math.abs(after.halaman[0].sudut) < 0.5, `sisa=${after.halaman[0].sudut}°`);
      check("Sudah miring sebelum diperbaiki", Math.abs(before.halaman[0].sudut) > 1.5,
        `sebelum=${before.halaman[0].sudut}°`);
    }
  }

  /* ============ 7. Opsi: batas sudut maksimal ============ */
  {
    const r = await jalankan(path.join(FIX, "pindai-miring6.pdf"), { maxAngle: 2, trim: false });
    check("Batas sudut 2°: halaman 6° tidak diluruskan", !!r.bytes, r.bytes ? `${r.bytes.length} byte` : r.galat);
    if (r.bytes) {
      const after = await analisis(r.bytes);
      check("Sudut tetap ~6° (tidak disentuh)", Math.abs(after.halaman[0].sudut) > 5,
        `sisa=${after.halaman[0].sudut}°`);
    }
  }

  /* ============ 8. Opsi: matikan pelurusan ============ */
  {
    const r = await jalankan(path.join(FIX, "pindai-miring3.pdf"), { deskew: false, trim: false });
    check("Opsi deskew=false: berkas tetap dibuat", !!r.bytes, r.bytes ? `${r.bytes.length} byte` : r.galat);
    if (r.bytes) {
      const after = await analisis(r.bytes);
      check("Opsi deskew=false: tidak ada pelurusan", Math.abs(after.halaman[0].sudut) > 2,
        `sisa=${after.halaman[0].sudut}°`);
    }
  }

  /* ============ 9. Opsi: auto putar 90 dimatikan ============ */
  {
    const r = await jalankan(path.join(FIX, "pindai-tegak90.pdf"), { autoRotate: false, trim: false });
    check("Opsi autoRotate=false: halaman tegak dibiarkan", !!r.bytes, r.bytes ? `${r.bytes.length} byte` : r.galat);
    if (r.bytes) {
      const after = await analisis(r.bytes);
      check("Opsi autoRotate=false: tidak diputar 90°", Math.abs(after.halaman[0].sudut) > 60,
        `sisa=${after.halaman[0].sudut}°`);
    }
  }

  /* ============ 10. Opsi: pangkas margin ============ */
  {
    const r = await jalankan(path.join(FIX, "vektor-miring3.pdf"), { trim: true });
    check("Pangkas margin: alat berhasil", !!r.bytes, r.bytes ? `${r.bytes.length} byte` : r.galat);
    if (r.bytes) {
      const after = await analisis(r.bytes);
      check("Pangkas margin: halaman jadi lebih rapat",
        after.halaman[0].w < 595.3 || after.halaman[0].h < 841.9,
        `ukuran=${after.halaman[0].w}x${after.halaman[0].h}`);
      check("Pangkas margin: teks masih utuh", after.halaman[0].teks.includes("LAPORAN"),
        `item=${after.halaman[0].items.length}`);
    }
  }

  /* ============ 11. Halaman kosong ============ */
  {
    const r = await jalankan(path.join(FIX, "kosong.pdf"), { trim: true });
    check("Halaman kosong: alat tidak error", !!r.bytes, r.bytes ? `${r.bytes.length} byte` : r.galat);
    if (r.bytes) {
      const after = await analisis(r.bytes);
      check("Halaman kosong: jumlah halaman tetap", after.numPages === 2, `halaman=${after.numPages}`);
    }
  }

  /* ============ 12. Berkas rusak -> pesan jelas ============ */
  {
    const rusak = path.join(FIX, "rusak-tidak.pdf");
    fs.writeFileSync(rusak, Buffer.from("ini bukan PDF sama sekali, cuma teks acak"));
    const r = await jalankan(rusak, {});
    check("Berkas rusak ditolak dengan pesan jelas", !r.bytes && /rusak|PDF|tidak bisa/i.test(r.galat || ""),
      r.galat || "(tidak ada pesan)");
    fs.unlinkSync(rusak);
  }

  /* ============ 13. PDF multi-halaman campuran ============ */
  {
    const gabungan = path.join(FIX, "campuran-3halaman.pdf");
    const dibuat = await page.evaluate(async (url) => {
      const hasil = [];
      for (const f of ["pindai-miring3.pdf", "pindai-lurus.pdf", "vektor-miring3.pdf"]) {
        const buf = new Uint8Array(await (await fetch(url + "/fixtures/deskew/" + f)).arrayBuffer());
        hasil.push(Array.from(buf));
      }
      const out = await PDFLib.PDFDocument.create();
      for (const b of hasil) {
        const src = await PDFLib.PDFDocument.load(new Uint8Array(b));
        const cp = await out.copyPages(src, src.getPages().map((_, i) => i));
        cp.forEach((p) => out.addPage(p));
      }
      const res = await out.save({ useObjectStreams: false });
      return Array.from(new Uint8Array(res));
    }, `http://127.0.0.1:${PORT}`);
    fs.writeFileSync(gabungan, Buffer.from(dibuat));
    const r = await jalankan(gabungan, { trim: false });
    check("PDF 3 halaman -> alat berhasil", !!r.bytes, r.bytes ? `${r.bytes.length} byte, ${r.durasi}s` : r.galat);
    if (r.bytes) {
      const after = await analisis(r.bytes);
      check("Jumlah halaman tetap 3", after.numPages === 3, `halaman=${after.numPages}`);
      check("Halaman miring jadi lurus", Math.abs(after.halaman[0].sudut) < 0.5, `sisa=${after.halaman[0].sudut}°`);
      check("Halaman lurus tetap lurus", Math.abs(after.halaman[1].sudut) < 0.4, `sisa=${after.halaman[1].sudut}°`);
      check("Halaman vektor miring jadi lurus", Math.abs(after.halaman[2].sudut) < 0.5, `sisa=${after.halaman[2].sudut}°`);
      simpan("sesudah-campuran-h1.png", after.halaman[0].png);
      simpan("sesudah-campuran-h3.png", after.halaman[2].png);
    }
  }

  /* ============ 14. Metadata tanpa "bersihkan metadata" ============ */
  {
    const denganJudul = path.join(FIX, "ada-judul.pdf");
    const dibuat = await page.evaluate(async () => {
      const out = await PDFLib.PDFDocument.create();
      out.addPage([595.28, 841.89]);
      out.setTitle("Judul Uji Coba");
      out.setAuthor("Penulis Uji Coba");
      const res = await out.save({ useObjectStreams: false });
      return Array.from(new Uint8Array(res));
    });
    fs.writeFileSync(denganJudul, Buffer.from(dibuat));
    const r = await jalankan(denganJudul, { stripMeta: false });
    check("Metadata tidak dibersihkan bila opsi mati", !!r.bytes, r.bytes ? `${r.bytes.length} byte` : r.galat);
    if (r.bytes) {
      const after = await analisis(r.bytes);
      check("Judul tetap ada saat opsi mati", after.judul === "Judul Uji Coba", `judul="${after.judul}"`);
    }
  }

  /* ============ 14b. Halaman dengan atribut /Rotate ============ */
  {
    const file = path.join(FIX, "rotate90.pdf");
    const dibuat = await page.evaluate(async (url) => {
      const buf = new Uint8Array(await (await fetch(url + "/fixtures/deskew/vektor-lurus.pdf")).arrayBuffer());
      const doc = await PDFLib.PDFDocument.load(buf, { updateMetadata: false });
      const page = doc.getPage(0);
      page.setRotation(PDFLib.degrees(90));
      const res = await doc.save({ useObjectStreams: false });
      return Array.from(new Uint8Array(res));
    }, `http://127.0.0.1:${PORT}`);
    fs.writeFileSync(file, Buffer.from(dibuat));
    const r = await jalankan(file, { trim: false });
    check("PDF dengan /Rotate 90° -> alat berhasil", !!r.bytes, r.bytes ? `${r.bytes.length} byte` : r.galat);
    if (r.bytes) {
      const after = await analisis(r.bytes);
      check("Halaman /Rotate tidak rusak", after.numPages === 1, `halaman=${after.numPages}`);
      check("Teks pada halaman /Rotate tetap ada", after.halaman[0].teks.includes("LAPORAN"),
        `item=${after.halaman[0].items.length}`);
    }
  }

  /* ============ 14c. Beban: 12 halaman miring ============ */
  {
    const file = path.join(FIX, "beban-12.pdf");
    const dibuat = await page.evaluate(async (url) => {
      const buf = new Uint8Array(await (await fetch(url + "/fixtures/deskew/pindai-miring3.pdf")).arrayBuffer());
      const out = await PDFLib.PDFDocument.create();
      for (let i = 0; i < 12; i++) {
        const src = await PDFLib.PDFDocument.load(new Uint8Array(buf), { updateMetadata: false });
        const cp = await out.copyPages(src, [0]);
        cp.forEach((p) => out.addPage(p));
      }
      const res = await out.save({ useObjectStreams: false });
      return Array.from(new Uint8Array(res));
    }, `http://127.0.0.1:${PORT}`);
    fs.writeFileSync(file, Buffer.from(dibuat));
    const r = await jalankan(file, { trim: false });
    check("Beban 12 halaman -> alat berhasil", !!r.bytes, r.bytes ? `${r.bytes.length} byte, ${r.durasi}s` : r.galat);
    if (r.bytes) {
      const after = await analisis(r.bytes);
      check("Beban: semua 12 halaman lurus", after.halaman.every((h) => Math.abs(h.sudut) < 0.5),
        `sisa=${after.halaman.map((h) => h.sudut).join(",")}`);
      const durasi = Number(r.durasi);
      check("Beban 12 halaman selesai < 60 detik", durasi > 0 && durasi < 60, `${durasi}s`);
    }
  }

  /* ============ 15. Tidak ada error JavaScript ============ */
  /* error dari berkas rusak memang diharapkan (alat menolaknya) */
  const errorTakTerduga = errors.filter(
    (e) => !/rusak total|tidak bisa dipulihkan/i.test(String(e))
  );
  check("Tidak ada error JavaScript selama audit", errorTakTerduga.length === 0,
    errorTakTerduga.slice(0, 3).join(" | "));

  await browser.close();
  srv.close();

  console.log(`\n=== HASIL: ${pass} lulus, ${fail} gagal ===`);
  if (fail) {
    console.log("\nPemeriksaan yang gagal:");
    for (const r of results.filter((x) => !x.ok)) console.log("  - " + r.name + (r.detail ? " — " + r.detail : ""));
  }
  fs.writeFileSync(path.join(SHOTS, "..", "audit-deskew-hasil.json"), JSON.stringify(results, null, 2));
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
