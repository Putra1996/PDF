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

/* Gulir elemen ke dalam layar lalu ambil kotaknya (koordinat layar). */
async function posisiLayar(page, sel) {
  await page.locator(sel).scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  return page.locator(sel).boundingBox();
}

/* Geser dengan JARI: sentuh asli (CDP) -> Chrome membuat Pointer Events
   dengan pointerType "touch". */
async function geserJari(cdp, page, dari, ke, langkah = 6) {
  const titik = (p) => [{ x: Math.round(p.x), y: Math.round(p.y), id: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: titik(dari) });
  for (let i = 1; i <= langkah; i++) {
    const t = i / langkah;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: titik({ x: dari.x + (ke.x - dari.x) * t, y: dari.y + (ke.y - dari.y) * t }),
    });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(150);
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
     1. Pegangan geser: struktur & aksesibilitas
     ========================================================== */
  await bukaAlat(page, [fixture.kosong]);
  await buatTandaTangan(page);
  const struktur = await page.evaluate(() => {
    const d = document.getElementById("signDrag");
    const st = document.getElementById("signStage");
    const cv = document.getElementById("signPreview");
    if (!d || !st || !cv) return { ada: false };
    const cs = getComputedStyle(d);
    const cb = cv.getBoundingClientRect();
    const db = d.getBoundingClientRect();
    const pi = (window.PDFToolsUI.state.custom || {}).previewInfo || {};
    return {
      ada: true,
      role: d.getAttribute("role"),
      tabindex: d.getAttribute("tabindex"),
      label: d.getAttribute("aria-label") || "",
      describedby: d.getAttribute("aria-describedby") || "",
      shortcuts: d.getAttribute("aria-keyshortcuts") || "",
      touchAction: cs.touchAction,
      cursor: cs.cursor,
      stagePosition: getComputedStyle(st).position,
      tersembunyi: d.hidden,
      selisihX: Math.abs(db.left - (cb.left + (pi.xMm / pi.pageWmm) * cb.width)),
      selisihY: Math.abs(db.top - (cb.top + ((pi.pageHmm - pi.yMm - pi.hMm) / pi.pageHmm) * cb.height)),
      selisihW: Math.abs(db.width - (pi.wMm / pi.pageWmm) * cb.width),
      lebarHandle: db.width, lebarCanvas: cb.width,
      statusAda: !!document.getElementById("signDragStatus"),
    };
  });
  check("Pegangan geser ada di pratinjau", struktur.ada);
  check("Pegangan geser punya role button + tabindex", struktur.role === "button" && struktur.tabindex === "0",
    struktur.role + "/" + struktur.tabindex);
  check("Pegangan geser punya aria-label & aria-describedby", !!struktur.label && !!struktur.describedby, struktur.label);
  check("Pegangan geser punya petunjuk tombol panah", /Arrow/.test(struktur.shortcuts), struktur.shortcuts);
  check("Pegangan geser memakai touch-action:none (halaman tidak ikut geser)", struktur.touchAction === "none", struktur.touchAction);
  check("Pegangan geser memakai kursor grab", /grab/.test(struktur.cursor), struktur.cursor);
  check("Panggung pratinjau berposisi relatif", struktur.stagePosition === "relative", struktur.stagePosition);
  check("Ada live region untuk pembaca layar", struktur.statusAda === true);
  check("Pegangan geser terlihat setelah tanda tangan dibuat", struktur.tersembunyi === false);
  check(
    "Kotak pegangan tepat di atas kotak tanda tangan di pratinjau",
    struktur.selisihX < 2 && struktur.selisihY < 2 && struktur.selisihW < 2,
    "dx=" + struktur.selisihX.toFixed(1) + " dy=" + struktur.selisihY.toFixed(1) + " dw=" + struktur.selisihW.toFixed(1)
  );
  check(
    "Luas pegangan mengikuti kotak tanda tangan (bukan layar penuh)",
    struktur.lebarHandle > 4 && struktur.lebarHandle < struktur.lebarCanvas * 0.9,
    Math.round(struktur.lebarHandle) + "px dari " + Math.round(struktur.lebarCanvas) + "px"
  );

  /* ==========================================================
     2. Geser dengan JARI & dengan tetikus
     ========================================================== */
  const cdp = await context.newCDPSession(page);
  const pxPerMm = await page.evaluate(() => {
    const cv = document.getElementById("signPreview");
    const pi = window.PDFToolsUI.state.custom.previewInfo;
    return cv.getBoundingClientRect().width / pi.pageWmm;
  });
  const sebelum = await ambilState(page);
  const k1 = await posisiLayar(page, "#signDrag");
  await geserJari(cdp, page,
    { x: k1.x + k1.width / 2, y: k1.y + k1.height / 2 },
    { x: k1.x + k1.width / 2 + 40, y: k1.y + k1.height / 2 + 25 });
  const sesudah = await ambilState(page);
  check(
    "Geser dengan JARI memindahkan posisi X",
    Math.abs((sesudah.x - sebelum.x) - 40 / pxPerMm) < 1.5,
    "\u0394X=" + (sesudah.x - sebelum.x).toFixed(2) + " mm (haraapan " + (40 / pxPerMm).toFixed(2) + ")"
  );
  check(
    "Geser dengan JARI memindahkan posisi Y (arah bawah)",
    Math.abs((sesudah.y - sebelum.y) + 25 / pxPerMm) < 1.5,
    "\u0394Y=" + (sesudah.y - sebelum.y).toFixed(2) + " mm (haraapan -" + (25 / pxPerMm).toFixed(2) + ")"
  );
  check(
    "Kolom X/Y ikut diperbarui setelah geser",
    Math.abs(Number(sesudah.fieldX) - sesudah.x) < 0.05 && Math.abs(Number(sesudah.fieldY) - sesudah.y) < 0.05,
    "kolom=" + sesudah.fieldX + "," + sesudah.fieldY + " state=" + sesudah.x + "," + sesudah.y
  );

  /* geser dengan tetikus */
  const k2 = await posisiLayar(page, "#signDrag");
  const sebelumMouse = await ambilState(page);
  await page.mouse.move(k2.x + k2.width / 2, k2.y + k2.height / 2);
  await page.mouse.down();
  await page.mouse.move(k2.x + k2.width / 2 - 30, k2.y + k2.height / 2 - 15, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const sesudahMouse = await ambilState(page);
  check(
    "Geser dengan TETIKUS memindahkan posisi",
    Math.abs((sesudahMouse.x - sebelumMouse.x) + 30 / pxPerMm) < 1.5,
    "\u0394X=" + (sesudahMouse.x - sebelumMouse.x).toFixed(2) + " mm"
  );
  check(
    "Kelas seret (is-drag) dibersihkan setelah mouse up",
    await page.evaluate(() => !document.getElementById("signDrag").classList.contains("is-drag"))
  );

  /* keyboard */
  const sebelumKey = await ambilState(page);
  await page.focus("#signDrag");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(150);
  const setelahKey = await ambilState(page);
  check("Panah kanan memindahkan X 1 mm per tekan",
    Math.abs((setelahKey.x - sebelumKey.x) - 2) < 0.05,
    "\u0394X=" + (setelahKey.x - sebelumKey.x).toFixed(2));
  await page.keyboard.press("Shift+ArrowUp");
  await page.waitForTimeout(150);
  const setelahShift = await ambilState(page);
  check("Shift + panah atas memindahkan Y 5 mm",
    Math.abs((setelahShift.y - setelahKey.y) - 5) < 0.05,
    "\u0394Y=" + (setelahShift.y - setelahKey.y).toFixed(2));

  /* geser keluar halaman harus tetap dijepit */
  const k3 = await posisiLayar(page, "#signDrag");
  await geserJari(cdp, page,
    { x: k3.x + k3.width / 2, y: k3.y + k3.height / 2 },
    { x: k3.x + k3.width / 2 + 4000, y: k3.y + k3.height / 2 + 4000 });
  const jepitDrag = await ambilState(page);
  check("Geser keluar halaman tetap dijepit",
    jepitDrag.xMm + jepitDrag.wMm <= jepitDrag.pageWmm + 0.05
      && jepitDrag.yMm + jepitDrag.hMm <= jepitDrag.pageHmm + 0.05,
    "x=" + jepitDrag.xMm + " y=" + jepitDrag.yMm
    + " (halaman " + jepitDrag.pageWmm + "\u00d7" + jepitDrag.pageHmm + ")");

  /* ==========================================================
     2b. End-to-end: posisi hasil DRAG benar-benar masuk PDF akhir
     ========================================================== */
  {
    await bukaAlat(page, [fixture.kosong]);
    await buatTandaTangan(page);
    const cdpE = await context.newCDPSession(page);
    const kE = await posisiLayar(page, "#signDrag");
    const sE = await ambilState(page);
    /* tinta tanda tangan SEBELUM digeser (area pensil pada kanvas) */
    const inkA = await ukurInkPratinjau(page, areaTanda(sE));
    /* geser 50 px ke kanan dan 30 px ke bawah */
    await geserJari(cdpE, page,
      { x: kE.x + kE.width / 2, y: kE.y + kE.height / 2 },
      { x: kE.x + kE.width / 2 + 50, y: kE.y + kE.height / 2 + 30 });
    const sE2 = await ambilState(page);
    check(
      "Posisi hasil drag benar-benar BERPINDAH dari posisi awal",
      Math.abs(sE2.xMm - sE.xMm) > 5 || Math.abs(sE2.yMm - sE.yMm) > 5,
      "\u0394x=" + (sE2.xMm - sE.xMm).toFixed(1) + " \u0394y=" + (sE2.yMm - sE.yMm).toFixed(1) + " mm"
    );
    /* tinta tanda tangan SESUDAH digeser (di pratinjau) */
    const inkB = await ukurInkPratinjau(page, areaTanda(sE2));
    check("Tinta tanda tangan di pratinjau ikut bergeser",
      inkA.ada && inkB.ada && Math.abs((inkB.x0 - inkA.x0) - (sE2.xMm - sE.xMm)) < 2,
      "pratinjau \u0394x=" + (inkB.x0 - inkA.x0).toFixed(1) + " mm");
    /* buat PDF akhir dari posisi hasil drag */
    const b64E = await jalankanAlat(page);
    check("PDF hasil dibuat dari posisi hasil drag", !!b64E && b64E.length > 100);
    const inkE = await ukurInkFinal(page, b64E, 2, areaTanda(sE2));
    check("Tanda tangan hasil drag ada di PDF akhir", inkE.ada === true, inkE.ada ? "" : "tidak ada tinta");
    if (inkE.ada && inkB.ada) {
      const dx = Math.abs(inkE.x0 - inkB.x0);
      const dy = Math.abs(inkE.y0 - inkB.y0);
      check(
        "POSISI HASIL DRAG SAMA DENGAN PDF AKHIR (bukan hanya pratinjau)",
        dx < 2 && dy < 2,
        "kafka x=" + inkE.x0.toFixed(1) + " y=" + inkE.y0.toFixed(1)
        + " | pratinjau x=" + inkB.x0.toFixed(1) + " y=" + inkB.y0.toFixed(1)
        + " | \u0394=" + dx.toFixed(1) + "/" + dy.toFixed(1) + " mm"
      );
    }
  }

  /* ==========================================================
     3. Halaman berotasi: pratinjau = PDF akhir
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
     4. Jepit (clamp) — tanda tangan tidak boleh keluar halaman
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
     5. Halaman multi-ukuran (A4 + A5 + landscape)
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
     5b. Balapan render: dua pratinjau tumpang tindih
     ========================================================== */
  {
    await bukaAlat(page, [fixture.multi]);
    /* Dua refresh beruntun = dua render yang tumpang tindih.
       pdf.js melempar "Cannot use the same canvas during multiple
       render() operations" kalau kanvas yang sama dipakai dua kali
       sebelum render sebelumnya selesai. */
    await page.evaluate(async () => {
      const c = window.PDFToolsUI.state.custom;
      c.refreshPreview();
      await new Promise((r) => setTimeout(r, 5));
      c.refreshPreview();
    });
    await page.waitForTimeout(2500);
    const balapan = await page.evaluate(() => ({
      hint: (document.getElementById("signPreviewHint") || {}).textContent || "",
      adaPratinjau: !!(window.PDFToolsUI.state.custom.previewInfo || {}).pageWmm,
    }));
    check("Balapan render: tidak ada error 'same canvas'",
      !/Cannot use the same canvas/i.test(balapan.hint) && !/tidak bisa dirender/i.test(balapan.hint),
      balapan.hint.slice(0, 90));
    check("Balapan render: pratinjau tetap tampil",
      balapan.adaPratinjau === true);

    /* Tiga refresh beruntun + ganti halaman di tengah jalan. */
    await page.evaluate(async () => {
      const c = window.PDFToolsUI.state.custom;
      c.refreshPreview();
      await new Promise((r) => setTimeout(r, 3));
      c.refreshPreview();
      await new Promise((r) => setTimeout(r, 3));
      c.refreshPreview();
    });
    await page.waitForTimeout(2500);
    const balapan2 = await page.evaluate(() => ({
      hint: (document.getElementById("signPreviewHint") || {}).textContent || "",
      adaPratinjau: !!(window.PDFToolsUI.state.custom.previewInfo || {}).pageWmm,
    }));
    check("Balapan render (3x): pratinjau tetap tampil & tanpa error",
      !/Cannot use the same canvas/i.test(balapan2.hint)
      && !/tidak bisa dirender/i.test(balapan2.hint)
      && balapan2.adaPratinjau === true,
      balapan2.hint.slice(0, 90));

    /* Ganti halaman saat render berjalan. */
    await page.evaluate(async () => {
      const c = window.PDFToolsUI.state.custom;
      const btn = document.getElementById("signNext");
      c.refreshPreview();
      await new Promise((r) => setTimeout(r, 3));
      btn.click();
      await new Promise((r) => setTimeout(r, 3));
      c.refreshPreview();
    });
    await page.waitForTimeout(2500);
    const balapan3 = await page.evaluate(() => ({
      hint: (document.getElementById("signPreviewHint") || {}).textContent || "",
      adaPratinjau: !!(window.PDFToolsUI.state.custom.previewInfo || {}).pageWmm,
    }));
    check("Balapan render + ganti halaman: tanpa error, pratinjau tetap tampil",
      !/Cannot use the same canvas/i.test(balapan3.hint)
      && !/tidak bisa dirender/i.test(balapan3.hint)
      && balapan3.adaPratinjau === true,
      balapan3.hint.slice(0, 90));

    /* Pratinjau harus benar-benar berisi halaman (bukan kanvas kosong).
       Pakai fixture BERTEKS supaya isinya bisa diukur. */
    await bukaAlat(page, [fixture.teks]);
    await page.evaluate(async () => {
      const c = window.PDFToolsUI.state.custom;
      c.refreshPreview();
      await new Promise((r) => setTimeout(r, 5));
      c.refreshPreview();
    });
    await page.waitForTimeout(2500);
    const isi = await page.evaluate(() => {
      const cv = document.getElementById("signPreview");
      const ctx = cv.getContext("2d");
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      let beda = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] !== 255 || d[i + 1] !== 255 || d[i + 2] !== 255) beda++;
      }
      return { total: d.length / 4, beda: beda };
    });
    check("Pratinjau setelah balapan render benar-benar berisi gambar halaman",
      isi.beda > 100, "piksel non-putih: " + isi.beda + " / " + isi.total);
    const isiErr = await page.evaluate(() => ({
      hint: (document.getElementById("signPreviewHint") || {}).textContent || "",
    }));
    check("Balapan render pada dokumen berteks: tanpa error",
      !/Cannot use the same canvas/i.test(isiErr.hint) && !/tidak bisa dirender/i.test(isiErr.hint),
      isiErr.hint.slice(0, 80));
  }

  /* ==========================================================
     6. Layar sempit (ponsel 375px)
     ========================================================== */
  const ctxHp = await browser.newContext({
    viewport: { width: 375, height: 667 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  const pageHp = await ctxHp.newPage();
  pageHp.on("pageerror", (e) => errors.push("ponsel: " + String(e)));
  await pageHp.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
  await pageHp.waitForTimeout(700);
  await pageHp.evaluate(() => window.PDFToolsUI.openTool("sign"));
  await pageHp.waitForTimeout(300);
  await pageHp.setInputFiles("#toolInput", [fixture.kosong]);
  await pageHp.waitForTimeout(1300);
  await buatTandaTangan(pageHp);
  const alHp = await pageHp.evaluate(() => {
    const d = document.getElementById("signDrag");
    const cv = document.getElementById("signPreview");
    const db = d.getBoundingClientRect();
    const cb = cv.getBoundingClientRect();
    const pi = (window.PDFToolsUI.state.custom || {}).previewInfo || {};
    return {
      tersembunyi: d.hidden,
      lebarKanvas: cb.width,
      dx: Math.abs(db.left - (cb.left + (pi.xMm / pi.pageWmm) * cb.width)),
      dy: Math.abs(db.top - (cb.top + ((pi.pageHmm - pi.yMm - pi.hMm) / pi.pageHmm) * cb.height)),
      dw: Math.abs(db.width - (pi.wMm / pi.pageWmm) * cb.width),
      touchAction: getComputedStyle(d).touchAction,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  check("Layar 375px: panggung pratinjau tidak meluber", alHp.overflow === false, "scrollWidth > viewport");
  check(
    "Layar 375px: pegangan tetap presisi di atas kotak tanda tangan",
    alHp.tersembunyi === false && alHp.dx < 2 && alHp.dy < 2 && alHp.dw < 2,
    "dx=" + alHp.dx.toFixed(1) + " dy=" + alHp.dy.toFixed(1) + " dw=" + alHp.dw.toFixed(1)
  );
  check("Layar 375px: touch-action tetap none", alHp.touchAction === "none", alHp.touchAction);
  const cdpHp = await ctxHp.newCDPSession(pageHp);
  const kHp = await posisiLayar(pageHp, "#signDrag");
  const sHp = await ambilState(pageHp);
  await geserJari(cdpHp, pageHp,
    { x: kHp.x + kHp.width / 2, y: kHp.y + kHp.height / 2 },
    { x: kHp.x + kHp.width / 2 + 30, y: kHp.y + kHp.height / 2 });
  const sHp2 = await ambilState(pageHp);
  check(
    "Layar 375px: geser dengan jari tetap memindahkan posisi",
    Math.abs((sHp2.x - sHp.x) - 30 / (alHp.lebarKanvas / sHp.pageWmm)) < 1.5,
    "\u0394X=" + (sHp2.x - sHp.x).toFixed(2) + " mm"
  );
  await pageHp.screenshot({ path: path.join(SHOTS, "ttd-hp.png") });
  await pageHp.close();

  /* ==========================================================
     7. PDF rusak & dua berkas
     ========================================================== */
  const pageRusak = await context.newPage();
  pageRusak.on("pageerror", (e) => errors.push("rusak: " + String(e)));
  await pageRusak.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
  await pageRusak.waitForTimeout(600);
  await pageRusak.evaluate(() => window.PDFToolsUI.openTool("sign"));
  await pageRusak.waitForTimeout(300);
  await pageRusak.setInputFiles("#toolInput", [{
    name: "rusak.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n"),
  }]);
  await pageRusak.waitForTimeout(1500);
  const rusak = await pageRusak.evaluate(() => {
    const d = document.getElementById("signDrag");
    return {
      ada: !!d,
      tersembunyi: d ? d.hidden : true,
      hint: (document.getElementById("signPreviewHint") || {}).textContent || "",
    };
  });
  check("PDF rusak: pegangan geser disembunyikan", rusak.ada === true && rusak.tersembunyi === true);
  check("PDF rusak: pesan error pratinjau ditampilkan", /tidak bisa|tidak ada|gagal/i.test(rusak.hint), rusak.hint.slice(0, 70));
  await pageRusak.close();

  const pageDua = await context.newPage();
  pageDua.on("pageerror", (e) => errors.push("dua: " + String(e)));
  await bukaAlat(pageDua, [fixture.kosong, fixture.multi]);
  await pageDua.waitForTimeout(800);
  const dua = await pageDua.evaluate(() => ({
    hint: (document.getElementById("signPreviewHint") || {}).textContent || "",
    jumlah: (window.PDFToolsUI.state.custom.previewInfo || {}).jumlah,
  }));
  check(
    "Dua berkas: pratinjau memakai PDF pertama dan memberi tahu",
    /PDF pertama/.test(dua.hint) && dua.jumlah === 1,
    "jumlah=" + dua.jumlah
  );
  await pageDua.close();

  /* ==========================================================
     8. Error JavaScript
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
