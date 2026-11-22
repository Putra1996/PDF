# Pemisah PDF

Aplikasi web untuk **memecah, mengekstrak, menggabungkan, dan mengompres** PDF. **Semua proses berjalan di browser** — file tidak pernah diunggah ke server mana pun.

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
| Pisah tiap halaman | ZIP, 1 PDF per halaman |
| Pisah tiap N halaman | ZIP, tiap file berisi N halaman |
| Pisah per rentang kustom | ZIP, mis. `1-3, 4-8, 9-12` |
| Pisah per penanda buku | ZIP, tiap bab/daftar isi jadi file sendiri |

Pendukung: multi-file (halaman bisa digabung lintas file, urutan bisa diatur), thumbnail tiap halaman, tombol cepat Semua/Kosong/Balik/Ganjil/Genap, PDF berpassword diminta password-nya lalu dibuka otomatis.

## Tab 2 — Gabung PDF

1. Tambahkan 2 PDF atau lebih (bisa tarik-lepas ke mana saja di halaman).
2. Atur urutan dengan tombol ▲ ▼, **Balik urutan**, atau **seret baris**.
3. Klik **Gabungkan PDF** → semua file disatukan sesuai urutan; tiap baris menampilkan thumbnail halaman pertama.

Hasil gabungan mempertahankan ukuran & rotasi tiap halaman aslinya (tidak dirasterisasi).

## Tab 3 — Kompres PDF

| Tingkat | Cara kerja | Cocok untuk |
|---|---|---|
| **Ringan** (teks utuh) | Optimasi struktur file (object streams), tanpa mengubah isi | PDF berisi teks penting; hasil bisa sama besar |
| **Seimbang** | Rasterisasi 150 DPI, JPEG 70% | Paling umum — biasanya 40–70% lebih kecil |
| **Kuat** | Rasterisasi 110 DPI, JPEG 50% | Ukuran paling kecil, detail menurun |
| **Kustom** | Slider 72–300 DPI + kualitas 30–95%, opsi grayscale | Kontrol penuh |

Cara pakai: tambahkan PDF → pilih tingkat → **Kompres sekarang**. Setelah selesai muncul:
- Ringkasan **% lebih kecil** dengan bar progres (mis. `86% lebih kecil — 12,6 MB → 1,8 MB`),
- per file: `ukuran awal → hasil (−%)` + tombol unduh,
- unduh semua sebagai ZIP bila lebih dari satu file.

Catatan: mode rasterisasi mengubah halaman menjadi gambar, jadi teks tidak lagi bisa dicari/di-copy dan hyperlink hilang. Mode **Ringan** mempertahankan teks utuh.

## Struktur

```
pemisah-pdf/
├── index.html
├── style.css
├── app.js
└── vendor/
    ├── pdf-lib.min.js       (menulis, memecah, menggabung, menyimpan ulang PDF)
    ├── pdf.min.js           (pdf.js — pratinjau, rasterisasi, dekripsi)
    ├── pdf.worker.min.js
    └── jszip.min.js         (pembuatan ZIP)
```

Folder `vendor/` wajib ada di samping `index.html`. Tidak perlu internet.
