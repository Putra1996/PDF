# Audit perbaikan OCR scan padat/noisy

## Temuan dari screenshot pengguna

Screenshot menunjukkan PDF 1,6 MB sebagai **1 gambar penuh, tanpa teks PDF**. Setelah menekan OCR, banyak kotak/lapisan berwarna menutupi halaman, dan beberapa kata terlihat seperti noise. Yang dapat dipastikan dari screenshot adalah antarmuka preview bertumpuk kotak OCR; file PDF sumber tidak dilampirkan, jadi ketepatan pengenalan terhadap dokumen itu belum dapat diverifikasi langsung.

## Perbaikan

1. **Ambang confidence yang bisa diatur.** Opsi baru `Ambang keyakinan OCR (%)` (default 30; rentang 0–95) berlaku untuk OCR preview dan OCR PDF hasil. Kata/baris dengan confidence lebih rendah dilewati agar noise tidak otomatis dijadikan teks edit/searchable. Jika semua baris terbuang, pesan menyarankan menurunkan ambang/meningkatkan kualitas scan.
2. **Resolusi default 250 DPI** (tetap dapat diatur 100–400). Ini kompromi ketajaman untuk cetakan kecil vs waktu dan memori perangkat; OCR preview tetap satu worker dan membaca opsi bahasa/DPI di panel.
3. **Preview tidak lagi menyelimuti scan.** Kotak OCR yang belum dipilih kini transparan dengan garis tipis; warna sorotan hanya muncul saat hover/seleksi. Semua kotak tetap dapat diklik.
4. Kunci API/jaringan tidak dipakai; OCR tetap lokal.

## Hasil audit

- Harness OCR editor `tools/audit-editor-ocr.mjs`: **26 lulus / 0 gagal**. Termasuk pemeriksaan filter confidence memakai worker mock (confidence 92 dipertahankan, confidence 9 diabaikan), rotasi 0/90/180/270, font/isi editable, gambar, edit sebelum dan sesudah proses, PDF akhir searchable, visual preview/PDF 99% dalam Δ32.
- Harness OCR produksi `tools/audit-ocr.mjs`: **44 lulus / 0 gagal**, termasuk scan berorientasi 90°.
- Audit payung seluruh fitur: **129 lulus / 0 gagal**.
- Produksi: **74/0**; Editor: **29/0**.

## Keterbatasan reproduksi

Lampiran berisi **screenshot aplikasi**, bukan file `SK PPKK.pdf` yang sedang di-OCR. Karena itu kami dapat memperbaiki gejala preview dan mengurangi noise confidence secara umum, tetapi tidak mengklaim hasil OCR sudah benar untuk dokumen sumber tersebut. Untuk audit akurasi karakter/baris dan tuning spesifik, perlu PDF scan sumber asli (boleh menghapus/menyamarkan data pribadi terlebih dahulu).
