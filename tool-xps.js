/* ============================================================
   Ekspor XPS (OpenXPS / XPS Document) dari editor PDF.
   ------------------------------------------------------------
   Format XPS adalah paket OPC (seperti .docx/.xlsx):
     [Content_Types].xml
     _rels/.rels                     -> FixedDocumentSequence.fdseq
     FixedDocumentSequence.fdseq     -> Documents/1/FixedDocument.fdoc
     Documents/1/FixedDocument.fdoc  -> Documents/1/Pages/1.fpage
     Documents/1/Pages/1.fpage       -> isi halaman (Path + Glyphs)
     Documents/1/Resources/...       -> font (odttf) & gambar

   Catatan penting: relasi akar (_rels/.rels) harus memakai tipe
   "fixedrepresentation". Tanpa tipe itu pembaca XPS (MuPDF, XPS
   Essentials) tidak mengenali paket sebagai dokumen dan hanya
   memperlakukannya sebagai arsip ZIP biasa.

   Isi halaman disusun berlapis:
     1. latar  : raster halaman PDF (teks lama sudah ditutup)
     2. gambar : ImageBrush di dalam Path
     3. teks   : Glyphs vektor memakai font yang ditanam (ODTTF)

   Font di-*embed* supaya hasil tetap sama di semua penampil XPS,
   dan teks hasil edit tetap berupa teks vektor (bukan gambar).
   Teks asli PDF yang tidak disentuh juga ditulis ulang sebagai
   lapisan Glyphs transparan (Opacity="0") supaya seluruh isi
   halaman tetap bisa dicari dan disalin, tanpa mengubah tampilan.
   ============================================================ */
(function () {
  "use strict";

  /* 1 poin PDF = 96/72 unit XPS (unit XPS = 1/96 inci). */
  const UNIT = 96 / 72;
  const NS_XPS = "http://schemas.microsoft.com/xps/2005/06";
  const NS_XPS_KEY = "http://schemas.microsoft.com/xps/2005/06/resourcedictionary-key";
  const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
  const NS_CT = "http://schemas.openxmlformats.org/package/2006/content-types";
  /* Tipe relasi yang diwajibkan XPS untuk tiap sumber daya yang dipakai
     halaman (gambar & font). */
  const REL_REQUIRED = "http://schemas.microsoft.com/xps/2005/06/required-resource";
  /* Tipe relasi paket: "fixedrepresentation" menandai akar dokumen
     (FixedDocumentSequence). Tanpa tipe ini, pembaca XPS tidak mengenali
     paket dan memperlakukannya sebagai arsip ZIP biasa. */
  const REL_START_PART = "http://schemas.microsoft.com/xps/2005/06/fixedrepresentation";
  const REL_FIXED_DOCUMENT = "http://schemas.microsoft.com/xps/2005/06/fixed-document";
  const REL_FIXED_PAGE = "http://schemas.microsoft.com/xps/2005/06/fixedpage";

  const TEXT_ASCENT = 0.78;

  /* ============================================================
     Parser TTF — hanya bagian yang perlu: cmap (unicode -> glyph)
     dan hmtx (lebar advance) supaya teks bisa diukur & diposisikan.
     ============================================================ */
  function parseTtf(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = (o) => dv.getUint16(o);
    const i16 = (o) => dv.getInt16(o);
    const u32 = (o) => dv.getUint32(o);
    const tag = (o) => String.fromCharCode(
      dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));

    const numTables = u16(4);
    const tables = {};
    for (let i = 0; i < numTables; i++) {
      const off = 12 + i * 16;
      tables[tag(off)] = { offset: u32(off + 8), length: u32(off + 12) };
    }
    const head = tables.head, hhea = tables.hhea, hmtx = tables.hmtx, cmapT = tables.cmap;
    if (!head || !hhea || !hmtx || !cmapT) {
      throw new Error("Berkas font tidak lengkap (tabel head/hhea/hmtx/cmap hilang).");
    }
    const unitsPerEm = u16(head.offset + 18) || 1000;
    const numHMetrics = u16(hhea.offset + 34);
    const adv = [];
    for (let i = 0; i < numHMetrics; i++) adv.push(u16(hmtx.offset + i * 4));
    const fallbackAdv = numHMetrics ? adv[numHMetrics - 1] : 0;

    /* pilih subtabel cmap paling lengkap */
    const n = u16(cmapT.offset + 2);
    let best = null;
    for (let i = 0; i < n; i++) {
      const rec = cmapT.offset + 4 + i * 8;
      const plat = u16(rec), enc = u16(rec + 2);
      const off = cmapT.offset + u32(rec + 4);
      let score = 1;
      if (plat === 3 && enc === 10) score = 5;
      else if (plat === 3 && enc === 1) score = 4;
      else if (plat === 0) score = 3;
      else if (plat === 3 && enc === 0) score = 2;
      if (!best || score > best.score) best = { off, score };
    }

    const map = new Map();
    if (best) {
      const off = best.off;
      const fmt = u16(off);
      if (fmt === 4) {
        const segCount = u16(off + 6) / 2;
        const endO = off + 14;
        const startO = endO + segCount * 2 + 2;
        const deltaO = startO + segCount * 2;
        const rangeO = deltaO + segCount * 2;
        for (let s = 0; s < segCount; s++) {
          const end = u16(endO + s * 2);
          const start = u16(startO + s * 2);
          if (start === 0xffff) continue;
          const delta = i16(deltaO + s * 2);
          const ro = u16(rangeO + s * 2);
          for (let c = start; c <= end && c !== 0xffff; c++) {
            let gid;
            if (ro === 0) {
              gid = (c + delta) & 0xffff;
            } else {
              const gi = rangeO + s * 2 + ro + (c - start) * 2;
              if (gi + 1 >= dv.byteLength) continue;
              gid = u16(gi);
              if (gid !== 0) gid = (gid + delta) & 0xffff;
            }
            if (gid) map.set(c, gid);
          }
        }
      } else if (fmt === 12) {
        const nGroups = u32(off + 12);
        for (let g = 0; g < nGroups; g++) {
          const go = off + 16 + g * 12;
          const s = u32(go), e = u32(go + 4), sg = u32(go + 8);
          if (e < s || e - s > 0x10000) continue;
          for (let c = s; c <= e; c++) map.set(c, sg + (c - s));
        }
      } else if (fmt === 6) {
        const first = u16(off + 6), cnt = u16(off + 8);
        for (let i = 0; i < cnt; i++) {
          const gid = u16(off + 10 + i * 2);
          if (gid) map.set(first + i, gid);
        }
      } else if (fmt === 0) {
        for (let c = 0; c < 256; c++) {
          const gid = dv.getUint8(off + 6 + c);
          if (gid) map.set(c, gid);
        }
      }
    }

    return {
      unitsPerEm,
      map,
      gidOf(code) {
        const g = map.get(code);
        return g || 0;
      },
      advanceOf(gid) {
        if (!numHMetrics) return 0;
        return gid < numHMetrics ? adv[gid] : fallbackAdv;
      },
      /* lebar satu karakter dalam unit font */
      advanceOfChar(ch) {
        return this.advanceOf(this.gidOf(ch.codePointAt(0) || 32));
      },
    };
  }

  /* ============================================================
     Font subset (base64) -> byte asli, lalu di-*obfuscate* jadi
     ODTTF. Aturan XPS: 32 byte pertama font di-XOR dengan kunci
     GUID (16 byte, dibalik). Nama berkas font memakai GUID itu
     juga supaya kunci dan nama selalu cocok.
     ============================================================ */
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function fnv1a(str, seed) {
    let h = seed >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  function guidFor(key) {
    let hex = "";
    let seed = 0x811c9dc5;
    while (hex.length < 32) {
      seed = fnv1a(key + "|" + hex.length, seed);
      hex += ("00000000" + seed.toString(16)).slice(-8);
    }
    hex = hex.slice(0, 32);
    return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) +
      "-" + hex.slice(16, 20) + "-" + hex.slice(20, 32);
  }

  function obfuscateFont(bytes, guid) {
    const hex = String(guid).replace(/-/g, "");
    const key = new Uint8Array(16);
    for (let i = 0; i < 16; i++) key[i] = parseInt(hex.substr(i * 2, 2), 16);
    key.reverse();
    const out = new Uint8Array(bytes.length);
    out.set(bytes);
    for (let i = 0; i < Math.min(32, out.length); i++) out[i] ^= key[i % 16];
    return out;
  }

  /* ============================================================
     Peta gaya font editor -> face yang ditanam.
     ============================================================ */
  function faceKey(fontId, bold, italic) {
    let fam = "sans";
    if (fontId === "times" || fontId === "georgia") fam = "serif";
    else if (fontId === "courier") fam = "mono";
    return fam + (bold ? "Bold" : "") + (italic ? "Italic" : "");
  }

  /* ============================================================
     Pengukuran & pemenggalan baris memakai metrik font asli.
     ============================================================ */
  function measureXps(text, sizePt, font, letterSpacing) {
    if (!text) return 0;
    const upem = font.unitsPerEm || 1000;
    let w = 0;
    for (const ch of text) {
      w += (font.advanceOfChar(ch) / upem) * sizePt;
    }
    const n = Array.from(text).length;
    return w + (letterSpacing || 0) * Math.max(0, n - 1);
  }

  function wrapTextXps(text, maxW, sizePt, font, letterSpacing) {
    const out = [];
    for (const para of String(text == null ? "" : text).split(/\r?\n/)) {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) { out.push(""); continue; }
      let cur = "";
      for (const w of words) {
        const t = cur ? cur + " " + w : w;
        if (maxW > 0 && cur && measureXps(t, sizePt, font, letterSpacing) > maxW) {
          out.push(cur);
          cur = w;
        } else {
          cur = t;
        }
      }
      out.push(cur);
    }
    return out;
  }

  /* ============================================================
     Warna
     ============================================================ */
  function argb(color, fallback) {
    const c = String(color || "").trim();
    let m = /^#?([0-9a-f]{6})$/i.exec(c);
    if (m) return "#FF" + m[1].toUpperCase();
    m = /^#?([0-9a-f]{3})$/i.exec(c);
    if (m) {
      const h = m[1];
      return "#FF" + h[0] + h[0] + h[1] + h[1] + h[2] + h[2].toUpperCase();
    }
    m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(c);
    if (m) {
      const r = Number(m[1]) & 255, g = Number(m[2]) & 255, b = Number(m[3]) & 255;
      return "#FF" + [r, g, b].map((x) => ("0" + x.toString(16)).slice(-2)).join("").toUpperCase();
    }
    return fallback || "#FF000000";
  }

  function xmlEsc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }

  function num(v) {
    const n = Number(v) || 0;
    return (Math.round(n * 100) / 100).toString();
  }

  /* ============================================================
     Penyusun paket XPS
     ============================================================ */
  async function buildXps(opts) {
    const o = opts || {};
    const pages = o.pages || [];
    if (!pages.length) throw new Error("Tidak ada halaman untuk diekspor.");
    const F = window.PDFToolsFonts;
    if (!F || !F.data) {
      throw new Error("Berkas font tidak ditemukan (vendor/fonts/fonts.js).");
    }
    if (!window.JSZip) throw new Error("JSZip tidak termuat.");

    const zip = new JSZip();
    /* font yang benar-benar dipakai */
    const usedFaces = new Set();
    for (const p of pages) {
      for (const t of (p.texts || [])) {
        usedFaces.add(faceKey(t.font, !!t.bold, !!t.italic));
      }
    }
    const faces = new Map();
    for (const key of usedFaces) {
      const b64 = F.data[key];
      if (!b64) continue;
      const raw = b64ToBytes(b64);
      const parsed = parseTtf(raw);
      const guid = guidFor("pemisah-pdf/" + key);
      /* lokasi font di paket; markup memakai jalur relatif terhadap
         bagian halaman (../Resources/Fonts/...) */
      const part = "Documents/1/Resources/Fonts/" + guid + ".odttf";
      const rel = "../Resources/Fonts/" + guid + ".odttf";
      zip.file(part, obfuscateFont(raw, guid));
      faces.set(key, {
        key, parsed, guid, part, rel,
        family: (F.meta && F.meta[key] && F.meta[key].family) || "Open Sans",
        style: (F.meta && F.meta[key] && F.meta[key].style) || "Regular",
      });
    }

    /* daftar isi paket */
    const pageRels = [];
    const fdocPages = [];

    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      const W = (p.widthPt || 595) * UNIT;
      const H = (p.heightPt || 842) * UNIT;
      const rels = [];
      const body = [];
      /* kuas (brush) disimpan di kamus sumber daya halaman —
         ini bentuk kanonik yang dipakai semua penampil XPS. */
      const resDefs = [];
      let brushNo = 0;
      const imageBrush = (part, vw, vh, vx, vy, vwx, vhy) => {
        const key = "b" + (++brushNo);
        resDefs.push(
          `<ImageBrush x:Key="${key}" ImageSource="${part}" ` +
          `ViewboxUnits="Absolute" ViewportUnits="Absolute" TileMode="None" Stretch="Fill" ` +
          `Viewbox="0,0,${num(vw)},${num(vh)}" ` +
          `Viewport="${num(vx)},${num(vy)},${num(vwx)},${num(vhy)}" />`);
        return key;
      };
      const addRel = (target) => {
        rels.push({ id: "rId" + (rels.length + 1), type: REL_REQUIRED, target });
      };

      /* latar halaman (raster) */
      if (p.background && p.background.data) {
        const name = "bg" + (i + 1) + ".png";
        const part = "Documents/1/Resources/Images/" + name;
        const relPath = "../Resources/Images/" + name;
        zip.file(part, dataUrlToBytes(p.background.data));
        addRel(relPath);
        const key = imageBrush(relPath, p.background.w || 1, p.background.h || 1, 0, 0, W, H);
        body.push(
          `<Path Fill="{StaticResource ${key}}" ` +
          `Data="F0 M 0,0 L ${num(W)},0 ${num(W)},${num(H)} 0,${num(H)}Z" />`);
      }

      /* gambar yang disisipkan / digeser */
      for (const im of (p.images || [])) {
        if (!im.data) continue;
        const name = "im" + (i + 1) + "_" + (body.length + 1) + ".png";
        const part = "Documents/1/Resources/Images/" + name;
        const relPath = "../Resources/Images/" + name;
        zip.file(part, dataUrlToBytes(im.data));
        addRel(relPath);
        const x0 = im.x * UNIT, x1 = (im.x + im.w) * UNIT;
        const y0 = (p.heightPt - (im.y + im.h)) * UNIT;
        const y1 = (p.heightPt - im.y) * UNIT;
        const key = imageBrush(relPath, im.pw || 1, im.ph || 1, x0, y0, x1 - x0, y1 - y0);
        body.push(
          `<Path Fill="{StaticResource ${key}}" ` +
          `Data="F0 M ${num(x0)},${num(y0)} L ${num(x1)},${num(y0)} ` +
          `${num(x1)},${num(y1)} ${num(x0)},${num(y1)}Z" />`);
      }

      /* teks (vektor) */
      for (const t of (p.texts || [])) {
        const key = faceKey(t.font, !!t.bold, !!t.italic);
        const face = faces.get(key);
        if (!face) continue;
        if (!face.relDone) {
          face.relDone = true;
        }
        const size = t.size || 12;
        const emSize = size * UNIT;
        const ls = t.letterSpacing || 0;
        /* Lapisan transparan (teks asli PDF) tidak boleh di-wrap ulang:
           teks sudah/baris dari PDF asli, jadi dipakai apa adanya agar
           posisi dan urutan hasil pencarian tetap sama. */
        const transparan = t.opacity != null && t.opacity < 1;
        const lines = transparan
          ? [t.text || ""]
          : wrapTextXps(t.text || "", t.w || 0, size, face.parsed, ls);
        const step = size * (t.lineHeight || 1.2);
        const baseY = t.by != null ? t.by : t.y + t.h * TEXT_ASCENT;
        const fill = argb(t.color, "#FF111111");
        for (let li = 0; li < lines.length; li++) {
          const line = lines[li];
          if (!line) continue;
          const wLine = measureXps(line, size, face.parsed, ls);
          let x = t.x || 0;
          if (t.align === "center") x = (t.x || 0) + ((t.w || 0) - wLine) / 2;
          else if (t.align === "right") x = (t.x || 0) + (t.w || 0) - wLine;
          const yPdf = baseY - li * step;
          const originY = (p.heightPt - yPdf) * UNIT;

          const chars = Array.from(line);
          const gids = chars.map((ch) => face.parsed.gidOf(ch.codePointAt(0)));
          /* Atribut Indices: daftar indeks glyph dipisah titik koma,
             satu entri per kode unit UTF-16. Karakter yang tidak ada
             di cmap ditulis sebagai entri kosong supaya penampil
             mencarinya sendiri lewat tabel cmap font. */
          const indices = gids.map((g, i) => (g ? String(g) : "")).join(";");
          const fontAttrs =
            `FontUri="${face.rel}" FontFamilyName="${xmlEsc(face.family)}" ` +
            `FontRenderingEmSize="${num(emSize)}" ` +
            `FontStyle="${face.style.indexOf("Italic") >= 0 ? "Italic" : "Normal"}" ` +
            `FontWeight="${face.style.indexOf("Bold") >= 0 ? "Bold" : "Normal"}"`;
          /* Lapisan teks tak kasat mata (opacity 0) dipakai supaya teks
             asli PDF ikut terindeks tanpa mengubah tampilan visual. */
          const opAttr = t.opacity != null && t.opacity < 1
            ? `Opacity="${num(t.opacity)}" ` : "";

          if (ls) {
            /* ada jarak antar huruf -> tiap huruf jadi elemen sendiri */
            let cx = x;
            for (let ci = 0; ci < chars.length; ci++) {
              const ch = chars[ci];
              const adv = (face.parsed.advanceOf(gids[ci]) / face.parsed.unitsPerEm) * size;
              body.push(
                `<Glyphs ${opAttr}Fill="${fill}" ${fontAttrs} ` +
                `OriginX="${num(cx * UNIT)}" OriginY="${num(originY)}" ` +
                `UnicodeString="${xmlEsc(ch)}" Indices="${gids[ci] ? gids[ci] : ""}" />`);
              cx += adv + ls;
            }
          } else {
            body.push(
              `<Glyphs ${opAttr}Fill="${fill}" ${fontAttrs} ` +
              `OriginX="${num(x * UNIT)}" OriginY="${num(originY)}" ` +
              `UnicodeString="${xmlEsc(line)}" Indices="${indices}" />`);
          }

          /* garis bawah & coret -> garis tipis */
          if (t.underline || t.strike) {
            const th = Math.max(0.5, size * 0.06);
            if (t.underline) {
              const gy = (p.heightPt - (yPdf - size * 0.12)) * UNIT;
              body.push(lineRect(x, gy, wLine, th));
            }
            if (t.strike) {
              const gy = (p.heightPt - (yPdf - size * 0.28)) * UNIT;
              body.push(lineRect(x, gy, wLine, th));
            }
          }
        }
      }

      /* relasi font untuk halaman ini */
      const usedHere = new Set();
      for (const t of (p.texts || [])) {
        usedHere.add(faceKey(t.font, !!t.bold, !!t.italic));
      }
      for (const key of usedHere) {
        const face = faces.get(key);
        if (!face) continue;
        addRel(face.rel);
      }

      const resXml = resDefs.length
        ? `<FixedPage.Resources>\n  <ResourceDictionary>\n` +
          resDefs.map((d) => "    " + d).join("\n") +
          `\n  </ResourceDictionary>\n</FixedPage.Resources>\n`
        : "";
      const fpage = `<?xml version="1.0" encoding="utf-8"?>\n` +
        `<FixedPage xmlns="${NS_XPS}" xmlns:x="${NS_XPS_KEY}" xml:lang="id-ID" ` +
        `Width="${num(W)}" Height="${num(H)}">\n` +
        resXml +
        body.join("\n") + `\n</FixedPage>\n`;
      zip.file(`Documents/1/Pages/${i + 1}.fpage`, fpage);
      pageRels.push(rels);
      fdocPages.push(`Pages/${i + 1}.fpage`);
    }

    /* FixedDocument — daftar halaman; Source relatif terhadap
       letak berkas .fdoc (Documents/1/). */
    const fdoc = `<?xml version="1.0" encoding="utf-8"?>\n` +
      `<FixedDocument xmlns="${NS_XPS}" xml:lang="id-ID">\n` +
      fdocPages.map((s) => `  <PageContent Source="${s}" />`).join("\n") +
      `\n</FixedDocument>\n`;
    zip.file("Documents/1/FixedDocument.fdoc", fdoc);

    /* FixedDocumentSequence */
    const fdseq = `<?xml version="1.0" encoding="utf-8"?>\n` +
      `<FixedDocumentSequence xmlns="${NS_XPS}" xml:lang="id-ID">\n` +
      `  <DocumentReference Source="Documents/1/FixedDocument.fdoc" />\n` +
      `</FixedDocumentSequence>\n`;
    zip.file("FixedDocumentSequence.fdseq", fdseq);

    /* relasi tiap halaman */
    pageRels.forEach((rels, i) => {
      zip.file(`Documents/1/Pages/_rels/${i + 1}.fpage.rels`, relsXml(rels));
    });

    /* Relasi paket. Tipe "fixedrepresentation" adalah penanda yang
       dicari pembaca XPS (MuPDF, XPS Essentials, WPF) untuk menemukan
       akar dokumen; tanpa itu paket dianggap ZIP biasa. */
    zip.file("_rels/.rels", relsXml([
      { id: "rId1", type: REL_START_PART, target: "/FixedDocumentSequence.fdseq" },
    ]));
    zip.file("_rels/FixedDocumentSequence.fdseq.rels", relsXml([
      { id: "rId1", type: REL_FIXED_DOCUMENT, target: "/Documents/1/FixedDocument.fdoc" },
    ]));
    zip.file("Documents/1/_rels/FixedDocument.fdoc.rels", relsXml(
      fdocPages.map((s, i) => ({
        id: "rId" + (i + 1),
        type: REL_FIXED_PAGE,
        target: "/Documents/1/" + s,
      }))));

    /* content types */
    const ct = `<?xml version="1.0" encoding="utf-8"?>\n` +
      `<Types xmlns="${NS_CT}">\n` +
      `  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />\n` +
      `  <Default Extension="fdseq" ContentType="application/vnd.ms-package.xps-fixeddocumentsequence+xml" />\n` +
      `  <Default Extension="fdoc" ContentType="application/vnd.ms-package.xps-fixeddocument+xml" />\n` +
      `  <Default Extension="fpage" ContentType="application/vnd.ms-package.xps-fixedpage+xml" />\n` +
      `  <Default Extension="png" ContentType="image/png" />\n` +
      `  <Default Extension="odttf" ContentType="application/vnd.ms-package.obfuscated-opentype" />\n` +
      `</Types>\n`;
    zip.file("[Content_Types].xml", ct);

    const out = await zip.generateAsync({
      type: "blob",
      mimeType: "application/vnd.ms-package.xps-fixeddocument+xml",
      compression: "DEFLATE",
    });
    return out;
  }

  function lineRect(x, y, w, th) {
    return `<Path Data="F0 M ${num(x)},${num(y)} L ${num(x + w)},${num(y)} ` +
      `${num(x + w)},${num(y + th)} ${num(x)},${num(y + th)}Z" Fill="#FF000000" />`;
  }

  function relsXml(rels) {
    const body = (rels || []).map((r) =>
      `  <Relationship Id="${r.id}" Type="${r.type}" Target="${xmlEsc(r.target)}" />`).join("\n");
    return `<?xml version="1.0" encoding="utf-8"?>\n` +
      `<Relationships xmlns="${NS_PKG_REL}">\n${body}\n</Relationships>\n`;
  }

  function dataUrlToBytes(dataUrl) {
    const m = /^data:image\/png;base64,(.*)$/s.exec(String(dataUrl || ""));
    if (!m) {
      /* bukan PNG -> pakai data mentah sebagai fallback */
      const s = String(dataUrl || "").split(",")[1] || "";
      return b64ToBytes(s);
    }
    return b64ToBytes(m[1]);
  }

  window.PDFToolsXPS = {
    build: buildXps,
    parseTtf,
    obfuscateFont,
    faceKey,
    guidFor,
    measureXps,
    wrapTextXps,
    UNIT,
  };
})();
