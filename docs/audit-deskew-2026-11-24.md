# Audit Mendalam — Fitur "Rapi PDF" (Pelurusan Dokumen Miring)

**Tanggal:** 24 November 2026
**Commit baseline:** `b7861b2` (merge PR #17)
**Ruang lingkup:** `tool-core.js` (analisis kemiringan), `tool-pdf.js`
(alat "Rapi PDF"), `tools/audit-deskew.mjs` (harness audit),
`tools/mkfixtures-deskew.mjs` (generator fixture),
`tools/verify-produksi.mjs` (regresi produksi).

---

## 1. Ringkasan

Pertanyaan yang dijawab: *"bisakah fitur Rapi PDF meluruskan dokumen scan
yang miring, dan apakah perbaikannya menurunkan kualitas dokumen?"*

Jawaban: **ya, tanpa menurunkan kualitas.** Kemiringan halaman dideteksi
dari piksel tinta halaman (hanya membaca berkas), lalu diperbaiki dengan
**membungkus content stream halaman dengan matriks putaran**. Isi halaman
(teks, vektor, gambar) tidak pernah ditulis ulang, tidak diraster ulang,
dan tidak dikompres ulang — piksel gambar hasil pindai keluar **byte per
byte identik**.

| Ukuran | Nilai |
|---|---|
| Harness audit khusus | **56 pemeriksaan lulus, 0 gagal** |
| Regresi produksi | **73 lulus, 1 gagal** (1 gagal = cacat layout lama, bukan regresi — dibuktikan di §6) |
| Regresi OCR (tidak boleh rusak) | **44 lulus, 0 gagal** |
| Uji beban | 12 halaman miring → **4,0 detik** |

---

## 2. Cacat yang ditemukan pada versi lama

Audit terhadap `tool-pdf.js` versi `b7861b2` menemukan:

| # | Temuan | Dampak |
|---|---|---|
| 1 | **Tidak ada deteksi kemiringan sama sekali.** "Rapi PDF" hanya menyalin struktur PDF dengan `pdf-lib`. | Dokumen pindai miring tetap miring — permintaan utama tidak terpenuhi. |
| 2 | Jalur cadangan merender halaman ke **JPEG 0,9** lalu menyisipkannya ulang. | Justru **menurunkan kualitas**: teks hilang (tidak bisa dicari), JPEGArtifact, ukuran membengkak. |
| 3 | Jalur utama memakai `copyPages()` → dokumen baru. | Anotasi, bookmark, dan field formulir **hilang**; metadata ikut hilang tanpa pilihan pengguna. |
| 4 | Halaman dirotasi/Dipangkas tanpa pernah mengukur kemiringannya. | Tidak ada右键 "meluruskan". |

---

## 3. Rancangan solusi

### 3.1 Deteksi kemiringan (`tool-core.js`)

Prinsip: **hanya membaca**. Tidak ada satu pun byte dokumen yang diubah
saat analisis.

1. **Ambil piksel tinta.** Halaman dirender pada resolusi analisis
   (minimal ±140 DPI, A4 ≈ 1100 px lebar), lalu piksel yang lebih gelap dari
   ambang adaptif (persentil histogram) diambil sebagai titik tinta.
   Titik dikembalikan dalam **koordinat PDF user space** (kebalikan
   transform viewport), sehingga atribut `/Rotate` halaman ikut tertangani.
2. **Profil proyeksi.** Untuk setiap kandidat sudut `a`, koordinat
   tegak-lurus garis dihitung `y' = x·sin a + y·cos a`, lalu histogramnya
   dinilai dengan jumlah kuadrat isi bin. Baris teks yang rata → profil
   tajam → skor tinggi. Sudut dengan skor tertinggi = kemiringan halaman.
   Pencarian kasar (36 titik) lalu diperhalus (1/10 langkah).
3. **Arah teks (90°/180°).** Dibaca dari **"sisi rata" baris teks**: pada
   teks normal semua baris mulai dari margin kiri yang sama sedangkan
   ujung kanan ragged; kalau teksnya terbalik, sisi ratanya pindah ke
   kanan. Sinyal ini jauh lebih kuat daripada menebak dari bentuk huruf.
4. **Keyakinan.** `kepastian = (skor terbaik − skor rata-rata) / skor
   terbaik`. Halaman foto/berantakan menghasilkan keyakinan rendah
   (≈0,03) sehingga **tidak pernah diputar**. Putaran 90° (yang mengubah
   halaman banyak) menuntut keyakinan lebih tinggi (0,25).

### 3.2 Koreksi (`tool-pdf.js`) — lossless

| Yang | Bagaimana | Efek ke kualitas |
|---|---|---|
| Isi halaman | Content stream asli dibungkus `q … cm … Q` | **Nihil** — teks, vektor, gambar tidak ditulis ulang |
| Anotasi (tautan, field formulir) | `/Rect` ikut diputar; appearance stream widget dibungkus matriks yang sama | Tautan tetap menempel pada teksnya |
| Kotak halaman | MediaBox & CropBox diperbesar mengikuti kotak hasil putaran | Tidak ada isi yang terpotong |
| Margin | Opsional: CropBox dikecut ke kotak tinta + 8 pt | Hanya memotong ruang kosong |
| Metadata | Opsional: judul/penulis/subjek/kata kunci dikosongkan | — |

**Bukti kualitas (paling penting):** harness membandingkan **stream gambar
mentah** sebelum dan sesudah. Untuk PDF pindai, byte stream JPEG-nya
**identik** — artinya pikselnya benar-benar tidak pernah disentuh:

```
✓ Piksel gambar pindai TIDAK berubah (kualitas utuh) — gambar=1->1, ukuran=168605->168605
```

---

## 4. Hasil pengujian

### 4.1 Ketelitian deteksi (12 fixture)

| Fixture | Kemiringan sebenarnya | Sudut terdeteksi | Error |
|---|---|---|---|
| `pindai-lurus.pdf` | 0° | −0,11° | 0,11° |
| `pindai-miring3.pdf` | 3° | −3,00° | **0,00°** |
| `pindai-miring-minus25.pdf` | −2,5° | 2,50° | **0,00°** |
| `pindai-miring6.pdf` | 6° | −6,00° | **0,00°** |
| `pindai-tegak90.pdf` | 90° | −90,00° | **0,00°** |
| `pindai-tegak-minus90.pdf` | −90° | 90,00° | **0,00°** |
| `pindai-terbalik180.pdf` | 180° | 180,00° | **0,00°** |
| `vektor-lurus.pdf` | 0° | −0,11° | 0,11° |
| `vektor-miring3.pdf` | 3° | −3,00° | **0,00°** |
| `vektor-miring-minus4.pdf` | −4° | 4,00° | **0,00°** |
| `foto-tanpa-teks.pdf` | — | tidak diputar (keyakinan 0,03) | ✓ |
| `kosong.pdf` | — | tidak diputar | ✓ |

### 4.2 Sisa pemeriksaan (56 total)

| Kelompok | Pemeriksaan |
|---|---|
| Pindai miring 3° | alat berhasil, jumlah halaman, sudut sisa ≈0°, sumber memang miring, **piksel identik**, ukuran tidak membengkak, catatan hasil informatif |
| Vektor miring 3° | sudut sisa, **teks tetap bisa dicari**, jumlah item teks tetap, **gaya huruf tetap miring**, tautan tetap ada, metadata dibersihkan, berkas tetap ramping, posisi teks tidak meloncat jauh |
| Halaman lurus | tidak diputar, ukuran halaman sama, piksel sama |
| Foto tanpa teks | tidak diputar (ukuran sama), piksel sama |
| Teks tegak 90° | jadi mendatar, "tegas" berubah, piksel sama |
| Miring −2,5° | sudut sisa ≈0° |
| Opsi | batas sudut 2°, `deskew=false`, `autoRotate=false`, pangkas margin, metadata tidak dibersihkan |
| Kasus batas | halaman kosong, berkas rusak (pesan jelas), PDF 3 halaman campuran, halaman `/Rotate 90°`, **beban 12 halaman (4,0 dtk)** |
| Kebersihan | tidak ada error JavaScript |

### 4.3 Bukti visual

| Berkas | Isi |
|---|---|
| `docs/audit-deskew-2026-11-24/sebelum-pindai-miring3.png` | pindai miring 3° (sebelum) |
| `docs/audit-deskew-2026-11-24/sesudah-pindai-miring3.png` | **sudah lurus**, piksel sama |
| `docs/audit-deskew-2026-11-24/sebelum-pindai-tegak90.png` | pindai tegak 90° (sebelum) |
| `docs/audit-deskew-2026-11-24/sesudah-pindai-tegak90.png` | **sudah tegak & lurus** |
| `docs/audit-deskew-2026-11-24/sebelum-vektor-miring3.png` | PDF digital miring (sebelum) |
| `docs/audit-deskew-2026-11-24/sesudah-vektor-miring3.png` | **sudah lurus**, teks tetap vektor |
| `docs/audit-deskew-2026-11-24/sesudah-campuran-h1.png`, `-h3.png` | dokumen 3 halaman campuran |

---

## 5. Temuan selama audit & perbaikannya

| # | Temuan | Perbaikan |
|---|---|---|
| 1 | **Sudut 180° salah baca** (halaman terbalik dianggap normal). Titik berat tinta hanya membedakan 0,48 vs 0,50 — nyaris sama. | Diganti sinyal **"sisi rata" baris teks** (MAD tepi kiri vs tepi kanan) → margin membedakan 0,95 vs 1,07 secara konsisten. |
| 2 | **Sudut 90° salah arah** (−90 vs +90). | Sama: sisi rata decides, dan sudah tervalidasi untuk ±90° dan 180°. |
| 3 | **Deteksi gagal pada resolusi 600 px** (halaman miring 3° terbaca −0,18° dengan keyakinan 0,996 — keyakinan tinggi tetapi salah). | Resolusi analisis dinaikkan ke **minimal 1100 px (≈140 DPI)**. Terverifikasi: 600 px salah, 700 px ke atas benar. |
| 4 | **Baris teks terfragmentasi** (8 baris terbaca 54–96 "baris") karena puncak profil dihitung per huruf. | Deteksi baris diganti **wilayah bin yang berdekatan** (celah ≤2 bin disatukan) dan dilakukan **setelah** kemiringan dikoreksi. |
| 5 | Halaman foto tanpa teks menghasilkan sudut acak sampai −9,9°. | Ditegakkan ambang keyakinan 0,15 → foto tidak pernah diputar (terverifikasi: ukuran halaman & piksel identik). |
| 6 | `doc.context.obj([...])` dengan objek stream langsung di dalam array menghasilkan PDF rusak. | Alur utama kini memakai **muat & simpan di tempat**; bila gagal, baru ke `copyPages`, lalu raster. Hasil selalu divalidasi (jumlah halaman dicek ulang setelah disimpan). |
| 7 | Anotasi tidak ikut berputar → tautan lepas dari teksnya. | `/Rect` diputar; appearance stream widget (tanpa `/Matrix`) ikut diputar. |
| 8 | Halaman `/Rotate 90°` bisa salah dianalisis. | Titik tinta dikembalikan ke user space lewat kebalikan transform viewport → sudut dihitung di user space, sama dengan tempat matriks diterapkan. |

---

## 6. Regresi & atestasi

| Harness | Pemeriksaan | Gagal | Catatan |
|---|---|---|---|
| `tools/audit-deskew.mjs` (baru) | **56** | **0** | harness audit khusus fitur ini |
| `tools/audit-ocr.mjs` | 44 | 0 | fitur OCR tidak terganggu |
| `tools/verify-produksi.mjs` | 73 | 1 | **1 kegagalan sudah ada sebelum perubahan ini** |

**Bukti bahwa 1 kegagalan itu bukan regresi:** harness versi lama dijalankan
atas commit baseline `b7861b2` (diekspor ke `/tmp/baseline`) → hasilnya
**68 lulus, 1 gagal** dengan pesan yang sama persis:

```
✗ Toolbar editor ≤ 3 baris di 360px — baris=4
```

Pemeriksaan itu murni pengukuran layout CSS toolbar editor pada viewport
360 px; berkas yang berubah dalam pekerjaan ini hanya `tool-core.js`,
`tool-pdf.js`, dan `tools/*` — `style.css`, `index.html`, dan
`tool-editor.js` tidak disentuh. Penyebabnya perbedaan metrik font pada
build Chromium di lingkungan audit, bukan kode yang diubah.

### Perbandingan sebelum/sesudah

| | Harness baseline (`b7861b2`) | Setelah perubahan |
|---|---|---|
| `tools/verify-produksi.mjs` | 68 lulus, 1 gagal (toolbar) | 73 lulus, 1 gagal (toolbar yang sama) |
| `tools/audit-ocr.mjs` | 44 lulus, 0 gagal | 44 lulus, 0 gagal |
| `tools/audit-deskew.mjs` | — (fitur belum ada) | **56 lulus, 0 gagal** |

---

## 7. Batas kemampuan (jujur)

- Sudut di atas **±20°** ditolak (bukan halaman miring, tapi halaman yang
  terkunci). Batas yang bisa diatur di antarmuka: 1–20°.
- Deteksi buta terhadap **orientasi 180° pada dokumen tanpa baris rata
  kiri** (mis. teks berpusat) — dalam kasus itu "sisi rata" tidak
  informatif, jadi alat tidak memutar 180° (aman).
- Halaman **tanpa teks** (foto, gambar) sengaja **tidak** diluruskan:
  tidak ada "baris" yang bisa diukur.
- Pemangkasan margin memakai kotak tinta ± 8 pt; dokumen dengan latar
  penuh (full-bleed) tidak terpangkas.

---

## 8. Cara menjalankan ulang

```bash
npm --prefix .devtest install            # playwright-core, @sparticuz/chromium, pdf-lib
node tools/mkfixtures.mjs                # fixture umum
node tools/mkfixtures-ocr.mjs            # fixture OCR
node tools/mkfixtures-deskew.mjs         # fixture pelurusan
node tools/audit-deskew.mjs              # 56 pemeriksaan
node tools/audit-ocr.mjs                 # 44 pemeriksaan
node tools/verify-produksi.mjs           # 73 pemeriksaan (+1 cacat lama)
```

Bukti visual: `docs/audit-deskew-2026-11-24/`.
