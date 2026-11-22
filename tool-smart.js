/* ============================================================
   Alat keamanan & kecerdasan: buka kunci, lindungi, tanda
   tangan, redaksi, bandingkan, markdown, ringkasan, terjemah.
   ============================================================ */
(function () {
  "use strict";

  const C = window.PDFToolsCore;
  const K = window.PDFToolsCrypto || {};
  const {
    PDFDocument, PDFName, PDFNumber, PDFArray, PDFString, PDFHexString, PDFDict,
    register, tick, MM, loadDoc, saveDoc, openPdfjs, renderPage, canvasToBytes,
    pageText, extractText, fontFor, drawTextSafe,
  } = C;

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function hexBytes(bytes) {
    return K.hex ? K.hex(bytes) : Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function unhex(hexStr) {
    const s = String(hexStr || "").replace(/[^0-9a-fA-F]/g, "");
    const out = new Uint8Array(Math.floor(s.length / 2));
    for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
    return out;
  }

  /* Byte mentah dari objek string PDF (literal maupun heksadesimal). */
  function stringBytes(o) {
    if (!o) return new Uint8Array(0);
    const v = typeof o.value === "string" ? o.value : null;
    /* PDF text string UTF-16BE (BOM FE FF) */
    if (v && v.length >= 2 && v.charCodeAt(0) === 0xfe && v.charCodeAt(1) === 0xff) {
      const out = new Uint8Array(v.length * 2);
      for (let i = 0; i < v.length; i++) {
        const c = v.charCodeAt(i);
        out[i * 2] = (c >> 8) & 255;
        out[i * 2 + 1] = c & 255;
      }
      return out;
    }
    if (o instanceof PDFHexString) return unhex(v || "");
    if (typeof o.asBytes === "function") {
      try { return o.asBytes(); } catch (_) { /* lanjut ke fallback */ }
    }
    return v == null ? new Uint8Array(0) : enc.encode(v);
  }

  /* ============================================================
     1. Buka kunci PDF
     ============================================================ */
  register({
    id: "unlock",
    cat: "security",
    name: "Buka PDF terkunci",
    desc: "Masukkan password PDF lalu simpan salinan yang tidak lagi terkunci.",
    icon: "unlock",
    accept: ".pdf,application/pdf",
    multiple: true,
    custom: "unlock",
    fields: [],
    async run(ctx) {
      const out = [];
      for (const f of ctx.files) {
        let opened = null;
        const pw = ctx.opts.password;
        if (pw) {
          try {
            const pdfjs = await openPdfjs(f.bytes, { password: pw });
            if (typeof pdfjs.saveDocument === "function") {
              const raw = await pdfjs.saveDocument();
              if (raw && raw.length) opened = new Uint8Array(raw);
            }
            try { await pdfjs.destroy(); } catch (_) {}
          } catch (_) {
            opened = null;
          }
        }
        if (!opened) {
          const ask = window.prompt(`PDF "${f.name}" masih terkunci.\nMasukkan passwordnya:`, "");
          if (!ask) throw new Error("Dibatalkan: password tidak diberikan.");
          const pdfjs = await openPdfjs(f.bytes, { password: ask });
          if (typeof pdfjs.saveDocument === "function") {
            const raw = await pdfjs.saveDocument();
            if (raw && raw.length) opened = new Uint8Array(raw);
          }
          try { await pdfjs.destroy(); } catch (_) {}
        }
        if (!opened) throw new Error("Password salah atau PDF tidak bisa dibuka.");
        out.push({ name: C.safeName(C.baseName(f.name)) + "-terbuka.pdf", bytes: opened });
        await tick();
      }
      return out;
    },
  });

  /* ============================================================
     2. Lindungi PDF (enkripsi AES-128)
     ============================================================ */
  function encryptPdf(doc, userPassword, ownerPassword, permissions) {
    const P = permissions == null ? -1 : permissions | 0;
    const R = 4, V = 4, keyBytes = 16;
    const ctx = doc.context;
    const trailerInfo = ctx.trailerInfo;

    if (trailerInfo && trailerInfo.Encrypt) {
      throw new Error("PDF ini sudah memiliki enkripsi. Buka dulu dengan tool \"Buka PDF terkunci\".");
    }

    /* ---------- 1. File ID (16 byte) ---------- */
    let idBytes = null;
    let idArray = null;
    let idRef = null;
    const rawId = trailerInfo ? trailerInfo.ID : null;
    if (rawId) {
      const arr = ctx.lookup(rawId);
      if (arr instanceof PDFArray && arr.size() > 0) {
        const b = stringBytes(arr.get(0));
        if (b && b.length) {
          idBytes = new Uint8Array(keyBytes);
          idBytes.set(b.subarray(0, keyBytes));
          idArray = arr;
          if (rawId && typeof rawId === "object" && typeof rawId.objectNumber === "number") idRef = rawId;
        }
      }
    }
    if (!idBytes) {
      idBytes = new Uint8Array(keyBytes);
      crypto.getRandomValues(idBytes);
    }
    const idHex = hexBytes(idBytes);

    const userPad = K.padPassword(userPassword);
    const ownerPad = K.padPassword(ownerPassword || userPassword);

    /* ---------- 2. Algorithm 3: nilai /O ---------- */
    const O = K.ownerValue(ownerPad, userPad, R, keyBytes);

    /* ---------- 3. Algorithm 2: kunci berkas ---------- */
    const fileKey = K.encryptionKey(userPad, O, P, idBytes, R, keyBytes);

    /* ---------- 4. Algorithm 5: nilai /U ---------- */
    const U = K.userValue(fileKey, idBytes, R);

    /* ---------- 5. Algorithm 1: kunci per-objek (AESV2) ---------- */
    const skipRefs = new Set();
    if (idRef) skipRefs.add(idRef.toString());

    function encryptBytes(bytes, objNum, genNum) {
      return K.aesEncryptCbc(K.objectKey(fileKey, objNum, genNum), bytes);
    }

    function isString(o) { return o instanceof PDFString || o instanceof PDFHexString; }

    function encryptString(o, objNum, genNum) {
      const out = encryptBytes(stringBytes(o), objNum, genNum);
      return PDFHexString.of(hexBytes(out));
    }

    function walk(value, objNum, genNum) {
      if (!value) return value;
      if (isString(value)) return encryptString(value, objNum, genNum);
      if (value instanceof PDFArray) {
        for (let i = 0; i < value.size(); i++) {
          const v = value.get(i);
          if (isString(v)) value.set(i, encryptString(v, objNum, genNum));
          else if (v instanceof PDFDict || v instanceof PDFArray) walk(v, objNum, genNum);
        }
        return value;
      }
      if (value instanceof PDFDict) {
        for (const key of value.keys()) {
          const v = value.get(key);
          if (isString(v)) value.set(key, encryptString(v, objNum, genNum));
          else if (v instanceof PDFDict || v instanceof PDFArray) walk(v, objNum, genNum);
        }
        return value;
      }
      return value;
    }

    /* ---------- 6. Enkripsi seluruh objek ---------- */
    const objects = Array.from(ctx.enumerateIndirectObjects());
    for (const [ref, obj] of objects) {
      if (skipRefs.has(ref.toString())) continue;
      const objNum = ref.objectNumber;
      const genNum = ref.generationNumber || 0;
      if (obj instanceof C.PDFRawStream) {
        const raw = obj.contents;
        if (raw && raw.length) {
          const encd = encryptBytes(raw, objNum, genNum);
          try {
            obj.contents = encd;
          } catch (_) {
            /* stream dengan getter (content stream) -> ganti objeknya */
            ctx.assign(ref, C.PDFRawStream.of(obj.dict, encd));
          }
        }
        walk(obj.dict, objNum, genNum);
      } else if (obj instanceof PDFDict) {
        walk(obj, objNum, genNum);
      } else if (isString(obj)) {
        ctx.assign(ref, encryptString(obj, objNum, genNum));
      }
    }

    /* ---------- 7. Dictionary /Encrypt ---------- */
    const encryptDict = ctx.obj({
      Filter: PDFName.of("Standard"),
      V: V,
      R: R,
      Length: keyBytes * 8,
      P: P,
      O: PDFHexString.of(hexBytes(O)),
      U: PDFHexString.of(hexBytes(U)),
      CF: {
        StdCF: {
          CFM: PDFName.of("AESV2"),
          AuthEvent: PDFName.of("DocOpen"),
          Length: keyBytes,
        },
      },
      StmF: PDFName.of("StdCF"),
      StrF: PDFName.of("StdCF"),
      EFF: PDFName.of("StdCF"),
    });
    const encRef = ctx.register(encryptDict);
    trailerInfo.Encrypt = encRef;

    /* ---------- 8. /ID di trailer ----------
       /ID ditulis sebagai array langsung di trailer (bukan objek
       tak langsung) supaya tidak ada objek yatim di berkas. */
    const idHexStr = PDFHexString.of(idHex);
    if (idArray) {
      idArray.set(0, idHexStr);
      idArray.set(1, idHexStr);
      if (idRef) {
        ctx.delete(idRef);
        trailerInfo.ID = idArray;
      }
    } else {
      trailerInfo.ID = ctx.obj([idHexStr, idHexStr]);
    }

    return { userPassword };
  }

  register({
    id: "protect",
    cat: "security",
    name: "Lindungi PDF",
    desc: "Kunci PDF dengan password (AES-128). Password untuk membuka dan untuk hak akses.",
    icon: "lock",
    accept: ".pdf,application/pdf",
    multiple: true,
    fields: [
      { type: "password", id: "password", label: "Password untuk membuka file", value: "" },
      { type: "password", id: "ownerPassword", label: "Password pemilik (opsional)", value: "" },
      { type: "check", id: "allowPrint", label: "Izinkan mencetak", value: true },
      { type: "check", id: "allowCopy", label: "Izinkan menyalin teks", value: true },
      { type: "check", id: "allowModify", label: "Izinkan mengubah isi", value: false },
      { type: "check", id: "allowAnnotate", label: "Izinkan anotasi & isi formulir", value: true },
    ],
    async run(ctx) {
      const { files, opts } = ctx;
      const pw = String(opts.password || "");
      if (!pw) throw new Error("Password untuk membuka file wajib diisi.");
      if (pw.length > 127) throw new Error("Password terlalu panjang (maksimal 127 karakter).");
      const out = [];
      for (const f of files) {
        const doc = await loadDoc(f.bytes);
        /* Bit izin (ISO 32000-1 Table 22):
           3 = cetak, 4 = ubah isi, 5 = salin teks, 6 = anotasi,
           9 = isi formulir, 10 = aksesibilitas, 11 = rakit, 12 = cetak resolusi tinggi */
        let perms = -1;
        if (!opts.allowPrint) perms &= ~4;
        if (!opts.allowCopy) perms &= ~16;
        if (!opts.allowModify) perms &= ~8;
        if (!opts.allowAnnotate) perms &= ~32;
        /* materialized seluruh objek dulu supaya tidak ada objek
           baru yang muncul setelah enkripsi */
        if (typeof doc.flush === "function") await doc.flush();
        encryptPdf(doc, pw, String(opts.ownerPassword || ""), perms);
        const bytes = await saveDoc(doc, {
          useObjectStreams: false,
          updateFieldAppearances: false,
        });
        /* uji 1: tanpa password harus ditolak */
        let rejected = false;
        try {
          const noPw = await openPdfjs(bytes, {});
          try { await noPw.destroy(); } catch (_) {}
          rejected = !noPw.numPages;
        } catch (_) {
          rejected = true;
        }
        if (!rejected) throw new Error("Enkripsi gagal diverifikasi: file masih bisa dibuka tanpa password.");
        /* uji 2: dengan password harus bisa dibuka */
        try {
          const checkDoc = await openPdfjs(bytes, { password: pw });
          if (!checkDoc.numPages) throw new Error("dokumen kosong");
          try { await checkDoc.destroy(); } catch (_) {}
        } catch (err) {
          throw new Error("Enkripsi gagal diverifikasi: " + (err.message || err));
        }
        out.push({ name: C.safeName(C.baseName(f.name)) + "-terkunci.pdf", bytes });
        await tick();
      }
      return out;
    },
  });

  /* ============================================================
     3. Tanda tangan PDF
     ============================================================ */
  register({
    id: "sign",
    cat: "security",
    name: "Tanda tangani PDF",
    desc: "Bubuhkan tanda tangan tulisan tangan ke halaman yang dipilih.",
    icon: "sign",
    accept: ".pdf,application/pdf",
    multiple: true,
    custom: "sign",
    fields: [
      { type: "text", id: "page", label: "Halaman", value: "1" },
      { type: "number", id: "x", label: "Posisi X (mm dari kiri)", value: 30, min: 0, max: 400 },
      { type: "number", id: "y", label: "Posisi Y (mm dari bawah)", value: 20, min: 0, max: 400 },
      { type: "number", id: "w", label: "Lebar tanda tangan (mm)", value: 50, min: 10, max: 200 },
    ],
    async run(ctx) {
      const { files, opts } = ctx;
      if (!opts.signature) throw new Error("Buat tanda tangan dulu.");
      const sigBytes = unhex(opts.signature);
      const out = [];
      for (const f of files) {
        const doc = await loadDoc(f.bytes);
        const pages = doc.getPages();
        const targets = [];
        const spec = String(opts.page || "1").trim();
        if (spec === "semua" || spec === "all") {
          pages.forEach((_, i) => targets.push(i + 1));
        } else {
          for (const part of spec.split(",")) {
            const t = part.trim();
            if (!t) continue;
            if (t.includes("-")) {
              const [a, b] = t.split("-").map((x) => Number(x.trim()));
              for (let n = a; n <= b; n++) if (n >= 1 && n <= pages.length) targets.push(n);
            } else {
              const n = Number(t);
              if (n >= 1 && n <= pages.length) targets.push(n);
            }
          }
        }
        if (!targets.length) throw new Error(`Halaman "${spec}" tidak ada.`);
        const img = await doc.embedPng(sigBytes);
        for (const n of targets) {
          const p = pages[n - 1];
          const w = (Number(opts.w) || 50) * MM;
          const ratio = (img.height || 1) / (img.width || 1);
          p.drawImage(img, {
            x: (Number(opts.x) || 0) * MM,
            y: (Number(opts.y) || 0) * MM,
            width: w,
            height: w * ratio,
          });
        }
        const bytes = await saveDoc(doc);
        out.push({ name: C.safeName(C.baseName(f.name)) + "-ttd.pdf", bytes });
        await tick();
      }
      return out;
    },
  });

  /* ============================================================
     4. Redaksi PDF (benar — teks dihapus)
     ============================================================ */
  async function findMatches(pdfjs, term) {
    const hits = [];
    const needle = term.toLowerCase();
    for (let i = 1; i <= pdfjs.numPages; i++) {
      const items = await extractText(pdfjs, i);
      for (const it of items) {
        const low = it.str.toLowerCase();
        let from = 0;
        for (;;) {
          const k = low.indexOf(needle, from);
          if (k < 0) break;
          const before = it.str.slice(0, k);
          const charW = it.w && it.str.length ? it.w / it.str.length : it.h * 0.5;
          hits.push({
            page: i,
            text: it.str,
            start: k,
            len: needle.length,
            x: it.x + before.length * charW,
            y: it.y,
            w: needle.length * charW,
            h: it.h,
          });
          from = k + needle.length;
        }
      }
    }
    return hits;
  }

  register({
    id: "redact",
    cat: "security",
    name: "Redaksi PDF",
    desc: "Hapus teks tertentu secara permanen (halaman dirender ulang lalu teksnya ditutup).",
    icon: "redact",
    accept: ".pdf,application/pdf",
    multiple: false,
    custom: "redact",
    fields: [
      { type: "text", id: "term", label: "Kata/kalimat yang diredaksi", value: "" },
      { type: "number", id: "scale", label: "Resolusi render (DPI)", value: 200, min: 96, max: 400 },
    ],
    async search(ctx) {
      const f = ctx.files[0];
      const pdfjs = await openPdfjs(f.bytes);
      const hits = await findMatches(pdfjs, String(ctx.opts.term || ""));
      try { await pdfjs.destroy(); } catch (_) {}
      return hits;
    },
    async run(ctx) {
      const f = ctx.files[0];
      const term = String(ctx.opts.term || "").trim();
      if (!term) throw new Error("Kata yang diredaksi belum diisi.");
      const pdfjs = await openPdfjs(f.bytes);
      const hits = Array.isArray(ctx.opts.hits) && ctx.opts.hits.length
        ? ctx.opts.hits
        : await findMatches(pdfjs, term);
      if (!hits.length) {
        try { await pdfjs.destroy(); } catch (_) {}
        throw new Error(`"${term}" tidak ditemukan di PDF ini.`);
      }
      const scale = (Number(ctx.opts.scale) || 200) / 72;
      const dst = await PDFDocument.create();
      const byPage = new Map();
      for (const h of hits) {
        if (!byPage.has(h.page)) byPage.set(h.page, []);
        byPage.get(h.page).push(h);
      }
      for (let i = 1; i <= pdfjs.numPages; i++) {
        ctx.progress(null, `Menutup teks halaman ${i}/${pdfjs.numPages}…`);
        const { canvas, ctx: c2, viewport } = await renderPage(pdfjs, i, scale);
        const list = byPage.get(i) || [];
        c2.fillStyle = "#000000";
        for (const h of list) {
          const x = h.x * scale;
          const yTop = (viewport.height - h.y - h.h) * scale;
          c2.fillRect(x - 1, yTop - 1, h.w * scale + 2, h.h * scale + 2);
        }
        const jpg = await canvasToBytes(canvas, "image/jpeg", 0.92);
        canvas.width = canvas.height = 0;
        const img = await dst.embedJpg(jpg);
        const p = dst.addPage([viewport.width, viewport.height]);
        p.drawImage(img, { x: 0, y: 0, width: viewport.width, height: viewport.height });
        await tick();
      }
      try { await pdfjs.destroy(); } catch (_) {}
      const bytes = await saveDoc(dst);
      return [{ name: C.safeName(C.baseName(f.name)) + "-redaksi.pdf", bytes, note: `${hits.length} bagian ditutup` }];
    },
  });

  /* ============================================================
     5. Bandingkan PDF
     ============================================================ */
  function diffLines(a, b) {
    const n = a.length, m = b.length;
    /* LCS via DP — bataskan agar tidak meledak di dokumen besar. */
    const cap = 1200;
    const A = a.slice(0, cap), B = b.slice(0, cap);
    const dp = [];
    for (let i = 0; i <= A.length; i++) dp.push(new Uint16Array(B.length + 1));
    for (let i = A.length - 1; i >= 0; i--) {
      for (let j = B.length - 1; j >= 0; j--) {
        dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const ops = [];
    let i = 0, j = 0;
    while (i < A.length && j < B.length) {
      if (A[i] === B[j]) { ops.push({ t: "=", a: A[i], b: B[j] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: "-", a: A[i], b: "" }); i++; }
      else { ops.push({ t: "+", a: "", b: B[j] }); j++; }
    }
    while (i < A.length) { ops.push({ t: "-", a: A[i], b: "" }); i++; }
    while (j < B.length) { ops.push({ t: "+", a: "", b: B[j] }); j++; }
    return ops;
  }

  register({
    id: "compare",
    cat: "security",
    name: "Bandingkan PDF",
    desc: "Bandingkan dua PDF dan lihat bagian yang berubah, sama, atau baru.",
    icon: "compare",
    accept: ".pdf,application/pdf",
    multiple: true,
    fields: [],
    async run(ctx) {
      const files = ctx.files;
      if (files.length < 2) throw new Error("Butuh dua PDF untuk dibandingkan.");
      const a = files[0], b = files[1];
      const pa = await openPdfjs(a.bytes);
      const pb = await openPdfjs(b.bytes);
      const la = [];
      const lb = [];
      for (let i = 1; i <= pa.numPages; i++) la.push(...(await C.pageText(pa, i)).split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean));
      for (let i = 1; i <= pb.numPages; i++) lb.push(...(await C.pageText(pb, i)).split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean));
      try { await pa.destroy(); await pb.destroy(); } catch (_) {}
      const ops = diffLines(la, lb);
      const same = ops.filter((o) => o.t === "=").length;
      const changed = ops.filter((o) => o.t === "-").length;
      const added = ops.filter((o) => o.t === "+").length;
      const rows = ops.map((o) => {
        const tag = o.t === "=" ? "SAMA" : o.t === "-" ? "HILANG" : "BARU";
        return `<tr class="d-${o.t}"><td class="tag">${tag}</td><td>${escapeHtml(o.a)}</td><td>${escapeHtml(o.b)}</td></tr>`;
      }).join("\n");
      const html = `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><title>Perbandingan PDF</title>
<style>
body{font-family:system-ui,sans-serif;margin:24px;background:#f8fafc;color:#0f172a}
h1{font-size:20px} .meta{color:#64748b;font-size:13px;margin-bottom:16px}
table{border-collapse:collapse;width:100%;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)}
td{border-top:1px solid #e2e8f0;padding:8px 10px;font-size:13px;vertical-align:top}
td.tag{font-weight:600;white-space:nowrap;width:90px}
.d- .tag{color:#b91c1c}.d+ .tag{color:#15803d}.d= .tag{color:#64748b}
.d- td:nth-child(2){background:#fef2f2}.d+ td:nth-child(3){background:#f0fdf4}
</style></head><body>
<h1>Perbandingan PDF</h1>
<p class="meta">${escapeHtml(a.name)} &harr; ${escapeHtml(b.name)} · ${same} baris sama, ${changed} hilang, ${added} baru</p>
<table>${rows}</table>
</body></html>`;
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      return [{
        name: C.safeName(C.baseName(a.name)) + "-banding.html",
        blob,
        note: `${same} sama · ${changed} hilang · ${added} baru`,
      }];
    },
  });

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /* ============================================================
     6. PDF ke Markdown
     ============================================================ */
  register({
    id: "markdown",
    cat: "ai",
    name: "PDF ke Markdown",
    desc: "Ubah isi PDF menjadi teks Markdown: judul, paragraf, dan pemisah halaman.",
    icon: "markdown",
    accept: ".pdf,application/pdf",
    multiple: true,
    fields: [
      { type: "check", id: "pageSep", label: "Pisahkan tiap halaman dengan ---", value: true },
      { type: "check", id: "code", label: "Tandai blok teks rapat sebagai kode", value: false },
    ],
    async run(ctx) {
      const out = [];
      for (const f of ctx.files) {
        const pdfjs = await openPdfjs(f.bytes);
        const parts = [];
        for (let i = 1; i <= pdfjs.numPages; i++) {
          const items = await extractText(pdfjs, i);
          const lines = groupLines(items);
          const md = [];
          for (const ln of lines) {
            const size = ln.size;
            const text = ln.text;
            if (!text) continue;
            if (size >= 26) md.push("# " + text);
            else if (size >= 20) md.push("## " + text);
            else if (size >= 16) md.push("### " + text);
            else md.push(text);
            md.push("");
          }
          parts.push(md.join("\n").replace(/\n{3,}/g, "\n\n").trim());
          await tick();
        }
        try { await pdfjs.destroy(); } catch (_) {}
        const body = parts.join(ctx.opts.pageSep ? "\n\n---\n\n" : "\n\n");
        const blob = new Blob([body], { type: "text/markdown;charset=utf-8" });
        out.push({ name: C.safeName(C.baseName(f.name)) + ".md", blob });
      }
      return out;
    },
  });

  /* Kelompokkan item teks menjadi baris berdasarkan koordinat y. */
  function groupLines(items) {
    const rows = [];
    for (const it of items) {
      if (!it.str.trim()) continue;
      let row = null;
      for (const r of rows) {
        if (Math.abs(r.y - it.y) < Math.max(2, it.h * 0.5)) { row = r; break; }
      }
      if (!row) { row = { y: it.y, items: [] }; rows.push(row); }
      row.items.push(it);
    }
    rows.sort((a, b) => b.y - a.y);
    return rows.map((r) => {
      r.items.sort((a, b) => a.x - b.x);
      const text = r.items.map((i) => i.str).join("").replace(/\s+/g, " ").trim();
      let size = 0;
      for (const i of r.items) size = Math.max(size, i.h || 0);
      return { text, size, y: r.y };
    });
  }

  /* ============================================================
     7. Ringkasan otomatis (ekstraktif, tanpa internet)
     ============================================================ */
  register({
    id: "summarize",
    cat: "ai",
    name: "Ringkas PDF",
    desc: "Ringkasan poin penting secara otomatis — dihitung di perangkat, tanpa mengunggah file.",
    icon: "summary",
    accept: ".pdf,application/pdf",
    multiple: true,
    fields: [
      { type: "number", id: "count", label: "Jumlah kalimat ringkasan", value: 8, min: 3, max: 30 },
      { type: "select", id: "unit", label: "Satuan", value: "sentence", options: [["sentence", "Kalimat"], ["paragraph", "Paragraf"]] },
    ],
    async run(ctx) {
      const out = [];
      for (const f of ctx.files) {
        const pdfjs = await openPdfjs(f.bytes);
        const text = [];
        for (let i = 1; i <= pdfjs.numPages; i++) text.push(await C.pageText(pdfjs, i));
        try { await pdfjs.destroy(); } catch (_) {}
        const full = text.join(" ").replace(/\s+/g, " ").trim();
        if (!full) throw new Error("PDF ini tidak punya teks yang bisa diringkas.");
        const sentences = full.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 20);
        const want = Number(ctx.opts.count) || 8;
        const picked = pickSummary(sentences, want);
        const md = [
          "# Ringkasan — " + C.baseName(f.name),
          "",
          `> Ringkasan ekstraktif: ${picked.length} dari ${sentences.length} kalimat dipilih otomatis oleh skor kata kunci. Tidak ada data yang dikirim ke internet.`,
          "",
          ...picked.map((s) => "- " + s),
          "",
          "---",
          "",
          "## Teks lengkap",
          "",
          full,
        ].join("\n");
        const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
        out.push({ name: C.safeName(C.baseName(f.name)) + "-ringkasan.md", blob, note: `${picked.length} kalimat` });
      }
      return out;
    },
  });

  /* Skor kata kunci (TF) + posisi kalimat. */
  const STOP = new Set(("yang dan di dari untuk dengan pada adalah ini itu akan tidak atau dalam oleh sebagai juga bisa sudah hanya lebih tetapi karena jika maka saat ada dapat harus orang tahun hari indonesia pdf file http https www com untuk dari yang di ke dan pada adalah yang ini itu tidak dengan akan oleh atau dalam sebagai dapat harus karena bisa tidak ada saja lebih tetapi agar dalam atas bawah antara setelah sebelum tentang karena hingga".split(" ")));

  function pickSummary(sentences, want) {
    if (sentences.length <= want) return sentences.slice();
    const freq = new Map();
    const words = sentences.join(" ").toLowerCase().split(/[^a-z0-9à-ÿ]+/).filter(Boolean);
    for (const w of words) {
      if (STOP.has(w) || w.length < 3) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
    const max = Math.max(1, ...freq.values());
    const scored = sentences.map((s, i) => {
      const ws = s.toLowerCase().split(/[^a-z0-9à-ÿ]+/).filter((w) => w.length >= 3 && !STOP.has(w));
      let sc = 0;
      for (const w of ws) sc += (freq.get(w) || 0) / max;
      sc = ws.length ? sc / Math.sqrt(ws.length) : 0;
      /*ikit nilai supaya kalimat awal lebih penting */
      sc *= 1 + Math.max(0, (sentences.length - i) / sentences.length) * 0.15;
      return { s, i, sc };
    });
    return scored.sort((a, b) => b.sc - a.sc).slice(0, want).sort((a, b) => a.i - b.i).map((x) => x.s);
  }

  /* ============================================================
     8. Terjemah PDF (memakai API Terjemahan bawaan peramban)
     ============================================================ */
  register({
    id: "translate",
    cat: "ai",
    name: "Terjemah PDF",
    desc: "Terjemahkan teks PDF memakai mesin terjemahan bawaan peramban (bila tersedia).",
    icon: "translate",
    accept: ".pdf,application/pdf",
    multiple: true,
    fields: [
      { type: "select", id: "lang", label: "Bahasa tujuan", value: "en", options: [["en", "Inggris"], ["id", "Indonesia"], ["ja", "Jepang"], ["de", "Jerman"], ["fr", "Prancis"], ["es", "Spanyol"], ["zh", "Tionghoa"], ["ko", "Korea"]] },
      { type: "select", id: "src", label: "Bahasa sumber", value: "auto", options: [["auto", "Otomatis"], ["id", "Indonesia"], ["en", "Inggris"]] },
    ],
    async run(ctx) {
      if (!("Translator" in window)) {
        throw new Error(
          "Peramban ini belum punya mesin terjemahan bawaan (Chrome 138+ dengan model's on-device translation). " +
          "Aplikasi ini berjalan offline, jadi terjemahan butuh kemampuan itu."
        );
      }
      const out = [];
      for (const f of ctx.files) {
        const pdfjs = await openPdfjs(f.bytes);
        const chunks = [];
        for (let i = 1; i <= pdfjs.numPages; i++) {
          const t = await C.pageText(pdfjs, i);
          if (t) chunks.push(t);
          await tick();
        }
        try { await pdfjs.destroy(); } catch (_) {}
        const source = ctx.opts.src === "auto" ? undefined : ctx.opts.src;
        const translator = await window.Translator.create({ sourceLanguage: source, targetLanguage: ctx.opts.lang });
        const translated = [];
        for (const c of chunks) {
          const r = await translator.translate(c);
          translated.push(r);
        }
        try { translator.destroy(); } catch (_) {}
        const md = ["# " + C.baseName(f.name), "", ...translated, ""].join("\n\n");
        const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
        out.push({ name: C.safeName(C.baseName(f.name)) + "-terjemahan.md", blob });
      }
      return out;
    },
  });

  /* ============================================================
     9. OCR PDF (memakai deteksi teks bawaan peramban bila ada)
     ============================================================ */
  register({
    id: "ocr",
    cat: "optimize",
    name: "OCR PDF",
    desc: "Tambahkan lapisan teks ke PDF hasil pindai, memakai mesin OCR bawaan peramban bila tersedia.",
    icon: "ocr",
    accept: ".pdf,application/pdf",
    multiple: true,
    fields: [
      { type: "number", id: "scale", label: "Resolusi OCR (DPI)", value: 200, min: 100, max: 400 },
    ],
    async run(ctx) {
      if (!("TextDetector" in window)) {
        throw new Error(
          "Peramban ini belum punya mesin OCR bawaan (Chrome dengan flag TextDetector). " +
          "Aplikasi ini offline, jadi tidak bisa mengunduh mesin OCR dari internet."
        );
      }
      const out = [];
      for (const f of ctx.files) {
        const pdfjs = await openPdfjs(f.bytes);
        const dst = await PDFDocument.create();
        const detector = new window.TextDetector();
        for (let i = 1; i <= pdfjs.numPages; i++) {
          ctx.progress(null, `OCR halaman ${i}/${pdfjs.numPages}…`);
          const { canvas, viewport } = await renderPage(pdfjs, i, (Number(ctx.opts.scale) || 200) / 72);
          const bitmap = await createImageBitmap(canvas);
          const blocks = await detector.detect(bitmap);
          const srcPage = (await loadDoc(f.bytes)).getPages()[i - 1];
          const { width, height } = srcPage.getSize();
          const p = dst.addPage([width, height]);
          const jpg = await canvasToBytes(canvas, "image/jpeg", 0.92);
          canvas.width = canvas.height = 0;
          const img = await dst.embedJpg(jpg);
          p.drawImage(img, { x: 0, y: 0, width, height });
          const k = width / viewport.width;
          for (const b of blocks) {
            const bb = b.boundingBox;
            const text = b.rawValue || "";
            if (!text) continue;
            const size = Math.max(6, (bb.height || 10) * k);
            await drawTextSafe(p, text, {
              x: bb.x * k, y: height - bb.y * k - size, size,
              color: C.rgb(0, 0, 0), opacity: 0,
            });
          }
          await tick();
        }
        try { await pdfjs.destroy(); } catch (_) {}
        const bytes = await saveDoc(dst);
        out.push({ name: C.safeName(C.baseName(f.name)) + "-ocr.pdf", bytes });
      }
      return out;
    },
  });

  window.PDFToolsSmart = { encryptPdf, diffLines, findMatches, groupLines, pickSummary };
})();
