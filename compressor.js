/* ============================================================
   PDFCompressor — mesin kompresi PDF (100% berjalan di browser)
   ------------------------------------------------------------
   Tiga strategi:
     • lossless : struktur file dioptimalkan (buang objek yatim +
                  bersihkan metadata). Teks, font, dan gambar utuh.
     • optimal  : lossless + HANYA gambar raster yang di-downsample
                  (dihitung dari DPI efektifnya). Teks & font tetap
                  vektor sehingga tetap tajam dan bisa dicari.
     • raster   : halaman dirender ulang menjadi gambar (DPI +
                  kualitas JPEG), dengan deteksi halaman scan agar
                  tidak pernah melakukan upsample.
   ------------------------------------------------------------
   Aturan utama: hasil TIDAK PERNAH lebih besar dari file asli.
   ============================================================ */
(function (global) {
  "use strict";

  const L = global.PDFLib;
  if (!L) {
    global.PDFCompressor = null;
    return;
  }

  const {
    PDFDocument,
    PDFName,
    PDFDict,
    PDFArray,
    PDFRef,
    PDFRawStream,
    PDFStream,
    PDFString,
    PDFNumber,
  } = L;

  /* Nama perangkat lunak yang ditulis ke metadata PDF.
     Catatan: kredit "by Putra" sengaja TIDAK ditulis ke dalam file PDF —
     kredit hanya tampil di antarmuka web, sesuai permintaan pemilik. */
  const PRODUCER = "Pemisah PDF";
  const MAX_INLINE_FORM_DEPTH = 5;

  /* ============================================================
     Utilitas kecil
     ============================================================ */
  const isPdfName = (o, n) => o instanceof PDFName && o.toString() === "/" + n;

  function mulCTM(m, ctm) {
    const [a1, b1, c1, d1, e1, f1] = m;
    const [a2, b2, c2, d2, e2, f2] = ctm;
    return [
      a1 * a2 + b1 * c2,
      a1 * b2 + b1 * d2,
      c1 * a2 + d1 * c2,
      c1 * b2 + d1 * d2,
      e1 * a2 + f1 * c2 + e2,
      e1 * b2 + f1 * d2 + f2,
    ];
  }

  async function inflate(bytes) {
    if (typeof DecompressionStream !== "function") return null;
    try {
      const ds = new DecompressionStream("deflate");
      const stream = new Blob([bytes]).stream().pipeThrough(ds);
      const buf = await new Response(stream).arrayBuffer();
      return new Uint8Array(buf);
    } catch (_) {
      return null;
    }
  }

  function decodeAHx(bytes) {
    const out = [];
    let hi = -1;
    for (let i = 0; i < bytes.length; i++) {
      const c = String.fromCharCode(bytes[i]);
      if (c === ">") break;
      const v = parseInt(c, 16);
      if (isNaN(v)) continue;
      if (hi < 0) hi = v;
      else {
        out.push((hi << 4) | v);
        hi = -1;
      }
    }
    if (hi >= 0) out.push(hi << 4);
    return new Uint8Array(out);
  }

  function decodeA85(bytes) {
    const out = [];
    let tuple = [];
    let i = 0;
    if (bytes[0] === 0x3c && bytes[1] === 0x7e) i = 2;
    for (; i < bytes.length; i++) {
      const c = bytes[i];
      if (c === 0x7e) break;
      if (c <= 0x20 || c === 0x0a || c === 0x0d) continue;
      if (c === 0x7a && tuple.length === 0) {
        out.push(0, 0, 0, 0);
        continue;
      }
      tuple.push(c - 33);
      if (tuple.length === 5) {
        let v = 0;
        for (const d of tuple) v = v * 85 + d;
        out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
        tuple = [];
      }
    }
    if (tuple.length > 1) {
      const n = tuple.length;
      for (let k = n; k < 5; k++) tuple.push(84);
      let v = 0;
      for (const d of tuple) v = v * 85 + d;
      const b = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
      for (let k = 0; k < n - 1; k++) out.push(b[k]);
    }
    return new Uint8Array(out);
  }

  /* ---------- prediktor PNG / TIFF ---------- */
  function applyTiffPredictor(data, colors, bpc, columns) {
    if (bpc !== 8) return data;
    const rowLen = colors * columns;
    const out = new Uint8Array(data.length);
    out.set(data);
    for (let r = 0; r + rowLen <= out.length; r += rowLen) {
      for (let i = colors; i < rowLen; i++) out[r + i] = (out[r + i] + out[r + i - colors]) & 255;
    }
    return out;
  }

  function applyPredictor(data, predictor, colors, bpc, columns) {
    if (predictor === 2) return applyTiffPredictor(data, colors, bpc, columns);
    const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
    const rowLen = Math.ceil((colors * bpc * columns) / 8);
    if (!rowLen) return data;
    const rows = Math.floor(data.length / (rowLen + 1));
    const out = new Uint8Array(rows * rowLen);
    let prev = new Uint8Array(rowLen);
    for (let r = 0; r < rows; r++) {
      const base = r * (rowLen + 1);
      const ft = data[base];
      const cur = new Uint8Array(rowLen);
      for (let i = 0; i < rowLen; i++) {
        const raw = data[base + 1 + i] || 0;
        const left = i >= bpp ? cur[i - bpp] : 0;
        const up = prev[i];
        const upLeft = i >= bpp ? prev[i - bpp] : 0;
        let val;
        switch (ft) {
          case 0: val = raw; break;
          case 1: val = raw + left; break;
          case 2: val = raw + up; break;
          case 3: val = raw + ((left + up) >> 1); break;
          case 4: {
            const p = left + up - upLeft;
            const pa = Math.abs(p - left);
            const pb = Math.abs(p - up);
            const pc = Math.abs(p - upLeft);
            val = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
            break;
          }
          default: val = raw;
        }
        cur[i] = val & 255;
      }
      out.set(cur, r * rowLen);
      prev = cur;
    }
    return out;
  }

  /* ============================================================
     Tokenizer content-stream PDF
     Menghasilkan daftar operator beserta operand-nya.
     ============================================================ */
  const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
  const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);
  const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)$/;

  function findInlineEnd(bytes, from) {
    // cari delimiter "EI" yang mengikuti data biner gambar inline
    for (let i = from; i < bytes.length - 1; i++) {
      if (bytes[i] === 0x45 && bytes[i + 1] === 0x49) {
        const next = bytes[i + 2];
        if (next === undefined || WS.has(next) || DELIM.has(next)) return i + 2;
      }
    }
    return bytes.length;
  }

  async function scanContent(bytes, onOp) {
    let i = 0;
    const n = bytes.length;
    let operands = [];
    let inline = false;

    while (i < n) {
      const c = bytes[i];

      if (inline) {
        const end = findInlineEnd(bytes, i);
        i = end;
        inline = false;
        operands = [];
        continue;
      }

      if (WS.has(c)) { i++; continue; }

      if (c === 0x25) { // komentar
        while (i < n && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i++;
        continue;
      }

      if (c === 0x2f) { // nama
        let s = "";
        i++;
        while (i < n && !WS.has(bytes[i]) && !DELIM.has(bytes[i])) {
          if (bytes[i] === 0x23 && i + 2 < n) {
            const hex = parseInt(String.fromCharCode(bytes[i + 1], bytes[i + 2]), 16);
            if (!isNaN(hex)) {
              s += String.fromCharCode(hex);
              i += 3;
              continue;
            }
          }
          s += String.fromCharCode(bytes[i]);
          i++;
        }
        operands.push({ t: "name", v: s });
        continue;
      }

      if (c === 0x28) { // string literal
        let depth = 1;
        let s = "";
        i++;
        while (i < n && depth > 0) {
          const ch = bytes[i];
          if (ch === 0x5c) {
            i++;
            const e = bytes[i];
            if (e === undefined) break;
            const esc = { 0x6e: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12 };
            if (esc[e] !== undefined) { s += String.fromCharCode(esc[e]); i++; }
            else if (e >= 0x30 && e <= 0x37) {
              let oct = "";
              while (oct.length < 3 && bytes[i] >= 0x30 && bytes[i] <= 0x37) { oct += String.fromCharCode(bytes[i]); i++; }
              s += String.fromCharCode(parseInt(oct, 8) & 255);
            } else if (e === 0x0a) i++;
            else if (e === 0x0d) { i++; if (bytes[i] === 0x0a) i++; }
            else { s += String.fromCharCode(e); i++; }
            continue;
          }
          if (ch === 0x28) depth++;
          else if (ch === 0x29) { depth--; if (depth === 0) { i++; break; } }
          s += String.fromCharCode(ch);
          i++;
        }
        operands.push({ t: "str", v: s });
        continue;
      }

      if (c === 0x3c && bytes[i + 1] === 0x3c) { // dictionary
        i += 2;
        let depth = 1;
        while (i < n && depth > 0) {
          if (bytes[i] === 0x3c && bytes[i + 1] === 0x3c) { depth++; i += 2; continue; }
          if (bytes[i] === 0x3e && bytes[i + 1] === 0x3e) { depth--; i += 2; continue; }
          i++;
        }
        operands.push({ t: "dict", v: null });
        continue;
      }

      if (c === 0x3c) { // string hex
        let s = "";
        i++;
        while (i < n && bytes[i] !== 0x3e) { s += String.fromCharCode(bytes[i]); i++; }
        i++;
        operands.push({ t: "str", v: s });
        continue;
      }

      if (c === 0x5b) { // array
        i++;
        const arr = [];
        let depth = 1;
        while (i < n && depth > 0) {
          const ch = bytes[i];
          if (ch === 0x5b) { depth++; i++; continue; }
          if (ch === 0x5d) { depth--; i++; continue; }
          if (ch === 0x28) {
            let d2 = 1;
            i++;
            while (i < n && d2 > 0) {
              if (bytes[i] === 0x5c) i++;
              else if (bytes[i] === 0x28) d2++;
              else if (bytes[i] === 0x29) d2--;
              i++;
            }
            continue;
          }
          if (ch === 0x3c && bytes[i + 1] === 0x3c) {
            i += 2;
            let d2 = 1;
            while (i < n && d2 > 0) {
              if (bytes[i] === 0x3c && bytes[i + 1] === 0x3c) { d2++; i += 2; continue; }
              if (bytes[i] === 0x3e && bytes[i + 1] === 0x3e) { d2--; i += 2; continue; }
              i++;
            }
            continue;
          }
          if (!WS.has(ch)) {
            let j = i;
            let num = "";
            while (j < n && !WS.has(bytes[j]) && !DELIM.has(bytes[j])) { num += String.fromCharCode(bytes[j]); j++; }
            if (NUM_RE.test(num)) { arr.push(parseFloat(num)); i = j; continue; }
            i++;
            continue;
          }
          i++;
        }
        operands.push({ t: "array", v: arr });
        continue;
      }

      if (c === 0x5d || c === 0x3e || c === 0x7d) { i++; continue; }

      // angka atau operator
      let j = i;
      let tok = "";
      while (j < n && !WS.has(bytes[j]) && !DELIM.has(bytes[j])) { tok += String.fromCharCode(bytes[j]); j++; }
      if (!tok) { i++; continue; }

      if (NUM_RE.test(tok)) { operands.push({ t: "num", v: parseFloat(tok) }); i = j; continue; }
      if (tok === "true") { operands.push({ t: "bool", v: true }); i = j; continue; }
      if (tok === "false") { operands.push({ t: "bool", v: false }); i = j; continue; }
      if (tok === "null") { operands.push({ t: "null", v: null }); i = j; continue; }

      const op = tok;
      i = j;
      if (op === "ID") {
        inline = true;
        operands = [];
        continue;
      }
      await onOp(op, operands);
      operands = [];
    }
  }

  /* ============================================================
     Stream decoding (Flate / AHx / A85 + prediktor)
     ============================================================ */
  async function decodeStreamData(ctx, stream) {
    let data = stream.getContents();
    const filt = stream.dict.get(PDFName.of("Filter"));
    const parms = stream.dict.get(PDFName.of("DecodeParms"));

    const filters = [];
    if (filt instanceof PDFName) filters.push({ name: filt.toString(), parms: null });
    else if (filt instanceof PDFArray) {
      const arr = filt.asArray();
      const pArr = parms instanceof PDFArray ? parms.asArray() : [];
      for (let i = 0; i < arr.length; i++) {
        const f = ctx.lookup(arr[i]);
        if (f instanceof PDFName) {
          const p = pArr[i] ? ctx.lookup(pArr[i]) : null;
          filters.push({ name: f.toString(), parms: p && p.dict ? p.dict : p });
        }
      }
    }

    for (const f of filters) {
      if (f.name === "/FlateDecode" || f.name === "/Fl") {
        const out = await inflate(data);
        if (!out) return null;
        data = out;
      } else if (f.name === "/ASCIIHexDecode" || f.name === "/AHx") {
        data = decodeAHx(data);
      } else if (f.name === "/ASCII85Decode" || f.name === "/A85") {
        data = decodeA85(data);
      } else {
        return null; // filter tidak didukung -> biarkan apa adanya
      }
      if (f.parms) {
        const p = f.parms.get(PDFName.of("Predictor"));
        const pred = p ? p.asNumber() : 1;
        if (pred > 1) {
          const colors = f.parms.get(PDFName.of("Colors"))?.asNumber() || 1;
          const bpc = f.parms.get(PDFName.of("BitsPerComponent"))?.asNumber() || 8;
          const columns = f.parms.get(PDFName.of("Columns"))?.asNumber() || 1;
          data = applyPredictor(data, pred, colors, bpc, columns);
        }
      }
    }
    return data;
  }

  /* ============================================================
     Pemetaan gambar -> ukuran penempatan (dalam poin)
     ============================================================ */
  function lookupDict(ctx, obj) {
    if (!obj) return null;
    if (obj instanceof PDFDict) return obj;
    if (obj instanceof PDFRef) {
      const o = ctx.lookup(obj);
      return o instanceof PDFDict ? o : null;
    }
    return null;
  }

  async function collectPlacements(doc, page) {
    const ctx = doc.context;
    const out = new Map();
    const seenForms = new Set();

    const res = page.node.Resources ? page.node.Resources() : null;
    const contents = page.node.get(PDFName.of("Contents"));
    const items = contents instanceof PDFArray ? contents.asArray() : [contents];

    // satu objek state dipakai bersama oleh seluruh operator agar
    // matriks transformasi (CTM) terbawa antar operator
    const state = { ctx, res, ctm: [1, 0, 0, 1, 0, 0], stack: [], out, seenForms, depth: 0 };

    for (const it of items) {
      const stream = it instanceof PDFRef ? ctx.lookup(it) : it;
      if (!(stream instanceof PDFRawStream || stream instanceof PDFStream)) continue;
      const data = stream instanceof PDFRawStream ? await decodeStreamData(ctx, stream) : stream.getContents();
      if (!data) continue;
      await scanContent(data, async (op, operands) => {
        await handleOperator(op, operands, state);
      });
    }
    return out;
  }

  async function handleOperator(op, operands, s) {
    const { ctx, res, out, seenForms, depth } = s;
    if (op === "q") { s.stack.push(s.ctm); return; }
    if (op === "Q") { s.ctm = s.stack.pop() || s.ctm; return; }
    if (op === "cm") {
      const nums = operands.filter((o) => o.t === "num").slice(-6).map((o) => o.v);
      if (nums.length === 6) s.ctm = mulCTM(nums, s.ctm);
      return;
    }
    if (op !== "Do") return;

    const nameOp = operands.find((o) => o.t === "name");
    if (!nameOp || !res) return;
    const xobjs = res.lookup(PDFName.of("XObject"));
    if (!(xobjs instanceof PDFDict)) return;
    const ref = xobjs.get(PDFName.of(nameOp.v));
    if (!(ref instanceof PDFRef)) return;
    const stream = ctx.lookup(ref);
    if (!stream || !stream.dict) return;

    const subtype = stream.dict.get(PDFName.of("Subtype"));
    if (isPdfName(subtype, "Image")) {
      const key = ref.toString();
      const w = Math.hypot(s.ctm[0], s.ctm[1]);
      const h = Math.hypot(s.ctm[2], s.ctm[3]);
      const prev = out.get(key);
      if (!prev || w * h > prev.w * prev.h) out.set(key, { w, h, ref });
      return;
    }

    if (isPdfName(subtype, "Form") && depth < MAX_INLINE_FORM_DEPTH) {
      const key = ref.toString();
      if (seenForms.has(key)) return;
      seenForms.add(key);
      let ctm = s.ctm;
      const matrix = stream.dict.get(PDFName.of("Matrix"));
      if (matrix instanceof PDFArray) {
        const a = matrix.asArray().map((x) => x.asNumber());
        if (a.length === 6) ctm = mulCTM(a, s.ctm);
      }
      const formRes = lookupDict(ctx, stream.dict.get(PDFName.of("Resources")));
      const data = stream instanceof PDFRawStream ? await decodeStreamData(ctx, stream) : stream.getContents();
      if (!data) return;
      await scanContent(data, async (op2, operands2) => {
        await handleOperator(op2, operands2, {
          ctx,
          res: formRes,
          ctm,
          stack: [],
          out,
          seenForms,
          depth: depth + 1,
        });
      });
    }
  }

  /* ============================================================
     Struktur file: buang objek yatim + bersihkan metadata
     ============================================================ */
  function pruneOrphans(doc) {
    const ctx = doc.context;
    const root = ctx.trailerInfo && ctx.trailerInfo.Root;
    if (!root) return 0;

    const seen = new Set();
    const queue = [];

    const pushRef = (ref) => {
      const k = ref.toString();
      if (seen.has(k)) return;
      seen.add(k);
      queue.push(ref);
    };

    const visit = (obj) => {
      if (!obj) return;
      if (obj instanceof PDFRef) { pushRef(obj); return; }
      if (obj instanceof PDFRawStream) { visit(obj.dict); return; }
      if (obj instanceof PDFDict) { for (const [, v] of obj.entries()) visit(v); return; }
      if (obj instanceof PDFArray) { for (const v of obj.asArray()) visit(v); return; }
    };

    pushRef(root);
    // Info dict berada di ctx.trailerInfo (bukan doc.trailer) - kalau dilewatkan,
    // seluruh metadata dokumen ikut terhapus.
    const info = ctx.trailerInfo && ctx.trailerInfo.Info;
    if (info instanceof PDFRef) pushRef(info);

    while (queue.length) {
      const ref = queue.pop();
      visit(ctx.lookup(ref));
    }

    let removed = 0;
    for (const [ref] of ctx.enumerateIndirectObjects()) {
      if (!seen.has(ref.toString())) {
        if (ctx.delete(ref)) removed++;
      }
    }
    return removed;
  }

  function cleanMetadata(doc) {
    const catalog = doc.catalog;
    for (const key of ["Metadata", "PieceInfo", "LastModified", "OutputIntents"]) {
      if (catalog && catalog.get(PDFName.of(key))) catalog.delete(PDFName.of(key));
    }
    try {
      const info = doc.getInfoDict();
      if (info) {
        for (const key of ["Title", "Author", "Subject", "Keywords", "CreationDate", "ModDate", "Trapped"]) {
          info.delete(PDFName.of(key));
        }
        info.set(PDFName.of("Producer"), PDFString.of(PRODUCER));
        info.set(PDFName.of("Creator"), PDFString.of(PRODUCER));
      }
    } catch (_) {
      /* metadata opsional */
    }
  }

  /* ============================================================
     Dekode gambar -> canvas
     ============================================================ */
  function parseColorSpace(ctx, csObj) {
    if (!csObj) return { type: "gray", comps: 1 };
    if (csObj instanceof PDFName) {
      const n = csObj.toString();
      if (n === "/DeviceGray" || n === "/CalGray" || n === "/G") return { type: "gray", comps: 1 };
      if (n === "/DeviceRGB" || n === "/CalRGB" || n === "/RGB") return { type: "rgb", comps: 3 };
      if (n === "/DeviceCMYK" || n === "/CMYK") return { type: "cmyk", comps: 4 };
      return null;
    }
    if (csObj instanceof PDFArray) {
      const arr = csObj.asArray();
      const first = ctx.lookup(arr[0]);
      const name = first instanceof PDFName ? first.toString() : "";
      if (name === "/ICCBased") {
        const s = ctx.lookup(arr[1]);
        const n = s && s.dict ? s.dict.get(PDFName.of("N"))?.asNumber() : 3;
        return { type: n === 1 ? "gray" : n === 4 ? "cmyk" : "rgb", comps: n || 3 };
      }
      if (name === "/Indexed" || name === "/I") {
        const base = parseColorSpace(ctx, ctx.lookup(arr[1]));
        const hival = ctx.lookup(arr[2])?.asNumber() || 0;
        let palette = null;
        const look = ctx.lookup(arr[3]);
        if (look instanceof PDFRawStream || look instanceof PDFStream) palette = look.getContents();
        // palet bisa berupa PDFString (<...> atau (...)) - di beberapa versi
        // pdf-lib PDFHexString TIDAK mewarisi PDFString, jadi pakai asBytes()
        else if (look && typeof look.asBytes === "function") {
          try {
            palette = look.asBytes();
          } catch (_) {
            palette = null;
          }
        }
        return { type: "indexed", comps: 1, base, hival, palette };
      }
      if (name === "/CalRGB") return { type: "rgb", comps: 3 };
      if (name === "/CalGray") return { type: "gray", comps: 1 };
      if (name === "/DeviceN") {
        const names = ctx.lookup(arr[1]);
        const n = names && names.size ? names.size() : 1;
        return { type: n === 1 ? "gray" : n === 4 ? "cmyk" : "rgb", comps: n };
      }
      if (name === "/Separation") return { type: "gray", comps: 1 };
    }
    return null;
  }

  function unpackRow(data, bpc, byteOffset, width) {
    // Nilai 0..255 untuk satu baris piksel (bpc 1/2/4/8).
    // Setiap baris mulai pada batas byte, jadi offset dihitung per baris.
    const out = new Uint8Array(width);
    if (bpc === 8) {
      for (let i = 0; i < width; i++) out[i] = data[byteOffset + i] || 0;
      return out;
    }
    const perByte = 8 / bpc;
    const mask = (1 << bpc) - 1;
    for (let i = 0; i < width; i++) {
      const byte = data[byteOffset + Math.floor(i / perByte)] || 0;
      const shift = 8 - bpc * ((i % perByte) + 1);
      const v = (byte >> shift) & mask;
      out[i] = bpc === 1 ? v * 255 : Math.round((v * 255) / mask);
    }
    return out;
  }

  function rawToImageData(data, cs, bpc, decodeArr, width, height) {
    const px = width * height;
    if (!px || !data) return null;
    const img = new ImageData(width, height);
    const out = img.data;

    const invert = Array.isArray(decodeArr) && decodeArr.length >= 2 && decodeArr[0] === 1 && decodeArr[1] === 0;

    if (cs.type === "gray") {
      const rowBytes = Math.ceil((width * bpc) / 8);
      for (let y = 0; y < height; y++) {
        const row = unpackRow(data, bpc, y * rowBytes, width);
        for (let x = 0; x < width; x++) {
          let v = row[x];
          if (invert) v = 255 - v;
          const o = (y * width + x) * 4;
          out[o] = out[o + 1] = out[o + 2] = v;
          out[o + 3] = 255;
        }
      }
      return img;
    }

    if (cs.type === "rgb") {
      if (bpc !== 8) return null;
      for (let i = 0; i < px; i++) {
        const s = i * 3;
        const o = i * 4;
        out[o] = data[s];
        out[o + 1] = data[s + 1];
        out[o + 2] = data[s + 2];
        out[o + 3] = 255;
      }
      return img;
    }

    if (cs.type === "cmyk") {
      if (bpc !== 8) return null;
      for (let i = 0; i < px; i++) {
        const s = i * 4;
        const c = data[s] / 255;
        const m = data[s + 1] / 255;
        const y = data[s + 2] / 255;
        const k = data[s + 3] / 255;
        const o = i * 4;
        out[o] = Math.round(255 * (1 - Math.min(1, c + k)));
        out[o + 1] = Math.round(255 * (1 - Math.min(1, m + k)));
        out[o + 2] = Math.round(255 * (1 - Math.min(1, y + k)));
        out[o + 3] = 255;
      }
      return img;
    }

    if (cs.type === "indexed") {
      const pal = cs.palette;
      if (!pal) return null;
      const baseComps = cs.base && cs.base.type === "rgb" ? 3 : cs.base && cs.base.type === "cmyk" ? 4 : 1;
      const rowBytes = Math.ceil((width * bpc) / 8);
      for (let y = 0; y < height; y++) {
        const row = unpackRow(data, bpc, y * rowBytes, width);
        for (let x = 0; x < width; x++) {
          const idx = row[x];
          const o = (y * width + x) * 4;
          const p = idx * baseComps;
          if (baseComps === 3) {
            out[o] = pal[p] || 0;
            out[o + 1] = pal[p + 1] || 0;
            out[o + 2] = pal[p + 2] || 0;
          } else if (baseComps === 1) {
            out[o] = out[o + 1] = out[o + 2] = pal[p] || 0;
          } else {
            const c = (pal[p] || 0) / 255, m = (pal[p + 1] || 0) / 255, yv = (pal[p + 2] || 0) / 255, k = (pal[p + 3] || 0) / 255;
            out[o] = Math.round(255 * (1 - Math.min(1, c + k)));
            out[o + 1] = Math.round(255 * (1 - Math.min(1, m + k)));
            out[o + 2] = Math.round(255 * (1 - Math.min(1, yv + k)));
          }
          out[o + 3] = 255;
        }
      }
      return img;
    }

    return null;
  }

  async function decodeImageToSource(ctx, stream) {
    const dict = stream.dict;
    const width = dict.get(PDFName.of("Width"))?.asNumber() || 0;
    const height = dict.get(PDFName.of("Height"))?.asNumber() || 0;
    if (!width || !height) return null;

    const filt = dict.get(PDFName.of("Filter"));
    const filters = [];
    if (filt instanceof PDFName) filters.push(filt.toString());
    else if (filt instanceof PDFArray) {
      for (const f of filt.asArray()) {
        const n = ctx.lookup(f);
        if (n instanceof PDFName) filters.push(n.toString());
      }
    }

    // 1) JPEG (DCTDecode) -> bisa langsung dipakai sebagai bitmap
    if (filters.length === 1 && filters[0] === "/DCTDecode") {
      try {
        const blob = new Blob([stream.getContents()], { type: "image/jpeg" });
        const bmp = await createImageBitmap(blob);
        return { source: bmp, width, height };
      } catch (_) {
        return null;
      }
    }

    // 2) data mentah (Flate / tanpa filter)
    const data = await decodeStreamData(ctx, stream);
    if (!data) return null;
    const cs = parseColorSpace(ctx, ctx.lookup(dict.get(PDFName.of("ColorSpace"))));
    if (!cs) return null;
    const bpc = dict.get(PDFName.of("BitsPerComponent"))?.asNumber() || 8;
    const decodeArr = dict.get(PDFName.of("Decode"));
    const dec = decodeArr instanceof PDFArray ? decodeArr.asArray().map((x) => x.asNumber()) : null;
    const img = rawToImageData(data, cs, bpc, dec, width, height);
    if (!img) return null;
    // ImageData tidak bisa langsung dipakai drawImage -> pindahkan ke canvas
    const canvas = newCanvas(width, height);
    canvas.getContext("2d").putImageData(img, 0, 0);
    return { source: canvas, width, height };
  }

  /* ---------- canvas ---------- */
  function newCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Gagal mengubah gambar."))), type, quality);
    });
  }

  /* Turunkan ukuran bertahap (setengah demi setengah) agar hasil
     jauh lebih tajam daripada downsample satu langkah. */
  function drawScaled(source, w, h) {
    let cur = source;
    let cw = source.width || source.videoWidth || 0;
    let ch = source.height || source.videoHeight || 0;
    if (!cw || !ch) return null;

    while (cw > w * 2 && ch > h * 2) {
      const nw = Math.max(w, Math.round(cw / 2));
      const nh = Math.max(h, Math.round(ch / 2));
      const tmp = newCanvas(nw, nh);
      const tctx = tmp.getContext("2d");
      tctx.imageSmoothingEnabled = true;
      tctx.imageSmoothingQuality = "high";
      tctx.fillStyle = "#ffffff";
      tctx.fillRect(0, 0, nw, nh);
      tctx.drawImage(cur, 0, 0, nw, nh);
      cur = tmp;
      cw = nw;
      ch = nh;
    }

    const out = newCanvas(w, h);
    const ctx = out.getContext("2d", { alpha: false });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(cur, 0, 0, out.width, out.height);
    return out;
  }

  function toGrayscale(canvas) {
    const ctx = canvas.getContext("2d");
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      const v = Math.round(0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]);
      p[i] = p[i + 1] = p[i + 2] = v;
    }
    ctx.putImageData(d, 0, 0);
    return canvas;
  }

  /* ============================================================
     Kompresi gambar di dalam PDF (vektor tetap utuh)
     ============================================================ */
  async function downsampleImages(doc, opts, onProgress) {
    const ctx = doc.context;
    const stats = { replaced: 0, kept: 0, skipped: 0, savedBytes: 0, totalImages: 0 };
    const pages = doc.getPages();

    /* 1) Kumpulkan penempatan TERBESAR untuk setiap gambar di seluruh
          dokumen. Gambar yang dipakai di beberapa halaman harus
          disimpan pada resolusi tertinggi yang dipakai. */
    const global = new Map();
    for (let i = 0; i < pages.length; i++) {
      if (onProgress) {
        onProgress("Memeriksa gambar halaman " + (i + 1) + " dari " + pages.length + "…", (i / pages.length) * 0.5);
      }
      let placements;
      try {
        placements = await collectPlacements(doc, pages[i]);
      } catch (_) {
        placements = new Map();
      }
      for (const [k, place] of placements) {
        const prev = global.get(k);
        if (!prev || place.w * place.h > prev.w * prev.h) global.set(k, place);
      }
    }

    /* 2) Perkecil gambar yang resolusinya melebihi target */
    const list = Array.from(global.values());
    for (let i = 0; i < list.length; i++) {
      const place = list[i];
      if (onProgress) {
        onProgress(
          "Memoptimasi gambar " + (i + 1) + " dari " + list.length + "…",
          0.5 + (i / Math.max(1, list.length)) * 0.5
        );
      }
      const ref = place.ref;
      const stream = ctx.lookup(ref);
      if (!(stream instanceof PDFRawStream)) { stats.skipped++; continue; }
      const dict = stream.dict;

      stats.totalImages++;
      if (dict.get(PDFName.of("ImageMask"))) { stats.skipped++; continue; }
      if (dict.get(PDFName.of("SMask"))) { stats.skipped++; continue; }

      const pw = dict.get(PDFName.of("Width"))?.asNumber() || 0;
      const ph = dict.get(PDFName.of("Height"))?.asNumber() || 0;
      if (!pw || !ph || !place.w || !place.h) { stats.skipped++; continue; }

      const dpiX = pw / (place.w / 72);
      const dpiY = ph / (place.h / 72);
      const dpi = Math.max(dpiX, dpiY);

      if (dpi <= opts.dpi * 1.02) { stats.kept++; continue; } // sudah cukup tajam

      const scale = opts.dpi / dpi;
      const nw = Math.max(1, Math.round(pw * scale));
      const nh = Math.max(1, Math.round(ph * scale));

      let src;
      try {
        src = await decodeImageToSource(ctx, stream);
      } catch (_) {
        src = null;
      }
      if (!src) { stats.skipped++; continue; }

      const canvas = drawScaled(src.source, nw, nh);
      if (!canvas) { stats.skipped++; continue; }
      if (opts.gray) toGrayscale(canvas);

      let blob;
      try {
        blob = await canvasToBlob(canvas, "image/jpeg", opts.quality);
      } catch (_) {
        stats.skipped++;
        continue;
      }
      const jpeg = new Uint8Array(await blob.arrayBuffer());
      const oldSize = stream.getContentsSize();

      // JANGAN PERNAH membengkakkan gambar
      if (jpeg.length >= oldSize) { stats.kept++; continue; }

      const newDict = ctx.obj({
        Type: "XObject",
        Subtype: "Image",
        Width: canvas.width,
        Height: canvas.height,
        ColorSpace: "DeviceRGB",
        BitsPerComponent: 8,
        Filter: "DCTDecode",
      });
      const newStream = ctx.stream(jpeg, newDict);
      if (!replaceStreamObject(ctx, ref, newStream)) {
        stats.skipped++;
        continue;
      }

      stats.replaced++;
      stats.savedBytes += oldSize - jpeg.length;
    }
    return stats;
  }

  /* Ganti objek stream pada konteks pdf-lib dengan objek baru
     pada ref yang sama (supaya semua rujukan tetap valid). */
  function replaceStreamObject(ctx, ref, stream) {
    const map = ctx.indirectObjects instanceof Map ? ctx.indirectObjects : ctx.objects;
    if (map instanceof Map) {
      map.set(ref, stream);
      return true;
    }
    // Versi pdf-lib lain tidak raided: lebih baik membiarkan gambar
    // apa adanya daripada menulis berkas yang rusak.
    return false;
  }

  /* ============================================================
     Mode raster: render ulang halaman
     ============================================================ */
  async function rasterFile(inputBytes, opts, onProgress) {
    const src = await global.pdfjsLib.getDocument({
      data: inputBytes.slice(0),
      isEvalSupported: false,
    }).promise;

    const out = await PDFDocument.create();
    out.setProducer(PRODUCER);
    out.setCreator(PRODUCER);
    out.setCreationDate(new Date());

    const total = src.numPages;
    let next = 0;
    let done = 0;
    const CONCURRENCY = 2;

    async function worker() {
      while (true) {
        const idx = next++;
        if (idx >= total) return;
        const page = await src.getPage(idx + 1);
        const base = page.getViewport({ scale: 1 });

        // Deteksi halaman scan: satu gambar besar tanpa teks
        let renderDpi = opts.dpi;
        let hasText = false;
        try {
          const text = await page.getTextContent();
          hasText = text.items.some((it) => it.str && it.str.trim().length > 0);
        } catch (_) {
          hasText = true;
        }

        if (!hasText) {
          try {
            const ol = await page.getOperatorList();
            const OPS = global.pdfjsLib.OPS;
            let ctm = [1, 0, 0, 1, 0, 0];
            const stack = [];
            let imageCount = 0;
            let maxArea = 0;
            let nativeDpi = 0;
            for (let k = 0; k < ol.fnArray.length; k++) {
              const fn = ol.fnArray[k];
              if (fn === OPS.save) stack.push(ctm.slice());
              else if (fn === OPS.restore) ctm = stack.pop() || ctm;
              else if (fn === OPS.transform) {
                const m = ol.argsArray[k];
                ctm = mulCTM([m[0], m[1], m[2], m[3], m[4], m[5]], ctm);
              } else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
                imageCount++;
                const w = Math.hypot(ctm[0], ctm[1]);
                const h = Math.hypot(ctm[2], ctm[3]);
                maxArea = Math.max(maxArea, w * h);
                const id = ol.argsArray[k][0];
                const obj = await new Promise((resolve) => {
                  let done = false;
                  const finish = (v) => { if (!done) { done = true; resolve(v); } };
                  try {
                    const p = page.objs.get(id, finish);
                    if (p && typeof p.then === "function") p.then(finish, () => finish(null));
                  } catch (_) {
                    finish(null);
                  }
                  setTimeout(() => finish(null), 1200);
                });
                if (obj && obj.width && obj.height) {
                  const d = Math.max(obj.width / (w / 72), obj.height / (h / 72));
                  if (d > nativeDpi) nativeDpi = d;
                }
              }
            }
            const pageArea = base.width * base.height;
            if (imageCount === 1 && maxArea >= pageArea * 0.8 && nativeDpi > 0) {
              // jangan pernah melakukan upsample pada halaman scan
              renderDpi = Math.min(opts.dpi, Math.round(nativeDpi));
            }
          } catch (_) {
            /* gunakan DPI target */
          }
        }

        const scale = renderDpi / 72;
        const vp = page.getViewport({ scale });
        const canvas = newCanvas(vp.width, vp.height);
        const c2 = canvas.getContext("2d", { alpha: false });
        c2.imageSmoothingEnabled = true;
        c2.imageSmoothingQuality = "high";
        c2.fillStyle = "#ffffff";
        c2.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: c2, viewport: vp, background: "#ffffff" }).promise;

        // halaman berteks perlu kualitas lebih tinggi agar tidak buram
        let q = opts.quality;
        if (hasText) q = Math.min(0.94, q + 0.06);
        else q = Math.max(0.4, q - 0.04);

        if (opts.gray) toGrayscale(canvas);

        const blob = await canvasToBlob(canvas, "image/jpeg", q);
        const jpg = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
        const pg = out.addPage([base.width, base.height]);
        pg.drawImage(jpg, { x: 0, y: 0, width: base.width, height: base.height });

        canvas.width = canvas.height = 0;
        try { page.cleanup(); } catch (_) {}

        done++;
        if (onProgress) {
          onProgress("Merender halaman " + done + " dari " + total + "…", done / total);
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, total)) }, worker));
    try { await src.destroy(); } catch (_) {}

    const bytes = await out.save({ useObjectStreams: true, addDefaultPage: false });
    return { bytes, pageCount: total, stats: { mode: "raster" } };
  }

  /* Pastikan masukan benar-benar PDF yang bisa dibuka. */
  async function assertUsablePdf(inputBytes) {
    if (!inputBytes || inputBytes.length < 32) {
      throw new Error("Berkas terlalu kecil atau rusak, bukan PDF yang valid.");
    }
    const head = new TextDecoder("latin1").decode(inputBytes.slice(0, 1024));
    if (!head.includes("%PDF-")) {
      throw new Error("Berkas ini bukan PDF yang valid.");
    }
    // load tanpa thumbnail: cukup untuk mendeteksi kerusakan struktur
    let pageCount = 0;
    try {
      const doc = await PDFDocument.load(inputBytes, { updateMetadata: false, throwOnInvalidObject: false });
      pageCount = doc.getPageCount();
    } catch (err) {
      const msg = String((err && err.message) || "").toLowerCase();
      if (msg.includes("encrypt")) {
        throw new Error("PDF ini dilindungi kata sandi. Buka dulu tanpa proteksi, lalu kompres.");
      }
      if (msg.includes("password")) {
        throw new Error("PDF ini dilindungi kata sandi dan tidak dapat diproses.");
      }
      throw new Error("Berkas PDF rusak atau tidak lengkap dan tidak dapat dibuka.");
    }
    if (!pageCount) {
      throw new Error("PDF ini tidak memiliki halaman.");
    }
  }

  /* ============================================================
     API publik
     ============================================================ */
  async function compress(inputBytes, opts = {}, onProgress) {
    const settings = {
      mode: opts.mode || "optimal",
      dpi: Math.max(72, Math.min(400, Math.round(opts.dpi || 200))),
      quality: Math.max(0.3, Math.min(0.98, opts.quality ?? 0.82)),
      gray: !!opts.gray,
      cleanMeta: opts.cleanMeta !== false,
      neverBigger: opts.neverBigger !== false,
    };

    // beri pesan yang mudah dipahami, bukan error internal pdf-lib/pdf.js
    try {
      await assertUsablePdf(inputBytes);
    } catch (err) {
      throw new Error(err && err.message ? err.message : "Berkas PDF tidak dapat diproses.");
    }

    if (settings.mode === "raster") {
      // Raster: coba turunkan kualitas (lalu resolusi) bila hasilnya
      // lebih besar dari berkas asli — hasil tidak boleh membengkak.
      let attempt = { dpi: settings.dpi, quality: settings.quality, gray: settings.gray };
      let res = await rasterFile(inputBytes, attempt, onProgress);
      let tries = 0;
      while (settings.neverBigger && res.bytes.length >= inputBytes.length && tries < 2) {
        tries++;
        attempt =
          attempt.quality > 0.55
            ? {
                dpi: attempt.dpi,
                quality: Math.max(0.45, Math.round((attempt.quality - 0.12) * 100) / 100),
                gray: attempt.gray,
              }
            : {
                dpi: Math.max(96, Math.round(attempt.dpi * 0.8)),
                quality: attempt.quality,
                gray: attempt.gray,
              };
        res = await rasterFile(inputBytes, attempt, onProgress);
      }
      return finalize(res, inputBytes, settings);
    }

    const doc = await PDFDocument.load(inputBytes, {
      updateMetadata: false,
      throwOnInvalidObject: false,
    });

    if (settings.cleanMeta) cleanMetadata(doc);
    const pruned = pruneOrphans(doc);

    let imageStats = null;
    if (settings.mode === "optimal") {
      imageStats = await downsampleImages(doc, settings, onProgress);
    }

    const bytes = await doc.save({ useObjectStreams: true, addDefaultPage: false });
    return finalize(
      { bytes, pageCount: doc.getPageCount(), stats: { mode: settings.mode, pruned, images: imageStats } },
      inputBytes,
      settings
    );
  }

  function finalize(res, inputBytes, settings) {
    const outLen = res.bytes.length;
    const inLen = inputBytes.length;
    if (settings.neverBigger && outLen >= inLen) {
      return {
        bytes: inputBytes,
        pageCount: res.pageCount,
        unchanged: true,
        stats: Object.assign({}, res.stats, { outputSize: inLen, inputSize: inLen }),
      };
    }
    return {
      bytes: res.bytes,
      pageCount: res.pageCount,
      unchanged: false,
      stats: Object.assign({}, res.stats, { outputSize: outLen, inputSize: inLen }),
    };
  }

  /* ============================================================
     Perkiraan ukuran hasil kompresi
     ------------------------------------------------------------
     • Dokumen kecil-menengah: dokumen dikompres utuh, jadi
       angkanya PERSIS sama dengan hasil kompresi sebenarnya.
     • Dokumen besar: hanya sebagian halaman yang diproses, lalu
       hasilnya diekstrapolasi secara terpisah untuk gambar dan
       non-gambar (stratified estimator) supaya tidak meleset jauh
       ketika halaman foto berada di luar sampel.
     ============================================================ */
  const EST_EXACT_MAX_PAGES = 30;
  const EST_SAMPLE_PAGES = 4;

  /* Halaman sampel: tersebar merata di seluruh dokumen. */
  function sampleIndices(n, take) {
    const count = Math.max(1, Math.min(take, n));
    if (count === 1) return [0];
    const out = [];
    for (let i = 0; i < count; i++) {
      out.push(Math.round((i * (n - 1)) / (count - 1)));
    }
    return [...new Set(out)].sort((a, b) => a - b);
  }

  /* Jumlah byte gambar yang dipakai tiap halaman. */
  async function pageImageWeights(doc, pages) {
    const ctx = doc.context;
    const out = [];
    for (const page of pages) {
      let bytes = 0;
      try {
        const placements = await collectPlacements(doc, page);
        for (const [, place] of placements) {
          const s = ctx.lookup(place.ref);
          if (s instanceof PDFRawStream) bytes += s.getContentsSize();
        }
      } catch (_) {
        /* abaikan */
      }
      out.push(bytes);
    }
    return out;
  }

  /* Total byte objek gambar UNIK yang dipakai sekumpulan halaman.
     Gambar yang dipakai bersama beberapa halaman hanya dihitung
     satu kali — kalau tidak, ukuran dokumen akan terlewat. */
  async function uniqueImageBytes(doc, pages) {
    const ctx = doc.context;
    const seen = new Set();
    let bytes = 0;
    for (const page of pages) {
      try {
        const placements = await collectPlacements(doc, page);
        for (const [key, place] of placements) {
          if (seen.has(key)) continue;
          seen.add(key);
          const s = ctx.lookup(place.ref);
          if (s instanceof PDFRawStream) bytes += s.getContentsSize();
        }
      } catch (_) {
        /* abaikan */
      }
    }
    return bytes;
  }

  /* Pilih halaman sampel yang mewakili dokumen: halaman paling
     berat (biasanya berisi foto) selalu ikut, sisanya tersebar. */
  function chooseSamplePages(weights, take) {
    const n = weights.length;
    const totalW = weights.reduce((a, b) => a + b, 0);
    const chosen = new Set();

    if (totalW > 0) {
      const heavy = weights
        .map((w, i) => ({ w, i }))
        .filter((x) => x.w > 0)
        .sort((a, b) => b.w - a.w);
      let acc = 0;
      const half = Math.max(1, Math.ceil(take / 2));
      for (const { w, i } of heavy) {
        if (chosen.size >= half) break;
        chosen.add(i);
        acc += w;
        if (acc >= totalW * 0.5) break;
      }
    }

    // lengkapi dengan halaman yang tersebar merata
    for (const i of sampleIndices(n, take)) chosen.add(i);

    return [...chosen].sort((a, b) => a - b);
  }

  /* Perlebar sampel: tambah halaman sehingga jumlah sampel menjadi dua
     kali lipat. Dipakai sebagai titik kedua pada model extrapolasi
     bagian non-gambar (biaya tetap vs biaya per halaman). */
  function widenSample(picked, pageCount) {
    const set = new Set(picked);
    const out = [...picked];
    const want = Math.min(pageCount, picked.length * 2);
    for (let i = 0; i < pageCount && out.length < want; i++) {
      if (set.has(i)) continue;
      set.add(i);
      out.push(i);
    }
    return out.sort((a, b) => a - b);
  }

  async function estimate(inputBytes, opts = {}) {
    const settings = {
      mode: opts.mode || "optimal",
      dpi: Math.max(72, Math.min(400, Math.round(opts.dpi || 200))),
      quality: Math.max(0.3, Math.min(0.98, opts.quality ?? 0.82)),
      gray: !!opts.gray,
      cleanMeta: opts.cleanMeta !== false,
      neverBigger: opts.neverBigger !== false,
    };

    const totalIn = inputBytes.length;
    if (!totalIn) return null;

    let doc;
    try {
      doc = await PDFDocument.load(inputBytes, { updateMetadata: false, throwOnInvalidObject: false });
    } catch (_) {
      return null;
    }
    const pageCount = doc.getPageCount();
    if (!pageCount) return null;

    const inner = Object.assign({}, settings, { neverBigger: false });

    /* --- 1. Dokumen kecil: kompres utuh, angka persis --- */
    if (pageCount <= EST_EXACT_MAX_PAGES) {
      try {
        const res = await compress(inputBytes, inner);
        if (!res || !res.bytes || !res.bytes.length) return null;
        let size = res.bytes.length;
        if (settings.neverBigger) size = Math.min(size, totalIn);
        return { size, exact: true, sampled: pageCount, pages: pageCount, originalSize: totalIn };
      } catch (_) {
        return null;
      }
    }

    /* --- 2. Dokumen besar: sampel + estimasi terstratifikasi --- */
    const pages = doc.getPages();
    const weights = await pageImageWeights(doc, pages);
    const picked = chooseSamplePages(weights, EST_SAMPLE_PAGES);
    if (!picked.length) return null;

    /*_byte gambar unik_ (gambar bersama dihitung sekali) */
    const totalImg = await uniqueImageBytes(doc, pages);

    /* Bangun sampel berisi halaman terpilih, lalu sampel yang lebih luas.
       Dua titik ini dipakai untuk memisahkan biaya tetap (font, sumber
       daya bersama) dari biaya per halaman. Tanpa pemisahan ini,
       dokumen yang tidak punya gambar bisa meleset jauh karena sumber
       daya bersama hanya tersimpan sekali di berkas akhir. */
    const buildSample = async (indices) => {
      const sdoc = await PDFDocument.create();
      const copied = await sdoc.copyPages(doc, indices);
      copied.forEach((p) => sdoc.addPage(p));
      const bytes = await sdoc.save({ useObjectStreams: true, addDefaultPage: false });
      const img = await uniqueImageBytes(doc, indices.map((i) => pages[i]));
      return { n: indices.length, bytes, img };
    };

    /* Kompres satu sampel lalu pisahkan kontribusi gambar & non-gambar. */
    const runSample = async (sample) => {
      const res = await compress(sample.bytes, inner);
      if (!res || !res.bytes || !res.bytes.length) return null;
      let outImg = 0;
      try {
        const outDoc = await PDFDocument.load(res.bytes, { updateMetadata: false, throwOnInvalidObject: false });
        outImg = await uniqueImageBytes(outDoc, outDoc.getPages());
      } catch (_) {
        outImg = 0;
      }
      return {
        n: sample.n,
        img: sample.img,
        outImg,
        outTotal: res.bytes.length,
        outNon: Math.max(0, res.bytes.length - outImg),
      };
    };

    let s1;
    let s2;
    try {
      s1 = await buildSample(picked);
      const wide = widenSample(picked, pages.length);
      s2 = wide.length > s1.n ? await buildSample(wide) : null;
    } catch (_) {
      return null;
    }
    if (!s1 || !s1.bytes || !s1.bytes.length) return null;

    let r1;
    try {
      r1 = await runSample(s1);
    } catch (_) {
      r1 = null;
    }
    if (!r1) return null;

    /* Rasio gambar: berapa byte gambar yang tersisa per byte gambar
       sebelum dikompresi. Berlaku untuk seluruh dokumen karena gambar
       dikompresi satu per satu. */
    const rImg = r1.img > 0 ? r1.outImg / r1.img : 1;

    let size;
    if (s2) {
      let r2 = null;
      try {
        r2 = await runSample(s2);
      } catch (_) {
        r2 = null;
      }
      if (r2 && r2.n > r1.n) {
        /* Model dua titik untuk bagian non-gambar: out(P) = A + B*P */
        const B = (r2.outNon - r1.outNon) / (r2.n - r1.n);
        const A = r1.outNon - B * r1.n;
        const estNon = Math.max(0, A + B * pageCount);
        size = Math.round(rImg * totalImg + estNon);
      } else {
        size = Math.round(rImg * totalImg + (r1.outNon / Math.max(1, r1.n)) * pageCount);
      }
    } else {
      /* Cadangan: hitung per halaman bila sampel kedua tidak tersedia. */
      const perPage = r1.outNon / Math.max(1, r1.n);
      size = Math.round(rImg * totalImg + perPage * pageCount);
    }

    if (!Number.isFinite(size) || size <= 0) return null;
    if (settings.neverBigger) size = Math.min(size, totalIn);
    return {
      size,
      exact: false,
      sampled: picked.length,
      pages: pageCount,
      originalSize: totalIn,
    };
  }

  global.PDFCompressor = {
    compress,
    estimate,
    PRODUCER,
    // dipakai untuk pengujian internal
    _internals: {
      collectPlacements,
      pruneOrphans,
      scanContent,
      decodeStreamData,
      parseColorSpace,
      decodeImageToSource,
      rawToImageData,
      sampleIndices,
      pageImageWeights,
      uniqueImageBytes,
      chooseSamplePages,
      widenSample,
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
