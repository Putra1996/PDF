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

  /* Preset gaya teks ala Word: satu klik mengatur font, ukuran,
     tebal/miring, warna, dan perataan sekaligus. */
  const TEXT_STYLES = [
    { id: "normal", label: "Normal", font: "helvetica", size: 12, bold: false, italic: false, color: "#111111", align: "left", underline: false, strike: false, lineHeight: 1.2, letterSpacing: 0 },
    { id: "title", label: "Judul Besar", font: "helvetica", size: 30, bold: true, italic: false, color: "#0f172a", align: "left", underline: false, strike: false, lineHeight: 1.15, letterSpacing: 0 },
    { id: "h1", label: "Judul 1", font: "helvetica", size: 22, bold: true, italic: false, color: "#0f172a", align: "left", underline: false, strike: false, lineHeight: 1.2, letterSpacing: 0 },
    { id: "h2", label: "Judul 2", font: "helvetica", size: 17, bold: true, italic: false, color: "#1f2937", align: "left", underline: false, strike: false, lineHeight: 1.25, letterSpacing: 0 },
    { id: "subtitle", label: "Subjudul", font: "helvetica", size: 14, bold: false, italic: false, color: "#475569", align: "left", underline: false, strike: false, lineHeight: 1.3, letterSpacing: 0.3 },
    { id: "quote", label: "Kutipan", font: "georgia", size: 13, bold: false, italic: true, color: "#4b5563", align: "left", underline: false, strike: false, lineHeight: 1.35, letterSpacing: 0 },
    { id: "caption", label: "Keterangan", font: "helvetica", size: 9, bold: false, italic: true, color: "#6b7280", align: "left", underline: false, strike: false, lineHeight: 1.25, letterSpacing: 0.2 },
    { id: "code", label: "Kode", font: "courier", size: 11, bold: false, italic: false, color: "#111827", align: "left", underline: false, strike: false, lineHeight: 1.25, letterSpacing: 0 },
  ];

  function textStyle(id) {
    return TEXT_STYLES.find((x) => x.id === id) || null;
  }

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

  /* Bungkus teks ke beberapa baris sesuai lebar kotak (ala Word). */
  function wrapText(ctx2d, text, maxW) {
    const out = [];
    for (const para of String(text == null ? "" : text).split(/\r?\n/)) {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) { out.push(""); continue; }
      let cur = "";
      for (const w of words) {
        const t = cur ? cur + " " + w : w;
        if (maxW > 0 && cur && ctx2d.measureText(t).width > maxW) {
          out.push(cur);
          cur = w;
        } else {
          cur = t;
        }
      }
      if (cur) out.push(cur);
    }
    return out.length ? out : [""];
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
        const size = op.size || 12;
        const sizePx = size * scale;
        ctx2d.font = `${op.bold ? "bold " : ""}${op.italic ? "italic " : ""}${sizePx}px ${fontCss(op.font)}`;
        if (op.letterSpacing) {
          try { ctx2d.letterSpacing = (op.letterSpacing * scale) + "px"; } catch (_) { /* diabaikan */ }
        }
        const anchorX = align === "center" ? op.box.x + op.box.w / 2
          : align === "right" ? op.box.x + op.box.w : op.box.x;
        const baseY = op.by != null ? op.by : op.box.y + op.box.h * TEXT_ASCENT;
        /* tinggi baris dalam satuan PDF (titik) */
        const stepPt = size * (op.lineHeight || 1.2);
        const maxW = Math.max(0, (op.box.w || 0) * scale);
        const lines = wrapText(ctx2d, op.text || "", maxW);
        const thin = Math.max(1, sizePx * 0.055);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line) continue;
          const p = pdfPointToCanvas(viewport, anchorX, baseY - i * stepPt);
          ctx2d.fillText(line, p[0], p[1]);
          /* garis bawah & coret digambar manual supaya konsisten
             di semua peramban (textDecoration tidak selalu ada). */
          if (!op.underline && !op.strike) continue;
          const wLine = ctx2d.measureText(line).width;
          let x0 = p[0];
          if (align === "center") x0 = p[0] - wLine / 2;
          else if (align === "right") x0 = p[0] - wLine;
          ctx2d.strokeStyle = op.color || "#111111";
          ctx2d.lineWidth = thin;
          ctx2d.beginPath();
          if (op.underline) {
            const y = p[1] + sizePx * 0.13;
            ctx2d.moveTo(x0, y);
            ctx2d.lineTo(x0 + wLine, y);
          }
          if (op.strike) {
            const y = p[1] - sizePx * 0.28;
            ctx2d.moveTo(x0, y);
            ctx2d.lineTo(x0 + wLine, y);
          }
          ctx2d.stroke();
        }
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


  /* ============================================================
     Pembuat DOCX (Word) — dipakai ekspor langsung dari editor.
     Isi:
       - paragraf teks dengan gaya (tebal, miring, garis bawah,
         coret, ukuran, warna, perataan)
       - gambar sebaris (PNG/JPEG) yang disisipkan ke dalam dokumen
     Struktur items per halaman:
       { type:"text",  text, bold, italic, underline, strike, size, color, align }
       { type:"image", dataUrl, w, h }        (w/h dalam pt)
     ============================================================ */
  const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  function xmlEsc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }

  function dataUrlToBytes(dataUrl) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(dataUrl || ""));
    if (!m) return null;
    const mime = m[1] || "image/png";
    const isB64 = !!m[2];
    const payload = m[3] || "";
    if (!isB64) return null;
    const bin = atob(payload);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return { bytes: out, ext: /jpe?g/.test(mime) ? "jpeg" : "png", mime };
  }

  function hexColor(c, fallback) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(c || ""));
    return m ? m[1].toUpperCase() : fallback;
  }

  async function buildDocx(title, pages) {
    const zip = new JSZip();
    const media = [];
    let relId = 10;
    const rels = [];
    const body = [];

    const pageXml = [];
    for (const pg of pages || []) {
      const one = [];
      for (const it of (pg && pg.items) || []) {
        if (!it) continue;
        if (it.type === "image") {
          const img = dataUrlToBytes(it.dataUrl);
          if (!img) continue;
          const name = `image${media.length + 1}.${img.ext}`;
          zip.file("word/media/" + name, img.bytes);
          media.push(name);
          const rid = "rId" + (relId++);
          rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`);
          const cx = Math.round(Math.max(1, it.w || 100) * 12700);
          const cy = Math.round(Math.max(1, it.h || 100) * 12700);
          one.push(`<w:p><w:pPr><w:jc w:val="${it.align === "center" ? "center" : it.align === "right" ? "right" : "left"}"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${media.length}" name="Gambar ${media.length}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${media.length}" name="Gambar ${media.length}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`);
          continue;
        }
        const txt = String(it.text == null ? "" : it.text);
        if (!txt.trim()) continue;
        const halfPt = Math.max(2, Math.round((it.size || 12) * 2));
        const rpr = `<w:rPr>${it.bold ? "<w:b/>" : ""}${it.italic ? "<w:i/>" : ""}${it.underline ? '<w:u w:val="single"/>' : ""}${it.strike ? "<w:strike/>" : ""}<w:color w:val="${hexColor(it.color, "111111")}"/><w:sz w:val="${halfPt}"/><w:szCs w:val="${halfPt}"/></w:rPr>`;
        const jc = it.align === "center" ? "center" : it.align === "right" ? "right" : "left";
        one.push(`<w:p><w:pPr><w:jc w:val="${jc}"/></w:pPr><w:r>${rpr}<w:t xml:space="preserve">${xmlEsc(txt)}</w:t></w:r></w:p>`);
      }
      pageXml.push({ xml: one, breakBefore: !!(pg && pg.breakBefore) });
    }
    for (let i = 0; i < pageXml.length; i++) {
      if (i > 0 || pageXml[i].breakBefore) {
        body.push(`<w:p><w:r><w:br w:type="page"/></w:r></w:p>`);
      }
      body.push.apply(body, pageXml[i].xml);
    }

    zip.file("[Content_Types].xml", XML_HEAD + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Default Extension="jpeg" ContentType="image/jpeg"/>
<Default Extension="jpg" ContentType="image/jpeg"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`);
    zip.file("_rels/.rels", XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`);
    zip.file("word/_rels/document.xml.rels", XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
${rels.join("\n")}
</Relationships>`);
    zip.file("word/document.xml", XML_HEAD + `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`);
    zip.file("word/styles.xml", XML_HEAD + `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
</w:styles>`);
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    zip.file("docProps/core.xml", XML_HEAD + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc(title)}</dc:title><dc:creator>Pemisah PDF</dc:creator><cp:lastModifiedBy>Pemisah PDF</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
    zip.file("docProps/app.xml", XML_HEAD + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Pemisah PDF</Application></Properties>`);
    return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  }

/* ============================================================
   Tambahan tool-core.js (bagian 1): font aproksimasi + ekspor
   vektor. Sisipkan sebelum blok "window.PDFToolsCore = {".
   ============================================================ */

  /* Petakan nama font internal pdf.js ke font yang paling dekat
     (dipakai saat teks yang sudah ada digeser supaya tetap mirip). */
  function approxFont(fontName) {
    const n = String(fontName || "").toLowerCase();
    if (!n) return "helvetica";
    if (/times|serif|roman|georgia|garamond|minion|book/.test(n)) return "times";
    if (/courier|mono|consol/.test(n)) return "courier";
    if (/comic|hand|script|cursive/.test(n)) return "comic";
    if (/impact|black|heavy/.test(n)) return "impact";
    if (/trebuchet|verdana|tahoma|arial|helvetica|sans/.test(n)) return "helvetica";
    return "helvetica";
  }

  /* Font standar pdf-lib untuk setiap gaya teks. */
  function stdFontName(fontId, bold, italic) {
    const serif = fontId === "times" || fontId === "georgia";
    const mono = fontId === "courier";
    const sans = !serif && !mono;
    if (mono) {
      if (bold && italic) return "CourierBoldOblique";
      if (bold) return "CourierBold";
      if (italic) return "CourierOblique";
      return "Courier";
    }
    if (serif) {
      if (bold && italic) return "TimesRomanBoldItalic";
      if (bold) return "TimesRomanBold";
      if (italic) return "TimesRomanItalic";
      return "TimesRoman";
    }
    if (bold && italic) return "HelveticaBoldOblique";
    if (bold) return "HelveticaBold";
    if (italic) return "HelveticaOblique";
    return "Helvetica";
  }

  /* Gambar garis bawah & coret sebagai garis tipis. */
  function drawDecoration(page, x0, x1, y, width, color) {
    try {
      page.drawLine({
        start: { x: x0, y },
        end: { x: x1, y },
        thickness: width,
        color,
      });
    } catch (_) {
      /* abaikan */
    }
  }

  /* Terapkan operasi edit sebagai vektor di atas halaman asli.
     - teks digambar dengan font standar (tetap bisa dicari & tajam)
     - teks yang dihapus ditutup dengan persegi sesuai warna latar
     - gambar disisipkan dari berkas (src) atau potongan render (crop)
     opts:
       { cropBytes: async (op) => Uint8Array|null }
     */
  async function applyVectorEdits(page, ops, opts) {
    const o = opts || {};
    const doc = page.doc;
    const fontCache = new Map();
    const asyncFont = async (name) => {
      if (!fontCache.has(name)) fontCache.set(name, await doc.embedFont(StandardFonts[name]));
      return fontCache.get(name);
    };
    let applied = 0;
    for (const op of ops || []) {
      if (!op || !op.box) continue;
      const box = op.box;
      if (op.k === "erase") {
        /* Tutup teks lama dengan persegi. Warnanya diambil dari
           latar sekitar (kalau tersedia) supaya hasil ekspansi
           tidak terlihat berbeda dari aslinya. */
        const bg = o.bgFor ? o.bgFor(op) : null;
        try {
          page.drawRectangle({
            x: box.x - 1, y: box.y - 1, width: box.w + 2, height: box.h + 2,
            color: bg ? parseColor(bg, rgb(1, 1, 1)) : rgb(1, 1, 1),
            borderWidth: 0,
          });
          applied++;
        } catch (_) { /* abaikan */ }
        continue;
      }
      if (op.k === "text") {
        const size = op.size || 12;
        const font = await asyncFont(stdFontName(op.font, op.bold, op.italic));
        const color = parseColor(op.color, rgb(0.07, 0.07, 0.07));
        const step = size * (op.lineHeight || 1.2);
        const lines = wrapTextPdf(font, op.text || "", box.w, size);
        const align = op.align || "left";
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line) continue;
          let w = 0;
          try { w = font.widthOfTextAtSize(line, size); } catch (_) { w = 0; }
          let x = box.x;
          if (align === "center") x = box.x + (box.w - w) / 2;
          else if (align === "right") x = box.x + box.w - w;
          const baseY = op.by != null ? op.by : box.y + box.h * TEXT_ASCENT;
          const y = baseY - i * step - size * 0.22;
          try {
            page.drawText(line, { x, y, size, font, color });
            applied++;
          } catch (_) {
            /* karakter di luar jangkauan font */
          }
          if (op.underline) {
            drawDecoration(page, x, x + w, y + size * 0.12, Math.max(0.5, size * 0.05), color);
          }
          if (op.strike) {
            drawDecoration(page, x, x + w, y + size * 0.3, Math.max(0.5, size * 0.05), color);
          }
        }
        continue;
      }
      if (op.k === "image") {
        /* gambar yang digeser/diubah ukuran: area asal ikut ditutup
           supaya gambar lama tidak tertinggal di halaman. */
        if (op.copyFrom) {
          const bg = o.bgFor ? o.bgFor(op) : null;
          try {
            page.drawRectangle({
              x: op.copyFrom.x - 1, y: op.copyFrom.y - 1,
              width: op.copyFrom.w + 2, height: op.copyFrom.h + 2,
              color: bg ? parseColor(bg, rgb(1, 1, 1)) : rgb(1, 1, 1),
              borderWidth: 0,
            });
          } catch (_) { /* abaikan */ }
        }
        let bytes = null;
        try {
          if (op.src && /^data:image\//.test(op.src)) {
            const m = /^data:image\/(png|jpe?g);base64,(.*)$/s.exec(op.src);
            if (m) {
              const bin = atob(m[2]);
              bytes = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            }
          } else if (typeof o.cropBytes === "function") {
            bytes = await o.cropBytes(op);
          }
        } catch (_) {
          bytes = null;
        }
        if (!bytes || !bytes.length) continue;
        try {
          const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
          const img = isJpg ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
          page.drawImage(img, { x: box.x, y: box.y, width: box.w, height: box.h });
          applied++;
        } catch (_) {
          /* gambar gagal disisipkan */
        }
      }
    }
    return applied;
  }

  /* Bungkus teks dengan font pdf-lib (mengukur lebar sebenarnya). */
  function wrapTextPdf(font, text, maxW, size) {
    const out = [];
    for (const para of String(text == null ? "" : text).split(/\r?\n/)) {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) { out.push(""); continue; }
      let cur = "";
      for (const w of words) {
        const t = cur ? cur + " " + w : w;
        let width = 0;
        try { width = font.widthOfTextAtSize(t, size); } catch (_) { width = 0; }
        if (maxW > 0 && cur && width > maxW) {
          out.push(cur);
          cur = w;
        } else {
          cur = t;
        }
      }
      if (cur) out.push(cur);
    }
    return out.length ? out : [""];
  }

/* ============================================================
   Tambahan tool-core.js (bagian 2): pembuat XLSX & PPTX untuk
   ekspor langsung dari editor.
   ============================================================ */

  function colNameX(n) {
    let s = "";
    n += 1;
    while (n > 0) {
      const rem = (n - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  /* sheets: [{ name, rows: [[cell, ...], ...] }] */
  async function buildXlsx(title, sheets) {
    const zip = new JSZip();
    const list = sheets && sheets.length ? sheets : [{ name: "Sheet1", rows: [] }];
    const n = list.length;
    zip.file("[Content_Types].xml", XML_HEAD + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${Array.from({ length: n }, (_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n")}
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`);
    zip.file("_rels/.rels", XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`);
    zip.file("xl/workbook.xml", XML_HEAD + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${list.map((s, i) => `<sheet name="${xmlEsc((s.name || "Sheet" + (i + 1)).slice(0, 28))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`);
    zip.file("xl/_rels/workbook.xml.rels", XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`);
    list.forEach((s, si) => {
      const rows = (s.rows || []).map((r, ri) => {
        const cells = r.map((v, ci) => `<c r="${colNameX(ci)}${ri + 1}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`).join("");
        return `<row r="${ri + 1}">${cells}</row>`;
      }).join("");
      zip.file(`xl/worksheets/sheet${si + 1}.xml`, XML_HEAD + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`);
    });
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    zip.file("docProps/core.xml", XML_HEAD + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc(title)}</dc:title><dc:creator>Pemisah PDF</dc:creator><cp:lastModifiedBy>Pemisah PDF</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
    zip.file("docProps/app.xml", XML_HEAD + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Pemisah PDF</Application></Properties>`);
    return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  }

  const PPTX_THEME_MIN = XML_HEAD + `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Sederhana"><a:themeElements><a:clrScheme name="Sederhana"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2><a:accent1><a:srgbClr val="2563EB"/></a:accent1><a:accent2><a:srgbClr val="059669"/></a:accent2><a:accent3><a:srgbClr val="D97706"/></a:accent3><a:accent4><a:srgbClr val="DC2626"/></a:accent4><a:accent5><a:srgbClr val="7C3AED"/></a:accent5><a:accent6><a:srgbClr val="0891B2"/></a:accent6><a:hlink><a:srgbClr val="0561C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Sederhana"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Sederhana"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

  const PPTX_EMPTY_TREE = `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`;

  /* slides: [{ wPt, hPt, items: [...] }]
     item teks : { type:"text", text, x, y, w, h, size, bold, italic, color, align }
     item gambar: { type:"image", dataUrl, x, y, w, h }   (koordinat PDF, titik) */
  async function buildPptx(title, slides) {
    const zip = new JSZip();
    const list = slides && slides.length ? slides : [{ wPt: 595, hPt: 842, items: [] }];
    const n = list.length;
    const media = [];
    const rels = [];

    zip.file("[Content_Types].xml", XML_HEAD + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Default Extension="jpeg" ContentType="image/jpeg"/>
<Default Extension="jpg" ContentType="image/jpeg"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
${Array.from({ length: n }, (_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("\n")}
</Types>`);
    zip.file("_rels/.rels", XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);

    const first = list[0];
    const cx = Math.round((first.wPt || 595) * 12700);
    const cy = Math.round((first.hPt || 842) * 12700);
    zip.file("ppt/presentation.xml", XML_HEAD + `<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${list.map((s, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join("")}</p:sldIdLst><p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
    zip.file("ppt/_rels/presentation.xml.rels", XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="ppt/slideMasters/slideMaster1.xml"/>${list.map((s, i) => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join("")}</Relationships>`);
    zip.file("ppt/slideMasters/slideMaster1.xml", XML_HEAD + `<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>${PPTX_EMPTY_TREE}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="214748649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`);
    zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`);
    zip.file("ppt/slideLayouts/slideLayout1.xml", XML_HEAD + `<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Kosong"><p:spTree>${PPTX_EMPTY_TREE}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
    zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`);
    zip.file("ppt/theme/theme1.xml", PPTX_THEME_MIN);

    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const hPt = s.hPt || 842;
      const shapes = [];
      const slideRels = [];
      let rid = 2;
      for (const it of s.items || []) {
        if (!it) continue;
        if (it.type === "image") {
          const img = dataUrlToBytes(it.dataUrl);
          if (!img) continue;
          const name = `image${media.length + 1}.${img.ext}`;
          zip.file("ppt/media/" + name, img.bytes);
          media.push(name);
          const r = "rId" + (rid++);
          slideRels.push(`<Relationship Id="${r}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${name}"/>`);
          const x = Math.round((it.x || 0) * 12700);
          const yTop = Math.round((hPt - ((it.y || 0) + (it.h || 0))) * 12700);
          const w = Math.round(Math.max(1, it.w || 100) * 12700);
          const h = Math.round(Math.max(1, it.h || 100) * 12700);
          shapes.push(`<p:pic><p:nvPicPr><p:cNvPr id="${shapes.length + 2}" name="Gambar ${shapes.length + 2}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${r}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${x}" y="${yTop}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`);
          continue;
        }
        const txt = String(it.text == null ? "" : it.text);
        if (!txt.trim()) continue;
        const size = it.size || 12;
        const x = Math.round((it.x || 0) * 12700);
        const yTop = Math.round((hPt - ((it.y || 0) + (it.h || 0))) * 12700);
        const w = Math.round(Math.max(1, it.w || 100) * 12700);
        const h = Math.round(Math.max(1, it.h || 12) * 12700);
        const align = it.align === "center" ? "ctr" : it.align === "right" ? "r" : "l";
        const rpr = ` lang="id-ID" sz="${Math.round(size * 100)}"${it.bold ? ' b="1"' : ""}${it.italic ? ' i="1"' : ""}${it.underline ? ' u="sng"' : ""}${it.strike ? ' strike="sngStrike"' : ""} dirty="0"`;
        const fill = it.color ? `<a:solidFill><a:srgbClr val="${hexColor(it.color, "111111")}"/></a:solidFill>` : "";
        const paras = txt.split(/\r?\n/).map((ln) => `<a:p><a:pPr algn="${align}"/><a:r><a:rPr${rpr}>${fill}<a:latin typeface="Arial"/></a:rPr><a:t>${xmlEsc(ln)}</a:t></a:r></a:p>`).join("");
        shapes.push(`<p:sp><p:nvSpPr><p:cNvPr id="${shapes.length + 2}" name="Teks ${shapes.length + 2}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${yTop}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t"/><a:lstStyle/>${paras}</p:txBody></p:sp>`);
      }
      zip.file(`ppt/slides/slide${i + 1}.xml`, XML_HEAD + `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>${PPTX_EMPTY_TREE}${shapes.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
      zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>${slideRels.join("")}</Relationships>`);
    }
    return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  }

  window.PDFToolsCore = {
    L, PDFDocument, PDFName, PDFNumber, PDFArray, PDFString, PDFHexString, PDFRef,
    PDFRawStream, PDFBool, PDFDict, PDFInvalidObject,
    rgb, degrees, StandardFonts,
    registry, register, tick,
    fmtSize, baseName, safeName, looksLikePdf,
    loadDoc, saveDoc, pdfjsTask, openPdfjs, renderPage, canvasToBytes,
    extractText, pageText, decodeImage, makeZip,
    FONT_LIST, fontCss, mulMat, applyMat, wrapText,
    TEXT_STYLES, textStyle, buildDocx, buildXlsx, buildPptx,
    approxFont, stdFontName, applyVectorEdits, wrapTextPdf,
    pageTextBoxes, pageImageBoxes, pdfPointToCanvas, pdfRectToCanvas,
    sampleBackground, loadImageEl, applyEdits,
    fontFor, drawTextSafe, getFont,
    MM, A4, LETTER, pageSizeName, compactBytes, parseColor,
  };
})();
