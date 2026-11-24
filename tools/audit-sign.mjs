/**
 * Audit mendalam alat "Tanda tangani PDF".
 *
 * Yang diuji:
 *   - pratinjau memakai dimensi halaman yang terlihat (setelah /Rotate)
 *   - pratinjau = PDF akhir: kotak tanda tangan di PDF hasil diukur dari
 *     render pdf.js lalu dibandingkan dengan posisi pratinjau
 *     (termasuk halaman berotasi 90/180/270 derajat)
 *   - orientasi tanda tangan di PDF akhir sama dengan pratinjau
 *   - posisi dijepit agar tanda tangan tidak keluar dari halaman
 *   - halaman multi-ukuran (A4 + A5 + landscape)
 *   - tidak ada error JavaScript selama seluruh alur
 *
 * Jalankan:
 *   node tools/mkfixtures-sign.mjs && node tools/audit-sign.mjs
 *
 * Env:
 *   SERVE_DIR    - direktori statis yang dilayani (default: repo ini)
 *   FIXTURES_DIR - folder fixture (default: fixtures/ttd)
 *   SHOT_DIR     - folder screenshot bukti
 *   PORT         - porta server lokal
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "./browser.mjs";
import { buatFixture } from "./mkfixtures-sign.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.SERVE_DIR || path.join(HERE, ".."));
const FIX = path.resolve(process.env.FIXTURES_DIR || path.join(ROOT, "fixtures", "ttd"));
const SHOTS = path.resolve(process.env.SHOT_DIR || path.join(ROOT, "docs", "audit-ttd-2026-11-24"));
const PORT = Number(process.env.PORT || 8076);
const MM = 72 / 25.4;

const results = [];
let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  ok ? pass++ : fail++;
  console.log(`${ok ? "\u2713" : "\u2717"} ${name}${detail ? " — " + detail : ""}`);
};

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".pdf": "application/pdf", ".png": "image/png",
  ".svg": "image/svg+xml", ".wasm": "application/wasm", ".json": "application/json",
  ".gz": "application/gzip", ".yml": "text/plain; charset=utf-8",
};

function server() {
  const s = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || "/").split("?")[0]);
    let f = path.join(ROOT, url === "/" ? "index.html" : url);
    if (!f.startsWith(ROOT)) return res.writeHead(403).end();
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
    if (!fs.existsSync(f)) return res.writeHead(404).end("nf");
    const ext = path.extname(f).toLowerCase();
    res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => s.listen(PORT, "127.0.0.1", () => r(s)));
}

/* ------------------------------------------------------------------
   Helper ukur: kotak tinta (piksel non-putih) pada sebuah kanvas
   ------------------------------------------------------------------ */

/*(src di dalam browser) Fungsi ukurInk(cv, mmPerPxX, mmPerPxY) mengembalikan
   kotak tinta dalam milimeter, koordinat dari kiri & dari bawah. */
const SRC_UKUR = `
/* Kotak tinta (piksel non-putih) di dalam area tertentu.
   mmpx/mmpy = milimeter per piksel; crop = area Interest dalam mm
   (dari kiri & dari bawah halaman). Area dibatasi supaya garis bantu
   kotak tanda tangan (biru, digambar tepat di tepi kotak) tidak ikut
   terukur. Area yang sama dipakai untuk pratinjau & PDF akhir supaya
   keduanya langsung sebanding. */
function ukurInk(cv, mmpx, mmpy, crop) {
  const cx = cv.getContext("2d");
  const d = cx.getImageData(0, 0, cv.width, cv.height).data;
  const W = cv.width, H = cv.height;
  let x0 = 0, y0 = 0, x1 = W, y1 = H;
  if (crop) {
    x0 = Math.max(0, Math.round(crop.x0 / mmpx));
    x1 = Math.min(W, Math.round(crop.x1 / mmpx));
    y0 = Math.max(0, Math.round(H - crop.y1 / mmpy));
    y1 = Math.min(H, Math.round(H - crop.y0 / mmpy));
  }
  let minX = x1, minY = y1, maxX = -1, maxY = -1;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      /* putih = kertas kosong */
      if (d[i] > 244 && d[i + 1] > 244 && d[i + 2] > 244) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { ada: false };
  return {
    ada: true,
    x0: minX * mmpx, x1: (maxX + 1) * mmpx,
    y0: (H - (maxY + 1)) * mmpy, y1: (H - minY) * mmpy,
  };
}`;

/* Area Interest: kotak tanda tangan (dari pratinjau) dikecilkan 2 mm
   supaya garis bantu di tepinya tidak ikut terukur. */
function areaTanda(pi) {
  if (!pi || pi.xMm == null) return null;
  return {
    x0: pi.xMm + 2, y0: pi.yMm + 2,
    x1: pi.xMm + pi.wMm - 2, y1: pi.yMm + pi.hMm - 2,
  };
}

/* Ukur kotak tinta tanda tangan pada kanvas pratinjau (mm).
   crop (mm) membatasi area yang diukur — dipakai supaya garis bantu
   kotak (biru) di tepi kotak tanda tangan tidak ikut terukur. */
async function ukurInkPratinjau(page, crop) {
  return page.evaluate(({ src, crop }) => {
    const ukur = new Function(src + "; return ukurInk;")();
    const cv = document.getElementById("signPreview");
    const pi = (window.PDFToolsUI.state.custom || {}).previewInfo || {};
    if (!pi.pageWmm) return { ada: false };
    const mmpx = pi.pageWmm / cv.width;
    const mmpy = pi.pageHmm / cv.height;
    const u = ukur(cv, mmpx, mmpy, crop);
    u.pratinjauWmm = pi.pageWmm;
    u.pratinjauHmm = pi.pageHmm;
    return u;
  }, { src: SRC_UKUR, crop: crop || null });
}

/* Ukur kotak tinta tanda tangan pada PDF hasil (mm, halaman terlihat). */
async function ukurInkFinal(page, b64, skala, crop) {
  return page.evaluate(({ b64, skala, src, crop }) => {
    const ukur = new Function(src + "; return ukurInk;")();
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const doc = window.pdfjsLib.getDocument({ data: bytes }).promise;
    return doc.then(async (d) => {
      const hal = await d.getPage(1);
      const vp = hal.getViewport({ scale: skala });
      const cv = document.createElement("canvas");
      cv.width = Math.ceil(vp.width);
      cv.height = Math.ceil(vp.height);
      const cx = cv.getContext("2d", { alpha: false });
      cx.fillStyle = "#fff";
      cx.fillRect(0, 0, cv.width, cv.height);
      await hal.render({ canvasContext: cx, viewport: vp }).promise;
      /* 1 piksel = 1/skala point = (25.4/72)/skala mm */
      const mmpx = (25.4 / 72) / skala;
      const u = ukur(cv, mmpx, mmpx, crop);
      u.halamanWmm = vp.width * mmpx;
      u.halamanHmm = vp.height * mmpx;
      u.rotasi = hal.rotate;
      return u;
    });
  }, { b64, skala, src: SRC_UKUR, crop: crop || null });
}

/* Tulis tanda tangan di kanvas (mouse) lalu simpan. */
async function buatTandaTangan(page) {
  await page.locator("#signPad").scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const pad = await page.locator("#signPad").boundingBox();
  await page.mouse.move(pad.x + 60, pad.y + pad.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(pad.x + 140, pad.y + pad.height * 0.3, { steps: 6 });
  await page.mouse.move(pad.x + 230, pad.y + pad.height * 0.7, { steps: 6 });
  await page.mouse.move(pad.x + 320, pad.y + pad.height * 0.35, { steps: 6 });
  await page.mouse.up();
  await page.click("#signSave");
  await page.waitForTimeout(800);
}

/* Buka halaman, masuk ke alat tanda tangan, dan pasang PDF. */
async function bukaAlat(page, berkas) {
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
  await page.waitForTimeout(600);
  await page.evaluate(() => window.PDFToolsUI.openTool("sign"));
  await page.waitForTimeout(300);
  await page.setInputFiles("#toolInput", berkas);
  await page.waitForTimeout(1300);
}

/* Isi kolom posisi. */
async function setPosisi(page, x, y) {
  await page.evaluate(({ x, y }) => {
    for (const [id, v] of [["x", x], ["y", y]]) {
      const el = document.getElementById("f_" + id);
      el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, { x, y });
  await page.waitForTimeout(900);
}

/* Jalankan alat dan ambil PDF hasil (base64). */
async function jalankanAlat(page) {
  await page.click("#toolRunBtn");
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(250);
    const n = await page.evaluate(() => document.querySelectorAll("#toolResults > *").length);
    if (n > 0) break;
  }
  return page.evaluate(async () => {
    const a = document.querySelector("#toolResults a");
    if (!a) return "";
    const buf = await (await fetch(a.href)).arrayBuffer();
    const u = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s);
  });
}

/* Keadaan posisi tanda tangan (mm) dari state aplikasi. */
const ambilState = (page) =>
  page.evaluate(() => {
    const s = window.PDFToolsUI.state;
    const pi = s.custom.previewInfo || {};
    return {
      x: s.opts.x, y: s.opts.y, w: s.opts.w,
      fieldX: (document.getElementById("f_x") || {}).value,
      fieldY: (document.getElementById("f_y") || {}).value,
      page: pi.page, jumlah: pi.jumlah,
      pageWmm: pi.pageWmm, pageHmm: pi.pageHmm,
      xMm: pi.xMm, yMm: pi.yMm, wMm: pi.wMm, hMm: pi.hMm,
      adaGambar: pi.adaGambar,
    };
  });

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const fixture = await buatFixture(FIX);
  console.log("Fixture: " + Object.values(fixture).join(", "));

  const srv = await server();
  const browser = await chromium();
  const errors = [];
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  /* ==========================================================
     1. Halaman berotasi: pratinjau = PDF akhir
     ========================================================== */
  const rotasi = [
    { nama: "kosong.pdf", rot: 0, w: 210, h: 297 },
    { nama: "putar90.pdf", rot: 90, w: 297, h: 210 },
    { nama: "putar180.pdf", rot: 180, w: 210, h: 297 },
    { nama: "putar270.pdf", rot: 270, w: 297, h: 210 },
  ];
  for (const r of rotasi) {
    await bukaAlat(page, [fixture[r.nama.replace(".pdf", "")] || fixture[r.nama]]);
    await buatTandaTangan(page);
    await setPosisi(page, 30, 20);
    const pv = await ambilState(page);
    check(
      "Rotasi " + r.rot + "°: pratinjau memakai dimensi halaman yang terlihat",
      Math.abs(pv.pageWmm - r.w) < 1 && Math.abs(pv.pageHmm - r.h) < 1,
      pv.pageWmm + "×" + pv.pageHmm + " mm (harapan " + r.w + "×" + r.h + ")"
    );
    const inkPv = await ukurInkPratinjau(page, areaTanda(pv));
    const b64 = await jalankanAlat(page);
    check("Rotasi " + r.rot + "°: PDF hasil dibuat", !!b64 && b64.length > 800);
    if (!b64) continue;
    const ink = await ukurInkFinal(page, b64, 2, areaTanda(pv));
    check("Rotasi " + r.rot + "°: tanda tangan ada di PDF hasil", ink.ada === true,
      ink.ada ? "kotak " + ink.x0.toFixed(1) + ".." + ink.x1.toFixed(1) + " mm" : "tidak ditemukan");
    if (!ink.ada || !inkPv.ada) continue;
    const beda = [
      Math.abs(ink.x0 - inkPv.x0), Math.abs(ink.x1 - inkPv.x1),
      Math.abs(ink.y0 - inkPv.y0), Math.abs(ink.y1 - inkPv.y1),
    ];
    check(
      "Rotasi " + r.rot + "°: posisi tanda tangan sama dengan pratinjau",
      Math.max.apply(null, beda) < 2.5,
      "beda mm: " + beda.map((v) => v.toFixed(2)).join(", ")
    );
    /* Orientasi: tanda tangan tidak boleh berputar 90° (lebar & tinggi
       kotak tinta harus sama, bukan tertukar). */
    const lebarPv = inkPv.x1 - inkPv.x0, tinggiPv = inkPv.y1 - inkPv.y0;
    const lebarAkhir = ink.x1 - ink.x0, tinggiAkhir = ink.y1 - ink.y0;
    check(
      "Rotasi " + r.rot + "°: orientasi tanda tangan sama dengan pratinjau",
      Math.abs(lebarAkhir - lebarPv) < 2.5 && Math.abs(tinggiAkhir - tinggiPv) < 2.5,
      "PDF=" + lebarAkhir.toFixed(1) + "×" + tinggiAkhir.toFixed(1)
      + " mm pratinjau=" + lebarPv.toFixed(1) + "×" + tinggiPv.toFixed(1) + " mm"
    );
    await page.screenshot({ path: path.join(SHOTS, "ttd-rotasi" + r.rot + ".png") });
  }

  /* ==========================================================
     2. Jepit (clamp) — tanda tangan tidak boleh keluar halaman
     ========================================================== */
  await bukaAlat(page, [fixture.kosong]);
  await buatTandaTangan(page);
  await setPosisi(page, 400, 400);
  const jepit = await ambilState(page);
  check(
    "Posisi di luar halaman dijepit (tidak keluar dari kertas)",
    jepit.xMm + jepit.wMm <= jepit.pageWmm + 0.05 && jepit.yMm + jepit.hMm <= jepit.pageHmm + 0.05,
    "x=" + jepit.xMm + " w=" + jepit.wMm + " (halaman " + jepit.pageWmm + ") | y=" + jepit.yMm + " h=" + jepit.hMm + " (halaman " + jepit.pageHmm + ")"
  );
  check(
    "Kolom X/Y dikoreksi ke nilai yang dijepit",
    Math.abs(Number(jepit.fieldX) - jepit.xMm) < 0.05 && Math.abs(Number(jepit.fieldY) - jepit.yMm) < 0.05,
    "kolom=" + jepit.fieldX + "," + jepit.fieldY + " state=" + jepit.xMm + "," + jepit.yMm
  );
  const inkJepit = await ukurInkPratinjau(page, areaTanda(jepit));
  const b64Jepit = await jalankanAlat(page);
  const akhirJepit = await ukurInkFinal(page, b64Jepit, 2, areaTanda(jepit));
  check(
    "Tanda tangan hasil jepit benar-benar berada di dalam halaman",
    akhirJepit.ada && akhirJepit.x0 >= -0.5 && akhirJepit.x1 <= akhirJepit.halamanWmm + 0.5
      && akhirJepit.y0 >= -0.5 && akhirJepit.y1 <= akhirJepit.halamanHmm + 0.5,
    akhirJepit.ada ? "x=" + akhirJepit.x0.toFixed(1) + ".." + akhirJepit.x1.toFixed(1)
      + " y=" + akhirJepit.y0.toFixed(1) + ".." + akhirJepit.y1.toFixed(1)
      + " (halaman " + akhirJepit.halamanWmm.toFixed(0) + "×" + akhirJepit.halamanHmm.toFixed(0) + ")" : "tidak ditemukan"
  );
  check("Pratinjau & PDF akhir sama-sama dijepit", Math.abs(inkJepit.x0 - akhirJepit.x0) < 2.5
    && Math.abs(inkJepit.y0 - akhirJepit.y0) < 2.5,
    "beda x=" + Math.abs(inkJepit.x0 - akhirJepit.x0).toFixed(2)
    + " y=" + Math.abs(inkJepit.y0 - akhirJepit.y0).toFixed(2));

  /* ==========================================================
     3. Halaman multi-ukuran (A4 + A5 + landscape)
     ========================================================== */
  const pageMulti = await context.newPage();
  pageMulti.on("pageerror", (e) => errors.push("multi: " + String(e)));
  await bukaAlat(pageMulti, [fixture.multi]);
  await buatTandaTangan(pageMulti);
  await pageMulti.evaluate(() => {
    const el = document.getElementById("f_page");
    el.value = "semua";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await pageMulti.waitForTimeout(1500);
  const multi = await ambilState(pageMulti);
  check("Pratinjau mengenali semua halaman target", multi.jumlah === 3, "halaman=" + multi.jumlah);
  await setPosisi(pageMulti, 130, 190);
  const multi2 = await ambilState(pageMulti);
  check(
    "Halaman multi-ukuran: tanda tangan muat di semua halaman",
    multi2.xMm + multi2.wMm <= 148.05 && multi2.yMm + multi2.hMm <= 210.05,
    "x=" + multi2.xMm + " w=" + multi2.wMm + " | y=" + multi2.yMm + " h=" + multi2.hMm + " (A5 = 148×210)"
  );
  const b64Multi = await jalankanAlat(pageMulti);
  check("PDF multi-halaman tetap dibuat", !!b64Multi && b64Multi.length > 800);
  await pageMulti.screenshot({ path: path.join(SHOTS, "ttd-multi.png") });
  await pageMulti.close();

  /* ==========================================================
     4. Error JavaScript
     ========================================================== */
  const nyata = errors.filter((e) => !/favicon|ERR_FAILED|net::/i.test(e));
  check("Tidak ada error JavaScript selama audit", nyata.length === 0, nyata.slice(0, 3).join(" | "));

  console.log("\n" + pass + " lulus / " + fail + " gagal");
  fs.writeFileSync(path.join(SHOTS, "hasil.json"), JSON.stringify({ pass, fail, results }, null, 2));

  await browser.close();
  srv.close();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
