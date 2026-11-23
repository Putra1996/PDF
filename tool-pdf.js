/* ============================================================
   Alat PDF: putar, nomor halaman, watermark, potong,
   anotasi, formulir, rapikan, PDF/A.
   ============================================================ */
(function () {
  "use strict";

  const C = window.PDFToolsCore;
  const {
    PDFDocument, PDFName, PDFNumber, PDFArray, PDFString, PDFHexString,
    rgb, degrees, register, tick, MM, loadDoc, saveDoc, openPdfjs, renderPage,
    canvasToBytes, extractText, pageText, fontFor, drawTextSafe, parseColor,
  } = C;

  /* ============================================================
     1. Putar PDF
     ============================================================ */
  register({
    id: "rotate",
    cat: "edit",
    name: "Putar PDF",
    desc: "Putar halaman 90°, 180°, atau 270° — searah atau berlawanan jarum jam.",
    icon: "rotate",
    accept: ".pdf,application/pdf",
    multiple: true,
    fields: [
      { type: "select", id: "angle", label: "Sudut putar", value: "90", options: [["90", "90°"], ["180", "180°"], ["270", "270°"]] },
      { type: "select", id: "dir", label: "Arah", value: "cw", options: [["cw", "Searah jarum jam"], ["ccw", "Berlawanan jarum jam"]] },
      { type: "select", id: "scope", label: "Halaman", value: "all", options: [["all", "Semua halaman"], ["odd", "Halaman ganjil"], ["even", "Halaman genap"]] },
    ],
    async run(ctx) {
      const { files, opts } = ctx;
      const out = [];
      for (const f of files) {
        const doc = await loadDoc(f.bytes);
        const pages = doc.getPages();
        let n = 0;
        for (let i = 0; i < pages.length; i++) {
          const odd = (i + 1) % 2 === 1;
          if (opts.scope === "odd" && !odd) continue;
          if (opts.scope === "even" && odd) continue;
          const cur = pages[i].getRotation().angle || 0;
          const delta = opts.dir === "ccw" ? -(Number(opts.angle) || 90) : Number(opts.angle) || 90;
          pages[i].setRotation(degrees((((cur + delta) % 360) + 360) % 360));
          n++;
        }
        const bytes = await saveDoc(doc);
        out.push({ name: C.safeName(C.baseName(f.name)) + "-putar.pdf", bytes });
        ctx.progress(null, `${f.name}: ${n} halaman diputar`);
        await tick();
      }
      return out;
    },
  });

  /* ============================================================
     2. Nomor halaman
     ============================================================ */
  const NUM_POS = {
    "bottom-center": (w, h) => [w / 2, 28],
    "bottom-right": (w, h) => [w - 40, 28],
    "bottom-left": (w, h) => [40, 28],
    "top-center": (w, h) => [w / 2, h - 40],
    "top-right": (w, h) => [w - 40, h - 40],
    "top-left": (w, h) => [40, h - 40],
  };

  register({
    id: "numbers",
    cat: "edit",
    name: "Tambah nomor halaman",
    desc: "Beri nomor pada setiap halaman — posisi, format, dan halaman mulai bisa diatur.",
    icon: "numbers",
    accept: ".pdf,application/pdf",
    multiple: true,
    fields: [
      { type: "select", id: "pos", label: "Posisi", value: "bottom-center", options: Object.keys(NUM_POS).map((k) => [k, k.replace("bottom", "bawah").replace("top", "atas").replace("center", "tengah").replace("right", "kanan").replace("left", "kiri")]) },
      { type: "select", id: "fmt", label: "Format", value: "n-total", options: [["n", "1"], ["n-total", "1 / 5"], ["page-n-total", "Halaman 1 dari 5"], ["dash-n", "- 1 -"]] },
      { type: "number", id: "start", label: "Mulai dari", value: 1, min: 0, max: 9999 },
      { type: "check", id: "skipFirst", label: "Lewati halaman pertama", value: false },
      { type: "number", id: "size", label: "Ukuran font (pt)", value: 11, min: 6, max: 48 },
      { type: "color", id: "color", label: "Warna", value: "#333333" },
    ],
    async run(ctx) {
      const { files, opts } = ctx;
      const out = [];
      const color = parseColor(opts.color, rgb(0.2, 0.2, 0.2));
      for (const f of files) {
        const doc = await loadDoc(f.bytes);
        const pages = doc.getPages();
        const total = pages.length;
        const start = Number(opts.start) || 1;
        for (let i = 0; i < total; i++) {
          if (opts.skipFirst && i === 0) continue;
          const n = start + i;
          let label;
          if (opts.fmt === "n-total") label = `${n} / ${total}`;
          else if (opts.fmt === "page-n-total") label = `Halaman ${n} dari ${total}`;
          else if (opts.fmt === "dash-n") label = `- ${n} -`;
          else label = String(n);
          const p = pages[i];
          const { width, height } = p.getSize();
          const pos = (NUM_POS[opts.pos] || NUM_POS["bottom-center"])(width, height);
          const ok = await drawTextSafe(p, label, {
            x: pos[0], y: pos[1], size: Number(opts.size) || 11, color,
            align: opts.pos.endsWith("center") ? "center" : opts.pos.endsWith("right") ? "right" : "left",
          });
          if (!ok) throw new Error("Nomor halaman tidak bisa ditulis (karakter di luar jangkauan font).");
        }
        const bytes = await saveDoc(doc);
        out.push({ name: C.safeName(C.baseName(f.name)) + "-nomor.pdf", bytes });
        await tick();
      }
      return out;
    },
  });

  /* ============================================================
     3. Watermark
     ============================================================ */
  register({
    id: "watermark",
    cat: "edit",
    name: "Tambah watermark",
    desc: "Tempelkan teks atau gambar sebagai watermark — satu-satu atau berulang (tiling).",
    icon: "watermark",
    accept: ".pdf,application/pdf",
    multiple: true,
    fields: [
      { type: "select", id: "mode", label: "Isi watermark", value: "text", options: [["text", "Teks"], ["image", "Gambar (pilih file di bawah)"]] },
      { type: "text", id: "text", label: "Teks watermark", value: "RAHASIA", placeholder: "Contoh: SALinan, DRAF, 2026" },
      { type: "file", id: "image", label: "File gambar (PNG/JPG)", accept: "image/png,image/jpeg" },
      { type: "select", id: "layout", label: "Tata letak", value: "diagonal", options: [["diagonal", "Diagonal (miring 45°)"], ["horizontal", "Mendatar"], ["single", "Satu di tengah halaman"], ["tiled", "Berrepeated (tiling)"]] },
      { type: "range", id: "opacity", label: "Opasitas", value: 20, min: 5, max: 100, step: 5, unit: "%" },
      { type: "range", id: "size", label: "Ukuran teks (pt)", value: 48, min: 8, max: 160, step: 2 },
      { type: "color", id: "color", label: "Warna", value: "#ff0000" },
      { type: "range", id: "tile", label: "Jarak antar watermark (px)", value: 160, min: 40, max: 400, step: 10, visibleIf: { mode: "tiled" } },
    ],
    async run(ctx) {
      const { files, opts } = ctx;
      const color = parseColor(opts.color, rgb(0.85, 0.15, 0.15));
      const alpha = Math.max(0.02, Math.min(1, (Number(opts.opacity) || 20) / 100));
      const out = [];
      let img = null;
      if (opts.mode === "image") {
        if (!opts.image) throw new Error("Pilih file gambar untuk watermark.");
        img = await C.decodeImage(opts.image.bytes, opts.image.type);
      }
      for (const f of files) {
        const doc = await loadDoc(f.bytes);
        const pages = doc.getPages();
        for (const p of pages) {
          const { width, height } = p.getSize();
          const rot = opts.layout === "diagonal" ? degrees(45) : degrees(0);
          const draw = async (x, y, size, txt) => {
            if (opts.mode === "image" && img) {
              const iw = img.width || img.naturalWidth;
              const ih = img.height || img.naturalHeight;
              const k = Math.min(size / iw, size / ih);
              const w = iw * k, h = ih * k;
              const embedded = await doc.embedJpg ? null : null;
              void embedded;
              p.drawImage(img, { x: x - w / 2, y: y - h / 2, width: w, height: h, rotate: rot, opacity: alpha });
            } else {
              const ok = await drawTextSafe(p, txt, {
                x, y, size, color, rotate: rot, opacity: alpha,
                align: "center", font: "HelveticaBold",
              });
              if (!ok) throw new Error("Teks watermark tidak bisa ditulis (karakter di luar jangkauan font).");
            }
          };
          if (opts.layout === "tiled") {
            const gap = Math.max(40, Number(opts.tile) || 160);
            const size = Number(opts.size) || 48;
            const step = gap;
            for (let y = -height; y < height * 2; y += step) {
              for (let x = -width; x < width * 2; x += step) {
                await draw(x, y, size, opts.text || "");
              }
            }
          } else if (opts.layout === "single") {
            await draw(width / 2, height / 2, Number(opts.size) || 48, opts.text || "");
          } else {
            await draw(width / 2, height / 2, Number(opts.size) || 48, opts.text || "");
          }
        }
        const bytes = await saveDoc(doc);
        out.push({ name: C.safeName(C.baseName(f.name)) + "-watermark.pdf", bytes });
        await tick();
      }
      return out;
    },
  });

  /* ============================================================
     4. Potong PDF
     ============================================================ */
  register({
    id: "crop",
    cat: "edit",
    name: "Potong PDF",
    desc: "Potong tepi halaman (margin atas/bawah/kiri/kanan) atau terapkan ukuran standar.",
    icon: "crop",
    accept: ".pdf,application/pdf",
    multiple: true,
    fields: [
      { type: "select", id: "preset", label: "Mode", value: "margin", options: [["margin", "Potong margin"], ["a4", "Jadikan A4"], ["letter", "Jadikan Letter"], ["square", "Buat persegi (A4)"], ["content", "Potong tepi kosong (otomatis)"]] },
      { type: "number", id: "top", label: "Margin atas (mm)", value: 0, min: 0, max: 200 },
      { type: "number", id: "bottom", label: "Margin bawah (mm)", value: 0, min: 0, max: 200 },
      { type: "number", id: "left", label: "Margin kiri (mm)", value: 0, min: 0, max: 200 },
      { type: "number", id: "right", label: "Margin kanan (mm)", value: 0, min: 0, max: 200 },
      { type: "select", id: "scope", label: "Halaman", value: "all", options: [["all", "Semua halaman"]] },
    ],
    async run(ctx) {
      const { files, opts } = ctx;
      const out = [];
      for (const f of files) {
        let doc;
        try {
          doc = await loadDoc(f.bytes);
        } catch (_) {
          throw new Error("PDF tidak bisa dibuka.");
        }
        const pages = doc.getPages();
        for (const p of pages) {
          const { width, height } = p.getSize();
          let x = 0, y = 0, w = width, h = height;
          if (opts.preset === "a4") {
            w = C.A4.w; h = C.A4.h;
            x = (width - w) / 2; y = (height - h) / 2;
          } else if (opts.preset === "letter") {
            w = C.LETTER.w; h = C.LETTER.h;
            x = (width - w) / 2; y = (height - h) / 2;
          } else if (opts.preset === "square") {
            const s = Math.min(C.A4.w, C.A4.h);
            w = s; h = s;
            x = (width - w) / 2; y = (height - h) / 2;
          } else if (opts.preset === "content") {
            const box = await trimBox(f.bytes, pages.indexOf(p) + 1, doc);
            if (box) { x = box.x; y = box.y; w = box.w; h = box.h; }
          } else {
            x = (Number(opts.left) || 0) * MM;
            y = (Number(opts.bottom) || 0) * MM;
            w = width - x - (Number(opts.right) || 0) * MM;
            h = height - y - (Number(opts.top) || 0) * MM;
          }
          if (w < 20 || h < 20) throw new Error("Hasil pemotongan terlalu kecil.");
          p.setCropBox(x, y, w, h);
        }
        const bytes = await saveDoc(doc);
        out.push({ name: C.safeName(C.baseName(f.name)) + "-potong.pdf", bytes });
        await tick();
      }
      return out;
    },
  });

  /* Deteksi tepi kosong otomatis dengan piksel (butuh render). */
  async function trimBox(bytes, pageNo, libDoc) {
    let pdfjs = null;
    try {
      pdfjs = await openPdfjs(bytes);
    } catch (_) {
      return null;
    }
    try {
      const { canvas, ctx, viewport } = await renderPage(pdfjs, pageNo, 1);
      const w = canvas.width, h = canvas.height;
      const data = ctx.getImageData(0, 0, w, h).data;
      let top = h, bottom = -1, left = w, right = -1;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) {
            if (y < top) top = y;
            if (y > bottom) bottom = y;
            if (x < left) left = x;
            if (x > right) right = x;
          }
        }
      }
      canvas.width = canvas.height = 0;
      if (bottom < 0 || top >= h) return null;
      const sx = viewport.width / w, sy = viewport.height / h;
      const pad = 2;
      const x = Math.max(0, left * sx - pad);
      const y = Math.max(0, (h - 1 - bottom) * sy - pad);
      const cw = Math.min(viewport.width - x, (right - left + 1) * sx + pad * 2);
      const ch = Math.min(viewport.height - y, (bottom - top + 1) * sy + pad * 2);
      void libDoc;
      return { x, y, w: cw, h: ch };
    } catch (_) {
      return null;
    } finally {
      try { if (pdfjs) await pdfjs.destroy(); } catch (_) {}
    }
  }

  /* ============================================================
     5. Edit PDF visual (seperti Word)
     ------------------------------------------------------------
     Panel visual (tool-editor.js) menulis daftar operasi per
     halaman: ubah font/warna/ukuran teks, sisipkan teks, sisipkan
     gambar, ganti gambar, dan hapus teks/gambar.

     Halaman yang benar-benar diubah dirender ulang menjadi gambar
     (pola yang sama dengan tool Redaksi), sedangkan halaman lain
     disalin apa adanya sehingga teksnya tetap bisa dicari.
     ============================================================ */
  register({
    id: "edit",
    cat: "edit",
    name: "Edit PDF",
    desc: "Ubah font teks, sisipkan atau ganti gambar, dan hapus teks/gambar — seperti mengedit di Word.",
    icon: "edit",
    accept: ".pdf,application/pdf",
    multiple: false,
    custom: "editor",
    fields: [
      { type: "number", id: "dpi", label: "Resolusi render halaman yang diedit (DPI)", value: 200, min: 96, max: 400 },
      { type: "check", id: "removeAnnots", label: "Hapus anotasi yang sudah ada di PDF", value: false },
    ],
    async run(ctx) {
      const f = ctx.files[0];
      if (!f) throw new Error("Pilih satu PDF untuk diedit.");
      const edits = (ctx.opts && ctx.opts.edits) || {};
      const pageKeys = Object.keys(edits).filter((k) => (edits[k] || []).length);
      const dpi = Math.min(400, Math.max(96, Number(ctx.opts.dpi) || 200));

      const src = await loadDoc(f.bytes);
      const srcPages = src.getPages();
      const pdfjs = await openPdfjs(f.bytes);
      const dst = await PDFDocument.create();
      let raster = 0;

      for (let i = 0; i < srcPages.length; i++) {
        const n = i + 1;
        const ops = edits[String(n)] || [];
        const needRaster = ops.length > 0;
        if (!needRaster) {
          /* halaman tidak disentuh: salin vektor (teks tetap bisa dicari) */
          const [copied] = await dst.copyPages(src, [i]);
          dst.addPage(copied);
          if (ctx.opts.removeAnnots) {
            dst.getPage(dst.getPageCount() - 1).node.delete(PDFName.of("Annots"));
          }
          continue;
        }
        ctx.progress(null, `Merender halaman ${n} dari ${srcPages.length}…`);
        const scale = dpi / 72;
        const { canvas, ctx: c2, viewport } = await renderPage(pdfjs, n, scale);
        await C.applyEdits(c2, viewport, ops);
        const jpg = await canvasToBytes(canvas, "image/jpeg", 0.92);
        canvas.width = canvas.height = 0;
        const img = await dst.embedJpg(jpg);
        const w = viewport.width / scale;
        const h = viewport.height / scale;
        const p = dst.addPage([w, h]);
        p.drawImage(img, { x: 0, y: 0, width: w, height: h });
        raster++;
        await tick();
      }
      try { await pdfjs.destroy(); } catch (_) {}
      const bytes = await saveDoc(dst);
      const note = raster
        ? `${raster} halaman diedit (dirender ulang), sisanya tetap vektor`
        : "Tidak ada perubahan — PDF disalin apa adanya";
      return [{
        name: C.safeName(C.baseName(f.name)) + "-edit.pdf",
        bytes,
        note,
      }];
    },
  });

  /* ============================================================
     6. Formulir PDF (AcroForm)
     ============================================================ */
  register({
    id: "forms",
    cat: "edit",
    name: "Formulir PDF",
    desc: "Isi field formulir (teks, centang, pilihan) lalu simpan. Isian bisa dikunci.",
    icon: "forms",
    accept: ".pdf,application/pdf",
    multiple: true,
    custom: "forms",
    fields: [
      { type: "check", id: "lock", label: "Kunci isian (flatten — isian tidak bisa diubah lagi)", value: false },
    ],
    /* Daftar field yang ditemukan — dipakai UI. */
    async inspect(f) {
      const doc = await loadDoc(f.bytes);
      const form = doc.getForm();
      const fields = form.getFields().map((fld) => {
        const name = fld.getName();
        let type = "text";
        if (typeof fld.check === "function" && typeof fld.select === "function") type = "checkbox";
        else if (typeof fld.select === "function" && typeof fld.getOptions === "function") type = "dropdown";
        else if (typeof fld.select === "function") type = "radio";
        else if (typeof fld.isMultiline === "function" && fld.isMultiline()) type = "multiline";
        const item = { name, type, value: "" };
        try {
          if (type === "checkbox") item.value = fld.isChecked() ? "Ya" : "";
          else if (type === "text" || type === "multiline") item.value = fld.getText() || "";
          else if (type === "dropdown" || type === "radio") {
            const opts = fld.getOptions ? fld.getOptions() : [];
            item.options = opts;
            item.value = fld.getSelected ? fld.getSelected() || "" : "";
          }
        } catch (_) { /* abaikan */ }
        return item;
      });
      return { fields, hasForm: fields.length > 0 };
    },
    async run(ctx) {
      const { files, opts } = ctx;
      const out = [];
      const values = opts.values || {};
      for (const f of files) {
        const doc = await loadDoc(f.bytes);
        let form;
        try {
          form = doc.getForm();
        } catch (_) {
          throw new Error("PDF ini tidak punya formulir.");
        }
        const fields = form.getFields();
        if (!fields.length) throw new Error(`PDF "${f.name}" tidak punya field formulir.`);
        let filled = 0;
        for (const fld of fields) {
          const name = fld.getName();
          if (!(name in values)) continue;
          const v = values[name];
          try {
            if (typeof fld.setText === "function") fld.setText(String(v));
            else if (typeof fld.check === "function") { if (v) fld.check(); else fld.uncheck(); }
            else if (typeof fld.select === "function" && v) fld.select(String(v));
            filled++;
          } catch (err) {
            throw new Error(`Field "${name}" tidak bisa diisi: ${err.message || err}`);
          }
        }
        if (!filled) throw new Error("Tidak ada field yang diisi.");
        try { form.updateFieldAppearances(); } catch (_) { /* tampilan dibuat pdf-lib */ }
        if (opts.lock) {
          try { form.flatten(); } catch (err) { void err; }
        }
        const bytes = await saveDoc(doc);
        out.push({ name: C.safeName(C.baseName(f.name)) + "-formulir.pdf", bytes });
        await tick();
      }
      return out;
    },
  });

  /* ============================================================
     7. Rapi/Rrepair PDF
     ============================================================ */
  register({
    id: "repair",
    cat: "optimize",
    name: "Rapi PDF",
    desc: "Bangun ulang PDF yang rusak: struktur dibetulkan, data liar dibuang, font tetap utuh.",
    icon: "repair",
    accept: ".pdf,application/pdf",
    multiple: true,
    fields: [
      { type: "check", id: "fallbackRaster", label: "Kalau tidak bisa diperbaiki tanpa raster, gunakan gambar", value: true },
      { type: "check", id: "stripMeta", label: "Bersihkan metadata", value: true },
    ],
    async run(ctx) {
      const { files, opts } = ctx;
      const out = [];
      for (const f of files) {
        let bytes = null;
        let how = "";
        /* Cara 1: salin halaman dengan pdf-lib (teks & font tetap utuh). */
        try {
          const src = await loadDoc(f.bytes);
          const dst = await PDFDocument.create();
          const pages = src.getPages();
          const copied = await dst.copyPages(src, pages.map((_, i) => i));
          copied.forEach((p) => dst.addPage(p));
          if (opts.stripMeta) {
            dst.setTitle("");
            dst.setAuthor("");
            dst.setSubject("");
            dst.setKeywords([]);
            dst.setProducer(C.PRODUCER || "Pemisah PDF");
            dst.setCreator("");
          }
          bytes = await saveDoc(dst, { useObjectStreams: false });
          how = "struktur disalin ulang";
        } catch (err) {
          /* Cara 2: render tiap halaman lalu susun ulang. */
          if (!opts.fallbackRaster) throw new Error("PDF tidak bisa diperbaiki: " + (err.message || err));
          let pdfjs = null;
          try {
            pdfjs = await openPdfjs(f.bytes);
          } catch (err2) {
            /* Tidak ada satu pun halaman yang bisa dibaca: berkas ini bukan
               PDF yang utuh (misalnya potongan unduhan atau teks acak). */
            throw new Error(
              "Berkas ini rusak total: tidak ada halaman yang bisa dipulihkan. " +
              "Pastikan berkas memang PDF utuh, bukan potongan atau teks acak."
            );
          }
          const dst = await PDFDocument.create();
          let rendered = 0;
          for (let i = 1; i <= pdfjs.numPages; i++) {
            ctx.progress(null, `Merender halaman ${i} dari ${pdfjs.numPages}…`);
            const { canvas, viewport } = await renderPage(pdfjs, i, 2);
            const jpg = await canvasToBytes(canvas, "image/jpeg", 0.9);
            canvas.width = canvas.height = 0;
            const img = await dst.embedJpg(jpg);
            const p = dst.addPage([viewport.width / 2, viewport.height / 2]);
            p.drawImage(img, { x: 0, y: 0, width: viewport.width / 2, height: viewport.height / 2 });
            rendered++;
            await tick();
          }
          try { await pdfjs.destroy(); } catch (_) {}
          if (!rendered) {
            throw new Error(
              "Berkas ini rusak total: tidak ada halaman yang bisa dipulihkan. " +
              "Pastikan berkas memang PDF utuh, bukan potongan atau teks acak."
            );
          }
          bytes = await saveDoc(dst, { useObjectStreams: false });
          how = "halaman dirender ulang (teks tidak bisa dicari)";
        }
        out.push({ name: C.safeName(C.baseName(f.name)) + "-rapi.pdf", bytes, note: how });
        await tick();
      }
      return out;
    },
  });

  /* ============================================================
     8. PDF ke PDF/A
     ============================================================ */
  function makeSrgbIcc() {
    /* Profil ICC v2 matriks-shaper sRGB, dibuat langsung supaya tidak
       perlu mengunduh berkas ICC (aplikasi harus jalan offline). */
    const cat = (...arrs) => {
      let len = 0;
      for (const a of arrs) len += a.length;
      const out = new Uint8Array(len);
      let o = 0;
      for (const a of arrs) { out.set(a, o); o += a.length; }
      return out;
    };
    const ascii = (t) => {
      const out = new Uint8Array(t.length + 1);
      for (let i = 0; i < t.length; i++) out[i] = t.charCodeAt(i) & 255;
      return out;
    };
    const pad4 = (n) => new Uint8Array((4 - (n % 4)) % 4);
    const s15 = (v) => Math.round(v * 65536);
    const xyz = (x, y, z) => {
      const out = new Uint8Array(12);
      const dv = new DataView(out.buffer);
      dv.setInt32(0, s15(x)); dv.setInt32(4, s15(y)); dv.setInt32(8, s15(z));
      return out;
    };
    const textDesc = (text) => {
      const body = ascii(text);
      const head = new Uint8Array(12);
      const dv = new DataView(head.buffer);
      head.set([0x64, 0x65, 0x73, 0x63], 0); // 'desc'
      dv.setUint32(8, body.length);
      return cat(head, body, pad4(12 + body.length));
    };
    const textType = (text) => {
      const body = ascii(text);
      const head = new Uint8Array(8);
      head.set([0x74, 0x65, 0x78, 0x74], 0); // 'text'
      return cat(head, body, pad4(8 + body.length));
    };
    const curve = new Uint8Array(14);
    {
      const dv = new DataView(curve.buffer);
      curve.set([0x63, 0x75, 0x72, 0x76], 0); // 'curv'
      dv.setUint32(8, 1);
      dv.setUint16(12, 0x0233); // gamma 2.2 dalam u8Fixed8
    }

    const d50 = xyz(0.9642, 1.0, 0.8249);
    const tags = [
      ["desc", textDesc("sRGB IEC61966-2.1")],
      ["cprt", textType("Public Domain")],
      ["wtpt", d50],
      ["rXYZ", xyz(0.4360, 0.2225, 0.0139)],
      ["gXYZ", xyz(0.3851, 0.7169, 0.0971)],
      ["bXYZ", xyz(0.1431, 0.0606, 0.7141)],
      ["rTRC", curve],
      ["gTRC", curve],
      ["bTRC", curve],
    ];
    const tableSize = 4 + tags.length * 12;
    let offset = 128 + tableSize;
    const entries = [];
    const bodies = [];
    for (const [sig, data] of tags) {
      const pad = (4 - (data.length % 4)) % 4;
      entries.push({ sig, offset, size: data.length });
      bodies.push(data, new Uint8Array(pad));
      offset += data.length + pad;
    }
    const total = offset;
    const head = new Uint8Array(128);
    {
      const dv = new DataView(head.buffer);
      dv.setUint32(0, total);
      head.set([0x6d, 0x6e, 0x74, 0x72], 12); // 'mntr'
      head.set([0x52, 0x47, 0x42, 0x20], 16); // 'RGB '
      head.set([0x58, 0x59, 0x5a, 0x20], 20); // 'XYZ '
      dv.setUint32(8, 0x02100000); // versi 2.1
      const now = new Date();
      dv.setUint16(24, now.getUTCFullYear());
      dv.setUint16(26, now.getUTCMonth() + 1);
      dv.setUint16(28, now.getUTCDate());
      dv.setUint16(30, now.getUTCHours());
      dv.setUint16(32, now.getUTCMinutes());
      dv.setUint16(34, now.getUTCSeconds());
      head.set([0x61, 0x63, 0x73, 0x70], 36); // 'acsp'
      head.set([0x41, 0x50, 0x50, 0x4c], 40); // 'APPL'
      dv.setUint32(64, 0);
      /* pencahayaan PCS D50 */
      const ill = [0.9642, 1.0, 0.8249];
      ill.forEach((v, i) => dv.setInt32(68 + i * 4, s15(v)));
    }
    const table = new Uint8Array(tableSize);
    {
      const dv = new DataView(table.buffer);
      dv.setUint32(0, tags.length);
      entries.forEach((e, i) => {
        for (let k = 0; k < 4; k++) table[4 + i * 12 + k] = e.sig.charCodeAt(k);
        dv.setUint32(8 + i * 12, e.offset);
        dv.setUint32(12 + i * 12, e.size);
      });
    }
    return cat(head, table, ...bodies);
  }

  function xmpFor(doc) {
    const iso = (d) => d.toISOString().replace(/\.\d+Z$/, "Z");
    const title = (doc.getTitle && doc.getTitle()) || "";
    const now = iso(new Date());
    return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
   <pdfaid:part>1</pdfaid:part>
   <pdfaid:conformance>B</pdfaid:conformance>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(title)}</rdf:li></rdf:Alt></dc:title>
   <dc:format>application/pdf</dc:format>
   <pdf:Producer>${xmlEsc((doc.getProducer && doc.getProducer()) || "Pemisah PDF")}</pdf:Producer>
   <xmp:CreateDate>${now}</xmp:CreateDate>
   <xmp:ModifyDate>${now}</xmp:ModifyDate>
   <xmp:CreatorTool>Pemisah PDF</xmp:CreatorTool>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
  }

  function xmlEsc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  register({
    id: "pdfa",
    cat: "convert-from",
    name: "PDF ke PDF/A",
    desc: "Ubah PDF jadi PDF/A-1b (arsip): metadata PDF/A + output intent sRGB tertanam.",
    icon: "pdfa",
    accept: ".pdf,application/pdf",
    multiple: true,
    fields: [
      { type: "check", id: "meta", label: "Tambahkan metadata PDF/A (disarankan)", value: true },
      { type: "check", id: "icc", label: "Sisipkan output intent sRGB (wajib untuk PDF/A)", value: true },
    ],
    async run(ctx) {
      const { files, opts } = ctx;
      const out = [];
      for (const f of files) {
        const doc = await loadDoc(f.bytes);
        const producer = (doc.getProducer && doc.getProducer()) || "Pemisah PDF";
        doc.setProducer(producer);
        doc.setCreator("Pemisah PDF");
        doc.setModificationDate(new Date());

        if (opts.icc) {
          const icc = makeSrgbIcc();
          const stream = doc.context.flateStream(icc, {
            Type: "N", N: 3,
          });
          const iccRef = doc.context.register(stream);
          const intent = doc.context.obj({
            Type: "OutputIntent",
            S: "GTS_PDFA1",
            OutputConditionIdentifier: PDFString.of("sRGB IEC61966-2.1"),
            Info: PDFString.of("sRGB IEC61966-2.1"),
            RegistryName: PDFString.of("http://www.color.org"),
            DestOutputProfile: iccRef,
          });
          const intentRef = doc.context.register(intent);
          doc.catalog.set(PDFName.of("OutputIntents"), doc.context.obj([intentRef]));
        }
        if (opts.meta) {
          const xmp = doc.context.stream(xmpFor(doc), { Type: "Metadata", Subtype: "XML" });
          const metaRef = doc.context.register(xmp);
          doc.catalog.set(PDFName.of("Metadata"), metaRef);
          doc.catalog.set(PDFName.of("GTS_PDFA1"), C.PDFBool.True);
        }
        const bytes = await saveDoc(doc, { useObjectStreams: false });
        out.push({ name: C.safeName(C.baseName(f.name)) + "-pdfa.pdf", bytes });
        await tick();
      }
      return out;
    },
  });

  /* ============================================================
     9. Susun/Organize PDF — helper untuk UI khusus
     ============================================================ */
  const organize = {
    id: "organize",
    cat: "organize",
    name: "Susun PDF",
    desc: "Susun ulang halaman dalam satu tampilan: putar, hapus, duplikat, dan ubah urutan.",
    icon: "organize",
    accept: ".pdf,application/pdf",
    multiple: false,
    custom: "organize",
    fields: [],
    async open(bytes) {
      const doc = await loadDoc(bytes);
      const pdfjs = await openPdfjs(bytes);
      const n = pdfjs.numPages;
      const thumbs = [];
      for (let i = 1; i <= n; i++) {
        const { canvas, viewport } = await renderPage(pdfjs, i, 0.35);
        thumbs.push({ data: canvas.toDataURL("image/jpeg", 0.6), w: viewport.width, h: viewport.height });
        canvas.width = canvas.height = 0;
      }
      try { await pdfjs.destroy(); } catch (_) {}
      return {
        pageCount: n,
        thumbs,
        items: Array.from({ length: n }, (_, i) => ({ n: i + 1, rot: 0, del: false })),
      };
    },
    async run(ctx) {
      const st = window.PDFToolsUI && window.PDFToolsUI.state;
      const data = st && st.custom && st.custom.organize;
      const f = ctx.files[0];
      if (!data || !f) throw new Error("PDF belum dibuka untuk disusun.");
      const kept = data.items.filter((it) => !it.del);
      if (!kept.length) throw new Error("Semua halaman dihapus — tidak ada yang tersisa.");
      const bytes = await organize.build(f.bytes, kept, {});
      return [{ name: C.safeName(C.baseName(f.name)) + "-susun.pdf", bytes, note: kept.length + " halaman" }];
    },
    async build(bytes, items, opts) {
      const src = await loadDoc(bytes);
      const dst = await PDFDocument.create();
      const pages = src.getPages();
      for (const it of items) {
        if (it.del) continue;
        const [cp] = await dst.copyPages(src, [it.n - 1]);
        const p = dst.addPage(cp);
        const rot = ((it.rot || 0) % 360 + 360) % 360;
        if (rot) p.setRotation(degrees(rot));
      }
      const bytesOut = await saveDoc(dst);
      void pages; void opts;
      return bytesOut;
    },
  };
  register(organize);

  window.PDFToolsPdf = { makeSrgbIcc, trimBox };
})();
