# Audit Semua Fitur — 2026-11-25

Audit payung yang **menjalankan seluruh fitur aplikasi** lewat UI sungguhan,
bukan hanya memeriksa kode atau satu alur. Setiap fitur dijalankan, keluarannya
diunduh, lalu **diperiksa isinya** — bukan sekadar "berkas berhasil dibuat".

- Branch: `arena/5cc1e8a3-pdf` (basis `main` `9048247`)
- Harness utama: `tools/audit-semua.mjs` → **129 pemeriksaan lulus, 0 gagal**
- Harness editor visual: `tools/audit-editor.mjs` → **29 pemeriksaan lulus, 0 gagal**
- Bukti: `docs/audit-semua-2026-11-25/` (44 tangkapan layar + folder `keluaran/`)
- Evidence JSON: `docs/audit-semua-hasil.json`, `docs/audit-editor-hasil.json`

---

## 1. Cakupan

Semua yang menghadap pengguna dipetakan dari sumber, bukan dari daftar manual:

| Sumber | Jumlah | Cara pemetaan |
|---|---|---|
| `PDFToolsCore.registry` | **28 alat** | dibaca langsung dari peramban saat runtime |
| Launcher tab utama | **5 alur** | `merge`, `split`, `remove-pages`, `extract-pages`, `compress-link` |
| Editor visual (`tool-editor.js`) | **9 kemampuan** | ditelusuri dari API `window.PDFToolsEditor` + DOM toolbar |
| **Total** | **42 permukaan** | 33 entri alat + 9 kemampuan editor |

Modul pendukung (`tool-crypto.js`, `tool-decrypt.js`, `tool-xps.js`,
`compressor.js`) tidak dihitung sebagai fitur — isinya pustaka primitif
(AES/RC4/SHA, pembaca xref, pembangun XPS) yang dipakai alat di atas.

### Matriks 33 entri alat

| # | ID | Fitur | Validasi keluaran yang dijalankan | Hasil |
|---|---|---|---|---|
| 1 | `rotate` | Putar PDF | `/Rotate` tiap halaman + jumlah halaman | ✅ |
| 2 | `numbers` | Nomor halaman | nomor terbaca + posisinya di bagian bawah tiap halaman | ✅ |
| 3 | `watermark` | Watermark | teks stempel di tiap halaman + **bukti piksel** stempel tergambar | ✅ |
| 4 | `crop` | Potong PDF | CropBox menyusut 20 mm/sisi, MediaBox tetap, semua halaman | ✅ |
| 5 | `edit` | Edit PDF | PDF valid, jumlah halaman tetap | ✅ |
| 6 | `forms` | Isi Formulir | AcroForm ada, nilai field tersimpan | ✅ |
| 7 | `repair` | Rapi PDF | 3 halaman tetap, ukuran halaman wajar | ✅ |
| 8 | `pdfa` | PDF/A | OutputIntent + `pdfaid:part` di XMP, tidak terenkripsi | ✅ |
| 9 | `organize` | Susun PDF | pratinjau 3 kartu, halaman dihapus hilang dari hasil | ✅ |
| 10 | `jpg2pdf` | Gambar ke PDF | A4, **gambar tertanam** (XObject Image) | ✅ |
| 11 | `scan` | Pindai | PDF valid, gambar tertanam | ✅ |
| 12 | `pdf2jpg` | PDF ke Gambar | satu ZIP valid (3 halaman → 3 gambar) | ✅ |
| 13 | `word2pdf` | Word ke PDF | **isi dokumen terbawa** (lihat temuan 1) | ✅ |
| 14 | `ppt2pdf` | PowerPoint ke PDF | teks slide terbawa | ✅ |
| 15 | `xls2pdf` | Excel ke PDF | isi tabel terbawa (`Judul`, `Nilai`, `42`) | ✅ |
| 16 | `pdf2word` | PDF ke Word | ZIP valid + `word/document.xml` berisi teks PDF | ✅ |
| 17 | `pdf2xls` | PDF ke Excel | ZIP valid + isi lembar kerja berisi teks PDF | ✅ |
| 18 | `pdf2ppt` | PDF ke PowerPoint | ZIP valid + isi slide berisi teks PDF | ✅ |
| 19 | `html2pdf` | HTML ke PDF | pratinjau dirender, tanpa galat fatal (dialog cetak = desain) | ✅ |
| 20 | `protect` | Lindungi PDF | PDF benar-benar terenkripsi (`/Encrypt` ada) | ✅ |
| 21 | `unlock` | Buka PDF Terkunci | berhasil dibuka, isi utuh | ✅ |
| 22 | `sign` | Tanda Tangan | tinta menambah piksel di halaman hasil | ✅ |
| 23 | `redact` | Redaksi | target hilang permanen, halaman lain tetap dicari, **kotak hitam pekat** | ✅ |
| 24 | `compare` | Bandingkan PDF | laporan memuat isi kedua PDF + penanda bagian berbeda | ✅ |
| 25 | `markdown` | PDF ke Markdown | berkas `.md` + isi teks terbawa | ✅ |
| 26 | `summarize` | Ringkas PDF | ringkasan tidak kosong | ✅ |
| 27 | `translate` | Terjemah PDF | berkas `.md`, isi terjemahan + judul | ✅ |
| 28 | `ocr` | OCR PDF | PDF hasil valid, 3 halaman | ✅ |
| 29 | `merge` | Gabung PDF | 3 + 1 = 4 halaman | ✅ |
| 30 | `split` | Pisah PDF | ZIP berisi 3 PDF, tiap PDF 1 halaman | ✅ |
| 31 | `remove-pages` | Hapus Halaman | 1 halaman dihapus → 2 tersisa | ✅ |
| 32 | `extract-pages` | Ekstrak Halaman | hanya 1 halaman | ✅ |
| 33 | `compress-link` | Kompres PDF | PDF hasil tetap terbaca | ✅ |

### Matriks 9 kemampuan editor visual

| Kemampuan | Validasi | Hasil |
|---|---|---|
| Muat dokumen | 3 halaman, 3 blok teks, kanvas 744×1053 px | ✅ |
| Navigasi halaman | `Halaman 2/1` naik-turun benar | ✅ |
| Zoom | skala 1,25 → 1,50 → 1,25 | ✅ |
| Sisip teks | klik mode Teks → blok baru + panel inspeksi | ✅ |
| Ubah teks | isi, ukuran (24 pt), warna (#ff0000) tersimpan | ✅ |
| Undo / redo | undo mengurangi riwayat, redo mengembalikannya | ✅ |
| Sisip gambar | op gambar masuk ke halaman | ✅ |
| Ubah semua teks | 4 blok sumber, ukuran 30 pt + warna #0066cc | ✅ |
| Ekspor | `.docx`, `.xlsx`, `.pptx`, `.xps` + proyek `.edit.json` | ✅ |
| Hasil akhir | teks baru ikut terbawa ke PDF 3 halaman | ✅ |

---

## 2. Temuan dan perbaikan

### Temuan 1 — Word ke PDF menghasilkan dokumen KOSONG (bug nyata)

**Gejala:** berkas `.docx` apa pun dikonversi menjadi PDF **tanpa isi** —
halaman A4 kosong, nol baris teks.

**akar:** `tool-convert.js` membaca nama elemen XML lewat `node.nodeName`:

```js
const tag = (node.nodeName || "").toLowerCase();
if (tag === "p") { … }
```

Dokumen Word memakai namespace, jadi nama elemennya berawalan prefix:
`w:p`, `w:tbl`. Dengan `nodeName`, perbandingan `tag === "p"` **tidak pernah**
benar — tidak satu pun paragraf dikenali, sehingga `blocks` kosong dan PDF
hasilnya hampa. (Unicorn: `nodeName` juga tidak pernah bernilai `"p"` untuk
dokumen ber-namespace; hanya `localName` yang bersih.)

**Perbaikan:** pakai `localName` (dengan `nodeName` sebagai cadangan), dan
tadditional membaca content control `w:sdt` → `w:sdtContent` yang dipakai
banyak dokumen Word asli:

```js
const tag = (node.localName || node.nodeName || "").toLowerCase();
```

**Bukti:** `docs/audit-semua-2026-11-25/keluaran/word2pdf__docu.pdf`
— teks hasil: `"Judul Dokumen Uji  Paragraf isi dokumen word untuk uji konversi."`
(sebelum perbaikan: `"\n"` — kosong).

### Temuan 2 — Dokumen Word dengan content control ikut kosong

`**w:sdt**` (content control) adalah pembungkus standar di dokumen Word modern.
Isinya berada di `w:sdtContent`, bukan langsung di `w:body`, sehingga
paragraf/tabel di dalamnya dilewati. Kode sekarang membuka `w:sdtContent`
sebelum memproses anak-anaknya.

### Temuan 3 — Toolbar editor jadi 4 baris di layar 360 px

**Gejala:** `tools/verify-produksi.mjs` gagal pada
*"Toolbar editor ≤ 3 baris di 360px baris=4"*.

**akar:** `.ed-bar` memakai `align-items:center`, sehingga tiap grup
bertinggi berbeda memulai pada koordinat *top* berbeda (mis. 438 vs 446).
Baris yang terukur jadi terpecah, dan toolbar tampak tidak rapi.

**Perbaikan:** `align-items:stretch` pada `.ed-bar` (dan
`align-items:center` pada `.ed-menu-wrap`) → semua grup satu baris punya
*top* yang sama. Hasil: **3 baris**, `verify-produksi` → **74 lulus / 0 gagal**
(sebelumnya 73/1).

### Temuan 4 — Pemeriksaan statis baru (kelas bug "keyword tanpa spasi")

Seluruh berkas sumber aplikasi kini di-parse (`node --check`) di dalam
harness. Ini menangkap kelas bug yang tidak terlihat dari pembacaan kode
mata: `functionteksDariPdf` (tanpa spasi) dibaca oleh mesin JavaScript
sebagai **satu identifier** `functionteksDariPdf`, bukan `function` +
`teksDariPdf` — hasilnya galat `Unexpected identifier`. Bug serupa pernah
menyerang berkas harness audit ini sendiri sebelum tertangkap.

Berkas yang diperiksa: `app.js`, `compressor.js`, `tool-core.js`,
`tool-convert.js`, `tool-crypto.js`, `tool-decrypt.js`, `tool-editor.js`,
`tool-pdf.js`, `tool-preview.js`, `tool-smart.js`, `tool-translate.js`,
`tool-ui.js`, `tool-xps.js`.

---

## 3. Jalur galat (11 skenario)

Semua ditolak dengan **pesan ramah**, tanpa galat JavaScript tak tertangani:

| Skenario | Perilaku |
|---|---|
| PDF diberikan ke alat gambar | ditolak, pesan jelas |
| Kata kunci tidak ada saat redaksi | ditolak, nama kata ditampilkan |
| Lindungi tanpa password | ditolak |
| Buka kunci dengan password salah | ditolak |
| Rentang halaman di luar jangkauan | ditolak |
| Bandingkan dengan satu berkas | ditolak |
| Tanda tangan tanpa tinta | ditolak |
| Berkas 0 byte | ditolak |
| PDF terkunci dibuka dengan alat biasa | ditolak, arahkan ke alat buka kunci |
| Berkas PDF rusak total | ditolak dengan pesan "tidak ada halaman yang bisa dipulihkan" |

Jalur **banyak berkas** (2 PDF sekaligus) diuji pada `rotate` (2 PDF, masing-masing
berputar 90°) dan `protect` (2 PDF, keduanya terenkripsi).

---

## 4. Pemeriksaan responsif & statis

| Pemeriksaan | Hasil |
|---|---|
| Daftar alat lengkap di 360 px | 33 kartu ✅ |
| Tidak ada gulir horizontal di 360 px | selisih 0 px ✅ |
| Kotak pencarian alat ada | ✅ |
| Semua berkas sumber bisa di-parse | ✅ |
| Toolbar editor ≤ 3 baris di 360 px | 3 baris ✅ (temuan 3) |

---

## 5. Bukti visual

`docs/audit-semua-2026-11-25/` berisi 44 tangkapan layar
(`<fitur>-panel.png` = tampilan alat, `<fitur>-hasil.png` = setelah proses)
dan `keluaran/` berisi **setiap berkas keluaran** yang diuji, sehingga
hasilnya bisa diperiksa ulang tanpa menjalankan harness.

Pemeriksaan piksel (bukti terukur, bukan sekadar "berkas jadi"):

| Fitur | Ukuran | Arti |
|---|---|---|
| Watermark | 2 010 piksel gelap | stempel benar-benar tergambar, bukan cuma objek teks |
| Redaksi | hal.1 = 1 367 vs hal.2 = 3 055 piksel pekat | hanya halaman yang direduksi punya kotak hitam penutup |
| Tanda tangan | tinta 2 077 vs 2 010 | coretan tanda tangan menambah tinta di halaman |

---

## 6. Regresi seluruh harness

| Harness | Hasil | Catatan |
|---|---|---|
| `tools/audit-semua.mjs` | **129 / 0** | harness payung baru |
| `tools/audit-editor.mjs` | **29 / 0** | harness editor visual baru |
| `tools/audit-sign.mjs` | 65 / 0 | tanda tangan & balapan render |
| `tools/audit-sign-touch.mjs` | 27 / 0 | target sentuh, geser & ubah-lebar |
| `tools/audit-pagerange.mjs` | 106 / 0 | slider rentang halaman |
| `tools/audit-merge-preview.mjs` | 44 / 0 | pratinjau urutan gabung |
| `tools/audit-deskew.mjs` | 56 / 0 | luruskan halaman miring |
| `tools/audit-ocr.mjs` | 44 / 0 | mesin OCR offline |
| `tools/audit-preview-perf.mjs` | 39 / 0 | performa pratinjau |
| `tools/verify-produksi.mjs` | **74 / 0** | sebelumnya 73 / 1 — diperbaiki (temuan 3) |
| `tools/audit-translate.mjs` | 30 / 1 | **batasan lingkungan**, bukan bug aplikasi |

> `audit-translate`: pemeriksaan *"Mesin bawaan peramban terdeteksi (Chrome 138+)"*
> gagal karena Translator API bawaan Chromium tidak tersedia di lingkungan
> headless ini. Aplikasi lalu **berhasil memakai mesin offline bawaan**
> ("Mesin offline menerjemahkan Indonesia → Inggris" ✅), jadi tidak ada
> cacat fungsional.

---

## 7. Cara menjalankan ulang

```bash
node tools/setup-harness.mjs        # pasang dependensi + regenerasi semua fixture
node tools/mkfixtures-semua.mjs     # fixture khusus audit ini
node tools/audit-semua.mjs          # 129 pemeriksaan
node tools/audit-editor.mjs         # 29 pemeriksaan
```

Environment: `ONLY=<id>` menyaring satu fitur, `PORT` mengatur porta,
`FIXTURES_DIR` / `SHOT_DIR` mengatur lokasi fixture dan bukti.
