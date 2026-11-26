# Audit Feature — 33 item dari screenshot acuan

Audit ini memetakan **setiap** item pada screenshot referensi ke status
**existing / extended / new**, beserta bukti kode dan bukti pengujian.
Tanggal audit: 2026-11-22 (audit feature) dan 2026-11-23 (audit pascamerge
komprehensif). Branch: `arena/44607f6f-pdf` (basis `main` `0888b1e`).

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
| Rapi PDF (Repair) | **new** → **meningkat** | `tool-pdf.js` `repair` — bangun ulang struktur, **luruskan halaman hasil pindai yang miring** (deteksi dari piksel tinta, koreksi lewat matriks content stream — vektor/teks/gambar **tidak ditulis ulang**), putar 90° otomatis, pangkas margin (kotak "lembut" supaya foto/stempel pudar tidak terpotong), anotasi/field ikut diputar, pembalikan 180° hanya bila dua bukti independen sepakat | `tools/audit-deskew.mjs` → **56 lulus, 0 gagal** · `tools/audit-rapi.mjs` → **58 lulus, 0 gagal** (sudut sisa 0,00° diukur estimator mandiri, isi 0,5 pt dari asal, cakupan piksel pratinjau↔PDF final 100 %) — rinci di `docs/audit-rapi-2026-11-25.md` |
| OCR PDF | **new** | `tool-smart.js` `ocr` — mesin Tesseract **offline** (`vendor/tesseract`), dokumen asli disalamat di tempat, tiga mode hasil (tak terlihat / dokumen bersih / teks terlihat di atas gambar), halaman berteks dilewati, mesin OCR paralel, progres nyata | `tools/audit-ocr.mjs` → **44 pemeriksaan lulus, 0 gagal** (duplikasi, koordinat rotasi/crop, lebar kata, anotasi, bookmark & field formulir, 24 halaman 18,6 detik) — rinci di `docs/audit-ocr-2026-11-23.md` |

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
| Unlock PDF | **new** | `tool-smart.js` `unlock` + `tool-decrypt.js` (dekriptor mandiri: Standard Security Handler R2–R6, RC4/AES, object stream + xref stream → tulis ulang tanpa `/Encrypt`) | `exp-decrypt.mjs` (16/16) + `deep-unlock.mjs` (21/21) + `validate_outputs.py` (14/14 pypdf/pikepdf) |
| Protect PDF | **new** | `tool-smart.js:251` `protect` + `tool-crypto.js` (MD5/RC4/AES-128-CBC + Standard Security Handler ISO 32000-1 §7.6.3: Algorithm 1/2/3/5) | `protect-test.mjs` (17 pemeriksaan, reader independen pypdf) + `crypto-test.mjs` (12 vektor, nilai `/O`/kunci/`/U` identik dengan pypdf 7.1.1) |
| Sign PDF | **new** | `tool-smart.js:319` `sign` (tanda tangan tulisan tangan, posisi & ukuran, multi halaman, **sadar-rotasi `/Rotate` + jepit posisi**) | `tools2.mjs` → "tanda tangan menghasilkan PDF valid", "tanpa gambar ditolak"; `tools/audit-sign.mjs` → 65/0 |
| Redact PDF | **new** | `tool-smart.js:413` `redact` (cari teks → render ulang halaman → teks benar-benar hilang) | `tools.mjs` → "redaksi menghasilkan berkas"; panel menampilkan jumlah hit |
| Compare PDF | **new** | `tool-smart.js:502` `compare` (laporan HTML: berubah / sama / baru) | `tools.mjs` → "bandingkan PDF menghasilkan laporan" |

### PDF INTELLIGENCE (3)

| Item screenshot | Status | Bukti kode | Bukti uji |
|---|---|---|---|
| AI Summarizer | **new** | `tool-smart.js:628` `summarize` (ringkasan ekstraktif, skoring kalimat, dihitung di perangkat) | `tools.mjs` → "ringkasan menghasilkan berkas" |
| Translate PDF | **new** → **meningkat** | `tool-smart.js` `translate` + modul baru `tool-translate.js`: **dua mesin** — mesin bawaan browser (`Translator`, dipakai kalau model bahasa sudah ada di perangkat) **dan** mesin Neural Machine Translation Bergamot WASM **offline** (`vendor/bergamot/`, model Indonesia ⇄ Inggris disertakan). Teks dipecah per baris, satu mesin dipakai untuk semua berkas, kalimat berulang memakai cache LRU | `tools/audit-translate.mjs` → **31 pemeriksaan lulus, 0 gagal** (terjemahan benar dua arah, model dimuat sekali, cache kalimat, `availability()`/`monitor`, galat DOM diterjemahkan jadi pesan tepat, alat lewat UI) — rinci di `docs/audit-terjemah-2026-11-24.md` |
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

## Audit pascamerge komprehensif (2026-11-23)

Audit sebelumnya memakai pdf.js untuk membuka PDF terenkripsi lalu
menyimpan ulang hasilnya. Terbukti hasilnya **masih terenkripsi** —
`pdf.js.saveDocument()` hanya menulis ulang berkas apa adanya, `/Encrypt`
tetap ada. Unlock kini memakai dekriptor sendiri (`tool-decrypt.js`).

### Hasil suite

| Suite | Pemeriksaan | Gagal | Cakupan |
|---|---|---|---|
| `audit-all.mjs` | 56 | 0 | struktur launcher/registry + 28 alat dijalankan nyata + 5 alur existing + console bersih |
| `validate_audit_outputs.py` | 37 | 0 | validasi **independen** keluaran audit (pypdf + pikepdf/libqpdf, ZIP/OOXML, JPEG, HTML, Markdown) |
| `deep-security.mjs` | 41 | 0 | Protect/Sign/Redact/Compare/Unlock, guard berkas rusak, password non-ASCII |
| `deep-unlock.mjs` | 21 | 0 | Unlock di browser: AES/RC4/object stream/40 halaman/password salah |
| `exp-decrypt.mjs` | 16 | 0 | dekripsi multi-variant (R2–R6), user & owner password |
| `validate_outputs.py` | 14 | 0 | hasil dekripsi dibuka reader independen (pypdf + pikepdf) |
| `smoke.mjs` | 4 | 0 | halaman muat, tab, registry, console |
| **Total** | **189** | **0** | |

### Yang dibuktikan audit ini

- **Unlock benar-benar menghapus enkripsi.** Keluaran tidak memuat
  `/Encrypt`, dapat dibuka pypdf maupun pikepdf tanpa password, dan
  jumlah halaman serta teks sumber tetap utuh (tidak dirasterisasi).
- **Struktur launcher konsisten.** 33 item (28 alat registry + 5 tautan alur
  existing) dalam 7 kategori; `id` dan nama unik; tidak ada alat yang
  menduplikasi kemampuan alur existing.
- **Setiap alat menghasilkan keluaran nyata**, bukan sekadar "tidak error":
  ukuran, jumlah halaman, isi ZIP/OOXML, dan validity PDF diperiksa ulang
  dengan pustaka di luar aplikasi.
- **Alur existing tidak degraded.** Gabung (3 + 40 = 43 halaman), Pisah
  (tiap berkas 1 halaman), Hapus halaman (3 → 2), Ekstrak (hanya terpilih),
  Kompres (tidak lebih besar, halaman tetap).
- **Kemampuan browser yang tidak ada ditangani sebagai degradasi aman.**
  `translate` dan `ocr` menolak dengan pesan jelas bila mesin bawaan
  peramban tidak tersedia — bukan diam-diam gagal.
- **Berkas rusak total ditolak dengan pesan ramah.** Tool "Rapi PDF"
  kini melaporkan "rusak total: tidak ada halaman yang bisa dipulihkan"
  alih-alih melempar error teknis; PDF dengan `startxref` rusak (tetap
  berisi halaman) berhasil dipulihkan.

### Perbaikan yang lahir dari audit ini

| Temuan | Perbaikan |
|---|---|
| Unlock memakai pdf.js → berkas tetap terenkripsi | dekriptor mandiri `tool-decrypt.js` (R2–R6) |
| Password non-ASCII ditolak | mode password `latin1`/`utf8` di `tool-crypto.js` & `tool-decrypt.js` |
| "Buka kunci" pada PDF terenkripsi lewat prompt membingungkan | pesan "Buka dulu dengan tool ..." pada Protect/Compare |
| Compare tidak melaporkan perbedaan jumlah halaman | laporan menampilkan "3 vs 4 halaman" |
| PNG rusak membuat pdf-lib berputar tanpa henti | preflight `assertValidPng()` sebelum embed |
| Tekssis acak (Cyrillic/CJK) bocor ke UI | dibersihkan (`tool-pdf.js` + `tool-smart.js`) |
| Berkas rusak total menimbulkan error teknis | pesan "rusak total: tidak ada halaman yang bisa dipulihkan" |

## Audit mode gelap & cache (2026-11-22)

Laporan bug: di mode gelap, panel editor ("Ubah semua teks") menampilkan
input/select **putih** dengan teks nyaris tak terlihat, tombol "Proses"
berteks putih di atas biru terang. encompassed: submenu, badge, tooltip,
disabled, metadata terkompresi, popover, iframe, dan cache deployment.

### Kronologi — bug-nya nyata, tapi bukan CSS server

| Waktu (UTC) | WIB | Kejadian |
|---|---|---|
| 2026-11-23 10:49 | 17:49 | Commit `d3807f1` (perbaikan CSS) — **masih di branch feature** |
| 2026-11-23 11:04 | 18:04 | **Screenshot bug diambil** → Pages masih menyajikan CSS lama |
| sesudahnya | — | PR #11 merge → deploy → CSS baru tayang |

`gh api repos/Putra1996/PDF/pages` mengonfirmasi sumber deploy adalah
`main` dengan `status: built`, dan `style.css` yang ter-deploy memuat
seluruh perbaikan. Jadi **bukan** CSS server yang rusak, melainkan
perbaikannya belum sempat ter-deploy saat screenshot diambil.

### Akar masalah cache

- Tidak ada service worker di repo (`serviceWorker`/`caches`/`workbox` nihil).
- GitHub Pages memaksa `Cache-Control: max-age=600` (10 menit) untuk
  semua aset dan tidak bisa diubah dari repo.
- `index.html` memuat `style.css` **tanpa** `?v=` → peramban yang menahan
  URL itu di cache akan terus memakai versi lama.

### Perbaikan yang dibuat

| Temuan | Perbaikan |
|---|---|
| CSS basi di cache tidak pernah tergantikan | aset kini ber-`?v=<build>`; `style.css` mendeklarasikan `--css-build` |
| Tidak ada deteksi stylesheet basi | penjaga cache di `index.html`: jika `--css-build` tidak cocok, stylesheet dimuat ulang dengan URL baru + toast |
| Toast sukses/gagal di mode gelap berupa blok warna terang | memakai permukaan gelap + teks berwarna (`--green-soft`/`--danger-soft`) |
| Audit lama hanya mengukur kontras teks | audit baru mengukur **blok terang**, kontras terhadap **latar efektif**, dan `color-scheme` tiap kontrol native |
| State "Ubah semua teks" (tanpa blok terpilih) belum pernah diuji | kini menjadi state wajib dalam audit |

### Hasil suite

| Suite | Pemeriksaan | Gagal | Cakupan |
|---|---|---|---|
| `audit-deep2.mjs` | 169 | 0 | semua state dinamis: split/merge/compress/28 alat/editor (5 state)/overlay/toast, desktop + ponsel |
| `audit-cache.mjs` | 9 | 0 | pemulihan mandiri dari `style.css` basi (disimulasikan end-to-end) |
| `test-fungsi.mjs` | 18 | 0 | split, merge, compress, 4 alat, editor + "Ubah semua teks" |
| **Total** | **196** | **0** | |

### Cara kerja penjaga cache

```
index.html  →  window.PDF_BUILD = "20261123b"
style.css   →  :root { --css-build: 20261123b; }
```

1. Halaman meminta `style.css?v=20261123b` → URL baru, pasti diambil dari server.
2. Setelah `load`, penjaga membandingkan `--css-build` pada stylesheet aktif
   dengan `PDF_BUILD`. Kalau beda (artinya cache lama), `href` diganti
   `style.css?v=<build>.<timestamp>` → versi terbaru aktif tanpa hard refresh.
3. `app.js` memberi tahu pengguna lewat toast.

> **Wajib saat deploy:** naikkan `PDF_BUILD` di `index.html` **dan**
> `--css-build` di `style.css` setiap kali `style.css`/skrip berubah.
> Keduanya harus sama.

## Audit v3 — fokus keyboard, hover, lebar sempit, slider, ikon, state error (2026-11-22)

Audit mode gelap sebelumnya sudah mengukur kontras teks dan "blok putih",
tapi belum pernah menyentuh **indikator fokus**. Audit ini menambah
dimensi baru dan menemukan tiga bug nyata.

### Temuan & perbaikan

| Temuan | Dampak | Perbaikan |
|---|---|---|
| `--focus-ring` memakai `--brand-soft` (#1c2542 di gelap) | **Cincin fokus nyaris tak terlihat** di mode gelap (kontras 1,05–1,32:1). Melanggar WCAG 2.4.7 Focus Visible & 1.4.11 Non-text Contrast. | `--focus-ring` memakai `var(--brand)` solid → kontras ≥ 5:1 di kedua tema |
| `.tab.active` ditulis **setelah** `.tab:focus-visible` | Tab yang sedang aktif **tidak punya penanda fokus sama sekali** (specificity sama, gaya aktif menimpa) | aturan `:focus-visible` dipindahkan setelah `.tab.active` |
| `.opt-row input:focus` & `.slider-row select:focus` memakai `brand-soft` | outline fokus tak terlihat | diganti `var(--brand)` + `outline-offset` |
| Input editor (`.ed-field`) tanpa aturan fokus | penanda fokus hanya bawaan peramban | ditambahkan outline `var(--brand)` |
| PDF rusak → pdf-lib melempar `TypeError: Cannot read properties of undefined (reading 'Pages')` | **pesan teknis mentah tampil ke pengguna** | `pesanReader()` memetakan error teknis → "Berkas rusak atau tidak bisa dibaca. Coba PDF lain."; log diubah jadi `console.warn` (sudah ditangani, bukan error) |

### Dimensi baru yang diuji

| Dimensi | Cara diuji |
|---|---|
| **Fokus keyboard** | navigasi `Tab` sungguhan (bukan `focus()` pogramatis — `:focus-visible` hanya aktif untuk interaksi keyboard), lalu ukur indikator + kontrasnya terhadap latar induk |
| **Hover** | tiap tombol/tab di-hover; teks tetap terbaca |
| **Lebar sempit** | 320 px & 360 px: tidak boleh ada scroll horizontal di 4 tab + editor |
| **Slider** | kontras rel `input[type=range]` terhadap latar induk |
| **Ikon SVG** | kontras `currentColor` terhadap latar efektif (gradient ikut dihitung) |
| **State error** | PDF rusak & rusak total → pesan ramah + toast error kontras ≥ 4.5:1 |
| **Dokumen besar** | 120 halaman: thumbnail + editor tetap rapi, tanpa error |

### Hasil suite

| Suite | Pemeriksaan | Gagal | Cakupan |
|---|---|---|---|
| `audit-deep3.mjs` | 251 | 0 | fokus keyboard di semua state, lebar 320/360 px, slider, ikon, state error, dokumen 120 halaman, seluruh state dinamis, desktop + ponsel |
| `audit-regresi.mjs` | 24 | 0 | split/merge/compress/4 alat/editor + pemulihan cache + konsistensi penanda versi |
| **Total** | **275** | **0** | |

## Catatan perilaku

- **OCR** memakai `TextDetector` bawaan browser bila tersedia, dan mesin
  Tesseract offline yang ikut disertakan sebagai cadangan.
- **Terjemah** memakai mesin bawaan browser (`Translator`) bila model
  bahasa sudah ada di perangkat, **dan** mesin Bergamot offline yang ikut
  disertakan — jadi tetap jalan di peramban tanpa mesin bawaan.
- **HTML to PDF** memakai dialog cetak browser; hasilnya disimpan manual dari
  dialog tersebut.
- **Protect PDF** ditulis dengan `useObjectStreams:false` agar tabel xref
  klasik tetap terbaca reader lama, dan `/ID` ditulis sebagai array langsung
  di trailer (bukan objek tak langsung) supaya tidak ada objek yatim.

---

# Audit Tata Letak Menu & UI (2026-11-23)

Rerapian antarmuka setelah audit visual menemukan 9 masalah tata letak.
Semua pemeriksaan dijalankan lokal dengan Playwright/Chromium
(`.devtest/`, tidak ikut ke repo).

## Masalah yang ditemukan & perbaikannya

| # | Masalah audit visual | Perbaikan | Berkas |
|---|---|---|---|
| 1 | Tab awal hilang saat tab otomatis ter-scroll (412 px → `scrollLeft=98`, tab pertama `x=-79`; 360 px → `x=-131`) | `syncTabStrip()` menghitung offset relatif terhadap strip (`offsetLeft - offsetParent.offsetLeft`); tab aktif selalu dijaga terlihat di 320/360/412/600/1280 px | `app.js` |
| 2 | Label tab terlalu panjang di mobile | Label pendek `Pisah / Gabung / Kompres / Alat` (`.tab-txt-short`), label penuh di desktop | `index.html`, `style.css` |
| 3 | Workspace alat membuang ruang kosong | Sidebar pilihan sticky + pratinjau halaman pertama PDF (pdf.js) di kolom utama | `style.css`, `tool-ui.js` |
| 4 | Editor memakai tiga kolom sempit (panggung 490 px) | Panel inspektor editor pindah ke rail kanan (`#toolSideExtra`) → panggung 804 px, dua kolom | `index.html`, `tool-editor.js`, `style.css` |
| 5 | Toolbar editor terlalu padat (9 baris di 360 px) | Toolbar dikelompokkan (`.ed-group`), tombol panjang dilipat jadi ikon, indikator halaman ringkas → 3 baris | `tool-editor.js`, `style.css` |
| 6 | Kartu alat tidak seragam & ikon berulang | `min-height` seragam, deskripsi 2 baris, ikon unik (`removePage`, `extractPage`, `pdfToImage`, `pdfToWord`, `pdfToXls`, `pdfToPpt`) | `style.css`, `tool-ui.js`, `tool-convert.js` |
| 7 | Panel kompres terlalu panjang + status "Menghitung perkiraan…" macet | Preset jadi grid `auto-fit`, deskripsi ringkas (teks penuh di `title`), dan `compressEstAbortLoading()` mengubah status `loading` yang menggantung menjadi `error` | `index.html`, `style.css`, `app.js` |
| 8 | Launcher tidak punya pencarian | Kolom pencarian dengan filter nama/deskripsi + state "tidak ada hasil" | `index.html`, `tool-ui.js` |
| 9 | Alur yang sama muncul di tab utama & daftar alat | Penanda `Tab Gabung / Tab Pemisah / Tab Kompres` pada kartu launcher; shortcut "Paling sering dipakai" di beranda | `tool-ui.js`, `style.css` |

## Bug nyata yang ditemukan saat pengujian

- **Filter launcher melempar error** — kartu bertipe *link* tidak punya
  `dataset.tool`, sehingga `card.dataset.tool.includes(q)` melempar
  `Cannot read properties of undefined`. Diperbaiki dengan memakai
  `dataset.tool || dataset.toolLink`.
- **Tombol "Proses" bisa terpotong** di rail pilihan yang panjang.
  Tombol aksi utama kini `position:sticky` di dalam rail.
- **Field tanpa label aksesibel** — 5 input berkas/rentang tidak punya
  nama aksesibel. Ditambahkan `aria-label`.

## Hasil suite

| Suite | Pemeriksaan | Gagal | Cakupan |
|---|---|---|---|
| `audit-ui.mjs` | 57 | 0 | hierarki tab, strip responsif 320–1280 px, pencarian & state kosong, ikon unik, kartu seragam, pintasan beranda, panel kompres, editor 2 kolom, menu editor + Escape, toolbar mobile, navigasi keyboard, dark mode, tombol aksi terjangkau |
| `audit-fungsi.mjs` | 22 | 0 | split, merge, kompres, 4 alat lain + pratinjau, pemulihan cache, kebenaran navigasi |
| `audit-alat.mjs` | 122 | 0 | seluruh 28 alat registry, 6 mode pemisahan, gabung (termasuk balik urutan), 5 preset kompres, editor, tema terang/gelap, a11y tombol & field |
| **Total** | **201** | **0** | |

## Putaran audit II — verifikasi terhadap byte produksi (2026-11-23)

Audit sebelumnya hanya berjalan di working tree. Putaran ini menjalankan
Chromium (Playwright) terhadap **salinan persis branch `main`** yang diunduh
melalui codeload, lalu menguji **fungsi** (bukan hanya tampilan): pisah,
gabung, kompres, editor, pencarian, mode gelap, dan aksesibilitas.
Harness: `tools/verify-produksi.mjs` (+ `tools/mkfixtures.mjs`).

### Bug nyata yang ditemukan di build yang sudah tayang

| # | Gejala | Akar masalah | Perbaikan | Berkas |
|---|---|---|---|---|
| 10 | Baris pintasan "Paling sering dipakai" **tidak terlihat** di beranda — 5 kartu sudah ter-render di DOM, tetapi section masih punya atribut `hidden` sampai pengguna berpindah tab | `render()` (satu-satunya tempat yang mengatur `#quickTools.hidden`) tidak pernah dipanggil saat halaman dimuat | `render()` dipanggil pada blok init; baris pintasan langsung tampil | `app.js` |
| 11 | Di layar sempit (≤900 px) **panel pilihan menimpa dropzone berkas** dan menutupi toolbar editor — berkas tidak bisa dipilih pada semua alat | `.tool-side` memakai `position:sticky; top:78px` juga saat layout berubah jadi satu kolom, sehingga rail menempel di atas kolom utama | Rail jadi `position:static` pada ≤900 px dan mengalir di bawah konten utama; tombol "Proses" ikut mengalir (tidak melayang di atas kolom lain) | `style.css` |

### Pemeriksaan regresi baru (otomatis)

- Baris pintasan tampil sejak halaman pertama dimuat.
- Rail pilihan tidak menimpa dropzone berkas pada 360 px.
- Rail pilihan mengalir di bawah konten utama pada 360 px.
- Toolbar editor terlihat (tidak tertutup panel lain) pada 360 px.
- Penanda versi aset seragam di `index.html`, `--css-build`, dan `window.PDF_BUILD`.

### Hasil

| Harness | Pemeriksaan | Gagal |
|---|---|---|
| `tools/verify-produksi.mjs` (build `main` sebelum perbaikan) | 62 | 4 — keempatnya persis mereproduksi bug di atas |
| `tools/verify-produksi.mjs` (setelah perbaikan) | 63 | 0 |

Bukti visual ada di `docs/audit-2026-11-23/`:

| Berkas | Isi |
|---|---|
| `beranda-pintasan-tampil.png` | Baris pintasan "Paling sering dipakai" langsung tampil di beranda |
| `sebelum-mobile-watermark.png` | **Sebelum:** panel pilihan menutupi dropzone berkas di 360 px |
| `sesudah-mobile-watermark.png` | **Sesudah:** dropzone kembali terlihat, panel pilihan mengalir di bawahnya |
| `sebelum-mobile-editor.png` | **Sebelum:** toolbar editor tertutup panel pilihan di 360 px |
| `sesudah-mobile-editor.png` | **Sesudah:** toolbar editor tampil sebelum kanvas, lalu opsi, lalu inspektur |

## Audit mendalam fitur OCR (2026-11-23)

Audit khusus alat **OCR PDF** (`tool-smart.js`) dipicu laporan hasil OCR menumpuk
di atas teks asli pada sertifikat digital. Rincian lengkap ada di
[`docs/audit-ocr-2026-11-23.md`](docs/audit-ocr-2026-11-23.md).

### Temuan utama

| # | Temuan | Perbaikan |
|---|---|---|
| 1 | Teks OCR menumpuk di atas teks asli pada halaman digital | Halaman berteks **dilewati**; opsi "paksa" membangun ulang halaman (gambar + teks OCR) tanpa duplikasi |
| 2 | Dokumen dibangun ulang dari JPEG → vektor, formulir, anotasi, bookmark, metadata hilang | PDF asli dimodifikasi **di tempat**; hanya isi halaman yang diganti yang dibuang (objek gambarnya dihapus agar berkas tidak membengkak) |
| 3 | `maxWidth: bw * 1.6` → teks melebar, spasi palsu saat ekstraksi | Ukuran huruf dihitung ulang dari lebar & tinggi kotak; `maxWidth` dikunci `bw * 1.02` |
| 4 | Koordinat ditulis dengan asumsi halaman tegak | Posisi **dan sudut baseline** diambil dari viewport pdf.js → rotasi `/Rotate` & CropBox tertangani |
| 5 | `loadDoc()` per halaman (O(n²)) | Dokumen dibaca sekali per berkas |
| 6 | Worker Tesseract bisa tetap hidup di memory | Semua worker dimatikan di `finally` |
| 7 | Progres selalu 0% | Persentase nyata: pemeriksaan → pengenalan → penulisan |
| 8 | Fallback `TextDetector` bisa melempar | Dibungkus `try/catch`; halaman asli dipertahankan bila kosong |

### Hasil suite

| Harness | Pemeriksaan | Gagal |
|---|---|---|
| `tools/audit-ocr.mjs` (audit khusus OCR) | 44 | 0 |
| `tools/verify-produksi.mjs` (termasuk 6 regresi OCR + 5 regresi Rapi PDF) | 73 | 1 — cacat layout toolbar lama, sudah gagal juga di commit baseline `b7861b2` (dibuktikan ulang) |
| `tools/audit-deskew.mjs` (audit khusus Rapi PDF / pelurusan) | 56 | 0 |
| Uji beban 24 halaman (OCR) | 18,6 detik (sebelumnya timeout > 120 detik) | — |
| Uji beban 12 halaman miring (Rapi PDF) | 4,0 detik | — |

Bukti visual ada di `docs/audit-ocr-2026-11-23/`.

### Audit "Rapi PDF" (pelurusan dokumen miring) — 24 November 2026

| Pemeriksaan | Hasil |
|---|---|
| Deteksi kemiringan (12 fixture: 0°, ±3°, ±2,5°, ±6°, ±90°, ±180°, foto, kosong) | Sudut salah **0,00°** untuk semua kemiringan bukan nol |
| Mutu gambar | Stream JPEG pindai **byte-identik** sebelum/sesudah (piksel tak tersentuh) |
| Mutu teks | Teks tetap vektor & bisa dicari, jumlah item teks tetap, gaya huruf tetap miring |
| Anotasi & field | Tautan tetap ada dan ikut berputar bersama isinya |
| Opsi | Batas sudut, `deskew=false`, `autoRotate=false`, pangkas margin, metadata |
| Kasus batas | Halaman kosong, berkas rusak (pesan jelas), 3 halaman campuran, `/Rotate 90°`, beban 12 halaman (4,0 dtk) |
| Regresi | OCR 44/0, produksi 73/1 (1 cacat lama, terbukti di baseline) |

Rincian lengkap: `docs/audit-deskew-2026-11-24.md`;
bukti visual: `docs/audit-deskew-2026-11-24/`.

### Audit "Tanda tangani PDF" — pratinjau terbalik 90 derajat — 24 November 2026

Laporan bug: *"saat memuat dokumen pdf di preview dokumennya terbalik 90
derajat"* pada alat **Tanda tangani PDF**.

#### Akar masalah

Pratinjau memakai **halaman yang terlihat** (`pdf.js` sudah memperhitungkan
`/Rotate`), sedangkan PDF akhir digambar di **ruang pengguna** mentah
(`pdf-lib` tidak tahu soal rotasi). Pada halaman biasa keduanya sama, tetapi
pada halaman berotasi (umum pada hasil pindai) posisi tanda tangan di PDF
akhir meleset sampai **245 mm** dan gambarnya ikut berputar.

#### Yang diperbaiki

| Temuan | Perbaikan |
|---|---|
| Pratinjau ≠ PDF akhir untuk halaman `/Rotate` 90/180/270° | Penempatan sadar-rotasi (`kotakTerlihat()` + `gambarTanda()`) memakai CropBox∩MediaBox dan memutar image agar tegak |
| Tidak ada jepit posisi — `x = 400 mm` diterima, tanda tangan keluar kertas | Posisi **dan** ukuran dijepit ke halaman terkecil di antara target; rasio gambar terjaga; kolom X/Y/Lebar dikoreksi |
| Pratinjau dan PDF akhir memakai perhitungan berbeda | Keduanya memakai sumber ukuran & batas yang sama → pratinjau = hasil |

#### Tambahan: posisi tanda tangan bisa digeser dengan jari

| Aspek | Hasil |
|---|---|
| Pegangan geser di pratinjau | sejajar **0,0 px** dengan kotak tanda tangan (desktop & 375 px) |
| Geser dengan jari (Pointer Events + `touch-action:none`) | ΔX 24,85 mm untuk 40 px; ΔY −15,52 mm (arah bawah benar) |
| Geser dengan tetikus | ΔX −18,64 mm untuk 30 px |
| Keyboard | panah = 1 mm, `Shift`+panah = 5 mm |
| Performa | drag **tidak** memicu render ulang PDF — halaman disalin ke kanvas `snap`, hanya satu frame digambar ulang |
| End-to-end | posisi setelah **drag** benar-benar masuk ke PDF akhir (Δ 0,5 / 0,4 mm dari pratinjau) |
| Aksesibilitas | `role="button"`, `tabindex="0"`, `aria-label`, `aria-describedby`, `aria-keyshortcuts`, live region `role="status"` |

#### Bug kedua: "Cannot use the same canvas during multiple render() operations"

Laporan: pratinjau gagal dirender dengan pesan

```
Halaman tidak bisa dirender: Cannot use the same canvas during multiple
render() operations. Use different canvas or ensure previous operations
were cancelled or completed.
```

**Akar masalah:** pdf.js menyimpan kumpulan kanvas yang sedang dipakai dan
melempar error itu kalau dua `render()` memakai kanvas yang sama sebelum
render sebelumnya selesai. Pratinjau tanda tangan menulis ke kanvas
`preview` yang persisten, dan pemicu refresh bisa datang saat render itu
masih jalan. Yang paling nyata: berkas baru masuk memicu **dua** refresh
(`renderFiles()` → `onOptsChange` → jeda 160 ms, **dan** penangan berkas →
`refreshPreview()` langsung) — sehingga error muncul tepat setelah
memuat dokumen.

| Temuan | Perbaikan |
|---|---|
| Render memakai kanvas yang sama → bentrok pdf.js | Tiap render memakai **kanvas baru**; hasilnya disalin ke kanvas terlihat setelah selesai |
| Render lama masih jalan saat render baru mulai | Render lama **dibatalkan** dan ditunggu selesai; pembatalan tidak lagi dianggap error |
| Dua render untuk isi yang sama | Dilewati lewat **kunci isi pratinjau** (berkas, halaman, posisi, ukuran, gambar tanda tangan) |
| Render basi bisa menyembunyikan pratinjau baru (alat lain) | `renderPreview()` diberi token — hasil basi dibuang |

Uji balapan render (2×, 3×, + ganti halaman) di harness: sebelum perbaikan
**3 gagal**, sesudah **65 lulus / 0 gagal**.

#### Audit sentuhan — target sentuh & area tangkap

Laporan: *"fitur tanda tangani belum bisa digeser dengan jari, harus manual
dengan input angka di menu pilihan."*

Audit sentuhan (emulasi iPhone 13, 390 px, sentuhan asli via CDP)
menemukan bahwa fitur geser **sudah ada**, tapi **area tangkapnya terlalu
kecil untuk jempol**:

| | Sebelum | Sesudah |
|---|---|---|
| Area tangkap (390 px) | 80 × **28** px | **94 × 55** px |
| Area tangkap (320 px) | 64 × **22** px | **78 × 49** px |
| Jari meleset 12 px dari kotak | **tidak tertangkap** | tertangkap |
| `-webkit-touch-callout` | aktif | dimatikan |
| Ubah lebar tanpa mengetik angka | tidak ada | pegangan pojok kanan bawah (62 × 62 px) |

| Temuan | Perbaikan |
|---|---|
| Area tangkap setipis 28 px — di bawah ambang sentuh 44 px | `.sign-drag::before { inset:-15px }` memperbesar area tangkap; kotak terlihat tetap menandai posisi sebenarnya |
| Tidak ada toleransi saat jari meleset | Area tangkap diperbesar 15 px per sisi (Δx 37,3 mm untuk meleset 12 px) |
| Panggilan konteks iOS mengganggu gerakan | `-webkit-touch-callout:none` + `-webkit-tap-highlight-color:transparent` |
| Lebar hanya bisa diisi angka | Pegangan **ubah-lebar** di pojok kanan bawah (62 × 62 px), rasio gambar tetap terjaga |
| `pointermove` hanya di elemen pegangan | Listener `pointermove`/`pointerup`/`pointercancel` juga di `window` — drag tetap jalan walau pointer capture gagal |

Harness `tools/audit-sign-touch.mjs` (baru, **26 pemeriksaan**): terhadap
kode sebelum perbaikan **8 gagal**, terhadap kode sesudah **26 lulus / 0
gagal**. Bukti: `docs/audit-ttd-sentuh-2026-11-25.md`.

#### Hasil suite

| Harness | Pemeriksaan | Gagal |
|---|---|---|
| `tools/audit-sign.mjs` (audit khusus tanda tangan) | 65 | 0 |
| `tools/audit-sign-touch.mjs` (audit sentuhan / layar ponsel) | 26 | 0 |
| `tools/audit-translate.mjs` | 30 | 1 — "Mesin bawaan peramban terdeteksi" (versi Chromium di lingkungan uji; bukan perubahan kode) |
| `tools/audit-pagerange.mjs` | 106 | 0 |
| `tools/audit-merge-preview.mjs` | 44 | 0 |
| `tools/audit-deskew.mjs` | 56 | 0 |
| `tools/audit-ocr.mjs` | 44 | 0 |
| `tools/audit-preview-perf.mjs` | 39 | 0 |
| `tools/verify-produksi.mjs` | 73 | 1 — cacat layout toolbar lama (sudah gagal di commit baseline) |

Selisih posisi tanda tangan antara pratinjau dan PDF akhir setelah
perbaikan: ≤ **2,31 mm** untuk semua rotasi (sebelumnya sampai 245 mm).

Bukti visual ada di `docs/audit-ttd-2026-11-24/`; rincian lengkap di
`docs/audit-ttd-2026-11-24.md`.

## Catatan

- Penanda versi aset dinaikkan ke `20261123g` (`--css-build` +
  `window.PDF_BUILD`) setelah perbaikan bug mobile & baris pintasan.
- Verifikasi produksi visual tetap menjadi syarat penutupan; hasil lokal
  di atas belum menggantikan pemeriksaan produksi.
- `tools/verify-produksi.mjs` dan `tools/mkfixtures.mjs` sengaja ikut ke
  repo supaya audit yang sama bisa dijalankan GitHub Actions terhadap
  `https://putra1996.github.io/PDF/`. Workflow-nya ada di
  `.github/workflows/verify-produksi.yml` (dipasang manual: token yang
  dipakai sandbox tidak punya scope `workflows`).

---

# Audit payung SEMUA fitur — 2026-11-25

Audit sebelumnya menguji area per topik (tanda tangan, OCR, deskew, rentang
halaman, …). Audit ini menutup **seluruh permukaan fitur** dalam satu kali
jalan: 28 alat registry + 5 launcher tab utama + 9 kemampuan editor visual.

| Harness | Pemeriksaan | Gagal |
|---|---|---|
| `tools/audit-semua.mjs` (baru — payung) | **129** | **0** |
| `tools/audit-editor.mjs` (baru — editor visual) | **29** | **0** |
| `tools/verify-produksi.mjs` | **74** | **0** (sebelumnya 73/1 — diperbaiki) |

Rincian lengkap: `docs/audit-semua-2026-11-25.md`.
Bukti: `docs/audit-semua-2026-11-25/` (44 tangkapan layar + folder `keluaran/`
berisi tiap berkas keluaran yang diuji).

## Cacat nyata yang ditemukan & diperbaiki

| # | Cacat | Akar | Perbaikan |
|---|---|---|---|
| 1 | **Word → PDF menghasilkan PDF kosong** | `tool-convert.js` memakai `node.nodeName`; dokumen Word ber-namespace ⇒ nama elemennya `w:p`/`w:tbl`, bukan `p`/`tbl`, sehingga tidak satu pun paragraf dikenali | pakai `node.localName` (dengan `nodeName` sebagai cadangan) |
| 2 | Dokumen Word dengan content control ikut kosong | isi berada di `w:sdt` → `w:sdtContent`, dilewati parser | parser membuka `w:sdtContent` lebih dulu |
| 3 | **Toolbar editor 4 baris di 360 px** | `.ed-bar` memakai `align-items:center` ⇒ tiap grup mulai pada koordinat *top* berbeda sehingga baris terukur terpecah | `align-items:stretch` pada `.ed-bar`, `align-items:center` pada `.ed-menu-wrap` → 3 baris |
| 4 | Pemeriksaan statis baru untuk kelas bug "keyword tanpa spasi" | `functionX` dibaca sebagai satu identifier → galat `Unexpected identifier` | semua berkas sumber kini di-parse (`node --check`) di dalam harness |

## Yang dipverifikasi per fitur (bukan sekadar "berkas jadi")

- **Geometri**: `crop` → CropBox menyusut 20 mm/sisi sementara MediaBox tetap.
- **Posisi**: `numbers` → nomor ada di tiap halaman dan berada di bagian bawah.
- **Per halaman**: `watermark` → stempel ada di ketiga halaman.
- **Tertanam**: `jpg2pdf`/`scan` → halaman memuat XObject gambar.
- **Isi berkas**: `pdf2word`/`pdf2xls`/`pdf2ppt` → XML di dalam OOXML memuat teks PDF.
- **Struktur**: `pdfa` → ada `/OutputIntent` + `pdfaid:part` di XMP, tidak terenkripsi.
- **Enkripsi**: `protect` → `/Encrypt` ada; `unlock` → benar-benar terbuka.
- **Bukti piksel**: `watermark` 2 010 piksel gelap · `redact` hal.1 1 367 vs hal.2
  3 055 piksel pekat (kotak penutup) · `sign` tinta 2 077 vs 2 010.
- **Banyak berkas**: `rotate` & `protect` dengan 2 PDF sekaligus.
- **11 jalur galat**: semuanya ditolak dengan pesan ramah, tanpa galat tak tertangani.
- **Responsif**: 33 kartu alat di 360 px, nol gulir horizontal.

## Status suite regresi setelah audit payung

| Harness | Pemeriksaan | Gagal |
|---|---|---|
| `tools/audit-sign.mjs` | 65 | 0 |
| `tools/audit-sign-touch.mjs` | 27 | 0 |
| `tools/audit-translate.mjs` | 30 | 1 — "Mesin bawaan peramban terdeteksi" (batasan lingkungan; mesin offline bawaan berhasil dipakai) |
| `tools/audit-pagerange.mjs` | 106 | 0 |
| `tools/audit-merge-preview.mjs` | 44 | 0 |
| `tools/audit-deskew.mjs` | 56 | 0 |
| `tools/audit-ocr.mjs` | 44 | 0 |
| `tools/audit-preview-perf.mjs` | 39 | 0 |
| `tools/verify-produksi.mjs` | 74 | 0 — cacat layout toolbar lama ikut terperbaiki |

---

# Audit Mendalam "Rapi PDF" — dokumen pindai miring ±0,8° — 2026-11-25

Kasus nyata dari pengguna: **surat keterangan hasil pindai dengan kemiringan
kecil ±0,8°** (kop surat, nomor, stempel bundar, foto, tanda tangan).
Audit ini mencakup seluruh fitur **Rapi PDF**, lalu memperbaikinya.

Rincian lengkap: `docs/audit-rapi-2026-11-25.md` ·
bukti visual: `docs/audit-rapi-2026-11-25/` ·
harness baru: `tools/audit-rapi.mjs` (**58 lulus / 0 gagal**) ·
fixture baru: `tools/mkfixtures-rapi.mjs` (11 fixture).

## Temuan yang diperbaiki

| # | Temuan | Dampak |
|---|---|---|
| 1 | `skorProyeksi` salah hitung rentang min–max (`else if`) | skor meledak di sudut palsu → **kemiringan terdeteksi salah** |
| 2 | Tanda arah saat meluruskan frame salah (`-h.sudut`) | sisa miring 2× lipat, segmentasi baris kacau |
| 3 | Deteksi "terbalik" terlalu lemah (ambang 0,02, satu bukti) | **dokumen pindai 0,8° dibalik 180°** — dokumen resmi jadi terbalik |
| 4 | Cabang "teks tegak" selalu memilih −90° | pindai −90° berakhir terbalik |
| 5 | Fixture deskew **tidak pernah benar-benar miring** (escaping `\n`) | regresi deskew 56/0 sebelumnya **false positive** |
| 6 | Pangkas margin memakai ambang "tinta gelap" | foto/tabel/stempel pudar bisa **terpotong** |
| 7 | Kotak margin dari AABB yang diputar | pangkas margin selalu lebih longgar dari seharusnya |
| 8 | Pembalikan 180° tanpa penjaga di sisi alat | dokumen bisa dibalik tanpa bukti kuat |
| 9 | Resolusi analisis 1100 px & langkah 0,44° | sudut kecil (<1°) kurang presisi |

Kasus pengguna, sebelum → sesudah:

| | Sebelum | Sesudah |
|---|---|---|
| Sudut koreksi | **179,20°** (dokumen dibalik) | **−0,74°** |
| Sisa kemiringan | — | **0,00°** |
| Jarak isi masukan ↔ keluaran | — | **0,511 pt** (sub-piksel) |
| Cakupan piksel pratinjau di PDF final | — | **100,0 %** (balik 99,9 %) |
| Stream JPEG pindai | — | byte-identik (tidak di-encode ulang) |

Perbaikan kunci: (a) `min`/`max` dihitung terpisah; (b) frame diluruskan
dengan `+h.sudut`; (c) deteksi terbalik butuh **dua bukti independen**
saling sepakat — *sisi rata* baris teks **dan** *titik berat vertikal*
(huruf Latin menumpuk di atas baris, jadi teks terbalik menandainya
terbalik); (d) pembalikan ≥135° hanya boleh jalan bila analisis menandainya
tebalik dengan keyakinan lebih tinggi.

## Bukti independen

Sudut residual diukur dengan estimator **yang ditulis ulang di harness**
(profil proyeksi diukur dengan entropi histogram, bukan jumlah kuadrat isi
bin seperti di aplikasi) — jadi hasil audit tidak mengulang kode yang
sedang diuji. Konten diverifikasi secara geometrik (jarak titik tinta
masukan yang diputar vs keluaran) **dan** secara piksel (cakupan
pratinjau ↔ PDF final di ruang pengguna PDF).

## Status suite regresi setelah audit Rapi PDF

| Harness | Pemeriksaan | Gagal |
|---|---|---|
| `tools/audit-rapi.mjs` (baru) | 58 | 0 |
| `tools/audit-deskew.mjs` (fixture asli + estimator mandiri) | 56 | 0 |
| `tools/audit-semua.mjs` (payung 33 fitur) | 129 | 0 |
| `tools/audit-editor.mjs` | 29 | 0 |
| `tools/verify-produksi.mjs` | 74 | 0 |
| `tools/audit-sign.mjs` | 65 | 0 |
| `tools/audit-sign-touch.mjs` | 27 | 0 |
| `tools/audit-pagerange.mjs` | 106 | 0 |
| `tools/audit-merge-preview.mjs` | 44 | 0 |
| `tools/audit-ocr.mjs` | 44 | 0 |
| `tools/audit-preview-perf.mjs` | 39 | 0 |
| `tools/audit-translate.mjs` | 30 | 1 — batasan lingkungan (Translator API tak tersedia di Chromium headless; fallback offline lulus) |

---

# Audit Mendauh "Terjemah PDF" — mesin AI daring + akurasi terjemahan — 2026-11-26

Audit mendalam fitur terjemahan. Temuan: **12 cacat/keteterbatasan**, semuanya
diperbaiki. Rincian: `docs/audit-terjemah-ai-2026-11-26.md` ·
bukti visual: `docs/audit-terjemah-ai-2026-11-26/` ·
harness baru: `tools/audit-translate-ai.mjs` (**55 lulus / 0 gagal**, server AI tiruan).

## Yang berubah

| | Sebelum | Sesudah |
|---|---|---|
| Mesin terjemahan | 2 (bawaan peramban + offline WASM) | **3** (+ **AI daring**) |
| Pasangan bahasa | 2 offline; sisanya butuh Chrome 138+ | **semua** (AI daring) |
| Granularitas | per **baris** | per **kalimat** + konteks paragraf |
| Hasil | hanya `.md` | **`.md` + `.pdf`** (PDF punya lapisan teks tak terlihat) |
| Konfigurasi mesin | terkunci di aplikasi | **manifest di server** (`ai/translate-engine.json`) → perbaikan AI di server ikut terpakai tanpa rilis baru |
| Galat jaringan | membatalkan seluruh pekerjaan | retry + backoff + timeout + pesan yang bisa ditindaklanjuti |
| Cache kalimat | tidak membedakan mesin | **terisolasi per mesin** (hasil lama tidak bocor ke mesin baru) |
| Privasi | — | izin kirim ke server + glosarium + kunci API sendiri |

## Rantai mesin

**AI daring → bawaan peramban → offline.** Kalau server AI error, aplikasi
otomatis turun ke mesin berikutnya dan memberi tahu pengguna. Mode "AI daring"
yang dipilih TUJUAN tidak pernah diam-diam memakai mesin lain.

## Protokol server yang didukung

`openai` (OpenAI-compatible) · `mymemory` · `libretranslate` · `custom`
(POST `{from,to,texts:[…]}` → `{translations:[…]}`).

## Manifest server

`ai/translate-engine.json` berisi versi, daftar mesin (endpoint, model, protokol,
prioritas, batas item/karakter), **template prompt**, dan setelan default
(timeout, retry, konkurensi, temperatur). Manifest diunduh ulang dengan validasi
`ETag`; kalau versinya naik, **model, endpoint, dan prompt yang baru langsung
dipakai** — tombol "Perbarui dari server" memaksa pemeriksaan. Cadangan berlapis:
server → berkas lokal → manifest bawaan di dalam `tool-translate-ai.js`.

## Bukti yang diuji otomatis

Perubahan manifest di server terdeteksi dan model baru langsung dipakai ·
beberapa baris berurutan dikirim dalam **satu** permintaan (konteks terbaca) ·
glosarium ikut terkirim · angka/kode/URL **tidak** dikirim dan dikembalikan apa
adanya · retry saat 5xx · 401 → pesan "kunci API ditolak" · **kunci API tidak
pernah bocor** ke pesan galat · server AI gagal → turun ke mesin bawaan dan
**perpindahan mesin dilaporkan** · PDF terjemahan punya lapisan teks tak terlihat
(hasilnya bisa dicari keluar dari PDF).

## Status suite regresi

| Harness | Pemeriksaan | Gagal |
|---|---|---|
| `tools/audit-translate-ai.mjs` (baru) | 55 | 0 |
| `tools/audit-translate.mjs` | 32 | 1 — Chromium headless dijalankan dengan `--disable-features=Translate` sehingga API Translator tidak ada (batasan lingkungan) |
| `tools/audit-semua.mjs` (payung 33 fitur) | 129 | 0 |
| `tools/verify-produksi.mjs` | 74 | 0 |
| `tools/audit-editor.mjs` | 29 | 0 |
| `tools/audit-sign.mjs` | 65 | 0 |
| `tools/audit-sign-touch.mjs` | 27 | 0 |
| `tools/audit-pagerange.mjs` | 106 | 0 |
| `tools/audit-merge-preview.mjs` | 44 | 0 |
| `tools/audit-ocr.mjs` | 44 | 0 |
| `tools/audit-preview-perf.mjs` | 39 | 0 |
| `tools/audit-deskew.mjs` | 56 | 0 |
| `tools/audit-rapi.mjs` | 58 | 0 |

---

# Audit Edit PDF: OCR → ubah font/teks/gambar langsung di preview — 2026-11-22

Fitur OCR PDF sendiri kini membuka editor visual inline (pengguna tidak harus
pindah ke alat Edit PDF). OCR offline menghasilkan lapisan teks per baris yang
bisa dipilih dan diedit langsung di preview OCR, lalu diterapkan ke PDF keluaran. Font, isi, ukuran, warna, dan posisi memakai inspector
editor yang sudah ada. Objek gambar tetap dapat dipilih, diganti, diubah ukuran,
dipindah, atau dihapus.

- Harness baru: `tools/mkfixture-editor-ocr.mjs` + `tools/audit-editor-ocr.mjs`
  → **24/0**; fixture 4 halaman raster berotasi 0/90/180/270°, 200 DPI default, termasuk pemeriksaan isi PDF keluaran, edit ulang pasca-proses, dan edit ukuran gambar.
- Tesseract lokal, bahasa/DPI mengikuti opsi pengguna (Indonesia/200 DPI default), satu worker untuk menekan memori,
  progress UI, SIMD dengan fallback core standar, worker selalu dihentikan.
- Undo/redo dan ekspor/proyek menggunakan operasi editor normal.
- Batasan UX didokumentasikan: scan text ditutup dengan warna sekitar; bukan
  rekonstruksi konten/fill-aware pada latar foto atau bertekstur.
- OCR pada fixture 1 halaman @200 DPI: sekitar 2,3 detik termasuk init worker; PDF akhir dibandingkan dengan preview: **99,0%** piksel dalam toleransi Δ32.
- `audit-ocr.mjs` → **44/0** (termasuk scan dengan rotasi legacy); `verify-produksi.mjs` → **74/0**; `audit-semua.mjs` → **129/0**.
- Rincian dan screenshot: `docs/audit-editor-ocr.md`,
  `docs/audit-editor-ocr/ocr-preview.png`.
