# Audit Feature — 33 item dari screenshot acuan

Audit ini memetakan **setiap** item pada screenshot referensi ke status
**existing / extended / new**, beserta bukti kode dan bukti pengujian.
Tanggal audit: 2026-11-22. Branch: `arena/cfb38d43-pdf` (basis `main` `864838e`).

## Ringkasan

| Status | Jumlah | Arti |
|---|---|---|
| **existing** | 4 | Capability sudah ada di aplikasi sebelum penambahan; **tidak** dibuat ulang sebagai menu terpisah — launcher memakai tautan ke alur yang sudah ada. |
| **extended** | 1 | Capability hanya terpotong; dilengkapi **di dalam alur existing** (bukan menu baru). |
| **new** | 28 | Capability belum ada sama sekali; diimplementasikan sebagai alat baru di registry. |
| **Total** | **33** | Tepat satu entri launcher per item screenshot. |

Launcher (tab **Semua alat**) menampilkan **33 kartu** dalam **7 kategori**,
persis seperti susunan screenshot.

## Pemetaan per kategori

### ORGANIZE PDF (6)

| Item screenshot | Status | Bukti kode | Bukti uji |
|---|---|---|---|
| Merge PDF | **existing** | Tab `#mergeView` + `app.js` (`#mergeRunBtn`, urutan ▲▼/balik/seret). Launcher: tautan `link:"merge"` (`app.js:2654`). | `regress.mjs` → "merge: hasil 43 halaman", "urutan halaman dipertahankan" |
| Split PDF | **existing** | Mode `each` / `chunk` / `range` / `bookmark` di `app.js` (`run()` + `updateRunState()`). Launcher: tautan `link:"split", mode:"each"`. | `regress.mjs` → "split/each: 40 entri ZIP", "split/chunk", "split/range" |
| Remove pages | **extended** | Mode baru `remove` di `index.html` (radio "Hapus halaman terpilih") + cabang `run()` `app.js` (buang halaman terpilih, sisanya jadi 1 PDF) + `updateRunState()` + `PDFApp.setMode()` untuk deep-link. Launcher: tautan `link:"split", mode:"remove"`. | `regress.mjs` → "split/remove: 40 − 1 = 39 halaman"; `audit.mjs` → "dua halaman terpilih", "halaman tersisa = 1", "klik Hapus halaman menyalakan mode remove" |
| Extract pages | **existing** | Mode `extract` di `app.js` (`run()` → `buildPdf(sel)`). Launcher: tautan `link:"split", mode:"extract"`. | `regress.mjs` → "split/extract: 3 halaman terpilih → 1 PDF" |
| Organize PDF | **new** | `tool-pdf.js:698` `organize` — panel susun halaman (putar, hapus, duplikat, ubah urutan) via `organize.build()` | `tools.mjs` → "rapi PDF menghasilkan berkas" |
| Scan to PDF | **new** | `tool-convert.js:102` `scan` — gambar pindai/kamera → PDF (margin, ukuran halaman, deskew) | `tools2.mjs` → "pindai ke PDF menghasilkan PDF valid" |

### OPTIMIZE PDF (3)

| Item screenshot | Status | Bukti kode | Bukti uji |
|---|---|---|---|
| Compress PDF | **existing** | Tab `#compressView` + `compressor.js` (5 tingkat, estimasi ukuran, anti-membengkak). Launcher: tautan `link:"compress"`. | `regress.mjs` → "compress: ukuran lebih kecil 29241 → 22823", "40 halaman tetap" |
| Repair PDF | **new** | `tool-pdf.js:448` `repair` — bangun ulang struktur, buang data liar, opsi fallback raster & bersihkan metadata | `tools2.mjs` → "repair PDF menghasilkan PDF valid" |
| OCR PDF | **new** | `tool-smart.js:747` `ocr` — lapisan teks di atas halaman hasil render (`TextDetector` bawaan browser) | `tools2.mjs` → "OCR PDF gagal dengan pesan jelas bila mesin OCR tidak ada" (degradasi aman) |

### CONVERT TO PDF (5)

| Item screenshot | Status | Bukti kode | Bukti uji |
|---|---|---|---|
| JPG to PDF | **new** | `tool-convert.js:87` `jpg2pdf` (mode teks/gambar, orientasi, margin, kualitas) | `tools.mjs` → "gambar ke PDF menghasilkan berkas" |
| WORD to PDF | **new** | `tool-convert.js:407` `word2pdf` (`docxBlocks` → `writeFlowDoc`, teks + tabel) | `tools2.mjs` → "WORD ke PDF menghasilkan PDF valid" (round-trip dari `pdf2word`) |
| POWERPOINT to PDF | **new** | `tool-convert.js:432` `ppt2pdf` (satu halaman per slide, judul + poin isi) | `tools2.mjs` → "POWERPOINT ke PDF menghasilkan PDF valid" |
| EXCEL to PDF | **new** | `tool-convert.js:487` `xls2pdf` (tiap sheet → tabel di halamannya sendiri) | `tools2.mjs` → "EXCEL ke PDF menghasilkan PDF valid" |
| HTML to PDF | **new** | `tool-convert.js:171` `html2pdf` (iframe + dialog cetak browser) | `tools2.mjs` → "HTML ke PDF tidak melempar error" |

### CONVERT FROM PDF (5)

| Item screenshot | Status | Bukti kode | Bukti uji |
|---|---|---|---|
| PDF to JPG | **new** | `tool-convert.js:125` `pdf2jpg` (DPI 72/150/300, JPG/PNG, ZIP bila banyak halaman) | `tools.mjs` → "PDF ke JPG menghasilkan berkas" (ZIP) |
| PDF to WORD | **new** | `tool-convert.js:629` `pdf2word` (`.docx` via JSZip, page break per halaman) | `tools.mjs` + `tools2.mjs` (round-trip) |
| PDF to POWERPOINT | **new** | `tool-convert.js:695` `pdf2ppt` (`.pptx`, satu slide per halaman) | `tools.mjs` + `tools2.mjs` (round-trip) |
| PDF to EXCEL | **new** | `tool-convert.js:665` `pdf2xls` (`.xlsx`, satu baris teks per baris) | `tools.mjs` + `tools2.mjs` (round-trip) |
| PDF to PDF/A | **new** | `tool-pdf.js:642` `pdfa` (metadata PDF/A + output intent sRGB tertanam, ICC dibuat di browser) | `tools.mjs` → "PDF ke PDF/A menghasilkan berkas" |

### EDIT PDF (6)

| Item screenshot | Status | Bukti kode | Bukti uji |
|---|---|---|---|
| Rotate PDF | **new** | `tool-pdf.js:19` `rotate` (90/180/270°, cw/ccw, semua/ganjil/genap) | `tools.mjs` → "putar PDF menghasilkan berkas" |
| Add page numbers | **new** | `tool-pdf.js:69` `numbers` (posisi, format, mulai, lewati halaman pertama) | `tools.mjs` → "nomor halaman menghasilkan berkas" |
| Add watermark | **new** | `tool-pdf.js:122` `watermark` (teks/gambar, diagonal/horisontal/tengah/tiling, opasitas) | `tools.mjs` → "watermark teks menghasilkan berkas" |
| Crop PDF | **new** | `tool-pdf.js:199` `crop` (potong margin, A4, Letter, persegi, potong tepi kosong) | `tools.mjs` → "potong PDF menghasilkan berkas" |
| Edit PDF | **new** | `tool-pdf.js:303` `edit` (sisip teks & kotak, hapus anotasi) | `tools.mjs` → "edit PDF menghasilkan berkas" |
| PDF Forms | **new** | `tool-pdf.js:367` `forms` (isi formulir, opsi "Kunci isian" = flatten) | `tools.mjs` → "formulir PDF menghasilkan berkas" |

### PDF SECURITY (5)

| Item screenshot | Status | Bukti kode | Bukti uji |
|---|---|---|---|
| Unlock PDF | **new** | `tool-smart.js:55` `unlock` (buka dengan password via pdf.js → simpan salinan tanpa enkripsi) | `tools2.mjs` → "buka PDF terkunci menghasilkan PDF", "password salah ditolak" |
| Protect PDF | **new** | `tool-smart.js:251` `protect` + `tool-crypto.js` (MD5/RC4/AES-128-CBC + Standard Security Handler ISO 32000-1 §7.6.3: Algorithm 1/2/3/5) | `protect-test.mjs` (17 pemeriksaan, reader independen pypdf) + `crypto-test.mjs` (12 vektor, nilai `/O`/kunci/`/U` identik dengan pypdf 7.1.1) |
| Sign PDF | **new** | `tool-smart.js:319` `sign` (tanda tangan tulisan tangan, posisi & ukuran, multi halaman) | `tools2.mjs` → "tanda tangan menghasilkan PDF valid", "tanpa gambar ditolak" |
| Redact PDF | **new** | `tool-smart.js:413` `redact` (cari teks → render ulang halaman → teks benar-benar hilang) | `tools.mjs` → "redaksi menghasilkan berkas"; panel menampilkan jumlah hit |
| Compare PDF | **new** | `tool-smart.js:502` `compare` (laporan HTML: berubah / sama / baru) | `tools.mjs` → "bandingkan PDF menghasilkan laporan" |

### PDF INTELLIGENCE (3)

| Item screenshot | Status | Bukti kode | Bukti uji |
|---|---|---|---|
| AI Summarizer | **new** | `tool-smart.js:628` `summarize` (ringkasan ekstraktif, skoring kalimat, dihitung di perangkat) | `tools.mjs` → "ringkasan menghasilkan berkas" |
| Translate PDF | **new** | `tool-smart.js:699` `translate` (mesin terjemahan bawaan browser `Translator`) | `tools2.mjs` → "gagal dengan pesan jelas bila mesin terjemahan tidak ada" |
| PDF to Markdown | **new** | `tool-smart.js:560` `markdown` (judul, paragraf, tabel, blok kode) | `tools.mjs` → "PDF ke Markdown menghasilkan berkas" |

## Hasil pemeriksaan anti-duplikasi

`.devtest/audit.mjs` — **54 pemeriksaan, 0 gagal**:

| Pemeriksaan | Hasil |
|---|---|
| Launcher menampilkan 33 entri | ✅ 33 |
| Tiap item screenshot terpetakan ke tepat 1 entri launcher (33×) | ✅ semua ketemu 1× |
| Tidak ada nama alat duplikat di launcher | ✅ |
| Tidak ada `id` alat duplikat di registry | ✅ |
| Tidak ada nama alat duplikat di registry | ✅ |
| Tidak ada nama yang dipakai tool **dan** tautan sekaligus | ✅ |
| Tepat 7 kategori sesuai screenshot | ✅ |
| 5 tautan launcher → tab & mode yang benar | ✅ |
| Mode "Hapus halaman" bekerja (2 dari 3 halaman dibuang → 1 halaman tersisa) | ✅ |
| Klik launcher "Hapus halaman" → tab Halaman PDF + mode `remove` | ✅ |

Registry berisi **28 alat** (semua `id` & `nama` unik); 5 item lain memakai
**tautan ke alur existing**, sehingga tidak ada menu yang menduplikasi
kemampuan yang sama.

## Hasil pengujian

Semua harness: `.devtest/all.sh`

| Suite | Pemeriksaan | Gagal |
|---|---|---|
| `smoke.mjs` — halaman muat, console bersih | 2 | 0 |
| `crypto-test.mjs` — vektor MD5/RC4/AES + Standard Security Handler | 12 | 0 |
| `tools.mjs` — 19 alat lintas kategori + PDF rusak + anti-duplikasi | 22 | 0 |
| `tools2.mjs` — 10 alat sisanya (repair, scan, unlock, sign, translate, OCR, HTML/Word/PPT/Excel → PDF) | 17 | 0 |
| `protect-test.mjs` — validasi Protect dengan reader independen (pypdf 7.1.1 + cryptography) | 17 | 0 |
| `audit.mjs` — audit 33 item + anti-duplikasi + mode hapus halaman | 54 | 0 |
| `regress.mjs` — regresi Split/Merge/Extract/Compress yang sudah bekerja | 15 | 0 |
| **Total** | **139** | **0** |

### Detail validasi "Protect PDF" (reader independen)

Nilai yang dibandingkan terhadap pypdf 7.1.1 (`AlgV4`):

| Yang diperiksa | Hasil |
|---|---|
| `/Encrypt /Filter` | `/Standard` ✅ |
| `/Encrypt /V`, `/R`, `/Length` | `4`, `4`, `128` ✅ |
| `/O` (32 byte) | ✅ |
| `/U` (32 byte) ✅ | ✅ |
| `/CF` → `/StdCF` → `/CFM` | `/AESV2` ✅ |
| `/StmF`, `/StrF` | `/StdCF`, `/StdCF` ✅ |
| `/ID` di trailer | 16 byte ✅ |
| Bit izin (`/P`) | sesuai pilihan (cetak ya, ubah tidak, salin tidak, anotasi ya) ✅ |
| Tanpa password | ditolak ✅ |
| Password salah | ditolak ✅ |
| Password pengguna | diterima ✅ |
| Password pemilik | diterima ✅ |
| Jumlah halaman | 40 → 40 ✅ |
| Teks hasil dekripsi | identik dengan berkas asli ✅ |

Vektor kripto (crypto-test.mjs) — semua cocok persis:
`/O = 68e5704a…52534d`, `kunci berkas = 65e91bc7…f783d`,
`/U = 661359d2…fa0108`, AES-128 blok FIPS-197 `69c4e0d8…4b55a`,
AES-128-CBC dicocokkan silang dengan WebCrypto.

## Catatan perilaku

- **OCR** dan **Terjemah** memakai mesin bawaan browser (`TextDetector`,
  `Translator`). Bila peramban tidak memilikinya, aplikasi menampilkan
  penjelasan jelas — tidak ada unduhan model dari internet (aplikasi tetap
  sepenuhnya offline).
- **HTML to PDF** memakai dialog cetak browser; hasilnya disimpan manual dari
  dialog tersebut.
- **Protect PDF** ditulis dengan `useObjectStreams:false` agar tabel xref
  klasik tetap terbaca reader lama, dan `/ID` ditulis sebagai array langsung
  di trailer (bukan objek tak langsung) supaya tidak ada objek yatim.
