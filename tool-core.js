/* ============================================================
   Inti toolkit PDF — helper yang dipakai semua alat.
   Semua tetap berjalan di browser (tanpa server).
   ============================================================ */
(function () {
  "use strict";

  const L = window.PDFLib;
  const {
    PDFDocument, PDFName, PDFNumber, PDFArray, PDFString, PDFHexString, PDFRef,
    PDFRawStream, PDFBool, PDFDict, PDFInvalidObject,
    rgb, degrees, StandardFonts,
  } = L;

  /* ---------- mendaftarkan alat ---------- */
  const registry = [];
  function register(tool) {
    registry.push(tool);
    return tool;
  }

  /* ---------- util umum ---------- */
  const tick = () => new Promise((r) => setTimeout(r, 0));

  function fmtSize(b) {
    if (!Number.isFinite(b)) return "-";
    if (b < 1024) return b + " B";
    if (b < 1048576) return (b / 1024).toFixed(0) + " KB";
    return (b / 1048576).toFixed(1) + " MB";
  }

  function baseName(n) {
    return String(n || "dokumen").replace(/\.[a-z0-9]+$/i, "") || "dokumen";
  }

  function safeName(s) {
    return String(s || "dokumen").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "dokumen";
  }

  function looksLikePdf(bytes) {
    if (!bytes || bytes.length < 5) return false;
    const n = Math.min(bytes.length, 1024);
    for (let i = 0; i + 4 < n; i++) {
      if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2d) return true;
    }
    return false;
  }

  /* ---------- PDF (pdf-lib) ---------- */
  async function loadDoc(bytes, opts) {
    return PDFDocument.load(bytes, Object.assign({
      updateMetadata: false,
      throwOnInvalidObject: false,
    }, opts || {}));
  }

  async function saveDoc(doc, opts) {
    return doc.save(Object.assign({ useObjectStreams: true, addDefaultPage: false }, opts || {}));
  }

  /* ---------- PDF (pdf.js) ---------- */
  function pdfjsTask(bytes, extra) {
    return pdfjsLib.getDocument(Object.assign({
      data: bytes.slice(0),
      isEvalSupported: false,
    }, extra || {}));
  }

  async function openPdfjs(bytes, extra) {
    const task = pdfjsTask(bytes, extra);
    return task.promise;
  }

  async function renderPage(pdfDoc, pageNo, scale, opts) {
    const page = await pdfDoc.getPage(pageNo);
    const vp = page.getViewport({ scale: scale || 1 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(vp.width));
    canvas.height = Math.max(1, Math.ceil(vp.height));
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!(opts && opts.skipRender)) {
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
    }
    return { canvas, ctx, viewport: vp, page };
  }

  async function canvasToBytes(canvas, type, quality) {
    const mime = type || "image/jpeg";
    const blob = await new Promise((res) => canvas.toBlob(res, mime, quality == null ? 0.92 : quality));
    if (!blob) throw new Error("Gagal mengubah halaman menjadi gambar.");
    return new Uint8Array(await blob.arrayBuffer());
  }

  /* Teks per halaman + posisi (untuk nomor halaman, redaksi, ringkasan). */
  async function extractText(pdfDoc, pageNo) {
    const page = await pdfDoc.getPage(pageNo);
    const tc = await page.getTextContent();
    const items = [];
    for (const it of tc.items) {
      if (!it.str) continue;
      const tr = it.transform || [1, 0, 0, 1, 0, 0];
      items.push({
        str: it.str,
        x: tr[4],
        y: tr[5],
        w: it.width || 0,
        h: it.height || Math.abs(tr[3]) || 10,
        dir: it.dir || "ltr",
        font: it.fontName || "",
      });
    }
    return items;
  }

  async function pageText(pdfDoc, pageNo) {
    const items = await extractText(pdfDoc, pageNo);
    return items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
  }

  /* ---------- gambar ---------- */
  async function decodeImage(bytes, mime) {
    const blob = new Blob([bytes], { type: mime || "" });
    if (window.createImageBitmap) {
      try {
        return await createImageBitmap(blob);
      } catch (_) { /* lanjut ke jalur <img> */ }
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Gambar tidak bisa dibaca.")); };
      img.src = url;
    });
  }

  /* ---------- ZIP ---------- */
  async function makeZip(entries) {
    const zip = new JSZip();
    for (const e of entries) {
      zip.file(e.name, e.blob != null ? e.blob : e.bytes);
    }
    return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  }

  /* ---------- font ---------- */
  const fontCache = new Map();
  async function getFont(doc, kind) {
    if (!fontCache.has(kind)) fontCache.set(kind, doc.embedFont(StandardFonts[kind || "Helvetica"]));
    return fontCache.get(kind);
  }
  /* Font harus di-embed per dokumen, jadi cache per dokumen. */
  const docFonts = new WeakMap();
  async function fontFor(doc, kind) {
    let m = docFonts.get(doc);
    if (!m) { m = new Map(); docFonts.set(doc, m); }
    const k = kind || "Helvetica";
    if (!m.has(k)) m.set(k, await doc.embedFont(StandardFonts[k]));
    return m.get(k);
  }

  /* Menulis teks; bila font standar tidak bisa (_"Helvetica" tidak punya
     karakter itu) kembalikan false supaya pemanggil bisa memberi
     tahu pengguna, bukan meledak dengan error internal. */
  async function drawTextSafe(page, text, opts) {
    if (!text) return true;
    const doc = page.doc;
    const font = await fontFor(doc, opts.font || "Helvetica");
    try {
      page.drawText(text, Object.assign({ font, size: 12, color: rgb(0, 0, 0) }, opts, { font }));
      return true;
    } catch (err) {
      return false;
    }
  }

  /* ---------- ukuran halaman ---------- */
  const MM = 72 / 25.4;
  const A4 = { w: 595.28, h: 841.89 };
  const LETTER = { w: 612, h: 792 };

  function pageSizeName(w, h) {
    if (Math.abs(w - A4.w) < 3 && Math.abs(h - A4.h) < 3) return "A4";
    if (Math.abs(w - LETTER.w) < 3 && Math.abs(h - LETTER.h) < 3) return "Letter";
    return "custom";
  }

  /* ---------- kurangi ukuran stream ---------- */
  function compactBytes(bytes) {
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  }

  /* ---------- daftar sah untuk color input ---------- */
  function parseColor(v, fallback) {
    const s = String(v || "").trim();
    const m = /^#?([0-9a-f]{6})$/i.exec(s);
    if (m) {
      const n = parseInt(m[1], 16);
      return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
    }
    const named = {
      hitam: [0, 0, 0], putih: [1, 1, 1], merah: [0.85, 0.2, 0.2], biru: [0.2, 0.4, 0.85],
      hijau: [0.15, 0.6, 0.3], kuning: [0.95, 0.8, 0.15], abu: [0.5, 0.5, 0.5], oranye: [0.95, 0.55, 0.15],
    }[s.toLowerCase()];
    if (named) return rgb(named[0], named[1], named[2]);
    return fallback || rgb(0, 0, 0);
  }

  /* ============================================================
     Editor visual: kotak teks, kotak gambar, dan penerapan edit
     ke kanvas. Semua koordinat kotak memakai "user space" PDF
     (titik asal kiri-bawah, satuan point PDF).
     ============================================================ */

  /* Daftar font yang bisa dipilih. Aplikasi berjalan offline, jadi
     memakai stack font generik — kalau font tidak ada, peramban
     memakai pengganti yang paling mendekati. */
  const FONT_LIST = [
    { id: "helvetica", label: "Helvetica / Arial", css: 'Helvetica, Arial, Arimo, "Liberation Sans", sans-serif' },
    { id: "times", label: "Times New Roman", css: '"Times New Roman", Times, Tinos, "Liberation Serif", serif' },
    { id: "courier", label: "Courier New", css: '"Courier New", Courier, Cousine, "Liberation Mono", monospace' },
    { id: "georgia", label: "Georgia", css: 'Georgia, Gelasio, "DejaVu Serif", serif' },
    { id: "verdana", label: "Verdana", css: 'Verdana, "DejaVu Sans", "Bitstream Vera Sans", sans-serif' },
    { id: "tahoma", label: "Tahoma", css: 'Tahoma, "DejaVu Sans", "Liberation Sans", sans-serif' },
    { id: "trebuchet", label: "Trebuchet MS", css: '"Trebuchet MS", "Fira Sans", "DejaVu Sans", sans-serif' },
    { id: "impact", label: "Impact", css: 'Impact, Anton, "Arial Black", sans-serif' },
    { id: "comic", label: "Comic Sans MS", css: '"Comic Sans MS", "Comic Neue", "Chalkboard SE", cursive' },
  ];

  function fontCss(id) {
    const f = FONT_LIST.find((x) => x.id === id);
    return f ? f.css : FONT_LIST[0].css;
  }

  /* Perkalian matriks 2D (baris-major seperti pdf.js). */
  function mulMat(m, n) {
    if (!m) return [1, 0, 0, 1, 0, 0];
    if (!n) return m.slice();
    return [
      m[0] * n[0] + m[2] * n[1],
      m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3],
      m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4],
      m[1] * n[4] + m[3] * n[5] + m[5],
    ];
  }

  function applyMat(m, x, y) {
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  }

  /* Kotak teks yang bisa diklik (blok per item teks pdf.js). */
  const TEXT_ASCENT = 0.80;
  const TEXT_DESCENT = 0.22;

  async function pageTextBoxes(pdfDoc, pageNo) {
    const page = await pdfDoc.getPage(pageNo);
    const tc = await page.getTextContent();
    const out = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const tr = it.transform || [1, 0, 0, 1, 0, 0];
      const size = Math.hypot(tr[2], tr[3]) || Math.abs(tr[3]) || 10;
      const w = it.width || 0;
      if (!w || !size) continue;
      const bx = tr[4];
      const by = tr[5];
      out.push({
        str: it.str,
        fontName: it.fontName || "",
        size,
        x: bx,
        y: by - size * TEXT_DESCENT,
        w,
        h: size * (TEXT_ASCENT + TEXT_DESCENT),
        by,
      });
    }
    return out;
  }

  /* Kotak gambar: dibaca dari operator list (CTM saat gambar digambar). */
  async function pageImageBoxes(pdfDoc, pageNo) {
    const OPS = window.pdfjsLib && window.pdfjsLib.OPS;
    if (!OPS) return [];
    const page = await pdfDoc.getPage(pageNo);
    const op = await page.getOperatorList();
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    const out = [];
    for (let i = 0; i < op.fnArray.length; i++) {
      const fn = op.fnArray[i];
      const args = op.argsArray[i];
      if (fn === OPS.save) {
        stack.push(ctm.slice());
      } else if (fn === OPS.restore) {
        ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      } else if (fn === OPS.transform && args && args.length >= 6) {
        ctm = mulMat(ctm, args);
      } else if (fn === OPS.paintFormXObjectBegin && args && Array.isArray(args[0]) && args[0].length >= 6) {
        stack.push(ctm.slice());
        ctm = mulMat(ctm, args[0]);
      } else if (fn === OPS.paintFormXObjectEnd) {
        ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      } else if (
        fn === OPS.paintImageXObject ||
        fn === OPS.paintImageMaskXObject ||
        fn === OPS.paintImageXObjectRepeat ||
        fn === OPS.paintInlineImageXObject
      ) {
        /* Gambar occupies unit square (0,0)-(1,1) pada ruang user. */
        const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => applyMat(ctm, u, v));
        const xs = corners.map((p) => p[0]);
        const ys = corners.map((p) => p[1]);
        const x = Math.min.apply(null, xs);
        const y = Math.min.apply(null, ys);
        const w = Math.max.apply(null, xs) - x;
        const h = Math.max.apply(null, ys) - y;
        if (w > 0.5 && h > 0.5) out.push({ x, y, w, h });
      }
    }
    return out;
  }

  /* User space -> koordinat kanvas (viewport). */
  function pdfPointToCanvas(viewport, x, y) {
    const t = viewport.transform;
    return [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]];
  }

  function pdfRectToCanvas(viewport, box) {
    const a = pdfPointToCanvas(viewport, box.x, box.y + box.h);
    const b = pdfPointToCanvas(viewport, box.x + box.w, box.y);
    return {
      x: Math.min(a[0], b[0]),
      y: Math.min(a[1], b[1]),
      w: Math.abs(b[0] - a[0]),
      h: Math.abs(b[1] - a[1]),
    };
  }

  /* Ambil warna latar di sekeliling kotak (agar teks/gambar yang
     dihapus tidak meninggalkan kotak putih di atas kertas berwarna). */
  function sampleBackground(ctx, rect) {
    try {
      const pts = [
        [rect.x - 2, rect.y - 2], [rect.x + rect.w + 2, rect.y - 2],
        [rect.x - 2, rect.y + rect.h + 2], [rect.x + rect.w + 2, rect.y + rect.h + 2],
        [rect.x + rect.w / 2, rect.y - 2], [rect.x + rect.w / 2, rect.y + rect.h + 2],
        [rect.x - 2, rect.y + rect.h / 2], [rect.x + rect.w + 2, rect.y + rect.h / 2],
      ];
      const tally = new Map();
      for (const [px, py] of pts) {
        const x = Math.round(px);
        const y = Math.round(py);
        if (x < 0 || y < 0 || x >= ctx.canvas.width || y >= ctx.canvas.height) continue;
        const d = ctx.getImageData(x, y, 1, 1).data;
        const key = `${d[0]},${d[1]},${d[2]}`;
        tally.set(key, (tally.get(key) || 0) + 1);
      }
      let best = null;
      let bestN = 0;
      for (const [k, n] of tally) {
        if (n > bestN) { bestN = n; best = k; }
      }
      if (!best) return "#ffffff";
      const [r, g, b] = best.split(",").map(Number);
      return `rgb(${r},${g},${b})`;
    } catch (_) {
      return "#ffffff";
    }
  }

  function loadImageEl(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Gambar tidak bisa dibaca."));
      img.src = src;
    });
  }

  /* Terapkan daftar edit ke kanvas halaman yang sudah dirender.
     Edit: { k: "erase" | "text" | "image", box, ... }
     - "image" dengan "src"   : gambar dari berkas (sisipkan/ganti)
     - "image" dengan "copyFrom": salin piksel gambar lama dari halaman
                                 (dipakai untuk menggeser/mengubah ukuran) */
  async function applyEdits(ctx2d, viewport, ops) {
    const scale = viewport.scale || 1;
    /* Tahap 1: salin sumber gambar SEBELUM area asal ditutup. */
    const copies = new Map();
    for (const op of ops || []) {
      if (!op || op.k !== "image" || !op.copyFrom) continue;
      const s = pdfRectToCanvas(viewport, op.copyFrom);
      try {
        const off = document.createElement("canvas");
        off.width = Math.max(1, Math.round(s.w));
        off.height = Math.max(1, Math.round(s.h));
        off.getContext("2d").drawImage(
          ctx2d.canvas, s.x, s.y, s.w, s.h, 0, 0, off.width, off.height);
        copies.set(op.id, off);
      } catch (_) {
        /* gagal menyalin: area asal tetap tertutup */
      }
    }

    /* Tahap 2: terapkan operasi. */
    for (const op of ops || []) {
      if (!op || !op.box) continue;
      const r = pdfRectToCanvas(viewport, op.box);
      if (op.k === "erase" || op.k === "text" || op.k === "image") {
        ctx2d.save();
        ctx2d.fillStyle = sampleBackground(ctx2d, r);
        ctx2d.fillRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
        /* gambar yang digeser/diubah ukuran: area aslinya ikut ditutup */
        if (op.copyFrom) {
          const c0 = pdfRectToCanvas(viewport, op.copyFrom);
          ctx2d.fillStyle = sampleBackground(ctx2d, c0);
          ctx2d.fillRect(c0.x - 1, c0.y - 1, c0.w + 2, c0.h + 2);
        }
        ctx2d.restore();
      }
      if (op.k === "text") {
        ctx2d.save();
        ctx2d.fillStyle = op.color || "#111111";
        ctx2d.textBaseline = "alphabetic";
        const align = op.align || "left";
        ctx2d.textAlign = align === "center" ? "center" : align === "right" ? "right" : "left";
        const sizePx = (op.size || 12) * scale;
        ctx2d.font = `${op.bold ? "bold " : ""}${op.italic ? "italic " : ""}${sizePx}px ${fontCss(op.font)}`;
        const anchorX = align === "center" ? op.box.x + op.box.w / 2
          : align === "right" ? op.box.x + op.box.w : op.box.x;
        const baseY = op.by != null ? op.by : op.box.y + op.box.h * TEXT_ASCENT;
        const p = pdfPointToCanvas(viewport, anchorX, baseY);
        ctx2d.fillText(op.text || "", p[0], p[1]);
        ctx2d.restore();
      }
      if (op.k === "image") {
        if (op.src) {
          try {
            const img = await loadImageEl(op.src);
            ctx2d.drawImage(img, r.x, r.y, r.w, r.h);
          } catch (_) {
            /* gambar gagal dimuat: kotak asal tetap tertutup */
          }
        } else if (copies.has(op.id)) {
          ctx2d.drawImage(copies.get(op.id), r.x, r.y, r.w, r.h);
        }
      }
    }
  }

  window.PDFToolsCore = {
    L, PDFDocument, PDFName, PDFNumber, PDFArray, PDFString, PDFHexString, PDFRef,
    PDFRawStream, PDFBool, PDFDict, PDFInvalidObject,
    rgb, degrees, StandardFonts,
    registry, register, tick,
    fmtSize, baseName, safeName, looksLikePdf,
    loadDoc, saveDoc, pdfjsTask, openPdfjs, renderPage, canvasToBytes,
    extractText, pageText, decodeImage, makeZip,
    FONT_LIST, fontCss, mulMat, applyMat,
    pageTextBoxes, pageImageBoxes, pdfPointToCanvas, pdfRectToCanvas,
    sampleBackground, loadImageEl, applyEdits,
    fontFor, drawTextSafe, getFont,
    MM, A4, LETTER, pageSizeName, compactBytes, parseColor,
  };
})();
