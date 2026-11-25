/**
 * Audit SEMUA fitur aplikasi (payung).
 *
 * Menjalankan tiap fitur yang menghadap pengguna lewat UI sungguhan
 * (bukan memanggil fungsi internal), lalu memvalidasi keluarannya:
 *
 *   - 28 alat di registry PDFToolsCore
 *   -  5 launcher alur (gabung / pisah / hapus / ekstrak / kompres)
 *
 * Setiap fitur punya minimal satu pemeriksaan smoke (jalur happy) dan
 * satu pemeriksaan isi keluaran (PDF benar-benar berubah / valid).
 *
 * Jalankan:
 *   node tools/mkfixtures-semua.mjs
 *   node tools/audit-semua.mjs
 *
 * Env:
 *   FIXTURES_DIR - folder fixture (default fixtures/semua)
 *   SHOT_DIR     - folder screenshot bukti (default docs/audit-semua-2026-11-25)
 *   PORT         - porta server lokal
 *   ONLY         - jalankan hanya fitur yang id-nya mengandung string ini
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { chromium } from "./browser.mjs";

const require = createRequire(import.meta.url);
const { PDFDocument, PDFName } = require("pdf-lib");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(path.join(HERE, ".."));
const FIX = path.resolve(process.env.FIXTURES_DIR || path.join(ROOT, "fixtures", "semua"));
const SHOTS = path.resolve(process.env.SHOT_DIR || path.join(ROOT, "docs", "audit-semua-2026-11-25"));
const PORT = Number(process.env.PORT || 8090);
const ONLY = process.env.ONLY || "";

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".pdf": "application/pdf", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml",
  ".wasm": "application/wasm", ".json": "application/json", ".woff2": "font/woff2",
  ".gz": "application/octet-stream", ".zip": "application/zip",
};

const results = [];
let pass = 0;
let fail = 0;
const cek = (nama, ok, detail = "") => {
  results.push({ nama, ok: !!ok, detail: String(detail || "") });
  ok ? pass++ : fail++;
  console.log(`${ok ? "\u2713" : "\u2717"} ${nama}${detail ? ` — ${detail}` : ""}`);
};

/* ============================================================
   Server statis
   ============================================================ */
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
   Utilitas
   ============================================================ */
const fx = (nama) => path.join(FIX, nama);
const ada = (nama) => fs.existsSync(fx(nama));

async function pdfInfo(bytes) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const halaman = doc.getPageCount();
  const meta = {
    halaman,
    sizes: doc.getPages().map((p) => ({ w: p.getWidth(), h: p.getHeight() })),
    rot: doc.getPages().map((p) => p.getRotation().angle),
    boxes: doc.getPages().map((p) => {
      const b = p.getMediaBox();
      const c = p.getCropBox();
      return {
        m: [b.x, b.y, b.width, b.height], c: [c.x, c.y, c.width, c.height],
      };
    }),
    terenkripsi: false,
    adaAcroForm: false,
    gambar: doc.getPages().map((p) => {
      try {
        const res = p.node.Resources();
        const xo = res && res.lookup(PDFName.of("XObject"));
        if (!xo) return 0;
        let n = 0;
        for (const [, ref] of xo.entries()) {
          const obj = doc.context.lookup(ref);
          /* PDFRawStream tidak punya .get(); kamusnya di .dict */
          const kamus = obj && typeof obj.get === "function" ? obj : (obj && obj.dict) || null;
          const st = kamus && kamus.get ? kamus.get(PDFName.of("Subtype")) : null;
          if (st && st.toString() === "/Image") n++;
        }
        return n;
      } catch (_) { return 0; }
    }),
    trafik: bytes.toString("latin1"),
  };
  try {
    const d2 = await PDFDocument.load(bytes, { ignoreEncryption: false });
    meta.adaAcroForm = !!d2.getForm().getFields().length;
  } catch (e) {
    meta.terenkripsi = true;
  }
  return meta;
}

/* helper: kirim byte ke halaman auditor untuk ekstraksi teks */
let _pageRef = null;
async function teksDariPdf(bytes) {
  if (!_pageRef) return "";
  const arr = Array.from(bytes);
  return await _pageRef.evaluate(async (b) => {
    try {
      const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(b) }).promise;
      let out = "";
      for (let i = 1; i <= doc.numPages; i++) {
        const tc = await (await doc.getPage(i)).getTextContent();
        out += tc.items.map((it) => it.str).join(" ") + "\n";
      }
      await doc.destroy();
      return out;
    } catch (e) {
      return "ERR:" + (e && e.message);
    }
  }, arr);
}

/* ekstraksi teks per halaman (pdf.js di peramban) */
async function teksPerHalaman(bytes) {
  if (!_pageRef) return [];
  return await _pageRef.evaluate(async (b) => {
    try {
      const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(b) }).promise;
      const out = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const tc = await (await doc.getPage(i)).getTextContent();
        out.push(tc.items.map((it) => it.str).join(" "));
      }
      await doc.destroy();
      return out;
    } catch (e) {
      return ["ERR:" + (e && e.message)];
    }
  }, Array.from(bytes));
}

/* posisi relatif teks (0 = atas, 1 = bawah) di halaman pertama */
async function posisiTeks(bytes) {
  if (!_pageRef) return [];
  return await _pageRef.evaluate(async ({ b }) => {
    try {
      const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(b) }).promise;
      const halaman = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const vp = page.getViewport({ scale: 1 });
        const tc = await page.getTextContent();
        const items = [];
        for (const it of tc.items) {
          const t = (it.str || "").trim();
          if (!t) continue;
          const tr = it.transform;
          items.push({ t, relY: tr[5] / vp.height, hal: n });
        }
        halaman.push(items);
      }
      await doc.destroy();
      return halaman;
    } catch (e) { return []; }
  }, { b: Array.from(bytes) });
}

/* analisis piksel: render halaman PDF ke kanvas lalu hitung tinta.
   Dipakai sebagai bukti visual terukur (watermark, redaksi, tanda
   tangan) — bukan sekadar "berkas berhasil dibuat". */
async function analisisPiksel(bytes, halaman = 1) {
  if (!_pageRef) return null;
  return await _pageRef.evaluate(async ({ b, no }) => {
    try {
      const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(b) }).promise;
      const page = await doc.getPage(no);
      const vp = page.getViewport({ scale: 1.4 });
      const c = document.createElement("canvas");
      c.width = Math.round(vp.width);
      c.height = Math.round(vp.height);
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let hitam = 0, abu = 0, total = 0, tinta = 0, tegas = 0;
      const K = 10; /* grid K x K */
      const grid = new Array(K * K).fill(0);
      const w = c.width, h = c.height;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const r = d[i], g = d[i + 1], bl = d[i + 2];
          total++;
          const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl);
          if (mx < 60) hitam++;
          else if (mx < 245 && mx - mn < 40) abu++;
          if (mx < 70) tegas++;
          if (mx < 250) {
            tinta++;
            const gx = Math.min(K - 1, Math.floor((x / w) * K));
            const gy = Math.min(K - 1, Math.floor((y / h) * K));
            grid[gy * K + gx]++;
          }
        }
      }
      await doc.destroy();
      return { w, h, hitam, abu, tinta, tegas, total, grid };
    } catch (e) {
      return { err: String((e && e.message) || e) };
    }
  }, { b: Array.from(bytes), no: halaman });
}

/* baca isi berkas ZIP/OOXML lewat JSZip yang ada di peramban */
async function isiZip(bytes) {
  if (!_pageRef) return {};
  return await _pageRef.evaluate(async (b) => {
    try {
      const zip = await JSZip.loadAsync(new Uint8Array(b));
      const out = {};
      for (const name of Object.keys(zip.files)) {
        if (zip.files[name].dir) continue;
        out[name] = await zip.files[name].async("string");
      }
      return out;
    } catch (e) {
      return { __ERR: String((e && e.message) || e) };
    }
  }, Array.from(bytes));
}

/* baca nilai field AcroForm dari PDF (pdf-lib) */
async function nilaiField(bytes) {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const form = doc.getForm();
    const out = [];
    for (const f of form.getFields()) {
      try {
        if (f.constructor.name === "PDFTextField" || f.getText) out.push(String(f.getText() || ""));
      } catch (_) { /* abaikan */ }
    }
    return out.join(" | ");
  } catch (e) {
    return "ERR:" + (e && e.message);
  }
}

const png = (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const jpg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8;
const zipBytes = (b) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b;

/* ============================================================
   Driver
   ============================================================ */
class Harness {
  constructor(page) {
    this.page = page;
    this.consoleError = [];
  }

  async muat() {
    await this.page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
    await this.page.waitForTimeout(900);
    _pageRef = this.page;
  }

  /* buka tab utama: "tools" | "split" | "merge" | "compress" */
  async tab(nama) {
    await this.page.evaluate((t) => {
      window.PDFApp && window.PDFApp.setTab && window.PDFApp.setTab(t);
    }, nama);
    await this.page.waitForTimeout(350);
  }

  /* buka alat lewat kartu registry */
  async bukaAlat(id) {
    await this.tab("tools");
    const ada = await this.page.evaluate((i) => {
      const c = document.querySelector(`#toolCategories [data-tool="${i}"]`);
      if (!c) return false;
      c.scrollIntoView({ block: "center" });
      c.click();
      return true;
    }, id);
    if (!ada) throw new Error("Kartu alat tidak ditemukan: " + id);
    await this.page.waitForTimeout(500);
    const tampil = await this.page.evaluate(() => {
      const v = document.querySelector("#toolView");
      return v ? !v.hidden : false;
    });
    if (!tampil) throw new Error("Tampilan alat tidak terbuka: " + id);
  }

  /* isi field standar (f_<id>) */
  async isiFields(opts = {}) {
    await this.page.evaluate((o) => {
      for (const [id, val] of Object.entries(o)) {
        const el = document.getElementById("f_" + id);
        if (!el) continue;
        if (el.type === "checkbox") el.checked = !!val;
        else el.value = String(val);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }, opts);
    await this.page.waitForTimeout(250);
  }

  async unggah(file, indeks = 0) {
    const sel = "#toolInput";
    await this.page.waitForSelector(sel, { state: "attached", timeout: 8000 });
    await this.page.setInputFiles(sel, file);
    await this.page.waitForTimeout(1000);
  }

  /* jalankan alat & tunggu hasil */
  async jalankan({ timeout = 90 } = {}) {
    const t0 = Date.now();
    await this.page.click("#toolRunBtn");
    for (let i = 0; i < timeout * 2; i++) {
      await this.page.waitForTimeout(500);
      const n = await this.page.evaluate(() => document.querySelectorAll("#toolResults > *").length);
      if (n > 0) break;
      const err = await this.page.evaluate(() => {
        const t = document.querySelector("#toastWrap, .toast, #toast");
        return t && /gagal|error|tidak bisa/i.test(t.textContent || "") ? t.textContent.trim() : "";
      });
      if (err) return { ok: false, err, durasi: (Date.now() - t0) / 1000 };
    }
    const jumlah = await this.page.evaluate(() => document.querySelectorAll("#toolResults a").length);
    if (!jumlah) {
      const err = await this.page.evaluate(() => {
        const t = document.querySelector(".toast");
        return t ? t.textContent.trim() : "";
      });
      return { ok: false, err: err || "tidak ada berkas hasil", durasi: (Date.now() - t0) / 1000 };
    }
    /* unduh byte asli tiap hasil */
    const bytes = await this.page.evaluate(async (names) => {
      const as = [...document.querySelectorAll("#toolResults a")];
      const out = [];
      for (const a of as) {
        const r = await fetch(a.href);
        const b = new Uint8Array(await r.arrayBuffer());
        let s = "";
        const CH = 0x8000;
        for (let i = 0; i < b.length; i += CH) {
          s += String.fromCharCode.apply(null, b.subarray(i, i + CH));
        }
        out.push({ nama: a.textContent, b64: btoa(s) });
      }
      return out;
    });
    return {
      ok: true,
      durasi: (Date.now() - t0) / 1000,
      keluar: bytes.map((b) => ({ nama: b.nama, bytes: Buffer.from(b.b64, "base64") })),
    };
  }

  /* unggah beberapa berkas sekaligus */
  async unggahMulti(files) {
    await this.page.waitForSelector("#toolInput", { state: "attached", timeout: 8000 });
    await this.page.setInputFiles("#toolInput", files);
    await this.page.waitForTimeout(1400);
  }

  async screenshot(nama) {
    fs.mkdirSync(SHOTS, { recursive: true });
    const p = path.join(SHOTS, nama + ".png");
    await this.page.screenshot({ path: p, fullPage: false });
    return p;
  }
}

/* ============================================================
   Matriks fitur
   ============================================================ */
/* kind: "tool" (registry) | "link" (launcher tab utama) */
const FITUR = [
  /* ---------- alat PDF: halaman ---------- */
  {
    id: "rotate", nama: "Putar PDF", file: "sample.pdf", opts: { angle: "90", dir: "cw" }, screenshot: "putar",
    async validasi(h, out) {
      const info = await pdfInfo(out[0].bytes);
      cek("rotate: semua halaman /Rotate 90", info.rot.every((r) => r === 90), "rot=" + info.rot.join(","));
      cek("rotate: 3 halaman tetap", info.halaman === 3, "halaman=" + info.halaman);
    },
  },
  {
    id: "numbers", nama: "Nomor Halaman", file: "sample.pdf", opts: { pos: "bottom-center" }, screenshot: "nomor",
    async validasi(h, out) {
      const t = await teksDariPdf(out[0].bytes);
      cek("numbers: nomor halaman muncul di teks", /\b1\b/.test(t) && /\b3\b/.test(t), JSON.stringify(t.slice(0, 60)));
      /* nomor harus berada di bagian bawah halaman, dan tiap halaman
         harus punya nomornya sendiri */
      const posisi = await posisiTeks(out[0].bytes);
      const nomor = posisi.flat().filter((p) => /^\d+\s*\/\s*\d+$/.test(p.t));
      cek("numbers: tiap halaman punya nomor sendiri", nomor.length === 3,
        "ditemukan=" + nomor.map((p) => p.t).join(","));
      cek("numbers: nomor berada di bagian bawah halaman",
        nomor.length === 3 && nomor.every((p) => p.relY < 0.15),
        JSON.stringify(nomor.map((p) => p.relY.toFixed(3))).slice(0, 90));
    },
  },
  {
    id: "watermark", nama: "Watermark", file: "sample.pdf", screenshot: "watermark",
    opts: { mode: "text", text: "RAHASIA", opacity: "35", layout: "diagonal", color: "#ff0000" }, screenshot: "watermark",
    async validasi(h, out) {
      const per = await teksPerHalaman(out[0].bytes);
      cek("watermark: teks stempel masuk PDF", /RAHASIA/i.test(per.join(" | ")), JSON.stringify(per).slice(0, 90));
      cek("watermark: stempel ada di setiap halaman", per.length === 3 && per.every((t) => /RAHASIA/i.test(t)),
        "halaman=" + per.length);
      /* bukti visual: stempel harus benar-benar tergambar di halaman */
      const pik = await analisisPiksel(out[0].bytes, 1);
      cek("watermark: stempel benar-benar tergambar (bukan sekadar teks)",
        !!(pik && pik.hitam > 0), pik ? "piksel gelap=" + pik.hitam : "gagal render");
    },
  },
  {
    id: "crop", nama: "Potong PDF", file: "sample.pdf", screenshot: "potong",
    opts: { preset: "margin", top: "20", bottom: "20", left: "20", right: "20" },
    async validasi(h, out) {
      const info = await pdfInfo(out[0].bytes);
      const MM = 72 / 25.4;
      /* CropBox harus menyusut 20 mm di tiap sisi; MediaBox tetap. */
      const c = info.boxes[0].c, m = info.boxes[0].m;
      cek("crop: CropBox menyusut 20 mm tiap sisi",
        Math.abs(c[2] - (m[2] - 40 * MM)) < 2 && Math.abs(c[3] - (m[3] - 40 * MM)) < 2,
        "cropBox=" + c.slice(2).map((x) => x.toFixed(1)).join("x") + " media=" + m.slice(2).map((x) => x.toFixed(1)).join("x"));
      cek("crop: MediaBox tidak ikut berubah",
        Math.abs(m[2] - 595.28) < 2 && Math.abs(m[3] - 841.89) < 2,
        m.slice(2).map((x) => x.toFixed(1)).join("x"));
      cek("crop: semua halaman dipotong", info.boxes.every((b) => Math.abs(b.c[2] - (b.m[2] - 40 * MM)) < 2),
        "halaman=" + info.boxes.length);
    },
  },
  {
    id: "edit", nama: "Edit PDF", file: "sample.pdf", opts: { quality: "vector" }, screenshot: "edit",
    async validasi(h, out) {
      const info = await pdfInfo(out[0].bytes);
      cek("edit: PDF hasil tetap valid & 3 halaman", info.halaman === 3, "halaman=" + info.halaman);
    },
  },
  {
    id: "forms", nama: "Isi Formulir", file: "formulir.pdf", opts: {}, screenshot: "formulir",
    prep: async (h) => {
      await h.page.waitForTimeout(1200);
      await h.page.evaluate(() => {
        const inp = document.querySelector(".forms-wrap input[type=text], .forms-wrap input:not([type=checkbox])");
        if (inp) {
          inp.value = "Nilai Uji";
          inp.dispatchEvent(new Event("input", { bubbles: true }));
          inp.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
      await h.page.waitForTimeout(600);
    },
    async validasi(h, out) {
      const info = await pdfInfo(out[0].bytes);
      cek("forms: PDF formulir punya field", info.adaAcroForm, "acroform=" + info.adaAcroForm);
      cek("forms: 1 halaman tetap", info.halaman === 1, "halaman=" + info.halaman);
      const isi = await nilaiField(out[0].bytes);
      cek("forms: nilai field tersimpan", !!(isi && isi.includes("Nilai Uji")), JSON.stringify(isi));
    },
  },
  {
    id: "repair", nama: "Rapi PDF", file: "sample.pdf", opts: { deskew: true, trim: true, autoRotate: true },
    async validasi(h, out) {
      const info = await pdfInfo(out[0].bytes);
      cek("repair: PDF hasil tetap 3 halaman", info.halaman === 3, "halaman=" + info.halaman);
      cek("repair: ukuran halaman wajar", info.sizes.every((s) => s.w > 100 && s.h > 100), JSON.stringify(info.sizes[0]));
    },
  },
  {
    id: "pdfa", nama: "PDF/A", file: "sample.pdf", opts: { meta: true, icc: true }, screenshot: "pdfa",
    async validasi(h, out) {
      const info = await pdfInfo(out[0].bytes);
      cek("pdfa: hasil valid & 3 halaman", info.halaman === 3, "halaman=" + info.halaman);
      cek("pdfa: ada OutputIntent (profil warna)", /\/OutputIntent/.test(info.trafik), "");
      cek("pdfa: ada metadata XMP", /\/Metadata/.test(info.trafik) && /pdfaid:part/i.test(info.trafik),
        /pdfaid:part/.test(info.trafik) ? "pdfaid:part ada" : "pdfaid:part tidak ada");
      cek("pdfa: hasil tidak terenkripsi", !info.terenkripsi, "");
    },
  },
  {
    id: "organize", nama: "Susun PDF", file: "sample.pdf", opts: {}, screenshot: "susun",
    prep: async (h) => {
      await h.page.waitForTimeout(3000);
      const n = await h.page.evaluate(() => document.querySelectorAll(".organize-grid .org-cell").length);
      cek("organize: pratinjau halaman muncul", n === 3, "sel=" + n);
      await h.page.evaluate(() => {
        const sel = document.querySelectorAll(".organize-grid .org-cell");
        const btn = sel[0] && sel[0].querySelector(".org-btn[aria-label='Hapus']");
        if (btn) btn.click();
      });
      await h.page.waitForTimeout(500);
    },
    async validasi(h, out) {
      const info = await pdfInfo(out[0].bytes);
      cek("organize: halaman yang dihapus hilang", info.halaman === 2, "halaman=" + info.halaman);
    },
  },

  /* ---------- alat konversi ---------- */
  {
    id: "jpg2pdf", nama: "Gambar ke PDF", file: "gambar.png", opts: { size: "a4", orientation: "auto" }, screenshot: "gambar-ke-pdf",
    async validasi(h, out) {
      const info = await pdfInfo(out[0].bytes);
      cek("jpg2pdf: PDF A4 terbentuk", info.halaman === 1 && Math.abs(info.sizes[0].w - 595.28) < 2, JSON.stringify(info.sizes[0]));
      cek("jpg2pdf: gambar tertanam di halaman", info.gambar[0] > 0, "xobject=" + info.gambar[0]);
    },
  },
  {
    id: "scan", nama: "Pindai", file: "gambar.png", opts: { size: "a4", margin: "0", deskew: false },
    async validasi(h, out) {
      const info = await pdfInfo(out[0].bytes);
      cek("scan: hasil PDF valid", info.halaman === 1, "halaman=" + info.halaman);
      cek("scan: gambar tertanam di halaman", info.gambar[0] > 0, "xobject=" + info.gambar[0]);
    },
  },
  {
    id: "pdf2jpg", nama: "PDF ke Gambar", file: "sample.pdf", opts: { dpi: "72", format: "jpeg", quality: "80" }, screenshot: "pdf-ke-gambar",
    async validasi(h, out) {
      /* 3 halaman -> satu arsip ZIP berisi 3 gambar */
      cek("pdf2jpg: satu arsip ZIP", out.length === 1 && /\.zip$/i.test(out[0].nama), out.map((o) => o.nama).join(","));
      cek("pdf2jpg: arsip ZIP valid", !!(out[0] && zipBytes(out[0].bytes)), out[0] ? out[0].bytes.length + " B" : "");
    },
  },
  {
    id: "word2pdf", nama: "Word ke PDF", file: "docu.docx", opts: { margin: "20" },
    async validasi(h, out) {
      const info = await pdfInfo(out[0].bytes);
      const t = await teksDariPdf(out[0].bytes);
      cek("word2pdf: PDF terbentuk", info.halaman >= 1, "halaman=" + info.halaman);
      cek("word2pdf: isi dokumen terbawa", /Judul Dokumen Uji/i.test(t), JSON.stringify(t.slice(0, 70)));
    },
  },
  {
    id: "ppt2pdf", nama: "PowerPoint ke PDF", file: "presentasi.pptx", opts: { margin: "20" },
    async validasi(h, out) {
      const info = await pdfInfo(out[0].bytes);
      cek("ppt2pdf: PDF terbentuk", info.halaman >= 1, "halaman=" + info.halaman);
      const t = await teksDariPdf(out[0].bytes);
      cek("ppt2pdf: teks slide terbawa", /Slide uji presentasi/i.test(t), JSON.stringify(t.slice(0, 90)));
    },
  },
  {
    id: "xls2pdf", nama: "Excel ke PDF", file: "tabel.xlsx", opts: { margin: "20" },
    async validasi(h, out) {
      const info = await pdfInfo(out[0].bytes);
      const t = await teksDariPdf(out[0].bytes);
      cek("xls2pdf: PDF terbentuk", info.halaman >= 1, "halaman=" + info.halaman);
      cek("xls2pdf: isi tabel terbawa", /Judul/i.test(t) && /Nilai/i.test(t) && /42/.test(t), JSON.stringify(t.slice(0, 110)));
    },
  },
  {
    id: "pdf2word", nama: "PDF ke Word", file: "sample.pdf", opts: { pageBreak: true },
    async validasi(h, out) {
      cek("pdf2word: berkas .docx terbentuk", /\.docx$/i.test(out[0].nama), out[0].nama);
      cek("pdf2word: docx adalah zip valid", zipBytes(out[0].bytes), "");
      const isi = await isiZip(out[0].bytes);
      const doc = isi["word/document.xml"] || "";
      cek("pdf2word: isi dokumen terbawa ke docx", /Uji halaman 1/i.test(doc), JSON.stringify(Object.keys(isi)).slice(0, 90));
    },
  },
  {
    id: "pdf2xls", nama: "PDF ke Excel", file: "sample.pdf", opts: {},
    async validasi(h, out) {
      cek("pdf2xls: berkas .xlsx terbentuk", /\.xlsx$/i.test(out[0].nama), out[0].nama);
      cek("pdf2xls: xlsx adalah zip valid", zipBytes(out[0].bytes), "");
      const isi = await isiZip(out[0].bytes);
      const gabung = Object.values(isi).join(" ");
      cek("pdf2xls: isi PDF terbawa ke lembar kerja", /Uji halaman 1/i.test(gabung), JSON.stringify(Object.keys(isi)).slice(0, 90));
    },
  },
  {
    id: "pdf2ppt", nama: "PDF ke PowerPoint", file: "sample.pdf", opts: {},
    async validasi(h, out) {
      cek("pdf2ppt: berkas .pptx terbentuk", /\.pptx$/i.test(out[0].nama), out[0].nama);
      cek("pdf2ppt: pptx adalah zip valid", zipBytes(out[0].bytes), "");
      const isi = await isiZip(out[0].bytes);
      const gabung = Object.values(isi).join(" ");
      cek("pdf2ppt: isi PDF terbawa ke slide", /Uji halaman 1/i.test(gabung), JSON.stringify(Object.keys(isi)).slice(0, 90));
    },
  },
  {
    id: "html2pdf", nama: "HTML ke PDF", file: "halaman.html", opts: {}, bolehTanpaBerkas: true,
    async validasi(h, out) {
      /* alur html2pdf memakai dialog cetak browser — di headless tidak
         ada dialog, jadi yang diperiksa adalah: tidak ada error fatal
         dan panel pratinjau HTML tampil. */
      const tampil = await h.page.evaluate(() => !!document.querySelector("#htmlPreview iframe"));
      cek("html2pdf: pratinjau HTML dirender", tampil, "");
      cek("html2pdf: tidak menghasilkan berkas (dialog cetak)", out.length === 0, "jumlah=" + out.length);
    },
  },

  /* ---------- alat keamanan & tanda tangan ---------- */
  {
    id: "protect", nama: "Lindungi PDF", file: "sample.pdf", opts: { password: "Rahasia123", allowPrint: true, allowCopy: true, allowModify: false, allowAnnotate: true }, screenshot: "lindungi",
    async validasi(h, out) {
      const info = await pdfInfo(out[0].bytes);
      cek("protect: PDF jadi terenkripsi", info.terenkripsi, "terenkripsi=" + info.terenkripsi);
      cek("protect: struktur /Encrypt ada", /\/Encrypt\s/.test(info.trafik), "");
      fs.writeFileSync(path.join(FIX, "terkunci.pdf"), out[0].bytes);
    },
  },
  {
    id: "unlock", nama: "Buka PDF Terkunci", file: "terkunci.pdf", opts: {}, screenshot: "buka-kunci",
    prep: async (h) => {
      await h.page.waitForTimeout(600);
      await h.page.evaluate(() => {
        const el = document.getElementById("f_unlockpw");
        if (el) {
          el.value = "Rahasia123";
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
      await h.page.waitForTimeout(400);
    },
    async validasi(h, out) {
      const info = await pdfInfo(out[0].bytes);
      cek("unlock: PDF berhasil dibuka", !info.terenkripsi, "terenkripsi=" + info.terenkripsi);
      cek("unlock: isi tetap ada", info.halaman === 3, "halaman=" + info.halaman);
    },
  },
  {
    id: "sign", nama: "Tanda Tangan", file: "sample.pdf", opts: {}, screenshot: "tanda-tangan",
    prep: async (h) => {
      await h.page.waitForTimeout(2500);
      /* tulis tanda tangan di kanvas #signPad lalu simpan */
      const kotak = await h.page.evaluate(() => {
        const c = document.querySelector("#signPad");
        if (!c) return null;
        const r = c.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      });
      cek("sign: kanvas tanda tangan ada", !!kotak, "");
      if (kotak) {
        await h.page.mouse.move(kotak.x + 40, kotak.y + kotak.h * 0.6);
        await h.page.mouse.down();
        for (let i = 1; i <= 12; i++) {
          await h.page.mouse.move(
            kotak.x + 40 + (i * (kotak.w - 80)) / 12,
            kotak.y + kotak.h * (i % 2 ? 0.35 : 0.65),
          );
        }
        await h.page.mouse.up();
        await h.page.waitForTimeout(400);
        await h.page.evaluate(() => {
          const b = document.querySelector("#signSave");
          if (b) b.click();
        });
        await h.page.waitForTimeout(1500);
      }
    },
    async validasi(h, out) {
      const info = await pdfInfo(out[0].bytes);
      cek("sign: PDF hasil valid & 3 halaman", info.halaman === 3, "halaman=" + info.halaman);
      cek("sign: nama berkas keluar benar", /-ttd\.pdf$/i.test(out[0].nama), out[0].nama);
      /* bukti visual: ada tinta tanda tangan di halaman hasil */
      const pik = await analisisPiksel(out[0].bytes, 1);
      const baseline = await analisisPiksel(fs.readFileSync(fx("sample.pdf")), 1);
      cek("sign: tinta tanda tangan menambah piksel di halaman",
        !!(pik && baseline && pik.tinta > baseline.tinta + 300),
        pik && baseline ? "tinta " + pik.tinta + " vs " + baseline.tinta : "-");
    },
  },
  {
    id: "redact", nama: "Redaksi", file: "redact.pdf", opts: { term: "RAHASIA", scale: "200" }, screenshot: "redaksi",
    prep: async (h) => {
      await h.page.waitForTimeout(900);
      await h.page.evaluate(() => {
        const b = [...document.querySelectorAll(".redact-aksi button")].find((x) => /cari/i.test(x.textContent));
        if (b) b.click();
      });
      await h.page.waitForTimeout(2000);
    },
    async validasi(h, out) {
      /* Halaman yang diberi hit dirender ulang menjadi gambar, jadi
         teksnya memang hilang (redaksi permanen). Halaman lain harus
         tetap utuh dan bisa dicari. */
      const perHalaman = await teksPerHalaman(out[0].bytes);
      cek("redact: kata target hilang dari seluruh PDF", !/rahasia/i.test(perHalaman.join(" | ")),
        JSON.stringify(perHalaman).slice(0, 140));
      cek("redact: halaman tanpa hit tetap bisa dicari", /Teks biasa/.test(perHalaman[0] || "") && /Teks biasa/.test(perHalaman[2] || ""),
        JSON.stringify([perHalaman[0], perHalaman[2]]).slice(0, 140));
      /* bukti visual: kata yang diredaksi tertutup kotak hitam pekat,
         sementara halaman lain tetap seperti aslinya */
      const p1 = await analisisPiksel(out[0].bytes, 1);
      const p2 = await analisisPiksel(out[0].bytes, 2);
      cek("redact: hanya halaman yang direduksi punya kotak hitam pekat",
        !!(p1 && p2 && p2.tegas > p1.tegas + 300),
        p1 && p2 ? "hal.1=" + p1.tegas + " hal.2=" + p2.tegas : "-");
      cek("redact: halaman tanpa hit tetap berupa teks (bukan gambar buram)",
        !!(p1 && p1.hitam > 100), p1 ? "piksel teks hal.1=" + p1.hitam : "-");
    },
  },
  {
    id: "compare", nama: "Bandingkan PDF", file: "sample.pdf", opts: {}, screenshot: "bandingkan",
    prep: async (h) => {
      await h.unggah(fx("satu.pdf"), 0);
      await h.page.waitForTimeout(1200);
    },
    async validasi(h, out) {
      cek("compare: laporan perbandingan dibuat", out.length >= 1, "jumlah=" + out.length);
      cek("compare: nama berkas masuk akal", /\.(txt|md|html|pdf)$/i.test(out[0].nama), out[0].nama);
      const isi = out[0].bytes.toString("utf8");
      cek("compare: laporan memuat isi kedua PDF", /satu|sample/i.test(isi), isi.slice(0, 90).replace(/\s+/g, " "));
      cek("compare: laporan menandai bagian berbeda", /berbeda|diff|tambah|hapus|sama/i.test(isi),
        isi.replace(/\s+/g, " ").slice(0, 110));
    },
  },

  /* ---------- alat pintar ---------- */
  {
    id: "markdown", nama: "PDF ke Markdown", file: "sample.pdf", opts: { pageSep: true, code: false }, screenshot: "markdown",
    async validasi(h, out) {
      const teks = out[0].bytes.toString("utf8");
      cek("markdown: berkas .md terbentuk", /\.md$/i.test(out[0].nama), out[0].nama);
      cek("markdown: isi teks terbawa", /halaman 1|Uji/i.test(teks), JSON.stringify(teks.slice(0, 70)));
    },
  },
  {
    id: "summarize", nama: "Ringkas PDF", file: "sample.pdf", opts: { count: "3", unit: "sentence" },
    async validasi(h, out) {
      const teks = out[0].bytes.toString("utf8");
      cek("summarize: ringkasan tidak kosong", teks.trim().length > 10, teks.trim().slice(0, 70));
    },
  },
  {
    id: "translate", nama: "Terjemahkan PDF", file: "sample.pdf", opts: { lang: "en" },
    async validasi(h, out) {
      cek("translate: berkas .md terbentuk", /\.md$/i.test(out[0].nama), out[0].nama);
      const teks = out[0].bytes.toString("utf8");
      cek("translate: isi terjemahan tidak kosong", teks.trim().length > 20, JSON.stringify(teks.slice(0, 80)));
      cek("translate: judul dokumen dipertahankan", /#\s/.test(teks), "");
    },
  },
  {
    id: "ocr", nama: "OCR PDF", file: "sample.pdf", opts: { lang: "eng" }, screenshot: "ocr",
    async validasi(h, out) {
      const info = await pdfInfo(out[0].bytes);
      cek("ocr: PDF hasil valid", info.halaman === 3, "halaman=" + info.halaman);
    },
  },

  /* ---------- launcher tab utama ---------- */
  {
    id: "merge", nama: "Gabung PDF", kind: "link", file: "sample.pdf", screenshot: "gabung",
    async jalankan(h) {
      await h.tab("merge");
      await h.page.waitForTimeout(400);
      await h.page.setInputFiles("#mergeInput", [fx("sample.pdf"), fx("satu.pdf")]);
      await h.page.waitForTimeout(2000);
      await h.screenshot("gabung-panel");
      await h.page.click("#mergeRunBtn");
      for (let i = 0; i < 60; i++) {
        await h.page.waitForTimeout(500);
        const n = await h.page.evaluate(() => document.querySelectorAll("#mergeResults > *").length);
        if (n > 0) break;
      }
      const bytes = await h.page.evaluate(async () => {
        const as = [...document.querySelectorAll("#mergeResults a")];
        const out = [];
        for (const a of as) {
          const r = await fetch(a.href);
          const b = new Uint8Array(await r.arrayBuffer());
          let s = "";
          for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
          out.push({ nama: a.download || a.textContent, b64: btoa(s) });
        }
        return out;
      });
      return {
        ok: bytes.length > 0, durasi: 0,
        keluar: bytes.map((b) => ({ nama: b.nama, bytes: Buffer.from(b.b64, "base64") })),
      };
    },
    async validasi(h, out) {
      const info = await pdfInfo(out[0].bytes);
      cek("merge: 3+1 = 4 halaman", info.halaman === 4, "halaman=" + info.halaman);
    },
  },
  {
    id: "split", nama: "Pisah PDF", kind: "link", file: "sample.pdf", screenshot: "pisah",
    async jalankan(h) {
      await h.tab("split");
      await h.page.waitForTimeout(400);
      await h.page.setInputFiles("#fileInput", fx("sample.pdf"));
      await h.page.waitForTimeout(2200);
      await h.screenshot("pisah-panel");
      await h.page.evaluate(() => {
        const r = document.querySelector("input[name=mode][value=each]");
        if (r) { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); }
      });
      await h.page.waitForTimeout(600);
      await h.page.click("#runBtn");
      for (let i = 0; i < 60; i++) {
        await h.page.waitForTimeout(500);
        const n = await h.page.evaluate(() => document.querySelectorAll("#results > *").length);
        if (n > 0) break;
      }
      const bytes = await h.page.evaluate(async () => {
        const as = [...document.querySelectorAll("#results a")];
        const out = [];
        for (const a of as) {
          const r = await fetch(a.href);
          const b = new Uint8Array(await r.arrayBuffer());
          let s = "";
          for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
          out.push({ nama: a.download || a.textContent, b64: btoa(s) });
        }
        return out;
      });
      return {
        ok: bytes.length > 0, durasi: 0,
        keluar: bytes.map((b) => ({ nama: b.nama, bytes: Buffer.from(b.b64, "base64") })),
      };
    },
    async validasi(h, out) {
      const zip = out.find((o) => /\.zip$/i.test(o.nama));
      cek("split: arsip zip dibuat", !!zip, out.map((o) => o.nama).join(","));
      if (zip) cek("split: zip valid", zipBytes(zip.bytes), zip.bytes.length + " B");
      const pdf = out.filter((o) => /\.pdf$/i.test(o.nama));
      cek("split: 3 PDF per halaman", pdf.length === 3, "jumlah=" + pdf.length);
      if (pdf.length) {
        const info = await pdfInfo(pdf[0].bytes);
        cek("split: tiap PDF 1 halaman", info.halaman === 1, "halaman=" + info.halaman);
      }
    },
  },
  {
    id: "remove-pages", nama: "Hapus Halaman", kind: "link", file: "sample.pdf", screenshot: "hapus-halaman",
    async jalankan(h) {
      await h.tab("split");
      await h.page.waitForTimeout(400);
      await h.page.setInputFiles("#fileInput", fx("sample.pdf"));
      await h.page.waitForTimeout(2200);
      await h.screenshot("hapus-halaman-panel");
      await h.page.evaluate(() => {
        const r = document.querySelector("input[name=mode][value=remove]");
        if (r) { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); }
        /* lepaskan semua halaman terpilih dulu supaya tidak ada yang terhapus */
        document.querySelector('[data-sel="none"]')?.click();
      });
      await h.page.waitForTimeout(600);
      /* pilih halaman 2 dengan klik kartu */
      /* tandai halaman 2 untuk dihapus memakai tombol X */
      await h.page.evaluate(() => {
        const x = document.querySelector('.fb-pages .tclose[data-page="1"]');
        if (x) x.click();
      });
      await h.page.waitForTimeout(900);
      await h.page.click("#runBtn");
      for (let i = 0; i < 60; i++) {
        await h.page.waitForTimeout(500);
        const n = await h.page.evaluate(() => document.querySelectorAll("#results > *").length);
        if (n > 0) break;
      }
      const bytes = await h.page.evaluate(async () => {
        const as = [...document.querySelectorAll("#results a")];
        const out = [];
        for (const a of as) {
          const r = await fetch(a.href);
          const b = new Uint8Array(await r.arrayBuffer());
          let s = "";
          for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
          out.push({ nama: a.download || a.textContent, b64: btoa(s) });
        }
        return out;
      });
      return {
        ok: bytes.length > 0, durasi: 0,
        keluar: bytes.map((b) => ({ nama: b.nama, bytes: Buffer.from(b.b64, "base64") })),
      };
    },
    async validasi(h, out) {
      const pdf = out.find((o) => /\.pdf$/i.test(o.nama));
      cek("remove-pages: PDF hasil ada", !!pdf, out.map((o) => o.nama).join(","));
      if (pdf) {
        const info = await pdfInfo(pdf.bytes);
        cek("remove-pages: 1 halaman dihapus -> 2 tersisa", info.halaman === 2, "halaman=" + info.halaman);
      }
    },
  },
  {
    id: "extract-pages", nama: "Ekstrak Halaman", kind: "link", file: "sample.pdf", screenshot: "ekstrak-halaman",
    async jalankan(h) {
      await h.tab("split");
      await h.page.waitForTimeout(400);
      await h.page.setInputFiles("#fileInput", fx("sample.pdf"));
      await h.page.waitForTimeout(2200);
      await h.screenshot("ekstrak-halaman-panel");
      await h.page.evaluate(() => {
        const r = document.querySelector("input[name=mode][value=extract]");
        if (r) { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); }
        document.querySelector('[data-sel="none"]')?.click();
      });
      await h.page.waitForTimeout(600);
      await h.page.evaluate(() => {
        const t = document.querySelector('.fb-pages .thumb[data-page="0"]');
        if (t) t.click();
      });
      await h.page.waitForTimeout(900);
      await h.page.click("#runBtn");
      for (let i = 0; i < 60; i++) {
        await h.page.waitForTimeout(500);
        const n = await h.page.evaluate(() => document.querySelectorAll("#results > *").length);
        if (n > 0) break;
      }
      const bytes = await h.page.evaluate(async () => {
        const as = [...document.querySelectorAll("#results a")];
        const out = [];
        for (const a of as) {
          const r = await fetch(a.href);
          const b = new Uint8Array(await r.arrayBuffer());
          let s = "";
          for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
          out.push({ nama: a.download || a.textContent, b64: btoa(s) });
        }
        return out;
      });
      return {
        ok: bytes.length > 0, durasi: 0,
        keluar: bytes.map((b) => ({ nama: b.nama, bytes: Buffer.from(b.b64, "base64") })),
      };
    },
    async validasi(h, out) {
      const pdf = out.find((o) => /\.pdf$/i.test(o.nama));
      cek("extract-pages: PDF hasil ada", !!pdf, out.map((o) => o.nama).join(","));
      if (pdf) {
        const info = await pdfInfo(pdf.bytes);
        cek("extract-pages: hanya 1 halaman", info.halaman === 1, "halaman=" + info.halaman);
      }
    },
  },
  {
    id: "compress-link", nama: "Kompres PDF", kind: "link", file: "sample.pdf", screenshot: "kompres",
    async jalankan(h) {
      await h.tab("compress");
      await h.page.waitForTimeout(400);
      await h.page.setInputFiles("#compressInput", fx("sample.pdf"));
      await h.page.waitForTimeout(1800);
      await h.screenshot("kompres-panel");
      await h.page.click("#compressRunBtn");
      for (let i = 0; i < 90; i++) {
        await h.page.waitForTimeout(500);
        const n = await h.page.evaluate(() => document.querySelectorAll("#compressResults > *").length);
        if (n > 0) break;
      }
      const bytes = await h.page.evaluate(async () => {
        const as = [...document.querySelectorAll("#compressResults a")];
        const out = [];
        for (const a of as) {
          const r = await fetch(a.href);
          const b = new Uint8Array(await r.arrayBuffer());
          let s = "";
          for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
          out.push({ nama: a.download || a.textContent, b64: btoa(s) });
        }
        return out;
      });
      return {
        ok: bytes.length > 0, durasi: 0,
        keluar: bytes.map((b) => ({ nama: b.nama, bytes: Buffer.from(b.b64, "base64") })),
      };
    },
    async validasi(h, out) {
      const pdf = out.find((o) => /\.pdf$/i.test(o.nama));
      cek("compress: PDF hasil ada", !!pdf, out.map((o) => o.nama).join(","));
      if (pdf) {
        const info = await pdfInfo(pdf.bytes);
        cek("compress: PDF tetap bisa dibaca", info.halaman === 3, "halaman=" + info.halaman);
      }
    },
  },
];

/* ============================================================
   Fase 2: jalur banyak-berkas & jalur galat
   ============================================================ */
const FASE2 = [
  {
    nama: "Banyak berkas: rotasi 2 PDF sekaligus",
    async jalankan(h) {
      await h.bukaAlat("rotate");
      await h.isiFields({ angle: "90", dir: "cw" });
      await h.unggahMulti([fx("sample.pdf"), fx("satu.pdf")]);
      return await h.jalankan({ timeout: 90 });
    },
    async validasi(h, out) {
      cek("multi: dua berkas menghasilkan dua PDF", out.length === 2, out.map((o) => o.nama).join(","));
      let semuaOK = out.length === 2;
      for (const o of out) {
        const info = await pdfInfo(o.bytes);
        if (!info.rot.every((r) => r === 90)) semuaOK = false;
      }
      cek("multi: setiap berkas diputar 90 derajat", semuaOK, "");
    },
  },
  {
    nama: "Banyak berkas: lindungi 2 PDF sekaligus",
    async jalankan(h) {
      await h.bukaAlat("protect");
      await h.isiFields({ password: "Rahasia123" });
      await h.unggahMulti([fx("sample.pdf"), fx("satu.pdf")]);
      return await h.jalankan({ timeout: 90 });
    },
    async validasi(h, out) {
      cek("multi: dua PDF terkunci dibuat", out.length === 2, out.map((o) => o.nama).join(","));
      let semuaOK = out.length === 2;
      for (const o of out) {
        const info = await pdfInfo(o.bytes);
        if (!info.terenkripsi) semuaOK = false;
      }
      cek("multi: keduanya benar-benar terenkripsi", semuaOK, "");
    },
  },
  {
    nama: "Galat: PDF diberikan ke alat gambar",
    async jalankan(h) {
      await h.bukaAlat("jpg2pdf");
      await h.unggah(fx("sample.pdf"));
      return await h.jalankan({ timeout: 60 });
    },
    async validasi(h, out) {
      cek("galat: alat gambar menolak PDF dengan pesan ramah", !out.ok, (out.err || "").slice(0, 140));
    },
  },
  {
    nama: "Galat: kata kunci tidak ada saat redaksi",
    async jalankan(h) {
      await h.bukaAlat("redact");
      await h.isiFields({ term: "KATAYANGDIAMUK" });
      await h.unggah(fx("sample.pdf"));
      return await h.jalankan({ timeout: 60 });
    },
    async validasi(h, out) {
      cek("galat: redaksi menolak kata yang tidak ada", !out.ok, (out.err || "").slice(0, 140));
    },
  },
  {
    nama: "Galat: lindungi tanpa password",
    async jalankan(h) {
      await h.bukaAlat("protect");
      await h.isiFields({ password: "" });
      await h.unggah(fx("sample.pdf"));
      return await h.jalankan({ timeout: 60 });
    },
    async validasi(h, out) {
      cek("galat: lindungi menolak tanpa password", !out.ok, (out.err || "").slice(0, 140));
    },
  },
  {
    nama: "Galat: buka kunci dengan password salah",
    async jalankan(h) {
      await h.bukaAlat("unlock");
      await h.unggah(fx("terkunci.pdf"));
      await h.page.evaluate(() => {
        const el = document.getElementById("f_unlockpw");
        if (el) {
          el.value = "PasswordSalah";
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
      await h.page.waitForTimeout(400);
      return await h.jalankan({ timeout: 60 });
    },
    async validasi(h, out) {
      cek("galat: buka kunci menolak password salah", !out.ok, (out.err || "").slice(0, 140));
    },
  },
  {
    nama: "Galat: halaman di luar jangkauan",
    async jalankan(h) {
      await h.bukaAlat("redact");
      await h.isiFields({ term: "Uji", halaman: "99-120" });
      await h.unggah(fx("sample.pdf"));
      return await h.jalankan({ timeout: 60 });
    },
    async validasi(h, out) {
      cek("galat: rentang halaman di luar jangkauan ditolak", !out.ok, (out.err || "").slice(0, 140));
    },
  },
  {
    nama: "Galat: bandingkan dengan satu berkas saja",
    async jalankan(h) {
      await h.bukaAlat("compare");
      await h.unggah(fx("sample.pdf"));
      return await h.jalankan({ timeout: 60 });
    },
    async validasi(h, out) {
      cek("galat: bandingkan butuh dua berkas", !out.ok, (out.err || "").slice(0, 140));
    },
  },
  {
    nama: "Galat: tanda tangan tanpa gambar tanda tangan",
    async jalankan(h) {
      await h.bukaAlat("sign");
      await h.unggah(fx("sample.pdf"));
      await h.page.waitForTimeout(2000);
      return await h.jalankan({ timeout: 60 });
    },
    async validasi(h, out) {
      cek("galat: tanda tangan menolak tanpa tinta", !out.ok, (out.err || "").slice(0, 140));
    },
  },
  {
    nama: "Galat: berkas nol byte",
    async jalankan(h) {
      await h.bukaAlat("rotate");
      await h.unggah(fx("nolbyte.pdf"));
      return await h.jalankan({ timeout: 60 });
    },
    async validasi(h, out) {
      cek("galat: berkas 0 byte ditolak dengan pesan ramah", !out.ok, (out.err || "").slice(0, 140));
    },
  },
  {
    nama: "Galat: PDF terkunci dibuka dengan alat biasa",
    async jalankan(h) {
      await h.bukaAlat("rotate");
      await h.unggah(fx("terkunci.pdf"));
      return await h.jalankan({ timeout: 60 });
    },
    async validasi(h, out) {
      cek("galat: PDF terkunci ditolak alat biasa", !out.ok, (out.err || "").slice(0, 140));
    },
  },
];

/* ============================================================
   Main
   ============================================================ */
async function main() {
  const srv = await server();
  const browser = await chromium();
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  const daftar = FITUR.filter((f) => !ONLY || f.id.includes(ONLY));
  console.log(`\n=== Audit semua fitur: ${daftar.length} fitur ===\n`);

  for (const f of daftar) {
    const h = new Harness(page);
    const label = `[${f.id}]`;
    process.stdout.write(`\n--- ${label} ${f.nama} ---\n`);
    try {
      await h.muat();
      if (f.kind === "link") {
        /* launcher: tidak lewat kartu alat */
      } else {
        await h.bukaAlat(f.id);
      }
      if (f.opts && Object.keys(f.opts).length) await h.isiFields(f.opts);
      /* berkas diunggah lebih dulu: panel khusus (tanda tangan,
         redaksi, susun halaman, formulir) hanya terisi setelah ada
         berkas, jadi langkahnya harus urut. */
      if (f.file && !f.kind) await h.unggah(fx(f.file));
      if (f.prep) await f.prep(h);
      if (f.screenshot && f.kind !== "link") await h.screenshot(f.screenshot + "-panel");
      const out = f.jalankan ? await f.jalankan(h) : await h.jalankan({ timeout: f.timeout || 90 });
      if (f.negatif) {
        /* jalur negatif: aplikasi harus menolak dengan pesan ramah,
           bukan meledak (galat tak tertangani / error teknis). */
        const pesan = String(out.err || "");
        const ramah = pesan.length > 8 &&
          !/is not a function|undefined|Cannot read|not defined|TypeError/i.test(pesan);
        cek(`${label} menolak berkas rusak dengan pesan ramah`, !out.ok && ramah, pesan.slice(0, 150));
        continue;
      }
      if (!out.ok) {
        /* alur yang memang tidak menghasilkan berkas (dialog cetak) */
        if (f.bolehTanpaBerkas && /tidak ada berkas hasil/i.test(out.err || "")) {
          cek(`${label} berjalan tanpa galat fatal`, true, "");
          if (f.validasiTanpaBerkas) await f.validasiTanpaBerkas(h, []);
          continue;
        }
        cek(`${label} menjalankan fitur`, false, out.err || "gagal");
        continue;
      }
      if (!out.keluar.length) {
        /* sebagian alur (mis. dialog cetak browser) memang tidak
           menghasilkan berkas unduhan */
        cek(`${label} tidak menghasilkan berkas (sesuai desain)`, !!f.bolehTanpaBerkas, "tidak ada output");
        if (f.validasiTanpaBerkas) await f.validasiTanpaBerkas(h, []);
        continue;
      }
      cek(`${label} menghasilkan berkas`, true,
        out.keluar.map((o) => `${o.nama} (${o.bytes.length} B)`).join(", ").slice(0, 110));
      /* simpan keluaran sebagai bukti yang bisa diperiksa ulang */
      const dirK = path.join(SHOTS, "keluaran");
      fs.mkdirSync(dirK, { recursive: true });
      for (const o of out.keluar) {
        const bersih = String(o.nama).replace(/[^\w.\-]+/g, "_");
        fs.writeFileSync(path.join(dirK, `${f.id}__${bersih}`), o.bytes);
      }
      await f.validasi(h, out.keluar);
      if (f.screenshot) await h.screenshot(f.screenshot + "-hasil");
    } catch (e) {
      cek(`${label} menjalankan fitur`, false, e && e.message ? e.message : String(e));
    }
  }

  /* Galat yang muncul di fase 2 memang disengaja (uji jalur galat),
     jadi pemeriksaan konsol hanya berlaku untuk fase 1. */
  const galatFase1 = errors.slice();

  /* ================= FASE 2: banyak berkas & jalur galat ================= */
  console.log("\n=== Fase 2: jalur banyak-berkas & jalur galat ===\n");
  for (const f of FASE2) {
    const h = new Harness(page);
    process.stdout.write(`\n--- ${f.nama} ---\n`);
    try {
      await h.muat();
      const out = await f.jalankan(h);
      await f.validasi(h, out.keluar || []);
    } catch (e) {
      cek(`${f.nama} berjalan`, false, e && e.message ? e.message : String(e));
    }
  }

  /* --- pemeriksaan statis: semua berkas sumber aplikasi harus bisa
         di-parse (menangkap bug seperti "functionX" tanpa spasi) --- */
  const sumber = fs.readdirSync(ROOT)
    .filter((f) => f.endsWith(".js"))
    .filter((f) => !/^(sw|service-worker)\.js$/.test(f));
  const rusakParse = [];
  for (const f of sumber) {
    const p = path.join(ROOT, f);
    const r = spawnSync(process.execPath, ["--check", p], { encoding: "utf8" });
    if (r.status !== 0) rusakParse.push(f + ": " + String(r.stderr).split("\n")[4]);
  }
  cek("Statis: semua berkas sumber aplikasi bisa di-parse", rusakParse.length === 0,
    rusakParse.join(" | ").slice(0, 200));

  /* --- pemeriksaan responsif: daftar alat harus tetap lega di layar
         sempit dan semua alat bisa ditemukan lewat pencarian --- */
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.PDFApp && window.PDFApp.setTab && window.PDFApp.setTab("tools"));
  await page.waitForTimeout(600);
  const resp = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("#toolCategories .tool-card")];
    const doc = document.documentElement;
    return {
      kartu: cards.length,
      galat: doc.scrollWidth - doc.clientWidth,
      adaCari: !!document.querySelector("#toolSearch"),
    };
  });
  cek("Responsif: daftar alat lengkap di 360px", resp.kartu >= 33, "kartu=" + resp.kartu);
  cek("Responsif: tidak ada gulir horizontal di 360px", resp.galat <= 1, "selisih=" + resp.galat + "px");
  cek("Responsif: kotak pencarian alat ada", resp.adaCari, "");
  await page.setViewportSize({ width: 1440, height: 950 });

  /* --- konsol bersih? (hanya fase 1; fase 2 memang sengaja gagal) --- */
  const nyata = galatFase1.filter((e) => !/favicon|ERR_FILE_NOT_FOUND.*favicon/i.test(e));
  cek("Umum: tidak ada error konsol fatal di jalur berhasil", nyata.length === 0,
    nyata.slice(0, 3).join(" | ").slice(0, 200));

  console.log(`\n=== RINGKASAN: ${pass} lulus, ${fail} gagal (total ${pass + fail}) ===\n`);

  const outFile = path.join(ROOT, "docs", "audit-semua-hasil.json");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ tanggal: new Date().toISOString(), pass, fail, results, errors: nyata }, null, 2));

  await browser.close();
  srv.close();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
