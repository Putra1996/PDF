/**
 * Audit mendalam fitur "Edit PDF" (editor visual di tool-editor.js).
 *
 * Editor visual punya banyak kemampuan sendiri yang tidak ikut
 * tercakup audit payung:
 *   navigasi halaman, zoom, mode pilih/teks/gambar, sisipkan gambar,
 *   ubah gaya teks, hapus elemen, undo/redo, ubah semua teks,
 *   ekspor Word/Excel/PowerPoint/XPS, simpan/buka proyek,
 *   dan hasil akhir yang digabung ke PDF.
 *
 * Jalankan:
 *   node tools/mkfixtures-semua.mjs
 *   node tools/audit-editor.mjs
 *
 * Env:
 *   PORT     - porta server lokal
 *   SHOT_DIR - folder screenshot bukti
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "./browser.mjs";

const require = createRequire(import.meta.url);
const { PDFDocument } = require("pdf-lib");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(path.join(HERE, ".."));
const FIX = path.resolve(process.env.FIXTURES_DIR || path.join(ROOT, "fixtures", "semua"));
const SHOTS = path.resolve(process.env.SHOT_DIR || path.join(ROOT, "docs", "audit-semua-2026-11-25"));
const PORT = Number(process.env.PORT || 8091);

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".pdf": "application/pdf", ".png": "image/png",
  ".jpg": "image/jpeg", ".wasm": "application/wasm", ".json": "application/json",
  ".svg": "image/svg+xml", ".woff2": "font/woff2",
};

const results = [];
let pass = 0;
let fail = 0;
const cek = (nama, ok, detail = "") => {
  results.push({ nama, ok: !!ok, detail: String(detail || "") });
  ok ? pass++ : fail++;
  console.log(`${ok ? "\u2713" : "\u2717"} ${nama}${detail ? ` — ${detail}` : ""}`);
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

const fx = (n) => path.join(FIX, n);

async function main() {
  const srv = await server();
  const browser = await chromium();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
  await page.waitForTimeout(1000);

  /* ---------- buka alat Edit PDF ---------- */
  await page.evaluate(() => {
    window.PDFApp && window.PDFApp.setTab && window.PDFApp.setTab("tools");
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    document.querySelector('#toolCategories [data-tool="edit"]').click();
  });
  await page.waitForTimeout(700);
  await page.setInputFiles("#toolInput", fx("sample.pdf"));
  await page.waitForTimeout(3500);

  const dbg = () => page.evaluate(() => window.PDFToolsEditor.debug());

  /* ---------- 1. kanvas & isi terdeteksi ---------- */
  let d = await dbg();
  cek("editor: modul termuat & halaman terdeteksi", !!d && d.pages === 3, "halaman=" + (d && d.pages));
  cek("editor: blok teks terdeteksi di halaman 1", !!d && d.texts > 0, "blok=" + (d && d.texts));
  cek("editor: mode awal adalah Pilih", !!d && d.mode === "select", "mode=" + (d && d.mode));
  const kanvasAda = await page.evaluate(() => {
    const c = document.querySelector(".ed-canvas");
    if (!c) return null;
    return { w: c.width, h: c.height };
  });
  cek("editor: kanvas halaman terender", !!kanvasAda && kanvasAda.w > 100 && kanvasAda.h > 100,
    kanvasAda ? kanvasAda.w + "x" + kanvasAda.h : "tidak ada");

  /* ---------- 2. navigasi halaman ---------- */
  await page.click('[data-ed="next"]');
  await page.waitForTimeout(1200);
  d = await dbg();
  cek("editor: tombol halaman berikutnya pindah ke hal. 2", d.pageNo === 2, "pageNo=" + d.pageNo);
  await page.click('[data-ed="prev"]');
  await page.waitForTimeout(1200);
  d = await dbg();
  cek("editor: tombol halaman sebelumnya kembali ke hal. 1", d.pageNo === 1, "pageNo=" + d.pageNo);

  /* ---------- 3. zoom ---------- */
  const z0 = (await dbg()).viewport.scale;
  await page.click('[data-ed="zoomin"]');
  await page.waitForTimeout(700);
  const z1 = (await dbg()).viewport.scale;
  cek("editor: tombol perbesar menaikkan skala", z1 > z0, z0.toFixed(2) + " -> " + z1.toFixed(2));
  await page.click('[data-ed="zoomout"]');
  await page.waitForTimeout(700);
  const z2 = (await dbg()).viewport.scale;
  cek("editor: tombol perkecil mengembalikan skala", Math.abs(z2 - z0) < 0.001, z1.toFixed(2) + " -> " + z2.toFixed(2));

  /* ---------- 4. sisipkan teks baru ---------- */
  await page.click('[data-mode="text"]');
  await page.waitForTimeout(300);
  const kotak = await page.evaluate(() => {
    const l = document.querySelector(".ed-layer");
    if (!l) return null;
    const r = l.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  cek("editor: lapisan interaksi ada", !!kotak, "");
  if (kotak) {
    await page.mouse.click(kotak.x + kotak.w * 0.25, kotak.y + kotak.h * 0.12);
    await page.waitForTimeout(900);
    d = await dbg();
    const opTeks = (d.ops || []).find((o) => o.k === "text" && o.newItem);
    cek("editor: klik di mode Teks membuat blok teks baru", !!opTeks,
      "ops=" + JSON.stringify((d.ops || []).map((o) => o.k)));

    /* isi teks lewat panel inspeksi */
    /* data-field ada pada pembungkus label, kontrolnya di dalam */
    const adaPanel = await page.evaluate(() => {
      const ta = document.querySelector('[data-field="text"] textarea, [data-field="text"] input');
      if (!ta) return false;
      ta.value = "Teks Uji Editor";
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    });
    cek("editor: panel inspeksi teks muncul", adaPanel, "");
    await page.waitForTimeout(500);

    /* ubah ukuran & warna */
    await page.evaluate(() => {
      const s = document.querySelector('[data-field="size"] input');
      if (s) { s.value = "24"; s.dispatchEvent(new Event("input", { bubbles: true })); }
      const c = document.querySelector('[data-field="color"] input');
      if (c) { c.value = "#ff0000"; c.dispatchEvent(new Event("input", { bubbles: true })); }
    });
    await page.waitForTimeout(600);
    d = await dbg();
    const op2 = (d.ops || []).find((o) => o.k === "text" && o.newItem);
    cek("editor: isi teks tersimpan", op2 && op2.text === "Teks Uji Editor", JSON.stringify(op2 && op2.text));
    cek("editor: ukuran teks berubah jadi 24", op2 && Number(op2.size) === 24, "size=" + (op2 && op2.size));
    cek("editor: warna teks berubah jadi merah", op2 && String(op2.color).toLowerCase() === "#ff0000",
      "warna=" + (op2 && op2.color));
  }

  /* ---------- 5. undo / redo ---------- */
  const undoAwal = (await dbg()).undoDepth;
  await page.evaluate(() => window.PDFToolsEditor.undo());
  await page.waitForTimeout(700);
  d = await dbg();
  cek("editor: undo mengurangi riwayat", d.undoDepth < undoAwal || (d.ops || []).length === 0,
    "undoDepth=" + d.undoDepth + " (awal " + undoAwal + ")");
  await page.evaluate(() => window.PDFToolsEditor.redo());
  await page.waitForTimeout(700);
  d = await dbg();
  cek("editor: redo mengembalikan perubahan", d.redoDepth === 0 && (d.ops || []).length > 0,
    "redoDepth=" + d.redoDepth + " ops=" + (d.ops || []).length);

  /* ---------- 6. sisipkan gambar ---------- */
  await page.evaluate(() => {
    const btn = document.querySelector('[data-ed="pick"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(500);
  await page.setInputFiles('[data-ed="file"]', fx("gambar.png"));
  await page.waitForTimeout(1500);
  await page.click('[data-mode="image"]');
  await page.waitForTimeout(300);
  if (kotak) {
    await page.mouse.click(kotak.x + kotak.w * 0.6, kotak.y + kotak.h * 0.2);
    await page.waitForTimeout(900);
    d = await dbg();
    const opImg = (d.ops || []).find((o) => o.k === "image");
    cek("editor: gambar bisa disisipkan ke halaman", !!opImg,
      "ops=" + JSON.stringify((d.ops || []).map((o) => o.k)));
  }

  /* ---------- 7. ubah semua teks (bulk) ---------- */
  await page.evaluate(() => window.PDFToolsEditor.deselect());
  await page.waitForTimeout(600);
  const bulk = await page.evaluate(() => {
    const f = document.querySelector('[data-field="bulkSize"] input');
    if (!f) return false;
    f.value = "30";
    f.dispatchEvent(new Event("input", { bubbles: true }));
    const c = document.querySelector('[data-field="bulkColor"] input');
    if (c) { c.value = "#0066cc"; c.dispatchEvent(new Event("input", { bubbles: true })); }
    const btn = [...document.querySelectorAll(".ed-side button")].find((b) => /semua halaman/i.test(b.textContent));
    if (btn) btn.click();
    return true;
  });
  cek("editor: panel ubah-semua-teks tersedia", bulk, "");
  await page.waitForTimeout(2500);
  d = await dbg();
  /* operasi bulk mewakili blok teks asal PDF (srcId "t0", "t1", ...) */
  const bulkOps = (d.ops || []).filter((o) => /^t\d+$/.test(o.srcId || ""));
  cek("editor: ubah semua teks menambah operasi per blok", bulkOps.length > 0, "blok=" + bulkOps.length);
  cek("editor: ukuran bulk diterapkan", bulkOps.every((o) => Number(o.size) === 30),
    "size=" + (bulkOps[0] && bulkOps[0].size));
  cek("editor: warna bulk diterapkan", bulkOps.every((o) => String(o.color).toLowerCase() === "#0066cc"),
    "warna=" + (bulkOps[0] && bulkOps[0].color));

  /* ---------- 8. ekspor Word / Excel / PowerPoint / XPS ---------- */
  await page.evaluate(() => {
    window.__unduh = [];
    if (!window.__hookPasang) {
      window.__hookPasang = true;
      const asli = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.download) { window.__unduh.push({ nama: this.download, href: this.href }); return; }
        return asli.call(this);
      };
    }
  });
  for (const [btn, ext] of [["docx", ".docx"], ["xlsx", ".xlsx"], ["pptx", ".pptx"], ["xps", ".xps"]]) {
    await page.evaluate(() => {
      const m = document.querySelector('[data-ed="menu"][data-menu="export"]');
      if (m) m.click();
    });
    await page.waitForTimeout(300);
    await page.evaluate((b) => {
      const el = document.querySelector('[data-ed="' + b + '"]');
      if (el) el.click();
    }, btn);
    await page.waitForTimeout(3500);
    const got = await page.evaluate(() => (window.__unduh || []).map((u) => u.nama));
    const ada = got.some((n) => new RegExp(ext.replace(".", "\\.") + "$", "i").test(n));
    cek(`editor: ekspor ${ext} menghasilkan berkas`, ada, got.join(","));
  }

  /* ---------- 9. simpan & buka proyek ---------- */
  await page.evaluate(() => {
    const m = document.querySelector('[data-ed="menu"][data-menu="project"]');
    if (m) m.click();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const el = document.querySelector('[data-ed="saveProject"]');
    if (el) el.click();
  });
  await page.waitForTimeout(2000);
  const proj = await page.evaluate(() => (window.__unduh || []).map((u) => u.nama).filter((n) => /\.json$/i.test(n)));
  cek("editor: simpan proyek membuat berkas .json", proj.length > 0, proj.join(","));

  /* ---------- 10. hasil akhir digabung ke PDF ---------- */
  await page.evaluate(() => {
    const m = document.querySelector('[data-ed="menu"][data-menu="export"]');
    if (m) m.click();
  });
  await page.waitForTimeout(200);
  await page.click("#toolRunBtn");
  let bytes = null;
  for (let i = 0; i < 90; i++) {
    await page.waitForTimeout(500);
    const n = await page.evaluate(() => document.querySelectorAll("#toolResults a").length);
    if (n > 0) break;
  }
  const b64 = await page.evaluate(async () => {
    const a = document.querySelector("#toolResults a");
    if (!a) return null;
    const r = await fetch(a.href);
    const b = new Uint8Array(await r.arrayBuffer());
    let s = "";
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  });
  if (b64) {
    bytes = Buffer.from(b64, "base64");
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.writeFileSync(path.join(SHOTS, "editor-hasil.pdf"), bytes);
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    cek("editor: PDF hasil punya 3 halaman", doc.getPageCount() === 3, "halaman=" + doc.getPageCount());
    const t = await page.evaluate(async (b) => {
      const d2 = await window.pdfjsLib.getDocument({ data: new Uint8Array(b) }).promise;
      let out = "";
      for (let i = 1; i <= d2.numPages; i++) {
        const tc = await (await d2.getPage(i)).getTextContent();
        out += tc.items.map((it) => it.str).join(" ") + "\n";
      }
      await d2.destroy();
      return out;
    }, Array.from(bytes));
    cek("editor: teks baru ikut terbawa ke PDF hasil", /Teks Uji Editor/.test(t), JSON.stringify(t.slice(0, 120)));
  } else {
    cek("editor: PDF hasil terbentuk", false, "tidak ada berkas hasil");
  }

  /* ---------- 11. galat tak tertangani ---------- */
  const nyata = errors.filter((e) => !/favicon/i.test(e));
  cek("editor: tidak ada error konsol fatal", nyata.length === 0, nyata.slice(0, 2).join(" | ").slice(0, 180));

  fs.writeFileSync(path.join(ROOT, "docs", "audit-editor-hasil.json"),
    JSON.stringify({ tanggal: new Date().toISOString(), pass, fail, results }, null, 2));

  console.log(`\n=== RINGKASAN EDITOR: ${pass} lulus, ${fail} gagal (total ${pass + fail}) ===\n`);
  await browser.close();
  srv.close();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
