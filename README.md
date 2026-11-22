# Pemisah PDF

Aplikasi web untuk **memecah, mengekstrak, menggabungkan, dan mengompres** PDF. **Semua proses berjalan di browser** — file tidak pernah diunggah ke server mana pun.

> **Dikarya oleh Putra.** Kreditnya tercantum di antarmuka web — di header, di footer, dan di `<title>` halaman. File PDF yang dihasilkan **tidak** memuat kredit/stempel apa pun di dalamnya; metadata Producer/Creator hanya berisi nama aplikasi (`Pemisah PDF`).

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

## Cara pakai

1. Buka `index.html` di browser (Chrome, Edge, Firefox, Safari modern).
2. Pilih tab: **Pemisah halaman**, **Gabung PDF**, atau **Kompres PDF**.
3. Tarik file PDF ke area unggah, atau klik tombol pilih file. Di tab pemisah ada tombol **Coba contoh PDF**.
4. Proses, lalu file hasil otomatis terunduh dan tetap tersedia di kartu **Hasil** untuk diunduh ulang.

> Catatan: di pratinjau dalam aplikasi, unduhan bisa diblokir karena berjalan di iframe. Kalau itu terjadi, buka `index.html` langsung di tab browser.

## Tab 1 — Pemisah halaman

| Mode | Keluaran |
|---|---|
| Ekstrak halaman terpilih | 1 PDF baru berisi halaman terpilih (bisa gabungan beberapa file) |
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

## Tab 3 — Kompres PDF

| Tingkat | Cara kerja | Cocok untuk |
|---|---|---|
| **Ringan** (tanpa raster) | Buang objek yatim, optimalkan struktur, bersihkan metadata. Teks/font/gambar 100% utuh. | PDF berisi teks penting; penurunan ukuran bisa kecil |
| **Optimal** (disarankan) | Ringan + hanya gambar raster yang melebihi **200 DPI** diperkecil ke 200 DPI (diperkecil bertahap agar tetap tajam). Teks & font tetap vektor. | Mayoritas PDF — hasil tajam **dan** jauh lebih kecil |
| **Seimbang** | Raster 150 DPI, JPEG 78% (kualitas dinaikkan otomatis untuk halaman berteks). | PDF lama hasil pindai |
| **Kuat** | Raster 110 DPI, JPEG 62%. | Ukuran paling kecil, detail menurun |
| **Kustom** | Pilih strategi (Optimal / Ringan / Raster), DPI 72–300, kualitas 30–95%, grayscale. | Kontrol penuh |

Pilihan tambahan: **grayscale**, **bersihkan metadata**, dan **jangan pernah memperbesar file**.
Setelah selesai muncul ringkasan *% lebih kecil* (mis. `64% lebih kecil — 393 KB → 143 KB`), detail per file, dan tombol unduh (ZIP bila lebih dari satu file).

### Cara kerja kompresi (detail teknis)

1. **Struktur** — objek PDF yang tidak lagi dirujuk (orphan) dibuang; metadata XMP/title/author dibersihkan bila diminta; objek ditulis ulang memakai object stream.
2. **Analisis DPI** — content stream tiap halaman diparse (tokenizer sendiri, termasuk Form XObject) untuk mengetahui **ukuran penempatan** tiap gambar dalam poin. Dari situ dihitung DPI efektifnya. Gambar yang dipakai di beberapa halaman memakai penempatan **terbesar** di seluruh dokumen, jadi tidak diperkecil berulang.
3. **Perkecil gambar** — gambar yang DPI efektifnya di atas target diperkecil **bertahap** (setengah demi setengah, `imageSmoothingQuality: high`) lalu dikodekan ulang sebagai JPEG. Format sumber yang didukung: JPEG (DCTDecode) dan data mentah (Flate/ASCII) dengan ruang warna **DeviceRGB, DeviceGray, DeviceCMYK, Indexed**, serta 1/2/4/8 bit per komponen. Gambar dengan alpha (`SMask`), stencil mask (`ImageMask`), atau JPEG yang lebih kecil dari aslinya **tidak disentuh**.
4. **Anti-membengkak** — hasil hanya dipakai bila benar-benar lebih kecil; jika tidak, gambar asli dipertahankan. Bila seluruh berkas masih lebih besar dari aslinya, berkas asli dikembalikan. Mode raster juga mencoba ulang dengan kualitas/DPI lebih rendah sebelum menyerah.

## Struktur

```
pemisah-pdf/
├── index.html
├── style.css
├── app.js            (antarmuka, tab, pemisahan, penggabungan)
├── compressor.js     (mesin kompresi: struktur, analisis DPI, gambar)
└── vendor/
    ├── pdf-lib.min.js       (menulis, memecah, menggabung, menyimpan ulang PDF)
    ├── pdf.min.js           (pdf.js — pratinjau, rasterisasi, dekripsi)
    ├── pdf.worker.min.js
    └── jszip.min.js         (pembuatan ZIP)
```

Folder `vendor/` wajib ada di samping `index.html`. Tidak perlu internet.
