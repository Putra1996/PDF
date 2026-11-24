/* ============================================================
   Pratinjau bersama — cache dokumen, cache thumbnail, penjadwal
   ------------------------------------------------------------
   Semua fitur pratinjau halaman (Pisah PDF, Gabung PDF,
   Susun PDF) memakai modul ini supaya:

   1. Satu dokumen pdf.js per berkas (dibuka sekali, dipakai bersama).
   2. Thumbnail di-cache per (berkas, halaman) —_grid yang dibangun ulang
      TIDAK lagi mengulang render pdf.js.
   3. Render dijadwalkan dengan batas konkurensi + prioritas kedekatan
      ke layar, jadi halaman yang terlihat duluan.
   4. Node DOM dipakai ulang lewat `reconcile()` — memindahkan node yang
      sudah ada, bukan membuatnya ulang (gambar tidak di-decode ulang,
      tidak berkedip).

   API: window.PDFPreview
   ============================================================ */
(function () {
  "use strict";

  const P = {};

  /* ---------------------------------------------------------
     1. Cache dokumen pdf.js
     --------------------------------------------------------- */
  const docs = new Map();     // key -> Promise<pdfDoc>
  const docBytes = new Map(); // key -> Uint8Array (salinan; pdf.js mem-transfer buffer)

  P.doc = function doc(key, bytes) {
    if (docs.has(key)) return docs.get(key);
    /* pdf.js mengambil alih (mentransfer) ArrayBuffer, jadi byte-nya
       harus disalin lebih dulu — kalau tidak, bytes asli ikut detach
       dan tidak bisa dipakai lagi. */
    const copy = bytes.slice(0);
    const p = window.pdfjsLib.getDocument({ data: copy, isEvalSupported: false }).promise;
    docs.set(key, p);
    p.catch(() => {
      docs.delete(key);
      docBytes.delete(key);
    });
    return p;
  };

  P.dropDoc = async function dropDoc(key) {
    const p = docs.get(key);
    docs.delete(key);
    docBytes.delete(key);
    P.dropDocThumbs(key);
    if (!p) return;
    try {
      const d = await p;
      if (d && typeof d.destroy === "function") await d.destroy();
    } catch (_) {
      /* abaikan */
    }
  };

  /* ---------------------------------------------------------
     2. Cache thumbnail (LRU)
     --------------------------------------------------------- */
  const THUMB_MAX = 320;      // batas thumbnail yang disimpan
  const thumbs = new Map();   // key -> {url, img}

  P.thumbKey = function thumbKey(docKey, pageNo, width) {
    return `${docKey}#${pageNo}#${width}`;
  };

  P.peek = function peek(key) {
    const e = thumbs.get(key);
    if (!e) return null;
    /* sentuh -> jadi paling baru (Map mempertahankan urutan sisip) */
    thumbs.delete(key);
    thumbs.set(key, e);
    return e.url;
  };

  /* Pasang URL thumbnail ke elemen <img> dan catat kepemilikannya
     supaya entri cache tidak di-revoke saat masih terpasang. */
  P.mount = function mount(img, url, key) {
    if (!img || !url) return;
    img.src = url;
    img.dataset.objectUrl = "1";
    if (key) {
      const e = thumbs.get(key);
      if (e) e.img = img;
    }
  };

  function evictThumbs() {
    if (thumbs.size <= THUMB_MAX) return;
    for (const [k, e] of Array.from(thumbs.entries())) {
      if (thumbs.size <= THUMB_MAX) break;
      /* jangan cabut URL yang masih terpasang di DOM */
      if (e.img && e.img.isConnected) continue;
      try {
        URL.revokeObjectURL(e.url);
      } catch (_) {
        /* abaikan */
      }
      thumbs.delete(k);
    }
  }

  P.dropThumb = function dropThumb(key) {
    const e = thumbs.get(key);
    if (!e) return;
    if (e.img && e.img.isConnected) return;
    try {
      URL.revokeObjectURL(e.url);
    } catch (_) {
      /* abaikan */
    }
    thumbs.delete(key);
  };

  P.dropDocThumbs = function dropDocThumbs(docKey) {
    const prefix = docKey + "#";
    for (const [k, e] of Array.from(thumbs.entries())) {
      if (!k.startsWith(prefix)) continue;
      if (e.img && e.img.isConnected) continue;
      try {
        URL.revokeObjectURL(e.url);
      } catch (_) {
        /* abaikan */
      }
      thumbs.delete(k);
    }
  };

  P.thumbCount = function thumbCount() {
    return thumbs.size;
  };

  /* ---------------------------------------------------------
     3. Penjadwal render
     ---------------------------------------------------------
     Batas konkurensi + prioritas. Job dengan kunci sama digabung,
     sehingga satu halaman tidak pernah dirender dua kali. */
  const MAX_CONCURRENCY = 3;
  const jobs = new Map();  // key -> {key, priority, promise, resolve, reject, run}
  let active = 0;

  function pump() {
    if (active >= MAX_CONCURRENCY || !jobs.size) return;
    /* ambil job dengan prioritas terkecil (paling dekat layar) */
    let best = null;
    for (const j of jobs.values()) {
      if (!best || j.priority < best.priority) best = j;
    }
    if (!best) return;
    jobs.delete(best.key);
    active++;
    Promise.resolve()
      .then(best.run)
      .then(best.resolve, best.reject)
      .finally(() => {
        active--;
        pump();
      });
  }

  /* Jalankan `task` dengan prioritas tertentu (angka kecil = lebih dulu). */
  P.schedule = function schedule(key, priority, task) {
    const p0 = Number(priority) || 0;
    const ada = jobs.get(key);
    if (ada) {
      /* job yang sama masih antre -> perbarui prioritasnya */
      if (p0 < ada.priority) ada.priority = p0;
      return ada.promise;
    }
    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    jobs.set(key, { key, priority: p0, promise, resolve, reject, run: task });
    pump();
    return promise;
  };

  P.pendingJobs = function pendingJobs() {
    return jobs.size;
  };

  /* ---------------------------------------------------------
     4. Render thumbnail satu halaman
     --------------------------------------------------------- */
  async function renderThumb(docKey, bytes, pageNo, width) {
    const doc = await P.doc(docKey, bytes);
    const page = await doc.getPage(pageNo + 1);
    const base = page.getViewport({ scale: 1 });
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    /* skala dibatasi supaya halaman besar tidak boros memori */
    const scale = Math.min(4, Math.max(0.05, (width / Math.max(1, base.width)) * dpr));
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(vp.width));
    canvas.height = Math.max(1, Math.ceil(vp.height));
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.72));
    canvas.width = canvas.height = 0;
    if (!blob) return null;
    return URL.createObjectURL(blob);
  }

  /* Ambil (atau buat) thumbnail. `priority` menentukan urutan antre. */
  P.thumb = function thumb(docKey, bytes, pageNo, width, priority) {
    const key = P.thumbKey(docKey, pageNo, width);
    const ada = P.peek(key);
    if (ada) return Promise.resolve(ada);
    return P.schedule(key, priority, async () => {
      /* mungkin sudah selesai dirender oleh job lain saat menunggu */
      const ada2 = P.peek(key);
      if (ada2) return ada2;
      const url = await renderThumb(docKey, bytes, pageNo, width);
      if (!url) return null;
      thumbs.set(key, { url, img: null });
      evictThumbs();
      return url;
    }).then((url) => {
      if (url) {
        const e = thumbs.get(key);
        if (e) {
          thumbs.delete(key);
          thumbs.set(key, e);
        }
      }
      return url;
    });
  };

  /* ---------------------------------------------------------
     5. Pemakaian ulang node DOM
     ---------------------------------------------------------
     `reconcile(container, items, opts)`:
       opts.keyOf(item)  -> kunci unik
       opts.create(item) -> node baru
       opts.update(node, item) -> perbarui node
     Node lama yang masih dipakai DIPINDAH (bukan dibuat ulang) sehingga
     <img> di dalamnya tidak perlu di-decode ulang oleh browser. */
  P.reconcile = function reconcile(container, items, opts) {
    const keyOf = opts.keyOf;
    const create = opts.create;
    const update = opts.update || (() => {});
    const existing = new Map();
    for (const child of Array.from(container.children)) {
      const k = child.dataset && child.dataset.pkey;
      if (k != null) existing.set(k, child);
    }
    const frag = document.createDocumentFragment();
    for (const item of items) {
      const k = String(keyOf(item));
      let node = existing.get(k);
      if (node) {
        existing.delete(k);
      } else {
        node = create(item);
        node.dataset.pkey = k;
      }
      update(node, item);
      frag.appendChild(node);
    }
    /* buang node yang tidak dipakai lagi */
    for (const node of existing.values()) {
      if (node.parentNode === container) container.removeChild(node);
      if (opts.onRemove) {
        try {
          opts.onRemove(node);
        } catch (_) {
          /* abaikan */
        }
      }
    }
    container.appendChild(frag);
    return container;
  };

  /* ---------------------------------------------------------
     6. Pemuat malas (lazy) berbasis IntersectionObserver
     ---------------------------------------------------------
     `lazy(container, opts)` mengembalikan objek dengan:
       .observe(node, meta)  -> daftarkan node untuk dimuat saat terlihat
       .forget(node)         -> batalkan
     Root default = container (wadah yang bisa di-scroll). */
  P.lazy = function lazy(container, opts) {
    const o = opts || {};
    /* root: null berarti viewport; default = wadah yang bisa di-scroll */
    const root = Object.prototype.hasOwnProperty.call(o, "root") ? o.root : container;
    const margin = o.rootMargin || "300px";
    const onEnter = o.onEnter || (() => {});
    const pending = new Map(); // node -> meta
    let observer = null;

    const ensure = () => {
      if (observer || !window.IntersectionObserver) return;
      observer = new IntersectionObserver(
        (entries) => {
          for (const en of entries) {
            if (!en.isIntersecting) continue;
            const node = en.target;
            observer.unobserve(node);
            const meta = pending.get(node);
            pending.delete(node);
            if (meta) onEnter(node, meta);
          }
        },
        { root, rootMargin: margin }
      );
    };

    return {
      observe(node, meta) {
        pending.set(node, meta);
        if (!window.IntersectionObserver) {
          /* tanpa IntersectionObserver: muat langsung */
          pending.delete(node);
          onEnter(node, meta);
          return;
        }
        ensure();
        observer.observe(node);
      },
      forget(node) {
        pending.delete(node);
        if (observer) {
          try {
            observer.unobserve(node);
          } catch (_) {
            /* abaikan */
          }
        }
      },
      /* paksa muat sekarang (dipakai untuk thumbnail pertama) */
      load(node, meta) {
        if (observer) {
          try {
            observer.unobserve(node);
          } catch (_) {
            /* abaikan */
          }
        }
        pending.delete(node);
        onEnter(node, meta);
      },
    };
  };

  /* Jarak node ke pusat viewport — dipakai sebagai prioritas render. */
  P.distance = function distance(node) {
    if (!node || !node.getBoundingClientRect) return 0;
    const r = node.getBoundingClientRect();
    const h = window.innerHeight || 800;
    const tengah = r.top + r.height / 2 - h / 2;
    return Math.abs(tengah);
  };

  window.PDFPreview = P;
})();
