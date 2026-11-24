# Audit & Perbaikan Fitur Terjemah PDF

**Tanggal:** 24 November 2026
**Alat:** `Terjemah PDF` (kategori Kecerdasan PDF)
**Harness:** `tools/audit-translate.mjs` · `tools/bench-translate.mjs` · `tools/mkfixtures-translate.mjs`
**Hasil audit:** **31 lulus, 0 gagal**

---

## 1. Bug yang dilaporkan

```
Peramban ini belum punya mesin terjemahan bawaan (Chrome 138+ dengan model's
on-device translation). Aplikasi ini berjalan offline, jadi terjemahan butuh
kemampuan itu.
```

Pesan itu muncul untuk **semua** kegagalan, apa pun sebabnya. Setelah
diperiksa, ternyata ada **dua masalah terpisah**:

### 1a. Deteksi kemampuan yang salah

Kode lama hanya memeriksa `!("Translator" in window)` lalu langsung
memanggil `Translator.create()`. Padahal API bawaan Chrome punya
**empat** keadaan yang harus dibedakan:

| Keadaan | Arti | Yang harus dilakukan |
|---|---|---|
| `available` | model bahasa sudah ada di perangkat | langsung pakai |
| `downloadable` | didukung, tapi model **perlu diunduh** | `create()` + `monitor` → unduhan berjalan |
| `downloading` | unduhan sedang berjalan | tunggu / sambung |
| `unavailable` | pasangan bahasa tidak didukung | pakai mesin lain |

Kode lama memanggil `create()` tanpa `availability()` dan tanpa `monitor`.
Saat model harus diunduh, Chrome **tidak pernah menjawab** — permintaannya
 menggantung sampai batas waktu 30 detik, lalu aplikasi menampilkan pesan
"peramban belum punya mesin bawaan". Padahal masalahnya bukan "peramban
tidak mendukung", melainkan "model belum diunduh".

### 1b. Aplikasi tidak punya kemampuan sendiri

Chrome 138+ hanya ada di desktop **dan** punya syarat perangkat keras
(≥16 GB RAM, ≥4 inti, >4 GB VRAM, ≥22 GB disk bebas, jaringan tanpa
meteran untuk unduhan pertama). Firefox dan Safari **tidak** mendukungnya
sama sekali. Aplikasi ini justru 약속 "diproses di browser Anda, tanpa
internet" — jadi mengandalkan kemampuan peramban saja berarti fiturnya
mati di sebagian besar perangkat.

---

## 2. Perbaikan

### 2a. Mesin offline bawaan aplikasi

Folder baru `vendor/bergamot/` berisi:

| Berkas | Ukuran | Isi |
|---|---|---|
| `bergamot-translator-worker.wasm` | 5,0 MB | runtime Neural Machine Translation (Marian, *int8*) |
| `bergamot-translator-worker.js` | 80 KB | glue Emscripten |
| `translator-worker.js` | 17 KB | pembungkus worker |
| `models/id-en/*` | 15,2 MB (gzip) | model Indonesia → Inggris (tipe *tiny*) |
| `models/en-id/*` | 14,6 MB (gzip) | model Inggris → Indonesia (tipe *tiny*) |

Model bahasa adalah model milik Mozilla (MPL-2.0, sama seperti mesinnya).
Berkas di repo **dikompresi gzip** dan dibuka di peramban memakai
`DecompressionStream`, jadi tidak perlu pustaka tambahan dan repo tetap
ramping. Sidik jari SHA-256 model `id→en` dicocokkan dengan pointer
Git LFS resmi Mozilla (lihat `vendor/bergamot/README.md`).

Hasil: **terjemahan benar-benar jalan offline, di peramban apa pun.**

### 2b. Modul `tool-translate.js`

Mesin terjemahan sekarang satu modul tersendiri dengan antarmuka:

```js
PDFTranslate.prepare({from, to, mode, onProgress})  // sinkron
PDFTranslate.create(plan)                           // async → mesin siap
PDFTranslate.offlineStatus()                        // model yang sedang hidup
PDFTranslate.stats                                  // penghitung audit
```

Dua mesin:

- **Mesin bawaan peramban** — `availability()` → `create()` dengan
  `monitor` (progres unduhan) → dipakai bersama untuk semua berkas.
- **Mesin offline** — Bergamot WASM + model yang disertakan.

Pemilihan mesin (mode **Otomatis**, bawaan):

| Keadaan peramban | Pilihan | Alasan |
|---|---|---|
| `available` | mesin bawaan | model sudah ada → paling cepat |
| `downloadable` / `downloading` | **mesin offline** (kalau ada) | tidak memaksa unduhan ±40 MB |
| `unavailable` / peramban tanpa API | **mesin offline** (kalau ada) | tetap jalan |
| tidak ada model offline | mesin bawaan | satu-satunya pilihan |

Mode **Bawaan peramban** dan **Offline** bisa dipilih manual di panel alat.

### 2c. `create()` dipanggil sinkron (user gesture)

Chrome mewajibkan *user activation* saat `create()` perlu mengunduh model.
`prepare()` sengaja dipanggil **sebelum `await` pertama** di dalam
handler klik, supaya gestur klik masih berlaku. Kalau tidak, Chrome
menolak dengan `NotAllowedError` dan fitur berhenti total.

### 2d. Galat diterjemahkan jadi pesan yang bisa ditindaklanjuti

| Galat DOM | Pesan ke pengguna |
|---|---|
| `NotSupportedError` | "Mesin bawaan peramban tidak mendukung pasangan ID→EN. Pilih bahasa lain, atau pilih mesin offline bawaan aplikasi." |
| `NetworkError` | "Paket bahasa gagal diunduh (butuh internet). Pilih mesin offline bawaan aplikasi agar tetap jalan tanpa internet." |
| `NotAllowedError` | "Chrome meminta klik pengguna untuk mengunduh paket bahasa. Klik Proses sekali lagi…" |
| `QuotaExceededError` | "Teks terlalu panjang… terjemahan per bagian yang lebih kecil." |
| `InvalidStateError` | "Mesin bawaan peramban belum siap. Coba lagi sebentar lagi…" |

Pesan lama ("peramban ini belum punya mesin terjemahan bawaan") **hanya**
muncul kalau memang API-nya benar-benar tidak ada.

### 2e. Format keluaran diperbaiki

Kode lama menambah satu elemen kosong ke daftarMarkdown sehingga
hasilnya selalu diawali **dua baris kosong** (`# judul\n\n\n\nIsi`).
Sekarang: `# judul\n\nIsi` — dan pemisah antar halaman tetap `\n\n`.

---

## 3. Why it is fast

Tiga perubahan di sisi aplikasi, semuanya terukur:

1. **Satu mesin untuk semua berkas.** Kode lama membuat `Translator` baru
   **untuk tiap berkas** lalu menutupnya. Setiap `create()` memuat ulang
   model (di Chrome ±8,6 detik menurut pengukuran komunitas). Sekarang
   satu mesin dipakai untuk semua berkas.
2. **Dipecah per baris, bukan per halaman.** Mesin bawaan peramban
   menerjemahkan kalimat per kalimat; mengirim 40 baris sekaligus
   memungkinkan 4 pemanggilan berjalan paralel.
3. **Cache kalimat (LRU 4 000 entri).** Header dan footer yang sama di
   tiap halaman cukup diterjemahkan **sekali**.

### Hasil benchmark

Benchmark memakai dokumen 20 halaman dan membandingkan strategi **LAMA**
(satu string per halaman + mesin baru tiap berkas + tanpa cache) dengan
strategi **BARU** (per baris + satu mesin + cache).

#### Mesin offline (Bergamot WASM sungguhan, diukur langsung)

| Skenario | LAMA | BARU | Perubahan |
|---|---|---|---|
| 20 halaman, 220 baris, **30 baris unik** (khas PDF: header/footer berulang) | 4 587 ms | **269 ms** | **17,0× lebih cepat** |
| 20 halaman, 220 baris, **semua unik** (tanpa bantuan cache) | 4 809 ms | **4 612 ms** | 1,04× (setara, tanpa regresi) |

Baris yang benar-benar diterjemahkan turun dari 220 menjadi 30 — cache
memangkas 86 % pekerjaan pada dokumen dengan isi berulang.

#### Mesin bawaan peramban (disimulasikan: 12 ms/kalimat, 250 ms/pemuatan model)

| Skenario | LAMA | BARU | Perubahan |
|---|---|---|---|
| 3 berkas × 20 halaman × 40 baris | 30 157 ms | **2 895 ms** | **10,4× lebih cepat** |
| Panggilan `create()` | 3 | **1** | model dimuat sekali |

#### Biaya lain

| adsorbed | Nilai |
|---|---|
| Pemuatan WASM | ±120 ms |
| Pemuatan model (sekali per pasangan bahasa) | ±0,7–1,4 detik |
| Terjemahan | ±10–40 ms per baris kalimat |
| Beralih pasangan bahasa | worker lama diputus, worker baru dibuat (±1 detik) |

---

## 4. Audit mendalam

`node tools/audit-translate.mjs` → **31 lulus, 0 gagal**.

### Mesin offline (diuji beneran, bukan stub)

- terjemahan Indonesia → Inggris benar
  (*"Selamat pagi, apa kabar?"* → *"Good morning, how are you?"*)
- terjemahan Inggris → Indonesia benar
  (*"This document explains the work plan for the next fiscal year."* →
  *"Dokumen ini menjelaskan rencana kerja untuk tahun fiskal berikutnya."*)
- model dimuat **tepat satu kali** untuk banyak batch
- baris berulang hanya diterjemahkan sekali (2 unik → 2 terkirim)
- panggilan kedua jauh lebih cepat (cache internal mesin): 1 360 ms → 53 ms
- mengganti pasangan bahasa memuat model baru dengan benar
- hanya **satu** model bahasa yang hidup pada satu waktu

### Mesin bawaan peramban (disimulasikan lengkap)

- `availability()` dan `create()` memakai **opsi yang sama** (syarat Chrome)
- `create()` dipanggil **dengan `monitor`** → progres unduhan/events
- dipakai saat model sudah ada → hasil benar
- `NotSupportedError` / `NetworkError` / `NotAllowedError` → pesan tepat,
  tidak lagi menyalahkan "peramban belum punya mesin"
- `unavailable` + pasangan tanpa model offline → pesan menyebut pasangan
  yang benar-benar tersedia
- mode otomatis **tidak menyentuh** mesin bawaan saat model offline ada
  (`create()` = 0 → tidak ada unduhan ±40 MB)
- satu mesin untuk dua berkas → `create()` dipanggil **1×**

### Alat lewat UI (sungguhan)

- tombol **Proses** → berkas hasil `.md` terbentuk
- isi hasil benar-benar bahasa tujuan
- judul berkas asli dipertahankan
- catatan hasil menyebut mesin yang dipakai + jumlah halaman + jumlah baris
- dua berkas diproses dalam satu jalan
- PDF tanpa teks tidak membuat alat gagal
- dokumen 20 halaman diterjemahkan
- **tidak ada error JavaScript**
- tidak ada object URL yang menumpuk

---

## 5. Bug tambahan yang ditemukan saat audit

### Beban memori WASM (crash tab)

Audit pertama gagal pada skenario "ganti pasangan bahasa": memuat model
kedua ke worker yang sama **mematikan tab**. Penyebabnya: memori WASM
Bergamot tidak cukup untuk dua model sekaligus.

**Perbaikan:** satu worker = satu model bahasa. Saat pasangan bahasa
ganti, worker lama **diputus** (memori benar-benar dilepas) lalu worker
baru dibuat. Buffer model juga dipindahkan (`transfer`) supaya salinannya
di thread utama langsung dibebaskan.

### Timeout yang tidak membatalkan

`withTimeout()` lama hanya menolak promise-nya; `Translator.create()`
tetap berjalan di belakang dan menghasilkan translator yang tidak pernah
dihancurkan (kebocoran). Fungsi tersebut sudah dihapus — tidak ada lagi
pembatas waktu buatan, dan galat API apa pun ditangani berdasarkan
`err.name`.

---

## 6. Dampak ukuran repo

| Bagian | Ukuran |
|---|---|
| Mesin Bergamot (WASM + glue + worker) | 5,1 MB |
| Model `id→en` (gzip) | 15,2 MB |
| Model `en→id` (gzip) | 14,6 MB |
| **Total `vendor/bergamot/`** | **34,9 MB** |

Berkas model **tidak** ikut dimuat saat halaman dibuka — hanya saat
pengguna benar-benar menekan tombol Proses untuk bahasa tersebut.
Halaman utama tetap ringan.

---

## 7. Regresi

| Audit | Hasil |
|---|---|
| `tools/audit-translate.mjs` (baru) | **31 / 0** |
| `tools/audit-preview-perf.mjs` | 39 / 0 |
| `tools/audit-merge-preview.mjs` | 44 / 0 |
| `tools/audit-pagerange.mjs` | 106 / 0 |
| `tools/audit-deskew.mjs` | 56 / 0 |
| `tools/audit-ocr.mjs` | 44 / 0 |
| `tools/verify-produksi.mjs` | 73 / 1 |

Satu-satunya kegagalan produksi (`Toolbar editor ≤ 3 baris di 360px
baris=4`) **sudah ada pada baseline** sebelum perubahan ini.

---

## 8. Berkas

| Berkas | Isi |
|---|---|
| `tool-translate.js` | modul mesin terjemahan (bawaan peramban + offline) |
| `tool-smart.js` | alat "Terjemah PDF" (ditulis ulang) |
| `tool-ui.js` | dukungan field baru `note` (keterangan pada panel alat) |
| `vendor/bergamot/` | mesin WASM + model bahasa + lisensi |
| `tools/mkfixtures-translate.mjs` | generator fixture audit |
| `tools/audit-translate.mjs` | harness audit (31 pemeriksaan) |
| `tools/bench-translate.mjs` | benchmark sebelum/sesudah |
| `docs/audit-terjemah-hasil.json` | hasil audit |
| `docs/bench-terjemah-hasil.json` | hasil benchmark |
| `docs/audit-terjemah-2026-11-24/` | screenshot bukti |
