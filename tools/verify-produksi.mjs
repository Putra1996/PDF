/**
 * Harness verifikasi produksi (CI).
 *
 * Menjalankan Chromium (Playwright) terhadap SITUS LIVE (GitHub Pages) atau
 * terhadap salinan lokal, lalu memeriksa tata letak, navigasi, dan fungsi
 * utama aplikasi. Exit code non-nol bila ada pemeriksaan yang gagal.
 *
 * Env:
 *   SITE_URL / BASE_URL  - URL yang diuji (default: server lokal di repo ini)
 *   HARNESS_DIR          - akar repo (default: direktori induk tools/)
 *   FIXTURES_DIR         - folder fixture PDF (default: HARNESS_DIR/fixtures)
 *   SHOT_DIR             - folder screenshot (default: /tmp/prod)
 *   CHROME_PATH          - path binary Chromium bila perlu
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_DIR = path.resolve(process.env.HARNESS_DIR || path.join(HERE, ".."));
const FIXTURES_DIR = path.resolve(process.env.FIXTURES_DIR || path.join(HARNESS_DIR, "fixtures"));
const SHOT_DIR = process.env.SHOT_DIR || "/tmp/prod";
const SAMPLE = path.join(FIXTURES_DIR, "sample.pdf");
const PORT = Number(process.env.PORT || 8099);
const CLI_URL = process.argv[2] || "";
const TARGET_URL = process.env.SITE_URL || process.env.BASE_URL || CLI_URL || "";
const USE_LOCAL = !TARGET_URL;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
};

const results = [];
let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  ok ? pass++ : fail++;
  console.log(`${ok ? "\u2713" : "\u2717"} ${name}${detail ? ` — ${detail}` : ""}`);
};

function startServer(root) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || "/").split("?")[0]);
    let file = path.join(root, url === "/" ? "index.html" : url);
    if (!file.startsWith(root)) return res.writeHead(403).end("forbidden");
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) return res.writeHead(404).end("not found");
    res.writeHead(200, {
      "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(PORT, "127.0.0.1", () => r(server)));
}

/** Cari binary Chromium: env -> playwright -> sistem -> @sparticuz/chromium. */
async function resolveBrowser(pwChromium) {
  const envPath = process.env.CHROME_PATH || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (envPath && fs.existsSync(envPath)) return { exe: envPath, args: [] };
  try {
    const exe = pwChromium.executablePath();
    if (exe && fs.existsSync(exe)) return { exe, args: [] };
  } catch (_) {
    /* belum terpasang */
  }
  for (const bin of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
    try {
      const p = execSync(`command -v ${bin}`, { encoding: "utf8" }).trim();
      if (p && fs.existsSync(p)) return { exe: p, args: ["--no-sandbox", "--disable-dev-shm-usage"] };
    } catch (_) {
      /* lanjut */
    }
  }
  const mod = await import("@sparticuz/chromium").catch(() => null);
  if (mod) {
    const chromium = mod.default;
    /* pustaka sistem (libnss3 dll) mungkin perlu diekstrak dulu */
    const { siapkanPustaka } = await import("./browser.mjs");
    await siapkanPustaka();
    return { exe: await chromium.executablePath(), args: [...chromium.args, "--no-sandbox", "--disable-dev-shm-usage"] };
  }
  throw new Error("Binary Chromium tidak ditemukan (pasang playwright chromium atau set CHROME_PATH).");
}

async function main() {
  const server = USE_LOCAL ? await startServer(HARNESS_DIR) : null;
  const baseUrl = USE_LOCAL
    ? `http://127.0.0.1:${PORT}/`
    : TARGET_URL.replace(/\/[^/]*$/, "/");

  const { chromium: pwChromium } = await import("playwright-core");
  const { exe, args } = await resolveBrowser(pwChromium);
  const browser = await pwChromium.launch({ executablePath: exe, args, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("requestfailed", (r) =>
    failedRequests.push(`${r.url()} :: ${r.failure()?.errorText || "failed"}`)
  );

  try {
    /* ============ 1. Muat halaman & penanda aset ============ */
    const resp = await page.goto(`${baseUrl}index.html`, { waitUntil: "load", timeout: 60000 });
    check("Halaman merespons 200", resp?.status() === 200, `status=${resp?.status()}`);
    await page.waitForTimeout(1500);

    const aset = await page.evaluate(() => {
      const urls = [...document.querySelectorAll("link[rel=stylesheet],script[src]")]
        .map((n) => n.getAttribute("href") || n.getAttribute("src"));
      const token = (urls.find((u) => /\?v=(\w+)/.test(u)) || "").match(/\?v=(\w+)/)?.[1] || "";
      const tanpaToken = urls.filter((u) => !u.startsWith("vendor/") && !/\?v=/.test(u));
      return {
        urls,
        token,
        tanpaToken,
        cssVar: getComputedStyle(document.documentElement).getPropertyValue("--css-build").trim(),
        build: window.PDF_BUILD || "",
      };
    });
    check(
      "Semua aset memakai penanda versi yang sama",
      aset.token !== "" && aset.urls.filter((u) => !u.startsWith("vendor/")).every((u) => u.includes(aset.token)),
      `token=${aset.token} tanpa=${aset.tanpaToken.join(", ")}`
    );
    check("Marker CSS --css-build sama dengan penanda aset", aset.cssVar === aset.token, `css=${aset.cssVar} aset=${aset.token}`);
    check("window.PDF_BUILD sama dengan penanda aset", aset.build === aset.token, `build=${aset.build} aset=${aset.token}`);

    /* ============ 2. Pintasan di beranda ============ */
    const pintasan = await page.evaluate(() => {
      const quick = document.querySelector("#quickTools");
      const cards = [...document.querySelectorAll("#quickGrid .quick-btn, #quickGrid .tool-card")];
      return {
        hidden: quick?.hidden,
        judul: document.querySelector(".quick-title")?.textContent?.trim() || "",
        jumlah: cards.length,
        nama: cards.map((c) => (c.querySelector(".tool-name")?.textContent?.trim() || c.textContent.trim()).slice(0, 24)),
      };
    });
    check("Pintasan tampil sejak halaman pertama dimuat", pintasan.hidden === false, `hidden=${pintasan.hidden}`);
    check("Judul pintasan “Paling sering dipakai”", pintasan.judul === "Paling sering dipakai", pintasan.judul);
    check("Lima pintasan dirender", pintasan.jumlah === 5, `jumlah=${pintasan.jumlah}`);
    check(
      "Isi pintasan sesuai",
      ["Pisah PDF", "Gabung PDF", "Edit PDF", "Tambah watermark", "Tambah nomor halaman"].every((n) =>
        pintasan.nama.some((x) => x.includes(n))
      ),
      pintasan.nama.join(" | ")
    );

    /* ============ 3. Tab strip ============ */
    const tabState = async () =>
      page.evaluate(() => ({
        aktif: document.querySelector(".tab.active")?.id,
        split: !document.querySelector("#splitView")?.hidden,
        merge: !document.querySelector("#mergeView")?.hidden,
        compress: !document.querySelector("#compressView")?.hidden,
        tools: !document.querySelector("#toolsView")?.hidden,
      }));
    for (const [tab, key, judul] of [
      ["#tab-merge", "merge", "Gabung PDF"],
      ["#tab-compress", "compress", "Kompres PDF"],
      ["#tab-tools", "tools", null],
      ["#tab-split", "split", null],
    ]) {
      await page.click(tab);
      await page.waitForTimeout(450);
      const st = await tabState();
      check(`Tab ${tab} aktif`, st.aktif === tab.slice(1), `aktif=${st.aktif}`);
      check(`Tab ${tab} menyorot panel`, st[key] === true);
      if (judul) {
        const h = await page.evaluate(
          (k) => document.querySelector(`#${k === "merge" ? "mergeView" : "compressView"} h2`)?.textContent?.trim(),
          key
        );
        check(`Judul panel ${judul}`, h === judul, `h=${h}`);
      }
    }

    /* ============ 4. Launcher alat ============ */
    await page.click("#tab-tools");
    await page.waitForTimeout(500);
    const launcher = await page.evaluate(() => {
      const cards = [...document.querySelectorAll("#toolCategories .tool-card")];
      const badges = [...document.querySelectorAll(".tool-badge")].map((b) => b.textContent.trim());
      const cats = [...document.querySelectorAll("#toolCategories .tool-cat-title")].map((c) => c.textContent.trim());
      return { kartu: cards.length, badges, cats, adaCari: !!document.querySelector("#toolSearch")?.checkVisibility() };
    });
    check("Kartu alat dirender", launcher.kartu >= 25, `kartu=${launcher.kartu}`);
    check("Kategori alat mengelompokkan", launcher.cats.length >= 6, launcher.cats.join(", "));
    check("Kolom pencarian alat tampil", launcher.adaCari === true);
    check("Badge tab terpasang", launcher.badges.length >= 3, launcher.badges.join(", "));
    check(
      "Badge Tab Gabung/Tab Pemisah/Tab Kompres",
      ["Tab Gabung", "Tab Pemisah", "Tab Kompres"].every((b) => launcher.badges.includes(b)),
      launcher.badges.join(", ")
    );

    await page.fill("#toolSearch", "zzz-tidak-ada-alat-zzz");
    await page.waitForTimeout(400);
    check("State kosong: pesan muncul", await page.evaluate(() => !!document.querySelector("#toolEmpty")?.checkVisibility()));
    const emptyTxt = await page.textContent("#toolEmpty");
    check("State kosong: pesan benar", (emptyTxt || "").includes("Tidak ada alat yang cocok"), (emptyTxt || "").trim());
    check("State kosong: tombol bersihkan tampil", await page.evaluate(() => !!document.querySelector("#toolSearchReset")?.checkVisibility()));
    await page.click("#toolSearchReset");
    await page.waitForTimeout(400);
    const setelahReset = await page.evaluate(() => document.querySelectorAll("#toolCategories .tool-card").length);
    check("Pencarian dapat dibersihkan", setelahReset === launcher.kartu, `kartu=${setelahReset}`);

    /* ============ 5. Fungsi: Pisah PDF ============ */
    await page.click("#tab-split");
    await page.waitForTimeout(400);
    await page.setInputFiles("#fileInput", SAMPLE);
    await page.waitForTimeout(1200);
    check("Workspace pemisah muncul setelah berkas dimuat", await page.evaluate(() => !!document.querySelector("#workspace")?.checkVisibility()));
    const filesInfo = await page.evaluate(() => ({
      blok: document.querySelectorAll("#files .file-row, #files > *").length,
      runAktif: !document.querySelector("#runBtn")?.disabled,
    }));
    check("Daftar berkas tampil", filesInfo.blok >= 1, `blok=${filesInfo.blok}`);
    check("Tombol Proses aktif", filesInfo.runAktif === true);
    await page.click("#runBtn");
    await page.waitForTimeout(4000);
    const splitOut = await page.evaluate(() => ({
      hasil: document.querySelectorAll("#results .result, #results > *").length,
      kartu: !document.querySelector("#resultCard")?.hidden,
    }));
    check("Hasil pemisah dirender", splitOut.kartu === true && splitOut.hasil >= 1, `hasil=${splitOut.hasil}`);

    /* ============ 6. Fungsi: Gabung PDF ============ */
    await page.click("#tab-merge");
    await page.waitForTimeout(400);
    await page.setInputFiles("#mergeInput", [SAMPLE, SAMPLE]);
    await page.waitForTimeout(1200);
    const mergeInfo = await page.evaluate(() => ({
      item: document.querySelectorAll("#mlist > *").length,
      tombol: !document.querySelector("#mergeRunBtn")?.disabled,
    }));
    check("Berkas gabung masuk daftar", mergeInfo.item >= 2, `item=${mergeInfo.item}`);
    check("Tombol Gabungkan aktif", mergeInfo.tombol === true);
    await page.click("#mergeRunBtn");
    await page.waitForTimeout(4000);
    const mergeOut = await page.evaluate(() => ({
      kartu: !document.querySelector("#mergeResultCard")?.hidden,
      hasil: document.querySelectorAll("#mergeResults > *").length,
    }));
    check("Hasil gabung dirender", mergeOut.kartu === true && mergeOut.hasil >= 1, `hasil=${mergeOut.hasil}`);

    /* ============ 7. Fungsi: Kompres PDF ============ */
    await page.click("#tab-compress");
    await page.waitForTimeout(400);
    await page.setInputFiles("#compressInput", SAMPLE);
    await page.waitForTimeout(1500);
    const compressInfo = await page.evaluate(() => ({
      estimasi: !!document.querySelector("#compressEstSummary")?.checkVisibility(),
      ringkas: (document.querySelector("#compressOpts")?.textContent || "").replace(/\s+/g, " ").trim(),
      tombol: !document.querySelector("#compressRunBtn")?.disabled,
    }));
    check("Ringkasan estimasi kompresi tampil", compressInfo.estimasi === true);
    check(
      "Preset kompres ringkas (Ringan/Optimal/Seimbang/Kuat/Kustom)",
      ["Ringan", "Optimal", "Seimbang", "Kuat", "Kustom"].every((p) => compressInfo.ringkas.includes(p)),
      compressInfo.ringkas.slice(0, 120)
    );
    check("Tombol Kompres aktif", compressInfo.tombol === true);
    await page.click("#compressRunBtn");
    await page.waitForTimeout(6000);
    const compressOut = await page.evaluate(() => ({
      kartu: !document.querySelector("#compressResultCard")?.hidden,
      hasil: document.querySelectorAll("#compressResults > *").length,
    }));
    check("Hasil kompresi dirender", compressOut.kartu === true && compressOut.hasil >= 1, `hasil=${compressOut.hasil}`);

    /* ============ 8. Editor ============ */
    await page.click("#tab-tools");
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const btn = document.querySelector('#toolCategories .tool-card[data-tool="edit"]')
        || [...document.querySelectorAll("#toolCategories .tool-card")].find((n) => n.textContent.includes("Edit PDF"));
      btn?.click();
    });
    await page.waitForTimeout(800);
    check("Panel alat terbuka", await page.evaluate(() => !!document.querySelector("#toolView")?.checkVisibility()));
    await page.setInputFiles("#toolInput", SAMPLE);
    await page.waitForTimeout(4000);
    const ed = await page.evaluate(() => {
      const stage = document.querySelector(".ed-stage");
      const rail = document.querySelector("#toolSideExtra");
      const rs = stage?.getBoundingClientRect();
      const rr = rail?.getBoundingClientRect();
      return {
        stage: rs ? Math.round(rs.width) : 0,
        stageLeft: rs ? Math.round(rs.left) : 0,
        railLeft: rr ? Math.round(rr.left) : 0,
        railVis: !!rail?.checkVisibility?.(),
        groups: document.querySelectorAll(".ed-bar .ed-group").length,
        menus: document.querySelectorAll(".ed-menu-wrap").length,
        canvas: !!document.querySelector(".ed-canvas"),
      };
    });
    check("Editor memuat panggung", ed.stage > 0, `lebar=${ed.stage}px`);
    check("Panggung editor lebar (≥700px)", ed.stage >= 700, `lebar=${ed.stage}px`);
    check("Rail inspektur tampil di kanan panggung", ed.railVis === true && ed.railLeft > ed.stageLeft, `rail=${ed.railLeft} panggung=${ed.stageLeft}`);
    check("Toolbar editor tergrup (≥5 grup)", ed.groups >= 5, `grup=${ed.groups}`);
    check("Dropdown Ekspor & Proyek tersedia", ed.menus >= 2, `menu=${ed.menus}`);
    check("Kanvas editor dirender", ed.canvas === true);

    const sticky = await page.evaluate(() => {
      const btn = document.querySelector("#toolRunBtn");
      const side = btn?.closest(".tool-side, #toolSideExtra") || btn?.parentElement;
      const rb = btn?.getBoundingClientRect();
      const rs = side?.getBoundingClientRect();
      return {
        pos: btn ? getComputedStyle(btn).position : "none",
        diDalam: rb && rs ? rb.bottom <= rs.bottom + 2 && rb.top >= rs.top - 2 : false,
        tampil: !!btn?.checkVisibility?.(),
      };
    });
    check("Tombol Proses di rail memakai posisi sticky (desktop)", sticky.pos === "sticky", `pos=${sticky.pos}`);
    check("Tombol Proses tetap di dalam rail", sticky.diDalam === true);
    check("Tombol Proses terlihat", sticky.tampil === true);

    /* ============ 9. Responsif 360px ============ */
    await page.setViewportSize({ width: 360, height: 740 });
    await page.waitForTimeout(700);
    const mobile = await page.evaluate(() => {
      const de = document.documentElement;
      const bisaGulir = (el) => {
        for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
          const ov = getComputedStyle(n).overflowX;
          if (ov === "auto" || ov === "scroll" || ov === "hidden") return true;
        }
        return false;
      };
      const luapan = [...document.querySelectorAll("body *")]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          if (!(r.width > 0 && r.height > 0)) return false;
          if (!(r.right > window.innerWidth + 2 || r.left < -2)) return false;
          return !bisaGulir(el);
        })
        .slice(0, 6)
        .map((el) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${String(el.className).slice(0, 24)}`);
      const bar = document.querySelector(".ed-bar");
      const tops = [...(bar?.children || [])]
        .filter((c) => c.getBoundingClientRect().height > 0)
        .map((c) => c.getBoundingClientRect().top)
        .sort((a, b) => a - b);
      const baris = tops.reduce((acc, t) => (acc.length && t - acc[acc.length - 1] < 8 ? acc : [...acc, t]), []).length;
      const rb = bar?.getBoundingClientRect();
      const tengah = rb
        ? document.elementFromPoint(
            Math.min(Math.round(rb.left + rb.width / 2), window.innerWidth - 2),
            Math.min(Math.round(rb.top + rb.height / 2), window.innerHeight - 2)
          )
        : null;
      return {
        overflow: de.scrollWidth - de.clientWidth,
        luapan,
        baris,
        lebarBar: rb ? Math.round(rb.width) : 0,
        barTerlihat: !!tengah && !!bar?.contains(tengah),
      };
    });
    check("Tanpa overflow horizontal di 360px", mobile.overflow <= 2, `overflow=${mobile.overflow}px`);
    check("Tidak ada elemen meluber di 360px", mobile.luapan.length === 0, mobile.luapan.join(", "));
    check("Toolbar editor ≤ 3 baris di 360px", mobile.baris <= 3, `baris=${mobile.baris}`);
    check("Toolbar editor tidak meluber", mobile.lebarBar <= 360, `lebar=${mobile.lebarBar}px`);
    check("Toolbar editor terlihat (tidak tertutup panel lain) di 360px", mobile.barTerlihat === true);

    /* ============ 9b. Rail tidak menutupi konten di mobile ============ */
    await page.click("#tab-tools");
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const c = [...document.querySelectorAll("#toolCategories .tool-card")].find((n) => n.textContent.includes("watermark"));
      c?.click();
    });
    await page.waitForTimeout(900);
    const railMobile = await page.evaluate(() => {
      const d = (s) => {
        const e = document.querySelector(s);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return { top: Math.round(r.top + window.scrollY), bottom: Math.round(r.bottom + window.scrollY) };
      };
      return { main: d(".tool-main"), side: d(".tool-side"), drop: d(".tool-drop") };
    });
    check(
      "Rail pilihan tidak menimpa dropzone berkas di 360px",
      railMobile.side.top >= railMobile.drop.bottom - 2,
      `rail=${railMobile.side.top} dropzone=${railMobile.drop.bottom}`
    );
    check(
      "Rail pilihan mengalir di bawah konten utama di 360px",
      railMobile.side.top >= railMobile.main.bottom - 2,
      `rail=${railMobile.side.top} utama=${railMobile.main.bottom}`
    );

    /* ============ 10. Mode gelap ============ */
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(400);
    await page.click("#themeBtn");
    await page.waitForTimeout(600);
    const dark = await page.evaluate(() => {
      const html = document.documentElement;
      return {
        gelap: html.getAttribute("data-theme") === "dark" || html.classList.contains("dark"),
        bg: getComputedStyle(html).getPropertyValue("--bg").trim(),
        label: document.querySelector("#themeBtn")?.getAttribute("aria-label") || "",
      };
    });
    check("Mode gelap aktif", dark.gelap === true, `bg=${dark.bg}`);
    check("Tombol tema berlabel aksesibel", dark.label.length > 3, dark.label);
    await page.click("#themeBtn");
    await page.waitForTimeout(400);

    /* ============ 10b. Alat OCR (regresi) ============ */
    {
      /* PDF "hasil pindai" dibuat langsung di peramban: sample.pdf
         diraster menjadi gambar tanpa lapisan teks. */
      const sampleB64 = fs.readFileSync(SAMPLE).toString("base64");
      const bytesPindai = await page.evaluate(async (b64) => {
        const binSrc = atob(b64);
        const src = new Uint8Array(binSrc.length);
        for (let i = 0; i < binSrc.length; i++) src[i] = binSrc.charCodeAt(i);
        const doc = await pdfjsLib.getDocument({ data: src }).promise;
        const p = await doc.getPage(1);
        const vp = p.getViewport({ scale: 2 });
        const c = document.createElement("canvas");
        c.width = Math.round(vp.width);
        c.height = Math.round(vp.height);
        await p.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
        const jpg = c.toDataURL("image/jpeg", 0.9);
        const bin = atob(jpg.split(",")[1]);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        const out = await PDFLib.PDFDocument.create();
        const img = await out.embedJpg(u8);
        const pg = out.addPage([595, 842]);
        pg.drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
        const res = await out.save();
        return Array.from(new Uint8Array(res));
      }, sampleB64);
      const filePindai = path.join(SHOT_DIR, "ocr-pindai.pdf");
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      fs.writeFileSync(filePindai, Buffer.from(bytesPindai));

      await page.click("#tab-tools");
      await page.waitForTimeout(400);
      await page.evaluate(() => {
        const btn = document.querySelector('#toolCategories .tool-card[data-tool="ocr"]')
          || [...document.querySelectorAll("#toolCategories .tool-card")].find((n) => n.textContent.includes("OCR PDF"));
        btn?.click();
      });
      await page.waitForTimeout(700);
      await page.evaluate(() => {
        for (const [id, val] of Object.entries({ mode: "searchable", existing: "skip", workers: 1 })) {
          const el = document.getElementById("f_" + id);
          if (!el) continue;
          el.value = String(val);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
      await page.setInputFiles("#toolInput", filePindai);
      await page.waitForTimeout(600);
      await page.click("#toolRunBtn");
      let hrefOcr = null;
      for (let i = 0; i < 90; i++) {
        await page.waitForTimeout(1000);
        hrefOcr = await page.evaluate(() => {
          const a = document.querySelector("#toolResults a");
          return a ? a.href : null;
        });
        if (hrefOcr) break;
      }
      check("OCR menghasilkan berkas", !!hrefOcr, hrefOcr ? "selesai" : "timeout");
      if (hrefOcr) {
        const info = await page.evaluate(async (u) => {
          const r = await fetch(u);
          const buf = new Uint8Array(await r.arrayBuffer());
          const ukuran = buf.length; /* pdf.js bisa melepas buffer -> catat dulu */
          const doc = await pdfjsLib.getDocument({ data: buf }).promise;
          const p = await doc.getPage(1);
          const tc = await p.getTextContent();
          const items = tc.items.filter((i) => i.str && i.str.trim());
          const vp = p.getViewport({ scale: 1 });
          return {
            ukuran,
            halaman: doc.numPages,
            item: items.length,
            lebarRata: items.length
              ? items.reduce((s, i) => s + (i.width || 0), 0) / items.length
              : 0,
            teks: items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim().slice(0, 60),
            w: Math.round(vp.width),
            h: Math.round(vp.height),
          };
        }, hrefOcr);
        check("OCR: lapisan teks ditambahkan", info.item >= 5, `item=${info.item}`);
        check("OCR: teks terbaca", /Uji|halaman|fixture/i.test(info.teks), info.teks);
        check("OCR: lebar kata wajar", info.lebarRata > 5, `rata=${info.lebarRata.toFixed(1)}pt`);
        check("OCR: halaman tetap 1 & ukuran halaman dipertahankan",
          info.halaman === 1 && info.w === 595 && info.h === 842, `${info.halaman} hal ${info.w}x${info.h}`);
        check("OCR: berkas tidak membengkak tak wajar", info.ukuran > 5000, `${info.ukuran} byte`);
      }
      await page.click("#toolBackBtn").catch(() => {});
      await page.waitForTimeout(400);
    }

    /* ============ 10c. Alat Rapi PDF / pelurusan (regresi) ============ */
    {
      /* PDF pindai miring 3 derajat dibuat langsung di peramban:
         teks dirender ke canvas lalu diputar miring. */
      const bytesMiring = await page.evaluate(async () => {
        const W = 1190, H = 1684;
        const base = document.createElement("canvas");
        base.width = W; base.height = H;
        const bc = base.getContext("2d");
        bc.fillStyle = "#fff";
        bc.fillRect(0, 0, W, H);
        bc.fillStyle = "#111";
        bc.font = "26px Helvetica, Arial, sans-serif";
        const baris = [
          "DOKUMEN PEMERIKSAAN KUALITAS",
          "Laporan ini disusun sebagai ringkasan kegiatan",
          "yang telah dilaksanakan selama periode berjalan.",
          "Capaian berada pada angka 87,4 persen dengan",
          "catatan tiga kegiatan ditunda karena cuaca buruk.",
          "Rincian expenditures dapat dilihat pada lampiran.",
          "Demikian laporan ini disusun sebagai bahan bacaan",
          "semoga dapat bermanfaat bagi semua pihak yang ada.",
        ];
        let y = 160;
        for (const b of baris) { bc.fillText(b, 120, y); y += 52; }
        const c = document.createElement("canvas");
        c.width = W; c.height = H;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, W, H);
        ctx.save();
        ctx.translate(W / 2, H / 2);
        ctx.rotate((-3 * Math.PI) / 180);
        ctx.translate(-W / 2, -H / 2);
        ctx.drawImage(base, 0, 0);
        ctx.restore();
        const jpg = c.toDataURL("image/jpeg", 0.92);
        const bin = atob(jpg.split(",")[1]);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        const out = await PDFLib.PDFDocument.create();
        const img = await out.embedJpg(u8);
        const pg = out.addPage([595.28, 841.89]);
        pg.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
        const res = await out.save({ useObjectStreams: false });
        return Array.from(new Uint8Array(res));
      });
      const fileMiring = path.join(SHOT_DIR, "rapi-miring.pdf");
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      fs.writeFileSync(fileMiring, Buffer.from(bytesMiring));

      await page.click("#tab-tools");
      await page.waitForTimeout(400);
      await page.evaluate(() => {
        const btn = document.querySelector('#toolCategories .tool-card[data-tool="repair"]')
          || [...document.querySelectorAll("#toolCategories .tool-card")].find((n) => n.textContent.includes("Rapi PDF"));
        btn?.click();
      });
      await page.waitForTimeout(700);
      await page.evaluate(() => {
        const el = document.getElementById("f_trim");
        if (el) { el.checked = false; el.dispatchEvent(new Event("change", { bubbles: true })); }
      });
      await page.setInputFiles("#toolInput", fileMiring);
      await page.waitForTimeout(600);
      await page.click("#toolRunBtn");
      let hrefRapi = null;
      for (let i = 0; i < 90; i++) {
        await page.waitForTimeout(1000);
        hrefRapi = await page.evaluate(() => {
          const a = document.querySelector("#toolResults a");
          return a ? a.href : null;
        });
        if (hrefRapi) break;
      }
      check("Rapi PDF menghasilkan berkas", !!hrefRapi, hrefRapi ? "selesai" : "timeout");
      if (hrefRapi) {
        const info = await page.evaluate(async (u) => {
          const r = await fetch(u);
          const buf = new Uint8Array(await r.arrayBuffer());
          const ukuran = buf.length;
          const doc = await pdfjsLib.getDocument({ data: buf }).promise;
          const a = await window.PDFToolsCore.analisisHalaman(doc, 1, { maksDeg: 8, autoRotate: true });
          const p = await doc.getPage(1);
          const vp = p.getViewport({ scale: 1 });
          return {
            ukuran,
            halaman: doc.numPages,
            sudut: a.sudut,
            kepastian: a.kepastian,
            w: Math.round(vp.width),
            h: Math.round(vp.height),
          };
        }, hrefRapi);
        check("Rapi PDF: halaman miring jadi lurus", Math.abs(info.sudut) < 0.6, `sisa=${Number(info.sudut).toFixed(2)}°`);
        check("Rapi PDF: halaman tetap 1", info.halaman === 1, `halaman=${info.halaman}`);
        check("Rapi PDF: berkas tidak diraster ulang", info.ukuran > 20000, `${info.ukuran} byte`);
        const sebelum = await page.evaluate(async (u) => {
          const r = await fetch(u);
          const buf = new Uint8Array(await r.arrayBuffer());
          const doc = await pdfjsLib.getDocument({ data: buf }).promise;
          const a = await window.PDFToolsCore.analisisHalaman(doc, 1, { maksDeg: 8, autoRotate: true });
          return a.sudut;
        }, "data:application/pdf;base64," + Buffer.from(bytesMiring).toString("base64"));
        check("Rapi PDF: sumber memang miring", Math.abs(Number(sebelum)) > 2, `sumber=${Number(sebelum).toFixed(2)}°`);
      }
      await page.click("#toolBackBtn").catch(() => {});
      await page.waitForTimeout(400);
    }

    /* ============ 11. Aksesibilitas dasar ============ */
    const a11y = await page.evaluate(() => {
      const tanpaNama = [...document.querySelectorAll("button")]
        .filter((b) => b.checkVisibility?.())
        .filter((b) => !(b.textContent || "").trim() && !b.getAttribute("aria-label") && !b.getAttribute("title"))
        .map((b) => b.id || b.className).slice(0, 6);
      const inputTanpaLabel = [...document.querySelectorAll("input:not([type=hidden]):not([type=radio]):not([type=checkbox])")]
        .filter((el) => el.checkVisibility?.())
        .filter((el) => {
          if (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby")) return false;
          if (el.id && document.querySelector(`label[for="${el.id}"]`)) return false;
          return !el.closest("label");
        })
        .map((el) => el.id || el.name || el.type).slice(0, 6);
      return {
        tanpaNama,
        inputTanpaLabel,
        tabRole: document.querySelectorAll('[role="tab"][aria-selected]').length,
        tabPanel: document.querySelectorAll('[role="tabpanel"]').length,
      };
    });
    check("Semua tombol punya nama aksesibel", a11y.tanpaNama.length === 0, a11y.tanpaNama.join(", "));
    check("Semua field punya label", a11y.inputTanpaLabel.length === 0, a11y.inputTanpaLabel.join(", "));
    check("Peran tab & tabpanel lengkap", a11y.tabRole === 4 && a11y.tabPanel >= 4, `tab=${a11y.tabRole} panel=${a11y.tabPanel}`);

    /* ============ 12. Error runtime & aset ============ */
    const fatal = consoleErrors.filter((e) => !/favicon|net::ERR_|Failed to load resource/i.test(e));
    check("Tidak ada error JavaScript", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
    check("Tidak ada console error fatal", fatal.length === 0, fatal.slice(0, 2).join(" | "));
    check("Semua aset termuat", failedRequests.length === 0, failedRequests.slice(0, 2).join(" | "));

    /* ============ 13. Screenshot bukti ============ */
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    await page.click("#tab-tools");
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(SHOT_DIR, "produksi-alat.png") });
    await page.click("#tab-split");
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SHOT_DIR, "produksi-split.png") });
    console.log(`\nScreenshot: ${SHOT_DIR}`);
  } finally {
    await browser.close();
    if (server) server.close();
  }

  console.log(`\n== HASIL: ${pass} lulus, ${fail} gagal ==`);
  if (fail) {
    console.log("\nGagal:");
    for (const r of results.filter((r) => !r.ok)) console.log(` - ${r.name} ${r.detail}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("Harness gagal:", e);
  process.exitCode = 2;
});
