/**
 * Audit mendalam fitur "slider rentang halaman".
 *
 * Menguji alat sungguhan di Chromium:
 *  - widget rentang halaman muncul di alat yang tepat (dan TIDAK muncul
 *    di alat yang tidak relevan)
 *  - slider membaca jumlah halaman dokumen secara akurat
 *  - rentang benar-benar membatasi halaman yang diproses (Rapi PDF,
 *    Putar PDF, Potong PDF, Watermark, Nomor Halaman, OCR, Redaksi,
 *    PDF ke JPG)
 *  - mode ganjil/genap berfungsi
 *  - halaman di luar rentang TIDAK berubah (byte identik)
 *  - dokumen rusak / rentang kosong memberi pesan yang jelas
 *
 * Jalankan: node tools/mkfixtures-pagerange.mjs && node tools/audit-pagerange.mjs
 *
 * Env:
 *   SERVE_DIR    - direktori statis yang dilayani (default: repo ini)
 *   FIXTURES_DIR - folder fixture (default: fixtures/pagerange)
 *   PORT         - porta server lokal
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "./browser.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.SERVE_DIR || path.join(HERE, ".."));
const FIX = path.resolve(process.env.FIXTURES_DIR || path.join(ROOT, "fixtures", "pagerange"));
const PORT = Number(process.env.PORT || 8076);

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
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".gz": "application/gzip",
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
        s: it.str,
        x: +it.transform[4].toFixed(2),
        y: +it.transform[5].toFixed(2),
        w: +(it.width || 0).toFixed(2),
        h: +(it.height || 0).toFixed(2),
        rot: +((Math.atan2(it.transform[1], it.transform[0]) * 180) / Math.PI).toFixed(1),
      }));
    const vp = p.getViewport({ scale: 1 });
    const c = document.createElement("canvas");
    c.width = Math.round(vp.width);
    c.height = Math.round(vp.height);
    const cx = c.getContext("2d");
    cx.fillStyle = "#fff";
    cx.fillRect(0, 0, c.width, c.height);
    await p.render({ canvasContext: cx, viewport: vp }).promise;
    const data = cx.getImageData(0, 0, c.width, c.height).data;
    /* sidik jari piksel: jumlah piksel non-putih + hash sederhana */
    let nonPutih = 0;
    let hash = 2166136261;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) nonPutih++;
    }
    for (let i = 0; i < data.length; i += 977) {
      hash ^= data[i];
      hash = Math.imul(hash, 16777619);
    }
    halaman.push({
      items,
      teks: items.map((it) => it.s).join(""),
      rot: p.rotate,
      width: +vp.width.toFixed(2),
      height: +vp.height.toFixed(2),
      nonPutih,
      hash: hash >>> 0,
    });
  }
  await doc.destroy();
  return { numPages: doc.numPages, halaman };
};

async function main() {
  if (!fs.existsSync(FIX)) {
    console.error(`Fixture tidak ada: ${FIX}\nJalankan: node tools/mkfixtures-pagerange.mjs`);
    process.exit(2);
  }
  const srv = await server();
  const browser = await chromium();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  /* Galat yang SENGAJA dipancing (rentang di luar jangkauan, berkas
     rusak) memang muncul di konsol sebagai uncaught/console.error.
     during those tests they are expected, not bugs. */
  let harapGagal = false;
  const catatError = (t) => {
    const s = String(t || "");
    if (harapGagal &&
        /Rentang halaman|tidak ada di|bukan PDF yang utuh|Failed to parse|No PDF header|PDF tidak bisa dibuka/i.test(s)) {
      return;
    }
    errors.push(s);
  };
  page.on("pageerror", (e) => catatError(e));
  page.on("console", (m) => m.type() === "error" && catatError(m.text()));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
  await page.waitForTimeout(1500);

  /* ---------- helper ---------- */
  const bukaAlat = async (nama) => {
    await page.evaluate(() => {
      document.getElementById("toolBackBtn")?.click();
      document.getElementById("tab-tools")?.click();
    });
    await page.waitForTimeout(400);
    const ok = await page.evaluate((n) => {
      const c = [...document.querySelectorAll("#toolCategories .tool-card")].find((x) =>
        x.textContent.includes(n)
      );
      if (!c) return false;
      c.click();
      return true;
    }, nama);
    await page.waitForTimeout(600);
    return ok;
  };

  const setRentang = async (mode, dari, sampai) => {
    return page.evaluate(
      ({ mode, dari, sampai }) => {
        const chip = document.querySelector(`.tool-pr-chip[data-mode="${mode}"]`);
        if (!chip) return false;
        chip.click();
        if (mode === "range") {
          const a = document.getElementById("f_halaman_dari_num");
          const b = document.getElementById("f_halaman_sampai_num");
          if (!a || !b) return false;
          a.value = String(dari);
          a.dispatchEvent(new Event("input", { bubbles: true }));
          b.value = String(sampai);
          b.dispatchEvent(new Event("input", { bubbles: true }));
        }
        return true;
      },
      { mode, dari, sampai }
    );
  };

  const setOpsi = async (opsi) =>
    page.evaluate((o) => {
      for (const [id, val] of Object.entries(o)) {
        const el = document.getElementById("f_" + id);
        if (!el) continue;
        if (el.type === "checkbox") el.checked = !!val;
        else el.value = String(val);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }, opsi);

  const jalankan = async (file, { opsi = {}, rentang = null, tunggu = 90 } = {}) => {
    const banyak = Array.isArray(file) ? file : [file];
    await page.evaluate(() => {
      document.querySelectorAll("#toasts .toast").forEach((e) => e.remove());
    });
    if (opsi && Object.keys(opsi).length) await setOpsi(opsi);
    if (rentang) await setRentang(rentang.mode, rentang.dari, rentang.sampai);
    await page.setInputFiles("#toolInput", banyak);
    await page.waitForTimeout(1100);
    const nFile = await page.evaluate(
      () => document.querySelectorAll("#toolFileList .tool-file").length
    );
    if (nFile < 1) throw new Error("Harness: berkas tidak masuk ke daftar");
    await page.evaluate(() => {
      document.querySelectorAll("#toasts .toast").forEach((e) => e.remove());
    });
    const t0 = Date.now();
    await page.click("#toolRunBtn");
    let galat = "";
    for (let i = 0; i < tunggu; i++) {
      await page.waitForTimeout(500);
      const n = await page.evaluate(() => document.querySelectorAll("#toolResults > *").length);
      if (n > 0) break;
      const t = await page.evaluate(() => {
        const semua = [...document.querySelectorAll("#toasts .toast")];
        const el = semua[semua.length - 1];
        return el ? el.textContent : "";
      });
      if (t && /gagal|tidak bisa|rusak|tidak ditemukan|tidak ada di|di luar jangkauan/i.test(t)) { galat = t; break; }
    }
    const durasi = ((Date.now() - t0) / 1000).toFixed(1);
    /* semua hasil (multi-berkas) diambil sekaligus */
    const links = await page.evaluate(() =>
      [...document.querySelectorAll("#toolResults a")].map((a) => ({ href: a.href, name: a.textContent || "" }))
    );
    const catatan = await page.evaluate(() => {
      const el = document.querySelector("#toolResults .res-meta");
      return el ? el.textContent : "";
    });
    if (!links.length) {
      await page.evaluate(() => document.getElementById("toolBackBtn")?.click());
      await page.waitForTimeout(300);
      return { bytes: null, durasi, galat, catatan, semua: [] };
    }
    const semua = [];
    for (const l of links) {
      const arr = await page.evaluate(async (u) => {
        const r = await fetch(u);
        return Array.from(new Uint8Array(await r.arrayBuffer()));
      }, l.href);
      semua.push({ name: l.name, bytes: Buffer.from(arr) });
    }
    await page.evaluate(() => document.getElementById("toolBackBtn")?.click());
    await page.waitForTimeout(300);
    return { bytes: semua[0].bytes, durasi, galat: "", catatan, semua };
  };

  const analisis = async (buf) => page.evaluate(ANALISIS, { b64: buf.toString("base64") });

  const file4 = path.join(FIX, "empat-halaman.pdf");
  const file7 = path.join(FIX, "tujuh-halaman.pdf");
  const fileRusak = path.join(FIX, "rusak.pdf");

  /* ============ 1. Widget muncul di alat yang relevan ============ */
  {
    const dengan = ["Rapi PDF", "Putar PDF", "Potong PDF", "Tambah watermark", "Tambah nomor halaman", "OCR PDF", "Redaksi PDF", "PDF ke JPG"];
    for (const nama of dengan) {
      const ok = await bukaAlat(nama);
      if (!ok) { check(`Alat "${nama}" ditemukan`, false, "kartu tidak ditemukan"); continue; }
      /* Widget ADA + slider benar-benar TERLIHAT (bukan sekadar ada
         di DOM). Slider harus langsung terlihat saat alat dibuka,
         tanpa harus memilih mode dulu. */
      const w = await page.evaluate(() => {
        const wrap = document.querySelector(".tool-pagerange");
        const area = document.querySelector(".tool-pr-area");
        const angka = document.querySelector(".tool-pr-angka");
        const tA = document.getElementById("f_halaman_dari");
        const tB = document.getElementById("f_halaman_sampai");
        const nA = document.getElementById("f_halaman_dari_num");
        const nB = document.getElementById("f_halaman_sampai_num");
        const terlihat = (el) =>
          !!el && !el.hidden && el.offsetParent !== null &&
          el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().width > 0;
        return {
          ada: !!wrap,
          area: terlihat(area),
          angka: terlihat(angka),
          thumbA: terlihat(tA),
          thumbB: terlihat(tB),
          numA: terlihat(nA),
          numB: terlihat(nB),
          chip: !!document.querySelector('.tool-pr-chip[data-mode="range"]'),
        };
      });
      check(`Alat "${nama}" punya widget rentang halaman`, w.ada);
      check(`Alat "${nama}" slider rentang halaman TERLIHAT`, w.area && w.thumbA && w.thumbB,
        `area=${w.area} thumb=${w.thumbA}/${w.thumbB}`);
      check(`Alat "${nama}" kotak angka rentang halaman TERLIHAT`, w.angka && w.numA && w.numB,
        `angka=${w.angka} num=${w.numA}/${w.numB}`);
      check(`Alat "${nama}" punya chip mode Rentang`, w.chip);
    }
    /* alat yang TIDAK relevan tidak boleh punya slider */
    const tanpa = ["Bandingkan PDF", "Lindungi PDF", "PDF ke WORD", "PDF ke PDF/A"];
    for (const nama of tanpa) {
      const ok = await bukaAlat(nama);
      if (!ok) { check(`Alat "${nama}" ditemukan`, false, "kartu tidak ditemukan"); continue; }
      const ada = await page.evaluate(() => !!document.querySelector(".tool-pagerange"));
      check(`Alat "${nama}" TIDAK punya slider (tidak relevan)`, !ada);
    }
  }

  /* ============ 2. Slider membaca jumlah halaman dokumen ============ */
  {
    await bukaAlat("Rapi PDF");
    await page.setInputFiles("#toolInput", file7);
    await page.waitForTimeout(1400);
    const info = await page.evaluate(() => {
      const el = document.getElementById("f_halaman_info");
      const a = document.getElementById("f_halaman_dari");
      const b = document.getElementById("f_halaman_sampai");
      return {
        teks: el ? el.textContent : "",
        maxA: a ? a.max : "",
        maxB: b ? b.max : "",
        disabled: a ? a.disabled : null,
      };
    });
    check("Slider batas atas = jumlah halaman dokumen (7)", info.maxA === "7" && info.maxB === "7", `max=${info.maxA}`);
    check("Ringkasan menampilkan jumlah halaman", /7/.test(info.teks), info.teks);
    check("Slider aktif setelah PDF dimuat", info.disabled === false, `disabled=${info.disabled}`);
    await page.evaluate(() => document.getElementById("toolBackBtn")?.click());
    await page.waitForTimeout(300);
  }

  /* ============ 2b. Slider langsung bisa dipakai (mode bawaan) ===== */
  {
    await bukaAlat("Putar PDF");
    await page.setInputFiles("#toolInput", file7);
    await page.waitForTimeout(1400);
    /* Tanpa memilih mode apa pun: geser thumb bawah -> mode harus
       otomatis menjadi "Rentang" dan rentangnya jadi 3-akhir. */
    const setelah = await page.evaluate(() => {
      const chipRange = document.querySelector('.tool-pr-chip[data-mode="range"]');
      const chipOnBefore = chipRange ? chipRange.classList.contains("is-on") : null;
      const t = document.getElementById("f_halaman_dari");
      if (!t) return { chipOnBefore, gagal: "slider tidak ada" };
      t.value = "3";
      t.dispatchEvent(new Event("input", { bubbles: true }));
      const info = document.getElementById("f_halaman_info");
      return {
        chipOnBefore,
        chipOnAfter: chipRange ? chipRange.classList.contains("is-on") : null,
        info: info ? info.textContent : "",
        dari: document.getElementById("f_halaman_dari_num")?.value,
      };
    });
    check("Mode bawaan bukan 'Rentang' (slider tetap tampil utuh)",
      setelah.chipOnBefore === false, `chip=${setelah.chipOnBefore}`);
    check("Geser slider langsung -> mode berpindah ke 'Rentang'",
      setelah.chipOnAfter === true, `chip=${setelah.chipOnAfter}`);
    check("Geser slider langsung -> rentang jadi 3 s/d akhir",
      /^Halaman 3/.test(setelah.info || "") && /7/.test(setelah.info || ""),
      `${setelah.info} dari=${setelah.dari}`);
    await page.evaluate(() => document.getElementById("toolBackBtn")?.click());
    await page.waitForTimeout(300);
  }

  /* ============ 3. Mode ganjil / genap ============ */
  {
    await bukaAlat("Putar PDF");
    await page.setInputFiles("#toolInput", file7);
    await page.waitForTimeout(1200);
    const okChip = await setRentang("odd");
    check("Chip mode 'Ganjil' tersedia", okChip);
    const r = await jalankan(file7, { rentang: { mode: "odd" } });
    check("Putar PDF mode ganjil berhasil", !!r.bytes, r.bytes ? `${r.bytes.length} byte` : r.galat);
    if (r.bytes) {
      const a = await analisis(r.bytes);
      const rot = a.halaman.map((h) => h.rot);
      const ganjil = [1, 3, 5, 7].every((n) => (rot[n - 1] % 360) === 90);
      const genap = [2, 4, 6].every((n) => (rot[n - 1] % 360) === 0);
      check("Halaman ganjil diputar 90°", ganjil, `rot=${rot.join(",")}`);
      check("Halaman genap TIDAK diputar", genap, `rot=${rot.join(",")}`);
    }
  }

  /* ============ 3b. Geometri slider: thumb tepat di posisi halaman ==== */
  {
    await bukaAlat("Putar PDF");
    await page.setInputFiles("#toolInput", file7);
    await page.waitForTimeout(1400);
    await setRentang("range", 2, 4);
    const geo = await page.evaluate(() => {
      const tA = document.getElementById("f_halaman_dari");
      const tB = document.getElementById("f_halaman_sampai");
      const isi = document.querySelector(".tool-pr-isi");
      if (!tA || !tB || !isi) return null;
      const thumb = 19; /* lebar thumb sesuai CSS */
      const pusat = (el) => {
        const r = el.getBoundingClientRect();
        const kiri = r.left + thumb / 2;
        const kanan = r.right - thumb / 2;
        const min = Number(el.min), max = Number(el.max), val = Number(el.value);
        return kiri + ((val - min) / Math.max(1, max - min)) * (kanan - kiri);
      };
      const rIsi = isi.getBoundingClientRect();
      return {
        thumbA: pusat(tA),
        thumbB: pusat(tB),
        barKiri: rIsi.left,
        barKanan: rIsi.right,
        lebar: tA.getBoundingClientRect().width,
      };
    });
    check("Geometri slider terukur", !!geo, geo ? `lebar=${geo.lebar}` : "tidak ada slider");
    if (geo) {
      const deltaA = Math.abs(geo.thumbA - geo.barKiri);
      const deltaB = Math.abs(geo.thumbB - geo.barKanan);
      check("Ujung bar warna tepat di bawah thumb (halaman 2)",
        deltaA < 2, `selisih=${deltaA.toFixed(2)}px`);
      check("Ujung bar warna tepat di bawah thumb (halaman 4)",
        deltaB < 2, `selisih=${deltaB.toFixed(2)}px`);
      /* posisi thumb harus naik monotonis (halaman 2 < halaman 4) */
      check("Posisi thumb naik sesuai nomor halaman",
        geo.thumbB > geo.thumbA, `A=${geo.thumbA.toFixed(1)} B=${geo.thumbB.toFixed(1)}`);
    }
    await page.evaluate(() => document.getElementById("toolBackBtn")?.click());
    await page.waitForTimeout(300);
  }

  /* ============ 4. Rentang membatasi halaman yang diproses ============ */
  {
    await bukaAlat("Putar PDF");
    const r = await jalankan(file7, { rentang: { mode: "range", dari: 2, sampai: 4 } });
    check("Putar PDF rentang 2-4 berhasil", !!r.bytes, r.bytes ? `${r.bytes.length} byte` : r.galat);
    if (r.bytes) {
      const a = await analisis(r.bytes);
      const rot = a.halaman.map((h) => h.rot);
      const dalam = [2, 3, 4].every((n) => rot[n - 1] % 360 === 90);
      const luar = [1, 5, 6, 7].every((n) => rot[n - 1] % 360 === 0);
      check("Halaman 2-4 diputar", dalam, `rot=${rot.join(",")}`);
      check("Halaman di luar rentang TIDAK diputar", luar, `rot=${rot.join(",")}`);
      check("Catatan menyebut jumlah halaman diproses", /3 dari 7/.test(r.catatan || ""), r.catatan);
    }
  }

  /* ============ 5. Rapi PDF: hanya halaman terpilih yang dirapikan ======== */
  {
    await bukaAlat("Rapi PDF");
    /* trim = TRUE: pemangkasan margin mengubah tampilan halaman, jadi
       halaman terpilih benar-benar bisa dibedakan dari halaman lain.
       (deskew/trim/stripMeta semuanya OFF tidak mengubah apa pun.) */
    const r = await jalankan(file7, {
      opsi: { deskew: false, trim: true, stripMeta: false },
      rentang: { mode: "range", dari: 2, sampai: 3 },
    });
    check("Rapi PDF rentang 2-3 berhasil", !!r.bytes, r.bytes ? `${r.bytes.length} byte` : r.galat);
    if (r.bytes) {
      const before = await analisis(fs.readFileSync(file7));
      const after = await analisis(r.bytes);
      check("Jumlah halaman tetap 7", after.numPages === 7, `halaman=${after.numPages}`);
      const sama = (i) =>
        before.halaman[i].hash === after.halaman[i].hash &&
        before.halaman[i].nonPutih === after.halaman[i].nonPutih;
      check("Halaman 2-3 berubah (diproses)", !sama(1) || !sama(2), "berubah");
      check("Halaman di luar rentang TIDAK berubah", sama(0) && sama(3) && sama(6), "identik");
      check("Catatan Rapi PDF menyebut cakupan", /2 dari 7/.test(r.catatan || ""), r.catatan);
    }
  }

  /* ============ 6. Nomor halaman: nomor absolut tetap benar ============ */
  {
    await bukaAlat("Tambah nomor halaman");
    const r = await jalankan(file4, {
      opsi: { fmt: "n" },
      rentang: { mode: "range", dari: 2, sampai: 3 },
    });
    check("Nomor halaman rentang 2-3 berhasil", !!r.bytes, r.bytes ? `${r.bytes.length} byte` : r.galat);
    if (r.bytes) {
      const a = await analisis(r.bytes);
      /* Nomor halaman baru ditulis di bagian BAWAH halaman (y kecil).
         Teks sumber ("HALAMAN 1") ada di bagian atas, jadi jangan
         dianggap sebagai nomor yang ditambahkan. */
      const bawah = (h) => h.items.filter((it) => it.y < 120).map((it) => it.s).join(" ").trim();
      const t = a.halaman.map(bawah);
      check("Halaman 2 diberi nomor 2", /\b2\b/.test(t[1]), `kaki="${t[1]}"`);
      check("Halaman 3 diberi nomor 3", /\b3\b/.test(t[2]), `kaki="${t[2]}"`);
      check("Halaman 1 TIDAK diberi nomor", !/\b1\b/.test(t[0]), `kaki="${t[0]}"`);
      check("Halaman 4 TIDAK diberi nomor", !/\b4\b/.test(t[3]), `kaki="${t[3]}"`);
    }
  }

  /* ============ 7. Watermark: hanya halaman terpilih ============ */
  {
    await bukaAlat("Tambah watermark");
    const r = await jalankan(file4, {
      opsi: { text: "RAHASIA", layout: "single", size: 40 },
      rentang: { mode: "range", dari: 2, sampai: 2 },
    });
    check("Watermark rentang 2-2 berhasil", !!r.bytes, r.bytes ? `${r.bytes.length} byte` : r.galat);
    if (r.bytes) {
      const before = await analisis(fs.readFileSync(file4));
      const after = await analisis(r.bytes);
      check("Halaman 2 berubah (ada watermark)", after.halaman[1].nonPutih > before.halaman[1].nonPutih,
        `${before.halaman[1].nonPutih} -> ${after.halaman[1].nonPutih}`);
      check("Halaman 1,3,4 TIDAK berubah",
        after.halaman[0].hash === before.halaman[0].hash &&
        after.halaman[2].hash === before.halaman[2].hash &&
        after.halaman[3].hash === before.halaman[3].hash, "identik");
    }
  }

  /* ============ 8. PDF ke JPG: hanya halaman terpilih ============ */
  {
    await bukaAlat("PDF ke JPG");
    const r = await jalankan(file4, {
      opsi: { zip: true, dpi: "72", format: "png" },
      rentang: { mode: "range", dari: 2, sampai: 3 },
    });
    check("PDF ke JPG rentang 2-3 berhasil", !!r.bytes, r.bytes ? `${r.bytes.length} byte` : r.galat);
    if (r.bytes) {
      /* ZIP: periksa nama berkas di dalam */
      const nama = await page.evaluate(async () => {
        const a = document.querySelector("#toolResults a");
        if (!a) return "";
        const r = await fetch(a.href);
        const buf = new Uint8Array(await r.arrayBuffer());
        const z = await JSZip.loadAsync(buf);
        return Object.keys(z.files).join(",");
      });
      check("ZIP berisi 2 gambar (halaman 2 & 3)", /002\.png/.test(nama) && /003\.png/.test(nama) && !/001\.png/.test(nama), nama);
    }
  }

  /* ============ 9. Rentang di luar jangkauan -> pesan jelas ============ */
  {
    await bukaAlat("Rapi PDF");
    harapGagal = true;
    const r = await jalankan(file4, {
      opsi: { deskew: false, trim: false, stripMeta: false },
      rentang: { mode: "range", dari: 8, sampai: 12 },
    });
    check("Rentang di luar jangkauan tidak menghasilkan file", !r.bytes, r.galat || "berhasil diam-diam");
    check("Rentang di luar jangkauan (Rapi PDF) menampilkan pesan jelas",
      /tidak ada|di luar jangkauan|hanya punya/i.test(r.galat || ""), r.galat || "(tidak ada pesan)");
  }

  /* ============ 9b. Potong PDF: hanya halaman terpilih ================ */
  {
    await bukaAlat("Potong PDF");
    const r = await jalankan(file4, {
      opsi: { preset: "margin", top: 10, bottom: 10, left: 10, right: 10 },
      rentang: { mode: "range", dari: 2, sampai: 2 },
    });
    check("Potong PDF rentang 2-2 berhasil", !!r.bytes, r.bytes ? `${r.bytes.length} byte` : r.galat);
    if (r.bytes) {
      const before = await analisis(fs.readFileSync(file4));
      const after = await analisis(r.bytes);
      check("Potong: hanya halaman 2 yang dipotong",
        after.halaman[1].width < before.halaman[1].width &&
        after.halaman[0].width === before.halaman[0].width,
        `lebar=${before.halaman.map((h) => h.width).join(",")} -> ${after.halaman.map((h) => h.width).join(",")}`);
      check("Potong: catatan menyebut cakupan", /1 dari 4/.test(r.catatan || ""), r.catatan);
    }
  }

  /* ============ 9c. Mode genap ======================================== */
  {
    await bukaAlat("Putar PDF");
    const r = await jalankan(file4, { rentang: { mode: "even" } });
    check("Putar PDF mode genap berhasil", !!r.bytes, r.bytes ? `${r.bytes.length} byte` : r.galat);
    if (r.bytes) {
      const a = await analisis(r.bytes);
      const rot = a.halaman.map((h) => h.rot);
      check("Halaman genap diputar 90°", [2, 4].every((n) => rot[n - 1] % 360 === 90), rot.join(","));
      check("Halaman ganjil TIDAK diputar", [1, 3].every((n) => rot[n - 1] % 360 === 0), rot.join(","));
    }
  }

  /* ============ 10. Mode "semua" = tidak ada batasan ===================== */
  {
    await bukaAlat("Putar PDF");
    const r = await jalankan(file4, { rentang: { mode: "all" } });
    check("Mode semua: semua halaman diputar", !!r.bytes, r.bytes ? `${r.bytes.length} byte` : r.galat);
    if (r.bytes) {
      const a = await analisis(r.bytes);
      check("Keempat halaman diputar 90°", a.halaman.every((h) => h.rot % 360 === 90), a.halaman.map((h) => h.rot).join(","));
    }
  }

  /* ============ 11. Multi-berkas: rentang RELATIF per berkas ========= */
  {
    await bukaAlat("Putar PDF");
    const r = await jalankan([file4, file7], { rentang: { mode: "range", dari: 2, sampai: 4 } });
    check("Multi-berkas: dua berkas menghasilkan dua hasil", r.semua.length === 2,
      `hasil=${r.semua.length} galat=${r.galat || ""}`);
    if (r.semua.length === 2) {
      const a4 = await analisis(r.semua[0].bytes);
      const a7 = await analisis(r.semua[1].bytes);
      /* berkas 4 halaman: 2,3,4 diputar; berkas 7 halaman: 2,3,4 diputar */
      const ok4 = [2, 3, 4].every((n) => a4.halaman[n - 1].rot % 360 === 90);
      const luar4 = [1].every((n) => a4.halaman[n - 1].rot % 360 === 0);
      const ok7 = [2, 3, 4].every((n) => a7.halaman[n - 1].rot % 360 === 90);
      const luar7 = [1, 5, 6, 7].every((n) => a7.halaman[n - 1].rot % 360 === 0);
      check("Multi-berkas: rentang sama berlaku per berkas (bukan dokumen gabungan)", ok4 && ok7,
        `rot4=${a4.halaman.map((h) => h.rot).join(",")} rot7=${a7.halaman.map((h) => h.rot).join(",")}`);
      check("Multi-berkas: halaman luar rentang tidak diputar", luar4 && luar7,
        `rot4=${a4.halaman.map((h) => h.rot).join(",")} rot7=${a7.halaman.map((h) => h.rot).join(",")}`);
    }
  }

  /* ============ 12. Rentang di luar jangkauan -> pesan jelas ========== */
  {
    await bukaAlat("Putar PDF");
    const r = await jalankan(file4, { rentang: { mode: "range", dari: 8, sampai: 12 } });
    check("Rentang di luar jangkauan tidak menghasilkan berkas", !r.bytes, r.galat || "berhasil diam-diam");
    check("Rentang di luar jangkauan menampilkan pesan yang jelas",
      /tidak ada|di luar jangkauan|hanya punya/i.test(r.galat || ""), r.galat || "(tidak ada pesan)");
  }

  /* ============ 13. Berkas rusak -> pesan jelas ====================== */
  {
    await bukaAlat("Putar PDF");
    const r = await jalankan(fileRusak, { rentang: { mode: "all" } });
    check("Berkas rusak tidak menghasilkan berkas diam-diam", !r.bytes, r.galat || "berhasil diam-diam");
    check("Berkas rusak menampilkan pesan galat", !!r.galat, r.galat || "(tidak ada pesan)");
  }

  harapGagal = false;

  /* ============ 14. OCR: halaman luar rentang dipertahankan ========= */
  {
    await bukaAlat("OCR PDF");
    const r = await jalankan(file4, {
      opsi: { mode: "searchable", existing: "force", contrast: false },
      rentang: { mode: "range", dari: 2, sampai: 3 },
      tunggu: 120,
    });
    check("OCR rentang 2-3 berhasil", !!r.bytes, r.bytes ? `${r.bytes.length} byte` : r.galat);
    if (r.bytes) {
      const before = await analisis(fs.readFileSync(file4));
      const after = await analisis(r.bytes);
      check("OCR: jumlah halaman tetap 4", after.numPages === 4, `halaman=${after.numPages}`);
      const sama = (i) =>
        before.halaman[i].hash === after.halaman[i].hash &&
        before.halaman[i].nonPutih === after.halaman[i].nonPutih;
      check("OCR: halaman luar rentang (1 & 4) dipertahankan", sama(0) && sama(3), "identik");
      check("OCR: catatan menyebut cakupan", /2 dari 4/.test(r.catatan || ""), r.catatan);
    }
  }

  /* ============ 15. Redaksi: hanya hit di halaman terpilih ========== */
  {
    await bukaAlat("Redaksi PDF");
    const r = await jalankan(file4, {
      opsi: { term: "halaman", scale: 150 },
      rentang: { mode: "range", dari: 2, sampai: 2 },
      tunggu: 120,
    });
    check("Redaksi rentang 2-2 berhasil", !!r.bytes, r.bytes ? `${r.bytes.length} byte` : r.galat);
    if (r.bytes) {
      const before = await analisis(fs.readFileSync(file4));
      const after = await analisis(r.bytes);
      check("Redaksi: jumlah halaman tetap 4", after.numPages === 4, `halaman=${after.numPages}`);
      const sama = (i) =>
        before.halaman[i].hash === after.halaman[i].hash &&
        before.halaman[i].nonPutih === after.halaman[i].nonPutih;
      check("Redaksi: halaman luar rentang (1,3,4) tidak berubah", sama(0) && sama(2) && sama(3), "identik");
      check("Redaksi: hanya halaman 2 yang dirender ulang",
        !sama(1) && after.halaman[1].nonPutih > 0, `nonPutih ${before.halaman[1].nonPutih} -> ${after.halaman[1].nonPutih}`);
    }
  }

  /* ============ 15b. Redaksi: panel "Cari kata" hormati rentang ===== */
  {
    await bukaAlat("Redaksi PDF");
    await page.setInputFiles("#toolInput", file4);
    await page.waitForTimeout(1200);
    await setRentang("range", 2, 2);
    await page.evaluate(() => {
      const el = document.getElementById("f_term");
      el.value = "halaman";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const adaTombol = await page.evaluate(() => {
      const b = [...document.querySelectorAll("#toolExtra button")].find((x) =>
        /cari kata/i.test(x.textContent || "")
      );
      if (!b) return false;
      b.click();
      return true;
    });
    check("Panel Redaksi punya tombol 'Cari kata'", adaTombol);
    if (adaTombol) {
      let teks = "";
      for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(400);
        teks = await page.evaluate(() => {
          const el = document.querySelector("#toolExtra .redact-hasil");
          return el ? el.textContent || "" : "";
        });
        if (teks && !/Mencari/.test(teks)) break;
      }
      check("Panel Redaksi menampilkan ringkasan cakupan", /akan ditutup|ditemukan/i.test(teks), teks.slice(0, 140));
      check("Panel Redaksi hanya menampilkan hit di halaman terpilih",
        /Hal\. 2/.test(teks) && !/Hal\. 1\b/.test(teks) && !/Hal\. 3\b/.test(teks) && !/Hal\. 4\b/.test(teks),
        teks.slice(0, 200));
    }
    await page.evaluate(() => document.getElementById("toolBackBtn")?.click());
    await page.waitForTimeout(300);
  }

  /* ============ 16. Performa: rentang tidak boleh lambat ============ */
  {
    await bukaAlat("Putar PDF");
    const r = await jalankan(file7, { rentang: { mode: "range", dari: 2, sampai: 6 } });
    check("Performa: rentang 2-6 pada 7 halaman < 20 detik", !!r.bytes && Number(r.durasi) < 20,
      `${r.durasi} detik`);
  }

  /* ============ 17. Widget: ringkasan & input angka ================== */
  {
    await bukaAlat("Putar PDF");
    await page.setInputFiles("#toolInput", file7);
    await page.waitForTimeout(1400);
    await setRentang("range", 2, 4);
    const w = await page.evaluate(() => {
      const info = document.getElementById("f_halaman_info");
      const a = document.getElementById("f_halaman_dari_num");
      const b = document.getElementById("f_halaman_sampai_num");
      return { info: info ? info.textContent : "", dari: a ? a.value : "", sampai: b ? b.value : "" };
    });
    check("Input angka menampilkan nilai yang diminta (2 & 4)", w.dari === "2" && w.sampai === "4",
      `dari=${w.dari} sampai=${w.sampai}`);
    check("Ringkasan menyebut rentang 2-4", /Halaman 2/.test(w.info) && /4/.test(w.info), w.info);
    /* rentang di luar jangkauan harus tetap utuh di kotak angka */
    await setRentang("range", 8, 12);
    const w2 = await page.evaluate(() => {
      const info = document.getElementById("f_halaman_info");
      const a = document.getElementById("f_halaman_dari_num");
      const b = document.getElementById("f_halaman_sampai_num");
      return { info: info ? info.textContent : "", dari: a ? a.value : "", sampai: b ? b.value : "" };
    });
    check("Rentang di luar jangkauan TIDAK dijepit di kotak angka",
      w2.dari === "8" && w2.sampai === "12", `dari=${w2.dari} sampai=${w2.sampai}`);
    check("Ringkasan menandai rentang di luar jangkauan", /luar jangkauan/i.test(w2.info), w2.info);
    await page.evaluate(() => document.getElementById("toolBackBtn")?.click());
    await page.waitForTimeout(300);
  }

  /* ============ 17b. Screenshot bukti widget ========================== */
  {
    const shotDir = path.join(ROOT, "docs", "audit-pagerange-2026-11-24");
    fs.mkdirSync(shotDir, { recursive: true });
    await bukaAlat("Putar PDF");
    await page.setInputFiles("#toolInput", file7);
    await page.waitForTimeout(1400);
    const potret = async (nama) => {
      const box = await page.evaluate(() => {
        const el = document.querySelector(".tool-pagerange");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.max(0, r.x - 12), y: Math.max(0, r.y - 12), width: r.width + 24, height: r.height + 24 };
      });
      if (!box) return false;
      await page.screenshot({ path: path.join(shotDir, nama), clip: box });
      return true;
    };
    check("Screenshot widget mode bawaan (slider terlihat)", await potret("widget-semua.png"));
    await setRentang("range", 2, 4);
    check("Screenshot widget mode rentang", await potret("widget-rentang.png"));
    await setRentang("odd");
    check("Screenshot widget mode ganjil", await potret("widget-ganjil.png"));
    await page.evaluate(() => document.getElementById("toolBackBtn")?.click());
    await page.waitForTimeout(300);
  }

  /* ============ 18. Tidak ada error JS selama audit ==================== */
  check("Tidak ada error JavaScript", errors.length === 0, errors.slice(0, 3).join(" | "));

  /* ---------- ringkasan ---------- */
  console.log("\n===== RINGKASAN AUDIT SLIDER RENTANG HALAMAN =====");
  console.log(`Lulus: ${pass}  Gagal: ${fail}`);
  const outDir = path.join(ROOT, "docs");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "audit-pagerange-hasil.json"),
    JSON.stringify({ tanggal: new Date().toISOString(), pass, fail, results }, null, 2)
  );
  await browser.close();
  srv.close();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
