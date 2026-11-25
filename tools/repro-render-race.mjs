/**
 * Reproduksi bug: "Cannot use the same canvas during multiple render()
 * operations" pada pratinjau alat Tanda tangani PDF.
 *
 * Akar masalah: pratinjau memakai kanvas yang sama (persisten) untuk
 * setiap render halaman. pdf.js menyimpan kumpulan kanvas yang sedang
 * dipakai; kalau render() dipanggil lagi pada kanvas yang sama sebelum
 * render sebelumnya selesai, pdf.js melempar error.
 *
 * Repro: CPU dikepas (throttle) supaya render halaman lambat, lalu
 * pratinjau dipicu dua kali beruntun -> dua render tumpang tindih.
 *
 * Jalankan:
 *   node tools/repro-render-race.mjs
 *
 * Env:
 *   SERVE_DIR - direktori statis (default: repo ini)
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "./browser.mjs";

const ROOT = path.resolve(process.env.SERVE_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const PORT = Number(process.env.PORT || 8131);
const FIXTURE = path.join(ROOT, "fixtures/ttd/multi.pdf");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".wasm": "application/wasm",
  ".mjs": "text/javascript; charset=utf-8",
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);
  let f = path.join(ROOT, url === "/" ? "index.html" : url);
  if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end("404"); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const browser = await chromium();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
await page.waitForTimeout(700);
await page.evaluate(() => window.PDFToolsUI.openTool("sign"));
await page.waitForTimeout(300);
await page.setInputFiles("#toolInput", [FIXTURE]);
await page.waitForTimeout(1500);

const hintAwal = await page.evaluate(() => document.getElementById("signPreviewHint").textContent);
console.log("hint awal :", hintAwal);

/* Tanda tangan supaya pratinjau juga menggambar overlay. */
const pad = await page.locator("#signPad").boundingBox();
await page.mouse.move(pad.x + 60, pad.y + pad.height * 0.6);
await page.mouse.down();
await page.mouse.move(pad.x + 140, pad.y + pad.height * 0.3, { steps: 6 });
await page.mouse.move(pad.x + 230, pad.y + pad.height * 0.7, { steps: 6 });
await page.mouse.up();
await page.click("#signSave");
await page.waitForTimeout(900);

/* CPU di-throttle supaya render halaman lambat -> ada窗口 di mana
   render berikutnya bisa menabrak render yang sedang jalan. */
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 20 });

/* ------------------------------------------------------------------
   Repro 1: klik "halaman berikutnya" dua kali beruntun.
   ------------------------------------------------------------------ */
await page.evaluate(() => {
  const btn = document.getElementById("signNext");
  btn.click();
  btn.click();
});
await page.waitForTimeout(6000);
const hint1 = await page.evaluate(() => document.getElementById("signPreviewHint").textContent);
console.log("hint 1   :", hint1);

/* ------------------------------------------------------------------
   Repro 2: ganti halaman lewat tombol, lalu ketik kolom X ->
   timer 160 ms memicu render kedua saat render pertama masih jalan.
   ------------------------------------------------------------------ */
await page.evaluate(() => {
  const btn = document.getElementById("signPrev");
  btn.click();
});
await page.waitForTimeout(120);
await page.evaluate(() => {
  const el = document.getElementById("f_x");
  el.value = "35";
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(6000);
const hint2 = await page.evaluate(() => document.getElementById("signPreviewHint").textContent);
console.log("hint 2   :", hint2);

/* ------------------------------------------------------------------
   Repro 3: panggil refreshPreview() dua kali tanpa menunggu
   (pola yang sama dengan pemicu di UI).
   ------------------------------------------------------------------ */
await page.evaluate(async () => {
  const c = window.PDFToolsUI.state.custom;
  c.refreshPreview();
  await new Promise((r) => setTimeout(r, 5));
  c.refreshPreview();
});
await page.waitForTimeout(6000);
const hint3 = await page.evaluate(() => document.getElementById("signPreviewHint").textContent);
console.log("hint 3   :", hint3);

const sama = /Cannot use the same canvas/i.test(hintAwal)
  || /Cannot use the same canvas/i.test(hint1)
  || /Cannot use the same canvas/i.test(hint2)
  || /Cannot use the same canvas/i.test(hint3);

console.log("\n=== HASIL ===");
console.log(sama
  ? "BUG TER reproduce: pesan error SAME CANVAS muncul"
  : "BUG TIDAK ter reproduce");
if (errors.length) console.log("pageerror:", errors.slice(0, 3));

await browser.close();
server.close();
process.exit(sama ? 1 : 0);
