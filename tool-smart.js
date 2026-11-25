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
    pageText, extractText, fontFor, drawTextSafe, degrees,
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
     ------------------------------------------------------------
     Memakai dekriptor sendiri (tool-decrypt.js) yang membaca
     Standard Security Handler (R2-R6), lalu menulis ulang PDF
     tanpa /Encrypt. Isi dokumen tetap utuh — bukan dirasterisasi.
     ============================================================ */
  const DEC = () => window.PDFToolsDecrypt;

  function describeEncryption(info) {
    if (!info) return "";
    if (info.notEncrypted) return "Tidak terenkripsi — disalin apa adanya.";
    const bits = info.lengthBits ? info.lengthBits + "-bit" : "";
    const meth = info.method === "AESV2" ? "AES-128 (CBC)"
      : info.method === "AESV3" ? "AES-256 (CBC)"
      : info.method === "V2" ? "RC4" : info.method;
    return `Dekripsi ${info.V}/${info.R}, ${meth} ${bits}` +
      ` — ${info.objects} objek, ${info.pages} halaman` +
      (info.ownerPassword ? ", memakai password pemilik." : ".");
  }

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
      const dec = DEC();
      if (!dec || typeof dec.decryptPdf !== "function") {
        throw new Error("Modul dekripsi tidak termuat.");
      }
      for (const f of ctx.files) {
        const bytes = new Uint8Array(f.bytes);
        let res = null;
        let lastErr = null;

        const tryPw = async (pw) => {
          try {
            return await dec.decryptPdf(bytes, pw);
          } catch (e) {
            lastErr = e;
            return null;
          }
        };

        /* Coba password yang sudah diisi pengguna lebih dulu (bisa kosong:
           PDF tanpa enkripsi akan terdeteksi di sini). */
        const given = ctx.opts.password != null ? String(ctx.opts.password) : "";
        res = await tryPw(given);

        if (!res && lastErr && lastErr.code === "NOT_ENCRYPTED") {
          out.push({
            name: C.safeName(C.baseName(f.name)) + "-terbuka.pdf",
            bytes,
            note: describeEncryption({ notEncrypted: true }),
          });
          await tick();
          continue;
        }

        if (!res) {
          const ask = window.prompt(
            `PDF "${f.name}" masih terkunci.\nMasukkan passwordnya:`, "");
          if (ask === null) throw new Error("Dibatalkan: password tidak diberikan.");
          res = await tryPw(ask);
          if (!res && lastErr && lastErr.code === "NOT_ENCRYPTED") {
            out.push({
              name: C.safeName(C.baseName(f.name)) + "-terbuka.pdf",
              bytes,
              note: describeEncryption({ notEncrypted: true }),
            });
            await tick();
            continue;
          }
        }

        if (!res) {
          throw new Error("Password salah atau PDF tidak bisa dibuka" +
            (lastErr && lastErr.message ? ": " + lastErr.message : "."));
        }
        out.push({
          name: C.safeName(C.baseName(f.name)) + "-terbuka.pdf",
          bytes: res.bytes,
          note: describeEncryption(res.info),
        });
        await tick();
      }
      return out;
    },
  });

  /* Periksa struktur PNG sebelum memberikannya ke pdf-lib: PNG rusak bisa
     membuat decoder pdf-lib berputar tanpa henti (halaman beku).
     Selain struktur, CRC tiap chunk ikut diperiksa agar berkas yang
     korup tapi strukturnya utuh tidak lolos. */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes, start, end) {
    let c = 0xffffffff;
    for (let i = start; i < end; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function assertValidPng(bytes) {
    const b = bytes;
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (!b || b.length < 8) throw new Error("Berkas tanda tangan bukan PNG yang valid.");
    for (let i = 0; i < 8; i++) {
      if (b[i] !== sig[i]) throw new Error("Tanda tangan harus berupa berkas PNG.");
    }
    let off = 8;
    let sawIHDR = false, sawIEND = false;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    while (off + 8 <= b.length) {
      const len = dv.getUint32(off);
      const type = String.fromCharCode(b[off + 4], b[off + 5], b[off + 6], b[off + 7]);
      if (off + 12 + len > b.length) throw new Error("PNG rusak: chunk \"" + type + "\" tidak lengkap.");
      /* CRC tiap chunk harus cocok */
      const want = dv.getUint32(off + 8 + len);
      const got = crc32(b, off + 4, off + 8 + len);
      if (want !== got) throw new Error("PNG rusak: CRC chunk \"" + type + "\" tidak cocok.");
      if (type === "IHDR") sawIHDR = true;
      if (type === "IEND") { sawIEND = true; break; }
      off += 12 + len;
    }
    if (!sawIHDR) throw new Error("PNG rusak: blok IHDR tidak ada.");
    if (!sawIEND) throw new Error("PNG rusak: blok IEND tidak ada.");
  }

  /* Periksa struktur JPEG: harus punya penanda SOI/EOI dan satu frame SOF. */
  function assertValidJpeg(bytes) {
    const b = bytes;
    if (!b || b.length < 4) throw new Error("Berkas tanda tangan bukan JPEG yang valid.");
    if (b[0] !== 0xff || b[1] !== 0xd8) throw new Error("Berkas tanda tangan bukan JPEG yang valid.");
    if (b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9) throw new Error("JPEG rusak: penanda EOI tidak ada.");
    let sawFrame = false;
    for (let i = 2; i < b.length - 1; i++) {
      if (b[i] !== 0xff) continue;
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i++; continue; }
      if (marker === 0xd9 || marker === 0xda) break;
      const len = (b[i + 2] << 8) | b[i + 3];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        sawFrame = true;
        break;
      }
      i += 1 + len;
    }
    if (!sawFrame) throw new Error("JPEG rusak: blok frame (SOF) tidak ditemukan.");
  }

  /* Deteksi jenis gambar dari magic bytes. */
  function sniffImage(bytes) {
    const b = bytes || [];
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
    if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
      && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
    return "";
  }

  /* WebP belum didukung pdf-lib, jadi decode via browser lalu tulis ulang PNG.
     Hasilnya selalu PNG valid sehingga aman untuk di-embed. */
  async function webpToPng(bytes) {
    if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
      throw new Error("Format WebP tidak didukung di lingkungan ini. Simpan gambar sebagai PNG atau JPEG.");
    }
    let bmp;
    try {
      const copy = new Uint8Array(bytes);
      bmp = await createImageBitmap(new Blob([copy], { type: "image/webp" }));
    } catch (_) {
      throw new Error("Gambar WebP tidak bisa dibaca.");
    }
    const w = bmp.width || 0, h = bmp.height || 0;
    if (!w || !h) throw new Error("Gambar WebP berukuran nol.");
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const cx = cv.getContext("2d");
    cx.drawImage(bmp, 0, 0);
    if (bmp.close) bmp.close();
    const dataUrl = cv.toDataURL("image/png");
    const raw = atob(dataUrl.split(",")[1]);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  /* Siapkan gambar tanda tangan untuk di-embed: validasi struktur lalu
     kembalikan { bytes, embed } yang sesuai format. */
  async function prepareSignature(sigBytes) {
    const kind = sniffImage(sigBytes);
    if (!kind) {
      throw new Error("Format gambar tanda tangan tidak dikenali. Gunakan PNG, JPEG, atau WebP.");
    }
    if (kind === "png") {
      assertValidPng(sigBytes);
      return { bytes: sigBytes, embed: "png" };
    }
    if (kind === "jpeg") {
      assertValidJpeg(sigBytes);
      return { bytes: sigBytes, embed: "jpg" };
    }
    const png = await webpToPng(sigBytes);
    assertValidPng(png);
    return { bytes: png, embed: "png" };
  }

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

    /* Satu byte per karakter (mode latin1) — sama dengan pembaca umum. */
    const userPad = K.padPassword(userPassword, "latin1");
    const ownerPad = K.padPassword(ownerPassword || userPassword, "latin1");

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
        let doc;
        try {
          doc = await loadDoc(f.bytes);
        } catch (e) {
          if (/encrypt/i.test(String(e && e.message))) {
            throw new Error("PDF ini sudah memiliki enkripsi. Buka dulu dengan tool \"Buka PDF terkunci\".");
          }
          throw e;
        }
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

  /* Kotak halaman yang terlihat (setelah rotasi /Rotate) dalam unit
     PDF (pt). pdf.js memakai CropBox yang dipotong MediaBox, jadi
     perhitungannya harus sama supaya pratinjau = PDF akhir. */
  function kotakTerlihat(p) {
    const media = p.getMediaBox();
    const crop = p.getCropBox();
    const x0 = Math.max(media.x, crop.x);
    const y0 = Math.max(media.y, crop.y);
    const x1 = Math.min(media.x + media.width, crop.x + crop.width);
    const y1 = Math.min(media.y + media.height, crop.y + crop.height);
    const sudut = p.getRotation ? p.getRotation().angle : 0;
    const rot = ((Math.round(sudut / 90) * 90) % 360 + 360) % 360;
    return { x0: x0, y0: y0, x1: x1, y1: y1, w: x1 - x0, h: y1 - y0, rot: rot };
  }

  /* Batas (mm) supaya tanda tangan muat di semua halaman tujuan:
     dipakai halaman terkecil di antara target. */
  function batasTujuan(pages, targets) {
    let w = Infinity, h = Infinity;
    for (const n of targets) {
      const k = kotakTerlihat(pages[n - 1]);
      const wmm = k.w / MM, hmm = k.h / MM;
      if (wmm < w) w = wmm;
      if (hmm < h) h = hmm;
    }
    if (!isFinite(w) || !isFinite(h)) return { w: 0, h: 0 };
    return { w: w, h: h };
  }

  /* Sesuaikan ukuran + posisi tanda tangan agar selalu di dalam
     halaman (rasio gambar tetap terjaga). */
  function muatTanda(wmm, hmm, xmm, ymm, batas) {
    if (!batas.w || !batas.h) {
      return { w: Math.max(1, wmm), h: Math.max(0, hmm), x: Math.max(0, xmm), y: Math.max(0, ymm) };
    }
    const r = wmm > 0 ? hmm / wmm : 1;
    let w = Math.max(1, Math.min(wmm, batas.w));
    let h = w * r;
    if (h > batas.h) { h = batas.h; w = r > 0 ? h / r : w; }
    return {
      w: w, h: h,
      x: Math.min(Math.max(0, xmm), Math.max(0, batas.w - w)),
      y: Math.min(Math.max(0, ymm), Math.max(0, batas.h - h)),
    };
  }

  /* Gambar tanda tangan pada halaman. Posisi (x, y) adalah koordinat
     halaman yang terlihat (dari kiri / dari bawah) — sama dengan yang
     dipakai pratinjau. Halaman berotasi 90/180/270 perlu image
     diputar supaya tampilannya sama dengan pratinjau. */
  function gambarTanda(p, img, ttd) {
    const k = kotakTerlihat(p);
    const w = ttd.w * MM, h = ttd.h * MM;
    const vx = ttd.x * MM, vy = ttd.y * MM;
    if (k.rot === 90) {
      p.drawImage(img, { x: k.x1 - vy, y: k.y0 + vx, width: w, height: h, rotate: degrees(90) });
    } else if (k.rot === 180) {
      p.drawImage(img, { x: k.x1 - vx, y: k.y1 - vy, width: w, height: h, rotate: degrees(180) });
    } else if (k.rot === 270) {
      p.drawImage(img, { x: k.x0 + vy, y: k.y1 - vx, width: w, height: h, rotate: degrees(270) });
    } else {
      p.drawImage(img, { x: k.x0 + vx, y: k.y0 + vy, width: w, height: h });
    }
  }

  register({
    id: "sign",
    cat: "security",
    name: "Tanda tangani PDF",
    desc: "Bubuhkan tanda tangan (tulis tangan, foto, atau QR code) ke halaman yang dipilih, lengkap dengan pratinjau posisi.",
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
      const sig = await prepareSignature(sigBytes);
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
        const img = sig.embed === "jpg" ? await doc.embedJpg(sig.bytes) : await doc.embedPng(sig.bytes);
        /* Batas = halaman terkecil di antara target, lalu posisi &
           ukuran dijepit di dalamnya supaya tanda tangan tidak pernah
           keluar dari halaman (nilai ini sama dengan pratinjau). */
        const batas = batasTujuan(pages, targets);
        const wmm = Number(opts.w) || 50;
        const ratio = (img.height || 1) / (img.width || 1);
        const ttd = muatTanda(wmm, wmm * ratio, Number(opts.x) || 0, Number(opts.y) || 0, batas);
        for (const n of targets) {
          gambarTanda(pages[n - 1], img, ttd);
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
      { type: "pagerange", id: "halaman", label: "Halaman yang direduksi", value: { mode: "all", dari: 1, sampai: 0 } },
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
      /* Batasi halaman yang direduksi sesuai rentang yang dipilih. */
      const totalHal = pdfjs.numPages;
      const spec = C.normSpesifikasiHalaman(ctx.opts.halaman, totalHal);
      /* Rentang di luar jangkauan -> pesan jelas, jangan dipaksa. */
      C.pastikanHalamanTerpilih(spec, totalHal, f.name);
      const terpilih = new Set(C.halamanTerpilih(spec, totalHal));
      let hits = Array.isArray(ctx.opts.hits) && ctx.opts.hits.length
        ? ctx.opts.hits
        : await findMatches(pdfjs, term);
      hits = hits.filter((h) => terpilih.has(h.page));
      if (!hits.length) {
        try { await pdfjs.destroy(); } catch (_) {}
        throw new Error(
          terpilih.size < totalHal
            ? `"${term}" tidak ditemukan di halaman yang dipilih (${C.ringkasHalaman(spec, totalHal)}).`
            : `"${term}" tidak ditemukan di PDF ini.`
        );
      }
      const scale = (Number(ctx.opts.scale) || 200) / 72;
      const dst = await PDFDocument.create();
      const byPage = new Map();
      for (const h of hits) {
        if (!byPage.has(h.page)) byPage.set(h.page, []);
        byPage.get(h.page).push(h);
      }
      /* Halaman yang TIDAK diberi hit disalin apa adanya dari berkas
         asli (lossless). Dengan begitu halaman di luar rentang pilihan
         tidak dirender ulang dan isinya tetap utuh — halaman luar
         rentang tidak boleh berubah sama sekali. */
      let src = null;
      try { src = await loadDoc(f.bytes); } catch (_) { src = null; }
      const halamanAdaHit = new Set(byPage.keys());
      for (let i = 1; i <= pdfjs.numPages; i++) {
        const list = byPage.get(i) || [];
        if (!list.length) {
          /* Salin halaman asli tanpa perubahan. */
          let tersalin = false;
          if (src) {
            try {
              const [cp] = await dst.copyPages(src, [i - 1]);
              dst.addPage(cp);
              tersalin = true;
            } catch (_) { tersalin = false; }
          }
          if (!tersalin) {
            /* cadangan: render (hanya untuk berkas yang tidak bisa
               disalin apa adanya) */
            ctx.progress(null, `Menyalin halaman ${i}/${pdfjs.numPages}…`);
            const { canvas, viewport } = await renderPage(pdfjs, i, scale);
            const jpg = await canvasToBytes(canvas, "image/jpeg", 0.92);
            canvas.width = canvas.height = 0;
            const img = await dst.embedJpg(jpg);
            const p = dst.addPage([viewport.width / scale, viewport.height / scale]);
            p.drawImage(img, { x: 0, y: 0, width: viewport.width / scale, height: viewport.height / scale });
          }
          await tick();
          continue;
        }
        ctx.progress(null, `Menutup teks halaman ${i}/${pdfjs.numPages}…`);
        const { canvas, ctx: c2, viewport } = await renderPage(pdfjs, i, scale);
        /* ukuran halaman dalam POIN (viewport diskalakan -> balik ke
           satuan PDF asli supaya halaman hasil tidak ikut membesar) */
        const lebarPt = viewport.width / scale;
        const tinggiPt = viewport.height / scale;
        c2.fillStyle = "#000000";
        for (const h of list) {
          const x = h.x * scale;
          /* y di koordinat hit itu titik PDF (dari bawah), jadi
             dibalik ke koordinat kanvas (dari atas). */
          const yTop = (tinggiPt - h.y - h.h) * scale;
          c2.fillRect(x - 1, yTop - 1, h.w * scale + 2, h.h * scale + 2);
        }
        const jpg = await canvasToBytes(canvas, "image/jpeg", 0.92);
        canvas.width = canvas.height = 0;
        const img = await dst.embedJpg(jpg);
        const p = dst.addPage([lebarPt, tinggiPt]);
        p.drawImage(img, { x: 0, y: 0, width: lebarPt, height: tinggiPt });
        await tick();
      }
      void halamanAdaHit;
      try { await pdfjs.destroy(); } catch (_) {}
      const bytes = await saveDoc(dst);
      const nHalaman = new Set(hits.map((h) => h.page)).size;
      return [{
        name: C.safeName(C.baseName(f.name)) + "-redaksi.pdf",
        bytes,
        note: `${hits.length} bagian ditutup di ${C.catatanCakupan(nHalaman, totalHal, "halaman")}`,
      }];
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
      const pagesA = pa.numPages, pagesB = pb.numPages;
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
<p class="meta">${escapeHtml(a.name)} &harr; ${escapeHtml(b.name)} · ${same} baris sama, ${changed} hilang, ${added} baru · ${pagesA} vs ${pagesB} halaman</p>
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
     8. Terjemah PDF
     ------------------------------------------------------------
     Tiga mesin (lihat tool-translate.js):
       - "online" : AI daring. Konfigurasi mesin (endpoint, model,
                    prompt) diambil dari manifest di server, jadi
                    perbaikan di server ikut terpakai tanpa rilis
                    aplikasi baru.
       - "bawaan" : Translator API bawaan Chrome 138+ (on-device).
       - "offline" : mesin Bergamot yang ikut disertakan di vendor/.

     Terjemahan dipecah per KALIMAT, bukan per baris:
       - kalimat yang patah antar baris diterjemahkan utuh
         (terjemahan per baris menghasilkan kalimat rancu,
         pronoun menggantung, istilah tidak konsisten);
       - kalimat yang sama (header/footer) tidak diterjemahkan 2x;
       - mesin AI daring menerima beberapa baris BERURUTAN dalam
         satu permintaan, jadi model membaca konteksnya -> hasil
         jauh lebih akurat.

     Hasil: berkas Markdown + PDF terjemahan (opsional). PDF
     terjemahan memakai halaman asli sebagai latar (teks asli
     ditutup) atau latar putih, dan selalu punya lapisan teks
     tak terlihat supaya hasil tetap bisa dicari & disalin.
     ============================================================ */

  const TERJEMAH_LANG = [
    ["id", "Indonesia"], ["en", "Inggris"], ["ja", "Jepang"], ["de", "Jerman"],
    ["fr", "Prancis"], ["es", "Spanyol"], ["zh", "Tionghoa"], ["ko", "Korea"],
    ["it", "Italia"], ["pt", "Portugis"], ["nl", "Belanda"], ["ru", "Rusia"],
    ["ar", "Arab"], ["hi", "Hindi"], ["th", "Thai"], ["vi", "Vietnam"],
  ];

  /* Baris teks dalam RUANG TAMPILAN (viewport pdf.js): koordinat
     sudah memperhitungkan rotasi halaman, jadi teks terjemahan bisa
     ditaruh tepat di tempat teks aslinya pada PDF hasil. */
  async function barisTampilan(pdfjs, no) {
    const page = await pdfjs.getPage(no);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const util = window.pdfjsLib && window.pdfjsLib.Util;
    const items = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      let x = it.transform ? it.transform[4] : 0;
      let y = it.transform ? it.transform[5] : 0;
      let h = it.height || 10;
      let w = it.width || 0;
      if (util && it.transform) {
        const tx = util.transform(vp.transform, it.transform);
        x = tx[4];
        y = tx[5];
        h = Math.hypot(tx[2], tx[3]) || h;
        w = w || Math.hypot(tx[0], tx[1]);
      }
      items.push({ str: it.str, x: x, y: y, w: w, h: h, size: h });
    }
    /* Kelompokkan item menjadi baris (jarak y kecil = satu baris). */
    const rows = [];
    for (const it of items) {
      let row = null;
      for (const r of rows) {
        if (Math.abs(r.y - it.y) < Math.max(2, it.h * 0.5)) { row = r; break; }
      }
      if (!row) { row = { y: it.y, items: [] }; rows.push(row); }
      row.items.push(it);
    }
    /* Ruang tampilan: y makin besar = makin bawah. */
    rows.sort((a, b) => a.y - b.y);
    return rows.map((r) => {
      r.items.sort((a, b) => a.x - b.x);
      const text = r.items.map((i) => i.str).join("").replace(/\s+/g, " ").trim();
      const x0 = Math.min.apply(null, r.items.map((i) => i.x));
      const x1 = Math.max.apply(null, r.items.map((i) => i.x + i.w));
      const size = Math.max.apply(null, r.items.map((i) => i.h));
      return { text: text, x: x0, y: r.y, w: Math.max(1, x1 - x0), size: size, h: size };
    });
  }

  /* Gabungkan baris menjadi satuan kalimat. Baris yang tidak diakhiri
     tanda baca kalimat masih dilanjutkan ke baris berikutnya, jadi
     satu kalimat yang patah dua baris diterjemahkan sebagai satu
     kesatuan. Jarak baris yang jauh atau ukuran huruf yang berubah
     besar menandai paragraf/judul baru. */
  function buatSatuan(baris) {
    const satuan = [];
    let cur = null;
    let prevY = null;
    let prevSize = 0;
    let prevText = "";
    for (const ln of baris) {
      const t = String(ln.text || "").trim();
      if (!t) { cur = null; prevY = null; prevText = ""; continue; }
      const tinggi = ln.size || 10;
      const jarak = prevY == null ? 0 : ln.y - prevY;
      const paragrafBaru = cur && (jarak > tinggi * 1.9 || ln.size > prevSize * 1.3);
      /* Baris ini LANJUT dari baris sebelumnya hanya kalau:
           - baris sebelumnya belum mengakhiri kalimat,
           - baris sebelumnya bukan label/angka pendek, dan
           - baris ini mulai huruf kecil ATAU baris sebelumnya berakhir
             dengan tanda sambung (koma/hyphen).
         Tanpa aturan ini, daftar angka (mis. tabel) ikut digabung
         jadi satu "kalimat" dan angka terkirim ke server. */
      const kataPrev = prevText ? prevText.split(/\s+/).length : 0;
      const lanjut =
        cur &&
        !/[.!?…]["')\]]?$/.test(prevText) &&
        kataPrev >= 3 &&
        (/^[a-zà-ÿ]/.test(t) || /[,—–-]$/.test(prevText));
      if (!cur || paragrafBaru || !lanjut) { cur = { baris: [], text: "" }; satuan.push(cur); }
      cur.baris.push(ln);
      cur.text = cur.text ? cur.text + " " + t : t;
      /* Kalimat selesai kalau baris berakhir dengan tanda baca akhir
         kalimat -> baris berikutnya jadi satuan baru. */
      if (/[.!?…]["')\]]?$/.test(t)) cur = null;
      prevY = ln.y;
      prevSize = ln.size;
      prevText = t;
    }
    return satuan;
  }

  /* Bagi kalimat terjemahan kembali ke jumlah baris aslinya
     (perbandingan panjang proporsional). Isi dokumen tetap utuh:
     tidak ada kata yang dibuang. */
  function pecahKeBaris(teks, baris) {
    const n = baris.length;
    if (n <= 1) return [String(teks == null ? "" : teks)];
    const kata = String(teks == null ? "" : teks).split(/\s+/).filter(Boolean);
    if (!kata.length) return baris.map(function () { return ""; });
    const bobot = baris.map(function (b) { return Math.max(1, String(b.text || "").length); });
    const total = bobot.reduce(function (a, b) { return a + b; }, 0);
    const hasil = [];
    let k = 0;
    for (let i = 0; i < n; i++) {
      const sisaBaris = n - i;
      const sisaKata = kata.length - k;
      let ambil;
      if (sisaBaris === 1) {
        ambil = sisaKata;
      } else {
        ambil = Math.round((bobot[i] / total) * kata.length);
        ambil = Math.max(1, Math.min(ambil, sisaKata - (sisaBaris - 1)));
      }
      hasil.push(kata.slice(k, k + ambil).join(" "));
      k += ambil;
    }
    return hasil;
  }

  /* PDF terjemahan: halaman asli jadi latar (teks aslinya ditutup),
     teks terjemahan ditulis di tempat yang sama. Selalu ada lapisan
     teks tak_visible supaya hasil tetap bisa dicari & disalin. */
  async function buatPdfTerjemahan(pdfjs, hasilBaris, asliBaris, opsi) {
    const SKALA = 2;
    const FONT = 'system-ui, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", "DejaVu Sans", Arial, sans-serif';
    const doc = await PDFDocument.create();
    for (let i = 0; i < hasilBaris.length; i++) {
      const no = i + 1;
      const hal = await renderPage(pdfjs, no, SKALA, { skipRender: (opsi.latar || "asli") === "putih" });
      const ctx = hal.ctx;
      const asal = asliBaris[i] || [];
      const hasil = hasilBaris[i] || [];
      /* Tutup teks asli dengan kotak putih (hanya area teks, jadi
         foto, stempel, dan garis yang tidak bertabrakan tetap utuh). */
      ctx.fillStyle = "#ffffff";
      for (const b of asal) {
        const x = b.x * SKALA;
        const y = (b.y - b.h * 0.98) * SKALA;
        const w = Math.max(2, b.w * SKALA);
        const h = Math.max(2, b.h * 1.3 * SKALA);
        ctx.fillRect(x, y, w, h);
      }
      /* Tulis teks terjemahan. */
      ctx.fillStyle = "#000000";
      ctx.textBaseline = "alphabetic";
      for (let k = 0; k < hasil.length; k++) {
        const b = hasil[k];
        if (!b || !b.text) continue;
        const fs = Math.max(4, (b.size / 0.72) * SKALA);
        ctx.font = fs + "px " + FONT;
        const avail = Math.max(4, b.w * SKALA);
        const m = ctx.measureText(b.text);
        if (m.width > avail && m.width > 0) {
          /* Teks lebih panjang dari kolom aslinya: dikompres horizontal
             (tidak dipotong, tidak ada kata yang hilang). */
          const k2 = Math.max(0.55, avail / m.width);
          ctx.save();
          ctx.translate(b.x * SKALA, b.y * SKALA);
          ctx.scale(k2, 1);
          ctx.fillText(b.text, 0, 0);
          ctx.restore();
        } else {
          ctx.fillText(b.text, b.x * SKALA, b.y * SKALA);
        }
      }
      const jpg = await canvasToBytes(hal.canvas, "image/jpeg", 0.92);
      hal.canvas.width = hal.canvas.height = 0;
      const lebarPt = hal.viewport.width / SKALA;
      const tinggiPt = hal.viewport.height / SKALA;
      const img = await doc.embedJpg(jpg);
      const p = doc.addPage([lebarPt, tinggiPt]);
      p.drawImage(img, { x: 0, y: 0, width: lebarPt, height: tinggiPt });
      /* Lapisan teks tak terlihat -> hasil tetap bisa dicari & disalin. */
      for (const b of hasil) {
        if (!b || !b.text) continue;
        await drawTextSafe(p, bersihkanTeks(b.text), {
          x: b.x,
          y: tinggiPt - b.y,
          size: Math.max(4, b.size * 0.8),
          color: C.rgb(0, 0, 0),
          opacity: 0,
          maxWidth: b.w * 1.02,
        });
      }
      await tick();
    }
    return await saveDoc(doc);
  }

  register({
    id: "translate",
    cat: "ai",
    name: "Terjemah PDF",
    desc: "Terjemahkan teks PDF dengan AI daring, mesin bawaan peramban, atau mesin offline bawaan aplikasi.",
    icon: "translate",
    accept: ".pdf,application/pdf",
    multiple: true,
    custom: "translateAI",
    fields: [
      { type: "select", id: "lang", label: "Bahasa tujuan", value: "en", options: TERJEMAH_LANG },
      { type: "select", id: "src", label: "Bahasa sumber", value: "id", options: TERJEMAH_LANG },
      {
        type: "select", id: "engine", label: "Mesin terjemahan", value: "auto",
        options: [
          ["auto", "Otomatis — AI daring dulu, lalu bawaan peramban, lalu offline"],
          ["online", "AI daring (server online)"],
          ["builtin", "Bawaan peramban (Chrome 138+)"],
          ["offline", "Offline bawaan aplikasi (privat, tanpa internet)"],
        ],
      },
      {
        type: "select", id: "format", label: "Hasil", value: "both",
        options: [
          ["both", "Markdown + PDF terjemahan"],
          ["md", "Markdown (.md) saja"],
          ["pdf", "PDF terjemahan (.pdf) saja"],
        ],
      },
      {
        type: "select", id: "latar", label: "Latar PDF terjemahan", value: "asli",
        options: [
          ["asli", "Halaman asli (teks asli ditutup, foto/stempel tetap)"],
          ["putih", "Latar putih bersih"],
        ],
      },
      {
        type: "check", id: "aiAllow", label: "Izinkan kirim teks ke server AI daring", value: true,
      },
      {
        type: "note",
        text: "Mesin AI daring menerjemahkan per kalimat lengkap (bukan per baris) dan membaca beberapa baris " +
          "sekaligus, jadi hasilnya lebih akurat. Matikan izin di atas kalau dokumen tidak boleh keluar dari perangkat — " +
          "mesin offline bawaan aplikasi (Indonesia ⇄ Inggris) tetap bisa dipakai tanpa internet.",
      },
    ],
    async run(ctx) {
      const TR = window.PDFTranslate;
      if (!TR) throw new Error("Modul mesin terjemahan belum termuat (tool-translate.js).");

      const from = String(ctx.opts.src || "id");
      const to = String(ctx.opts.lang || "en");
      const mode = String(ctx.opts.engine || "auto");
      if (from === to) {
        throw new Error("Bahasa sumber dan bahasa tujuan sama — tidak ada yang perlu diterjemahkan.");
      }
      const aiOpsi = Object.assign({}, ctx.opts.ai || {});
      const aiAllow = ctx.opts.aiAllow !== false;
      const format = String(ctx.opts.format || "both");
      const latar = String(ctx.opts.latar || "asli");

      /* Menyiapkan mesin harus terjadi di dalam gestur klik (Chrome
         mewajibkan user gesture saat model bahasa perlu diunduh),
         jadi prepare() dipanggil sinkron, sebelum await pertama. */
      const plan = TR.prepare({
        from: from,
        to: to,
        mode: mode,
        aiAllow: aiAllow,
        ai: {
          engineId: String(aiOpsi.engineId || ""),
          apiKey: String(aiOpsi.apiKey || ""),
          model: String(aiOpsi.model || ""),
          endpoint: String(aiOpsi.endpoint || ""),
          glossary: String(aiOpsi.glossary || ""),
        },
        onProgress: (t) => ctx.progress(null, t),
      });
      const engine = await TR.create(plan);
      const namaMesin =
        engine.kind === "online"
          ? "AI daring (" + (engine.label || engine.engineId || "server") + ")"
          : engine.kind === "offline"
            ? "mesin offline"
            : "mesin bawaan peramban";
      ctx.progress(null, "Menerjemahkan dengan " + namaMesin + "…");

      const out = [];
      let totalHalaman = 0;
      let totalBaris = 0;
      let cachePakai = 0;
      let terkirim = 0;
      const tMulai = (typeof performance !== "undefined" ? performance : Date).now();

      for (const f of ctx.files) {
        const pdfjs = await openPdfjs(f.bytes);
        try {
          /* 1. Ambil teks per halaman (ruang tampilan). */
          const asliBaris = [];
          const satuanHalaman = [];
          for (let i = 1; i <= pdfjs.numPages; i++) {
            const baris = await barisTampilan(pdfjs, i);
            asliBaris.push(baris);
            satuanHalaman.push(buatSatuan(baris));
            totalHalaman++;
            await tick();
          }

          /* 2. Terjemahkan per halaman, per kalimat. */
          const hasilBaris = [];
          const hasilHalaman = [];
          for (let h = 0; h < satuanHalaman.length; h++) {
            const satuan = satuanHalaman[h];
            if (!satuan.length) { hasilBaris.push([]); hasilHalaman.push(""); continue; }
            ctx.progress(null, f.name + ": menterjemahkan halaman " + (h + 1) + "/" + satuanHalaman.length + "…");
            const prefix = TR.cachePrefix(engine, from, to);
            const perlu = [];
            for (const s of satuan) {
              if (TR.cacheGet(prefix + s.text) !== undefined) continue;
              if (!TR.layakTerjemahkan(s.text)) continue;
              perlu.push(s.text);
            }
            cachePakai += satuan.length - perlu.length;
            if (perlu.length) {
              const diterjemah = await engine.translateBatch(perlu, {
                glossary: String(aiOpsi.glossary || ""),
              });
              terkirim += perlu.length;
              for (let i = 0; i < perlu.length; i++) {
                TR.cacheSet(prefix + perlu[i], diterjemah[i] != null ? diterjemah[i] : "");
              }
            }
            /* Susun baris hasil: kalimat diterjemahan dipecah lagi ke
               baris asalnya supaya posisinya tetap cocok. */
            const baris = [];
            for (const s of satuan) {
              const c = TR.cacheGet(prefix + s.text);
              const teks = c !== undefined ? c : s.text;
              const pecah = pecahKeBaris(teks, s.baris);
              for (let i = 0; i < s.baris.length; i++) {
                baris.push({
                  text: pecah[i] || "",
                  x: s.baris[i].x, y: s.baris[i].y, w: s.baris[i].w,
                  size: s.baris[i].size, h: s.baris[i].h,
                });
              }
            }
            totalBaris += baris.length;
            hasilBaris.push(baris);
            hasilHalaman.push(baris.map((b) => b.text).join("\n"));
          }

          /* 3. Hasil: Markdown dan/atau PDF terjemahan. */
          const dasar = C.safeName(C.baseName(f.name));
          const catatan = namaMesin + " · " + hasilHalaman.length + " halaman · " + totalBaris + " baris";
          if (format === "md" || format === "both") {
            const md = ["# " + C.baseName(f.name), "> " + catatan, ...hasilHalaman].join("\n\n") + "\n";
            const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
            out.push({ name: dasar + "-terjemahan.md", blob: blob, note: catatan });
          }
          if (format === "pdf" || format === "both") {
            ctx.progress(null, f.name + ": menyusun PDF terjemahan…");
            const bytes = await buatPdfTerjemahan(pdfjs, hasilBaris, asliBaris, { latar: latar });
            out.push({ name: dasar + "-terjemahan.pdf", bytes: bytes, note: catatan + " · PDF" });
          }
        } finally {
          try { await pdfjs.destroy(); } catch (_) { /* abaikan */ }
        }
      }

      /* Catatan mesin (mis. AI daring gagal lalu turun ke offline). */
      const catatanMesin = (plan.catatan || []).join(" ");
      const dt = Math.round(((typeof performance !== "undefined" ? performance : Date).now() - tMulai) / 100) / 10;
      if (out.length) {
        out[out.length - 1].note += " · " + dt + " dtk";
        if (catatanMesin) out[out.length - 1].note += " · " + catatanMesin;
      }
      void cachePakai;
      void terkirim;
      return out;
    },
  });

  /* ============================================================
     9. OCR PDF — mesin Tesseract offline (disimpan di vendor/)
     ------------------------------------------------------------
     Mesin OCR dimuat malas dari vendor/tesseract (tanpa internet),
     lalu setiap kata hasil pengenalan diletakkan sebagai lapisan
     teks tak terlihat di atas gambar halaman. Hasilnya PDF hasil
     pindai jadi bisa dicari & disalin teksnya.
     ============================================================ */

  let tessLib = null;
  let tessLibPromise = null;

  /* Muat pustaka Tesseract dari folder vendor (sekali saja). */
  function loadTesseract() {
    if (window.Tesseract) { tessLib = window.Tesseract; return Promise.resolve(tessLib); }
    if (tessLibPromise) return tessLibPromise;
    tessLibPromise = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "vendor/tesseract/tesseract.min.js";
      s.onload = () => {
        if (!window.Tesseract) { rej(new Error("Pustaka OCR tidak termuat.")); return; }
        tessLib = window.Tesseract;
        res(tessLib);
      };
      s.onerror = () => {
        tessLibPromise = null;
        rej(new Error("Mesin OCR offline tidak ditemukan (vendor/tesseract)."));
      };
      document.head.appendChild(s);
    });
    return tessLibPromise;
  }

  /* Buat worker OCR. Ada dua core (SIMD & biasa); kalau yang SIMD
     gagal dipakai, otomatis turun ke yang biasa. */
  async function createOcrWorker(langs, onLog) {
    const T = await loadTesseract();
    const base = new URL("vendor/tesseract/", location.href).href;
    const cores = ["tesseract-core-simd-lstm.wasm.js", "tesseract-core-lstm.wasm.js"];
    let lastErr = null;
    for (const core of cores) {
      try {
        return await T.createWorker(langs, 1, {
          workerPath: base + "worker.min.js",
          corePath: base + core,
          langPath: base + "lang",
          gzip: true,
          logger: (m) => { if (onLog) onLog(m); },
        });
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error("Mesin OCR tidak bisa dijalankan: " + ((lastErr && lastErr.message) || lastErr));
  }

  /* ============================================================
     OCR — mesin Tesseract offline (vendor/tesseract).

     Prinsip:
     - Dokumen asli DISALAMAT di tempat (pdf-lib). Vektor, metadata,
       field formulir, anotasi, dan bookmark tetap utuh.
     - Halaman yang sudah punya lapisan teks TIDAK di-OCR ulang
       (kecuali dipaksa) supaya hasilnya tidak lebih buruk.
     - Koordinat kata dihitung lewat viewport pdf.js, jadi rotasi
       halaman (/Rotate) dan CropBox ikut tertangani.
     - Lebar teks disesuaikan dengan kotak kata aslinya supaya
       tidak ada spasi palsu saat teks diekstraksi.
     ============================================================ */

  /* Buang karakter yang tidak tersedia di font standar (Helvetica)
     supaya drawText tidak gagal dan kata tetap bisa dibaca. */
  function bersihkanTeks(t) {
    return String(t == null ? "" : t)
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/\u2026/g, "...")
      .replace(/[^\x20-\x7E\xA1-\xFF]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /* Kumpulkan kata + kotaknya dari hasil pengenalan Tesseract. */
  function kumpulkanKata(data) {
    const out = [];
    const blocks = (data && data.blocks) || [];
    for (const b of blocks) {
      for (const p of (b.paragraphs || [])) {
        for (const l of (p.lines || [])) {
          for (const w of (l.words || [])) {
            const bb = w.bbox;
            const text = (w.text || "").trim();
            if (!text || !bb) continue;
            out.push({
              text,
              x0: bb.x0, y0: bb.y0, x1: bb.x1, y1: bb.y1,
            });
          }
        }
      }
    }
    if (!out.length && data && data.text) {
      /* tanpa blok: pakai baris kasar supaya teks tetap terbaca */
      const lines = String(data.text).split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
      lines.forEach((text, i) => {
        out.push({
          text, x0: 0, y0: i * 30, x1: 200, y1: i * 30 + 24, kasar: true,
        });
      });
    }
    return out;
  }

  /* Abu-abu + rentang kontras (percentile 2%-98%). Pindai berkontras
     rendah jauh lebih sulit dibaca mesin OCR; penyesuaian ini meningkatkan
     ketepatan tanpa merusak halaman (hanya salinan untuk pengenalan,
     bukan berkas aslinya). */
  function perbaikiKontras(src) {
    const c = document.createElement("canvas");
    c.width = src.width;
    c.height = src.height;
    const ctx = c.getContext("2d", { alpha: false });
    ctx.drawImage(src, 0, 0);
    let data;
    try {
      data = ctx.getImageData(0, 0, c.width, c.height);
    } catch (_) {
      return src; /* data kanvas tidak terbaca -> pakai aslinya */
    }
    const d = data.data;
    const hist = new Uint32Array(256);
    const total = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0;
      d[i] = d[i + 1] = d[i + 2] = l;
      hist[l]++;
    }
    const batasBawah = total * 0.02;
    const batasAtas = total * 0.98;
    let lo = 0, hi = 255, n = 0;
    for (let v = 0; v < 256; v++) { n += hist[v]; if (n >= batasBawah) { lo = v; break; } }
    n = 0;
    for (let v = 255; v >= 0; v--) { n += hist[v]; if (n >= total - batasAtas) { hi = v; break; } }
    if (hi - lo < 24) return c; /* kontras sudah baik */
    const rentang = hi - lo;
    for (let i = 0; i < d.length; i += 4) {
      let v = (d[i] - lo) * 255 / rentang;
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(data, 0, 0);
    return c;
  }

  /* Kotak kata (px kanvas) -> posisi PDF user space (absolut).
     Memakai viewport pdf.js supaya rotasi halaman (/Rotate) dan
     perbedaan CropBox/MediaBox ikut tertangani — tanpa ini lapisan
     teks akan meleset pada halaman pindai yang berotasi/tercrop.
     Hasilnya membawa arah baseline (sudut) supaya teks bisa ditulis
     dengan kemiringan yang sama seperti isi halaman aslinya. */
  function kotakKePdf(viewport, w) {
    const kiriBawah = viewport.convertToPdfPoint(w.x0, w.y1);
    const kananBawah = viewport.convertToPdfPoint(w.x1, w.y1);
    const kiriAtas = viewport.convertToPdfPoint(w.x0, w.y0);
    const dx = kananBawah[0] - kiriBawah[0];
    const dy = kananBawah[1] - kiriBawah[1];
    const ux = kiriAtas[0] - kiriBawah[0];
    const uy = kiriAtas[1] - kiriBawah[1];
    return {
      x: kiriBawah[0],
      y: kiriBawah[1],
      lebar: Math.hypot(dx, dy),
      tinggi: Math.hypot(ux, uy),
      sudut: (Math.atan2(dy, dx) * 180) / Math.PI,
    };
  }

  /* Kotak kata (px kanvas) -> posisi ruang tampilan (titik PDF,
     titik-y-bawah, ukuran sama dengan yang tampil di layar). Dipakai
     untuk halaman yang dibangun ulang (tanpa rotasi). */
  function kotakKeTampilan(w, scale, tinggiTampil) {
    const x0 = Math.min(w.x0, w.x1) / scale;
    const x1 = Math.max(w.x0, w.x1) / scale;
    const atas = Math.min(w.y0, w.y1) / scale;
    const bawah = Math.max(w.y0, w.y1) / scale;
    return {
      x: x0,
      y: tinggiTampil - bawah,
      lebar: x1 - x0,
      tinggi: bawah - atas,
      sudut: 0,
    };
  }

  /* Tulis satu kata di dalam kotaknya.
     Ukuran huruf dihitung ulang agar teks mengisi kotak: pdf-lib
     hanya bisa menyusutkan teks (maxWidth), tidak memperbesar —
     karena itu lebarnya dibatasi agar tidak menabrak kata sebelah
     dan tidak menyisakan celah yang berubah jadi spasi palsu. */
  async function tulisKata(page, teks, box, opsi) {
    const teksAman = bersihkanTeks(teks);
    if (!teksAman) return true;
    const bw = Math.max(0.6, box.lebar);
    const bh = Math.max(0.6, box.tinggi);
    const font = await fontFor(page.doc, opsi.font || "Helvetica");
    const satuan = font.widthOfTextAtSize(teksAman, 1) || 1;
    const ukuranLebar = bw / satuan;      /* tepat selebar kotak */
    const ukuranTinggi = bh * 0.82;      /* mengikuti tinggi huruf */
    let size = Math.min(ukuranLebar, ukuranTinggi * 2);
    if (!isFinite(size) || size <= 0) size = 8;
    size = Math.max(4, Math.min(size, 96));
    /* "font" di drawTextSafe adalah NAMA font, bukan objek font. */
    const ok = await drawTextSafe(page, teksAman, {
      x: box.x,
      y: box.y,
      size,
      rotate: C.degrees(box.sudut || 0),
      color: C.rgb(0, 0, 0),
      opacity: opsi.visible ? 1 : 0,
      maxWidth: bw * 1.02,
    });
    return ok !== false;
  }

  /* Kosongkan isi halaman (gambar + teks lama) lalu buang objeknya
     dari berkas supaya ukurannya tidak membengkak. Dipakai saat
     halaman harus dibangun ulang (mode dokumen bersih / paksa OCR
     pada halaman berteks). */
  function kosongkanHalaman(doc, page) {
    const node = page.node;
    const hapus = (ref) => { try { doc.context.delete(ref); } catch (_) { /* abaikan */ } };
    const isi = node.get(PDFName.of("Contents"));
    if (isi instanceof PDFArray) {
      for (const r of isi.asArray()) hapus(r);
    } else if (isi) {
      hapus(isi);
    }
    node.delete(PDFName.of("Contents"));
    /* cache stream internal pdf-lib harus dibuang juga */
    page.contentStream = undefined;
    page.contentStreamRef = undefined;
    /* buang gambar lama dari resource (dan objeknya) */
    const res = node.get(PDFName.of("Resources"));
    if (res) {
      const dict = doc.context.lookup(res);
      if (dict && dict.get) {
        const xobj = dict.get(PDFName.of("XObject"));
        if (xobj) {
          const xd = doc.context.lookup(xobj);
          if (xd && xd.entries) {
            for (const [, v] of xd.entries()) hapus(v);
          }
          dict.set(PDFName.of("XObject"), doc.context.obj({}));
        }
      }
    }
  }

  /* OCR satu halaman: render -> recognising -> kotak kata.
     Mengembalikan kotak dalam dua sistem koordinat:
       abs  : PDF user space (dipakai pada halaman asli yang dipertahankan)
       tamp : ruang tampilan (dipakai pada halaman yang dibangun ulang) */
  async function ocrHalaman(o) {
    const { pdfjs, nomor, worker, dpi, perbaiki, pakaiJpeg, laporkan } = o;
    const { canvas, viewport } = await renderPage(pdfjs, nomor, dpi / 72);
    const scale = dpi / 72;
    const tinggiTampil = viewport.height / scale;
    const lebarTampil = viewport.width / scale;
    let sumber = canvas;
    if (perbaiki) {
      try { sumber = perbaikiKontras(canvas); } catch (_) { sumber = canvas; }
    }

    let kata = [];
    if (worker) {
      const res = await worker.recognize(sumber, {}, { text: true, blocks: true });
      kata = kumpulkanKata(res && res.data);
    } else if ("TextDetector" in window) {
      try {
        const detektor = new window.TextDetector();
        const bitmap = await createImageBitmap(sumber);
        const blok = await detektor.detect(bitmap);
        kata = blok.map((b) => ({
          text: b.rawValue || "",
          x0: b.boundingBox.x, y0: b.boundingBox.y,
          x1: b.boundingBox.x + b.boundingBox.width,
          y1: b.boundingBox.y + b.boundingBox.height,
        })).filter((w) => w.text);
      } catch (_) {
        kata = [];
      }
    }

    let jpeg = null;
    if (pakaiJpeg) {
      try { jpeg = await canvasToBytes(canvas, "image/jpeg", 0.9); } catch (_) { jpeg = null; }
    }
    canvas.width = canvas.height = 0;
    if (sumber !== canvas) { sumber.width = sumber.height = 0; }

    /* Buang kotak yang jauh lebih besar daripada rata-rata — biasanya
       garis/rangka gambar yang salah dibaca mesin OCR sebagai huruf
       raksasa (mis. "ME" dari garis kotak sertifikat). */
    let dibuang = 0;
    if (kata.length >= 8) {
      const tinggi = kata.map((w) => w.y1 - w.y0).sort((a, b) => a - b);
      const median = tinggi[Math.floor(tinggi.length / 2)] || 0;
      if (median > 0) {
        const batas = median * 3;
        const tetap = kata.filter((w) => (w.y1 - w.y0) <= batas);
        if (tetap.length >= kata.length * 0.5) {
          dibuang = kata.length - tetap.length;
          kata = tetap;
        }
      }
    }
    const hasil = kata.map((w, i) => {
      if (w.kasar) {
        /* tanpa kotak dari mesin OCR: susun berurutan dari atas halaman */
        const y = tinggiTampil - 24 - i * 14;
        const kotak = { x: 12, y: y, lebar: Math.min(320, lebarTampil - 24), tinggi: 12, sudut: 0 };
        return { teks: w.text, abs: kotak, tamp: kotak };
      }
      return {
        teks: w.text,
        abs: kotakKePdf(viewport, w),
        tamp: kotakKeTampilan(w, scale, tinggiTampil),
      };
    });
    if (laporkan) laporkan(hasil.length + (dibuang ? ` (${dibuang} artefak dilewati)` : ""));
    return { kata: hasil, lebar: lebarTampil, tinggi: tinggiTampil, jpeg };
  }

  register({
    id: "ocr",
    cat: "optimize",
    name: "OCR PDF",
    desc: "Tambahkan lapisan teks ke PDF hasil pindai dengan mesin OCR offline Tesseract (Indonesia/Inggris). Dokumen asli tetap utuh; teks bisa dicari & disalin.",
    icon: "ocr",
    accept: ".pdf,application/pdf",
    multiple: true,
    fields: [
      {
        type: "select", id: "lang", label: "Bahasa pengenalan", value: "ind",
        options: [
          ["ind", "Indonesia (paling cepat)"],
          ["eng", "Inggris"],
          ["ind+eng", "Indonesia + Inggris (paling akurat, lebih lambat)"],
        ],
      },
      { type: "number", id: "scale", label: "Resolusi OCR (DPI)", value: 200, min: 100, max: 400 },
      {
        type: "select", id: "mode", label: "Hasil", value: "searchable",
        options: [
          ["searchable", "Teks tak terlihat — PDF bisa dicari & disalin"],
          ["clean", "Dokumen bersih — latar putih + teks hasil OCR"],
          ["overlay", "Teks terlihat di atas gambar pindai"],
        ],
      },
      {
        type: "select", id: "existing", label: "Halaman yang sudah ada teksnya", value: "skip",
        options: [
          ["skip", "Lewati — pertahankan teks aslinya"],
          ["force", "OCR juga — teks asli diganti hasil OCR"],
        ],
      },
      { type: "check", id: "contrast", label: "Perbaiki kontras hasil pindai (lebih akurat)", value: true },
      { type: "number", id: "workers", label: "Jumlah mesin OCR (paralel)", value: 2, min: 1, max: 4 },
      { type: "pagerange", id: "halaman", label: "Halaman yang di-OCR", value: { mode: "all", dari: 1, sampai: 0 } },
    ],
    async run(ctx) {
      const dpi = Math.min(400, Math.max(100, Number(ctx.opts.scale) || 200));
      const langs = String(ctx.opts.lang || "ind");
      const mode = String(ctx.opts.mode || "searchable");
      const paksa = ctx.opts.existing === "force";
      const perbaiki = ctx.opts.contrast !== false;
      const jumlahMesin = Math.min(4, Math.max(1, Number(ctx.opts.workers) || 2));
      const out = [];
      const workers = [];
      try {
        try {
          for (let i = 0; i < jumlahMesin; i++) {
            workers.push(await createOcrWorker(langs, (m) => {
              if (m && m.status && m.status.indexOf("recognizing") === 0) {
                ctx.progress(null, "Mesin OCR sedang mengenali teks…");
              }
            }));
          }
        } catch (err) {
          /* mesin offline tidak tersedia -> pakai deteksi bawaan peramban */
          if (!("TextDetector" in window)) throw err;
          workers.length = 0;
        }

        for (const f of ctx.files) {
          ctx.progress(0, `Menyiapkan ${f.name}…`);
          /* Dokumen pdf-lib dibaca SEKALI dan dimodifikasi di tempat:
             vektor, metadata, field formulir, anotasi, dan bookmark
             tetap utuh. (Versi lama membuat dokumen baru per halaman
             sehingga semua itu hilang.) */
          const doc = await loadDoc(f.bytes);
          const pdfjs = await openPdfjs(f.bytes);
          const jumlah = pdfjs.numPages;

          /* Halaman yang diproses = pilihan rentang halaman. Halaman
             di luar rentang TIDAK diubah sama sekali (teks & gambar
             aslinya tetap utuh). */
          const spec = C.normSpesifikasiHalaman(ctx.opts.halaman, jumlah);
          /* Rentang di luar jangkauan -> pesan jelas, jangan dipaksa. */
          C.pastikanHalamanTerpilih(spec, jumlah, f.name);
          const terpilih = new Set(C.halamanTerpilih(spec, jumlah));

          /* 1. Petakan halaman: punya teks atau tidak. */
          const rencana = [];
          for (let i = 1; i <= jumlah; i++) {
            const hal = await pdfjs.getPage(i);
            let adaTeks = false;
            try {
              const tc = await hal.getTextContent();
              let n = 0;
              for (const it of tc.items) n += (it.str || "").trim().length;
              adaTeks = n >= 30;
            } catch (_) { /* abaikan */ }
            const diLuar = !terpilih.has(i);
            rencana.push({ nomor: i, adaTeks, lewati: diLuar || (adaTeks && !paksa) });
            ctx.progress(Math.round((i / jumlah) * 5), `Memeriksa halaman ${i}/${jumlah}…`);
            await tick();
          }

          /* 2. OCR halaman yang perlu, paralel dengan beberapa mesin. */
          const antre = rencana.filter((r) => !r.lewati);
          const hasil = new Map();
          let selesai = 0;
          const total = antre.length || 1;
          const jalankan = async (w, daftar) => {
            for (const r of daftar) {
              const h = await ocrHalaman({
                pdfjs, nomor: r.nomor, worker: w, dpi, perbaiki,
                pakaiJpeg: mode !== "clean" && r.adaTeks,
                laporkan: (jumlahKata) => {
                  selesai++;
                  ctx.progress(5 + Math.round((selesai / total) * 75),
                    `Mengenali teks halaman ${r.nomor}/${jumlah} — ${jumlahKata} kata`);
                },
              });
              hasil.set(r.nomor, h);
            }
          };
          if (workers.length) {
            const bagi = Array.from({ length: workers.length }, () => []);
            antre.forEach((r, i) => bagi[i % workers.length].push(r));
            await Promise.all(workers.map((w, wi) => jalankan(w, bagi[wi])));
          } else {
            await jalankan(null, antre);
          }

          /* 3. Tulis hasilnya ke halaman yang sesuai. */
          for (const r of rencana) {
            if (r.lewati) continue;
            const h = hasil.get(r.nomor);
            if (!h || !h.kata.length) continue;
            const page = doc.getPage(r.nomor - 1);

            if (mode === "searchable" && !r.adaTeks) {
              /* Halaman pindai: pertahankan gambar aslinya, tambahkan
                 lapisan teks tak terlihat. Tidak ada duplikasi dan
                 berkas tetap ramping. */
              for (const kata of h.kata) {
                await tulisKata(page, kata.teks, kata.abs, { visible: false });
              }
            } else if (mode === "overlay" && !r.adaTeks) {
              /* Hasil pindai: teks OCR tampil di atas gambarnya. */
              for (const kata of h.kata) {
                await tulisKata(page, kata.teks, kata.abs, { visible: true });
              }
            } else {
              /* Halaman dibangun ulang: gambar pindai (jika ada) +
                 teks OCR. Teks asli dibuang supaya tidak dobel. */
              kosongkanHalaman(doc, page);
              page.setMediaBox(0, 0, h.lebar, h.tinggi);
              page.setCropBox(0, 0, h.lebar, h.tinggi);
              page.setRotation(C.degrees(0));
              if (mode !== "clean" && h.jpeg) {
                try {
                  const img = await doc.embedJpg(h.jpeg);
                  page.drawImage(img, { x: 0, y: 0, width: h.lebar, height: h.tinggi });
                } catch (_) { /* gambar gagal -> tetap teks saja */ }
              }
              if (mode === "overlay" && h.jpeg) {
                /* tutup teks yang tertanam di gambar supaya tidak dobel */
                for (const kata of h.kata) {
                  const b = kata.tamp;
                  page.drawRectangle({
                    x: b.x - 0.5, y: b.y - b.tinggi * 0.25,
                    width: b.lebar + 1, height: b.tinggi * 1.3,
                    color: C.rgb(1, 1, 1),
                  });
                }
              }
              for (const kata of h.kata) {
                await tulisKata(page, kata.teks, kata.tamp, { visible: mode !== "searchable" });
              }
            }
            ctx.progress(80 + Math.round((r.nomor / jumlah) * 15), `Menulis halaman ${r.nomor}…`);
            await tick();
          }

          try { await pdfjs.destroy(); } catch (_) { /* abaikan */ }
          const bytes = await saveDoc(doc);
          out.push({
            name: C.safeName(C.baseName(f.name)) + "-ocr.pdf",
            bytes,
            note: terpilih.size === jumlah ? "" : `${terpilih.size} dari ${jumlah} halaman di-OCR`,
          });
          ctx.progress(100, `${f.name} selesai.`);
        }
        return out;
      } finally {
        /* Worker Tesseract harus selalu dimatikan — kalau tidak, mesin
           WASM (ratusan MB) tetap hidup di memory peramban. */
        for (const w of workers) {
          try { await w.terminate(); } catch (_) { /* abaikan */ }
        }
      }
    },
  });

  window.PDFToolsSmart = { encryptPdf, diffLines, findMatches, groupLines, pickSummary };
})();
