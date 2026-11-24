# Audit optimasi fitur pratinjau (semua alat)

Tanggal: 2026-11-24
Alat yang dioptimalkan: **Pisah PDF** (tab split), **Gabung PDF** (tab merge, pratinjau
urutan halaman + daftar file), **Susun PDF** (tool organize), **Kompres PDF** (daftar file).
Build aset: `20261124e`

## 1. Ringkasan

Semua fitur pratinjau halaman kini memakai **satu modul pratinjau bersama**
(`tool-preview.js` → `window.PDFPreview`) dengan lima kemampuan:

| Kemampuan | Sebelum | Sesudah |
|---|---|---|
| **Cache dokumen pdf.js** | dua cache terpisah (`pdfCache` di split, `thumbCache` di merge), tiap file disalin ulang | satu cache bersama per berkas, satu kali salinan byte |
| **Cache thumbnail** | **tidak ada** — setiap render ulang mengulang seluruh pekerjaan pdf.js | thumbnail di-cache per (berkas, halaman, lebar) dengan batas LRU 320 |
| **Penjadwalan render** | antrean FIFO satu-per-satu, tanpa prioritas | penjadwal dengan prioritas (kedekatan ke layar), batas konkurensi, dan penggabungan job dengan kunci sama |
| **Pemuatan malas** | sebagian tempat; Susun PDF **tidak** sama sekali (semua halaman dirender saat membuka) | `IntersectionObserver` dengan root yang benar di semua pratinjau |
| **Pemakaian ulang node DOM** | grid dibangun ulang dari nol tiap interaksi | `PDFPreview.reconcile()` memindahkan node yang sudah ada |

### Prinsip utama

> Kalau thumbnail-nya sudah pernah dibuat, **tidak pernah** dirender lagi.
> Kalau kartunya sudah ada, **tidak pernah** dibuat lagi.

Kartu pratinjau di Gabung PDF diidentifikasi dengan `<berkas>:<halaman>` — jadi kartu itu
selalu menampilkan halaman yang sama; yang berubah hanya **posisinya**. Karena itu
mengubah urutan cukup **memindahkan** node: `<img>` di dalamnya tetap hidup, browser
tidak perlu decode ulang, dan layar tidak berkedip.

## 2. Modul baru: `tool-preview.js`

```js
window.PDFPreview = {
  doc(key, bytes),            // cache dokumen pdf.js per berkas
  dropDoc(key),              // tutup dokumen + lepas thumbnail-nya
  thumbKey(docKey, page, w),  // kunci cache thumbnail
  peek(key), mount(img, url, key),
  thumb(docKey, bytes, pageNo, width, priority),  // ambil / buat thumbnail
  schedule(key, priority, task),                 // penjadwal (dedupe + prioritas)
  lazy(container, opts),     // pemuat malas berbasis IntersectionObserver
  reconcile(container, items, opts),  // pakai ulang node DOM
  distance(node),            // jarak node ke pusat layar (prioritas)
};
```

Detail penting:

- `PV.doc()` menyalin byte **sekali per berkas** (pdf.js mengambil alih `ArrayBuffer`,
  jadi buffer asli harus disalin supaya tidak ikut detach).
- `PV.thumb()` memakai LRU: entri yang `<img>`-nya masih terpasang di DOM **tidak**
  dicabut, jadi URL-nya tetap hidup selama masih dipakai.
- `PV.lazy()` menerima `root: null` (viewport) atau wadah scroll (`#mergePreviewGrid`).
- `PV.reconcile()` memanggil `opts.onRemove(node)` untuk node yang dibuang, supaya
  observer tidak menumpuk elemen yang sudah tidak ada.

### Tiga titik perubahan di kode aplikasi

| Berkas | Perubahan |
|---|---|
| `app.js` | Pisah PDF & Gabung PDF memakai `PV.reconcile` + `PV.thumb` + `PV.lazy`; `mergeBuildBytes` tidak berubah (hasil PDF tetap sama). |
| `tool-ui.js` | Susun PDF: kartu dibuat lebih dulu, thumbnail dimuat malas; grid tidak dibangun ulang saat putar/hapus/duplikat. |
| `tool-pdf.js` | `organize.open()` **tidak lagi** merender semua halaman jadi `data-URL`; cukup mengembalikan `{pageCount, items}`. |

## 3. Harness

```bash
node tools/mkfixtures.mjs        # fixtures/dense90.pdf (90 halaman), sample.pdf
node tools/mkfixtures-merge.mjs  # fixtures/merge/*.pdf
node tools/audit-preview-perf.mjs  # audit Chromium (39 pemeriksaan)
node tools/bench-preview.mjs       # benchmark before/after
```

Audit memakai penghitung yang disisipkan ke halaman (`HTMLCanvasElement.prototype.toBlob`
dan `toDataURL`), jadi **jumlah render thumbnail terukur**, bukan ditebak. Sebelum
mengukur "render ulang", harness menunggu sampai antrean render latar **selesai**
(`settle()`), supaya angka yang diukur benar-benar interaksi yang diuji.

## 4. Hasil audit

**39 lulus, 0 gagal** (`docs/audit-preview-perf-hasil.json`).

Cakupan:

**Pisah PDF**
- thumbnail pertama tampil < 15 detik (terukur ~2,3 detik)
- thumbnail benar-benar ter-decode (`naturalWidth > 10`), bukan placeholder
- pemuatan malas: 42 dari 90 halaman ter-render, sisanya placeholder
- reorder file **tidak** membangun ulang blok file (node sama) dan **tidak** mengulang render

**Gabung PDF**
- kartu pratinjau muncul < 8 detik (terukur ~0,8 detik)
- hanya kartu di area terlihat + margin yang dirender (36 dari 90)
- semua kartu terlihat punya thumbnail (27/27)
- ganti mode memakai ulang node kartu (90/90 node tetap hidup)
- thumbnail lama memakai **object URL yang sama** → tidak di-decode ulang
- kembali ke mode awal: **0 render ulang** (cache bekerja)
- menggeser satu halaman: **0 render ulang**
- setelah scroll, kartu yang terlihat tetap punya thumbnail; tidak merender seluruh dokumen

**Susun PDF**
- grid halaman muncul < 8 detik (terukur ~0,3 detik)
- **tidak** merender semua halaman sekaligus
- **tidak ada `data-URL`** lagi (dulu 90 `canvas.toDataURL`)
- kartu di area terlihat semuanya punya thumbnail; kartu jauh dari layar **belum** dirender
- memutar halaman memakai ulang node dan **tidak** render ulang

**Umum**
- jumlah object URL terkendali (< 400)
- tidak ada error JavaScript
- screenshot bukti ketiga pratinjau

### Screenshot bukti

| Berkas | Isi |
| --- | --- |
| `docs/audit-preview-perf-2026-11-24/pratinjau-pisah-pdf.png` | Pisah PDF — 42 thumbnail ter-render, sisanya placeholder |
| `docs/audit-preview-perf-2026-11-24/pratinjau-gabung-pdf.png` | Gabung PDF — kartu halaman dengan thumbnail |
| `docs/audit-preview-perf-2026-11-24/pratinjau-susun-pdf.png` | Susun PDF — grid halaman lazy |

## 5. Benchmark before/after

Diukur dengan harness yang sama (`tools/bench-preview.mjs`) pada **commit yang sama**,
baseline dijalankan dari worktree `b462d6a` (main sebelum fitur ini).

| Metrik | Baseline | Sesudah | Perubahan |
|---|---|---|---|
| **Susun PDF** — grid siap tampil | 3 471 ms | **253 ms** | **−93 % (13,7× cepat)** |
| **Susun PDF** — thumbnail di-eager | 90 (`toDataURL`) | 30 (lazy, blob) | −67 % |
| **Susun PDF** — `toDataURL` | 90 | **0** | dihapus total |
| **Gabung** — geser satu halaman: render ulang | **27** | **0** | dihapus total |
| **Gabung** — geser satu halaman: latensi | 1 589 ms | **398 ms** | −75 % |
| **Gabung** — kembali ke mode awal: render ulang | **27** | **0** | dihapus total |
| **Gabung** — kembali ke mode awal: latensi | 1 136 ms | **384 ms** | −66 % |
| **Gabung** — scroll grid: latensi | 1 143 ms | **213 ms** | −81 % |
| **Gabung** — scroll grid: render ulang | 21 | **0** | dihapus total |
| **Gabung** — thumbnail pertama | 2 258 ms | **1 869 ms** | −17 % |
| **Pisah PDF** — reorder file: render ulang | 0 | 0 | sudah baik, tetap 0 |
| **Pisah PDF** — thumbnail pertama | 1 868 ms | 2 049 ms | ±10 % (suara pengukuran) |

### Catatan jujur tentang angka yang tidak berubah

**Throughput render per halaman tidak berubah** (±0,1 halaman/detik, diukur 3× masing-masing
dengan browser baru): baseline 5,8 halaman/detik, sesudah 5,4 halaman/detik.

Ini dibuktikan dengan profiler di dalam halaman:

| Tahap | Rata-rata (konteks aplikasi) |
|---|---|
| `pdf.getPage()` | 6 ms |
| `page.render()` | 115 ms (puncak 1 683 ms) |
| `canvas.toBlob()` | 144 ms (puncak 1 861 ms) |

Ringkasnya: waktu yang dihabiskan ada di **render + enkode JPEG**, bukan di DOM.
Ukuran thumbnail **tidak** berpengaruh sama sekali (120 px → 5,1/detik; 180 px → 5,3/detik;
240 px → 5,4/detik), dan konkurensi 1 vs 3 juga tidak berpengaruh. Artinya biaya ini
melekat pada rasterisasi pdf.js di lingkungan *headless* (SwiftShader, tanpa GPU) —
di perangkat pengguna sungguhan jauh lebih cepat.

Artinya: **yang bisa diperbaiki adalah pekerjaan yang sia-sia**, dan itulah yang dihilangkan
semuanya (27 → 0 render per interaksi). Throughput render murni dibatasi perangkat dan
tidak bisa dikurangi dari sisi aplikasi tanpa mengubah kualitas gambar.

## 6. Regresi

Semua audit dijalankan ulang pada build yang sama:

| Audit | Hasil | Catatan |
|---|---|---|
| `tools/audit-preview-perf.mjs` | **39 / 0** | audit baru fitur ini |
| `tools/audit-merge-preview.mjs` | **44 / 0** | urutan pratinjau Gabung PDF tetap benar |
| `tools/audit-pagerange.mjs` | **106 / 0** | slider cakupan halaman aman |
| `tools/audit-deskew.mjs` | **56 / 0** | Rapi PDF aman |
| `tools/audit-ocr.mjs` | **44 / 0** | OCR PDF aman |
| `tools/verify-produksi.mjs` | **73 / 1** | satu-satunya kegagalan `Toolbar editor ≤ 3 baris di 360px baris=4` **sudah ada pada baseline** |

## 7. Catatan implementasi

- **Namespace dokumen**: `merge:` dan `compress:` dipakai terpisah supaya dokumen pdf.js
  dan cache thumbnail tidak tertukar antar tab.
- **Pembersihan sumber daya**: dokumen pdf.js ditutup saat berkas dihapus
  (`dropPdfjsDoc`, `dropThumbDoc`) dan saat tool Susun PDF diganti/ditutup
  (`state.custom.dispose`).
- **A11y** tidak berubah: `role="list"`/`listitem`, `role="status" aria-live`,
  `aria-label` tombol panah, `aria-label` kartu Susun PDF memuat posisi halaman.
- **URL object** dicabut dari cache hanya kalau `<img>`-nya sudah tidak terpasang di DOM,
  sehingga tidak pernah ada gambar rusak akibat URL dicabut terlalu cepat.
- `PV.thumb()` memakai lebar baku `THUMB_W = 240` (CSS px, dikalikan DPR) untuk semua
  pratinjau, sehingga satu halaman yang sama cukup dirender **satu kali** untuk semua alat.
