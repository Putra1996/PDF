/**
 * Benchmark fitur terjemahan.
 *
 * Membandingkan dua strategi yang dipakai fitur "Terjemah PDF":
 *
 *   LAMA  : satu string per halaman (seluruh halaman dikirim utuh),
 *           mesin dibuat ulang untuk tiap berkas, kalimat berulang
 *           diterjemahkan ulang.
 *   BARU  : dipecah per baris, satu mesin dipakai untuk semua berkas,
 *           kalimat yang sama memakai cache (LRU).
 *
 * Dua mesin diukur:
 *   - offline  : Bergamot WASM + model vendored (diamati beneran)
 *   - bawaan   : Translator API bawaan peramban (disimulasikan supaya
 *                 biayanya bisa dikendalikan dan dibandingkan adil)
 *
 * Jalankan: node tools/mkfixtures-translate.mjs && node tools/bench-translate.mjs
 *
 * Env:
 *   SERVE_DIR  - direktori statis yang dilayani (default: repo ini)
 *   FIXTURES_DIR - folder fixture (default: fixtures/terjemah)
 *   PORT       - porta server lokal
 *   OUT        - berkas JSON hasil (default: docs/bench-terjemah-hasil.json)
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "./browser.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.SERVE_DIR || path.join(HERE, ".."));
const FIX = path.resolve(process.env.FIXTURES_DIR || path.join(ROOT, "fixtures", "terjemah"));
const OUT = path.resolve(process.env.OUT || path.join(ROOT, "docs", "bench-terjemah-hasil.json"));
const PORT = Number(process.env.PORT || 8075);

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".pdf": "application/pdf", ".png": "image/png",
  ".svg": "image/svg+xml", ".wasm": "application/wasm", ".json": "application/json",
  ".gz": "application/octet-stream", ".yml": "text/plain; charset=utf-8",
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

/* Mesin bawaan peramban yang disimulasikan: biaya per terjemahan dan
   biaya "memuat model" bisa diatur supaya perbandingan adil. */
const FAKE = `
window.__fake = { creates: 0, calls: 0, texts: 0 };
window.__fakeConfig = { perSentence: 12, perCall: 1, perCreate: 250 };
window.Translator = {
  availability: async function () { return "available"; },
  create: async function () {
    window.__fake.creates++;
    await new Promise((r) => setTimeout(r, window.__fakeConfig.perCreate));
    return {
      translate: async function (t) {
        window.__fake.calls++;
        window.__fake.texts += 1;
        /* Mesin bawaan peramban menerjemahkan kalimat per kalimat,
           jadi biayanya ikut jumlah kalimat, bukan jumlah panggilan. */
        const kalimat = String(t).split(/(?<=[.!?])\\s+/).filter((x) => x.trim()).length || 1;
        const ms = window.__fakeConfig.perSentence * kalimat + window.__fakeConfig.perCall;
        await new Promise((r) => setTimeout(r, ms));
        return "[EN] " + t;
      },
      destroy: function () {},
    };
  },
};
`;

async function main() {
  const srv = await server();
  const browser = await chromium();

  /* ==========================================================
     1. Mesin offline (Bergamot asli)
     ========================================================== */
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
  await page.waitForTimeout(500);

  const offline = await page.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const TR = window.PDFTranslate;
    const out = {};

    /* Ambil teks per halaman dengan urutan baris yang sama seperti alat. */
    const pdfjs = await window.pdfjsLib.getDocument({ data: bin }).promise;
    const halaman = [];
    for (let i = 1; i <= pdfjs.numPages; i++) {
      const tc = await (await pdfjs.getPage(i)).getTextContent();
      const items = tc.items
        .filter((it) => it.str && it.str.trim())
        .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], h: it.height || Math.abs(it.transform[3]) || 10 }));
      const rows = [];
      for (const it of items) {
        let row = null;
        for (const r of rows) if (Math.abs(r.y - it.y) < Math.max(2, it.h * 0.5)) { row = r; break; }
        if (!row) { row = { y: it.y, items: [] }; rows.push(row); }
        row.items.push(it);
      }
      rows.sort((a, b) => b.y - a.y);
      const baris = [];
      for (const r of rows) {
        r.items.sort((a, b) => a.x - b.x);
        const t = r.items.map((i) => i.str).join("").replace(/\s+/g, " ").trim();
        if (t) baris.push(t);
      }
      halaman.push(baris);
    }
    await pdfjs.destroy();
    out.jumlahHalaman = halaman.length;
    out.jumlahBaris = halaman.reduce((a, h) => a + h.length, 0);
    out.barisUnik = new Set(halaman.flat()).size;

    /* --- LAMA: satu string per halaman, tanpa cache --- */
    TR.cacheClear();
    let t0 = performance.now();
    const engine = await TR.create(TR.prepare({ from: "id", to: "en", mode: "offline" }));
    const tSiap = performance.now() - t0;
    t0 = performance.now();
    for (const h of halaman) {
      await engine.translateBatch([h.join("\n")]);   /* seluruh halaman utuh */
    }
    out.lamaMs = Math.round(performance.now() - t0);
    out.lamaPanggilan = TR.stats.offlineCalls;
    out.lamaTeks = TR.stats.offlineTexts;
    out.siapMs = Math.round(tSiap);

    /* --- BARU: per baris + cache kalimat --- */
    TR.cacheClear();
    TR.stats.offlineCalls = 0;
    TR.stats.offlineTexts = 0;
    t0 = performance.now();
    const prefix = "id>en\\u0000";
    let diproses = 0;
    for (const h of halaman) {
      const perlu = [];
      const seen = new Set();
      for (const t of h) {
        if (seen.has(t)) continue;
        seen.add(t);
        if (TR.cacheGet(prefix + t) === undefined) perlu.push(t);
      }
      if (perlu.length) {
        const res = await engine.translateBatch(perlu);
        for (let i = 0; i < perlu.length; i++) TR.cacheSet(prefix + perlu[i], res[i] || "");
        diproses += res.length;
      }
    }
    out.baruMs = Math.round(performance.now() - t0);
    out.baruPanggilan = TR.stats.offlineCalls;
    out.baruTeks = TR.stats.offlineTexts;
    out.baruDiterjemahkan = diproses;

    /* --- Skenario tanpa duplikasi: tiap baris unik (tanpa bantuan cache) --- */
    const unik = [];
    for (let h = 0; h < halaman.length; h++) {
      unik.push(halaman[h].map((t, i) => t + " (bagian " + h + "-" + i + ")"));
    }
    TR.cacheClear();
    TR.stats.offlineCalls = 0;
    TR.stats.offlineTexts = 0;
    t0 = performance.now();
    for (const h of unik) await engine.translateBatch([h.join("\n")]);
    out.unikLamaMs = Math.round(performance.now() - t0);
    out.unikLamaTeks = TR.stats.offlineTexts;
    TR.cacheClear();
    TR.stats.offlineCalls = 0;
    TR.stats.offlineTexts = 0;
    t0 = performance.now();
    for (const h of unik) {
      const perlu = [];
      const seen = new Set();
      for (const t of h) {
        if (seen.has(t)) continue;
        seen.add(t);
        if (TR.cacheGet(prefix + t) === undefined) perlu.push(t);
      }
      if (perlu.length) {
        const res = await engine.translateBatch(perlu);
        for (let i = 0; i < perlu.length; i++) TR.cacheSet(prefix + perlu[i], res[i] || "");
      }
    }
    out.unikBaruMs = Math.round(performance.now() - t0);
    out.unikBaruTeks = TR.stats.offlineTexts;
    return out;
  }, fs.readFileSync(path.join(FIX, "besar.pdf")).toString("base64"));

  /* Tutup peramban pertama: mesin Bergamot memakai banyak memori
     WASM, jadi jangan digabung dengan pengukuran berikutnya. */
  await page.close();
  await browser.close();

  /* ==========================================================
     2. Mesin bawaan peramban (disimulasikan)
     ========================================================== */
  const browser2 = await chromium();
  const page2 = await browser2.newPage({ viewport: { width: 1280, height: 800 } });
  await page2.addInitScript(FAKE);
  await page2.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
  await page2.waitForTimeout(400);

  const builtin = await page2.evaluate(async () => {
    const out = {};
    const TR = window.PDFTranslate;
    const Halaman = 20;
    const BarisPerHalaman = 40;
    const teks = [];
    for (let h = 0; h < Halaman; h++) {
      const arr = [];
      for (let b = 0; b < BarisPerHalaman; b++) {
        arr.push("Kalimat nomor " + (h * BarisPerHalaman + b) + " pada halaman " + h + ".");
      }
      teks.push(arr);
    }
    out.jumlahHalaman = Halaman;
    out.jumlahBaris = Halaman * BarisPerHalaman;

    /* --- LAMA: mesin baru tiap berkas, satu string per halaman --- */
    window.__fake.creates = 0;
    window.__fake.calls = 0;
    let t0 = performance.now();
    for (let f = 0; f < 3; f++) {
      const t = await window.Translator.create({ sourceLanguage: "id", targetLanguage: "en" });
      for (const h of teks) await t.translate(h.join("\n"));
      t.destroy();
    }
    out.lamaMs = Math.round(performance.now() - t0);
    out.lamaCreates = window.__fake.creates;
    out.lamaCalls = window.__fake.calls;

    /* --- BARU: satu mesin untuk semua berkas, per baris + cache --- */
    TR.cacheClear();
    window.__fake.creates = 0;
    window.__fake.calls = 0;
    t0 = performance.now();
    const engine = await TR.create(TR.prepare({ from: "id", to: "en", mode: "builtin" }));
    const prefix = "id>en\\u0000";
    for (const h of teks) {
      const perlu = [];
      const seen = new Set();
      for (const t of h) {
        if (seen.has(t)) continue;
        seen.add(t);
        if (TR.cacheGet(prefix + t) === undefined) perlu.push(t);
      }
      if (perlu.length) {
        const res = await engine.translateBatch(perlu);
        for (let i = 0; i < perlu.length; i++) TR.cacheSet(prefix + perlu[i], res[i] || "");
      }
    }
    out.baruMs = Math.round(performance.now() - t0);
    out.baruCreates = window.__fake.creates;
    out.baruCalls = window.__fake.calls;
    return out;
  });

  await browser2.close();
  srv.close();

  const hasil = {
    tanggal: new Date().toISOString(),
    catatan:
      "Mesin offline diukur dengan Bergamot WASM sungguhan. Mesin bawaan peramban disimulasikan " +
      "(12 ms per kalimat + 1 ms per panggilan + 250 ms pemuatan model) supaya biaya sisi aplikasi " +
      "bisa dibandingkan adil. Skenario 'LAMA' = satu string per halaman + mesin baru tiap berkas; " +
      "'BARU' = per baris + satu mesin untuk semua berkas + cache kalimat.",
    offline: offline,
    bawaan: builtin,
    rangkuman: {
      offlinePemercepat: offline.lamaMs ? Math.round((offline.lamaMs / Math.max(1, offline.baruMs)) * 10) / 10 : null,
      offlineTanpaDuplikasiPemercepat: offline.unikLamaMs ? Math.round((offline.unikLamaMs / Math.max(1, offline.unikBaruMs)) * 10) / 10 : null,
      bawaanPemercepat: builtin.lamaMs ? Math.round((builtin.lamaMs / Math.max(1, builtin.baruMs)) * 10) / 10 : null,
    },
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(hasil, null, 2));

  console.log("== Mesin offline (Bergamot, nyata) ==");
  console.log("  halaman:", offline.jumlahHalaman, "baris:", offline.jumlahBaris, "unik:", offline.barisUnik);
  console.log("  LAMA :", offline.lamaMs, "ms |", offline.lamaPanggilan, "panggilan |", offline.lamaTeks, "teks");
  console.log("  BARU :", offline.baruMs, "ms |", offline.baruPanggilan, "panggilan |", offline.baruTeks, "teks");
  console.log("  (waktu muat model:", offline.siapMs, "ms — dihitung terpisah)");
  console.log("  tanpa duplikasi (isi unik):");
  console.log("    LAMA :", offline.unikLamaMs, "ms |", offline.unikLamaTeks, "teks");
  console.log("    BARU :", offline.unikBaruMs, "ms |", offline.unikBaruTeks, "teks");
  console.log("== Mesin bawaan peramban (disimulasikan) ==");
  console.log("  LAMA :", builtin.lamaMs, "ms | create:", builtin.lamaCreates, "| panggilan:", builtin.lamaCalls);
  console.log("  BARU :", builtin.baruMs, "ms | create:", builtin.baruCreates, "| panggilan:", builtin.baruCalls);
  console.log("Tersimpan:", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
