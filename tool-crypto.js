/* ============================================================
   Kripto PDF — MD5, RC4, dan AES-128-CBC untuk "Protect PDF"
   (standard security handler, V=4 / R=4 / 128 bit).

   Semua diimplementasikan sendiri supaya aplikasi tetap bisa
   berjalan offline tanpa pustaka tambahan.
   ============================================================ */
(function () {
  "use strict";

  /* ---------- MD5 ---------- */
  const MD5_S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const MD5_K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;

  function rotl(x, c) { return ((x << c) | (x >>> (32 - c))) >>> 0; }

  function md5(input) {
    const msg = input instanceof Uint8Array ? input : new Uint8Array(input);
    const bitLen = msg.length * 8;
    const padLen = ((56 - (msg.length + 1) % 64) + 64) % 64;
    const total = msg.length + 1 + padLen + 8;
    const buf = new Uint8Array(total);
    buf.set(msg, 0);
    buf[msg.length] = 0x80;
    const view = new DataView(buf.buffer);
    view.setUint32(total - 8, bitLen >>> 0, true);
    view.setUint32(total - 4, Math.floor(bitLen / 4294967296) >>> 0, true);

    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    for (let off = 0; off < total; off += 64) {
      const M = new Uint32Array(16);
      for (let j = 0; j < 16; j++) M[j] = view.getUint32(off + j * 4, true);
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        F = (F + A + MD5_K[i] + M[g]) >>> 0;
        A = D; D = C; C = B;
        B = (B + rotl(F, MD5_S[i])) >>> 0;
      }
      a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
    }
    const out = new Uint8Array(16);
    const ov = new DataView(out.buffer);
    ov.setUint32(0, a0, true); ov.setUint32(4, b0, true);
    ov.setUint32(8, c0, true); ov.setUint32(12, d0, true);
    return out;
  }

  /* ---------- RC4 ---------- */
  function rc4(key, data) {
    const S = new Uint8Array(256);
    for (let i = 0; i < 256; i++) S[i] = i;
    let j = 0;
    for (let i = 0; i < 256; i++) {
      j = (j + S[i] + key[i % key.length]) & 255;
      const t = S[i]; S[i] = S[j]; S[j] = t;
    }
    const out = new Uint8Array(data.length);
    let i = 0; j = 0;
    for (let k = 0; k < data.length; k++) {
      i = (i + 1) & 255;
      j = (j + S[i]) & 255;
      const t = S[i]; S[i] = S[j]; S[j] = t;
      out[k] = data[k] ^ S[(S[i] + S[j]) & 255];
    }
    return out;
  }

  /* ---------- AES-128 ---------- */
  const SBOX = new Uint8Array(256);
  (function () {
    const hex = "637c777bf26b6fc53001672bfed7ab76ca82c97dfa5947f0add4a2af9ca472c0" +
      "b7fd9326363ff7cc34a5e5f171d8311504c723c31896059a071280e2eb27b275" +
      "09832c1a1b6e5aa0523bd6b329e32f8453d100ed20fcb15b6acbbe394a4c58cf" +
      "d0efaafb434d338545f9027f503c9fa851a3408f929d38f5bcb6da2110fff3d2" +
      "cd0c13ec5f974417c4a77e3d645d197360814fdc222a908846eeb814de5e0bdb" +
      "e0323a0a4906245cc2d3ac629195e479e7c8376d8dd54ea96c56f4ea657aae08" +
      "ba78252e1ca6b4c6e8dd741f4bbd8b8a703eb5664803f60e613557b986c11d9e" +
      "e1f8981169d98e949b1e87e9ce5528df8ca1890dbfe6426841992d0fb054bb16";
    for (let i = 0; i < 256; i++) SBOX[i] = parseInt(hex.substr(i * 2, 2), 16);
  })();
  const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

  function xtime(b) { return ((b << 1) ^ (b & 0x80 ? 0x1b : 0)) & 255; }

  function aesExpandKey(key) {
    const NK = 4, NR = 10;
    const w = [];
    for (let i = 0; i < NK; i++) w.push(Array.from(key.slice(i * 4, i * 4 + 4)));
    for (let i = NK; i < 4 * (NR + 1); i++) {
      let t = w[i - 1].slice();
      if (i % NK === 0) {
        t = [t[1], t[2], t[3], t[0]];
        t = t.map((b) => SBOX[b]);
        t[0] ^= RCON[i / NK - 1];
      }
      const p = w[i - NK];
      w.push([p[0] ^ t[0], p[1] ^ t[1], p[2] ^ t[2], p[3] ^ t[3]]);
    }
    return w;
  }

  function aesEncryptBlock(block, w) {
    const s = new Uint8Array(16);
    for (let i = 0; i < 16; i++) s[i] = block[i] ^ w[i >> 2][i & 3];
    for (let round = 1; round <= 10; round++) {
      for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]];
      /* ShiftRows: baris r digeser ke kiri sebesar r posisi.
         Susunan state: s[r + 4*c] = state[baris r][kolom c]. */
      for (let r = 1; r < 4; r++) {
        const row = [s[r], s[r + 4], s[r + 8], s[r + 12]];
        for (let c = 0; c < 4; c++) s[r + 4 * c] = row[(c + r) % 4];
      }
      if (round !== 10) {
        for (let c = 0; c < 4; c++) {
          const i = c * 4;
          const a0 = s[i], a1 = s[i + 1], a2 = s[i + 2], a3 = s[i + 3];
          s[i] = (xtime(a0) ^ (xtime(a1) ^ a1) ^ a2 ^ a3) & 255;
          s[i + 1] = (a0 ^ xtime(a1) ^ (xtime(a2) ^ a2) ^ a3) & 255;
          s[i + 2] = (a0 ^ a1 ^ xtime(a2) ^ (xtime(a3) ^ a3)) & 255;
          s[i + 3] = ((xtime(a0) ^ a0) ^ a1 ^ a2 ^ xtime(a3)) & 255;
        }
      }
      for (let i = 0; i < 16; i++) s[i] ^= w[round * 4 + (i >> 2)][i & 3];
    }
    return s;
  }

  /* AES-128-CBC + padding PKCS#7; hasilnya IV || ciphertext */
  function aesEncryptCbc(key, plain) {
    const w = aesExpandKey(key);
    const blockSize = 16;
    const padLen = blockSize - (plain.length % blockSize);
    const padded = new Uint8Array(plain.length + padLen);
    padded.set(plain, 0);
    padded.fill(padLen, plain.length);
    const iv = new Uint8Array(16);
    crypto.getRandomValues(iv);
    const out = new Uint8Array(iv.length + padded.length);
    out.set(iv, 0);
    let prev = iv;
    for (let off = 0; off < padded.length; off += blockSize) {
      const block = new Uint8Array(16);
      for (let i = 0; i < 16; i++) block[i] = padded[off + i] ^ prev[i];
      const enc = aesEncryptBlock(block, w);
      out.set(enc, iv.length + off);
      prev = enc;
    }
    return out;
  }

  /* ---------- helper PDF ---------- */
  const PAD = new Uint8Array([
    0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56,
    0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80,
    0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
  ]);

  /* Padding password 32 byte (ISO 32000-1 §7.6.3.3).
     mode "latin1": satu byte per karakter (charCode & 0xff) — inilah yang
     dipakai pembaca umum (pdf.js) untuk R2-R4.
     mode "utf8"  : byte UTF-8 — dipakai pypdf/qpdf bila karakter > 255. */
  function padPassword(pw, mode) {
    const s = String(pw == null ? "" : pw);
    let bytes;
    if (mode === "utf8") {
      bytes = new TextEncoder().encode(s);
    } else {
      bytes = new Uint8Array(Math.min(s.length, 32));
      for (let i = 0; i < bytes.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
    }
    const out = new Uint8Array(32);
    const n = Math.min(bytes.length, 32);
    out.set(bytes.subarray(0, n), 0);
    out.set(PAD.subarray(0, 32 - n), n);
    return out;
  }

  /* Password mentah untuk R5/R6 (AES-256): UTF-8, dipangkas 127 byte. */
  function passwordBytes(pw) {
    const bytes = new TextEncoder().encode(String(pw == null ? "" : pw));
    return bytes.length > 127 ? bytes.subarray(0, 127) : bytes;
  }

  function concat(...parts) {
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

  function hex(bytes) {
    let s = "";
    for (const b of bytes) s += b.toString(16).padStart(2, "0");
    return s;
  }

  /* ============================================================
     Standard Security Handler (ISO 32000-1 §7.6.3)
       - Algorithm 2 : kunci berkas
       - Algorithm 3 : nilai /O
       - Algorithm 5 : nilai /U
     Fungsi murni (tidak menyentuh DOM) supaya bisa diuji.
     ============================================================ */

  /* RC4 key baru: tiap byte di-XOR dengan penghitung iterasi. */
  function xorKey(key, n) {
    const out = new Uint8Array(key.length);
    for (let i = 0; i < key.length; i++) out[i] = key[i] ^ n;
    return out;
  }

  /* Algorithm 3: kunci RC4 untuk nilai /O */
  function ownerKey(ownerPad, rev, keyBytes) {
    let h = md5(ownerPad);
    if (rev >= 3) {
      for (let i = 0; i < 50; i++) h = md5(h);
    }
    return h.subarray(0, keyBytes);
  }

  /* Algorithm 3 (lanjutan): nilai /O sepanjang 32 byte */
  function ownerValue(ownerPad, userPad, rev, keyBytes) {
    const k = ownerKey(ownerPad, rev, keyBytes);
    let data = rc4(k, userPad);
    if (rev >= 3) {
      for (let i = 1; i <= 19; i++) data = rc4(xorKey(k, i), data);
    }
    return data.subarray(0, 32);
  }

  /* Algorithm 2: kunci enkripsi berkas */
  function encryptionKey(userPad, O, P, idBytes, rev, keyBytes) {
    let h = md5(concat(userPad, O, le32(P >>> 0), idBytes));
    if (rev >= 3) {
      for (let i = 0; i < 50; i++) h = md5(h.subarray(0, keyBytes));
    }
    return h.subarray(0, keyBytes);
  }

  /* Algorithm 5: nilai /U sepanjang 32 byte */
  function userValue(fileKey, idBytes, rev) {
    if (rev <= 2) return rc4(fileKey, PAD);
    let u = rc4(fileKey, md5(concat(PAD, idBytes)));
    for (let i = 1; i <= 19; i++) u = rc4(xorKey(fileKey, i), u);
    return concat(u, PAD.subarray(0, 16));
  }

  /* Algorithm 1: kunci per-objek untuk AESV2 */
  function objectKey(fileKey, objNum, genNum) {
    const keyBytes = fileKey.length;
    const meta = new Uint8Array([0x73, 0x41, 0x6c, 0x54]); /* "sAlT" */
    const base = new Uint8Array(keyBytes + 5 + meta.length);
    base.set(fileKey, 0);
    base[keyBytes] = objNum & 255;
    base[keyBytes + 1] = (objNum >> 8) & 255;
    base[keyBytes + 2] = (objNum >> 16) & 255;
    base[keyBytes + 3] = genNum & 255;
    base[keyBytes + 4] = (genNum >> 8) & 255;
    base.set(meta, keyBytes + 5);
    return md5(base).subarray(0, Math.min(keyBytes + 5, 16));
  }

  /* ============================================================
     AES dekripsi (inverse cipher) — dibutuhkan untuk membuka PDF.
     Mendukung 128-bit (AESV2) dan 256-bit (AESV3).
     ============================================================ */

  const INV_SBOX = (() => {
    const inv = new Uint8Array(256);
    for (let i = 0; i < 256; i++) inv[SBOX[i]] = i;
    return inv;
  })();

  function gmul(a, b) {
    let r = 0;
    for (let i = 0; i < 8; i++) {
      if (b & 1) r ^= a;
      b >>= 1;
      a = ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 255;
    }
    return r & 255;
  }

  /* Key schedule generik: NK=4 (AES-128) atau NK=8 (AES-256). */
  function aesExpandKeyAny(key) {
    const NK = key.length / 4;
    const NR = NK + 6;
    const w = [];
    for (let i = 0; i < NK; i++) w.push(Array.from(key.slice(i * 4, i * 4 + 4)));
    for (let i = NK; i < 4 * (NR + 1); i++) {
      let t = w[i - 1].slice();
      if (i % NK === 0) {
        t = [t[1], t[2], t[3], t[0]].map((b) => SBOX[b]);
        t[0] ^= RCON[i / NK - 1];
      } else if (NK > 6 && i % NK === 4) {
        t = t.map((b) => SBOX[b]);
      }
      const p = w[i - NK];
      w.push([p[0] ^ t[0], p[1] ^ t[1], p[2] ^ t[2], p[3] ^ t[3]]);
    }
    return { w, NR };
  }

  /* Inverse cipher langsung (FIPS-197 §5.3): kunci ronde dibalik,
     InvMixColumns dijalankan di badan ronde (bukan pada kunci). */
  function aesInvKeySchedule(w, NR) {
    return w; /* tidak ada transformasi kunci */
  }

  function aesDecryptBlock(block, w, NR) {
    const s = new Uint8Array(16);
    const addRoundKey = (round) => {
      const base = round * 4;
      for (let i = 0; i < 16; i++) s[i] ^= w[base + (i >> 2)][i & 3];
    };
    const invShiftRows = () => {
      for (let r = 1; r < 4; r++) {
        const row = [s[r], s[r + 4], s[r + 8], s[r + 12]];
        for (let c = 0; c < 4; c++) s[r + 4 * c] = row[(c - r + 4) % 4];
      }
    };
    const invSubBytes = () => {
      for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]];
    };
    const invMixColumns = () => {
      for (let c = 0; c < 4; c++) {
        const i = c * 4;
        const a0 = s[i], a1 = s[i + 1], a2 = s[i + 2], a3 = s[i + 3];
        s[i] = (gmul(a0, 14) ^ gmul(a1, 11) ^ gmul(a2, 13) ^ gmul(a3, 9)) & 255;
        s[i + 1] = (gmul(a0, 9) ^ gmul(a1, 14) ^ gmul(a2, 11) ^ gmul(a3, 13)) & 255;
        s[i + 2] = (gmul(a0, 13) ^ gmul(a1, 9) ^ gmul(a2, 14) ^ gmul(a3, 11)) & 255;
        s[i + 3] = (gmul(a0, 11) ^ gmul(a1, 13) ^ gmul(a2, 9) ^ gmul(a3, 14)) & 255;
      }
    };
    for (let i = 0; i < 16; i++) s[i] = block[i];
    addRoundKey(NR);
    for (let round = NR - 1; round >= 1; round--) {
      invShiftRows();
      invSubBytes();
      addRoundKey(round);
      invMixColumns();
    }
    invShiftRows();
    invSubBytes();
    addRoundKey(0);
    return s;
  }

  /* AES-CBC dekripsi. Data masuk: IV || ciphertext.
     stripPadding = true untuk AESV2 (PKCS#7), false untuk AESV3. */
  function aesDecryptCbc(key, data, stripPadding) {
    if (!data || data.length < 16) return new Uint8Array(0);
    const iv = data.subarray(0, 16);
    const ct = data.subarray(16);
    const { w, NR } = aesExpandKeyAny(key);
    const dw = aesInvKeySchedule(w, NR);
    const blocks = Math.floor(ct.length / 16);
    const out = new Uint8Array(blocks * 16);
    let prev = iv;
    for (let i = 0; i < blocks; i++) {
      const chunk = ct.subarray(i * 16, i * 16 + 16);
      const dec = aesDecryptBlock(chunk, dw, NR);
      for (let j = 0; j < 16; j++) out[i * 16 + j] = dec[j] ^ prev[j];
      prev = chunk;
    }
    let len = blocks * 16;
    if (stripPadding && len > 0) {
      const pad = out[len - 1];
      if (pad >= 1 && pad <= 16 && pad <= len) {
        let ok = true;
        for (let i = len - pad; i < len; i++) if (out[i] !== pad) { ok = false; break; }
        if (ok) len -= pad;
      }
    }
    return out.subarray(0, len);
  }

  /* AES-ECB dekripsi (dipakai untuk nilai /Perms R5/R6). */
  function aesDecryptEcb(key, data) {
    const { w, NR } = aesExpandKeyAny(key);
    const dw = aesInvKeySchedule(w, NR);
    const out = new Uint8Array(data.length - (data.length % 16));
    for (let i = 0; i + 16 <= out.length; i += 16) {
      out.set(aesDecryptBlock(data.subarray(i, i + 16), dw, NR), i);
    }
    return out;
  }

  /* AES-128-CBC tanpa padding (dipakai untuk hash R6). */
  function aesEncryptCbcNoPad(key, iv, data) {
    const w = aesExpandKey(key);
    const out = new Uint8Array(Math.floor(data.length / 16) * 16);
    let prev = iv;
    for (let off = 0; off < out.length; off += 16) {
      const block = new Uint8Array(16);
      for (let i = 0; i < 16; i++) block[i] = data[off + i] ^ prev[i];
      const enc = aesEncryptBlock(block, w);
      out.set(enc, off);
      prev = enc;
    }
    return out;
  }

  /* ============================================================
     SHA-2 (SHA-256 / SHA-384 / SHA-512) — untuk R5 & R6 (AES-256)
     ============================================================ */

  const SHA256_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  const SHA512_K = [
    "428a2f98d728ae22", "7137449123ef65cd", "b5c0fbcfec4d3b2f", "e9b5dba58189dbbc",
    "3956c25bf348b538", "59f111f1b605d019", "923f82a4af194f9b", "ab1c5ed5da6d8118",
    "d807aa98a3030242", "12835b0145706fbe", "243185be4ee4b28c", "550c7dc3d5ffb4e2",
    "72be5d74f27b896f", "80deb1fe3b1696b1", "9bdc06a725c71235", "c19bf174cf692694",
    "e49b69c19ef14ad2", "efbe4786384f25e3", "0fc19dc68b8cd5b5", "240ca1cc77ac9c65",
    "2de92c6f592b0275", "4a7484aa6ea6e483", "5cb0a9dcbd41fbd4", "76f988da831153b5",
    "983e5152ee66dfab", "a831c66d2db43210", "b00327c898fb213f", "bf597fc7beef0ee4",
    "c6e00bf33da88fc2", "d5a79147930aa725", "06ca6351e003826f", "142929670a0e6e70",
    "27b70a8546d22ffc", "2e1b21385c26c926", "4d2c6dfc5ac42aed", "53380d139d95b3df",
    "650a73548baf63de", "766a0abb3c77b2a8", "81c2c92e47edaee6", "92722c851482353b",
    "a2bfe8a14cf10364", "a81a664bbc423001", "c24b8b70d0f89791", "c76c51a30654be30",
    "d192e819d6ef5218", "d69906245565a910", "f40e35855771202a", "106aa07032bbd1b8",
    "19a4c116b8d2d0c8", "1e376c085141ab53", "2748774cdf8eeb99", "34b0bcb5e19b48a8",
    "391c0cb3c5c95a63", "4ed8aa4ae3418acb", "5b9cca4f7763e373", "682e6ff3d6b2b8a3",
    "748f82ee5defb2fc", "78a5636f43172f60", "84c87814a1f0ab72", "8cc702081a6439ec",
    "90befffa23631e28", "a4506cebde82bde9", "bef9a3f7b2c67915", "c67178f2e372532b",
    "ca273eceea26619c", "d186b8c721c0c207", "eada7dd6cde0eb1e", "f57d4f7fee6ed178",
    "06f067aa72176fba", "0a637dc5a2c898a6", "113f9804bef90dae", "1b710b35131c471b",
    "28db77f523047d84", "32caab7b40c72493", "3c9ebe0a15c9bebc", "431d67c49c100d4c",
    "4cc5d4becb3e42b6", "597f299cfc657e2a", "5fcb6fab3ad6faec", "6c44198c4a475817",
  ].map((h) => BigInt("0x" + h));

  function sha256(msg) {
    const l = msg.length;
    const total = Math.ceil((l + 9) / 64) * 64;
    const buf = new Uint8Array(total);
    buf.set(msg);
    buf[l] = 0x80;
    const dv = new DataView(buf.buffer);
    /* Panjang 64-bit big-endian: kata tinggi dulu, baru kata rendah. */
    dv.setUint32(total - 8, Math.floor(l / 536870912), false);
    dv.setUint32(total - 4, (l * 8) >>> 0, false);
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    const w = new Uint32Array(64);
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }
    const out = new Uint8Array(32);
    const odv = new DataView(out.buffer);
    [h0, h1, h2, h3, h4, h5, h6, h7].forEach((v, i) => odv.setUint32(i * 4, v, false));
    return out;
  }
  function rotr(a, n) { return (a >>> n) | (a << (32 - n)); }

  function sha512(bits, msg) {
    const outBytes = bits / 8;
    const l = msg.length;
    const total = Math.ceil((l + 17) / 128) * 128;
    const buf = new Uint8Array(total);
    buf.set(msg);
    buf[l] = 0x80;
    const dv = new DataView(buf.buffer);
    /* Panjang 128-bit big-endian: 64 bit tinggi lalu 64 bit rendah. */
    dv.setBigUint64(total - 16, 0n, false);
    dv.setBigUint64(total - 8, BigInt(l) * 8n, false);
    /* SHA-384 memakai vektor awal yang berbeda dari SHA-512. */
    const h = bits === 384 ? [
      0xcbbb9d5dc1059ed8n, 0x629a292a367cd507n, 0x9159015a3070dd17n, 0x152fecd8f70e5939n,
      0x67332667ffc00b31n, 0x8eb44a8768581511n, 0xdb0c2e0d64f98fa7n, 0x47b5481dbefa4fa4n,
    ] : [
      0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
      0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
    ];
    const w = new Array(80);
    const rotr = (x, n) => (x >> BigInt(n)) | (x << BigInt(64 - n));
    for (let off = 0; off < total; off += 128) {
      for (let i = 0; i < 16; i++) w[i] = dv.getBigUint64(off + i * 8, false);
      for (let i = 16; i < 80; i++) {
        const s0 = rotr(w[i - 15], 1) ^ rotr(w[i - 15], 8) ^ (w[i - 15] >> 7n);
        const s1 = rotr(w[i - 2], 19) ^ rotr(w[i - 2], 61) ^ (w[i - 2] >> 6n);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) & 0xffffffffffffffffn;
      }
      let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (let i = 0; i < 80; i++) {
        const S1 = rotr(e, 14) ^ rotr(e, 18) ^ rotr(e, 41);
        const ch = (e & f) ^ (~e & g);
        const t1 = (hh + S1 + ch + SHA512_K[i] + w[i]) & 0xffffffffffffffffn;
        const S0 = rotr(a, 28) ^ rotr(a, 34) ^ rotr(a, 39);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) & 0xffffffffffffffffn;
        hh = g; g = f; f = e; e = (d + t1) & 0xffffffffffffffffn;
        d = c; c = b; b = a; a = (t1 + t2) & 0xffffffffffffffffn;
      }
      h[0] = (h[0] + a) & 0xffffffffffffffffn; h[1] = (h[1] + b) & 0xffffffffffffffffn;
      h[2] = (h[2] + c) & 0xffffffffffffffffn; h[3] = (h[3] + d) & 0xffffffffffffffffn;
      h[4] = (h[4] + e) & 0xffffffffffffffffn; h[5] = (h[5] + f) & 0xffffffffffffffffn;
      h[6] = (h[6] + g) & 0xffffffffffffffffn; h[7] = (h[7] + hh) & 0xffffffffffffffffn;
    }
    const out = new Uint8Array(outBytes);
    const odv = new DataView(out.buffer);
    for (let i = 0; i < outBytes / 8; i++) odv.setBigUint64(i * 8, h[i], false);
    return out;
  }

  function sha384(msg) { return sha512(384, msg); }
  function sha2(alg, msg) {
    if (alg === 256) return sha256(msg);
    if (alg === 384) return sha384(msg);
    return sha512(512, msg);
  }

  window.PDFToolsCrypto = {
    md5, rc4, aesEncryptCbc, aesEncryptBlock, aesExpandKey,
    padPassword, passwordBytes, concat, le32, hex, PAD, SBOX,
    xorKey, ownerKey, ownerValue, encryptionKey, userValue, objectKey,
    aesExpandKeyAny, aesInvKeySchedule, aesDecryptBlock, aesDecryptCbc, aesDecryptEcb,
    aesEncryptCbcNoPad, INV_SBOX, gmul,
    sha256, sha384, sha512, sha2,
  };
})();
