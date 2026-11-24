# Audit fitur "Pratinjau Urutan Halaman" (menu Gabung PDF)

Tanggal: 2026-11-24
Alat yang mendapat fitur: **Gabung PDF** (`#tab-merge`)
Build aset: `20261124d`

## 1. Ringkasan

Menu Gabung PDF sekarang punya **pratinjau halaman** yang menampilkan *setiap halaman*
yang akan masuk ke PDF hasil — sebagai kartu ber-thumbnail — dan memungkinkan pengguna
mengatur urutan halaman sebelum menggabungkan.

Tiga mode urutan (chip di kanan atas panel pratinjau):

| Mode | Nilai internal | Arti |
| --- | --- | --- |
| **Sesuai file** | `asis` | Urutan halaman = urutan file, halaman berurutan di dalam tiap file. |
| **Dibalik** | `balik` | Seluruh halaman dibalik: halaman terakhir dokumen menjadi halaman pertama. |
| **Kustom** | `kustom` | Susunan manual. Diaktifkan otomatis begitu pengguna menggeser kartu atau menekan tombol panah. |

Kontrol interaktif per kartu halaman:

- **Seret & lepas** (`draggable`) untuk memindahkan halaman ke posisi mana pun.
- **Tombol `←` / `→`** untuk menggeser halaman satu posisi (sudah otomatis `disabled` di ujung).
- **Nomor urut** (badge biru) dan **asal halaman** (`nama.pdf · hal. N`) pada tiap kartu.

### Yang paling penting: pratinjau benar-benar memengaruhi hasil

Urutan halaman pada pratinjau **bukan tampilan saja**. `mergeBuildBytes()` memakai
`merge.order` yang sama persis dengan yang dirender di pratinjau:

```js
const urutan = Array.isArray(order) && order.length
  ? order
  : files.flatMap((f) => Array.from({ length: f.pageCount }, (_, p) => ({ uid: f.uid, page: p })));
```

Tiap entri `order` = `{ uid, page }`. Halaman disalin per-berkas (satu kali per berkas),
lalu ditambahkan ke dokumen hasil **sesuai urutan akhir**. Perkiraan ukuran (`mergeEst`)
juga memakai urutan yang sama, jadi angka di footer tidak lagi "basi".

### State baru di `app.js`

```js
const merge = {
  files: [],        // {uid, name, bytes, doc, pageCount, ...}
  results: [],
  busy: false,
  order: [],        // [{uid, page}] — urutan HALAMAN hasil gabung
  orderMode: "asis" // "asis" | "balik" | "kustom"
};
```

Fungsi pendukung:

| Fungsi | Peran |
| --- | --- |
| `mergeBaseOrder()` | Urutan mentah: file berurutan × halaman berurutan. |
| `mergeSyncOrder()` | Menyelaraskan `merge.order` dengan daftar file: mode `asis`/`balik` dibangun ulang; mode `kustom` mempertahankan susunan pengguna dan menambahkan halaman baru di akhir. |
| `mergeMovePage(index, delta)` | Geser satu halaman satu posisi (tombol panah). |
| `mergeMovePageTo(from, to)` | Pindahkan satu halaman ke posisi baru (seret & lepas). |
| `mergeSetOrderMode(mode)` | Ganti mode urutan. |
| `mergeRenderPreview()` | Render ulang seluruh panel pratinjau. |
| `mergePageThumb(el, f, pageNo)` | Render thumbnail satu halaman (pdf.js → canvas → JPEG blob). |

Thumbnail dimuat **lazily** lewat `IntersectionObserver` (`rootMargin: 200px`), jadi
membuka 90 halaman tidak sekaligus merender 90 thumbnail.

## 2. Harness

```bash
node tools/mkfixtures-merge.mjs     # fixtures/merge/{alpha,beta,gamma}.pdf
node tools/audit-merge-preview.mjs   # audit Chromium (44 pemeriksaan)
```

Fixture (`tools/mkfixtures-merge.mjs`):

| Berkas | Isi |
| --- | --- |
| `fixtures/merge/alpha.pdf` | 3 halaman, tiap halaman bertanda `ALFA n` |
| `fixtures/merge/beta.pdf` | 4 halaman, tiap halaman bertanda `BETA n` |
| `fixtures/merge/gamma.pdf` | 1 halaman, bertanda `GAMMA 1` |

Tiap halaman juga memakai **warna pita & kotak berbeda**, jadi urutan di thumbnail
serta di PDF hasil bisa dibaca langsung oleh mata maupun mesin.

Harness membaca **PDF hasil yang benar-benar diunduh** (bukan DOM pratinjau) dan
mengekstrak teks tiap halaman dengan pdf.js, lalu membandingkannya dengan urutan
yang diharapkan.

## 3. Hasil audit

**44 lulus, 0 gagal** (`docs/audit-merge-preview-hasil.json`).

Cakupan pemeriksaan:

1. Tanpa berkas → panel pratinjau tersembunyi.
2. Setelah berkas dimuat → panel terlihat, jumlah kartu = jumlah halaman, nomor 1..N,
   tiap kartu menyebut asal berkas + nomor halaman.
3. Thumbnail benar-benar dirender (bukan kotak kosong): `naturalWidth/naturalHeight > 20`
   **dan** ukuran tampil > 20px.
4. Tiap kartu bisa diseret (`draggable`) dan punya dua tombol panah.
5. Ringkasan pratinjau menyebut jumlah halaman dan mode aktif.
6. **Mode "Sesuai file"** → PDF hasil: `ALFA 1, ALFA 2, ALFA 3, BETA 1, BETA 2, BETA 3, BETA 4`.
7. **Mode "Dibalik"** → PDF hasil: `BETA 4, BETA 3, BETA 2, BETA 1, ALFA 3, ALFA 2, ALFA 1`.
8. **Mode "Kustom"** (tombol panah `→` pada kartu pertama) → PDF hasil:
   `ALFA 2, ALFA 1, ALFA 3, BETA 1, BETA 2, BETA 3, BETA 4`.
9. **Seret & lepas** (kartu pertama → posisi terakhir) → PDF hasil:
   `ALFA 2, ALFA 3, BETA 1, BETA 2, BETA 3, BETA 4, ALFA 1`.
10. Kembali ke "Sesuai file" mengembalikan urutan asal.
11. Tiga berkas → 8 kartu; mode "Dibalik" menghasilkan
    `GAMMA 1, BETA 4, BETA 3, BETA 2, BETA 1, ALFA 3, ALFA 2, ALFA 1`.
12. Kasus tepi satu berkas → pratinjau tetap tampil (1 kartu), tombol gabung tetap nonaktif.
13. Kasus tepi hapus satu berkas → pratinjau hanya berisi halaman berkas yang tersisa,
    berkas yang ditambahkan menyusul ikut masuk.
14. Performa: ganti mode < 3 detik (terukur ±0,3–0,5 detik), semua kartu tetap tampil.
15. Screenshot bukti ketiga mode.
16. **Tampilan mobile 360px**: pratinjau tidak meluber horizontal, chip mode tetap satu
    baris, grid tetap minimal 2 kolom.
17. Tidak ada error JavaScript / console error selama audit.

### Screenshot bukti

| Berkas | Isi |
| --- | --- |
| `docs/audit-merge-preview-2026-11-24/pratinjau-asis.png` | Mode "Sesuai file" |
| `docs/audit-merge-preview-2026-11-24/pratinjau-balik.png` | Mode "Dibalik" |
| `docs/audit-merge-preview-2026-11-24/pratinjau-kustom.png` | Mode "Kustom" (susunan manual hasil seret) |

## 4. Regresi

Semua audit regresi dijalankan ulang pada build yang sama:

| Audit | Hasil | Catatan |
| --- | --- | --- |
| `tools/audit-pagerange.mjs` | **106 / 0** | Slider cakupan halaman tidak disturbed. |
| `tools/audit-deskew.mjs` | **56 / 0** | Rapi PDF aman. |
| `tools/audit-ocr.mjs` | **44 / 0** | OCR PDF aman. |
| `tools/verify-produksi.mjs` | **73 / 1** | Satu-satunya kegagalan `Toolbar editor ≤ 3 baris di 360px baris=4` **sudah ada pada baseline** sebelum fitur ini, bukan regresi baru. |

## 5. Catatan implementasi

- **Tombol "Balik urutan"** pada daftar file telah diberi nama **"Balik urutan file"**
  (dengan `title` penjelasan) supaya tidak tertukar dengan mode "Dibalik" di pratinjau.
  Tombol itu hanya membalik **daftar file**; pembalikan **halaman** ada di panel pratinjau.
- Panel pratinjau memakai `role="list"` / `role="listitem"`, ringkasan memakai
  `role="status" aria-live="polite"`, dan tiap tombol panah punya `aria-label`
  ("Geser halaman ini ke depan" / "…ke belakang").
- Thumbnail dilepas (`URL.revokeObjectURL`) saat grid dirender ulang lewat `releaseThumbs()`.
- Batas `MERGE_EST_MAX_BYTES` tidak berubah; pemanggilan `mergeBuildBytes()` kini
  menerima argumen kedua (`order`) dan pemanggil lama yang hanya mengirim `files`
  tetap aman karena argumen itu opsional.
