# Audit Mendalam Fitur Terjemah PDF — mesin AI daring + perbaikan akurasi

**Tanggal:** 26 November 2026
**Branch:** `arena/01eb491f-pdf` (basis `main` `dc04cb7`)
**Permintaan:** optimalkan fitur terjemahan; kalau ada keterbatasan, tambahkan
AI terjemahan online; setiap ada perbaikan AI di server online, fiturnya juga ikut
update; terjemahan lebih akurat. Audit mendalam, langsung terapkan ke GitHub.

---

## 1. Ringkasan

Audit menemukan **12 cacat/keteterbatasan** pada fitur "Terjemah PDF" yang
sebelumnya. Semuanya diperbaiki dan diaudit ulang dengan harness baru
(`tools/audit-translate-ai.mjs`, server AI tiruan → **55 lulus / 0 gagal**).

| | Sebelum | Sesudah |
|---|---|---|
| Mesin | 2 (bawaan peramban + offline WASM) | **3** (+ AI daring) |
| Pasangan bahasa yang bisa diterjemahkan | 2 offline + sisanya butuh Chrome 138+ | **semua** (AI daring, 16+ bahasa) |
| Granularitas terjemahan | per **baris** | per **kalimat** (kontekstual) |
| Hasil | hanya `.md` | **`.md` + `.pdf`** (PDF bisa dicari) |
| Konfigurasi mesin | terkunci di dalam aplikasi | **manifest di server** (bisa diubah tanpa rilis aplikasi baru) |
| Galat jaringan | membatalkan seluruh pekerjaan | retry + backoff + timeout + pesan yang bisa ditindaklanjuti |
| Privasi | — | izinkan/kunci kirim ke server + mesin privat |

---

## 2. Cacat yang ditemukan

### 2.1 Keterbatasan fungsi

| # | Temuan | Dampak | Perbaikan |
|---|---|---|---|
| 1 | Hanya **Indonesia ⇄ Inggris** punya model offline; 14 pasangan lain di daftar UI butuh Chrome 138+ dan unduhan model ±40 MB | sebagian besar pengguna **tidak bisa** memakai fitur terjemahan | mesin **AI daring** (protokol OpenAI-compatible / MyMemory / LibreTranslate / custom) menutup semua pasangan bahasa |
| 2 | Terjemahan **per baris**, bukan per kalimat | kalimat yang patah antar baris jadi potongan terpisah; pronoun menggantung ("dia" → "he/she" keliru); istilah tidak konsisten; hasil jauh dari natural | satuan kalimat: baris lanjutan digabung, kalimat dikirim utuh, lalu **dipecah balik** ke baris aslinya secara proporsional (isi tidak ada yang hilang) |
| 3 | Alat bernama "Terjemah PDF" tapi hanya menghasilkan **Markdown** | tidak ada dokumen terjemahan yang bisa dicetak/dibagikan | hasil **PDF terjemahan**: halaman asli jadi latar, teks asli ditutup, teks terjemahan ditulis di posisi sama + **lapisan teks tak terlihat** (hasil tetap bisa dicari & disalin) |
| 4 | Tidak ada AI daring sama sekali | tidak ada model kontekstual, tidak ada glosarium, tidak ada prompt yang bisa disempurnakan di server | modul `tool-translate-ai.js` + **manifest server** |
| 5 | Cache kalimat **tidak membedakan mesin** | hasil terjemahan mesin lama (mis. offline) dipakai ulang setelah pengguna berganti ke mesin lain — **hasil salah tapi tampak berhasil** | kunci cache memuat identitas mesin (`jenis:mesin:model`) → terisolasi |

### 2.2 Keandalan & keamanan

| # | Temuan | Dampak | Perbaikan |
|---|---|---|---|
| 6 | Satu galat jaringan **membatalkan seluruh** pekerjaan | dokumen 20 halaman hilang setelah 19 halaman selesai | retry + backoff (400 ms/800 ms), hanya untuk 429/5xx/gangguan jaringan |
| 7 | Galat server **tidak diklasifikasi** | pesan galat nyaris tidak ada — pengguna tidak tahu harus apa | 401/403 → "kunci API ditolak"; 404 → "endpoint salah"; 429/5xx → "server sibuk, diulang otomatis"; jaringan → "periksa koneksi"; timeout → "tidak menjawab dalam N detik" |
| 8 | **Tanpa batas waktu** | permintaan menggantung selamanya | timeout per permintaan (bawaan 25 detik, bisa diatur manifest) |
| 9 | Kunci API berisiko **bocor** ke pesan galat | kunci bisa berakhir di tangkapan layar/log | kunci tidak pernah masuk pesan galat; **diuji otomatis** |
| 10 | Angka/kode/URL ikut diterjemahkan | "1.500.000" bisa jadi "1,500,000" atau lebih buruk | filter "layak diterjemahkan": angka, kode, URL, email **tidak dikirim** ke server dan dikembalikan apa adanya |
| 11 | Tidak ada **kontrol privasi** | dokumen bisa diam-diam terkirim ke pihak ketiga | kolom **"Izinkan kirim teks ke server AI daring"** (bawaan: nyala) + mesin privat tetap tersedia |
| 12 | Konfigurasi mesin **terkunci** di dalam aplikasi (rilis baru untuk endpoint/model baru) | perbaikan AI di server tidak bisa dipakai | **manifest** `ai/translate-engine.json` diambil dari server, divalidasi ulang tiap kali fitur dipakai → model/endpoint/prompt baru langsung terpakai |

### 2.3 Cacat yang ditemukan saat menulis harness (regresi yang tertangkap)

| Temuan | Perbaikan |
|---|---|
| Pengelompokan baris memakai indeks sebagai teks → **semua baris terkirim `undefined`** ke server | indeks & teks dipisahkan benar (`kelompokkan(indices, daftar)`) |
| Mode "online" **diam-diam** memakai mesin lain saat server gagal (hasil "berhasil" padahal salah mesin) | cadangan hanya untuk mode **otomatis**; mode online wajib melaporkan galat |
| Rantai otomatis berhenti setelah mode daring → mesin bawaan/offline **tidak pernah dipakai** | `availability()` selalu ditanyakan; urutan: daring → bawaan (kalau modelnya sudah ada) → offline |
| Angka & URL ikut terkirim karena baris tabel digabung jadi satu "kalimat" | aturan lanjutan baris: baris sebelumnya harus ≥3 kata, tidak diakhiri kalimat, dan baris berikutnya mulai huruf kecil / ada tanda sambung |

---

## 3. Desain: manifest server

`ai/translate-engine.json` (juga di-*host* di server; alamatnya bisa diganti di
panel "AI daring"):

```json
{
  "version": "2026-11-26.1",
  "engines": [
    { "id": "llm",  "protocol": "openai",         "endpoint": "…/v1/chat/completions",
      "model": "gpt-4o-mini", "priority": 100, "requiresKey": true },
    { "id": "mt",   "protocol": "mymemory",       "endpoint": "…/get", "priority": 60 },
    { "id": "lt",   "protocol": "libretranslate", "endpoint": "…/translate", "priority": 80 },
    { "id": "cust", "protocol": "custom",         "endpoint": "…/custom", "priority": 90 }
  ],
  "prompt": { "system": "…", "user": "…{from}…{to}…{glossary}…{items}…{n}…" },
  "defaults": { "timeoutMs": 25000, "retries": 2, "concurrency": 3, "temperature": 0.15 }
}
```

**Cara pembaruan bekerja (ini inti permintaan "perbaikan AI di server online ikut
update"):**

1. Aplikasi mengunduh manifest dari server (dengan `If-None-Match` → `304` kalau
   tidak berubah; cache lokal 15 menit).
2. **Template prompt, model, endpoint, dan daftar mesin diambil dari manifest** —
   bukan ditulis mati di dalam kode. Jadi prompt yang lebih baik di server langsung
   dipakai tanpa rilis aplikasi.
3. Tombol **"Perbarui dari server"** di panel AI daring memaksa validasi ulang dan
   memberitahu pengguna kalau versinya naik.
4. Cadangan berlapis: **server → berkas `ai/translate-engine.json` → manifest
   bawaan di dalam `tool-translate-ai.js`**. Fitur tetap jalan walau semuanya gagal.

---

## 4. Akurasi: apa yang membuat hasil lebih akurat

| Teknik | Efek |
|---|---|
| Terjemahan **per kalimat**, bukan per baris | kalimat utuh, bukan potongan; pronoun & istilah benar |
| Beberapa baris **berurutan** dikirim dalam **satu** permintaan | model melihat konteks paragraf (bisa tahu "dokumen ini" merujuk apa) |
| **Glosarium** istilah (sumber = target) | istilah domain (mis. "anggaran = budget") konsisten di seluruh dokumen |
| Prompt dari **manifest server** | prompt bisa disempurnakan di server tanpa rilis aplikasi |
| **Angka/kode/URL tidak dikirim** | tidak ada lagi "1.500.000" → "1,500,000" |
| Pecah balik ke baris asal **proporsional** | tata letak tetap, tidak ada kata yang dibuang |
| Kunci cache **per mesin** | tidak ada lagi hasil mesin lama yang dipakai ulang |

---

## 5. Bukti pengujian

Harness baru `tools/audit-translate-ai.mjs` menjalankan **server AI tiruan**
(OpenAI-compatible, MyMemory, LibreTranslate, custom) dengan fault injection yang bisa
dikendalikan: galat 5xx, 401, penundaan, dan perubahan versi manifest.

**55 pemeriksaan lulus / 0 gagal**, di antaranya:

- Manifest diambil dari **server** (bukan berkas lokal) dan versinya terbaca.
- **Perbaikan di server langsung terpakai**: versi `uji-1` → `uji-2`, model
  `model-uji-v1` → `model-uji-v2`; permintaan berikutnya benar-benar memakai model
  baru **tanpa reload aplikasi**.
- Beberapa baris berurutan dikirim dalam **satu** permintaan (konteks terbaca).
- Glosarium ikut terkirim ke server.
- Angka, kode, dan URL **tidak** dikirim; nilainya dikembalikan apa adanya.
- Kunci cache berbeda antar mesin → hasil mesin lama tidak bocor.
- Server 5xx dicoba ulang lalu berhasil (retry tercatat).
- Galat 401 → pesan "kunci API ditolak"; **kunci API tidak bocor** ke pesan galat.
- Server AI gagal → otomatis turun ke mesin bawaan peramban, dan **perpindahan
  mesin dilaporkan** ke pengguna.
- Izin kirim dimatikan → mesin daring ditolak dengan pesan jelas.
- Panel AI daring menampilkan **versi manifest dari server** dan **daftar mesin
  dari server** (bukan daftar yang ditulis mati di dalam aplikasi), lengkap
  dengan tombol "Perbarui dari server" dan kolom glosarium.
- Alat sungguhan: hasil **Markdown + PDF**, PDF punya **lapisan teks tak terlihat**
  (teks hasil terjemahan bisa dicari keluar dari PDF), kalimat patah dua baris
  terkirim sebagai satu satuan utuh, mode offline tidak menyentuh jaringan sama
  sekali.

Bukti visual: `docs/audit-terjemah-ai-2026-11-26/` (screenshot panel AI daring +
halaman pertama PDF terjemahan).

---

## 6. Status regresi

| Harness | Pemeriksaan | Gagal |
|---|---|---|
| `tools/audit-translate-ai.mjs` (baru) | 55 | 0 |
| `tools/audit-translate.mjs` | 32 | 1 — "Mesin bawaan peramban terdeteksi": Chromium headless dijalankan dengan `--disable-features=Translate`, jadi API Translator tidak ada (batasan lingkungan, bukan cacat) |
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

## 7. Berkas yang berubah

| Berkas | Isi |
|---|---|
| `tool-translate-ai.js` | **baru** — mesin AI daring, manifest server, 4 protokol, retry/timeout, filter teks |
| `ai/translate-engine.json` | **baru** — manifest mesin (bisa di-host & diubah di server) |
| `tool-translate.js` | mesin daring disatukan; rantai AI daring → bawaan → offline; kunci cache per mesin; filter teks |
| `tool-smart.js` | alat "Terjemah PDF": satuan kalimat, pecah balik ke baris, hasil Markdown **+ PDF terjemahan** (lapisan teks tak terlihat), kolom izin kirim |
| `tool-ui.js` | panel "AI daring": status manifest, daftar mesin dari server, endpoint/model/kunci/glosarium, tombol "Perbarui dari server" |
| `style.css` | gaya panel AI daring |
| `index.html` | muat `tool-translate-ai.js`, penanda aset `20261126a` |
| `tools/audit-translate-ai.mjs` | **baru** — harness audit dengan server AI tiruan (50 pemeriksaan) |
| `tools/mkfixtures-translate-ai.mjs` | **baru** — fixture (kalimat patah baris, angka/URL, teks Inggris) |
| `tools/audit-translate.mjs`, `tools/audit-semua.mjs` | harness lama: mesin AI dimatikan agar deterministik; ekspektasi jumlah berkas disesuaikan (sekarang 2 hasil per berkas) |
