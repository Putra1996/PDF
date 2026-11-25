# Audit sentuhan — "Tanda tangani PDF" belum bisa digeser dengan jari

Tanggal: 2026-11-25
Alat: **Tanda tangani PDF** (`sign`)
Harness: `tools/audit-sign-touch.mjs` (26 pemeriksaan, 0 gagal)

## 1. Keluhan

> "Fitur tanda tangani untuk tanda tangan belum bisa digeser dengan jari harus
> manual dengan input angka di menu pilihan jadi memperlama proses tanda tangan."

Jadi dua hal:

1. posisi tanda tangan **tidak bisa digeser dengan jari**;
2. satu-satunya cara menentukan posisi adalah **mengetik angka** di kolom
   X / Y / Lebar — lambat, terutama di ponsel.

## 2. Temuan audit

Fitur geser **sudah ada** di kode (commit `fc4dc9a`, PR #27) dan secara
logika bekerja. Tapi audit sentuhan menunjukkan **area tangkapnya terlalu
kecil untuk jempol**, sehingga practically tidak bisa dipegang:

### a. Target sentuh hanya 27,7 px tinggi

Di layar ponsel 390 px, kotak tanda tangan (50 mm × 17,19 mm pada A4)
berukuran:

| | Lebar | **Tinggi** |
|---|---|---|
| Kotak terlihat | 80,5 px | **27,7 px** |
| Standar sentuh (Apple HIG) | 44 px | **44 px** |

Jempol orang **± 40 px** lebar. Area setipis 27,7 px hampir mustahil
ditekan tepat — dan kalau meleset sedikit, **tidak ada yang terjadi**, lalu
pengguna menyimpulkan "fiturnya tidak jalan" dan kembali mengetik angka.

### b. Tidak ada area luang ("grace zone")

Sentuhan yang meleset 12 px dari kotak **tidak tertangkap sama sekali**
(Δx = 0,0 mm). Tidak ada toleransi.

### c. `-webkit-touch-callout` tidak dimatikan

Tekan-tahan di iOS memunculkan menu konteks (Salin/Pilih) yang bisa
mengganggu gerakan.

### d. Belum ada cara mengubah lebar tanpa mengetik

Kolom "Lebar" hanya bisa diisi angka.

### e. Pointermove hanyadidengarkan di elemen pegangan

Kalau `setPointerCapture` gagal (sebagian peramban seluler), drag berhenti
begitu jari keluar dari kotak.

## 3. Perbaikan

### a. Area tangkap diperbesar — `style.css`

Kotak yang terlihat tetap menandai posisi sebenarnya, tapi area tangkapnya
diperbesar **15 px per sisi** lewat pseudo-element:

```css
.sign-drag::before{
  content:"";position:absolute;inset:-15px;border-radius:10px;
}
```

Pseudo-element ikut menerima sentuhan (event-nya diarahkan ke elemen
induknya), jadi area tangkap nyata jadi:

| | Sebelum | **Sesudah** |
|---|---|---|
| Layar 390 px | 80 × 28 px | **94 × 55 px** |
| Layar 320 px | 64 × 22 px | **78 × 49 px** |

Keduanya jauh di atas ambang 44 px.

### b. Pegangan ubah-lebar (pojok kanan bawah) — baru

Titik bulat di pojok kanan bawah kotak, untuk **mengubah lebar tanpa
mengetik**:

```html
<div id="signResize" class="sign-resize" role="button" tabindex="0"
     aria-label="Sudut kanan bawah — tekan dan geser untuk mengubah lebar tanda tangan"
     aria-describedby="signPreviewHint"
     aria-keyshortcuts="ArrowLeft ArrowRight"></div>
```

Area tangkapnya **62 × 62 px** (`.sign-resize::before { inset:-11px }`).
Rasio tinggi/lebar tanda tangan tetap terjaga; posisi ikut dijepit
supaya tidak keluar halaman.

### c. Pointer handling yang lebih kuat — `tool-ui.js`

- `pointermove` / `pointerup` / `pointercancel` **juga didengarkan di
  `window`** → drag tetap jalan walau `setPointerCapture` gagal atau jari
  keluar dari kotak.
- `drag` dan `resize` memakai satu mesin seret (`mulaiSeret` /
  `jalanSeret` / `selesaiSeret`) dengan mode `"geser"` atau `"lebar"`.
- `-webkit-touch-callout:none`, `-webkit-tap-highlight-color:transparent`,
  `user-select:none` pada kedua pegangan.
- Label + `aria-keyshortcuts` untuk keduanya; panah kiri/kanan mengubah
  lebar 1 mm (`Shift` 5 mm).

### d. Petunjuk yang jelas

> "Geser kotak tanda tangan dengan jari untuk memindahkan; seret titik bulat
> di pojok kanan bawah untuk mengubah lebar."

## 4. Hasil audit

`node tools/setup-harness.mjs && node tools/audit-sign-touch.mjs`
→ **26 lulus / 0 gagal**

| Kelompok | Pemeriksaan | Hasil |
|---|---|---|
| Ukuran | area tangkap ≥ 44 px (390 px & 320 px), pegangan ubah-lebar ≥ 44 px | 4/4 |
| Ketelitian sentuhan | `touch-action:none`, `-webkit-touch-callout:none`, `user-select:none` | 3/3 |
| Geser dengan jari | tanda tangan bergerak (Δx 43,5 mm), halaman tidak ter-scroll, kolom ikut berubah | 3/3 |
| Toleransi | jari meleset 12 px tetap tertangkap (Δx 37,3 mm) | 1/1 |
| Ketidakrusakan | tap tanpa geser tidak menggeser, pratinjau tetap utuh | 2/2 |
| Ubah lebar | menyeret sudut kanan bawah: 50 → 84,3 mm, rasio terjaga, kolom ikut berubah, tidak keluar halaman | 4/4 |
| End-to-end | PDF dibuat, tanda tangan ada, **tinta PDF = tinta pratinjau** (Δ 0,1 / 0,3 mm) | 3/3 |
| Layar 320 px | pegangan terlihat, area tangkap ≥ 44 px, geser jalan | 3/3 |
| Error JavaScript | sepanjang alur | 0 |

### Harness menangkap bug

Dijalankan terhadap kode **sebelum** perbaikan → **8 gagal**:

```
✗ Pegangan ubah-lebar terlihat
✗ Area tangkap pegangan ≥ 44 px — 80 × 28 px
✗ Area tangkap pegangan ubah-lebar ≥ 44 px — 0 × 0 px
✗ Penggilan konteks sentuhan dimatikan — ada
✗ Jari yang meleset ~12 px dari kotak tetap tertangkap — Δx=0.0 mm
✗ Pegangan ubah-lebar tersedia
✗ Layar 320px: area tangkap tetap ≥ 44 px — 64 × 22 px
✗ Layar 320px: area tangkap ubah-lebar tetap ≥ 44 px — 0 × 0 px
```

Terhadap kode sesudah perbaikan → **26 lulus / 0 gagal**.

## 5. Regresi

| Harness | Pemeriksaan | Gagal |
|---|---|---|
| `tools/audit-sign.mjs` | 65 | 0 |
| `tools/audit-sign-touch.mjs` | 26 | 0 |
| `tools/audit-translate.mjs` | 30 | 1 — "Mesin bawaan peramban terdeteksi" (versi Chromium di lingkungan uji) |
| `tools/audit-pagerange.mjs` | 106 | 0 |
| `tools/audit-merge-preview.mjs` | 44 | 0 |
| `tools/audit-deskew.mjs` | 56 | 0 |
| `tools/audit-ocr.mjs` | 44 | 0 |
| `tools/audit-preview-perf.mjs` | 39 | 0 |
| `tools/verify-produksi.mjs` | 73 | 1 — cacat layout toolbar lama |

Kedua kegagalan tersebut sudah ada di commit baseline `19fc870`.

## 6. Catatan lingkungan

- `node_modules/` dan `fixtures/` ikut `.gitignore`, jadi hilang setiap kali
  repo di-reset. `node tools/setup-harness.mjs` memasang ulang dependensi
  **dan** membuat ulang seluruh fixture.
- Headless shell `@sparticuz/chromium` **mati** kalau dibuat konteks kedua
  dengan `isMobile:true`. Batas lingkungan, bukan bug aplikasi — harness
  karena itu memakai satu konteks dan mengganti ukuran viewport.
- Chromium **membuang** `-webkit-touch-callout` dari CSSOM (properti itu
  khusus iOS Safari), jadi harness memeriksa sumber CSS aslinya, bukan
  hasil parsing peramban.

## 7. Berkas yang berubah

| Berkas | Perubahan |
|---|---|
| `style.css` | `.sign-drag::before` (area tangkap +15 px), `.sign-grip`, `.sign-resize` + `::before`, `-webkit-touch-callout`, `-webkit-tap-highlight-color` |
| `tool-ui.js` | `#signResize` (pegangan ubah-lebar), `ubahLebar()`, mesin seret bersama, listener `window`, `dispose` melepas listener |
| `tools/audit-sign-touch.mjs` | harness audit sentuhan (baru, 26 pemeriksaan) |
| `tools/setup-harness.mjs` | pasang dependensi + buat ulang fixture (baru) |
| `docs/audit-ttd-2026-11-24/ttd-sentuh-ui.png` | bukti tampilan layar ponsel |
| `docs/audit-ttd-2026-11-24/ttd-sentuh-pegangan.png` | bukti pegangan + titik ubah-lebar |
