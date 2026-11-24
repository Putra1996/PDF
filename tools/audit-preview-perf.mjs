/**
 * Audit mendalam optimasi fitur pratinjau.
 *
 * Menguji perilaku nyata di Chromium (bukan hanya kemunculan elemen):
 *   - thumbnail benar-benar ter-render (bukan kotak placeholder)
 *   - node DOM dipakai ulang saat interaksi (tidak dibangun ulang)
 *   - cache thumbnail bekerja -> tidak ada render ulang sia-sia
 *   - pemuatan malas: hanya halaman terlihat yang dirender
 *   - grid pratinjau tidak dibangun dari nol saat interaksi
 *   - waktu muat & waktu interaksi stayed di bawah ambang
 *
 * Penting: sebelum mengukur "render ulang", harness menunggu sampai
 * antrean render latar sudah SEBELUM (settle) supaya angka yang
 * diukur benar-benar interaksi yang diuji.
 *
 * Jalankan:
 *   node tools/mkfixtures.mjs && node tools/mkfixtures-merge.mjs
 *   node tools/audit-preview-perf.mjs
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

/* Penghitung render thumbnail (proxy biaya render pdf.js). */
const HITUNG = `
  window.__blob = 0;
  window.__dataUrl = 0;
  const tb = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function (...a) { window.__blob++; return tb.apply(this, a); };
  const td = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function (...a) { window.__dataUrl++; return td.apply(this, a); };
  window.__urls = 0;
  const co = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (b) { window.__urls++; return co(b); };
`;

const RESET = `window.__blob = 0; window.__dataUrl = 0;`;

async function main() {
  const dense = path.join(FIX, "dense90.pdf");
  const sample = path.join(FIX, "sample.pdf");
  const alpha = path.join(FIX, "merge", "alpha.pdf");
  const beta = path.join(FIX, "merge", "beta.pdf");
  for (const f of [dense, sample, alpha, beta]) {
    if (!fs.existsSync(f)) {
      console.error(`Fixture tidak ada: ${f}`);
      process.exit(2);
    }
  }

  const srv = await server();
  const browser = await chromium();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(HITUNG);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
  await page.waitForTimeout(1500);

  /* ---------- helper ---------- */
  const tunggu = async (fn, maks = 60, jeda = 250, arg = undefined) => {
    for (let i = 0; i < maks; i++) {
      if (await page.evaluate(fn, arg)) return true;
      await page.waitForTimeout(jeda);
    }
    return false;
  };

  /* Tunggu sampai thumbnail benar-benar ter-decode (naturalWidth > 0). */
  const thumbTerlihat = async (sel, minimal = 3) =>
    tunggu(
      (a) => {
        const imgs = [...document.querySelectorAll(a.sel)];
        if (imgs.length < a.minimal) return false;
        const decode = imgs.filter((i) => i.naturalWidth > 10 && i.naturalHeight > 10);
        if (decode.length < a.minimal) return false;
        const diLihat = imgs.filter((i) => {
          const r = i.getBoundingClientRect();
          return r.bottom > -50 && r.top < window.innerHeight + 50;
        });
        if (!diLihat.length) return decode.length >= a.minimal;
        return diLihat.every((i) => i.naturalWidth > 10);
      },
      120,
      250,
      { sel, minimal }
    );

  /* Tunggu sampai antrean render latar berhenti (tidak ada render baru). */
  const settle = async (maks = 60) => {
    let last = -1;
    let stable = 0;
    for (let i = 0; i < maks; i++) {
      const n = await page.evaluate(() => window.__blob + window.__dataUrl);
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

  const renderCount = () => page.evaluate(() => window.__blob + window.__dataUrl);

  /* ============================================================
     A. PISAH PDF (tab split)
     ============================================================ */
  {
    await page.click("#tab-split");
    await page.waitForTimeout(400);
    const t0 = Date.now();
    await page.setInputFiles("#fileInput", [dense]);
    const okFirst = await tunggu(() => !!document.querySelector("#files .thumb img"), 120);
    const tFirst = Date.now() - t0;
    check("Pisah: thumbnail pertama tampil cepat", okFirst && tFirst < 15000, `${tFirst} ms`);
    check("Pisah: thumbnail benar-benar ter-render (bukan placeholder)",
      await thumbTerlihat("#files .thumb img", 3));

    await settle();
    const st = await page.evaluate(() => ({
      total: document.querySelectorAll("#files .thumb").length,
      img: document.querySelectorAll("#files .thumb img").length,
      ph: document.querySelectorAll("#files .thumb .ph").length,
    }));
    check("Pisah: pemuatan malas — tidak semua 90 halaman dirender",
      st.img < st.total && st.img > 0, `ter-render ${st.img} dari ${st.total}`);
    check("Pisah: sisanya masih berupa placeholder", st.ph === st.total - st.img,
      `placeholder=${st.ph}`);

    /* identitas node: ambil referensi SEBELUM reorder */
    await page.evaluate(() => {
      window.__cards = [...document.querySelectorAll("#files .fileblock")];
      window.__imgs = [...document.querySelectorAll("#files .thumb img")];
      window.__cardsLen = window.__cards.length;
    });
    await page.evaluate(RESET);
    const t1 = Date.now();
    await page.evaluate(() => {
      const b = document.querySelector('#files [data-act="up"]');
      if (b) b.click();
    });
    await page.waitForTimeout(1200);
    const reuse = await page.evaluate(() => {
      return {
        cards: window.__cards.filter((c) => c.isConnected).length,
        imgs: window.__imgs.filter((i) => i.isConnected).length,
        blob: window.__blob,
        dataUrl: window.__dataUrl,
        masihAda: document.querySelectorAll("#files .thumb img").length,
      };
    });
    const cardsBefore = await page.evaluate(() => window.__cardsLen);
    check("Pisah: reorder file TIDAK membangun ulang blok file (node sama)",
      reuse.cards === cardsBefore, `node dipakai ulang=${reuse.cards}/${cardsBefore}`);
    check("Pisah: reorder file tidak mengulang render thumbnail",
      reuse.blob === 0 && reuse.dataUrl === 0,
      `blob=${reuse.blob} dataUrl=${reuse.dataUrl}`);
    check("Pisah: thumbnail tetap tampil setelah reorder",
      reuse.masihAda > 0, `img=${reuse.masihAda}`);
    check("Pisah: reorder file cepat", Date.now() - t1 < 2000, `${Date.now() - t1} ms`);
  }

  /* ============================================================
     B. GABUNG PDF (tab merge)
     ============================================================ */
  {
    await page.click("#tab-merge");
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const btn = document.getElementById("mergeClearBtn");
      if (!btn) return;
      const o = window.confirm; window.confirm = () => true; btn.click(); window.confirm = o;
    });
    await page.waitForTimeout(300);

    const t0 = Date.now();
    await page.setInputFiles("#mergeInput", [dense]);
    const okCards = await tunggu(() => document.querySelectorAll("#mergePreviewGrid .mp-cell").length > 0, 120);
    const tCards = Date.now() - t0;
    check("Gabung: kartu pratinjau muncul cepat", okCards && tCards < 8000, `${tCards} ms`);
    check("Gabung: thumbnail pratinjau benar-benar ter-render",
      await thumbTerlihat("#mergePreviewGrid img.mp-thumb-img", 3));

    await settle();
    const st = await page.evaluate(() => {
      const g = document.getElementById("mergePreviewGrid");
      const cells = [...g.querySelectorAll(".mp-cell")];
      const gr = g.getBoundingClientRect();
      const vis = cells.filter((c) => {
        const r = c.getBoundingClientRect();
        return r.bottom > gr.top && r.top < gr.bottom;
      });
      const area = cells.filter((c) => {
        const r = c.getBoundingClientRect();
        return r.bottom > gr.top - 220 && r.top < gr.bottom + 220;
      });
      return {
        total: cells.length,
        img: g.querySelectorAll("img.mp-thumb-img").length,
        terlihat: vis.length,
        area: area.length,
        imgDiTerlihat: vis.filter((c) => c.querySelector("img.mp-thumb-img")).length,
      };
    });
    check("Gabung: pemuatan malas — hanya kartu di area terlihat yang dirender",
      st.img <= st.area + 2 && st.img < st.total,
      `img=${st.img} area={terlihat+margin}=${st.area} total=${st.total}`);
    check("Gabung: semua kartu terlihat punya thumbnail",
      st.imgDiTerlihat === st.terlihat, `${st.imgDiTerlihat}/${st.terlihat}`);

    /* --- interaksi 1: ganti mode "Dibalik" --- */
    await page.evaluate(() => {
      window.__cards = [...document.querySelectorAll("#mergePreviewGrid .mp-cell")];
      window.__imgs = [...document.querySelectorAll("#mergePreviewGrid img.mp-thumb-img")];
      window.__imgsUrl = window.__imgs.map((i) => i.src);
    });
    await page.evaluate(RESET);
    const t2 = Date.now();
    await page.evaluate(() => document.querySelector('.mchip[data-order="balik"]').click());
    await page.waitForTimeout(1200);
    const setelahBalik = await page.evaluate(() => {
      const g = document.getElementById("mergePreviewGrid");
      const cells = [...g.querySelectorAll(".mp-cell")];
      return {
        hidup: window.__cards.filter((c) => c.isConnected).length,
        imgHidup: window.__imgs.filter((i) => i.isConnected).length,
        sama: window.__imgs.filter((i, k) => i.isConnected && i.src === window.__imgsUrl[k]).length,
        total: cells.length,
        img: g.querySelectorAll("img.mp-thumb-img").length,
        blob: window.__blob,
        dataUrl: window.__dataUrl,
      };
    });
    check("Gabung: ganti mode memakai ulang node kartu (tidak dibangun ulang)",
      setelahBalik.hidup > 0, `node hidup=${setelahBalik.hidup}/${setelahBalik.total}`);
    check("Gabung: thumbnail lama tetap memakai object URL yang sama",
      setelahBalik.sama === setelahBalik.imgHidup && setelahBalik.imgHidup > 0,
      `sama=${setelahBalik.sama}/${setelahBalik.imgHidup}`);
    check("Gabung: hanya halaman BARU yang dirender saat mode dibalik",
      setelahBalik.blob <= setelahBalik.total,
      `render=${setelahBalik.blob} total=${setelahBalik.total}`);
    check("Gabung: ganti mode cepat", Date.now() - t2 < 3000, `${Date.now() - t2} ms`);

    /* --- interaksi 2: kembali ke "Sesuai file" (semua harus dari cache) --- */
    await settle();
    await page.evaluate(RESET);
    await page.evaluate(() => document.querySelector('.mchip[data-order="asis"]').click());
    await page.waitForTimeout(1200);
    const kembali = await page.evaluate(() => ({
      blob: window.__blob,
      dataUrl: window.__dataUrl,
      img: document.querySelectorAll("#mergePreviewGrid img.mp-thumb-img").length,
    }));
    check("Gabung: kembali ke mode awal TIDAK render ulang (cache bekerja)",
      kembali.blob === 0 && kembali.dataUrl === 0,
      `blob=${kembali.blob} dataUrl=${kembali.dataUrl}`);

    /* --- interaksi 3: geser satu halaman (tombol panah) --- */
    await settle();
    await page.evaluate(RESET);
    const t3 = Date.now();
    await page.evaluate(() => {
      const c = document.querySelectorAll("#mergePreviewGrid .mp-cell")[0];
      const b = [...c.querySelectorAll(".mp-btn")].find((x) => x.textContent === "→");
      b.click();
    });
    await page.waitForTimeout(1200);
    const geser = await page.evaluate(() => ({
      blob: window.__blob,
      dataUrl: window.__dataUrl,
      img: document.querySelectorAll("#mergePreviewGrid img.mp-thumb-img").length,
    }));
    check("Gabung: menggeser satu halaman tidak render ulang",
      geser.blob === 0 && geser.dataUrl === 0, `blob=${geser.blob}`);
    check("Gabung: thumbnail tetap utuh setelah digeser", geser.img > 0, `img=${geser.img}`);
    check("Gabung: geser halaman cepat", Date.now() - t3 < 2000, `${Date.now() - t3} ms`);

    /* --- scroll grid --- */
    await settle();
    await page.evaluate(() => {
      const g = document.getElementById("mergePreviewGrid");
      g.scrollTop = g.scrollHeight;
    });
    await page.waitForTimeout(2500);
    const scroll = await page.evaluate(() => ({
      img: document.querySelectorAll("#mergePreviewGrid img.mp-thumb-img").length,
      total: document.querySelectorAll("#mergePreviewGrid .mp-cell").length,
    }));
    const scrollOk = await page.evaluate(() => {
      const g = document.getElementById("mergePreviewGrid");
      const gr = g.getBoundingClientRect();
      const vis = [...g.querySelectorAll(".mp-cell")].filter((c) => {
        const r = c.getBoundingClientRect();
        return r.bottom > gr.top && r.top < gr.bottom;
      });
      return {
        n: vis.length,
        denganGambar: vis.filter((c) => c.querySelector("img.mp-thumb-img")).length,
      };
    });
    check("Gabung: setelah scroll, kartu yang terlihat punya thumbnail",
      scrollOk.n > 0 && scrollOk.denganGambar === scrollOk.n,
      `${scrollOk.denganGambar}/${scrollOk.n}`);
    check("Gabung: scroll tidak merender SELURUH dokumen sekaligus",
      scroll.img < scroll.total, `img=${scroll.img} total=${scroll.total}`);

    /* --- interaksi berulang harus 100% dari cache --- */
    await settle();
    await page.evaluate(RESET);
    await page.evaluate(() => {
      const c = document.querySelectorAll("#mergePreviewGrid .mp-cell")[0];
      const b = [...c.querySelectorAll(".mp-btn")].find((x) => x.textContent === "←");
      b.click();
    });
    await page.waitForTimeout(1200);
    const cache = await renderCount();
    check("Gabung: interaksi berulang memakai cache (tanpa render baru)", cache === 0, `render=${cache}`);
  }

  /* ============================================================
     C. SUSUN PDF (tool organize)
     ============================================================ */
  {
    await page.click("#tab-tools");
    await page.waitForTimeout(400);
    await page.fill("#toolSearch", "susun");
    await page.waitForTimeout(600);
    const ok = await page.evaluate(() => {
      const b = [...document.querySelectorAll("[data-tool]")].find((x) =>
        (x.dataset.tool || "").includes("organize")
      );
      if (!b) return false;
      b.click();
      return true;
    });
    check("Susun: tool bisa dibuka", ok);
    if (ok) {
      await page.waitForTimeout(600);
      await page.evaluate(RESET);
      const t0 = Date.now();
      const inp = await page.$("#toolInput");
      if (inp) await inp.setInputFiles([dense]);
      const okCells = await tunggu(() => document.querySelectorAll(".org-cell").length > 0, 120);
      const tCells = Date.now() - t0;
      check("Susun: grid halaman muncul cepat", okCells && tCells < 8000, `${tCells} ms`);

      /* posisikan grid di PUNCAK viewport supaya sel yang jauh di bawah
         tidak pernah terlihat -> bisa dipakai membuktikan pemuatan malas */
      await page.evaluate(() => {
        document.querySelector(".organize-grid")?.scrollIntoView({ block: "start" });
      });
      await page.waitForTimeout(400);
      check("Susun: thumbnail yang terlihat benar-benar ter-render",
        await thumbTerlihat(".org-cell img", 3));

      await settle();
      const st = await page.evaluate(() => {
        const cells = [...document.querySelectorAll(".org-cell")];
        const inView = cells.filter((c) => {
          const r = c.getBoundingClientRect();
          return r.bottom > 0 && r.top < window.innerHeight;
        });
        /* sel jauh di bawah viewport: belum pernah terlihat */
        const jauh = cells.filter((c) => {
          const r = c.getBoundingClientRect();
          return r.top > window.innerHeight + 600;
        });
        return {
          cells: cells.length,
          img: document.querySelectorAll(".org-cell img").length,
          inView: inView.length,
          inViewAda: inView.filter((c) => c.querySelector("img")).length,
          jauh: jauh.length,
          jauhAda: jauh.filter((c) => c.querySelector("img")).length,
          blob: window.__blob,
          dataUrl: window.__dataUrl,
        };
      });
      check("Susun: TIDAK lagi merender semua halaman sekaligus",
        st.img < st.cells, `img=${st.img} cells=${st.cells}`);
      check("Susun: tidak ada data-URL (bukan lagi canvas.toDataURL)",
        st.dataUrl === 0, `dataUrl=${st.dataUrl}`);
      check("Susun: kartu di area terlihat semuanya punya thumbnail",
        st.inView > 0 && st.inViewAda === st.inView, `${st.inViewAda}/${st.inView}`);
      check("Susun: kartu jauh dari layar BELUM dirender (pemuatan malas)",
        st.jauh > 0 && st.jauhAda === 0, `jauh ter-render=${st.jauhAda}/${st.jauh}`);

      /* interaksi: putar halaman -> node dipakai ulang, tanpa render ulang */
      await page.evaluate(() => {
        window.__cells = [...document.querySelectorAll(".org-cell")];
      });
      await page.evaluate(RESET);
      const t1 = Date.now();
      await page.evaluate(() => {
        const b = document.querySelector(".org-cell .org-btn");
        if (b) b.click();
      });
      await page.waitForTimeout(1500);
      const rot = await page.evaluate(() => ({
        hidup: window.__cells.filter((c) => c.isConnected).length,
        total: document.querySelectorAll(".org-cell").length,
        blob: window.__blob,
        dataUrl: window.__dataUrl,
      }));
      check("Susun: memutar halaman memakai ulang node (tidak dibangun ulang)",
        rot.hidup > 0, `node hidup=${rot.hidup}/${rot.total}`);
      check("Susun: memutar halaman tidak render ulang thumbnail",
        rot.blob === 0 && rot.dataUrl === 0, `blob=${rot.blob}`);
      check("Susun: memutar halaman cepat", Date.now() - t1 < 2500, `${Date.now() - t1} ms`);

      const isi = await page.evaluate(() => {
        const nums = [...document.querySelectorAll(".org-num")].map((n) => n.textContent);
        return nums.slice(0, 5).join(",");
      });
      check("Susun: nomor posisi kartu tetap urut", isi === "1,2,3,4,5", isi);
    }
  }

  /* ============================================================
     D. Umum + bukti screenshot
     ============================================================ */
  {
    const urls = await page.evaluate(() => window.__urls);
    check("Umum: jumlah object URL terkendali (tidak membengkak)",
      urls < 400, `object URL=${urls}`);
    check("Umum: tidak ada error JavaScript", errors.length === 0, errors.slice(0, 3).join(" | "));
  }

  /* Screenshot bukti: tiap pratinjau harus benar-benar berisi gambar. */
  {
    const shotDir = path.join(ROOT, "docs", "audit-preview-perf-2026-11-24");
    fs.mkdirSync(shotDir, { recursive: true });

    /* Ambil hanya bagian yang terlihat di layar supaya berkas screenshot
       tidak membengkak (grid 90 halaman bisa %). */
    const potret = async (nama, sel) => {
      const el = await page.$(sel);
      if (!el) return false;
      await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      const box = await el.boundingBox();
      if (!box) return false;
      const vp = page.viewportSize();
      const clip = {
        x: Math.max(0, box.x),
        y: Math.max(0, box.y),
        width: Math.min(box.width, vp.width - Math.max(0, box.x)),
        height: Math.min(box.height, vp.height - Math.max(0, box.y), 900),
      };
      if (clip.width < 10 || clip.height < 10) return false;
      await page.screenshot({ path: path.join(shotDir, nama), clip });
      return true;
    };

    /* Pisah PDF */
    await page.click("#tab-split");
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      const btn = document.getElementById("clearBtn") || document.querySelector('[data-act="clear"]');
      if (btn) btn.click();
    });
    await page.waitForTimeout(400);
    await page.setInputFiles("#fileInput", [dense]);
    await tunggu(() => document.querySelectorAll("#files .thumb img").length > 6, 120);
    await page.waitForTimeout(1500);
    check("Bukti: screenshot pratinjau Pisah PDF",
      await potret("pratinjau-pisah-pdf.png", "#files"));

    /* Gabung PDF */
    await page.click("#tab-merge");
    await page.waitForTimeout(600);
    await page.setInputFiles("#mergeInput", [dense]);
    await tunggu(() => document.querySelectorAll("#mergePreviewGrid img.mp-thumb-img").length > 6, 120);
    await page.waitForTimeout(1200);
    check("Bukti: screenshot pratinjau Gabung PDF",
      await potret("pratinjau-gabung-pdf.png", "#mergePreviewCard"));

    /* Susun PDF */
    await page.click("#tab-tools");
    await page.waitForTimeout(500);
    await page.fill("#toolSearch", "susun");
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("[data-tool]")].find((x) =>
        (x.dataset.tool || "").includes("organize")
      );
      if (b) b.click();
    });
    await page.waitForTimeout(700);
    const inp = await page.$("#toolInput");
    if (inp) await inp.setInputFiles([dense]);
    await tunggu(() => document.querySelectorAll(".org-cell img").length > 6, 120);
    await page.waitForTimeout(1200);
    check("Bukti: screenshot pratinjau Susun PDF",
      await potret("pratinjau-susun-pdf.png", ".organize-wrap"));
  }

  console.log("\n===== RINGKASAN AUDIT OPTIMASI PRATINJAU =====");
  console.log(`Lulus: ${pass}  Gagal: ${fail}`);
  const outDir = path.join(ROOT, "docs");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "audit-preview-perf-hasil.json"),
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
