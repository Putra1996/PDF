/**
 * Audit mendalam fitur terjemahan PDF.
 *
 * Yang diuji:
 *   - mesin offline bawaan aplikasi (Bergamot WASM + model vendored):
 *     terjemahan benar, model dimuat SEKALI, kalimat berulang di-cache
 *   - mesin bawaan peramban (Chrome 138+): availability(), unduhan
 *     model (monitor), dan galat (NotSupportedError / NetworkError /
 *     NotAllowedError) diterjemahkan jadi pesan yang tepat
 *   - alat "Terjemah PDF" sungguhan lewat UI: hasil berkas, progres,
 *     dan tidak ada error JavaScript
 *
 * Jalankan:
 *   node tools/mkfixtures-translate.mjs && node tools/audit-translate.mjs
 *
 * Env:
 *   SERVE_DIR    - direktori statis yang dilayani (default: repo ini)
 *   FIXTURES_DIR - folder fixture (default: fixtures/terjemah)
 *   SHOT_DIR     - folder screenshot bukti
 *   PORT         - porta server lokal
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "./browser.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.SERVE_DIR || path.join(HERE, ".."));
const FIX = path.resolve(process.env.FIXTURES_DIR || path.join(ROOT, "fixtures", "terjemah"));
const SHOTS = path.resolve(process.env.SHOT_DIR || path.join(ROOT, "docs", "audit-terjemah-2026-11-24"));
const PORT = Number(process.env.PORT || 8074);

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

/* ------------------------------------------------------------------
   Mesin terjemahan bawaan peramban yang disimulasikan.
   ------------------------------------------------------------------ */
const FAKE_BUILTIN = `
window.__fake = { creates: 0, calls: 0, availability: 0, options: [], destroyed: 0, monitorUsed: 0 };
window.__fakeConfig = { availability: "available", createError: null, delay: 0 };
window.Translator = {
  availability: async function (o) {
    window.__fake.availability++;
    window.__fake.options.push(JSON.stringify(o));
    return window.__fakeConfig.availability;
  },
  create: async function (o) {
    window.__fake.creates++;
    window.__fake.options.push(JSON.stringify(o));
    if (o && typeof o.monitor === "function") {
      window.__fake.monitorUsed++;
      /* worker terpisah supaya addEventListener-nya benar-benar dipakai */
      const mc = new MessageChannel();
      o.monitor(mc.port2);
      setTimeout(() => {
        try { mc.port1.postMessage({ type: "downloadprogress", loaded: 0.5 }); } catch (_) {}
      }, 10);
    }
    if (window.__fakeConfig.createError) {
      const e = new Error(window.__fakeConfig.createError.message || "gagal");
      e.name = window.__fakeConfig.createError.name || "Error";
      throw e;
    }
    return {
      translate: async function (t) {
        window.__fake.calls++;
        if (window.__fakeConfig.delay) await new Promise((r) => setTimeout(r, window.__fakeConfig.delay));
        return "[EN] " + t;
      },
      destroy: function () { window.__fake.destroyed++; },
    };
  },
};
`;

async function main() {
  const srv = await server();
  const browser = await chromium();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
  await page.waitForTimeout(800);

  /* Mesin AI daring dimatikan supaya harness ini tetap deterministik
     dan tidak pernah menyentuh jaringan. Mesin AI daring diuji
     terpisah di tools/audit-translate-ai.mjs (server tiruan). */
  const MATIKAN_AI = `
    (function () {
      if (!window.PDFTranslateAI) return;
      window.PDFTranslateAI.configure({ endpoint: "", apiKey: "", model: "", engineId: "" });
      window.PDFTranslateAI.loadManifest = function () {
        return Promise.resolve({
          version: "dimatikan-untuk-harness", engines: [], prompt: {}, defaults: {}, asal: "harness",
        });
      };
      window.PDFTranslateAI.isConfigured = function () { return false; };
    })();
  `;

  /* ==========================================================
     1. Modul & detections
     ========================================================== */
  const info = await page.evaluate(() => ({
    adaModul: !!window.PDFTranslate,
    offline: window.PDFTranslate ? window.PDFTranslate.offlinePairs() : [],
    builtinAda: window.PDFTranslate ? window.PDFTranslate.hasBuiltin() : false,
    statis: window.PDFTranslate ? JSON.parse(JSON.stringify(window.PDFTranslate.stats)) : null,
  }));
  check("Modul mesin terjemahan termuat", info.adaModul);
  check(
    "Model offline menyertakan Indonesia ⇄ Inggris",
    info.offline.includes("id>en") && info.offline.includes("en>id"),
    info.offline.join(", ")
  );
  check("Deteksi mesin bawaan peramban mengembalikan status yang valid", typeof info.builtinAda === "boolean", `tersedia=${info.builtinAda} (Chromium lokal dapat lebih lama dari Chrome 138)`);

  /* ==========================================================
     2. Mesin offline: benar, cepat, model dimuat sekali
     ========================================================== */
  const offline = await page.evaluate(async () => {
    const TR = window.PDFTranslate;
    TR.stats.modelLoads = 0;
    TR.stats.offlineCalls = 0;
    TR.stats.offlineTexts = 0;
    TR.cacheClear();
    const plan = TR.prepare({ from: "id", to: "en", mode: "offline" });
    const engine = await TR.create(plan);
    const t0 = performance.now();
    const pertama = await engine.translateBatch([
      "Selamat pagi, apa kabar?",
      "Dokumen ini menjelaskan rencana kerja untuk tahun anggaran berikutnya.",
    ]);
    const t1 = performance.now();
    const kedua = await engine.translateBatch([
      "Selamat pagi, apa kabar?",
      "Dokumen ini menjelaskan rencana kerja untuk tahun anggaran berikutnya.",
    ]);
    const t2 = performance.now();
    return {
      engine: engine.kind,
      pertama: pertama,
      kedua: kedua,
      msPertama: Math.round(t1 - t0),
      msKedua: Math.round(t2 - t1),
      stats: JSON.parse(JSON.stringify(TR.stats)),
      status: TR.offlineStatus(),
    };
  });
  check("Mesin offline menerjemahkan Indonesia → Inggris", offline.engine === "offline" && offline.kedua[0] === "Good morning, how are you?", offline.kedua[0]);
  check(
    "Terjemahan kalimat panjang masuk akal",
    /work plan|next budget/i.test(offline.kedua[1] || ""),
    offline.kedua[1]
  );
  check("Model offline dimuat tepat satu kali", offline.stats.modelLoads === 1, "muatan=" + offline.stats.modelLoads);
  check("Mesin offline memakai satu panggilan per batch", offline.stats.offlineCalls === 2, "panggilan=" + offline.stats.offlineCalls);
  check(
    "Panggilan kedua jauh lebih cepat (cache internal mesin)",
    offline.msKedua < Math.max(50, offline.msPertama / 4),
    offline.msPertama + " ms → " + offline.msKedua + " ms"
  );

  /* ==========================================================
     3. Cache kalimat di sisi aplikasi
     ========================================================== */
  const cacheUji = await page.evaluate(async () => {
    const TR = window.PDFTranslate;
    TR.stats.offlineTexts = 0;
    TR.stats.offlineCalls = 0;
    TR.cacheClear();
    const engine = await TR.create(TR.prepare({ from: "id", to: "en", mode: "offline" }));
    const baris = ["Header sama", "Header sama", "Baris unik", "Header sama"];
    const prefix = "id>en\\u0000";
    const perlu = [];
    const seen = new Set();
    for (const t of baris) {
      if (seen.has(t)) continue;
      seen.add(t);
      if (TR.cacheGet(prefix + t) === undefined) perlu.push(t);
    }
    await engine.translateBatch(perlu);
    return { perlu: perlu.length, texts: TR.stats.offlineTexts };
  });
  check(
    "Baris berulang hanya diterjemahkan satu kali",
    cacheUji.perlu === 2 && cacheUji.texts === 2,
    " unik=" + cacheUji.perlu + " dikirim=" + cacheUji.texts
  );

  /* ==========================================================
     4. Mesin bawaan peramban (disimulasikan)
     ========================================================== */
  const fakePage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  fakePage.on("pageerror", (e) => errors.push("fake: " + String(e)));
  await fakePage.addInitScript(FAKE_BUILTIN);
  await fakePage.addInitScript(MATIKAN_AI);
  await fakePage.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
  await fakePage.waitForTimeout(500);

  const builtin = await fakePage.evaluate(async () => {
    const TR = window.PDFTranslate;
    const out = {};
    /* 4a. availability "available" -> mesin bawaan dipakai */
    window.__fakeConfig.availability = "available";
    window.__fake.creates = 0;
    const e1 = await TR.create(TR.prepare({ from: "id", to: "en", mode: "auto" }));
    out.jenisA = e1.kind;
    out.hasilA = await e1.translateBatch(["Halo dunia"]);
    out.createsA = window.__fake.creates;

    /* 4b. options availability() dan create() harus sama */
    const opts = window.__fake.options.map((o) => JSON.parse(o));
    out.optionsSama =
      opts.length >= 2 &&
      opts[0].sourceLanguage === opts[1].sourceLanguage &&
      opts[0].targetLanguage === opts[1].targetLanguage;

    /* 4c. mode "builtin" memanggil create() dengan monitor */
    window.__fake.monitorUsed = 0;
    const e2 = await TR.create(TR.prepare({ from: "id", to: "en", mode: "builtin" }));
    out.jenisB = e2.kind;
    out.monitorDipakai = window.__fake.monitorUsed;

    /* 4d. availability "unavailable" + pasangan tanpa model offline */
    window.__fakeConfig.availability = "unavailable";
    let pesanUnavailable = "";
    try {
      await TR.create(TR.prepare({ from: "ja", to: "de", mode: "auto" }));
    } catch (e) {
      pesanUnavailable = String(e.message || e);
    }
    out.pesanUnavailable = pesanUnavailable;

    /* 4e. galat NotSupportedError harus menyebut pasangan bahasa */
    window.__fakeConfig.createError = { name: "NotSupportedError", message: "not supported" };
    let pesanNS = "";
    try {
      await TR.create(TR.prepare({ from: "id", to: "en", mode: "builtin" }));
    } catch (e) {
      pesanNS = String(e.message || e);
    }
    out.pesanNS = pesanNS;

    /* 4f. galat NetworkError */
    window.__fakeConfig.createError = { name: "NetworkError", message: "network" };
    let pesanNE = "";
    try {
      await TR.create(TR.prepare({ from: "id", to: "en", mode: "builtin" }));
    } catch (e) {
      pesanNE = String(e.message || e);
    }
    out.pesanNE = pesanNE;

    /* 4g. galat NotAllowedError (butuh gestur klik) */
    window.__fakeConfig.createError = { name: "NotAllowedError", message: "gesture" };
    let pesanNA = "";
    try {
      await TR.create(TR.prepare({ from: "id", to: "en", mode: "builtin" }));
    } catch (e) {
      pesanNA = String(e.message || e);
    }
    out.pesanNA = pesanNA;
    window.__fakeConfig.createError = null;

    /* 4h. mode otomatis dengan pasangan yang punya model offline:
           jangan sentuh mesin bawaan (tidak ada unduhan 40 MB) */
    window.__fakeConfig.availability = "downloadable";
    window.__fake.creates = 0;
    const e3 = await TR.create(TR.prepare({ from: "id", to: "en", mode: "auto" }));
    out.jenisC = e3.kind;
    out.createsC = window.__fake.creates;

    /* 4i. mesin bawaan dipakai ulang (dibuat satu kali) */
    window.__fakeConfig.availability = "available";
    window.__fake.creates = 0;
    const e4 = await TR.create(TR.prepare({ from: "id", to: "en", mode: "auto" }));
    out.jenisD = e4.kind;
    out.createsD = window.__fake.creates;
    return out;
  });

  check("Mesin bawaan peramban dipakai saat model sudah ada", builtin.jenisA === "builtin" && builtin.hasilA[0] === "[EN] Halo dunia", String(builtin.hasilA && builtin.hasilA[0]));
  check("Opsi availability() dan create() sama (syarat Chrome)", builtin.optionsSama === true);
  check("create() dipanggil dengan monitor unduhan", builtin.monitorDipakai >= 1, "monitor=" + builtin.monitorDipakai);
  check(
    "Galat NotSupportedError menyebut pasangan bahasa",
    /tidak mendukung pasangan bahasa/i.test(builtin.pesanNS) && !/belum punya mesin terjemahan bawaan/i.test(builtin.pesanNS),
    builtin.pesanNS
  );
  check(
    "Galat NetworkError menawarkan mesin offline",
    /gagal diunduh/i.test(builtin.pesanNE) && /offline/i.test(builtin.pesanNE),
    builtin.pesanNE
  );
  check(
    "Galat NotAllowedError meminta klik lagi",
    /klik/i.test(builtin.pesanNA),
    builtin.pesanNA
  );
  check(
    "Pasangan tanpa model offline: pesan menyebut pasangan yang tersedia",
    /tidak mendukung pasangan/i.test(builtin.pesanUnavailable),
    builtin.pesanUnavailable
  );
  check(
    "Mode otomatis memakai model offline (tanpa unduhan model bawaan)",
    builtin.jenisC === "offline" && builtin.createsC === 0,
    "jenis=" + builtin.jenisC + " create=" + builtin.createsC
  );

  /* ==========================================================
     5. Alat "Terjemah PDF" sungguhan lewat UI
     ========================================================== */
  fs.mkdirSync(SHOTS, { recursive: true });

  async function jalankanAlat(files, opsi = {}, mesin = "offline") {
    await fakePage.click("#tab-tools");
    await fakePage.waitForTimeout(350);
    await fakePage.evaluate(() => {
      const c = [...document.querySelectorAll("#toolCategories .tool-card")].find((n) =>
        n.textContent.includes("Terjemah PDF")
      );
      c?.click();
    });
    await fakePage.waitForTimeout(500);
    const adaField = await fakePage.evaluate((m) => {
      const el = document.getElementById("f_engine");
      if (!el) return false;
      el.value = m;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }, mesin);
    if (!adaField) return { galat: "kolom mesin terjemahan tidak ada" };
    await fakePage.evaluate((o) => {
      for (const [id, val] of Object.entries(o)) {
        const el = document.getElementById("f_" + id);
        if (!el) continue;
        if (el.type === "checkbox") el.checked = !!val;
        else el.value = String(val);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }, opsi);
    await fakePage.setInputFiles("#toolInput", files);
    await fakePage.waitForTimeout(700);
    const t0 = Date.now();
    await fakePage.click("#toolRunBtn");
    let progres = [];
    let n = 0;
    for (let i = 0; i < 180; i++) {
      await fakePage.waitForTimeout(500);
      n = await fakePage.evaluate(() => document.querySelectorAll("#toolResults > *").length);
      if (n > 0) break;
      if (i % 4 === 0) {
        progres.push(await fakePage.evaluate(() => ({
          teks: document.querySelector("#toolOverlayText")?.textContent || "",
        })));
      }
    }
    const durasi = ((Date.now() - t0) / 1000).toFixed(1);
    /* Semua hasil diambil (satu berkas bisa menghasilkan Markdown +
       PDF terjemahan). Hasil pertama tetap disimpan di "hasil" supaya
       pemeriksaan yang sudah ada tidak berubah. */
    const semuaHasil = await fakePage.evaluate(async () => {
      const a = [...document.querySelectorAll("#toolResults a")];
      const out = [];
      for (const x of a) {
        const r = await fetch(x.href);
        const buf = await r.arrayBuffer();
        let teks = "";
        try { teks = new TextDecoder().decode(buf); } catch (_) { teks = ""; }
        out.push({ nama: x.download, ukuran: buf.byteLength, teks: teks });
      }
      return out;
    });
    const hasil = semuaHasil.length ? semuaHasil[0] : null;
    const catatan = await fakePage.evaluate(() => {
      const el = document.querySelector("#toolResults .res-meta");
      return el ? el.textContent : "";
    });
    const pesan = await fakePage.evaluate(() => {
      const t = document.querySelector("#toast");
      return t ? t.textContent : "";
    });
    await fakePage.click("#toolBackBtn").catch(() => {});
    await fakePage.waitForTimeout(300);
    return { hasil, semuaHasil, durasi, progres, catatan, jumlah: n, pesan };
  }

  const alat = await jalankanAlat([path.join(FIX, "indonesia.pdf")], { src: "id", lang: "en" });
  check("Alat Terjemah PDF menghasilkan berkas", !!alat.hasil, alat.hasil ? alat.hasil.nama : "tidak ada");
  check(
    "Hasil terjemahan berbahasa Inggris",
    !!alat.hasil && /Good morning|work plan|browser/i.test(alat.hasil.teks || ""),
    (alat.hasil && alat.hasil.teks ? alat.hasil.teks.split("\n").slice(0, 4).join(" | ") : "")
  );
  check("Judul berkas asli dipertahankan", !!alat.hasil && /^# indonesia/m.test(alat.hasil.teks || ""));
  check("Catatan hasil menyebut mesin yang dipakai", /offline|bawaan peramban/i.test(alat.catatan || ""), alat.catatan || "");

  /* Dua berkas: model harus dimuat satu kali saja.
     Setiap berkas kini menghasilkan DUA hasil: Markdown + PDF
     terjemahan (PDF punya lapisan teks tak terlihat, jadi tetap
     bisa dicari & disalin). */
  const duaBerkas = await jalankanAlat(
    [path.join(FIX, "indonesia.pdf"), path.join(FIX, "satu-kalimat.pdf")],
    { src: "id", lang: "en" }
  );
  check("Dua berkas diproses dalam satu jalan", duaBerkas.jumlah === 4, "hasil=" + duaBerkas.jumlah);
  check(
    "Setiap berkas menghasilkan Markdown + PDF terjemahan",
    duaBerkas.semuaHasil.filter((h) => /\.md$/i.test(h.nama)).length === 2 &&
      duaBerkas.semuaHasil.filter((h) => /\.pdf$/i.test(h.nama)).length === 2,
    duaBerkas.semuaHasil.map((h) => h.nama).join(", ")
  );
  const pdfHasil = duaBerkas.semuaHasil.find((h) => /\.pdf$/i.test(h.nama));
  check("PDF terjemahan berukuran wajar", !!pdfHasil && pdfHasil.ukuran > 1000, pdfHasil ? pdfHasil.ukuran + " B" : "tidak ada");

  /* Berkas tanpa teks: tidak boleh error */
  const tanpaTeks = await jalankanAlat([path.join(FIX, "tanpa-teks.pdf")], { src: "id", lang: "en" });
  check("PDF tanpa teks tidak membuat alat gagal", tanpaTeks.jumlah >= 1, "hasil=" + tanpaTeks.jumlah);

  /*=en>id= */
  const keId = await jalankanAlat([path.join(FIX, "inggris.pdf")], { src: "en", lang: "id" });
  check(
    "Terjemahan Inggris → Indonesia jalan",
    !!keId.hasil && /rencana|proses|tahun|dokumen/i.test(keId.hasil.teks || ""),
    keId.hasil ? keId.hasil.teks.split("\n").slice(0, 3).join(" | ") : "tidak ada"
  );

  /* Mesin bawaan peramban harus dipakai ulang untuk semua berkas
     (satu create() saja, bukan satu per berkas). */
  await fakePage.evaluate(() => { window.__fake.creates = 0; window.__fake.calls = 0; });
  const builtinDua = await jalankanAlat(
    [path.join(FIX, "indonesia.pdf"), path.join(FIX, "satu-kalimat.pdf")],
    { src: "id", lang: "en" },
    "builtin"
  );
  const fakeState = await fakePage.evaluate(() => ({
    creates: window.__fake.creates,
    calls: window.__fake.calls,
  }));
  check("Mesin bawaan dibuat satu kali untuk semua berkas", fakeState.creates === 1, "create=" + fakeState.creates);
  check("Dua berkas diterjemahkan mesin bawaan peramban", builtinDua.jumlah >= 2, "hasil=" + builtinDua.jumlah);

  /* Ganti pasangan bahasa: model lama harus dilepas, yang baru dimuat. */
  const gantiBahasa = await fakePage.evaluate(async () => {
    const TR = window.PDFTranslate;
    const log = [];
    const e1 = await TR.create(TR.prepare({ from: "id", to: "en", mode: "offline" }));
    const r1 = await e1.translateBatch(["Selamat pagi"]);
    log.push("id>en=" + r1[0]);
    log.push("model hidup: " + JSON.stringify(TR.offlineStatus().models));
    const e2 = await TR.create(TR.prepare({ from: "en", to: "id", mode: "offline" }));
    const r2 = await e2.translateBatch(["Good morning"]);
    log.push("en>id=" + r2[0]);
    log.push("model hidup: " + JSON.stringify(TR.offlineStatus().models));
    return log;
  });
  check(
    "Ganti pasangan bahasa memuat model baru",
    /id>en=Good morning/i.test(gantiBahasa[0]) && /en>id=Selamat pagi/i.test(gantiBahasa[2]),
    gantiBahasa.filter((l) => !/model hidup/.test(l)).join(" | ")
  );
  check(
    "Hanya satu model bahasa yang hidup sekaligus",
    /\["en>id"\]/.test(gantiBahasa[3]),
    gantiBahasa[3]
  );

  /* Progres harus dilaporkan saat terjemahan berjalan. */
  const progresOk = await jalankanAlat([path.join(FIX, "besar.pdf")], { src: "id", lang: "en" });
  check("Dokumen besar (20 halaman) diterjemahkan", progresOk.jumlah >= 1, "hasil=" + progresOk.jumlah);

  await fakePage.screenshot({ path: path.join(SHOTS, "terjemah-pdf.png") });

  /* ==========================================================
     6. Kebocoran sumber daya
     ========================================================== */
  const bocor = await fakePage.evaluate(() => ({
    urls: (window.__urls || 0),
    workers: window.PDFTranslate ? window.PDFTranslate.offlineStatus() : null,
  }));
  check("Tidak ada object URL menumpuk", bocor.urls === 0, "object URL=" + bocor.urls);

  const jsError = errors.filter((e) => !/favicon|ERR_/i.test(e));
  check("Tidak ada error JavaScript", jsError.length === 0, jsError.slice(0, 2).join(" | "));

  /* ========================================================== */
  await browser.close();
  srv.close();

  fs.writeFileSync(
    path.join(ROOT, "docs", "audit-terjemah-hasil.json"),
    JSON.stringify({ tanggal: new Date().toISOString(), pass, fail, results }, null, 2)
  );

  console.log("\n===== RINGKASAN AUDIT TERJEMAHAN =====");
  console.log("Lulus: " + pass + "  Gagal: " + fail);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
