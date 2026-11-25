/**
 * Audit mendalam fitur geser tanda tangan dengan JARI / SENTUHAN.
 *
 * Yang diuji:
 *   - target sentuh (ukuran pegangan) cukup besar untuk jari
 *   - geser dengan sentuhan asli (CDP touch) benar-benar memindahkan
 *     tanda tangan
 *   - halaman TIDAK ikut ter-scroll saat digeser
 *   - jeda diklik (tap) tidak merusak apa pun
 *   - permukaan "tempel" (near-miss) tetap tertangkap
 *   - posisi hasil geser benar-benar masuk ke PDF akhir
 *   - perubahan lebar lewat pegangan kecil (opsional)
 *
 * Jalankan:
 *   node tools/mkfixtures-sign.mjs && node tools/audit-sign-touch.mjs
 *
 * Env:
 *   SERVE_DIR    - direktori statis (default: repo ini)
 *   FIXTURES_DIR - folder fixture (default: fixtures/ttd)
 *   SHOT_DIR     - folder screenshot bukti
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
const PORT = Number(process.env.PORT || 8141);

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".png": "image/png", ".pdf": "application/pdf",
  ".wasm": "application/wasm", ".mjs": "text/javascript; charset=utf-8",
};

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail: detail == null ? "" : String(detail) });
  console.log((ok ? "✓ " : "✗ ") + name + (detail != null && detail !== "" ? " — " + detail : ""));
};

/* ---------- server statis ---------- */
function server() {
  const s = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || "/").split("?")[0]);
    const f = path.join(ROOT, url === "/" ? "index.html" : url);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404); res.end("404"); return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => s.listen(PORT, "127.0.0.1", () => r(s)));
}

/* ---------- perangkat uji ---------- */
const HP = { width: 390, height: 844 };          /* iPhone 13 */
const KECIL = { width: 320, height: 568 };       /* layar sangat sempit */

/* ---------- sentuhan asli (CDP) ---------- */
async function geserSentuh(cdp, page, dari, ke, langkah = 10, jeda = 16) {
  const titik = (p) => [{ x: Math.round(p.x), y: Math.round(p.y), id: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: titik(dari) });
  for (let i = 1; i <= langkah; i++) {
    const t = i / langkah;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: titik({ x: dari.x + (ke.x - dari.x) * t, y: dari.y + (ke.y - dari.y) * t }),
    });
    await page.waitForTimeout(jeda);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(250);
}

async function tapSentuh(cdp, page, di) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart", touchPoints: [{ x: Math.round(di.x), y: Math.round(di.y), id: 1 }],
  });
  await page.waitForTimeout(60);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(250);
}

/* ---------- utilitas ---------- */
async function posisiLayar(page, sel) {
  await page.locator(sel).scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  return page.locator(sel).boundingBox();
}

async function tulisTandaTangan(page) {
  await page.locator("#signPad").scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const pad = await page.locator("#signPad").boundingBox();
  await page.mouse.move(pad.x + 60, pad.y + pad.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(pad.x + 150, pad.y + pad.height * 0.3, { steps: 6 });
  await page.mouse.move(pad.x + 250, pad.y + pad.height * 0.7, { steps: 6 });
  await page.mouse.up();
  await page.click("#signSave");
  await page.waitForTimeout(900);
}

async function statePosisi(page) {
  return page.evaluate(() => {
    const pi = (window.PDFToolsUI.state.custom || {}).previewInfo || {};
    const f = (id) => {
      const el = document.getElementById("f_" + id);
      return el ? Number(el.value) : null;
    };
    return {
      xMm: pi.xMm, yMm: pi.yMm, wMm: pi.wMm, hMm: pi.hMm,
      pageWmm: pi.pageWmm, pageHmm: pi.pageHmm,
      fieldX: f("x"), fieldY: f("y"), fieldW: f("w"),
      scrollY: window.scrollY,
    };
  });
}

/* ================================================================== */
const fixture = await buatFixture(FIX);
const srv = await server();
const browser = await chromium();
const errors = [];

console.log("Fixture: " + Object.values(fixture).join(", "));

/* ------------------------------------------------------------------
   1. HP 390px — target sentuh & geser dengan jari
   ------------------------------------------------------------------ */
const ctxHp = await browser.newContext({
  viewport: HP, hasTouch: true, isMobile: true, deviceScaleFactor: 3,
});
const page = await ctxHp.newPage();
const cdpHp = await ctxHp.newCDPSession(page);
page.on("pageerror", (e) => errors.push("hp: " + String(e)));
page.on("crash", () => errors.push("hp: halaman crash"));
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
await page.waitForTimeout(800);
await page.evaluate(() => window.PDFToolsUI.openTool("sign"));
await page.waitForTimeout(300);
await page.setInputFiles("#toolInput", [fixture.kosong]);
await page.waitForTimeout(1500);
await tulisTandaTangan(page);

/* -- ukuran target sentuh --
   Area tangkap diukur sungguhan dengan elementFromPoint: kotak yang
   terlihat (border box) lebih kecil daripada area yang benar-benar
   bisa disentuh, karena ada ::before yang diperbesar. */
const UKUR_TARGET = `async () => {
  const d = document.getElementById("signDrag");
  const cv = document.getElementById("signPreview");
  const rs = document.getElementById("signResize");
  /*.center supaya seluruh pegangan berada di dalam viewport */
  d.scrollIntoView({ block: "center", inline: "center" });
  await new Promise((r) => setTimeout(r, 120));
  const db = d.getBoundingClientRect();
  const cb = cv.getBoundingClientRect();
  const cs = getComputedStyle(d);
  const pi = (window.PDFToolsUI.state.custom || {}).previewInfo || {};

  /* cari batas area tangkap: furthest titik yang masih "menangkap" */
  const kena = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return !!el && (el === d || d.contains(el));
  };
  const tengahY = db.top + db.height / 2;
  const tengahX = db.left + db.width / 2;
  let kiri = db.left, kanan = db.right, atas = db.top, bawah = db.bottom;
  for (let i = 0; i <= 30; i++) { if (kena(db.left - i, tengahY)) kiri = db.left - i; else break; }
  for (let i = 0; i <= 30; i++) { if (kena(db.right + i, tengahY)) kanan = db.right + i; else break; }
  for (let i = 0; i <= 30; i++) { if (kena(tengahX, db.top - i)) atas = db.top - i; else break; }
  for (let i = 0; i <= 30; i++) { if (kena(tengahX, db.bottom + i)) bawah = db.bottom + i; else break; }

  /* pegangan ubah lebar (bisa belum ada di versi lama) */
  let resizeHitW = 0, resizeHitH = 0;
  if (rs) {
    const rb = rs.getBoundingClientRect();
    const rbTengah = { x: rb.left + rb.width / 2, y: rb.top + rb.height / 2 };
    const resizeKena = (dx, dy) => {
      const el = document.elementFromPoint(rbTengah.x + dx, rbTengah.y + dy);
      return !!el && (el === rs || rs.contains(el));
    };
    let rw = rb.width, rh = rb.height;
    for (let i = 0; i <= 20; i++) { if (resizeKena(-i, 0)) rw = rb.width + 2 * i; else break; }
    for (let i = 0; i <= 20; i++) { if (resizeKena(0, -i)) rh = rb.height + 2 * i; else break; }
    resizeHitW = Math.round(rw); resizeHitH = Math.round(rh);
  }

  /* Apakah CSS benar-benar mematikan panggilan konteks sentuhan?
     Catatan: Chromium MEMBUANG -webkit-touch-callout dari CSSOM
     (properti itu khusus iOS Safari), jadi sumber CSS aslinilah yang
     diperiksa, bukan hasil parsing peramban. */
  let callout = "(tidak ada di CSS)";
  try {
    const teks = await (await fetch("style.css?v=20261124h")).text();
    const blok = (teks.match(/\.sign-drag\{[^}]*\}/) || [""])[0];
    callout = /-webkit-touch-callout\s*:\s*none/i.test(blok) ? "none" : "ada";
  } catch (_) { /* abaikan */ }

  return {
    w: db.width, h: db.height,
    hitW: Math.round(kanan - kiri), hitH: Math.round(bawah - atas),
    resizeHitW: resizeHitW, resizeHitH: resizeHitH,
    resizeHidden: rs ? rs.hidden : true,
    canvasW: cb.width, canvasH: cb.height,
    touchAction: cs.touchAction,
    touchCallout: callout,
    userSelect: cs.userSelect || cs.webkitUserSelect,
    cursor: cs.cursor,
    hidden: d.hidden,
    pageWmm: pi.pageWmm, pageHmm: pi.pageHmm,
    wMm: pi.wMm, hMm: pi.hMm,
  };
}`;
const target = await page.evaluate(`(${UKUR_TARGET})()`);
console.log("\n--- target sentuh di layar " + HP.width + "px ---");
console.log("  kotak terlihat : " + target.w.toFixed(1) + " × " + target.h.toFixed(1) + " px CSS");
console.log("  area tangkap   : " + target.hitW + " × " + target.hitH + " px CSS");
console.log("  area tangkap ubah-lebar : " + target.resizeHitW + " × " + target.resizeHitH + " px CSS");
check("Pegangan geser terlihat", target.hidden === false);
check("Pegangan ubah-lebar terlihat", target.resizeHidden === false);
check(
  "Area tangkap pegangan ≥ 44 px (standar Apple HIG) di kedua sisi",
  target.hitW >= 44 && target.hitH >= 44,
  target.hitW + " × " + target.hitH + " px"
);
check(
  "Area tangkap pegangan ubah-lebar ≥ 44 px",
  target.resizeHitW >= 44 && target.resizeHitH >= 44,
  target.resizeHitW + " × " + target.resizeHitH + " px"
);
check("touch-action:none (halaman tidak ikut ter-scroll)", target.touchAction === "none", target.touchAction);
check("Penggilan konteks sentuhan dimatikan (-webkit-touch-callout)",
  target.touchCallout === "none", target.touchCallout);
check("Pemilihan teks dimatikan saat digeser", /none/i.test(target.userSelect || ""), target.userSelect);

/* -- geser dengan jari -- */
const k = await posisiLayar(page, "#signDrag");
const sebelum = await statePosisi(page);
const scrollSebelum = sebelum.scrollY;
await geserSentuh(cdpHp, page,
  { x: k.x + k.width / 2, y: k.y + k.height / 2 },
  { x: k.x + k.width / 2 + 70, y: k.y + k.height / 2 + 40 });
const sesudah = await statePosisi(page);
check(
  "Geser dengan JARI memindahkan tanda tangan",
  Math.abs(sesudah.xMm - sebelum.xMm) > 3 || Math.abs(sesudah.yMm - sebelum.yMm) > 3,
  "Δx=" + (sesudah.xMm - sebelum.xMm).toFixed(1) + " Δy=" + (sesudah.yMm - sebelum.yMm).toFixed(1) + " mm"
);
check("Halaman TIDAK ter-scroll saat digeser", sesudah.scrollY === scrollSebelum,
  "scrollY " + scrollSebelum + " → " + sesudah.scrollY);
check("Kolom X/Y ikut berubah", Math.abs(sesudah.fieldX - sesudah.xMm) < 0.05 && Math.abs(sesudah.fieldY - sesudah.yMm) < 0.05,
  "kolom=" + sesudah.fieldX + "," + sesudah.fieldY);

/* -- permukaan "near-miss": jari meleset 12 px dari tepi -- */
const k2 = await posisiLayar(page, "#signDrag");
const s2 = await statePosisi(page);
await geserSentuh(cdpHp, page,
  { x: k2.x - 12, y: k2.y + k2.height / 2 },
  { x: k2.x - 12 + 60, y: k2.y + k2.height / 2 });
const s3 = await statePosisi(page);
check(
  "Jari yang meleset ~12 px dari kotak tetap tertangkap",
  Math.abs(s3.xMm - s2.xMm) > 3,
  "Δx=" + (s3.xMm - s2.xMm).toFixed(1) + " mm"
);

/* -- tap tanpa geser tidak merusak apa pun -- */
const k3 = await posisiLayar(page, "#signDrag");
const s4 = await statePosisi(page);
await tapSentuh(cdpHp, page, { x: k3.x + k3.width / 2, y: k3.y + k3.height / 2 });
const s5 = await statePosisi(page);
check("Tap (tanpa geser) tidak menggeser tanda tangan",
  Math.abs(s5.xMm - s4.xMm) < 0.05 && Math.abs(s5.yMm - s4.yMm) < 0.05,
  "Δx=" + (s5.xMm - s4.xMm).toFixed(2));
check("Tap tidak merusak pratinjau",
  !!(await page.evaluate(() => (window.PDFToolsUI.state.custom.previewInfo || {}).pageWmm)));

/* -- ubah lebar dengan menyeret sudut kanan bawah (tanpa mengetik angka) -- */
const adaResize = await page.evaluate(() => !!document.getElementById("signResize"));
check("Pegangan ubah-lebar tersedia", adaResize === true);
if (adaResize) {
  const kLebar = await posisiLayar(page, "#signResize");
  const sLebar = await statePosisi(page);
  await geserSentuh(cdpHp, page,
    { x: kLebar.x + kLebar.width / 2, y: kLebar.y + kLebar.height / 2 },
    { x: kLebar.x + kLebar.width / 2 + 55, y: kLebar.y + kLebar.height / 2 });
  const sLebar2 = await statePosisi(page);
  check(
    "Menyeret sudut kanan bawah mengubah LEBAR tanda tangan",
    sLebar2.wMm > sLebar.wMm + 2,
    "lebar " + sLebar.wMm + " → " + sLebar2.wMm + " mm"
  );
  check(
    "Rasio tinggi/lebar tetap terjaga saat lebar diubah",
    Math.abs((sLebar2.hMm / sLebar2.wMm) - (sLebar.hMm / sLebar.wMm)) < 0.02,
    "rasio " + (sLebar.hMm / sLebar.wMm).toFixed(3) + " → " + (sLebar2.hMm / sLebar2.wMm).toFixed(3)
  );
  check("Kolom Lebar ikut berubah", Math.abs(sLebar2.fieldW - sLebar2.wMm) < 0.05,
    "kolom=" + sLebar2.fieldW + " state=" + sLebar2.wMm);
  check(
    "Lebar baru tidak membuat tanda tangan keluar halaman",
    sLebar2.xMm + sLebar2.wMm <= sLebar2.pageWmm + 0.05
      && sLebar2.yMm + sLebar2.hMm <= sLebar2.pageHmm + 0.05,
    "x+w=" + (sLebar2.xMm + sLebar2.wMm).toFixed(1) + " / " + sLebar2.pageWmm
  );
}

/* -- hasil geser benar-benar masuk PDF -- */
await page.locator("#signStage").scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.locator("#signStage").screenshot({ path: path.join(SHOTS, "ttd-sentuh-hp.png") });

const pdfB64 = await (async () => {
  try {
    await page.click("#toolRunBtn");
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(250);
      const n = await page.evaluate(() => document.querySelectorAll("#toolResults > *").length);
      if (n > 0) break;
    }
    return await page.evaluate(async () => {
      const a = document.querySelector("#toolResults a");
      if (!a) return "";
      const buf = await (await fetch(a.href)).arrayBuffer();
      const u = new Uint8Array(buf);
      let s = "";
      for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
      return btoa(s);
    });
  } catch (err) {
    return "";
  }
})();
check("PDF hasil dibuat setelah digeser", !!pdfB64, pdfB64 ? Math.round(pdfB64.length * 0.75) + " byte" : "tidak ada");

/* -- tanda tangan hasil geser ada di PDF -- */
if (pdfB64) {
  /* Tanda tangan punya margin transparan di dalam gambarnya, jadi
     posisi tinta tidak sama dengan posisi kotak. Yang dibandingkan
     adalah tinta PRATINJAU dengan tinta PDF — keduanya mengukur hal
     yang sama, jadi margin-nya saling menghilangkan. */
  const inkPratinjau = await page.evaluate(() => {
    const cv = document.getElementById("signPreview");
    const ctx = cv.getContext("2d");
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const pi = (window.PDFToolsUI.state.custom || {}).previewInfo || {};
    const mmpx = pi.pageWmm / cv.width;
    const mmpy = pi.pageHmm / cv.height;
    let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
    for (let y = 0; y < cv.height; y++) {
      for (let x = 0; x < cv.width; x++) {
        const i = (y * cv.width + x) * 4;
        /* Hanya area tanda tangan (kotak) yang diukur, supaya garis
           bantu kotak tidak ikut terhitung. */
        const mmx = x * mmpx, mmy = (cv.height - y - 1) * mmpy;
        if (mmx < pi.xMm - 1 || mmx > pi.xMm + pi.wMm + 1) continue;
        if (mmy < pi.yMm - 1 || mmy > pi.yMm + pi.hMm + 1) continue;
        if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return { ada: false };
    return {
      ada: true,
      x0: minX * mmpx, x1: (maxX + 1) * mmpx,
      y0: (cv.height - (maxY + 1)) * mmpy, y1: (cv.height - minY) * mmpy,
    };
  });
  const ink = await page.evaluate(async (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const doc = await window.pdfjsLib.getDocument({ data: bytes }).promise;
    const hal = await doc.getPage(1);
    const vp = hal.getViewport({ scale: 2 });
    const cv = document.createElement("canvas");
    cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    const cx = cv.getContext("2d", { alpha: false });
    cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
    await hal.render({ canvasContext: cx, viewport: vp }).promise;
    const d = cx.getImageData(0, 0, cv.width, cv.height).data;
    const mmpx = (25.4 / 72) / 2;
    let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
    for (let y = 0; y < cv.height; y++) {
      for (let x = 0; x < cv.width; x++) {
        const i = (y * cv.width + x) * 4;
        if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return { ada: false };
    return {
      ada: true,
      x0: minX * mmpx, x1: (maxX + 1) * mmpx,
      y0: (cv.height - (maxY + 1)) * mmpx, y1: (cv.height - minY) * mmpx,
    };
  }, pdfB64);
  check("Tanda tangan hasil geser ada di PDF akhir", ink.ada === true);
  check("Tanda tangan hasil geser terlihat di pratinjau", inkPratinjau.ada === true);
  if (ink.ada && inkPratinjau.ada) {
    const dx = Math.abs(ink.x0 - inkPratinjau.x0);
    const dy = Math.abs(ink.y0 - inkPratinjau.y0);
    check(
      "Posisi hasil geser dengan JARI sama dengan PDF akhir",
      dx < 2.5 && dy < 2.5,
      "kafka x=" + ink.x0.toFixed(1) + " y=" + ink.y0.toFixed(1)
      + " | pratinjau x=" + inkPratinjau.x0.toFixed(1) + " y=" + inkPratinjau.y0.toFixed(1)
      + " | Δ=" + dx.toFixed(1) + "/" + dy.toFixed(1) + " mm"
    );
  }
}
/* ------------------------------------------------------------------
   2. Layar sangat sempit 320px
   ------------------------------------------------------------------ */
/* CATATAN: headless shell @sparticuz/chromium MATI kalau dibuat konteks
   kedua dengan isMobile:true (batas lingkungan, bukan bug aplikasi).
   Karena itu layar sempit diuji dengan mengganti ukuran viewport pada
   konteks yang sama. */
const pageK = await ctxHp.newPage();
await pageK.setViewportSize(KECIL);
const cdpK = await ctxHp.newCDPSession(pageK);
pageK.on("pageerror", (e) => errors.push("kecil: " + String(e)));
pageK.on("crash", () => errors.push("kecil: halaman crash"));
await pageK.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
await pageK.waitForTimeout(800);
await pageK.evaluate(() => window.PDFToolsUI.openTool("sign"));
await pageK.waitForTimeout(300);
await pageK.setInputFiles("#toolInput", [fixture.kosong]);
await pageK.waitForTimeout(1500);
await tulisTandaTangan(pageK);
const kK = await posisiLayar(pageK, "#signDrag");
const tK = await pageK.evaluate(`(${UKUR_TARGET})()`);
check("Layar 320px: pegangan tetap terlihat", tK.hidden === false);
check("Layar 320px: area tangkap tetap ≥ 44 px", tK.hitW >= 44 && tK.hitH >= 44,
  tK.hitW + " × " + tK.hitH + " px (kotak " + tK.w.toFixed(1) + " × " + tK.h.toFixed(1) + ")");
check("Layar 320px: area tangkap ubah-lebar tetap ≥ 44 px",
  tK.resizeHitW >= 44 && tK.resizeHitH >= 44,
  tK.resizeHitW + " × " + tK.resizeHitH + " px");
const sK1 = await statePosisi(pageK);
await geserSentuh(cdpK, pageK,
  { x: kK.x + kK.width / 2, y: kK.y + kK.height / 2 },
  { x: kK.x + kK.width / 2 + 50, y: kK.y + kK.height / 2 + 30 });
const sK2 = await statePosisi(pageK);
check("Layar 320px: geser dengan jari jalan",
  Math.abs(sK2.xMm - sK1.xMm) > 3 || Math.abs(sK2.yMm - sK1.yMm) > 3,
  "Δx=" + (sK2.xMm - sK1.xMm).toFixed(1) + " Δy=" + (sK2.yMm - sK1.yMm).toFixed(1) + " mm");
await pageK.locator("#signStage").scrollIntoViewIfNeeded();
await pageK.waitForTimeout(300);
await pageK.locator("#signStage").screenshot({ path: path.join(SHOTS, "ttd-sentuh-320.png") });
try { await ctxHp.close(); } catch (_) { /* abaikan */ }

/* ------------------------------------------------------------------
   3. Error JavaScript
   ------------------------------------------------------------------ */
check("Tidak ada error JavaScript selama audit", errors.length === 0, errors.slice(0, 2).join(" | "));

/* ---------- ringkasan ---------- */
const lulus = results.filter((r) => r.ok).length;
const gagal = results.length - lulus;
fs.writeFileSync(path.join(ROOT, "docs", "audit-ttd-sentuh-hasil.json"),
  JSON.stringify({ pass: lulus, fail: gagal, results }, null, 2));
console.log("\n== HASIL: " + lulus + " lulus, " + gagal + " gagal ==");

try { await browser.close(); } catch (_) { /* abaikan */ }
srv.close();
process.exit(gagal ? 1 : 0);
