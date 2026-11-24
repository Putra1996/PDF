/**
 * Audit mendalam fitur "Pratinjau urutan halaman" di menu Gabung PDF.
 *
 * Menguji aplikasi sungguhan di Chromium:
 *  - panel pratinjau muncul dan menampilkan satu kartu per halaman
 *  - thumbnail tiap halaman benar-benar dirender
 *  - mode "Sesuai file" / "Dibalik" / "Kustom" mengubah urutan halaman
 *  - urutan di pratinjau BENAR-BENAR dipakai saat menggabungkan
 *  - panah & seret untuk menggeser halaman
 *  - multi-berkas, kasus tepi (tanpa berkas / satu berkas), dan performa
 *
 * Jalankan: node tools/mkfixtures-merge.mjs && node tools/audit-merge-preview.mjs
 *
 * Env:
 *   SERVE_DIR    - direktori statis yang dilayani (default: repo ini)
 *   FIXTURES_DIR - folder fixture (default: fixtures/merge)
 *   PORT         - porta server lokal
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "./browser.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.SERVE_DIR || path.join(HERE, ".."));
const FIX = path.resolve(process.env.FIXTURES_DIR || path.join(ROOT, "fixtures", "merge"));
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

/* Teks tiap halaman hasil PDF (dipakai untuk memeriksa urutan). */
const TEKS_HALAMAN = async ({ b64 }) => {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const doc = await pdfjsLib.getDocument({ data: u8 }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const tc = await p.getTextContent();
    const s = tc.items
      .filter((it) => it.str && it.str.trim())
      .map((it) => it.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    /* ambil token "ALFA 1" / "BETA 3" / "GAMMA 1" */
    const m = s.match(/\b(ALFA|BETA|GAMMA)\s+(\d+)\b/i);
    out.push(m ? `${m[1].toUpperCase()} ${m[2]}` : s.slice(0, 24));
  }
  await doc.destroy();
  return { numPages: doc.numPages, halaman: out };
};

async function main() {
  if (!fs.existsSync(FIX)) {
    console.error(`Fixture tidak ada: ${FIX}\nJalankan: node tools/mkfixtures-merge.mjs`);
    process.exit(2);
  }
  const srv = await server();
  const browser = await chromium();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
  await page.waitForTimeout(1500);

  const alpha = path.join(FIX, "alpha.pdf");
  const beta = path.join(FIX, "beta.pdf");
  const gamma = path.join(FIX, "gamma.pdf");

  /* ---------- helper ---------- */
  const bukaTab = async (tab) => {
    await page.click(`#tab-${tab}`);
    await page.waitForTimeout(500);
  };

  const muat = async (files) => {
    /* daftar dibersihkan dulu supaya jumlah berkas pasti */
    await page.evaluate(() => {
      const btn = document.getElementById("mergeClearBtn");
      if (!btn) return;
      const orig = window.confirm;
      window.confirm = () => true;
      btn.click();
      window.confirm = orig;
    });
    await page.waitForTimeout(500);
    await page.setInputFiles("#mergeInput", files);
    await page.waitForTimeout(1500);
  };

  /* Tunggu sampai thumbnail halaman benar-benar ter-render. */
  const tungguThumb = async (minimal = 3, maks = 30) => {
    for (let i = 0; i < maks; i++) {
      const n = await page.evaluate(
        () => document.querySelectorAll("#mergePreviewGrid img.mp-thumb-img").length
      );
      if (n >= minimal) return n;
      await page.waitForTimeout(400);
    }
    return await page.evaluate(
      () => document.querySelectorAll("#mergePreviewGrid img.mp-thumb-img").length
    );
  };

  const kosongkan = async () => {
    await page.evaluate(() => {
      /* kosongkan tanpa confirm() */
      const btn = document.getElementById("mergeClearBtn");
      if (!btn) return;
      const orig = window.confirm;
      window.confirm = () => true;
      btn.click();
      window.confirm = orig;
    });
    await page.waitForTimeout(600);
  };

  const statusPreview = () =>
    page.evaluate(() => {
      const card = document.getElementById("mergePreviewCard");
      const grid = document.getElementById("mergePreviewGrid");
      const info = document.getElementById("mergePreviewInfo");
      const cells = grid ? [...grid.querySelectorAll(".mp-cell")] : [];
      const terlihat = (el) =>
        !!el && !el.hidden && el.offsetParent !== null &&
        el.getBoundingClientRect().height > 0;
      return {
        cardHidden: card ? card.hidden : null,
        cardTerlihat: terlihat(card),
        jumlahKartu: cells.length,
        info: info ? info.textContent : "",
        posisi: cells.map((c) => c.querySelector(".mp-pos")?.textContent || ""),
        asal: cells.map((c) => c.querySelector(".mp-src")?.textContent || ""),
        chipOn: [...document.querySelectorAll(".mchip[data-order]")]
          .filter((c) => c.classList.contains("is-on"))
          .map((c) => c.dataset.order),
        thumbImg: cells.filter((c) => c.querySelector("img.mp-thumb-img")).length,
        draggable: cells.every((c) => c.draggable),
        adaTombolPanah: cells.every((c) => c.querySelectorAll(".mp-btn").length === 2),
      };
    });

  const mode = (m) =>
    page.evaluate((mm) => {
      const c = document.querySelector(`.mchip[data-order="${mm}"]`);
      if (!c) return false;
      c.click();
      return true;
    }, m);

  /* Ambil berkas hasil gabung dan baca urutan teks halamannya. */
  const gabungDanBaca = async (tunggu = 60) => {
    await page.evaluate(() => {
      document.querySelectorAll("#toasts .toast").forEach((e) => e.remove());
    });
    await page.click("#mergeRunBtn");
    let href = null;
    for (let i = 0; i < tunggu; i++) {
      await page.waitForTimeout(500);
      href = await page.evaluate(() => {
        const a = document.querySelector("#mergeResults a");
        return a ? a.href : null;
      });
      if (href) break;
    }
    if (!href) {
      const t = await page.evaluate(() => {
        const semua = [...document.querySelectorAll("#toasts .toast")];
        const el = semua[semua.length - 1];
        return el ? el.textContent : "";
      });
      return { ok: false, galat: t, halaman: [] };
    }
    const arr = await page.evaluate(async (u) => {
      const r = await fetch(u);
      return Array.from(new Uint8Array(await r.arrayBuffer()));
    }, href);
    const info = await page.evaluate(TEKS_HALAMAN, { b64: Buffer.from(arr).toString("base64") });
    return { ok: true, halaman: info.halaman, numPages: info.numPages };
  };

  /* ============ 1. Panel pratinjau muncul ============ */
  {
    await bukaTab("merge");
    const kosong = await statusPreview();
    check("Tanpa berkas: panel pratinjau disembunyikan", kosong.cardHidden === true,
      `hidden=${kosong.cardHidden}`);

    await muat([alpha, beta]);
    const st = await statusPreview();
    check("Panel pratinjau muncul setelah berkas dimuat", st.cardTerlihat === true,
      `terlihat=${st.cardTerlihat}`);
    check("Pratinjau menampilkan satu kartu per halaman (3+4=7)", st.jumlahKartu === 7,
      `kartu=${st.jumlahKartu}`);
    check("Kartu diberi nomor urut 1..7", st.posisi.join(",") === "1,2,3,4,5,6,7", st.posisi.join(","));
    check("Kartu menyebut asal berkas & nomor halaman",
      /alpha\.pdf/i.test(st.asal[0]) && /hal\. 1/.test(st.asal[0]) &&
      /beta\.pdf/i.test(st.asal[3]), st.asal.slice(0, 4).join(" | "));
    const nThumb = await tungguThumb(3);
    check("Thumbnail halaman benar-benar dirender", nThumb >= 3, `gambar=${nThumb}`);
    const thumbOk = await page.evaluate(() => {
      const img = document.querySelector("#mergePreviewGrid img.mp-thumb-img");
      if (!img) return { ok: false, alasan: "tidak ada img" };
      const r = img.getBoundingClientRect();
      return {
        ok: img.naturalWidth > 20 && img.naturalHeight > 20 && r.width > 20 && r.height > 20,
        natural: `${img.naturalWidth}x${img.naturalHeight}`,
        rect: `${Math.round(r.width)}x${Math.round(r.height)}`,
      };
    });
    check("Ukuran thumbnail thumbnail nyata (bukan kotak kosong)", thumbOk.ok === true,
      thumbOk.alasan || `${thumbOk.natural} tampil ${thumbOk.rect}`);
    check("Kartu bisa diseret (draggable)", st.draggable === true);
    check("Tiap kartu punya tombol panah ← →", st.adaTombolPanah === true);
    check("Ringkasan pratinjau menyebut jumlah halaman", /7 halaman/.test(st.info), st.info);
  }

  /* ============ 2. Mode "Sesuai file" ============ */
  {
    await mode("asis");
    const st = await statusPreview();
    check("Mode 'Sesuai file' aktif", st.chipOn.join(",") === "asis", st.chipOn.join(","));
    const g = await gabungDanBaca();
    check("Gabung mode 'Sesuai file' berhasil", g.ok, g.galat || "");
    if (g.ok) {
      const urut = g.halaman.join(",");
      check("Urutan 'Sesuai file' = ALFA 1-3 lalu BETA 1-4",
        urut === "ALFA 1,ALFA 2,ALFA 3,BETA 1,BETA 2,BETA 3,BETA 4", urut);
    }
  }

  /* ============ 3. Mode "Dibalik" ============ */
  {
    await mode("balik");
    const st = await statusPreview();
    check("Mode 'Dibalik' aktif", st.chipOn.join(",") === "balik", st.chipOn.join(","));
    const g = await gabungDanBaca();
    check("Gabung mode 'Dibalik' berhasil", g.ok, g.galat || "");
    if (g.ok) {
      const urut = g.halaman.join(",");
      check("Urutan 'Dibalik' = kebalikan seluruh halaman",
        urut === "BETA 4,BETA 3,BETA 2,BETA 1,ALFA 3,ALFA 2,ALFA 1", urut);
    }
    const st2 = await statusPreview();
    check("Pratinjau 'Dibalik' menampilkan urutan terbalik",
      /hal\. 4/.test(st2.asal[0]) && /hal\. 1/.test(st2.asal[6]), st2.asal.slice(0, 2).join(" | "));
  }

  /* ============ 4. Mode "Kustom" (tombol panah) ============ */
  {
    await mode("asis");
    /* geser halaman pertama (ALFA 1) satu posisi ke kanan */
    await page.evaluate(() => {
      const c = document.querySelectorAll("#mergePreviewGrid .mp-cell")[0];
      const btn = [...c.querySelectorAll(".mp-btn")].find((b) => b.textContent === "→");
      btn.click();
    });
    await page.waitForTimeout(400);
    const st = await statusPreview();
    check("Menekan panah → membuat mode 'Kustom'", st.chipOn.join(",") === "kustom", st.chipOn.join(","));
    check("Pratinjau 'Kustom' menukar dua halaman pertama",
      /hal\. 2/.test(st.asal[0]) && /hal\. 1/.test(st.asal[1]), st.asal.slice(0, 2).join(" | "));
    const g = await gabungDanBaca();
    check("Gabung mode 'Kustom' berhasil", g.ok, g.galat || "");
    if (g.ok) {
      const urut = g.halaman.join(",");
      check("Urutan 'Kustom' dipakai di berkas hasil",
        urut === "ALFA 2,ALFA 1,ALFA 3,BETA 1,BETA 2,BETA 3,BETA 4", urut);
    }
  }

  /* ============ 5. Geser halaman jauh (seret) ============ */
  {
    await mode("asis");
    /* geser halaman pertama (ALFA 1) ke posisi terakhir (index 6) */
    const ok = await page.evaluate(() => {
      const cells = [...document.querySelectorAll("#mergePreviewGrid .mp-cell")];
      const from = cells[0];
      const to = cells[6];
      if (!from || !to) return false;
      const dt = new DataTransfer();
      from.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
      to.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: dt }));
      to.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt }));
      from.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
      return true;
    });
    await page.waitForTimeout(400);
    const st = await statusPreview();
    check("Seret halaman ke posisi lain berjalan", ok, "");
    check("Seret membuat mode 'Kustom'", st.chipOn.join(",") === "kustom", st.chipOn.join(","));
    check("Seret memindahkan halaman pertama ke akhir",
      /hal\. 1/.test(st.asal[6]) && /hal\. 2/.test(st.asal[0]), st.asal.join(" | "));
    const g = await gabungDanBaca();
    if (g.ok) {
      const urut = g.halaman.join(",");
      check("Urutan hasil seret dipakai di berkas hasil",
        urut === "ALFA 2,ALFA 3,BETA 1,BETA 2,BETA 3,BETA 4,ALFA 1", urut);
    }
  }

  /* ============ 6. Kembali ke "Sesuai file" ============ */
  {
    await mode("asis");
    const st = await statusPreview();
    check("Kembali ke 'Sesuai file' mengembalikan urutan asal",
      /alpha\.pdf · hal\. 1/.test(st.asal[0]) && /beta\.pdf · hal\. 4/.test(st.asal[6]),
      st.asal.join(" | "));
  }

  /* ============ 7. Multi-berkas tiga berkas ============ */
  {
    await muat([alpha, beta, gamma]);
    const st = await statusPreview();
    check("Tiga berkas: pratinjau menampilkan 8 halaman", st.jumlahKartu === 8,
      `kartu=${st.jumlahKartu}`);
    await mode("balik");
    const g = await gabungDanBaca();
    check("Gabung tiga berkas mode 'Dibalik' berhasil", g.ok, g.galat || "");
    if (g.ok) {
      const urut = g.halaman.join(",");
      check("Urutan 'Dibalik' tiga berkas benar",
        urut === "GAMMA 1,BETA 4,BETA 3,BETA 2,BETA 1,ALFA 3,ALFA 2,ALFA 1", urut);
    }
  }

  /* ============ 8. Kasus tepi: satu berkas ============ */
  {
    await kosongkan();
    await muat([gamma]);
    const st = await statusPreview();
    check("Satu berkas: pratinjau tetap tampil (1 halaman)", st.cardTerlihat && st.jumlahKartu === 1,
      `terlihat=${st.cardTerlihat} kartu=${st.jumlahKartu}`);
    const disabled = await page.evaluate(() => document.getElementById("mergeRunBtn").disabled);
    check("Satu berkas: tombol gabung tetap nonaktif", disabled === true, `disabled=${disabled}`);
  }

  /* ============ 9. Kasus tepi: hapus satu berkas ============ */
  {
    await kosongkan();
    await muat([alpha, beta]);
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll("#mlist .mrow")];
      const btn = rows[0].querySelector('[data-act="remove"]');
      btn.click();
    });
    await page.waitForTimeout(800);
    const st = await statusPreview();
    check("Setelah satu berkas dihapus, pratinjau hanya berisi berkas yang tersisa",
      st.jumlahKartu === 4 && /beta\.pdf/i.test(st.asal[0]), `kartu=${st.jumlahKartu} ${st.asal[0]}`);
    /* tambahkan berkas lagi supaya tombol gabung aktif */
    await page.setInputFiles("#mergeInput", [gamma]);
    await page.waitForTimeout(1200);
    const st2 = await statusPreview();
    check("Berkas baru ditambahkan -> pratinjau ikut bertambah (5 halaman)",
      st2.jumlahKartu === 5, `kartu=${st2.jumlahKartu}`);
    const g = await gabungDanBaca();
    if (g.ok) {
      check("Gabung setelah hapus berkas memakai halaman yang tersisa",
        g.halaman.join(",") === "BETA 1,BETA 2,BETA 3,BETA 4,GAMMA 1", g.halaman.join(","));
    }
  }

  /* ============ 10. Performa ============ */
  {
    await kosongkan();
    await muat([alpha, beta, gamma]);
    const t0 = Date.now();
    await mode("balik");
    await page.waitForTimeout(300);
    const dt = Date.now() - t0;
    check("Performa: ganti mode < 3 detik", dt < 3000, `${dt} ms`);
    const st = await statusPreview();
    check("Performa: semua kartu tetap tampil setelah mode dibalik", st.jumlahKartu === 8,
      `kartu=${st.jumlahKartu}`);
  }

  /* ============ 11. Screenshot bukti ============ */
  {
    const shotDir = path.join(ROOT, "docs", "audit-merge-preview-2026-11-24");
    fs.mkdirSync(shotDir, { recursive: true });
    const potret = async (nama) => {
      const el = await page.$("#mergePreviewCard");
      if (!el) return false;
      await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await el.screenshot({ path: path.join(shotDir, nama) });
      return true;
    };
    await mode("asis");
    check("Screenshot pratinjau mode 'Sesuai file'", await potret("pratinjau-asis.png"));
    await mode("balik");
    check("Screenshot pratinjau mode 'Dibalik'", await potret("pratinjau-balik.png"));
    /* susun kustom sungguhan: geser halaman pertama ke posisi terakhir */
    await mode("asis");
    await page.evaluate(() => {
      const cells = [...document.querySelectorAll("#mergePreviewGrid .mp-cell")];
      const dt = new DataTransfer();
      cells[0].dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
      cells[7].dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: dt }));
      cells[7].dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt }));
      cells[0].dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
    });
    await page.waitForTimeout(600);
    const stK = await statusPreview();
    check("Mode 'Kustom' menampilkan susunan manual yang berbeda dari 'Dibalik'",
      stK.chipOn.join(",") === "kustom" &&
      /gamma\.pdf/.test(stK.asal[0]) === false &&
      /alpha\.pdf · hal\. 1/.test(stK.asal[7]), stK.asal.join(" | "));
    check("Screenshot pratinjau mode 'Kustom'", await potret("pratinjau-kustom.png"));
  }

  /* ============ 12. Tampilan mobile 360px ============ */
  {
    await page.setViewportSize({ width: 360, height: 760 });
    await page.waitForTimeout(600);
    const mob = await page.evaluate(() => {
      const card = document.getElementById("mergePreviewCard");
      const grid = document.getElementById("mergePreviewGrid");
      const chips = [...document.querySelectorAll(".mchip[data-order]")];
      const r = card.getBoundingClientRect();
      const gridR = grid.getBoundingClientRect();
      const chipRects = chips.map((c) => c.getBoundingClientRect());
      return {
        cardWidth: r.width,
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        gridWidth: gridR.width,
        gridRight: gridR.right,
        winW: window.innerWidth,
        chipRows: new Set(chipRects.map((c) => Math.round(c.top))).size,
        chipOverflow: chipRects.some((c) => c.right > window.innerWidth + 1),
        kolom: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
      };
    });
    check("Mobile 360px: pratinjau tidak meluber horizontal", mob.overflow === false && mob.chipOverflow === false,
      `scrollWidth=${mob.overflow} chipOverflow=${mob.chipOverflow}`);
    check("Mobile 360px: chip mode tetap satu baris", mob.chipRows === 1, `baris=${mob.chipRows}`);
    check("Mobile 360px: grid pratinjau minimal 2 kolom", mob.kolom >= 2, `kolom=${mob.kolom}`);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForTimeout(400);
  }

  /* ============ 13. Tidak ada error JS ============ */
  check("Tidak ada error JavaScript", errors.length === 0, errors.slice(0, 3).join(" | "));

  console.log("\n===== RINGKASAN AUDIT PRATINJAU URUTAN HALAMAN (GABUNG PDF) =====");
  console.log(`Lulus: ${pass}  Gagal: ${fail}`);
  const outDir = path.join(ROOT, "docs");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "audit-merge-preview-hasil.json"),
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
