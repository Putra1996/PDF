# Audit OCR + edit visual langsung di preview

Tanggal: 2026-11-26 · Branch: `arena/37cc1868-pdf`

## Tujuan

Memungkinkan teks pada PDF hasil pindai dikenali offline, lalu diedit langsung di preview seperti objek teks Word; font/stilanya dan objek gambar dapat diedit tanpa meninggalkan preview.

## Implementasi

- Tombol **OCR → edit teks** ditambahkan di toolbar Edit PDF.
- OCR halaman aktif memakai Tesseract lokal (`ind+eng`) di 180 DPI, satu worker untuk menjaga konsumsi memori; worker dihentikan selalu setelah selesai.
- Core SIMD dicoba lebih dulu dan fallback ke core biasa.
- Pengakuan dipetakan menjadi lapisan teks per baris. Klik satu baris membuka inspector teks yang sudah ada: isi, font, ukuran, warna, tebal/miring, rata, dan posisi dapat diedit.
- Perubahan terlihat saat itu juga melalui mekanisme preview editor; operasi masuk undo/redo, tersimpan ke proyek, dan ikut pada ekspor PDF editor.
- Pengeditan gambar tetap memakai fitur editor yang ada: klik gambar untuk mengganti, mengubah posisi/ukuran, atau menghapusnya; gambar baru bisa disisipkan.
- OCR hanya berjalan setelah diminta pengguna; dokumen dan model tetap lokal, tidak membuat request ke layanan jaringan.
- Jika halaman sudah punya hasil OCR, tombol mencegah duplikasi lapisan (gunakan Undo/hapus lapisan untuk mengulang).

## Batasan yang dinyatakan ke pengguna

Teks scan lama ditutup dengan warna latar yang disampling lalu teks edit ditaruh di atasnya. Ini memungkinkan pengeditan lokal dengan cepat tetapi **bukan content-aware fill**: pada latar foto/tekstur atau pola, bekas area penutup dapat terlihat. Gambar foto tidak dapat diedit piksel/objek internalnya; yang didukung ialah memilih, mengganti, memindah, mengubah ukuran, menghapus, atau menyisipkan gambar sebagai objek.

## Uji otomatis dan bukti

Harness `tools/mkfixture-editor-ocr.mjs` membuat PDF satu halaman yang isinya hanya gambar (3 baris tulisan + gambar geometris), sehingga menguji skenario scan sungguhan, bukan PDF teks. `tools/audit-editor-ocr.mjs` membuktikan:

1. PDF scan terbuka di editor.
2. OCR menemukan **3 baris** teks (180 DPI; worker init + OCR sekitar **2,4 detik** pada runner audit ini).
3. Tiap hasil OCR berupa lapisan teks editable dengan geometri valid.
4. Klik hasil membuka inspector.
5. Ubah teks dan font memperbarui state preview langsung.
6. Undo tersedia.
7. Preview tetap ter-render dan tidak ada error JavaScript fatal.

Hasil: **9 lulus / 0 gagal**. Bukti visual: `docs/audit-editor-ocr/ocr-preview.png`.

Regresi terkait: editor lama **29/0**; produksi **74/0** setelah tombol baru dilipat menjadi ikon di layar sempit; audit payung **129/0**.
