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

  function padPassword(pw) {
    const bytes = new TextEncoder().encode(String(pw || ""));
    const out = new Uint8Array(32);
    const n = Math.min(bytes.length, 32);
    out.set(bytes.subarray(0, n), 0);
    out.set(PAD.subarray(0, 32 - n), n);
    return out;
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

  window.PDFToolsCrypto = {
    md5, rc4, aesEncryptCbc, aesEncryptBlock, aesExpandKey,
    padPassword, concat, le32, hex, PAD, SBOX,
    xorKey, ownerKey, ownerValue, encryptionKey, userValue, objectKey,
  };
})();
