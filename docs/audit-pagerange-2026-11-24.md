# Audit fitur "Rentang Halaman" (slider dua-thumb)

Tanggal: 2026-11-24
Alat yang mendapat fitur: Rapi PDF, Putar PDF, Potong PDF, Tambah watermark, Tambah nomor halaman,
OCR PDF, Redaksi PDF, PDF ke JPG.

## 1. Ringkasan

Unggul satu widget **rentang halaman** (`pagerange`) ke delapan alat. Widget punya:

- Empat mode: **Semua**, **Ganjil**, **Genap**, **Rentang**.
- **Slider dua-thumb** (tarik dua pegangan) + **kotak angka** (Isi persis halaman awal/akhir).
- Batas slider mengikuti jumlah halaman dokumen (deteksi otomatis setelah PDF dimuat).
- Ringkasan langsung: `Halaman 2–4 (3 halaman dari 7)`.

Semantik yang dipakai (helper bersama di `window.PDFToolsCore`):

| Helper | Arti |
| --- | --- |
| `normSpesifikasiHalaman(spec, total)` | Normalisasi `{mode, dari, sampai}`. `sampai: 0` = sampai halaman terakhir berkas itu. Nilai **tidak dijepit** ke jumlah halaman. |
| `halamanDipilih(spec, n, total)` | Apakah halaman 1-based `n` termasuk pilihan. |
| `halamanTerpilih(spec, total)` | Daftar nomor halaman terpilih (1-based, urut). |
| `ringkasHalaman(spec, total)` | Ringkasan singkat untuk UI; menandai rentang di luar jangkauan. |
| `pastikanHalamanTerpilih(spec, total, nama)` | Melempar galat deskriptif bila rentang tidak menghasilkan satu pun halaman. |
| `pesanRentangKosong(spec, total, nama)` | Pesan galat yang ramah dan bisa dibaca pengguna. |
| `catatanCakupan(n, total, kata)` | Catatan hasil: `3 dari 7 halaman diputar`. |

### Aturan penting

1. **Nomor halaman relatif per-berkas.** Rentang 2–4 pada berkas kedua berarti halaman 2–4 di
   berkas kedua — bukan halaman 2–4 dokumen gabungan.
2. **Nomor halaman (tool "Tambah nomor halaman") memakai nomor absolut dokumen asli.** Halaman
   ke-4 pada berkas mana pun tetap diberi label `4`.
3. **Halaman di luar rentang tidak boleh diproses atau berubah.** OCR tidak menulis apa pun di
   halaman luar rentang; Redaksi menyalin halaman luar rentang apa adanya (tanpa render ulang);
   Rapi/Putar/Potong/Watermark/NomorHalaman hanya menyentuh halaman terpilih.
4. **Rentang di luar jangkauan menghasilkan keluaran kosong + pesan jelas**, bukan dipaksa menjadi
   rentang lain. Contoh pesan:
   `Rentang halaman 8–12 tidak ada di "empat-halaman.pdf" — dokumen ini hanya punya 4 halaman.`
5. **Nilai yang diketik pengguna tidak pernah dijepit.** Kotak angka tetap menampilkan `8`–`12`
   pada dokumen 7 halaman, dan ringkasan menandai `di luar jangkauan`.

## 2. Harness

```bash
node tools/mkfixtures-pagerange.mjs   # fixtures/pagerange/*.pdf
node tools/audit-pagerange.mjs         # audit Chromium
```

Fixture:

| Berkas | Isi |
| --- | --- |
| `fixtures/pagerange/empat-halaman.pdf` | 4 halaman, tiap halaman teks & kotak berbeda |
| `fixtures/pagerange/tujuh-halaman.pdf` | 7 halaman, tiap halaman teks berbeda |
| `fixtures/pagerange/rusak.pdf` | Bukan PDF (untuk uji pesan galat) |

Harness menjalankan **alat sungguhan** di Chromium (bukan simulasi): klik kartu alat, isi widget,
muat berkas, klik "Proses", lalu analisis PDF hasilnya dengan pdf.js (sidik jari piksel per
halaman + rotasi + posisi teks).

## 3. Hasil

Audit terakhir: **72 lulus / 0 gagal** (`docs/audit-pagerange-hasil.json`).

Cakupan pemeriksaan:

- Widget muncul di 8 alat yang relevan, dan **tidak** muncul di 4 alat yang tidak relevan.
- Slider membaca jumlah halaman dokumen dengan tepat (7 → `max=7`), dan aktif setelah PDF dimuat.
- Mode Ganjil / Genap hanya menyentuh halaman sesuai paritasnya.
- Rentang 2–4 pada Putar PDF: hanya halaman 2, 3, 4 berputar 90°.
- Rapi PDF rentang 2–3: hanya 2 halaman yang dipangkas marginnya; halaman 1, 4, 5, 6, 7 identik.
- Nomor halaman rentang 2–3: label `2` dan `3` muncul di kaki halaman 2 dan 3 saja.
- Watermark rentang 2–2: hanya halaman 2 yang berubah; halaman 1, 3, 4 identik.
- PDF ke JPG rentang 2–3: ZIP berisi `…-002.png` dan `…-003.png` saja.
- Potong PDF rentang 2–2: hanya halaman 2 yang lebarnya berubah.
- **Multi-berkas**: berkas 4 halaman & 7 halaman dengan rentang 2–4 → keduanya diputar pada
  halaman 2, 3, 4 (bukan pada dokumen gabungan).
- **Rentang di luar jangkauan** (8–12 pada dokumen 4 halaman): tidak menghasilkan berkas, dan
  muncul pesan yang jelas.
- **Berkas rusak**: ditolak dengan pesan yang jelas, bukan diam-diam.
- **OCR** rentang 2–3: halaman 1 dan 4 tetap identik; catatan `2 dari 4 halaman di-OCR`.
- **Redaksi** rentang 2–2: hanya halaman 2 yang dirender ulang; halaman 1, 3, 4 identik.
- **Panel Redaksi** ("Cari kata") menampilkan ringkasan cakupan
  `2 dari 8 kemunculan akan ditutup (Halaman 2). 6 kemunculan di luar rentang dibiarkan utuh.`
  dan hanya menampilkan baris halaman terpilih.
- Performa: rentang 2–6 pada 7 halaman selesai di **0,5 detik**.
- Tidak ada error JavaScript.

Audit lain (regresi, dijalankan pada kode yang sama):

| Audit | Hasil |
| --- | --- |
| `tools/audit-deskew.mjs` (Rapi PDF) | 56 lulus / 0 gagal |
| `tools/audit-ocr.mjs` (OCR) | 44 lulus / 0 gagal |
| `tools/verify-produksi.mjs` (seluruh aplikasi) | 73 lulus / 1 gagal |

Satu-satunya kegagalan verifikasi produksi adalah "Toolbar editor ≤ 3 baris di 360px" — pemeriksaan
ini **juga gagal pada baseline** (sebelum fitur ini), jadi bukan regresi rentang halaman.

## 4. Catatan implementasi

- `tool-core.js` — helper cakupan halaman + `catatanCakupan` + pesan galat PDF rusak yang ramah.
- `tool-ui.js` — widget (mode, slider dua-thumb, kotak angka, deteksi jumlah halaman).
- `tool-pdf.js` — integrasi pada Rapi PDF, Putar, Potong, Watermark, Nomor Halaman.
- `tool-smart.js` — integrasi pada OCR & Redaksi (halaman luar rentang disalin apa adanya).
- `tool-convert.js` — integrasi pada PDF ke JPG (hanya halaman terpilih yang dirender).
- `style.css` — gaya widget `tool-pr-*`.
