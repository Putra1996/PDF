/* ============================================================
   Alat konversi: gambar <-> PDF, Office <-> PDF, HTML -> PDF.
   ============================================================ */
(function () {
  "use strict";

  const C = window.PDFToolsCore;
  const {
    PDFDocument, register, tick, MM, loadDoc, saveDoc, openPdfjs, renderPage,
    canvasToBytes, decodeImage, makeZip, fontFor, drawTextSafe,
  } = C;

  /* ============================================================
     Gambar -> PDF (JPG to PDF & Scan to PDF)
     ============================================================ */
  async function imagesToPdf(files, opts, onStep) {
    const doc = await PDFDocument.create();
    const margin = (Number(opts.margin) || 0) * MM;
    const sizeMode = opts.size || "fit";
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (onStep) onStep(`Menyisipkan ${f.name} (${i + 1}/${files.length})…`);
      const bmp = await decodeImage(f.bytes, f.type);
      const iw = bmp.width || bmp.naturalWidth;
      const ih = bmp.height || bmp.naturalHeight;
      const isPng = (f.type || "").indexOf("png") >= 0 || /\.png$/i.test(f.name || "");

      let pw, ph;
      if (sizeMode === "a4") { pw = C.A4.w; ph = C.A4.h; }
      else if (sizeMode === "letter") { pw = C.LETTER.w; ph = C.LETTER.h; }
      else { pw = iw; ph = ih; }

      let rot = 0;
      if (opts.orientation === "landscape" && ph > pw) { rot = 90; }
      else if (opts.orientation === "portrait" && pw > ph) { rot = 90; }
      else if (opts.orientation === "auto" && iw > ih && sizeMode !== "fit") { rot = 90; }

      const page = doc.addPage([pw, ph]);
      let dw = pw - margin * 2;
      let dh = ph - margin * 2;
      if (rot) { const t = dw; dw = dh; dh = t; }
      const k = Math.min(dw / iw, dh / ih);
      const w = iw * k, h = ih * k;
      const x = (pw - (rot ? h : w)) / 2;
      const y = (ph - (rot ? w : h)) / 2;

      let img;
      if (isPng) {
        try { img = await doc.embedPng(f.bytes); }
        catch (_) { img = await embedJpegFallback(doc, f); }
      } else {
        img = await embedJpegFallback(doc, f);
      }
      page.drawImage(img, { x, y, width: rot ? h : w, height: rot ? w : h, rotate: degreesOf(rot) });
      if (bmp.close) bmp.close();
      await tick();
    }
    return saveDoc(doc);
  }

  async function embedJpegFallback(doc, f) {
    /* PNG tidak bisa di-embed sebagai JPEG — ubah lewat canvas. */
    const bmp = await decodeImage(f.bytes, f.type);
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width || bmp.naturalWidth;
    canvas.height = bmp.height || bmp.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0);
    const jpg = await canvasToBytes(canvas, "image/jpeg", 0.92);
    canvas.width = canvas.height = 0;
    if (bmp.close) bmp.close();
    return doc.embedJpg(jpg);
  }

  function degreesOf(d) { return C.degrees(d || 0); }

  const IMG_FIELDS = [
    { type: "select", id: "size", label: "Ukuran halaman", value: "fit", options: [["fit", "Ikuti ukuran gambar"], ["a4", "A4"], ["letter", "Letter"]] },
    { type: "select", id: "orientation", label: "Orientasi", value: "auto", options: [["auto", "Otomatis"], ["portrait", "Tegak"], ["landscape", "Mendatar"]] },
    { type: "number", id: "margin", label: "Margin (mm)", value: 0, min: 0, max: 60 },
    { type: "number", id: "quality", label: "Kualitas JPEG (%)", value: 90, min: 40, max: 100, visibleIf: { mode: "text" } },
  ];

  register({
    id: "jpg2pdf",
    cat: "convert-to",
    name: "Gambar ke PDF",
    desc: "Ubah JPG/PNG/WebP jadi satu PDF — ukuran halaman, orientasi, dan margin bisa diatur.",
    icon: "image",
    accept: "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp",
    multiple: true,
    fields: IMG_FIELDS,
    async run(ctx) {
      const bytes = await imagesToPdf(ctx.files, ctx.opts, (t) => ctx.progress(null, t));
      return [{ name: "gambar.pdf", bytes }];
    },
  });

  register({
    id: "scan",
    cat: "organize",
    name: "Pindai ke PDF",
    desc: "Ubah foto hasil pindai (atau jepret kamera) menjadi satu PDF.",
    icon: "scan",
    accept: "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp",
    multiple: true,
    custom: "scan",
    fields: [
      { type: "number", id: "margin", label: "Margin (mm)", value: 8, min: 0, max: 60 },
      { type: "select", id: "size", label: "Ukuran halaman", value: "a4", options: [["a4", "A4"], ["letter", "Letter"], ["fit", "Ikuti ukuran gambar"]] },
      { type: "check", id: "deskew", label: "Perbaiki kemiringan otomatis", value: false },
    ],
    async run(ctx) {
      const bytes = await imagesToPdf(ctx.files, ctx.opts, (t) => ctx.progress(null, t));
      return [{ name: "pindai.pdf", bytes }];
    },
  });

  /* ============================================================
     PDF -> gambar
     ============================================================ */
  register({
    id: "pdf2jpg",
    cat: "convert-from",
    name: "PDF ke JPG",
    desc: "Simpan tiap halaman PDF sebagai gambar JPG atau PNG (ZIP bila banyak halaman).",
    icon: "image",
    accept: ".pdf,application/pdf",
    multiple: true,
    fields: [
      { type: "select", id: "dpi", label: "Resolusi", value: "150", options: [["72", "72 DPI (web)"], ["150", "150 DPI (seimbang)"], ["300", "300 DPI (cetak)"]] },
      { type: "select", id: "format", label: "Format", value: "jpeg", options: [["jpeg", "JPG"], ["png", "PNG"]] },
      { type: "range", id: "quality", label: "Kualitas", value: 90, min: 40, max: 100, step: 5, unit: "%" },
      { type: "check", id: "zip", label: "Kumpulkan jadi satu ZIP", value: true },
    ],
    async run(ctx) {
      const { files, opts } = ctx;
      const out = [];
      const scale = (Number(opts.dpi) || 150) / 72;
      for (const f of files) {
        const pdfjs = await openPdfjs(f.bytes);
        const items = [];
        for (let i = 1; i <= pdfjs.numPages; i++) {
          ctx.progress(null, `${f.name}: merender halaman ${i}/${pdfjs.numPages}…`);
          const { canvas } = await renderPage(pdfjs, i, scale);
          const type = opts.format === "png" ? "image/png" : "image/jpeg";
          const bytes = await canvasToBytes(canvas, type, (Number(opts.quality) || 90) / 100);
          canvas.width = canvas.height = 0;
          const ext = opts.format === "png" ? "png" : "jpg";
          items.push({ name: `${C.safeName(C.baseName(f.name))}-${String(i).padStart(3, "0")}.${ext}`, bytes });
          await tick();
        }
        try { await pdfjs.destroy(); } catch (_) {}
        if (items.length === 1 && !opts.zip) {
          out.push({ name: items[0].name, bytes: items[0].bytes });
        } else {
          const blob = await makeZip(items.map((it) => ({ name: it.name, bytes: it.bytes })));
          out.push({ name: C.safeName(C.baseName(f.name)) + "-gambar.zip", blob });
        }
      }
      return out;
    },
  });

  /* ============================================================
     HTML -> PDF
     ============================================================ */
  register({
    id: "html2pdf",
    cat: "convert-to",
    name: "HTML ke PDF",
    desc: "Buka berkas HTML lalu simpan sebagai PDF lewat dialog cetak browser.",
    icon: "html",
    accept: ".html,.htm,text/html",
    multiple: false,
    custom: "html",
    fields: [],
    async run(ctx) {
      const f = ctx.files[0];
      const html = new TextDecoder("utf-8").decode(f.bytes);
      const iframe = document.createElement("iframe");
      iframe.style.cssText = "position:fixed;left:0;top:0;width:800px;height:600px;border:0;z-index:-1;opacity:0";
      document.body.appendChild(iframe);
      await new Promise((resolve, reject) => {
        iframe.onload = () => resolve();
        iframe.onerror = () => reject(new Error("HTML gagal dimuat."));
        iframe.srcdoc = html;
        setTimeout(() => reject(new Error("HTML gagal dimuat (timeout).")), 15000);
      });
      await new Promise((r) => setTimeout(r, 500));
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch (err) {
        throw new Error("Dialog cetak tidak bisa dibuka: " + (err.message || err));
      }
      setTimeout(() => iframe.remove(), 60000);
      return [];
    },
  });

  /* ============================================================
     Office -> PDF (teks & tabel)
     ============================================================ */
  function xmlOf(zip, name) {
    const entry = zip.file(name);
    if (!entry) return null;
    return entry.async("string");
  }

  function parseXml(text) {
    return new DOMParser().parseFromString(text, "application/xml");
  }

  /* --- DOCX -> PDF --- */
  async function docxBlocks(bytes) {
    const zip = await JSZip.loadAsync(bytes);
    const xml = await xmlOf(zip, "word/document.xml");
    if (!xml) throw new Error("Berkas ini bukan DOCX yang valid (word/document.xml tidak ada).");
    const doc = parseXml(xml);
    const body = doc.getElementsByTagNameNS("*", "body")[0] || doc.documentElement;
    const blocks = [];
    for (const node of body.childNodes) {
      const tag = (node.nodeName || "").toLowerCase();
      if (tag === "p") {
        const style = node.getElementsByTagNameNS("*", "pStyle")[0];
        const styleVal = style ? (style.getAttribute("w:val") || "") : "";
        let text = "";
        for (const t of node.getElementsByTagNameNS("*", "t")) text += t.textContent;
        if (node.getElementsByTagNameNS("*", "br").length) text = text.trim();
        const heading = /^Heading(\d)$/i.exec(styleVal);
        blocks.push({ type: "p", text: text.replace(/\s+/g, " ").trim(), heading: heading ? Number(heading[1]) : 0 });
      } else if (tag === "tbl") {
        const rows = [];
        for (const tr of node.getElementsByTagNameNS("*", "tr")) {
          const cells = [];
          for (const tc of tr.getElementsByTagNameNS("*", "tc")) {
            let text = "";
            for (const t of tc.getElementsByTagNameNS("*", "t")) text += t.textContent;
            cells.push(text.replace(/\s+/g, " ").trim());
          }
          if (cells.length) rows.push(cells);
        }
        if (rows.length) blocks.push({ type: "table", rows });
      }
    }
    return blocks;
  }

  /* --- PPTX -> PDF --- */
  async function pptxSlides(bytes) {
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    if (!names.length) throw new Error("Berkas ini bukan PPTX yang valid (tidak ada slide).");
    names.sort((a, b) => {
      const na = Number(/slide(\d+)\.xml/.exec(a)[1]);
      const nb = Number(/slide(\d+)\.xml/.exec(b)[1]);
      return na - nb;
    });
    const slides = [];
    for (const n of names) {
      const doc = parseXml(await zip.file(n).async("string"));
      const texts = [];
      for (const t of doc.getElementsByTagNameNS("*", "t")) {
        const s = (t.textContent || "").trim();
        if (s) texts.push(s);
      }
      slides.push({ title: texts[0] || "", bullets: texts.slice(1) });
    }
    return slides;
  }

  /* --- XLSX -> PDF --- */
  async function xlsxSheets(bytes) {
    const zip = await JSZip.loadAsync(bytes);
    const wbXml = await xmlOf(zip, "xl/workbook.xml");
    if (!wbXml) throw new Error("Berkas ini bukan XLSX yang valid (xl/workbook.xml tidak ada).");
    const wb = parseXml(wbXml);
    const relsXml = await xmlOf(zip, "xl/_rels/workbook.xml.rels");
    const rels = new Map();
    if (relsXml) {
      const rd = parseXml(relsXml);
      for (const r of rd.getElementsByTagNameNS("*", "Relationship")) {
        rels.set(r.getAttribute("Id"), r.getAttribute("Target"));
      }
    }
    const shared = [];
    const ssXml = await xmlOf(zip, "xl/sharedStrings.xml");
    if (ssXml) {
      const sd = parseXml(ssXml);
      for (const si of sd.getElementsByTagNameNS("*", "si")) {
        let s = "";
        for (const t of si.getElementsByTagNameNS("*", "t")) s += t.textContent;
        shared.push(s);
      }
    }
    const sheets = [];
    for (const sh of wb.getElementsByTagNameNS("*", "sheet")) {
      const name = sh.getAttribute("name") || "Sheet";
      const rid = sh.getAttribute("r:id") || sh.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
      let target = rid ? rels.get(rid) : null;
      if (!target) target = `worksheets/sheet${sheets.length + 1}.xml`;
      const path = target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\.\//, "");
      const entry = zip.file(path);
      if (!entry) continue;
      const sd = parseXml(await entry.async("string"));
      const rows = [];
      for (const row of sd.getElementsByTagNameNS("*", "row")) {
        const cells = [];
        for (const c of row.getElementsByTagNameNS("*", "c")) {
          const t = c.getAttribute("t");
          let val = "";
          if (t === "s") {
            const v = c.getElementsByTagNameNS("*", "v")[0];
            val = v ? (shared[Number(v.textContent)] || "") : "";
          } else if (t === "inlineStr") {
            let s = "";
            for (const tt of c.getElementsByTagNameNS("*", "t")) s += tt.textContent;
            val = s;
          } else {
            const v = c.getElementsByTagNameNS("*", "v")[0];
            val = v ? v.textContent : "";
          }
          cells.push(val);
        }
        if (cells.length) rows.push(cells);
      }
      sheets.push({ name, rows });
    }
    if (!sheets.length) throw new Error("XLSX tidak punya sheet yang bisa dibaca.");
    return sheets;
  }

  /* --- PDF berisi teks bergaya --- */
  async function writeFlowDoc(doc, blocks, opts) {
    const pageW = C.A4.w, pageH = C.A4.h;
    const margin = (Number(opts.margin) || 18) * MM;
    const maxW = pageW - margin * 2;
    const font = await fontFor(doc, "Helvetica");
    const bold = await fontFor(doc, "HelveticaBold");
    let page = doc.addPage([pageW, pageH]);
    let y = pageH - margin;

    const newPage = () => { page = doc.addPage([pageW, pageH]); y = pageH - margin; };

    const writeLine = (text, size, isBold) => {
      const f = isBold ? bold : font;
      const words = String(text).split(/\s+/).filter(Boolean);
      if (!words.length) { y -= size * 0.6; return; }
      let line = "";
      const flush = () => {
        if (!line) return;
        const h = size * 1.35;
        if (y - h < margin) newPage();
        page.drawText(line, { x: margin, y: y - size, size, font: f, color: C.rgb(0, 0, 0) });
        y -= h;
        line = "";
      };
      for (const w of words) {
        const test = line ? line + " " + w : w;
        let width = 0;
        try { width = f.widthOfTextAtSize(test, size); } catch (_) { width = test.length * size * 0.5; }
        if (width > maxW) { flush(); line = w; } else line = test;
      }
      flush();
    };

    const writeTable = (rows) => {
      const cols = Math.max(...rows.map((r) => r.length));
      const size = 9;
      const cw = maxW / cols;
      for (const r of rows) {
        if (y - size * 1.8 < margin) newPage();
        for (let i = 0; i < cols; i++) {
          const cell = r[i] || "";
          let txt = cell;
          try { txt = font.widthOfTextAtSize(cell, size) > cw - 4 ? cell.slice(0, Math.max(1, Math.floor((cw - 4) / (size * 0.55)))) : cell; }
          catch (_) { /* biarkan */ }
          page.drawRectangle({ x: margin + i * cw, y: y - size * 1.6, width: cw, height: size * 1.6, borderColor: C.rgb(0.75, 0.75, 0.75), borderWidth: 0.5 });
          page.drawText(txt, { x: margin + i * cw + 2, y: y - size * 1.35, size, font, color: C.rgb(0, 0, 0) });
        }
        y -= size * 1.6;
      }
      y -= 6;
    };

    for (const b of blocks) {
      if (b.type === "table") { writeTable(b.rows); continue; }
      const text = b.text || "";
      if (!text) { y -= 8; continue; }
      if (b.heading) {
        const size = Math.max(12, 20 - (b.heading - 1) * 3);
        if (y - size * 2 < margin) newPage();
        y -= size * 0.4;
        page.drawText(text, { x: margin, y: y - size, size, font: bold, color: C.rgb(0, 0, 0) });
        y -= size * 1.7;
      } else {
        writeLine(text, 10.5, false);
      }
    }
    return doc;
  }

  register({
    id: "word2pdf",
    cat: "convert-to",
    name: "WORD ke PDF",
    desc: "Ubah berkas .docx menjadi PDF (teks dan tabel terbaca; tata letak asli tidak dipertahankan).",
    icon: "word",
    accept: ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    multiple: true,
    fields: [
      { type: "number", id: "margin", label: "Margin (mm)", value: 18, min: 5, max: 40 },
    ],
    async run(ctx) {
      const out = [];
      for (const f of ctx.files) {
        const blocks = await docxBlocks(f.bytes);
        const doc = await PDFDocument.create();
        await writeFlowDoc(doc, blocks, ctx.opts);
        const bytes = await saveDoc(doc);
        out.push({ name: C.safeName(C.baseName(f.name)) + ".pdf", bytes });
        await tick();
      }
      return out;
    },
  });

  register({
    id: "ppt2pdf",
    cat: "convert-to",
    name: "POWERPOINT ke PDF",
    desc: "Ubah berkas .pptx menjadi PDF: satu halaman per slide (judul + poin isi).",
    icon: "ppt",
    accept: ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation",
    multiple: true,
    fields: [
      { type: "number", id: "margin", label: "Margin (mm)", value: 18, min: 5, max: 40 },
    ],
    async run(ctx) {
      const out = [];
      for (const f of ctx.files) {
        const slides = await pptxSlides(f.bytes);
        const doc = await PDFDocument.create();
        const font = await fontFor(doc, "Helvetica");
        const bold = await fontFor(doc, "HelveticaBold");
        const pageW = C.A4.w, pageH = C.A4.h;
        const margin = (Number(ctx.opts.margin) || 18) * MM;
        for (const s of slides) {
          const page = doc.addPage([pageW, pageH]);
          let y = pageH - margin;
          if (s.title) {
            page.drawText(s.title, { x: margin, y: y - 20, size: 20, font: bold, color: C.rgb(0, 0, 0) });
            y -= 40;
          }
          for (const b of s.bullets) {
            const words = b.split(/\s+/);
            let line = "";
            const flush = () => {
              if (!line) return;
              if (y < margin + 14) return;
              page.drawText("• " + line, { x: margin, y: y - 11, size: 11, font, color: C.rgb(0.15, 0.15, 0.15) });
              y -= 17;
              line = "";
            };
            for (const w of words) {
              const test = line ? line + " " + w : w;
              let wd = 0;
              try { wd = font.widthOfTextAtSize(test, 11); } catch (_) { wd = test.length * 5.5; }
              if (wd > pageW - margin * 2 - 10) flush();
              line = line ? line + " " + w : w;
            }
            flush();
          }
        }
        const bytes = await saveDoc(doc);
        out.push({ name: C.safeName(C.baseName(f.name)) + ".pdf", bytes });
        await tick();
      }
      return out;
    },
  });

  register({
    id: "xls2pdf",
    cat: "convert-to",
    name: "EXCEL ke PDF",
    desc: "Ubah berkas .xlsx menjadi PDF: tiap sheet jadi tabel di halamannya sendiri.",
    icon: "xls",
    accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    multiple: true,
    fields: [
      { type: "number", id: "margin", label: "Margin (mm)", value: 12, min: 5, max: 30 },
    ],
    async run(ctx) {
      const out = [];
      for (const f of ctx.files) {
        const sheets = await xlsxSheets(f.bytes);
        const blocks = [];
        for (const sh of sheets) {
          blocks.push({ type: "p", text: sh.name, heading: 1 });
          if (sh.rows.length) blocks.push({ type: "table", rows: sh.rows });
        }
        const doc = await PDFDocument.create();
        await writeFlowDoc(doc, blocks, ctx.opts);
        const bytes = await saveDoc(doc);
        out.push({ name: C.safeName(C.baseName(f.name)) + ".pdf", bytes });
        await tick();
      }
      return out;
    },
  });

  /* ============================================================
     PDF -> Office
     ============================================================ */
  const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }

  async function docxBlob(title, paragraphs) {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", XML_HEAD + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
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
    const body = paragraphs.map((p) => {
      if (p.style) return `<w:p><w:pPr><w:pStyle w:val="${p.style}"/></w:pPr><w:r><w:t xml:space="preserve">${esc(p.text)}</w:t></w:r></w:p>`;
      return `<w:p><w:r><w:t xml:space="preserve">${esc(p.text)}</w:t></w:r></w:p>`;
    }).join("");
    zip.file("word/document.xml", XML_HEAD + `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`);
    zip.file("word/styles.xml", XML_HEAD + `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
</w:styles>`);
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    zip.file("docProps/core.xml", XML_HEAD + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>Pemisah PDF</dc:creator><cp:lastModifiedBy>Pemisah PDF</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
    zip.file("docProps/app.xml", XML_HEAD + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Pemisah PDF</Application></Properties>`);
    return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  }

  function colName(n) {
    let s = "";
    n += 1;
    while (n > 0) {
      const rem = (n - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  async function xlsxBlob(sheetName, rows) {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", XML_HEAD + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`);
    zip.file("_rels/.rels", XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
    zip.file("xl/workbook.xml", XML_HEAD + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
    zip.file("xl/_rels/workbook.xml.rels", XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`);
    const xmlRows = rows.map((r, ri) => {
      const cells = r.map((v, ci) => `<c r="${colName(ci)}${ri + 1}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`).join("");
      return `<row r="${ri + 1}">${cells}</row>`;
    }).join("");
    zip.file("xl/worksheets/sheet1.xml", XML_HEAD + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${xmlRows}</sheetData></worksheet>`);
    return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  }

  const PPTX_THEME = XML_HEAD + `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Sederhana"><a:themeElements><a:clrScheme name="Sederhana"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2><a:accent1><a:srgbClr val="2563EB"/></a:accent1><a:accent2><a:srgbClr val="059669"/></a:accent2><a:accent3><a:srgbClr val="D97706"/></a:accent3><a:accent4><a:srgbClr val="DC2626"/></a:accent4><a:accent5><a:srgbClr val="7C3AED"/></a:accent5><a:accent6><a:srgbClr val="0891B2"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Sederhana"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Sederhana"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

  async function pptxBlob(title, slides) {
    const zip = new JSZip();
    const n = Math.max(1, slides.length);
    zip.file("[Content_Types].xml", XML_HEAD + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
${Array.from({ length: n }, (_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("\n")}
</Types>`);
    zip.file("_rels/.rels", XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
    zip.file("ppt/presentation.xml", XML_HEAD + `<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${Array.from({ length: n }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join("")}</p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
    zip.file("ppt/_rels/presentation.xml.rels", XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${Array.from({ length: n }, (_, i) => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join("")}</Relationships>`);
    const emptySp = `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>`;
    zip.file("ppt/slideMasters/slideMaster1.xml", XML_HEAD + `<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`);
    zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`);
    zip.file("ppt/slideLayouts/slideLayout1.xml", XML_HEAD + `<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Kosong">${emptySp}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
    zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`);
    zip.file("ppt/theme/theme1.xml", PPTX_THEME);

    slides.forEach((s, i) => {
      const paras = s.lines.map((ln, k) => {
        const bold = k === 0 && s.title === ln ? ' b="1"' : "";
        const sz = k === 0 && s.title === ln ? 2400 : 1400;
        return `<a:p><a:r><a:rPr lang="id-ID" sz="${sz}"${bold} dirty="0"/><a:t>${esc(ln)}</a:t></a:r></a:p>`;
      }).join("");
      zip.file(`ppt/slides/slide${i + 1}.xml`, XML_HEAD + `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld>${emptySp}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
      /* Isi slide butuh bentuk teks di dalam spTree — bangun ulang. */
      const textBox = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Teks ${i + 1}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="457200"/><a:ext cx="8229600" cy="5943600"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${paras}</p:txBody></p:sp>`;
      zip.file(`ppt/slides/slide${i + 1}.xml`, XML_HEAD + `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${textBox}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
    });
    return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  }

  register({
    id: "pdf2word",
    cat: "convert-from",
    name: "PDF ke WORD",
    desc: "Ubah isi teks PDF menjadi berkas .docx yang bisa dibuka di Word.",
    icon: "word",
    accept: ".pdf,application/pdf",
    multiple: true,
    fields: [
      { type: "check", id: "pageBreak", label: "Pisah antar halaman dengan page break", value: true },
    ],
    async run(ctx) {
      const out = [];
      for (const f of ctx.files) {
        const pdfjs = await openPdfjs(f.bytes);
        const paragraphs = [];
        for (let i = 1; i <= pdfjs.numPages; i++) {
          const text = await C.pageText(pdfjs, i);
          const lines = text ? text.split(/(?<=[.!?])\s+/) : [];
          if (i > 1 && ctx.opts.pageBreak) paragraphs.push({ text: "", style: null, breakBefore: true });
          for (const ln of lines) {
            const t = ln.trim();
            if (!t) continue;
            const isHeading = t.length < 80 && !/[.!?]$/.test(t) && /^[A-Z0-9]/.test(t);
            paragraphs.push({ text: t, style: isHeading ? "Heading1" : null });
          }
        }
        try { await pdfjs.destroy(); } catch (_) {}
        const blob = await docxBlob(C.baseName(f.name), paragraphs.map((p) => (p.breakBefore ? { text: "", pageBreak: true } : p)));
        out.push({ name: C.safeName(C.baseName(f.name)) + ".docx", blob });
        await tick();
      }
      return out;
    },
  });

  register({
    id: "pdf2xls",
    cat: "convert-from",
    name: "PDF ke EXCEL",
    desc: "Ubah baris teks PDF menjadi lembar kerja .xlsx (satu baris per baris teks).",
    icon: "xls",
    accept: ".pdf,application/pdf",
    multiple: true,
    fields: [],
    async run(ctx) {
      const out = [];
      for (const f of ctx.files) {
        const pdfjs = await openPdfjs(f.bytes);
        const rows = [];
        for (let i = 1; i <= pdfjs.numPages; i++) {
          const text = await C.pageText(pdfjs, i);
          for (const ln of text.split(/\s{2,}|\n/)) {
            const t = ln.trim();
            if (t) rows.push([t]);
          }
        }
        try { await pdfjs.destroy(); } catch (_) {}
        const blob = await xlsxBlob(C.baseName(f.name).slice(0, 28), rows);
        out.push({ name: C.safeName(C.baseName(f.name)) + ".xlsx", blob });
        await tick();
      }
      return out;
    },
  });

  register({
    id: "pdf2ppt",
    cat: "convert-from",
    name: "PDF ke POWERPOINT",
    desc: "Ubah PDF menjadi .pptx: satu slide per halaman, teks halaman jadi isi slide.",
    icon: "ppt",
    accept: ".pdf,application/pdf",
    multiple: true,
    fields: [],
    async run(ctx) {
      const out = [];
      for (const f of ctx.files) {
        const pdfjs = await openPdfjs(f.bytes);
        const slides = [];
        for (let i = 1; i <= pdfjs.numPages; i++) {
          const text = await C.pageText(pdfjs, i);
          const lines = text ? text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean) : [];
          slides.push({ title: `Halaman ${i}`, lines: lines.slice(0, 12) });
        }
        try { await pdfjs.destroy(); } catch (_) {}
        const blob = await pptxBlob(C.baseName(f.name), slides);
        out.push({ name: C.safeName(C.baseName(f.name)) + ".pptx", blob });
        await tick();
      }
      return out;
    },
  });

  window.PDFToolsConvert = {
    imagesToPdf, docxBlocks, pptxSlides, xlsxSheets, docxBlob, xlsxBlob, pptxBlob, writeFlowDoc,
  };
})();
