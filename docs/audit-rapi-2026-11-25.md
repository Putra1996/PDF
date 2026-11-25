# Audit Mendalam Fitur "Rapi PDF" — 25 November 2026

Branch: `arena/d157a82b-pdf` (basis `main` `478f0a0`)
Fokus: **dokumen pindai resmi dengan kemiringan kecil ±0,8°** (kasus nyata
dari lampiran pengguna — surat keterangan dengan kop, stempel, foto, dan
tanda tangan), lalu audit menyeluruh atas fitur **Rapi PDF**.

Harness baru: `tools/audit-rapi.mjs` → **58 lulus / 0 gagal**
Fixture baru: `tools/mkfixtures-rapi.mjs` (11 fixture di `fixtures/rapi/`)

---

## 1. Ringkasan temuan

Audit ini menemukan **sembilan cacat nyata**, tiga di antaranya membuat
"Rapi PDF" **merusak dokumen** pada kasus yang justru dilaporkan pengguna.

| # | Temuan | Dampak | Status |
|---|---|---|---|
| 1 | `skorProyeksi` salah hitung rentang min–max (`else if`) | Skor profil meledak di sudut palsu → **kemiringan terdeteksi salah** | Diperbaiki |
| 2 | Tanda arah saat meluruskan frame salah (`-h.sudut`) | Sisa miring jadi **2× lipat**, segmentasi baris kacau | Diperbaiki |
| 3 | Deteksi "halaman terbalik" terlalu lemah (ambang 0,02, satu bukti) | Dokumen pindai **0,8° dibalik 180°** (dokumen resmi jadi terbalik!) | Diperbaiki |
| 4 | Cabang "teks tegak" selalu memilih −90° | Pindai miring −90° berakhir **terbalik** | Diperbaiki |
| 5 | Fixture deskew **tidak pernah benar-benar miring** (escaping `\n`) | Regresi deskew 56/0 selama ini **false positive** | Diperbaiki |
| 6 | Pangkas margin memakai ambang "tinta gelap" | **Foto / tabel / stempel pudar bisa terpotong** | Diperbaiki |
| 7 | Kotak margin dihitung dari AABB yang diputar | Pangkas margin selalu **lebih longgar** dari seharusnya | Diperbaiki |
| 8 | Pembalikan 180° tidak dijaga di sisi alat | Kemungkinan dokumen dibalik tanpa bukti kuat | Diperbaiki |
| 9 | Resolusi analisis & langkah pencarian kurang tajam | Sudut kecil (&lt; 1°) kurang presisi | Diperbaiki |

---

## 2. Detail akar masalah

### 2.1 Rentang min–max yang salah (temuan 1)

`tool-core.js` → `skorProyeksi()`:

```js
if (v < min) min = v;
else if (v > max) max = v;      // ← salah
```

Pola `else if` berarti titik yang kebetulan lebih kecil dari `min` ikut
dilewati untuk pemeriksaan `max`. Karena titik tinta diurutkan dari atas ke
bawah (urutan raster), `min` turun terus dan `max` **tidak pernah**assigned
nilai sebenarnya. Akibatnya `max - min` jauh terlalu kecil → bin profil
menjadi sangat sempit → **ribuan piksel (mis. kotak foto) menumpuk di bin
terakhir** → skor meledak (219 juta vs 15 juta) dan pencarian sudut memilih
sudut palsu.

Terbukti langsung di fixture pindai 0,8°:

| sudut | skor (sebelum) | skor (sesudah) |
|---|---|---|
| −0,75° (sudut benar) | 15,77 juta | 15,77 juta |
| **−0,05° (sudut palsu)** | **219,45 juta** | 13,4 juta |

Perbaikan: `min` dan `max` dihitung terpisah (`if`/`if`).

### 2.2 Arah rotasi saat meluruskan (temuan 2)

`tool-core.js` → `analisisKemiringan()`:

```js
const lurus = putarTitik(f, -h.sudut);   // ← salah
const a = arahTeks(lurus);
```

`h.sudut` adalah **sudut koreksi** (arah yang harus diputar isinya). Untuk
meluruskan titik tinta, frame harus diputar sebesar `h.sudut`, bukan
`-h.sudut`. Akibatnya frame "lurus" justru **miring dua kali lipat** —
pada dokumen 0,8° menjadi 1,6°. Segmentasi baris teks ikut kacau: jumlah
baris yang terdeteksi turun dari 24 menjadi 4–13, dan statistik "sisi
rata" jadi tidak bermakna.

### 2.3 Dokumen 0,8° dibalik 180° (temuan 3 — kasus pengguna)

Deteksi "terbalik" memakai satu statistik saja: *sisi rata* baris teks
(margin kiri rapat vs kanan ragged), dengan ambang `AMBANG_YAKIN = 0,02`
(nyaris nol). Ketika frame pelurusan salah arah (temuan 2), baris-baris
teracak berubah, statistik itu terbalik, dan dokumen dianggap terbalik.
`analisisKemiringan` lalu menambah 180° ke sudut koreksi.

Hasil nyata pada fixture pindai resmi (kasus pengguna, kemiringan 0,8°):

| | Sebelum | Sesudah |
|---|---|---|
| Sudut koreksi | **179,20°** | **−0,74°** |
| Hasil akhir | dokumen **terbalik**, ukuran halaman 550×604 pt | dokumen **lurus**, ukuran 543×597 pt |
| Catatan alat | "1 halaman diluruskan (rata-rata 179,2°)" | "1 halaman diluruskan (rata-rata 0,7°)" |

Perbaikannya berlapis:

1. Amber koreksi `lurus` (temuan 2).
2. Amber keyakinan "sisi rata" dinaikkan `0,02 → 0,12`.
3. Ditambah **bukti kedua yang independen**: *titik berat vertikal* baris.
   Huruf Latin menumpuk di bagian atas baris (zona x-height & ascender),
   jadi titik berat tinta berada **di atas** tengah baris; teks terbalik
   membuat tanda ini berubah tanda. Nilainya diukur pada dokumen yang
   benar-benar lurus:
   * `akta-lurus` → **+0,0125**
   * `akta-miring08` → **+0,0149**
   * `pindai-terbalik180` → **−0,0086** (tanda berbalik ✓)
4. **Dua bukti harus sepakat** sebelum dokumen dianggap terbalik. Kalau
   hanya satu yang mendukung, halaman dibiarkan apa adanya — lebih baik
   halaman tetap miring 0,8° daripada dokumen resmi dibalik.
5. Sisi alat (`tool-pdf.js`) menambah penjaga: pembalikan ≥135° hanya boleh
   jalan bila analisis benar-benar menandai `terbalik`, dengan keyakinan
   lebih tinggi (`0,3`).

### 2.4 Cabang halaman miring tegak (temuan 4)

Untuk halaman yang dipindai tegak, kode lama selalu mencoba −90° dan
memakainya apa adanya. Halaman yang dipindai **−90°** berakhir terbalik.
Sekarang kedua arah diuji dan dipilih yang membuat teks tegak (memakai
tanda titik berat vertikal): `pindai-tegak90` → −90°, `pindai-tegak-minus90`
→ **+90°**.

### 2.5 Fixture deskew yang tidak pernah miring (temuan 5)

`tools/mkfixtures-deskew.mjs` menulis content stream dengan `"q\\n…cm\\n"`.
Di dalam JS, `\\n` adalah **dua karakter** (backslash + n), bukan baris
baru → PDF tidak pernah membaca operator `cm` → **semua fixture "miring"
 sebenarnya lurus**. Akibatnya regresi deskew 56/0 yang tercatat sebelumnya
tidak pernah menguji pelurusan sama sekali.

Perbaikan: `String.fromCharCode(10)` dipakai eksplisit (tidak ambigu
walau di dalam template literal). Fixture dibuat ulang, dan sekarang
`pindai-miring3` benar-benar miring 3° (sebelumnya 0°).

### 2.6 Pangkas margin bisa memotong isi (temuan 6)

Kotak margin dihitung dari ambang "tinta gelap" (persentil 2–98). Foto
berwarna abu-abu, tabel, dan stempel pudar **tidak termasuk tinta** → bisa
terpotong saat margin dipangkas.

Perbaikan: ambang kedua yang lebih longgar ("lembut": level kertas dari
persentil 85, dikurangi 25 tingkat) dipakai khusus untuk kotak margin.
Derau JPEG tetap diabaikan. Terbukti: pada fixture akta, **titik di luar
kotak pangkas = 0** (sebelumnya foto ikut terpotong).

### 2.7 Kotak margin dihitung dari AABB yang diputar (temuan 7)

Kotak lama = AABB kotak tinta **yang sudah diputar** (selalu lebih besar
daripada isi sebenarnya, karena sudut-sudut kosong ikut terhitung). Sekarang
kotak dihitung dari **titik tinta setelah diputar** (persis), lalu
digeser ke pusat halaman.

### 2.8 Resolusi & langkah pencarian (temuan 9)

| | Sebelum | Sesudah |
|---|---|---|
| Resolusi analisis (A4) | 1100 px (~133 DPI) | **1400 px (~170 DPI)** |
| Langkah pencarian kasar | `maksDeg/18` (0,44°) | **`maksDeg/40` (0,20°)** |
| Presisi akhir | 0,04° | **0,02°** |

---

## 3. Bukti hasil (semua terukur, bukan estimasi)

### 3.1 Sudut residual diukur dengan estimator **mandiri**

Harness menulis estimator sendiri (profil proyeksi diukur dengan
**entropi** histogram, bukan jumlah kuadrat isi bin seperti di aplikasi),
sehingga hasil "sisa sudut" tidak mengulang apa yang sedang diuji.

| Fixture | Kemiringan masukan | Sisa setelah diperbaiki |
|---|---|---|
| `akta-miring05` | 0,5° | **0,00°** |
| `akta-miring08` (kasus pengguna) | 0,8° | **0,00°** |
| `akta-miring12` | 1,2° | **0,00°** |
| `akta-miring-minus09` | −0,9° | **0,00°** |
| `akta-miring3` | 3,0° | **0,00°** |
| `digital-miring08` | 0,8° | **0,00°** |
| `digital-miring2` | 2,0° | **0,00°** |
| `akta-lurus` | 0° | **0,00°** (tidak diubah) |
| `pindai-terbalik180` | 180° | **0,00°** (dibalik, isi utuh) |
| `pindai-tegak90` | 90° | **0,00°** (diputar tegak) |

### 3.2 Isi dokumen identik — hanya diputar (bukti geometri)

Jarak rata-rata antara titik tinta masukan (diputar sebesar sudut koreksi,
terhadap pusat halaman yang sama) dan titik tinta keluaran:

| Fixture | Jarak rata-rata |
|---|---|
| `akta-lurus` | **0,000 pt** |
| `akta-miring05` | 0,404 pt |
| `akta-miring08` | **0,511 pt** |
| `akta-miring12` | 0,473 pt |
| `akta-miring-minus09` | 0,442 pt |
| `akta-miring3` | 0,483 pt |
| `pindai-terbalik180` (dibalik) | 0,485 pt |

Sub-piksel → tidak ada isi yang hilang, berubah, atau terbalik.

### 3.3 Pratinjau = PDF final (bukti piksel)

Setiap piksel tinta pratinjau dicocokkan ke PDF final pada posisi yang
sama setelah diputar (ruang pengguna PDF, toleransi 2 px):

| Pengukuran | Nilai |
|---|---|
| Cakupan piksel pratinjau di PDF final | **100,0 %** |
| Cakupan balik (PDF final → pratinjau) | **99,9 %** |
| Jumlah piksel tinta | 26.414 → 26.561 (+0,6 %, tepi anti-alias) |

Bukti visual: `docs/audit-rapi-2026-11-25/01-sebelum-pindai-miring08.png`
dan `02-sesudah-pindai-miring08.png`.

### 3.4 Mutu berkas terjaga

| Pemeriksaan | Hasil |
|---|---|
| Stream JPEG pindai | **byte-identik** (tidak di-encode ulang) — 1 → 1 |
| Teks PDF digital | tetap vektor & bisa dicari, jumlah item teks tetap (23 → 23) |
| Ukuran berkas | 303.689 → 303.796 byte (+0,04 %) |
| Anotasi | tautan tetap ada (1 → 1) |
| Metadata | dibersihkan sesuai opsi / dipertahankan saat opsi mati |

### 3.5 Opsi & kasus batas

| Kasus | Hasil |
|---|---|
| Batas sudut 1° pada dokumen 3° | **tidak** diluruskan (sisa −3°) |
| `deskew=false` | kemiringan tetap (−0,8°) |
| `autoRotate=false` pada halaman tegak | tidak diputar (sisa −90°) |
| `trim=false` | margin tidak dipangkas (607×850 pt) |
| `trim=true` | margin terpangkas (500×597 pt), **tidak ada isi terpotong** |
| Multi halaman (3 hal) | jumlah halaman tetap 3 |
| Berkas rusak | pesan jelas: "Berkas ini rusak total: tidak ada halaman yang bisa dipulihkan…" |
| Beban 12 halaman | 4,4 detik (semua halaman lurus) |

---

## 4. Harness

`tools/audit-rapi.mjs` — 58 pemeriksaan:

```
node tools/mkfixtures-rapi.mjs && node tools/audit-rapi.mjs
```

Cakupannya: kasus pengguna 0,8°, rangkaian sudut 0,5–3°, halaman lurus,
PDF digital, halaman terbalik 180°, halaman tegak 90°, pangkas margin,
multi halaman, anotasi, metadata, semua opsi, berkas rusak, bukti visual,
dan perbandingan pratinjau ↔ PDF final.

`tools/mkfixtures-deskew.mjs` diperbaiki (temuan 5) dan
`tools/audit-deskew.mjs` diperkuat: pemeriksaan "teks tegak jadi mendatar"
sekarang memakai estimator sudut **mandiri** dengan rentang −100°…100°
(versi lama memakai analyzer aplikasi yang hanya mencari sudut kecil, jadi
halaman yang masih tegak 90° tetap terlihat "0°" — false positive).

---

## 5. Regresi seluruh fitur

| Harness | Hasil |
|---|---|
| `tools/audit-rapi.mjs` (baru) | **58 / 0** |
| `tools/audit-deskew.mjs` (fixture asli + estimator mandiri) | **56 / 0** |
| `tools/audit-semua.mjs` (payung 33 fitur) | **129 / 0** |
| `tools/audit-editor.mjs` | **29 / 0** |
| `tools/verify-produksi.mjs` | **74 / 0** |
| `tools/audit-sign.mjs` | **65 / 0** |
| `tools/audit-sign-touch.mjs` | **27 / 0** |
| `tools/audit-pagerange.mjs` | **106 / 0** |
| `tools/audit-merge-preview.mjs` | **44 / 0** |
| `tools/audit-ocr.mjs` | **44 / 0** |
| `tools/audit-preview-perf.mjs` | **39 / 0** |
| `tools/audit-translate.mjs` | 30 / 1 — **batasan lingkungan**: Translator API tidak tersedia di Chromium headless (fallback offline lulus) |

Tidak ada kegagalan baru. Semua cacat yang ditemukan diperbaiki langsung
di kode aplikasi, bukan hanya di harness.
