# Pemisah PDF

Aplikasi web untuk **memecah, mengekstrak, menggabungkan, mengompres, mengedit, mengonversi, dan melindungi** PDF. **Semua proses berjalan di browser** — file tidak pernah diunggah ke server mana pun.

Seluruh proses berjalan **di dalam browser**: hanya pustaka lokal di `vendor/` (pdf-lib, pdf.js, JSZip) yang dipakai, dan **file tidak pernah diunggah**. Satu pengecualian opsional: alat **Terjemah PDF** bisa memakai mesin AI *daring* — teks **dikirim** (bukan file) ke server terjemahan, dan hanya kalau pengguna mengizinkan lewat kolom izin (bisa dimatikan; mesin offline & bawaan peramban tetap tersedia).

> **Dibuat oleh Putra.** Kreditnya tercantum di antarmuka web — di header, di footer, dan di `<title>` halaman. File PDF yang dihasilkan **tidak** memuat kredit/stempel apa pun di dalamnya; metadata Producer/Creator hanya berisi nama aplikasi (`Pemisah PDF`).

### Di mana kreditnya?

| Tempat | Ada kredit "Putra"? |
|---|---|
| Header web (chip "by Putra") | ✅ |
| Footer web ("Dikarya oleh Putra") | ✅ |
| `<title>` & meta tag halaman | ✅ |
| Isi halaman PDF (teks/stempel) | ❌ — sengaja tidak ada |
| Metadata PDF (Producer/Creator) | ❌ — hanya `Pemisah PDF` |

## Fitur baru (v2)

| Fitur | Penjelasan |
|---|---|
| **Mode gelap / terang** | Tombol bulan/matahari di header. Pilihan disimpan di `localStorage`, mengikuti preferensi sistem bila belum pernah dipilih, dan tidak berkedip saat halaman dimuat. |
| **Kompresi "Optimal"** | Teks & font tetap **vektor** (tetap tajam, zoom bebas, tetap bisa dicari). Hanya gambar raster yang resolusinya melebihi target DPI yang diperkecil. |
| **Anti-membengkak** | Hasil kompresi **tidak pernah lebih besar** dari berkas asli — bila lebih besar, berkas asli dipakai kembali. |
| **Deteksi halaman pindai** | Halaman yang hanya berisi satu foto besar dirender pada resolusi aslinya (tidak pernah di-*upsample*), jadi hasil tetap tajam dan kecil. |
| **Bersihkan metadata** | Judul, penulis, kata kunci, dan XMP dibuang (opsional). Bila dimatikan, metadata asli dokumen dipertahankan. |
| **Aksesibilitas** | Navigasi tab dengan tombol panah, `role="tabpanel"`, label ARIA, dan fokus yang jelas. |
| **Pesan error ramah** | PDF terenkripsi, rusak, terpotong, atau bukan PDF ditolak dengan pesan Bahasa Indonesia yang jelas — bukan error internal pustaka. |
| **Perkiraan ukuran hasil** | Tiap tingkat kompresi menampilkan perkiraan ukuran file setelah dikompresi (+ % penghematan) sebelum dijalankan, supaya mudah memilih yang paling hemat. |
| **Perkiraan ukuran gabungan** | Menu Gabung PDF menampilkan perkiraan ukuran file gabungan yang akan dihasilkan, dihitung dengan proses gabungan yang sama persis. |

## Cara pakai

1. Buka `index.html` di browser (Chrome, Edge, Firefox, Safari modern).
2. Pilih tab: **Pemisah halaman**, **Gabung PDF**, **Kompres PDF**, atau **Semua alat**.
3. Tarik file PDF ke area unggah, atau klik tombol pilih file. Di tab pemisah ada tombol **Coba contoh PDF**.
4. Proses, lalu file hasil otomatis terunduh dan tetap tersedia di kartu **Hasil** untuk diunduh ulang.

> Catatan: di pratinjau dalam aplikasi, unduhan bisa diblokir karena berjalan di iframe. Kalau itu terjadi, buka `index.html` langsung di tab browser.

## Tab 1 — Pemisah halaman

| Mode | Keluaran |
|---|---|
| Ekstrak halaman terpilih | 1 PDF baru berisi halaman terpilih (bisa gabungan beberapa file) |
| Hapus halaman terpilih | 1 PDF baru berisi **semua halaman kecuali** yang dipilih |
| Pisah tiap halaman | ZIP, 1 PDF per halaman (pilihan: hanya halaman terpilih) |
| Pisah tiap N halaman | ZIP, tiap file berisi N halaman (pilihan: hanya halaman terpilih) |
| Pisah per rentang kustom | ZIP, mis. `1-3, 4-8, 9-12` |
| Pisah per penanda buku | ZIP, tiap bab/daftar isi jadi file sendiri |

Pendukung: multi-file (halaman bisa digabung lintas file, urutan bisa diatur), thumbnail tiap halaman, tombol cepat Semua/Kosong/Balik/Ganjil/Genap, PDF berpassword dibuka tanpa merusak teks & vektor.

## Tab 2 — Gabung PDF

1. Tambahkan 2 PDF atau lebih (bisa tarik-lepas ke mana saja di halaman).
2. Atur urutan dengan tombol ▲ ▼, **Balik urutan**, atau **seret baris**.
3. Klik **Gabungkan PDF** → semua file disatukan sesuai urutan; tiap baris menampilkan thumbnail halaman pertama.

Hasil gabungan mempertahankan ukuran & rotasi tiap halaman aslinya (tidak dirasterisasi).

### Perkiraan ukuran file gabungan

Sambil file ditambahkan, panel bawah menampilkan **perkiraan ukuran file yang akan dihasilkan** (chip `7.8 MB dari 7.8 MB — pasti`):

- Angka ini **bukan perkiraan statis**: file gabungan benar-benar dibangun di latar belakang memakai proses gabungan yang **sama persis** dengan tombol "Gabungkan PDF" (`copyPages` + `save`), lalu ukurannya diukur. Karena itu angkanya nyaris identik dengan berkas yang benar-benar diunduh.
- Perkiraan dihitung ulang otomatis begitu file ditambah, dihapus, atau urutannya berubah (tombol ▲ ▼ / **Balik urutan** / seret baris). Selama dihitung, chip menampilkan status "Menghitung hasil…" supaya angka lama tidak ditampilkan.
- Bila total berkas lebih besar dari ±150 MB, perkiraan dilewati (chip menjelaskan) agar memori peramban tidak meledak.

## Tab 3 — Kompres PDF

| Tingkat | Cara kerja | Cocok untuk |
|---|---|---|
| **Ringan** (tanpa raster) | Buang objek yatim, optimalkan struktur, bersihkan metadata. Teks/font/gambar 100% utuh. | PDF berisi teks penting; penurunan ukuran bisa kecil |
| **Optimal** (disarankan) | Ringan + hanya gambar raster yang melebihi **200 DPI** diperkecil ke 200 DPI (diperkecil bertahap agar tetap tajam). Teks & font tetap vektor. | Mayoritas PDF — hasil tajam **dan** jauh lebih kecil |
| **Seimbang** | Raster 150 DPI, JPEG 78% (kualitas dinaikkan otomatis untuk halaman berteks). | PDF lama hasil pindai |
| **Kuat** | Raster 110 DPI, JPEG 62%. | Ukuran paling kecil, detail menurun |
| **Kustom** | Pilih strategi (Optimal / Ringan / Raster), DPI 72–400, kualitas 30–98%, grayscale. | Kontrol penuh |

Pilihan tambahan: **grayscale**, **bersihkan metadata**, dan **jangan pernah memperbesar file**.
Setelah selesai muncul ringkasan *% lebih kecil* (mis. `64% lebih kecil — 393 KB → 143 KB`), detail per file, dan tombol unduh (ZIP bila lebih dari satu file).

### Perkiraan ukuran hasil (sebelum compressing)

Begitu file PDF dimuat, tiap tingkat kompresi menampilkan **perkiraan ukuran file setelah dikompresi** plus persentase penghematan, sehingga Anda bisa memilih tingkat mana yang paling hemat sebelum menjalankan kompresi:

```
Optimal  (disarankan)
Teks & font tetap vektor (tetap tajam & bisa dicari)…
131 KB  −64%  dari 363 KB  [pasti]
```

- Angka dihitung dengan **mesin kompresi yang sama**, bukan tebakan. Untuk dokumen sampai 30 halaman, dokumennya dikompres utuh sehingga angkanya **persis** sama dengan hasil kompresi sebenarnya (ditandai `pasti`).
- Untuk dokumen lebih besar, hanya sebagian halaman yang diproses (ditandai `≈ dari N halaman`), lalu hasilnya diekstrapolasi terpisah untuk bagian gambar dan non-gambar supaya tetap akurat.
- Perkiraan dihitung di latar belakang — antrean satu per satu, jadi antarmuka tetap responsif. Angka untuk preset yang sedang dipilih dihitung lebih dulu.
- Angka otomatis diperbarui saat file ditambah/diubah/dihapus atau saat opsi (grayscale, metadata, jangan-perbesar, DPI, kualitas) berubah.
- Baris ringkasan di bawah daftar menandai tingkat yang **paling hemat**.

### Panel Kustom — slider hanya aktif bila relevan

Saat tingkat **Kustom** dipilih, panelnya memuat tiga kontrol: strategi, **resolusi (DPI)**, dan **kualitas gambar**. Status setiap slider mengikuti strategi yang dipilih, bukan riwayat pemakaian sebelumnya:

| Strategi | Resolusi (DPI) | Kualitas gambar | Penjelasan |
|---|---|---|---|
| **Optimal** — teks & font tetap vektor | ✅ aktif | ✅ aktif | DPI = batas resolusi gambar raster yang diperkecil; kualitas = mutu JPEG hasil downsampling |
| **Ringan** — struktur file saja | ⛔ nonaktif | ⛔ nonaktif | Dokumen tidak diolah ulang sama sekali, jadi kedua slider tidak dipakai |
| **Raster** — halaman jadi gambar | ✅ aktif | ✅ aktif | DPI = resolusi render halaman; kualitas = mutu JPEG hasil render |

Saat slider dinonaktifkan, muncul keterangan singkat di bawahnya yang menjelaskan alasannya. Rentang slider (DPI 72–400, kualitas 30–98%) selalu sama dengan batas yang dipakai mesin kompresi, jadi angka yang tampil dan angka yang dikerjakan tidak pernah berbeda.

### Cara kerja kompresi (detail teknis)

1. **Struktur** — objek PDF yang tidak lagi dirujuk (orphan) dibuang; metadata XMP/title/author dibersihkan bila diminta; objek ditulis ulang memakai object stream.
2. **Analisis DPI** — content stream tiap halaman diparse (tokenizer sendiri, termasuk Form XObject) untuk mengetahui **ukuran penempatan** tiap gambar dalam poin. Dari situ dihitung DPI efektifnya. Gambar yang dipakai di beberapa halaman memakai penempatan **terbesar** di seluruh dokumen, jadi tidak diperkecil berulang.
3. **Perkecil gambar** — gambar yang DPI efektifnya di atas target diperkecil **bertahap** (setengah demi setengah, `imageSmoothingQuality: high`) lalu dikodekan ulang sebagai JPEG. Format sumber yang didukung: JPEG (DCTDecode) dan data mentah (Flate/ASCII) dengan ruang warna **DeviceRGB, DeviceGray, DeviceCMYK, Indexed**, serta 1/2/4/8 bit per komponen. Gambar dengan alpha (`SMask`), stencil mask (`ImageMask`), atau JPEG yang lebih kecil dari aslinya **tidak disentuh**.
4. **Anti-membengkak** — hasil hanya dipakai bila benar-benar lebih kecil; jika tidak, gambar asli dipertahankan. Bila seluruh berkas masih lebih besar dari aslinya, berkas asli dikembalikan. Mode raster juga mencoba ulang dengan kualitas/DPI lebih rendah sebelum menyerah.
5. **Perkiraan ukuran** — untuk dokumen ≤ 30 halaman, mesin kompresi dijalankan utuh pada dokumen terpisah untuk memperoleh angka pasti. Untuk dokumen lebih besar, halaman sampel diproses (halaman paling berat + halaman tersebar), lalu rasio gambar dan non-gambar dihitung terpisah sehingga estimasi tetap akurat walau halaman foto berada di luar sampel. Untuk bagian non-gambar dipakai **model dua titik** (`biaya = A + B × jumlah halaman`) dari dua sampel berbeda, sehingga biaya tetap (font, sumber daya bersama) tidak ikut dikali dua kali — tanpa ini, dokumen tanpa gambar bisa meleset puluhan persen.
6. **Perkiraan ukuran gabungan** — file gabungan benar-benar dibangun di latar belakang (proses `copyPages` + `save` yang sama dengan tombol gabung) lalu ukurannya diukur, sehingga angkanya bukan tebakan.

## Tab 4 — Semua alat

Launcher dengan **7 kategori** dan **33 alat**. Alur yang sudah punya
tab sendiri (Gabung, Pisah, Hapus/Ekstrak halaman, Kompres) **tidak
diduplikasi** — semuanya memakai tautan ke alur yang sudah ada:

| Kategori | Alat |
|---|---|
| **Susun PDF** | Merge PDF · Split PDF · Remove pages · Extract pages · Organize PDF · Scan to PDF |
| **Optimalkan PDF** | Compress PDF · Rapi PDF · OCR PDF |
| **Konversi ke PDF** | JPG to PDF · WORD to PDF · POWERPOINT to PDF · EXCEL to PDF · HTML to PDF |
| **Konversi dari PDF** | PDF to JPG · PDF to WORD · PDF to POWERPOINT · PDF to EXCEL · PDF to PDF/A |
| **Edit PDF** | Rotate PDF · Add page numbers · Add watermark · Crop PDF · Edit PDF · PDF Forms |

### Edit PDF visual: OCR dan edit langsung di preview

Di **Edit PDF**, tombol **“OCR → edit teks”** mengenali teks halaman pindai secara offline (Tesseract Indonesia + Inggris). Setiap baris hasil OCR menjadi lapisan teks yang bisa dipilih di preview, lalu teks, font, ukuran, warna, gaya, dan posisi dapat diedit langsung seperti objek Word. Perubahan langsung terlihat pada preview; undo/redo, proyek editor, dan ekspor PDF tetap tersedia. Foto/ilustrasi tetap dipilih, digeser, diubah ukuran, diganti, atau dihapus melalui alat gambar yang sudah ada. OCR memakai 180 DPI dan satu worker untuk membatasi konsumsi memori; worker dihentikan setelah selesai.

**Catatan:** OCR mengubah teks menjadi lapisan editable di atas scan (area lama ditutup dengan warna latar yang disampling). Ini bukan rekonstruksi konten foto yang tertutup; pada latar bertekstur, batas penutup mungkin terlihat. Fitur tetap berjalan lokal, tidak mengunggah dokumen. Audit otomatis: `node tools/mkfixture-editor-ocr.mjs` lalu `node tools/audit-editor-ocr.mjs`.
| **Keamanan PDF** | Unlock PDF · Protect PDF · Sign PDF · Redact PDF · Compare PDF |
| **Kecerdasan PDF** | AI Summarizer · Translate PDF · PDF to Markdown |

Catatan:

- **Rapi PDF** (Repair PDF) sekarang bisa **meluruskan halaman hasil
  pindai yang miring** (sampai 20°, putar 90° otomatis, pangkas margin
  putih). Kemiringan dideteksi dari piksel tinta halaman, lalu diperbaiki
  dengan membungkus *content stream* — teks, vektor, dan gambar **tidak
  pernah ditulis ulang**, jadi kualitas dokumen tidak berkurang. Anotasi,
  tautan, dan field formulir ikut diputar agar tetap menempel pada isinya.
  Rincian audit: `docs/audit-deskew-2026-11-24.md`.
- **Protect PDF** memakai Standard Security Handler (V=4 / R=4, AES-128),
  termasuk nilai `/O` dan `/U` sesuai ISO 32000-1 §7.6.3, plus bit izin
  (cetak / ubah / salin / anotasi). Hasilnya **dapat dibuka reader lain**
  (diverifikasi dengan pypdf) dan **ditolak** bila password salah.
- **Unlock PDF** memakai dekriptor sendiri (`tool-decrypt.js`): membaca
  Standard Security Handler **R2–R6** (RC4-40/128, AES-128, AES-256 R5/R6),
  termasuk object stream dan xref stream, lalu menulis ulang PDF **tanpa
  `/Encrypt`**. Teks & vektor tetap utuh (tidak dirasterisasi), dan
  password sowohl pengguna maupun pemilik diterima.
- **Redact PDF** merender ulang halaman sehingga teks yang disensor benar-benar
  hilang dari isi PDF, bukan sekadar ditutup.
- **Sign PDF** punya tiga sumber tanda tangan: menulis tangan di kanvas,
  mengimpor **foto** tanda tangan (latar putih dipangkas otomatis), atau
  mengimpor **QR code** (dipakai apa adanya supaya tetap bisa dipindai).
  Panelnya menampilkan **pratinjau** halaman tujuan lengkap dengan kotak
  posisi tanda tangan, dan pratinjau itu mengikuti perubahan posisi/ukuran
  secara langsung. Format PNG, JPEG, dan WebP diterima; berkas korup
  (CRC PNG tidak cocok, PNG terpotong, JPEG tanpa frame) ditolak dengan
  pesan yang jelas, bukan membuat halaman beku.
- **OCR** memakai mesin Tesseract yang ikut disertakan di `vendor/`
  (`TextDetector` bawaan browser juga dipakai bila tersedia).
- **Terjemah PDF** punya **tiga mesin**:
  1. **Mesin AI daring** — server terjemahan (OpenAI-compatible, MyMemory,
     LibreTranslate, atau server sendiri). Konfigurasi mesin diambil dari
     **manifest di server** (`ai/translate-engine.json`), jadi begitu model,
     prompt, atau endpoint diperbarui di server, aplikasi ini **ikut
     memakainya tanpa perlu pembaruan aplikasi**. Menerjemahkan per
     **kalimat lengkap** (bukan per baris) dan mengirim beberapa baris
     berurutan sekaligus supaya model membaca konteks — hasilnya jauh lebih
     akurat. Ada glosarium istilah, kunci API sendiri, dan tombol
     "Perbarui dari server".
  2. **Mesin bawaan peramban** (`Translator`, Chrome 138+ dengan model
     on-device). Dipakai otomatis kalau model bahasa **sudah ada** di
     perangkat; kalau belum, aplikasi tidak memaksa unduhan ±40 MB.
  3. **Mesin offline bawaan aplikasi** — mesin Neural Machine Translation
     Bergamot (WASM) + model **Indonesia ⇄ Inggris** yang ikut disertakan
     di `vendor/bergamot/`. Jalan **sepenuhnya tanpa internet**, tanpa
     server, tanpa mengunggah berkas.

  Rantai mesin: **AI daring → bawaan peramban → offline**. Kalau server AI
  sedang error, aplikasi otomatis turun ke mesin berikutnya dan
  memberi tahu pengguna. Teks hanya dikirim ke server kalau izin
  "Izinkan kirim teks ke server AI daring" dinyalakan — dimatikan, semua
  tetap jalan di perangkat.

  Hasilnya bukan cuma Markdown: alat ini juga menghasilkan **PDF
  terjemahan** (halaman asli jadi latar, teks asli ditutup, teks
  terjemahan ditulis di tempat yang sama) plus **lapisan teks tak
  terlihat**, jadi hasil terjemahan tetap bisa dicari & disalin.

  Rincian audit: `docs/audit-terjemah-2026-11-24.md` dan
  `docs/audit-terjemah-ai-2026-11-26.md`.
- **HTML to PDF** memakai dialog cetak browser, jadi hasilnya perlu disimpan
  manual dari dialog tersebut.

## Struktur

```
pemisah-pdf/
├── index.html
├── style.css
├── ai/
│   └── translate-engine.json (manifest mesin terjemahan AI daring —
│                              boleh diperbarui di server tanpa rilis
│                              aplikasi baru)
├── app.js            (antarmuka, tab, pemisahan, penggabungan)
├── compressor.js     (mesin kompresi: struktur, analisis DPI, gambar)
├── tool-core.js      (registry alat + helper bersama)
├── tool-pdf.js       (alat PDF native: putar, nomor, watermark, potong, edit,
│                      formulir, rapikan, PDF/A, susun)
├── tool-convert.js   (konversi gambar/Office/HTML/PDF)
├── tool-crypto.js    (MD5, RC4, AES-128-CBC + Standard Security Handler)
├── tool-decrypt.js   (dekriptor PDF mandiri: R2-R6, object/xref stream)
├── tool-smart.js     (kunci, lindungi, tanda tangan, redaksi, banding,
│                      Markdown, ringkas, terjemah, OCR)
├── tool-translate.js (mesin terjemahan: bawaan peramban + offline WASM)
├── tool-translate-ai.js (mesin terjemahan AI daring + manifest server)
├── tool-ui.js        (launcher 7 kategori + workspace alat generik)
└── vendor/
    ├── pdf-lib.min.js       (menulis, memecah, menggabung, menyimpan ulang PDF)
    ├── pdf.min.js           (pdf.js — pratinjau, rasterisasi, dekripsi)
    ├── pdf.worker.min.js
    ├── jszip.min.js         (pembuatan ZIP)
    ├── tesseract/           (mesin OCR offline + data bahasa)
    └── bergamot/            (mesin terjemahan offline WASM + model
                              Indonesia ⇄ Inggris)
```

Folder `vendor/` wajib ada di samping `index.html`. Tidak perlu internet.

## Deploy (GitHub Pages)

GitHub Pages memaksa `Cache-Control: max-age=600` dan tidak bisa diubah dari
repo, jadi peramban bisa menahan `style.css` versi lama upto 10 menit. Agar
perubahan tema/CSS langsung terlihat, aset di-`index.html` memakai alamat
ber-versi:

```html
<link rel="stylesheet" href="style.css?v=20261123b" />
<script src="app.js?v=20261123b"></script>
```

**Setiap kali `style.css` atau skrip aplikasi berubah, naikkan versinya:**

1. `index.html` → `window.PDF_BUILD = "20261123b"` dan semua `?v=`.
2. `style.css` → `--css-build: 20261123b;` di dalam `:root`.

Kedua nilai **wajib sama**. Selain memaksa peramban mengambil aset terbaru,
`index.html` punya penjaga cache: bila stylesheet yang termuat ternyata versi
lama (`--css-build` tidak cocok), stylesheet dimuat ulang dengan alamat baru
dan pengguna diberi tahu lewat toast — tanpa perlu hard refresh.
