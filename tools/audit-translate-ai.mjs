/**
 * Audit mendalam fitur terjemahan AI DARING (tool-translate-ai.js).
 *
 * Semua percobaan dilakukan terhadap server AI tiruan (mock) yang berjalan
 * di localhost, jadi hasilnya deterministik dan tidak bergantung
 * internet.
 *
 * Yang diuji:
 *   - manifest mesin AI diambil dari server (bukan dari berkas lokal)
 *   - PERBAIKAN DI SERVER langsung ikut terpakai: versi manifest,
 *     model, dan endpoint yang berubah terdeteksi tanpa reload
 *   - mesin AI menerjemahkan per kalimat lengkap (bukan per baris)
 *   - beberapa baris berurutan dikirim dalam SATU permintaan
 *     (model membaca konteks -> terjemahan lebih akurat)
 *   - glosarium ikut dikirim ke server
 *   - angka / kode / URL TIDAK dikirim ke server
 *   - cache kalimat terisolasi per mesin (hasil mesin lama tidak
 *     bocor ke mesin baru)
 *   - server AI gagal -> otomatis turun ke mesin bawaan peramban /
 *     offline, dan perpindahan mesin dilaporkan ke pengguna
 *   - percobaan ulang saat server sempat error 5xx
 *   - kunci API tidak pernah bocor ke pesan galat
 *   - alat "Terjemah PDF" sungguhan: hasil .md + .pdf, PDF punya
 *     lapisan teks tak terlihat (hasilnya bisa dicari)
 *
 * Jalankan:
 *   node tools/mkfixtures-translate-ai.mjs && node tools/audit-translate-ai.mjs
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "./browser.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.SERVE_DIR || path.join(HERE, ".."));
const FIX = path.resolve(process.env.FIXTURES_DIR || path.join(ROOT, "fixtures", "terjemah-ai"));
const SHOTS = path.resolve(process.env.SHOT_DIR || path.join(ROOT, "docs", "audit-terjemah-ai-2026-11-26"));
const PORT = Number(process.env.PORT || 8075);
const AI_PORT = Number(process.env.AI_PORT || 8076);

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
  ".svg": "image/svg+xml", ".wasm": "application/wasm", ".json": "application/json; charset=utf-8",
  ".gz": "application/octet-stream", ".yml": "text/plain; charset=utf-8",
};

/* ---------- server statis untuk aplikasi ---------- */
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

/* ============================================================
   Server AI tiruan
   ------------------------------------------------------------
   Menyediakan:
     GET  /manifest            -> manifest mesin (versi bisa diubah)
     POST /v1/chat/completions -> protokol OpenAI-compatible
     GET  /get                 -> protokol MyMemory
     POST /translate           -> protokol LibreTranslate
     POST /custom              -> protokol custom
     GET  /__log               -> daftar permintaan yang masuk
     POST /__control           -> pengaturan galat tiruan
   ============================================================ */
const log = [];
let control = { failTimes: 0, authError: false, status: 0, delayMs: 0 };
let manifest = {
  version: "uji-1",
  updatedAt: "2026-11-26T00:00:00Z",
  engines: [
    {
      id: "llm",
      label: "AI LLM uji",
      protocol: "openai",
      endpoint: `http://127.0.0.1:${AI_PORT}/v1/chat/completions`,
      model: "model-uji-v1",
      priority: 100,
      requiresKey: true,
      maxItems: 10,
      maxChars: 4000,
      pairs: "all",
    },
    {
      id: "mymemory",
      label: "MyMemory uji",
      protocol: "mymemory",
      endpoint: `http://127.0.0.1:${AI_PORT}/get`,
      priority: 50,
      requiresKey: false,
      maxItems: 5,
      maxChars: 400,
      pairs: "all",
    },
  ],
  prompt: {
    system: "Anda penerjemah profesional. Terjemahkan dari {from} ke {to}. Balas larik JSON.",
    user: "Terjemahkan:\n{glossary}\n{items}\nBalas larik JSON berisi {n} string.",
  },
  defaults: { timeoutMs: 8000, retries: 2, concurrency: 2, temperature: 0.1 },
};

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function bacaBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });
}

function mockAiServer() {
  const s = http.createServer(async (req, res) => {
    cors(res);
    const url = decodeURIComponent((req.url || "/").split("?")[0]);
    if (req.method === "OPTIONS") return res.writeHead(204).end();
    const body = req.method === "POST" ? await bacaBody(req) : "";

    if (url === "/manifest") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(manifest));
    }
    if (url === "/__log") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(log));
    }
    if (url === "/__control") {
      try { control = Object.assign(control, JSON.parse(body || "{}")); } catch (_) { /* abaikan */ }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(control));
    }
    if (url === "/__reset") {
      log.length = 0;
      control = { failTimes: 0, authError: false, status: 0, delayMs: 0 };
      res.writeHead(200, { "content-type": "application/json" });
      return res.end("ok");
    }

    /* Galat tiruan (untuk menguji percobaan ulang & fallback). */
    if (control.failTimes > 0) {
      control.failTimes--;
      res.writeHead(500, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "galat tiruan" }));
    }
    if (control.authError) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "kunci ditolak" }));
    }
    if (control.status) {
      res.writeHead(control.status, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "status tiruan" }));
    }
    if (control.delayMs) await new Promise((r) => setTimeout(r, control.delayMs));

    /* Protokol OpenAI-compatible. */
    if (url === "/v1/chat/completions") {
      let req2 = {};
      try { req2 = JSON.parse(body || "{}"); } catch (_) { req2 = {}; }
      log.push({ protocol: "openai", headers: req.headers, body: req2 });
      const user = (req2.messages || []).map((m) => m.content).join("\n");
      const baris = String(user)
        .split("\n")
        .filter((l) => /^\d+\.\s/.test(l))
        .map((l) => l.replace(/^\d+\.\s*/, ""));
      const hasil = baris.map((t) => "EN " + t);
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: JSON.stringify(hasil) } }],
          model: req2.model || "",
        })
      );
    }

    /* Protokol MyMemory. */
    if (url === "/get") {
      const q = new URL(req.url, "http://x").searchParams.get("q") || "";
      log.push({ protocol: "mymemory", q: q });
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ responseData: { translatedText: "EN " + q }, responseStatus: 200 }));
    }

    /* Protokol LibreTranslate. */
    if (url === "/translate") {
      let req2 = {};
      try { req2 = JSON.parse(body || "{}"); } catch (_) { req2 = {}; }
      log.push({ protocol: "libretranslate", body: req2 });
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ translatedText: "EN " + (req2.q || "") }));
    }

    /* Protokol custom. */
    if (url === "/custom") {
      let req2 = {};
      try { req2 = JSON.parse(body || "{}"); } catch (_) { req2 = {}; }
      log.push({ protocol: "custom", body: req2 });
      const arr = (req2.texts || []).map((t) => "EN " + t);
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ translations: arr }));
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "tidak ada" }));
  });
  return new Promise((r) => s.listen(AI_PORT, "127.0.0.1", () => r(s)));
}

/* Mesin bawaan peramban tiruan (untuk menguji rantai cadangan). */
const FAKE_BUILTIN = `
window.__fake = { creates: 0, calls: 0 };
window.Translator = {
  availability: async function () { return "available"; },
  create: async function () {
    window.__fake.creates++;
    return {
      translate: async function (t) { window.__fake.calls++; return "[BB] " + t; },
      destroy: function () {},
    };
  },
};
`;

/* ---------- helper ---------- */
const postJSON = (port, path, obj) =>
  new Promise((resolve, reject) => {
    const data = JSON.stringify(obj);
    const req = http.request(
      { host: "127.0.0.1", port, path, method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) } },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve(b));
      }
    );
    req.on("error", reject);
    req.end(data);
  });

async function main() {
  const srv = await server();
  const ai = await mockAiServer();
  const browser = await chromium();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
  await page.waitForTimeout(600);

  const KONF = {
    manifestUrl: `http://127.0.0.1:${AI_PORT}/manifest`,
    endpoint: `http://127.0.0.1:${AI_PORT}/v1/chat/completions`,
    apiKey: "kunci-rahasia-uji-123",
    model: "",
    engineId: "llm",
    glossary: "anggaran = budget\nrupiah = rupiah",
  };

  /* ==========================================================
     1. Modul & manifest dari server
     ========================================================== */
  const info = await page.evaluate(async (k) => {
    window.PDFTranslateAI.configure(k);
    const m = await window.PDFTranslateAI.loadManifest({ force: true });
    const st = window.PDFTranslateAI.status();
    return {
      adaModul: !!window.PDFTranslateAI,
      versi: m.version,
      mesin: m.engines.map((e) => e.id),
      sumber: st.sumber,
      remoteOk: st.remoteOk,
      status: st.version,
      siap: window.PDFTranslateAI.isConfigured(),
      daftar: window.PDFTranslateAI.listEngines({ from: "id", to: "en" }).map((e) => ({
        id: e.id, siap: e.siap, alasan: e.alasan, model: e.model,
      })),
    };
  }, KONF);

  check("Modul AI daring termuat", info.adaModul);
  check("Manifest diambil dari server (bukan berkas lokal)", info.remoteOk === true && info.sumber === "server", "sumber=" + info.sumber);
  check("Versi manifest terbaca dari server", info.versi === "uji-1", "versi=" + info.versi);
  check("Daftar mesin dari manifest terbaca", info.mesin.includes("llm") && info.mesin.includes("mymemory"), info.mesin.join(", "));
  check("Mesin daring dianggap siap", info.siap === true);
  const mesinSiap = info.daftar.find((e) => e.id === "llm");
  check("Mesin LLM siap (punya endpoint + kunci)", mesinSiap && mesinSiap.siap === true, mesinSiap ? mesinSiap.alasan : "tidak ada");
  check("Model dari manifest dipakai", mesinSiap && mesinSiap.model === "model-uji-v1", mesinSiap ? mesinSiap.model : "-");

  /* ==========================================================
     2. Terjemahan lewat mesin AI + konteks + glosarium
     ========================================================== */
  await postJSON(AI_PORT, "/__reset", {});
  const t1 = await page.evaluate(async () => {
    const TR = window.PDFTranslate;
    TR.cacheClear();
    const plan = TR.prepare({
      from: "id", to: "en", mode: "online",
      ai: { engineId: "llm", apiKey: "kunci-rahasia-uji-123" },
    });
    const engine = await TR.create(plan);
    const hasil = await engine.translateBatch([
      "Dokumen ini menjelaskan rencana kerja untuk tahun anggaran berikutnya.",
      "Seluruh kegiatan dijalankan langsung di dalam peramban.",
    ]);
    return {
      kind: engine.kind,
      engineId: engine.engineId,
      model: engine.model,
      manifestVersion: engine.manifestVersion,
      hasil: hasil,
      stats: JSON.parse(JSON.stringify(window.PDFTranslateAI.stats)),
    };
  });
  check("Mesin daring dipakai saat mode=online", t1.kind === "online" && t1.engineId === "llm", t1.kind + "/" + t1.engineId);
  check(
    "Terjemahan dari server AI dipakai",
    t1.hasil[0] === "EN Dokumen ini menjelaskan rencana kerja untuk tahun anggaran berikutnya.",
    t1.hasil[0]
  );
  check("Model dari manifest terkirim ke server", t1.model === "model-uji-v1", t1.model);
  check("Versi manifest tercatat di mesin", t1.manifestVersion === "uji-1", t1.manifestVersion);

  const log1 = JSON.parse(await new Promise((resolve) => {
    http.get(`http://127.0.0.1:${AI_PORT}/__log`, (r) => {
      let b = "";
      r.on("data", (c) => (b += c));
      r.on("end", () => resolve(b));
    });
  }));
  const reqOpenAI = log1.find((r) => r.protocol === "openai");
  check("Server AI menerima permintaan OpenAI-compatible", !!reqOpenAI);
  const isiPrompt = reqOpenAI ? (reqOpenAI.body.messages || []).map((m) => m.content).join("\n") : "";
  check(
    "Beberapa baris berurutan dikirim dalam SATU permintaan (konteks terbaca)",
    reqOpenAI && log1.filter((r) => r.protocol === "openai").length === 1,
    "permintaan=" + log1.filter((r) => r.protocol === "openai").length
  );
  check("Prompt menyertakan kedua baris", /rencana kerja/.test(isiPrompt) && /di dalam peramban/.test(isiPrompt));
  check("Glosarium ikut dikirim ke server", /anggaran = budget/.test(isiPrompt), isiPrompt.slice(0, 120));
  check("Kunci API terkirim sebagai header Authorization", !!(reqOpenAI && reqOpenAI.headers && /bearer/i.test(String(reqOpenAI.headers.authorization || ""))));

  /* ==========================================================
     3. Angka / kode / URL tidak dikirim ke server
     ========================================================== */
  await postJSON(AI_PORT, "/__reset", {});
  await page.evaluate(async () => {
    const TR = window.PDFTranslate;
    TR.cacheClear();
    const plan = TR.prepare({ from: "id", to: "en", mode: "online", ai: { engineId: "llm", apiKey: "kunci-rahasia-uji-123" } });
    const engine = await TR.create(plan);
    window.__hasil = await engine.translateBatch([
      "1.500.000",
      "https://contoh.id/dokumen",
      "Jumlah dana tersedia tercantum pada tabel.",
    ]);
  });
  const log3 = JSON.parse(await new Promise((resolve) => {
    http.get(`http://127.0.0.1:${AI_PORT}/__log`, (r) => {
      let b = "";
      r.on("data", (c) => (b += c));
      r.on("end", () => resolve(b));
    });
  }));
  const req3 = log3.find((r) => r.protocol === "openai");
  const prompt3 = req3 ? (req3.body.messages || []).map((m) => m.content).join("\n") : "";
  check("Angka tidak dikirim ke server", !/1\.500\.000/.test(prompt3));
  check("URL tidak dikirim ke server", !/contoh\.id/.test(prompt3));
  check("Teks biasa tetap dikirim", /tercantum pada tabel/.test(prompt3));
  const hasil3 = await page.evaluate(() => window.__hasil);
  check("Angka dikembalikan apa adanya", hasil3[0] === "1.500.000", hasil3[0]);
  check("URL dikembalikan apa adanya", hasil3[1] === "https://contoh.id/dokumen", hasil3[1]);

  /* ==========================================================
     4. Perbaikan di server langsung ikut terpakai (hot update)
     ========================================================== */
  const manifestBaru = JSON.parse(JSON.stringify(manifest));
  manifestBaru.version = "uji-2";
  manifestBaru.engines[0].model = "model-uji-v2";
  manifestBaru.engines[0].label = "AI LLM uji (v2)";
  manifest = manifestBaru;

  const upd = await page.evaluate(async () => {
    const r = await window.PDFTranslate.checkUpdateAI();
    return { r: r, status: window.PDFTranslate.onlineStatus() };
  });
  check("Perubahan manifest di server terdeteksi", upd.r.berubah === true && upd.r.version === "uji-2", JSON.stringify(upd.r));
  check("Status ikut menampilkan versi baru", upd.status.version === "uji-2", upd.status.version);

  await postJSON(AI_PORT, "/__reset", {});
  const t4 = await page.evaluate(async () => {
    const TR = window.PDFTranslate;
    TR.cacheClear();
    const plan = TR.prepare({ from: "id", to: "en", mode: "online", ai: { engineId: "llm", apiKey: "kunci-rahasia-uji-123" } });
    const engine = await TR.create(plan);
    await engine.translateBatch(["Perubahan di server harus langsung dipakai."]);
    return { model: engine.model, label: engine.label, versi: engine.manifestVersion };
  });
  check("Model baru dari server langsung dipakai", t4.model === "model-uji-v2", t4.model);
  check("Versi manifest baru terbaca mesin", t4.versi === "uji-2", t4.versi);
  const log4 = JSON.parse(await new Promise((resolve) => {
    http.get(`http://127.0.0.1:${AI_PORT}/__log`, (r) => {
      let b = "";
      r.on("data", (c) => (b += c));
      r.on("end", () => resolve(b));
    });
  }));
  const req4 = log4.find((r) => r.protocol === "openai");
  check("Permintaan memakai model baru (bukan yang lama)", !!(req4 && req4.body.model === "model-uji-v2"), req4 ? req4.body.model : "-");

  /* ==========================================================
     5. Cache kalimat terisolasi per mesin
     ========================================================== */
  const cacheUji = await page.evaluate(async () => {
    const TR = window.PDFTranslate;
    TR.cacheClear();
    const mesinA = { kind: "online", engineId: "llm", model: "model-uji-v2" };
    const mesinB = { kind: "offline" };
    const kA = TR.cacheKey(mesinA, "id", "en", "Halo dunia");
    const kB = TR.cacheKey(mesinB, "id", "en", "Halo dunia");
    TR.cacheSet(kA, "hasil mesin A");
    return {
      beda: kA !== kB,
      nilaiA: TR.cacheGet(kA),
      nilaiB: TR.cacheGet(kB),
      ukuran: TR.cacheSize(),
    };
  });
  check("Kunci cache berbeda untuk mesin berbeda", cacheUji.beda === true);
  check("Hasil mesin lama tidak bocor ke mesin baru", cacheUji.nilaiA === "hasil mesin A" && cacheUji.nilaiB === undefined, "A=" + cacheUji.nilaiA + " B=" + cacheUji.nilaiB);

  /* ==========================================================
     6. Galat server: percobaan ulang & pesan galat
     ========================================================== */
  await postJSON(AI_PORT, "/__reset", {});
  await postJSON(AI_PORT, "/__control", { failTimes: 2 });
  const retry = await page.evaluate(async () => {
    const TR = window.PDFTranslate;
    TR.cacheClear();
    const plan = TR.prepare({ from: "id", to: "en", mode: "online", ai: { engineId: "llm", apiKey: "kunci-rahasia-uji-123" } });
    const engine = await TR.create(plan);
    let galat = "";
    let hasil = [];
    try {
      hasil = await engine.translateBatch(["Uji percobaan ulang saat server error."]);
    } catch (err) {
      galat = String(err.message || err);
    }
    return { galat: galat, hasil: hasil, retries: window.PDFTranslateAI.stats.onlineRetries };
  });
  check("Server error 5xx dicoba ulang lalu berhasil", retry.hasil[0] && /Uji percobaan ulang/.test(retry.hasil[0]), retry.hasil[0] || retry.galat);
  check("Jumlah percobaan ulang tercatat", retry.retries >= 2, "retry=" + retry.retries);

  await postJSON(AI_PORT, "/__reset", {});
  await postJSON(AI_PORT, "/__control", { authError: true });
  const authUji = await page.evaluate(async () => {
    const TR = window.PDFTranslate;
    TR.cacheClear();
    const plan = TR.prepare({ from: "id", to: "en", mode: "online", ai: { engineId: "llm", apiKey: "kunci-rahasia-uji-123" } });
    const engine = await TR.create(plan);
    let galat = "";
    try {
      await engine.translateBatch(["Kunci API salah."]);
    } catch (err) {
      galat = String(err.message || err);
    }
    return { galat: galat };
  });
  check("Galat kunci API punya pesan yang jelas", /kunci API/i.test(authUji.galat), authUji.galat);
  check("Kunci API TIDAK bocor ke pesan galat", !/kunci-rahasia-uji-123/.test(authUji.galat), authUji.galat);
  await postJSON(AI_PORT, "/__control", { authError: false });

  /* ==========================================================
     7. Rantai cadangan: AI gagal -> mesin bawaan peramban
     ========================================================== */
  const fakePage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  fakePage.on("pageerror", (e) => errors.push("fake: " + String(e)));
  await fakePage.addInitScript(FAKE_BUILTIN);
  await fakePage.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
  await fakePage.waitForTimeout(500);
  await fakePage.evaluate(async (k) => {
    window.PDFTranslateAI.configure(k);
    await window.PDFTranslateAI.loadManifest({ force: true });
  }, KONF);

  await postJSON(AI_PORT, "/__reset", {});
  await postJSON(AI_PORT, "/__control", { status: 500, failTimes: 0 });
  const cadangan = await fakePage.evaluate(async () => {
    const TR = window.PDFTranslate;
    TR.cacheClear();
    const plan = TR.prepare({ from: "id", to: "en", mode: "auto", ai: { engineId: "llm", apiKey: "kunci-rahasia-uji-123" } });
    const engine = await TR.create(plan);
    let hasil = [];
    let galat = "";
    try {
      hasil = await engine.translateBatch(["Dokumen gagal diterjemahkan."]);
    } catch (err) {
      galat = String(err.message || err);
    }
    return { hasil: hasil, galat: galat, catatan: plan.catatan, kind: engine.kind };
  });
  check(
    "Server AI gagal -> otomatis turun ke mesin bawaan peramban",
    cadangan.hasil[0] && /^\[BB\]/.test(cadangan.hasil[0]),
    cadangan.hasil[0] || cadangan.galat
  );
  check("Perpindahan mesin dilaporkan ke pengguna", /gagal/i.test((cadangan.catatan || []).join(" ")), (cadangan.catatan || []).join(" | "));
  await postJSON(AI_PORT, "/__control", { status: 0 });

  /* Izin "tidak kirim ke server" mematikan mesin daring. */
  const tanpaIzin = await fakePage.evaluate(async () => {
    const TR = window.PDFTranslate;
    const plan = TR.prepare({ from: "id", to: "en", mode: "online", aiAllow: false });
    return { galat: plan.error ? String(plan.error.message) : "", kind: plan.kind };
  });
  check("Izin dimatikan -> mesin daring ditolak dengan pesan jelas", /izin/i.test(tanpaIzin.galat), tanpaIzin.galat);

  /* ==========================================================
     8. Alat "Terjemah PDF" sungguhan (UI)
     ========================================================== */
  fs.mkdirSync(SHOTS, { recursive: true });

  async function jalankanAlat(files, opsi = {}, screenshotPanel = "") {
    await fakePage.click("#tab-tools");
    await fakePage.waitForTimeout(300);
    await fakePage.evaluate(() => {
      const c = [...document.querySelectorAll("#toolCategories .tool-card")].find((n) =>
        n.textContent.includes("Terjemah PDF")
      );
      c?.click();
    });
    await fakePage.waitForTimeout(600);
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
    if (screenshotPanel) {
      /* Bukti visual panel AI daring (status manifest + daftar mesin). */
      await fakePage.evaluate(() => {
        const p = document.querySelector("#toolExtra");
        if (p) p.scrollIntoView({ block: "center" });
      });
      await fakePage.waitForTimeout(300);
      await fakePage.screenshot({ path: path.join(SHOTS, screenshotPanel) });
      /* Panel harus menampilkan status manifest + daftar mesin dari
         server (bukan daftar yang ditulis mati di dalam aplikasi). */
      const panel = await fakePage.evaluate(() => {
        const status = document.querySelector("#aiStatus");
        const sel = document.querySelector("#aiEngine");
        return {
          status: status ? status.textContent : "",
          opsi: sel ? [...sel.options].map((o) => o.textContent) : [],
          adaTombol: !!document.querySelector("#aiRefresh"),
          adaGlosarium: !!document.querySelector("#aiGlossary"),
        };
      });
      check("Panel AI daring menampilkan versi manifest dari server", /versi uji-2/.test(panel.status), panel.status);
      check("Daftar mesin di panel diambil dari manifest server", panel.opsi.length >= 3, panel.opsi.join(" | "));
      check("Panel punya tombol Perbarui dari server", panel.adaTombol === true);
      check("Panel punya kolom glosarium", panel.adaGlosarium === true);
    }
    const t0 = Date.now();
    await fakePage.click("#toolRunBtn");
    let n = 0;
    for (let i = 0; i < 180; i++) {
      await fakePage.waitForTimeout(500);
      n = await fakePage.evaluate(() => document.querySelectorAll("#toolResults > *").length);
      if (n > 0) break;
    }
    const durasi = ((Date.now() - t0) / 1000).toFixed(1);
    const hasil = await fakePage.evaluate(async () => {
      const a = [...document.querySelectorAll("#toolResults a")];
      const out = [];
      for (const x of a) {
        const r = await fetch(x.href);
        const buf = new Uint8Array(await r.arrayBuffer());
        let teks = "";
        try { teks = new TextDecoder().decode(buf); } catch (_) { teks = ""; }
        let b64 = "";
        if (/\.pdf$/i.test(x.download)) {
          let s = "";
          for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
          b64 = btoa(s);
        }
        out.push({ nama: x.download, ukuran: buf.byteLength, teks: teks.slice(0, 4000), b64: b64 });
      }
      return out;
    });
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
    return { hasil: hasil, durasi: durasi, jumlah: n, catatan: catatan, pesan: pesan };
  }

  await postJSON(AI_PORT, "/__reset", {});
  const alat = await jalankanAlat(
    [path.join(FIX, "gabungan.pdf")],
    { src: "id", lang: "en", engine: "online", format: "both", latar: "asli", aiAllow: true },
    "panel-ai-daring.png"
  );
  check("Alat Terjemah PDF menghasilkan berkas", alat.jumlah >= 1, "jumlah=" + alat.jumlah);
  const md = alat.hasil.find((h) => /\.md$/.test(h.nama));
  const pdf = alat.hasil.find((h) => /\.pdf$/.test(h.nama));
  check("Hasil Markdown terbentuk", !!md, md ? md.nama : "tidak ada");
  check("Hasil PDF terjemahan terbentuk", !!pdf, pdf ? pdf.nama + " " + pdf.ukuran + " B" : "tidak ada");
  check(
    "Markdown berisi terjemahan dari server AI",
    !!md && /EN Dokumen ini menjelaskan rencana kerja untuk/.test(md.teks),
    md ? md.teks.split("\n").slice(0, 6).join(" | ") : ""
  );
  check(
    "Kalimat panjang dipecah kembali ke baris aslinya (isi utuh)",
    !!md && /anggaran berikutnya beserta rincian biayanya/.test(md.teks),
    md ? md.teks.split("\n").slice(4, 8).join(" | ") : ""
  );
  check("Catatan hasil menyebut mesin AI daring", /AI daring/i.test(alat.catatan || ""), alat.catatan || "");

  /* Kalimat yang patah dua baris harus dikirim sebagai SATU satuan. */
  const logAlat = JSON.parse(await new Promise((resolve) => {
    http.get(`http://127.0.0.1:${AI_PORT}/__log`, (r) => {
      let b = "";
      r.on("data", (c) => (b += c));
      r.on("end", () => resolve(b));
    });
  }));
  const reqAlat = logAlat.find((r) => r.protocol === "openai");
  const promptAlat = reqAlat ? (reqAlat.body.messages || []).map((m) => m.content).join("\n") : "";
  check(
    "Kalimat patah dua baris dikirim sebagai satu satuan utuh",
    /rencana kerja untuk tahun anggaran berikutnya/.test(promptAlat),
    promptAlat.replace(/\n/g, " | ").slice(0, 220)
  );

  /* PDF hasil harus punya lapisan teks tak terlihat (bisa dicari). */
  const pdfB64 = (pdf && pdf.b64) || "";
  const pdfTeks = pdfB64
    ? await fakePage.evaluate(async (b64) => {
        const bin = atob(b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        const doc = await pdfjsLib.getDocument({ data: arr }).promise;
        let teks = "";
        for (let i = 1; i <= doc.numPages; i++) {
          const p = await doc.getPage(i);
          const tc = await p.getTextContent();
          teks += tc.items.map((it) => it.str).join(" ");
        }
        return { halaman: doc.numPages, teks: teks };
      }, pdfB64)
    : { halaman: 0, teks: "" };
  check("PDF terjemahan punya halaman", pdfTeks.halaman >= 1, "halaman=" + pdfTeks.halaman);

  /* Bukti visual: halaman pertama PDF terjemahan dirender jadi PNG. */
  if (pdfB64) {
    const png = await fakePage.evaluate(async (b64) => {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const doc = await pdfjsLib.getDocument({ data: arr }).promise;
      const page = await doc.getPage(1);
      const vp = page.getViewport({ scale: 1.4 });
      const c = document.createElement("canvas");
      c.width = Math.ceil(vp.width);
      c.height = Math.ceil(vp.height);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      return c.toDataURL("image/png");
    }, pdfB64);
    if (png) {
      fs.writeFileSync(
        path.join(SHOTS, "pdf-terjemahan-halaman1.png"),
        Buffer.from(png.split(",")[1], "base64")
      );
      check("Bukti visual PDF terjemahan tersimpan", true, "pdf-terjemahan-halaman1.png");
    }
  }
  check(
    "PDF terjemahan punya lapisan teks tak terlihat (bisa dicari)",
    /anggaran berikutnya/.test(pdfTeks.teks),
    pdfTeks.teks.slice(0, 160)
  );

  await fakePage.screenshot({ path: path.join(SHOTS, "terjemah-ai-daring.png") });

  /* Angka & URL: tidak boleh masuk ke server saat memakai alat. */
  await postJSON(AI_PORT, "/__reset", {});
  const alatAngka = await jalankanAlat([path.join(FIX, "angka-url.pdf")], {
    src: "id", lang: "en", engine: "online", format: "md", aiAllow: true,
  });
  const logAngka = JSON.parse(await new Promise((resolve) => {
    http.get(`http://127.0.0.1:${AI_PORT}/__log`, (r) => {
      let b = "";
      r.on("data", (c) => (b += c));
      r.on("end", () => resolve(b));
    });
  }));
  const promptAngka = (logAngka.find((r) => r.protocol === "openai") || { body: { messages: [] } }).body.messages
    .map((m) => m.content).join("\n");
  check("Alat tidak mengirim angka ke server AI", !/1\.500\.000/.test(promptAngka), promptAngka.replace(/\n/g, " | ").slice(0, 160));
  check("Alat tidak mengirim URL ke server AI", !/contoh\.id/.test(promptAngka));
  const mdAngka = alatAngka.hasil.find((h) => /\.md$/.test(h.nama));
  check(
    "Angka tetap utuh di hasil terjemahan",
    !!mdAngka && /1\.500\.000/.test(mdAngka.teks),
    mdAngka ? mdAngka.teks.split("\n").slice(0, 6).join(" | ") : ""
  );

  /* Mode offline tetap bisa dipakai (privat). */
  await postJSON(AI_PORT, "/__reset", {});
  const alatOffline = await jalankanAlat([path.join(FIX, "gabungan.pdf")], {
    src: "id", lang: "en", engine: "offline", format: "md", aiAllow: false,
  });
  const logOffline = JSON.parse(await new Promise((resolve) => {
    http.get(`http://127.0.0.1:${AI_PORT}/__log`, (r) => {
      let b = "";
      r.on("data", (c) => (b += c));
      r.on("end", () => resolve(b));
    });
  }));
  check("Mode offline tidak menghubungi server AI", logOffline.length === 0, "permintaan=" + logOffline.length);
  check("Mode offline tetap menghasilkan terjemahan", alatOffline.jumlah >= 1 && /Good morning|work plan|browser|rencana/i.test((alatOffline.hasil[0] || {}).teks || ""), (alatOffline.hasil[0] || {}).teks || "");

  /* ==========================================================
     9. Kebocoran & error
     ========================================================== */
  const jsError = errors.filter((e) => !/favicon|ERR_|Failed to load resource/i.test(e));
  check("Tidak ada error JavaScript", jsError.length === 0, jsError.slice(0, 2).join(" | "));

  await browser.close();
  srv.close();
  ai.close();

  fs.mkdirSync(path.join(ROOT, "docs"), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, "docs", "audit-terjemah-ai-hasil.json"),
    JSON.stringify({ tanggal: new Date().toISOString(), pass, fail, results }, null, 2)
  );

  console.log("\n===== RINGKASAN AUDIT TERJEMAHAN AI DARING =====");
  console.log("Lulus: " + pass + "  Gagal: " + fail);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
