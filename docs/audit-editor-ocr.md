# Audit OCR + edit visual langsung di preview

Tanggal: 2026-11-22 · Branch: `arena/37cc1868-pdf`

## Tujuan

Memungkinkan teks pada PDF hasil pindai dikenali offline, lalu diedit langsung di preview seperti objek teks Word; font/stilanya dan objek gambar dapat diedit tanpa meninggalkan preview.

## Implementasi

- **Fitur OCR PDF itu sendiri** sekarang membuka panggung preview editor (bukan memaksa pengguna pindah ke alat Edit PDF). Tombol **OCR → edit teks** pada toolbar panggung mengenali scan yang sedang tampil.
- OCR halaman aktif memakai Tesseract offline memakai bahasa dan DPI yang dipilih di OCR PDF (default Indonesia, 200 DPI), satu worker untuk menjaga konsumsi memori; worker dihentikan selalu setelah selesai.
- Core SIMD dicoba lebih dulu dan fallback ke core biasa.
- Pengakuan dipetakan menjadi lapisan teks per baris. Klik satu baris membuka inspector teks yang sudah ada: isi, font, ukuran, warna, tebal/miring, rata, dan posisi dapat diedit.
- Perubahan terlihat saat itu juga di preview OCR; operasi masuk undo/redo, tersimpan ke proyek, dan diterapkan pada PDF keluaran saat tombol **Proses** ditekan. Teks hasil edit menggantikan teks OCR lama dan tetap dapat dicari/disalin.
- Pengeditan gambar tetap memakai fitur editor yang ada: klik gambar untuk mengganti, mengubah posisi/ukuran, atau menghapusnya; gambar baru bisa disisipkan.
- OCR hanya berjalan setelah diminta pengguna; dokumen dan model tetap lokal, tidak membuat request ke layanan jaringan.
- Jika halaman sudah punya hasil OCR, tombol mencegah duplikasi lapisan (gunakan Undo/hapus lapisan untuk mengulang).
- Pemetaan rotasi dicoba pada orientasi intrinsik dahulu; jika keyakinan OCR rendah, orientasi `/Rotate` ikut dicoba dan hasil ber-confidence terbaik dipakai. Ini menjaga scan yang kontennya sudah diputar maupun yang hanya metadata-nya diputar.

## Batasan yang dinyatakan ke pengguna

Teks scan lama ditutup dengan warna latar yang disampling lalu teks edit ditaruh di atasnya. Ini memungkinkan pengeditan lokal dengan cepat tetapi **bukan content-aware fill**: pada latar foto/tekstur atau pola, bekas area penutup dapat terlihat. Gambar foto tidak dapat diedit piksel/objek internalnya; yang didukung ialah memilih, mengganti, memindah, mengubah ukuran, menghapus, atau menyisipkan gambar sebagai objek.

## Uji otomatis dan bukti

Harness `tools/mkfixture-editor-ocr.mjs` membuat PDF scan raster 4 halaman berotasi 0°, 90°, 180°, dan 270°, masing-masing berisi 3 baris tulisan + gambar terpisah. `tools/audit-editor-ocr.mjs` membuka alat **OCR PDF** dan membuktikan:

1. File dibuka di fitur OCR dengan preview interaktif bawaan.
2. OCR menemukan **3 baris** (200 DPI; sekitar **2,3 detik** termasuk worker init pada runner).
3. Hasil OCR editable; ubah isi + font, lalu PDF akhir benar-benar berisi teks baru dan tidak lagi berisi heading lama.
4. Gambar kedua dapat diubah ukurannya melalui inspector; PDF akhir memuat objek gambar hasil edit.
5. Undo tersedia; preview tetap ter-render; tidak ada error JavaScript fatal.
6. Keempat orientasi berhasil dikenali dan hasil OCR tetap searchable pada PDF keluaran.
7. Render halaman PDF akhir dibandingkan dengan canvas preview hasil edit: **99,0% piksel** dalam toleransi Δ32.
8. Mode latar putih mempertahankan teks yang diedit di semua halaman dan menyertakan kembali gambar yang diubah ukurannya.
9. Halaman yang sudah dikenali di preview tidak di-OCR ulang saat Proses.
10. Tombol **Edit hasil di preview** membuka ulang PDF OCR; teks yang diubah setelah proses kedua juga masuk ke PDF akhir.

Hasil terbaru: **24 lulus / 0 gagal**; audit OCR yang lama **44/0** setelah perbaikan rotasi adaptif. Bukti visual: `docs/audit-editor-ocr/ocr-preview.png`.

Regresi terkait: OCR lama **44/0**; editor **29/0**; produksi **74/0**; audit payung **129/0**.
