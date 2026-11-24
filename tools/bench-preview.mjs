/**
 * Benchmark fitur preview (Pisah PDF, Gabung PDF, Susun PDF).
 *
 * Mengukur perilaku nyata di Chromium:
 *  - waktu sampai pratinjau pertama benar-benar terlihat (bukan sekadar DOM)
 *  - berapa kali canvas dirender (proxy biaya render pdf.js)
 *  - waktu saat grid pratinjau dibangun ulang (mis. ganti mode urutan)
 *  - jumlah node DOM yang hidup
 *
 * Env:
 *   PORT         - porta server lokal
 *   SERVE_DIR    - direktori statis (default: repo ini)
 *   FIXTURES_DIR - folder fixture (default: fixtures)
 *   OUT_JSON     - file keluaran JSON
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "./browser.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.SERVE_DIR || path.join(HERE, ".."));
const FIX = path.resolve(process.env.FIXTURES_DIR || path.join(ROOT, "fixtures"));
const PORT = Number(process.env.PORT || 8077);
const OUT_JSON = process.env.OUT_JSON || path.join(ROOT, "docs", "bench-preview.json");

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".pdf": "application/pdf", ".png": "image/png",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".wasm": "application/wasm",
  ".json": "application/json", ".traineddata": "application/octet-stream",
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

/* Hitung render canvas (proxy utama biaya thumbnail). */
const HITUNG = `
  window.__renderCount = 0;
  window.__toBlobCount = 0;
  window.__dataUrlCount = 0;
  const toBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function (...a) {
    window.__toBlobCount++;
    return toBlob.apply(this, a);
  };
  const toDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function (...a) {
    window.__dataUrlCount++;
    return toDataURL.apply(this, a);
  };
  const draw = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function (...a) {
    window.__renderCount++;
    return draw.apply(this, a);
  };
  /* penghitung perubahan DOM -> dipakai mengukur "waktu sampai antarmuka
     berhenti berubah" setelah sebuah interaksi */
  window.__mut = 0;
  const mulai = () => {
    if (!document.body) return;
    window.__mut = 0;
    new MutationObserver(() => { window.__mut++; }).observe(document.body, {
      childList: true, subtree: true, attributes: true, characterData: true,
    });
  };
  if (document.body) mulai();
  else document.addEventListener("DOMContentLoaded", mulai);
`;

const RESET = `window.__renderCount = 0; window.__toBlobCount = 0; window.__dataUrlCount = 0;`;

async function main() {
  const dense = path.join(FIX, "dense90.pdf");
  const sample = path.join(FIX, "sample.pdf");
  if (!fs.existsSync(dense)) {
    console.error(`Fixture tidak ada: ${dense}\nJalankan: node tools/mkfixtures.mjs`);
    process.exit(2);
  }
  const srv = await server();
  const browser = await chromium();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(HITUNG);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
  await page.waitForTimeout(1200);

  const out = { tanggal: new Date().toISOString(), bagian: {} };

  /* Tunggu sampai antrean render latar berhenti (tidak ada render baru). */
  const settle = async (maks = 60) => {
    let last = -1;
    let stable = 0;
    for (let i = 0; i < maks; i++) {
      const n = await page.evaluate(() => window.__toBlobCount + window.__dataUrlCount);
      if (n === last) {
        stable++;
        if (stable >= 5) return n;
      } else {
        stable = 0;
        last = n;
      }
      await page.waitForTimeout(250);
    }
    return last;
  };

  /* Ukur latensi interaksi: jalankan aksi, lalu tunggu sampai antarmuka
     BERHENTI berubah (DOM stabil). Ini ukuran yang dirasakan pengguna:
     "berapa lama sampai layar diam lagi". */
  const ukurInteraksi = async (aksi) => {
    await settle();
    await page.evaluate(RESET);
    const t0 = Date.now();
    await aksi();
    let last = -1;
    let stable = 0;
    for (let i = 0; i < 200; i++) {
      const m = await page.evaluate(() => window.__mut);
      if (m === last) {
        stable++;
        if (stable >= 4) break;
      } else {
        stable = 0;
        last = m;
      }
      await page.waitForTimeout(50);
    }
    const ms = Date.now() - t0;
    const counter = await page.evaluate(() => ({
      blob: window.__toBlobCount,
      dataUrl: window.__dataUrlCount,
    }));
    return { ms, ...counter };
  };

  /* ---------- 1. Pisah PDF (split) ---------- */
  {
    await page.click("#tab-split");
    await page.waitForTimeout(300);
    await page.evaluate(RESET);
    const t0 = Date.now();
    await page.setInputFiles("#fileInput", [dense]);
    /* tunggu sampai ada <img> pertama benar-benar di dalam .thumb */
    await page.waitForFunction(
      () => !!document.querySelector("#files .thumb img"),
      null, { timeout: 60000 }
    ).catch(() => {});
    const tFirst = Date.now() - t0;
    /* tunggu sampai semua thumbnail selesai (90 halaman) */
    await page.waitForFunction(
      () => {
        const thumbs = document.querySelectorAll("#files .thumb");
        if (!thumbs.length) return false;
        const done = document.querySelectorAll("#files .thumb img").length;
        return done >= thumbs.length;
      },
      null, { timeout: 120000 }
    ).catch(() => {});
    const tAll = Date.now() - t0;
    const m = await page.evaluate(() => ({
      thumbs: document.querySelectorAll("#files .thumb").length,
      rendered: document.querySelectorAll("#files .thumb img").length,
      render: window.__renderCount,
      toBlob: window.__toBlobCount,
      nodes: document.querySelectorAll("*").length,
    }));
    out.bagian.pisahPdf = { tFirst, tAll, ...m };

    /* interaksi: naikkan urutan file -> apakah pratinjau dibangun ulang? */
    const urut = await ukurInteraksi(() =>
      page.evaluate(() => {
        const b = document.querySelector('#files [data-act="up"]');
        if (b) b.click();
      })
    );
    out.bagian.pisahPdfUrutkanUlang = {
      ...urut,
      rendered: await page.evaluate(
        () => document.querySelectorAll("#files .thumb img").length
      ),
    };
  }

  /* ---------- 2. Gabung PDF (merge) ---------- */
  {
    await page.click("#tab-merge");
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const btn = document.getElementById("mergeClearBtn");
      if (!btn) return;
      const o = window.confirm; window.confirm = () => true; btn.click(); window.confirm = o;
    });
    await page.waitForTimeout(300);
    await page.evaluate(RESET);
    const t0 = Date.now();
    await page.setInputFiles("#mergeInput", [dense, sample]);
    await page.waitForFunction(
      () => document.querySelectorAll("#mergePreviewGrid .mp-cell").length > 0,
      null, { timeout: 60000 }
    ).catch(() => {});
    const tCards = Date.now() - t0;
    await page.waitForFunction(
      () => !!document.querySelector("#mergePreviewGrid img.mp-thumb-img"),
      null, { timeout: 60000 }
    ).catch(() => {});
    const tThumb = Date.now() - t0;
    await page.waitForTimeout(2500);
    const m = await page.evaluate(() => ({
      kartu: document.querySelectorAll("#mergePreviewGrid .mp-cell").length,
      terRender: document.querySelectorAll("#mergePreviewGrid img.mp-thumb-img").length,
      render: window.__renderCount,
      toBlob: window.__toBlobCount,
    }));
    out.bagian.gabungMuat = { tCards, tThumb, ...m };

    /* ganti mode urutan -> berapa render ulang? */
    const mode1 = await ukurInteraksi(
      () => page.evaluate(() => document.querySelector('.mchip[data-order="balik"]').click()),
      () => {
        const c = document.querySelectorAll("#mergePreviewGrid .mp-cell");
        return c.length && /beta\.pdf|gamma\.pdf/.test(c[0]?.querySelector(".mp-src")?.textContent || "");
      }
    );
    out.bagian.gabungGantiMode = {
      ...mode1,
      terRender: await page.evaluate(
        () => document.querySelectorAll("#mergePreviewGrid img.mp-thumb-img").length
      ),
    };

    /* geser satu halaman (mode kustom) */
    const geser = await ukurInteraksi(
      () =>
        page.evaluate(() => {
          const c = document.querySelectorAll("#mergePreviewGrid .mp-cell")[0];
          const b = [...c.querySelectorAll(".mp-btn")].find((x) => x.textContent === "→");
          b.click();
        }),
      () => document.querySelector('.mchip[data-order="kustom"]')?.classList.contains("is-on")
    );
    out.bagian.gabungGeserHalaman = geser;

    /* kembali ke mode asal -> harus FULL dari cache */
    const kembali = await ukurInteraksi(
      () => page.evaluate(() => document.querySelector('.mchip[data-order="asis"]').click()),
      () => {
        const c = document.querySelectorAll("#mergePreviewGrid .mp-cell");
        return c.length && /alpha\.pdf/.test(c[0]?.querySelector(".mp-src")?.textContent || "");
      }
    );
    out.bagian.gabungKembaliMode = kembali;

    /* scroll grid -> apakah halaman yang belum terlihat ikut dirender? */
    const scroll = await ukurInteraksi(
      () =>
        page.evaluate(() => {
          const g = document.getElementById("mergePreviewGrid");
          g.scrollTop = g.scrollHeight;
        }),
      () => {
        const g = document.getElementById("mergePreviewGrid");
        return g.scrollTop > 100;
      }
    );
    out.bagian.gabungScroll = {
      ...scroll,
      terRender: await page.evaluate(
        () => document.querySelectorAll("#mergePreviewGrid img.mp-thumb-img").length
      ),
      total: await page.evaluate(
        () => document.querySelectorAll("#mergePreviewGrid .mp-cell").length
      ),
    };
  }

  /* ---------- 3. Susun PDF (organize) ---------- */
  {
    await page.click("#tab-tools");
    await page.waitForTimeout(300);
    /* buka tool Susun PDF lewat pencarian */
    await page.fill("#toolSearch", "susun");
    await page.waitForTimeout(500);
    const clicked = await page.evaluate(() => {
      const b = [...document.querySelectorAll("[data-tool]")].find((x) =>
        (x.dataset.tool || "").includes("organize")
      );
      if (b) { b.click(); return true; }
      return false;
    });
    if (clicked) {
      await page.waitForTimeout(600);
      await page.evaluate(RESET);
      const t0 = Date.now();
      await page.setInputFiles("#toolInput", [dense]).catch(() => {});
      /* alternatif: input berkas tool yang aktif */
      const ok = await page.evaluate(() => {
        const inp = document.querySelector("#toolInput, #toolFile");
        return !!inp;
      });
      await page.waitForFunction(
        () => document.querySelectorAll(".org-cell").length > 0,
        null, { timeout: 120000 }
      ).catch(() => {});
      const tCells = Date.now() - t0;
      await page.evaluate(() => {
        document.querySelector(".organize-grid")?.scrollIntoView({ block: "start" });
      });
      await settle();
      const m = await page.evaluate(() => ({
        cells: document.querySelectorAll(".org-cell").length,
        imgs: document.querySelectorAll(".org-cell img").length,
        render: window.__renderCount,
        toBlob: window.__toBlobCount,
        dataUrl: window.__dataUrlCount,
      }));
      out.bagian.susunPdf = { ok, tCells, ...m };

      /* interaksi: putar satu halaman -> grid dibangun ulang, berapa render? */
      const putar = await ukurInteraksi(
        () =>
          page.evaluate(() => {
            const b = document.querySelector(".org-cell .org-btn");
            if (b) b.click();
          }),
        () => {
          const c = document.querySelector(".org-cell");
          return c && c.getAttribute("aria-label")?.includes("posisi 1");
        }
      );
      out.bagian.susunPutar = putar;
    } else {
      out.bagian.susunPdf = { ok: false, catatan: "tombol tool tidak ditemukan" };
    }
  }

  out.error = errors;
  console.log(JSON.stringify(out, null, 2));
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2));
  console.log("-> " + OUT_JSON);
  await browser.close();
  srv.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
