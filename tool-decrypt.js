/* ============================================================
   tool-decrypt.js
   Parser PDF tingkat rendah + Standard Security Handler
   (ISO 32000-1 §7.6 "Encryption" dan ISO 32000-2 §7.6.4 AES-256).

   Tujuan: membuka PDF terenkripsi menjadi PDF biasa (tanpa
   /Encrypt) TANPA merasterisasi isi. Semua objek, stream, dan
   string didekripsi lalu ditulis ulang sebagai PDF utuh.
   ============================================================ */
(function () {
  "use strict";

  const K = window.PDFToolsCrypto || {};
  const enc = new TextEncoder();

  /* ============================================================
     1. Inflate (zlib / raw deflate)
     ============================================================ */

  const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
    35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3,
    4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
    257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289,
    16385, 24577];
  const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8,
    9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  const CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  function buildHuffman(lengths, n) {
    const counts = new Uint16Array(16);
    for (let i = 0; i < n; i++) counts[lengths[i]]++;
    counts[0] = 0;
    const offsets = new Uint16Array(16);
    let total = 0;
    for (let i = 1; i < 16; i++) { offsets[i] = total; total += counts[i]; }
    const symbols = new Uint16Array(total);
    for (let i = 0; i < n; i++) {
      if (lengths[i]) symbols[offsets[lengths[i]]++] = i;
    }
    return { counts, symbols };
  }

  function inflatePure(data, start) {
    /* bitPos = posisi bit absolut; bitBuf menyimpan bit yang belum dipakai. */
    let bitPos = (start || 0) << 3;
    let bitBuf = 0;
    let bitCnt = 0;
    const out = [];
    let outLen = 0;

    function grow(extra) {
      if (out.length < outLen + extra) out.length = outLen + extra + 1024;
    }
    function bits(need) {
      while (bitCnt < need) {
        const idx = bitPos >> 3;
        if (idx >= data.length) throw new Error("inflate: data tidak lengkap");
        bitBuf |= data[idx] << bitCnt;
        bitCnt += 8;
        bitPos += 8;
      }
      const v = bitBuf & ((1 << need) - 1);
      bitBuf >>>= need;
      bitCnt -= need;
      return v;
    }
    /* Kembalikan ke batas byte; byte berikutnya dibaca langsung dari data. */
    function alignToByte() {
      const drop = bitCnt % 8;
      bitBuf >>>= drop;
      bitCnt -= drop;
      bitPos -= bitCnt;
      bitBuf = 0;
      bitCnt = 0;
    }
    function decodeSym(huff) {
      let code = 0, first = 0, index = 0;
      for (let len = 1; len < 16; len++) {
        code |= bits(1);
        const count = huff.counts[len];
        if (code - first < count) return huff.symbols[index + (code - first)];
        index += count;
        first = (first + count) << 1;
        code <<= 1;
      }
      throw new Error("inflate: kode Huffman tidak valid");
    }

    const FIXED_LIT = (() => {
      const l = new Uint8Array(288);
      l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288);
      return buildHuffman(l, 288);
    })();
    const FIXED_DIST = (() => {
      const l = new Uint8Array(30); l.fill(5);
      return buildHuffman(l, 30);
    })();

    let last = 0;
    do {
      last = bits(1);
      const type = bits(2);
      if (type === 0) {
        alignToByte();
        let p = bitPos >> 3;
        if (p + 4 > data.length) throw new Error("inflate: blok tersimpan tidak lengkap");
        const len = data[p] | (data[p + 1] << 8);
        p += 4;
        if (p + len > data.length) throw new Error("inflate: blok tersimpan terpotong");
        grow(len);
        for (let i = 0; i < len; i++) out[outLen++] = data[p++];
        bitPos = p << 3;
      } else if (type === 1 || type === 2) {
        let lit, dist;
        if (type === 1) { lit = FIXED_LIT; dist = FIXED_DIST; }
        else {
          const hlit = bits(5) + 257;
          const hdist = bits(5) + 1;
          const hclen = bits(4) + 4;
          const clens = new Uint8Array(19);
          for (let i = 0; i < hclen; i++) clens[CLEN_ORDER[i]] = bits(3);
          const clHuff = buildHuffman(clens, 19);
          const lens = new Uint8Array(hlit + hdist);
          let i = 0;
          while (i < lens.length) {
            const sym = decodeSym(clHuff);
            if (sym < 16) lens[i++] = sym;
            else if (sym === 16) {
              const prev = lens[i - 1];
              let rep = 3 + bits(2);
              while (rep-- > 0 && i < lens.length) lens[i++] = prev;
            } else if (sym === 17) {
              let rep = 3 + bits(3);
              while (rep-- > 0 && i < lens.length) lens[i++] = 0;
            } else {
              let rep = 11 + bits(7);
              while (rep-- > 0 && i < lens.length) lens[i++] = 0;
            }
          }
          lit = buildHuffman(lens.subarray(0, hlit), hlit);
          dist = buildHuffman(lens.subarray(hlit), hdist);
        }
        for (;;) {
          const sym = decodeSym(lit);
          if (sym < 256) { grow(1); out[outLen++] = sym; }
          else if (sym === 256) break;
          else {
            const li = sym - 257;
            if (li >= LEN_BASE.length) throw new Error("inflate: simbol panjang tidak valid");
            const length = LEN_BASE[li] + bits(LEN_EXTRA[li]);
            const dsym = decodeSym(dist);
            const back = DIST_BASE[dsym] + bits(DIST_EXTRA[dsym]);
            grow(length);
            let from = outLen - back;
            if (from < 0) throw new Error("inflate: jarak rujukan tidak valid");
            for (let k = 0; k < length; k++) out[outLen++] = out[from++];
          }
        }
      } else {
        throw new Error("inflate: tipe blok tidak dikenal");
      }
    } while (!last);

    return new Uint8Array(out.slice(0, outLen));
  }

  /* Deteksi pembungkus zlib (2 byte header + adler32 di ekor). */
  function looksZlib(data) {
    if (!data || data.length < 2) return false;
    if ((data[0] & 0x0f) !== 8) return false;
    return ((((data[0] << 8) | data[1]) % 31) === 0);
  }

  function inflatePureAuto(data) {
    const z = looksZlib(data);
    try {
      return inflatePure(data, z ? 2 : 0);
    } catch (e) {
      return inflatePure(data, z ? 0 : 2);
    }
  }

  async function inflate(data) {
    if (!data || !data.length) return new Uint8Array(0);
    if (typeof DecompressionStream === "function") {
      for (const fmt of ["deflate", "deflate-raw"]) {
        try {
          const ds = new DecompressionStream(fmt);
          const stream = new Blob([data]).stream().pipeThrough(ds);
          const buf = await new Response(stream).arrayBuffer();
          return new Uint8Array(buf);
        } catch (_) { /* coba format lain / fallback JS */ }
      }
    }
    return inflatePureAuto(data);
  }

  /* ============================================================
     2. Objek PDF: parsing & serialisasi
     ============================================================ */

  const WS = new Uint8Array(256);
  [0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20].forEach((c) => { WS[c] = 1; });
  const DELIM = new Uint8Array(256);
  "()<>[]{}/%".split("").forEach((c) => { DELIM[c.charCodeAt(0)] = 1; });

  function isWS(c) { return WS[c] === 1; }
  function isDelim(c) { return DELIM[c] === 1; }
  function latin(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  class PdfReader {
    constructor(bytes) { this.b = bytes; }

    skipWs(pos) {
      const b = this.b;
      let p = pos;
      for (;;) {
        while (p < b.length && isWS(b[p])) p++;
        if (p < b.length && b[p] === 0x25) {
          while (p < b.length && b[p] !== 0x0a && b[p] !== 0x0d) p++;
          continue;
        }
        break;
      }
      return p;
    }

    readToken(pos) {
      const b = this.b;
      pos = this.skipWs(pos);
      if (pos >= b.length) return { type: "eof", pos };
      const c = b[pos];
      if (c === 0x2f) return this.readName(pos);
      if (c === 0x28) return this.readLiteralString(pos);
      if (c === 0x3c) {
        if (b[pos + 1] === 0x3c) return { type: "dict-open", pos: pos + 2 };
        return this.readHexString(pos);
      }
      if (c === 0x5b) return { type: "array-open", pos: pos + 1 };
      if (c === 0x5d || c === 0x3e || c === 0x7d || c === 0x7b) return { type: "close", ch: c, pos: pos + 1 };
      if ((c >= 0x30 && c <= 0x39) || c === 0x2b || c === 0x2d || c === 0x2e) {
        return this.readNumber(pos);
      }
      let e = pos;
      while (e < b.length && !isWS(b[e]) && !isDelim(b[e])) e++;
      return { type: "keyword", kw: latin(b.subarray(pos, e)), pos: e };
    }

    readNumber(pos) {
      const b = this.b;
      let e = pos;
      if (b[e] === 0x2b || b[e] === 0x2d) e++;
      let sawDigit = false, sawDot = false;
      while (e < b.length) {
        const c = b[e];
        if (c >= 0x30 && c <= 0x39) { sawDigit = true; e++; continue; }
        if (c === 0x2e && !sawDot) { sawDot = true; e++; continue; }
        break;
      }
      const raw = latin(b.subarray(pos, e));
      let value = sawDot ? parseFloat(raw) : parseInt(raw, 10);
      if (!isFinite(value)) value = 0;
      return { type: "number", value, pos: e, raw };
    }

    readName(pos) {
      const b = this.b;
      let e = pos + 1;
      const out = [];
      while (e < b.length && !isWS(b[e]) && !isDelim(b[e])) {
        if (b[e] === 0x23 && e + 2 < b.length) {
          const h = latin(b.subarray(e + 1, e + 3));
          if (/^[0-9a-fA-F]{2}$/.test(h)) { out.push(parseInt(h, 16)); e += 3; continue; }
        }
        out.push(b[e]); e++;
      }
      return { type: "name", name: latin(new Uint8Array(out)), pos: e };
    }

    readLiteralString(pos) {
      const b = this.b;
      let p = pos + 1;
      let depth = 1;
      const out = [];
      while (p < b.length) {
        const c = b[p];
        if (c === 0x5c) {
          p++;
          if (p >= b.length) break;
          const e = b[p];
          if (e === 0x6e) { out.push(0x0a); p++; }
          else if (e === 0x72) { out.push(0x0d); p++; }
          else if (e === 0x74) { out.push(0x09); p++; }
          else if (e === 0x62) { out.push(0x08); p++; }
          else if (e === 0x66) { out.push(0x0c); p++; }
          else if (e === 0x0a) { p++; }
          else if (e === 0x0d) { p++; if (b[p] === 0x0a) p++; }
          else if (e >= 0x30 && e <= 0x37) {
            let val = 0, n = 0;
            while (n < 3 && p < b.length && b[p] >= 0x30 && b[p] <= 0x37) {
              val = val * 8 + (b[p] - 0x30); p++; n++;
            }
            out.push(val & 255);
          } else { out.push(e); p++; }
          continue;
        }
        if (c === 0x28) { depth++; out.push(c); p++; continue; }
        if (c === 0x29) { depth--; if (depth === 0) { p++; break; } out.push(c); p++; continue; }
        out.push(c); p++;
      }
      return { type: "string", bytes: new Uint8Array(out), pos: p };
    }

    readHexString(pos) {
      const b = this.b;
      let p = pos + 1;
      const hexDigits = [];
      while (p < b.length && b[p] !== 0x3e) {
        const ch = String.fromCharCode(b[p]);
        if (/[0-9a-fA-F]/.test(ch)) hexDigits.push(ch);
        p++;
      }
      if (p < b.length) p++;
      if (hexDigits.length % 2) hexDigits.push("0");
      const out = new Uint8Array(hexDigits.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = parseInt(hexDigits[i * 2] + hexDigits[i * 2 + 1], 16);
      return { type: "string", bytes: out, pos: p };
    }

    parseValue(pos, depth) {
      depth = depth || 0;
      if (depth > 96) return { type: "null", pos };
      const tok = this.readToken(pos);
      switch (tok.type) {
        case "number": {
          const t2 = this.readToken(tok.pos);
          if (t2.type === "number" && Number.isInteger(tok.value) && Number.isInteger(t2.value)) {
            const t3 = this.readToken(t2.pos);
            if (t3.type === "keyword" && t3.kw === "R") {
              return { type: "ref", num: tok.value, gen: t2.value, pos: t3.pos };
            }
          }
          return { type: "num", value: tok.value, pos: tok.pos };
        }
        case "name": return { type: "name", name: tok.name, pos: tok.pos };
        case "string": return { type: "str", bytes: tok.bytes, pos: tok.pos };
        case "dict-open": {
          const map = new Map();
          let p = tok.pos;
          for (;;) {
            p = this.skipWs(p);
            if (p >= this.b.length) break;
            if (this.b[p] === 0x3e && this.b[p + 1] === 0x3e) { p += 2; break; }
            const key = this.readToken(p);
            if (key.type !== "name") {
              p = key.pos > p ? key.pos : p + 1;
              continue;
            }
            const val = this.parseValue(key.pos, depth + 1);
            map.set(key.name, val);
            p = val.pos;
          }
          return { type: "dict", map, pos: p };
        }
        case "array-open": {
          const items = [];
          let p = tok.pos;
          for (;;) {
            p = this.skipWs(p);
            if (p >= this.b.length) break;
            if (this.b[p] === 0x5d) { p++; break; }
            const before = p;
            const val = this.parseValue(p, depth + 1);
            if (val.pos <= before) { p = before + 1; continue; }
            items.push(val);
            p = val.pos;
          }
          return { type: "arr", items, pos: p };
        }
        case "keyword": {
          if (tok.kw === "true") return { type: "bool", value: true, pos: tok.pos };
          if (tok.kw === "false") return { type: "bool", value: false, pos: tok.pos };
          return { type: "null", pos: tok.pos };
        }
        default:
          return { type: "null", pos: tok.pos };
      }
    }
  }

  /* ---------- Serialisasi ---------- */

  function serializeValue(v, out) {
    if (!v) { out.push("null"); return; }
    switch (v.type) {
      case "num": out.push(numToStr(v.value)); break;
      case "name": out.push("/" + escapeName(v.name)); break;
      case "str": out.push(hexStr(v.bytes)); break;
      case "bool": out.push(v.value ? "true" : "false"); break;
      case "null": out.push("null"); break;
      case "arr":
        out.push("[");
        v.items.forEach((it, i) => { if (i) out.push(" "); serializeValue(it, out); });
        out.push("]");
        break;
      case "dict": {
        out.push("<<");
        for (const [k, val] of v.map) {
          out.push(" /" + escapeName(k) + " ");
          serializeValue(val, out);
        }
        out.push(" >>");
        break;
      }
      case "ref": out.push(v.num + " " + v.gen + " R"); break;
      case "stream": {
        const d = new Map(v.dict.map);
        d.set("Length", { type: "num", value: v.data.length });
        serializeValue({ type: "dict", map: d }, out);
        out.push("\nstream\n");
        out.push(v.data);
        out.push("\nendstream");
        break;
      }
      default: out.push("null");
    }
  }

  /* Gabungkan potongan (string UTF-8 & biner) menjadi satu Uint8Array. */
  function concatChunks(chunks) {
    let len = 0;
    const parts = chunks.map((c) => {
      const b = typeof c === "string" ? enc.encode(c) : c;
      len += b.length;
      return b;
    });
    const out = new Uint8Array(len);
    let o = 0;
    for (const b of parts) { out.set(b, o); o += b.length; }
    return out;
  }

  function numToStr(n) {
    if (!isFinite(n)) return "0";
    return Number.isInteger(n) ? String(n) : String(n);
  }

  function escapeName(name) {
    let s = "";
    for (const ch of String(name)) {
      const c = ch.charCodeAt(0);
      if (c < 0x21 || c > 0x7e || "()<>[]{}/%#".includes(ch)) {
        s += "#" + c.toString(16).padStart(2, "0");
      } else s += ch;
    }
    return s;
  }

  function hexStr(bytes) {
    let s = "<";
    for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
    return s + ">";
  }

  /* ============================================================
     3. XRef: tabel klasik & stream
     ============================================================ */

  function findStartXRef(reader) {
    const b = reader.b;
    const tailLen = Math.min(b.length, 4096);
    const tail = latin(b.subarray(b.length - tailLen));
    const idx = tail.lastIndexOf("startxref");
    if (idx < 0) return -1;
    const m = /startxref\s+(\d+)/.exec(tail.slice(idx));
    return m ? parseInt(m[1], 10) : -1;
  }

  async function parseXRef(reader) {
    const entries = new Map();
    const trailers = [];
    const start = findStartXRef(reader);
    if (start < 0) throw new Error("Tabel referensi silang (xref) tidak ditemukan.");
    const seen = new Set();
    const queue = [start];
    let hybridDone = false;

    while (queue.length) {
      const off = queue.shift();
      if (off == null || off < 0 || off >= reader.b.length) continue;
      if (seen.has(off)) continue;
      seen.add(off);
      const tok = reader.readToken(off);
      if (tok.type === "keyword" && tok.kw === "xref") {
        const res = parseClassicXref(reader, tok.pos, entries);
        if (res.trailer) trailers.push(res.trailer);
        const t = res.trailer;
        if (t) {
          const prev = dictGet(t, "Prev");
          if (typeof prev === "number" && !seen.has(prev)) queue.push(prev);
          const xs = dictGet(t, "XRefStm");
          if (!hybridDone && typeof xs === "number") { hybridDone = true; queue.push(xs); }
        }
      } else {
        const obj = await readIndirectObject(reader, off, null);
        if (!obj || !obj.value || obj.value.type !== "stream") continue;
        const res = await parseXRefStream(obj.value, entries);
        trailers.push(res.trailer);
        const t = res.trailer;
        const prev = dictGet(t, "Prev");
        if (typeof prev === "number" && !seen.has(prev)) queue.push(prev);
        const xs = dictGet(t, "XRefStm");
        if (!hybridDone && typeof xs === "number") { hybridDone = true; queue.push(xs); }
      }
    }
    if (!trailers.length) throw new Error("xref tidak bisa dibaca.");
    return { entries, trailer: trailers[0] };
  }

  function parseClassicXref(reader, pos, entries) {
    const b = reader.b;
    let p = reader.skipWs(pos);
    let trailer = null;
    for (;;) {
      p = reader.skipWs(p);
      if (p >= b.length) break;
      if (b[p] === 0x74 && latin(b.subarray(p, p + 7)) === "trailer") {
        const tv = reader.parseValue(p + 7, 0);
        trailer = tv && tv.type === "dict" ? tv : null;
        break;
      }
      const t1 = reader.readToken(p);
      if (t1.type !== "number") break;
      const t2 = reader.readToken(t1.pos);
      if (t2.type !== "number") break;
      p = t2.pos;
      const start = t1.value, count = t2.value;
      for (let i = 0; i < count; i++) {
        const a = reader.readToken(p);
        const c = reader.readToken(a.pos);
        const d = reader.readToken(c.pos);
        p = d.pos;
        if (a.type !== "number") continue;
        const num = start + i;
        if (d.type === "keyword" && d.kw === "n" && !entries.has(num)) {
          entries.set(num, { type: 1, offset: a.value, gen: c.type === "number" ? c.value : 0 });
        }
      }
    }
    return { trailer };
  }

  async function parseXRefStream(stream, entries) {
    const dict = stream.dict;
    const W = dictGet(dict, "W");
    if (!W || W.type !== "arr") throw new Error("XRef stream tanpa /W.");
    const widths = W.items.map((it) => (it && it.type === "num" ? it.value : 0));
    const index = dictGet(dict, "Index");
    const pairs = [];
    if (index && index.type === "arr") {
      const a = index.items;
      for (let i = 0; i + 1 < a.length; i += 2) {
        pairs.push([a[i].value, a[i + 1].value]);
      }
    } else {
      const size = dictGet(dict, "Size");
      pairs.push([0, size && size.type === "num" ? size.value : 0]);
    }
    const data = await decodeStreamBytes(stream);
    if (!data) throw new Error("XRef stream tidak bisa didekode.");
    const rowLen = widths.reduce((x, y) => x + y, 0);
    let pos = 0;
    for (const [start, count] of pairs) {
      for (let i = 0; i < count; i++) {
        if (pos + rowLen > data.length) break;
        const fields = [];
        for (let w = 0; w < widths.length; w++) {
          const width = widths[w];
          let val = 0;
          for (let k = 0; k < width; k++) val = val * 256 + data[pos++];
          fields.push(width === 0 ? null : val);
        }
        const type = fields[0] == null ? 1 : fields[0];
        const num = start + i;
        if (entries.has(num)) continue;
        if (type === 1) entries.set(num, { type: 1, offset: fields[1], gen: fields[2] || 0 });
        else if (type === 2) entries.set(num, { type: 2, objStm: fields[1], index: fields[2] || 0 });
      }
    }
    return { trailer: { type: "dict", map: dict.map } };
  }

  function indexOfBytes(b, needle, from) {
    const n = needle.length;
    for (let i = Math.max(0, from); i + n <= b.length; i++) {
      let ok = true;
      for (let j = 0; j < n; j++) if (b[i + j] !== needle[j]) { ok = false; break; }
      if (ok) return i;
    }
    return -1;
  }

  /* ---------- Baca objek tak langsung ---------- */

  function readIndirectObjectSync(reader, offset) {
    const b = reader.b;
    const t1 = reader.readToken(offset);
    if (t1.type !== "number") return null;
    const t2 = reader.readToken(t1.pos);
    if (t2.type !== "number") return null;
    const t3 = reader.readToken(t2.pos);
    if (t3.type !== "keyword" || t3.kw !== "obj") return null;
    const val = reader.parseValue(t3.pos, 0);
    const t4 = reader.readToken(val.pos);
    if (t4.type === "keyword" && t4.kw === "stream") {
      let sp = t4.pos;
      if (b[sp] === 0x0d) sp++;
      if (b[sp] === 0x0a) sp++;
      const dict = val && val.type === "dict" ? val : { type: "dict", map: new Map() };
      const lenVal = dictGet(dict, "Length");
      if (!lenVal || lenVal.type !== "num") return { num: t1.value, gen: t2.value, value: dict };
      const length = lenVal.value;
      if (sp + length > b.length) return { num: t1.value, gen: t2.value, value: dict };
      return {
        num: t1.value, gen: t2.value,
        value: { type: "stream", dict, data: b.subarray(sp, sp + length) },
      };
    }
    return { num: t1.value, gen: t2.value, value: val };
  }

  async function readIndirectObject(reader, offset, resolveLength) {
    const b = reader.b;
    const t1 = reader.readToken(offset);
    if (t1.type !== "number") return null;
    const t2 = reader.readToken(t1.pos);
    if (t2.type !== "number") return null;
    const t3 = reader.readToken(t2.pos);
    if (t3.type !== "keyword" || t3.kw !== "obj") return null;
    const val = reader.parseValue(t3.pos, 0);
    const t4 = reader.readToken(val.pos);
    if (t4.type !== "keyword" || t4.kw !== "stream") {
      return { num: t1.value, gen: t2.value, value: val };
    }
    let sp = t4.pos;
    if (b[sp] === 0x0d) sp++;
    if (b[sp] === 0x0a) sp++;
    const dict = val && val.type === "dict" ? val : { type: "dict", map: new Map() };
    let length = null;
    const lenVal = dictGet(dict, "Length");
    if (lenVal) {
      if (lenVal.type === "num") length = lenVal.value;
      else if (lenVal.type === "ref" && typeof resolveLength === "function") {
        const resolved = resolveLength(lenVal.num, lenVal.gen);
        if (typeof resolved === "number") length = resolved;
      }
    }
    let data = null;
    if (typeof length === "number" && length >= 0 && sp + length <= b.length) {
      const candidate = b.subarray(sp, sp + length);
      const after = reader.skipWs(sp + length);
      const tk = reader.readToken(after);
      if (tk.type === "keyword" && tk.kw === "endstream") data = candidate;
    }
    if (!data) {
      const idx = indexOfBytes(b, "endstream", sp);
      if (idx < 0) return null;
      let end = idx;
      if (end > sp && b[end - 1] === 0x0a) end--;
      if (end > sp && b[end - 1] === 0x0d) end--;
      data = b.subarray(sp, end);
    }
    return { num: t1.value, gen: t2.value, value: { type: "stream", dict, data } };
  }

  /* ---------- Filter & prediktor ---------- */

  function applyPredictor(data, predictor, colors, bpc, columns) {
    if (!predictor || predictor < 2) return data;
    const bpp = Math.ceil((colors * bpc) / 8);
    const rowLen = Math.ceil((colors * bpc * columns) / 8);
    if (predictor === 2) {
      if (bpc !== 8) return data;
      const out = new Uint8Array(data);
      for (let r = 0; r * rowLen < out.length; r++) {
        const base = r * rowLen;
        for (let i = bpp; i < rowLen && base + i < out.length; i++) {
          out[base + i] = (out[base + i] + out[base + i - bpp]) & 255;
        }
      }
      return out;
    }
    const nRows = Math.floor(data.length / (rowLen + 1));
    const out = new Uint8Array(nRows * rowLen);
    let prev = new Uint8Array(rowLen);
    let sp = 0, dp = 0;
    for (let r = 0; r < nRows; r++) {
      const ft = data[sp++];
      const row = data.subarray(sp, sp + rowLen);
      sp += rowLen;
      const cur = new Uint8Array(rowLen);
      for (let i = 0; i < rowLen; i++) {
        const raw = row[i];
        const left = i >= bpp ? cur[i - bpp] : 0;
        const up = prev[i];
        const upLeft = i >= bpp ? prev[i - bpp] : 0;
        let v;
        switch (ft) {
          case 0: v = raw; break;
          case 1: v = raw + left; break;
          case 2: v = raw + up; break;
          case 3: v = raw + ((left + up) >> 1); break;
          case 4: {
            const p = left + up - upLeft;
            const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
            v = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
            break;
          }
          default: v = raw;
        }
        cur[i] = v & 255;
      }
      out.set(cur, dp);
      dp += rowLen;
      prev = cur;
    }
    return out;
  }

  function decodeAHx(bytes) {
    const out = [];
    let hi = -1;
    for (let i = 0; i < bytes.length; i++) {
      const ch = String.fromCharCode(bytes[i]);
      if (ch === ">") break;
      const v = parseInt(ch, 16);
      if (isNaN(v)) continue;
      if (hi < 0) hi = v;
      else { out.push((hi << 4) | v); hi = -1; }
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
      if (c === 0x7a && tuple.length === 0) { out.push(0, 0, 0, 0); continue; }
      tuple.push(c - 33);
      if (tuple.length === 5) {
        let v = 0;
        for (const d of tuple) v = v * 85 + d;
        out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
        tuple = [];
      }
    }
    if (tuple.length) {
      const n = tuple.length;
      for (let j = 0; j < 5 - n; j++) tuple.push(84);
      let v = 0;
      for (const d of tuple) v = v * 85 + d;
      const bs = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
      for (let j = 0; j < n - 1; j++) out.push(bs[j]);
    }
    return new Uint8Array(out);
  }

  async function decodeStreamBytes(stream) {
    let data = stream.data;
    const filters = collectFilters(stream.dict);
    for (const f of filters) {
      if (f.name === "FlateDecode" || f.name === "Fl") {
        data = await inflate(data);
      } else if (f.name === "ASCIIHexDecode" || f.name === "AHx") {
        data = decodeAHx(data);
      } else if (f.name === "ASCII85Decode" || f.name === "A85") {
        data = decodeA85(data);
      } else if (f.name === "Crypt") {
        /* ditangani terpisah oleh pemanggil */
      } else {
        return null;
      }
      if (f.parms && f.parms.type === "dict") {
        const pred = dictGet(f.parms, "Predictor");
        if (pred && pred.type === "num" && pred.value > 1) {
          const colors = numOf(dictGet(f.parms, "Colors"), 1);
          const bpc = numOf(dictGet(f.parms, "BitsPerComponent"), 8);
          const columns = numOf(dictGet(f.parms, "Columns"), 1);
          data = applyPredictor(data, pred.value, colors, bpc, columns);
        }
      }
    }
    return data;
  }

  /* ============================================================
     4. Standard Security Handler
     ============================================================ */

  function dictGet(dict, name) {
    return dict && dict.type === "dict" ? dict.map.get(name) : undefined;
  }
  function dictNum(dict, name, dflt) {
    const v = dictGet(dict, name);
    return v && v.type === "num" ? v.value : dflt;
  }
  function dictName(dict, name) {
    const v = dictGet(dict, name);
    return v && v.type === "name" ? v.name : null;
  }
  function dictStr(dict, name) {
    const v = dictGet(dict, name);
    return v && v.type === "str" ? v.bytes : null;
  }
  function numOf(v, dflt) { return v && v.type === "num" ? v.value : dflt; }

  function bytesEqual(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function concatBytes(...parts) {
    let len = 0;
    for (const p of parts) len += p.length;
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  function le32(n) {
    const u = n >>> 0;
    return new Uint8Array([u & 255, (u >>> 8) & 255, (u >>> 16) & 255, (u >>> 24) & 255]);
  }

  /* Hash untuk R6 (ISO 32000-2 Algorithm 2.B). */
  function hashR6(password, salt, udata) {
    let k = K.sha256(concatBytes(password, salt, udata));
    let count = 0;
    for (;;) {
      count++;
      const k1 = concatBytes(password, k, udata);
      const repeated = new Uint8Array(k1.length * 64);
      for (let i = 0; i < 64; i++) repeated.set(k1, i * k1.length);
      const e = K.aesEncryptCbcNoPad(k.subarray(0, 16), k.subarray(16, 32), repeated);
      let sum = 0;
      for (let i = 0; i < 16; i++) sum += e[i];
      const alg = sum % 3 === 0 ? 256 : sum % 3 === 1 ? 384 : 512;
      k = K.sha2(alg, e);
      if (count >= 64 && e[e.length - 1] <= count - 32) break;
    }
    return k.subarray(0, 32);
  }

  function hashR5(password, salt, udata) {
    return K.sha256(concatBytes(password, salt, udata));
  }

  function padFallback(pw, mode) {
    const s = String(pw == null ? "" : pw);
    let bytes;
    if (mode === "utf8") {
      bytes = enc.encode(s);
    } else {
      bytes = new Uint8Array(Math.min(s.length, 32));
      for (let i = 0; i < bytes.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
    }
    const out = new Uint8Array(32);
    const n = Math.min(bytes.length, 32);
    out.set(bytes.subarray(0, n), 0);
    const PAD = K.PAD || new Uint8Array(0);
    out.set(PAD.subarray(0, 32 - n), n);
    return out;
  }

  function buildDecryptor(encDict, fileId, password) {
    const V = dictNum(encDict, "V", 0);
    const R = dictNum(encDict, "R", 0);
    const O = dictStr(encDict, "O");
    const U = dictStr(encDict, "U");
    const P = dictNum(encDict, "P", 0);
    const lengthBits = dictNum(encDict, "Length", 40);
    const encryptMetadata = dictNum(encDict, "EncryptMetadata", 1) !== 0;
    const id = fileId || new Uint8Array(0);

    if (!O || !U) throw new Error("Kamus /Encrypt tidak lengkap (/O atau /U hilang).");

    let fileKey = null;
    let usedOwner = false;

    if (R >= 5) {
      const pw = (K.passwordBytes ? K.passwordBytes(password) : enc.encode(String(password == null ? "" : password)).subarray(0, 127));
      const zeroIV = new Uint8Array(16);
      const uValSalt = U.subarray(32, 40);
      const uKeySalt = U.subarray(40, 48);
      const uHash = R === 5 ? hashR5(pw, uValSalt, new Uint8Array(0)) : hashR6(pw, uValSalt, new Uint8Array(0));
      if (bytesEqual(uHash, U.subarray(0, 32))) {
        const UE = dictStr(encDict, "UE");
        if (!UE) throw new Error("Kamus /Encrypt R5/R6 tanpa /UE.");
        const tmpKey = R === 5 ? hashR5(pw, uKeySalt, new Uint8Array(0)) : hashR6(pw, uKeySalt, new Uint8Array(0));
        fileKey = K.aesDecryptCbc(tmpKey, concatBytes(zeroIV, UE), false);
      } else {
        const oValSalt = O.subarray(32, 40);
        const oKeySalt = O.subarray(40, 48);
        const oHash = R === 5 ? hashR5(pw, oValSalt, U.subarray(0, 48)) : hashR6(pw, oValSalt, U.subarray(0, 48));
        if (!bytesEqual(oHash, O.subarray(0, 32))) throw new Error("Password salah.");
        const OE = dictStr(encDict, "OE");
        if (!OE) throw new Error("Kamus /Encrypt R5/R6 tanpa /OE.");
        const tmpKey = R === 5 ? hashR5(pw, oKeySalt, U.subarray(0, 48)) : hashR6(pw, oKeySalt, U.subarray(0, 48));
        fileKey = K.aesDecryptCbc(tmpKey, concatBytes(zeroIV, OE), false);
        usedOwner = true;
      }
      if (!fileKey || fileKey.length !== 32) throw new Error("Kunci berkas AES-256 tidak bisa dihitung.");
    } else {
      const keyBytes = R === 2 ? 5 : Math.max(5, Math.floor(lengthBits / 8));
      /* Dua cara pengodean password dipakai pembaca: satu byte per karakter
         (pdf.js) dan UTF-8 (pypdf/qpdf). Coba keduanya. */
      const modes = ["latin1", "utf8"];
      for (const mode of modes) {
        const padPw = K.padPassword ? K.padPassword(password, mode) : padFallback(password, mode);
        const fk = K.encryptionKey(padPw, O, P, id, R, keyBytes);
        if (bytesEqual(K.userValue(fk, id, R).subarray(0, 16), U.subarray(0, 16))) {
          fileKey = fk;
          break;
        }
        /* password pemilik: kembalikan password pengguna dari /O */
        const ok = K.ownerKey(padPw, R, keyBytes).subarray(0, keyBytes);
        let userPad;
        if (R === 2) {
          userPad = K.rc4(ok, O);
        } else {
          let data = O;
          for (let i = 19; i >= 1; i--) data = K.rc4(K.xorKey(ok, i), data);
          userPad = K.rc4(ok, data);
        }
        const fk2 = K.encryptionKey(userPad, O, P, id, R, keyBytes);
        if (bytesEqual(K.userValue(fk2, id, R).subarray(0, 16), U.subarray(0, 16))) {
          fileKey = fk2;
          usedOwner = true;
          break;
        }
      }
      if (!fileKey) throw new Error("Password salah.");
    }

    const cf = dictGet(encDict, "CF");
    const stmFName = dictName(encDict, "StmF") || "Identity";
    const strFName = dictName(encDict, "StrF") || "Identity";
    const effName = dictName(encDict, "EFF") || "Identity";

    function cfMethod(name) {
      if (!cf || cf.type !== "dict") return null;
      const c = cf.map.get(name);
      if (!c || c.type !== "dict") return null;
      return { method: dictName(c, "CFM") || "V2", length: dictNum(c, "Length", lengthBits) };
    }
    const stmCF = cfMethod(stmFName);
    const strCF = cfMethod(strFName);
    const effCF = cfMethod(effName);
    const defaultMethod = V >= 5 ? "AESV3" : (V === 4 ? "AESV2" : "V2");
    const stmMethod = stmCF ? stmCF.method : (V >= 5 ? "AESV3" : defaultMethod);
    const strMethod = strCF ? strCF.method : (V >= 5 ? "AESV3" : defaultMethod);
    const effMethod = effCF ? effCF.method : (V >= 5 ? "AESV3" : defaultMethod);

    function objKeyFor(method, num, gen) {
      if (method === "AESV3") return fileKey;
      const n = V === 1 ? 5 : Math.max(5, Math.floor(lengthBits / 8));
      const isAes = method === "AESV2";
      const base = concatBytes(
        fileKey.subarray(0, n),
        new Uint8Array([num & 255, (num >> 8) & 255, (num >> 16) & 255, gen & 255, (gen >> 8) & 255]),
        isAes ? new Uint8Array([0x73, 0x41, 0x6c, 0x54]) : new Uint8Array(0),
      );
      return K.md5(base).subarray(0, Math.min(n + 5, 16));
    }

    function applyCipher(method, key, data) {
      if (method === "Identity" || method === "None") return data;
      if (method === "AESV2") return K.aesDecryptCbc(key, data, true);
      if (method === "AESV3") return K.aesDecryptCbc(key, data, false);
      return K.rc4(key, data);
    }

    return {
      V, R, P, lengthBits, encryptMetadata, fileKey, usedOwner,
      stmMethod, strMethod, effMethod, cfDict: cf,
      objKeyFor, applyCipher,
      decryptString(bytes, num, gen) {
        if (strMethod === "Identity") return bytes;
        return applyCipher(strMethod, objKeyFor(strMethod, num, gen), bytes);
      },
      decryptStream(bytes, num, gen, method) {
        const m = method || stmMethod;
        if (m === "Identity" || m === "None") return bytes;
        return applyCipher(m, objKeyFor(m, num, gen), bytes);
      },
    };
  }

  /* ============================================================
     5. Dekripsi dokumen
     ============================================================ */

  async function decryptPdf(bytes, password) {
    const reader = new PdfReader(bytes);
    const { entries, trailer } = await parseXRef(reader);

    const encRef = dictGet(trailer, "Encrypt");
    if (!encRef) {
      const err = new Error("PDF ini tidak memiliki /Encrypt — tidak ada password untuk dibuka.");
      err.code = "NOT_ENCRYPTED";
      throw err;
    }

    const encDict = await resolveEncryptDict(reader, entries, encRef);
    if (!encDict) throw new Error("Kamus /Encrypt tidak bisa dibaca.");

    let fileId = new Uint8Array(0);
    const idArr = dictGet(trailer, "ID");
    if (idArr && idArr.type === "arr" && idArr.items.length) {
      const first = idArr.items[0];
      if (first && first.type === "str") fileId = first.bytes;
    }

    const dec = buildDecryptor(encDict, fileId, password);

    const resolveLength = (num) => {
      const e = entries.get(num);
      if (!e || e.type !== 1) return null;
      const o = readIndirectObjectSync(reader, e.offset);
      if (!o || !o.value) return null;
      const lv = dictGet(o.value.type === "stream" ? o.value.dict : o.value, "Length");
      return lv && lv.type === "num" ? lv.value : null;
    };

    /* --- object stream --- */
    const objStmNums = new Set();
    for (const [, e] of entries) if (e.type === 2) objStmNums.add(e.objStm);
    const objStmCache = new Map();
    for (const stmNum of objStmNums) {
      const stm = await loadObjStm(reader, entries, stmNum, dec, resolveLength);
      if (stm) objStmCache.set(stmNum, stm);
    }

    const objects = new Map();
    const encryptNum = encRef.type === "ref" ? encRef.num : null;

    for (const [num, e] of entries) {
      if (num <= 0) continue;
      if (encryptNum != null && num === encryptNum) continue;
      let obj = null;
      if (e.type === 1) {
        obj = await readIndirectObject(reader, e.offset, resolveLength);
        if (obj) obj = await decryptObject(obj, dec);
      } else if (e.type === 2) {
        const stm = objStmCache.get(e.objStm);
        if (stm && stm.objects[e.index]) {
          const inner = stm.objects[e.index];
          obj = { num: inner.num, gen: inner.gen, value: inner.value };
        }
      }
      if (!obj || !obj.value) continue;
      const t = obj.value.type === "stream" ? dictName(obj.value.dict, "Type") : null;
      if (t === "XRef" || t === "ObjStm") continue; /* tidak perlu ditulis ulang */
      objects.set(num, obj);
    }

    const out = rebuild(objects, trailer);

    return {
      bytes: out,
      info: {
        V: dec.V, R: dec.R, lengthBits: dec.lengthBits,
        method: dec.stmMethod, ownerPassword: dec.usedOwner,
        encryptMetadata: dec.encryptMetadata,
        objects: objects.size,
        pages: countPages(objects),
      },
    };
  }

  function countPages(objects) {
    let count = 0;
    for (const obj of objects.values()) {
      const v = obj.value;
      if (v && v.type === "dict" && dictName(v, "Type") === "Page") count++;
    }
    return count;
  }

  function resolveEncryptDict(reader, entries, encRef) {
    if (encRef.type === "dict") return encRef;
    if (encRef.type !== "ref") return null;
    const e = entries.get(encRef.num);
    if (!e || e.type !== 1) return null;
    const obj = readIndirectObjectSync(reader, e.offset);
    if (!obj || !obj.value) return null;
    return obj.value.type === "dict" ? obj.value : null;
  }

  async function loadObjStm(reader, entries, stmNum, dec, resolveLength) {
    const e = entries.get(stmNum);
    if (!e || e.type !== 1) return null;
    const obj = await readIndirectObject(reader, e.offset, resolveLength);
    if (!obj || !obj.value || obj.value.type !== "stream") return null;
    const stream = obj.value;
    /* Container /ObjStm terenkripsi sebagai satu kesatuan. */
    const plain = dec.decryptStream(stream.data, obj.num, obj.gen);
    const raw = await decodeStreamBytes({ type: "stream", dict: stream.dict, data: plain });
    if (!raw) return null;
    const n = dictNum(stream.dict, "N", 0);
    const first = dictNum(stream.dict, "First", 0);
    const head = new PdfReader(raw.subarray(0, Math.min(first, raw.length)));
    let p = 0;
    const pairs = [];
    for (let i = 0; i < n; i++) {
      const t1 = head.readToken(p);
      const t2 = head.readToken(t1.pos);
      if (t1.type !== "number" || t2.type !== "number") break;
      pairs.push({ num: t1.value, off: t2.value });
      p = t2.pos;
    }
    const objects = [];
    for (const pr of pairs) {
      const start = first + pr.off;
      if (start >= raw.length) continue;
      const sub = new PdfReader(raw);
      const val = sub.parseValue(start, 0);
      objects.push({ num: pr.num, gen: 0, value: val });
    }
    return { objects };
  }

  async function decryptObject(obj, dec) {
    const num = obj.num, gen = obj.gen;
    const value = obj.value;
    if (value && value.type === "stream") {
      const dict = value.dict;
      const type = dictName(dict, "Type");
      const filters = collectFilters(dict);
      const cryptIdx = filters.findIndex((f) => f.name === "Crypt");
      if (cryptIdx >= 0) {
        const parms = filters[cryptIdx].parms;
        const cfName = parms && parms.type === "dict" ? dictName(parms, "Name") : "Identity";
        const method = resolveExplicitCrypt(cfName, dec);
        const plain = dec.decryptStream(value.data, num, gen, method);
        const newDict = stripCryptFilter(dict);
        return { num, gen, value: { type: "stream", dict: newDict, data: plain } };
      }
      /* Stream metadata tidak terenkripsi bila /EncryptMetadata = false */
      if (type === "Metadata" && !dec.encryptMetadata) {
        return { num, gen, value: { type: "stream", dict, data: value.data } };
      }
      const method = type === "EmbeddedFile" ? dec.effMethod : dec.stmMethod;
      const plain = dec.decryptStream(value.data, num, gen, method);
      return { num, gen, value: { type: "stream", dict, data: plain } };
    }
    return { num, gen, value: decryptValue(value, dec, num, gen) };
  }

  function collectFilters(dict) {
    const out = [];
    const filt = dictGet(dict, "Filter");
    const parms = dictGet(dict, "DecodeParms") || dictGet(dict, "DP");
    if (filt && filt.type === "name") {
      /* Filter tunggal tetap bisa punya /DecodeParms (mis. /Predictor). */
      out.push({ name: filt.name, parms: parms && parms.type === "dict" ? parms : null });
    }
    else if (filt && filt.type === "arr") {
      const parr = parms && parms.type === "arr" ? parms.items : [];
      filt.items.forEach((f, i) => {
        if (f && f.type === "name") out.push({ name: f.name, parms: parr[i] || null });
      });
    }
    return out;
  }

  function stripCryptFilter(dict) {
    const map = new Map(dict.map);
    const filt = map.get("Filter");
    const parms = map.get("DecodeParms") || map.get("DP");
    if (filt && filt.type === "arr") {
      const idx = filt.items.findIndex((f) => f && f.type === "name" && f.name === "Crypt");
      if (idx >= 0) {
        map.set("Filter", { type: "arr", items: filt.items.filter((_, i) => i !== idx) });
        if (parms && parms.type === "arr") {
          map.set("DecodeParms", { type: "arr", items: parms.items.filter((_, i) => i !== idx) });
        }
      }
    } else if (filt && filt.type === "name" && filt.name === "Crypt") {
      map.delete("Filter");
      if (parms) map.delete("DecodeParms");
    }
    return { type: "dict", map };
  }

  function resolveExplicitCrypt(name, dec) {
    if (!name || name === "Identity") return "Identity";
    const cf = dec.cfDict;
    const c = cf && cf.type === "dict" ? cf.map.get(name) : null;
    if (!c || c.type !== "dict") return "Identity";
    return dictName(c, "CFM") || "V2";
  }

  function decryptValue(v, dec, num, gen) {
    if (!v) return v;
    switch (v.type) {
      case "str":
        return { type: "str", bytes: dec.decryptString(v.bytes, num, gen) };
      case "arr":
        return { type: "arr", items: v.items.map((it) => decryptValue(it, dec, num, gen)) };
      case "dict": {
        const map = new Map();
        for (const [k, val] of v.map) map.set(k, decryptValue(val, dec, num, gen));
        return { type: "dict", map };
      }
      default:
        return v;
    }
  }

  /* --- Tulis PDF baru (xref klasik, tanpa /Encrypt) --- */
  function rebuild(objects, trailer) {
    const chunks = [];
    let length = 0;
    const push = (x) => {
      const b = typeof x === "string" ? enc.encode(x) : x;
      chunks.push(b);
      length += b.length;
    };

    push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]));
    push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

    const written = new Map();
    const nums = Array.from(objects.keys()).sort((a, b) => a - b);
    for (const num of nums) {
      const obj = objects.get(num);
      if (!obj) continue;
      written.set(num, length);
      push(num + " " + obj.gen + " obj\n");
      const buf = [];
      serializeValue(obj.value, buf);
      push(concatChunks(buf));
      push("\nendobj\n");
    }

    const rootRef = dictGet(trailer, "Root");
    const infoRef = dictGet(trailer, "Info");
    const idArr = dictGet(trailer, "ID");
    const maxNum = nums.length ? nums[nums.length - 1] : 0;
    const tParts = [];
    tParts.push("<< /Size " + (maxNum + 1));
    if (rootRef && rootRef.type === "ref") { tParts.push(" /Root "); serializeValue(rootRef, tParts); }
    if (infoRef && infoRef.type === "ref" && objects.has(infoRef.num)) {
      tParts.push(" /Info "); serializeValue(infoRef, tParts);
    }
    if (idArr && idArr.type === "arr" && idArr.items.length) {
      tParts.push(" /ID [");
      idArr.items.forEach((it, i) => { if (i) tParts.push(" "); serializeValue(it, tParts); });
      tParts.push("]");
    }
    tParts.push(" >>");

    const xrefPos = length;
    push("xref\n0 " + (maxNum + 1) + "\n");
    push("0000000000 65535 f \n");
    for (let i = 1; i <= maxNum; i++) {
      const off = written.has(i) ? written.get(i) : null;
      if (off == null) push("0000000000 65535 f \n");
      else push(String(off).padStart(10, "0") + " 00000 n \n");
    }
    push("trailer\n");
    push(concatChunks(tParts));
    push("\nstartxref\n" + xrefPos + "\n%%EOF\n");

    const out = new Uint8Array(length);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  window.PDFToolsDecrypt = {
    decryptPdf,
    parseXRef, parseClassicXref, findStartXRef,
    inflatePure,
    inflatePureAuto,
    inflate,
    PdfReader,
    serializeValue,
    hexStr,
    buildDecryptor,
    applyPredictor,
  };
})();
