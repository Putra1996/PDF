# Mesin terjemahan offline (Bergamot)

Folder ini berisi **mesin terjemahan yang jalan sepenuhnya di dalam
peramban** — tidak ada satu pun permintaan ke internet saat menerjemahkan.
Ini membuat fitur *Terjemah PDF* tetap berfungsi di peramban yang tidak
punya mesin terjemahan bawaan (Chrome 138+ dengan model on-device), yang
hanya tersedia di sebagian kecil perangkat.

## Isi folder

| Berkas | Asal | Lisensi |
|---|---|---|
| `bergamot-translator-worker.wasm` | [`@browsermt/bergamot-translator`](https://www.npmjs.com/package/@browsermt/bergamot-translator) v0.4.9 (build WASM Bergamot) | MPL-2.0 |
| `bergamot-translator-worker.js` | idem (glue Emscripten) | MPL-2.0 |
| `translator-worker.js` | idem (pembungkus worker) | MPL-2.0 |
| `models/id-en/*` | model `Indonesian → Inggris` tipe *tiny* | MPL-2.0 |
| `models/en-id/*` | model `Inggris → Indonesia` tipe *tiny* | MPL-2.0 |

## Asal model bahasa

Model bahasa adalah **model Neural Machine Translation milik Mozilla**
(mozilla/firefox-translations-models, lisensi MPL-2.0), diserial ulang
oleh repositori `vadim3121/firefox-translation-models` untuk TranslateLocally.

Berkas model di sini **dikompresi gzip** (`*.gz`) supaya repo tetap ramping;
peramban membukanya memakai `DecompressionStream` sehingga tidak perlu
pustaka tambahan.

Untuk memastikan berkas asli utuh, sidik jari SHA-256 model
`Indonesian → Inggris` dicocokkan dengan pointer Git LFS resmi Mozilla:

| Berkas | SHA-256 (sebelum dikompresi) |
|---|---|
| `model.bin.gz` (id→en) | `625c237e7d1cdc12b0d9e2e666c0d3b674e13d50461268467aaa0b78c2cc5d93` |
| `lex.bin.gz` (id→en) | `029091e65df311e17c7e5a199505372dc3892937046b918ac18695aede08e344` |
| `vocab.spm.gz` (id→en) | `74daf618f0c78d508fda867f30983e9e5679a4e21c4cd42f5dcd5e501448f48e` |

## Lisensi

Seluruh isi folder ini berada di bawah **Mozilla Public License 2.0**
(lihat `LICENSE`). Kode aplikasi di luar folder ini tetap memakai
lisensi repo.

## Kinerja

- Pemuatan WASM: ±120 ms.
- Pemuatan model (sekali per pasangan bahasa): ±2–4 detik di jaringan cepat.
- Terjemahan: ±10–40 ms per baris kalimat (Bergamot WASM, *int8*).
- Model tetap ada di memori peramban selama halaman terbuka. Kalau pasangan
  bahasa diganti, worker lama **diputus** (memori WASM dilepas sepenuhnya)
  lalu worker baru dibuat — memuat dua model sekaligus bisa membuat tab
  kehabisan memori.
