/* ============================================================
   Pemisah PDF — logika aplikasi (100% client-side)
   Library: pdf-lib (tulis/pecah) · pdf.js (pratinjau) · JSZip
   ============================================================ */
(() => {
  "use strict";

  const { PDFDocument } = PDFLib;

  /* ---------- identitas perangkat lunak di metadata PDF ----------
     Kredit "by Putra" sengaja hanya tampil di antarmuka web
     (header + footer), tidak ditulis ke dalam file PDF. */
  const PRODUCER = "Pemisah PDF";

  /* ---------- pdf.js worker ---------- */
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
  }

  /* ============================================================
     Mode gelap / terang
     ============================================================ */
  const THEME_KEY = "pemisah-pdf:theme";
  const THEME_COLORS = { light: "#ffffff", dark: "#0e1117" };

  function applyTheme(theme) {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    root.style.colorScheme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", THEME_COLORS[theme] || THEME_COLORS.light);
    const btn = $("#themeBtn");
    if (btn) {
      const dark = theme === "dark";
      btn.setAttribute("aria-pressed", dark ? "true" : "false");
      btn.setAttribute("aria-label", dark ? "Ganti ke mode terang" : "Ganti ke mode gelap");
      btn.title = dark ? "Mode gelap aktif — klik untuk mode terang" : "Mode terang — klik untuk mode gelap";
      btn.querySelector(".theme-moon").hidden = !dark;
      btn.querySelector(".theme-sun").hidden = dark;
    }
    document.dispatchEvent(new CustomEvent("themechange", { detail: { theme } }));
  }

  function readStoredTheme() {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch (_) {
      return null;
    }
  }

  function storeTheme(theme) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (_) {
      /* mode privat: abaikan */
    }
  }

  function initTheme() {
    const saved = readStoredTheme();
    const prefersDark =
      window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const theme = saved === "dark" || saved === "light" ? saved : prefersDark ? "dark" : "light";
    applyTheme(theme);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    const next = current === "dark" ? "light" : "dark";
    storeTheme(next);
    applyTheme(next);
  }

  /* ---------- elemen ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const dropzone = $("#dropzone");
  const fileInput = $("#fileInput");
  const workspace = $("#workspace");
  const filesEl = $("#files");
  const selInfo = $("#selInfo");
  const runBtn = $("#runBtn");
  const runLabel = $("#runLabel");
  const runHint = $("#runHint");
  const overlay = $("#overlay");
  const overlayText = $("#overlayText");
  const progressBar = $("#progressBar");
  const resultCard = $("#resultCard");
  const resultsEl = $("#results");
  const zipAllBtn = $("#zipAllBtn");
  const chunkOpt = $("#chunkOpt");
  const rangeOpt = $("#rangeOpt");
  const eachOpt = $("#eachOpt");

  /* ---------- state ---------- */
  const state = {
    files: [],          // {id, name, bytes, pageCount, doc, bookmarks, thumbs:true[]}
    selected: new Set(), // key = `${fileId}:${pageIndex}` — halaman terpilih
    deleted: new Set(),  // key = `${fileId}:${pageIndex}` — ditandai X (mode Hapus Halaman)
    results: [],        // {name, blob, url, size}
    busy: false,
    seq: 0,
  };
  let lastClicked = null; // {fileId, pageIndex}

  /* ============================================================
     Util
     ============================================================ */
  const key = (fid, p) => `${fid}:${p}`;
  const fmtSize = (b) => {
    if (b < 1024) return b + " B";
    if (b < 1024 * 1024) return (b / 1024).toFixed(0) + " KB";
    return (b / 1048576).toFixed(1) + " MB";
  };
  const baseName = (n) => n.replace(/\.pdf$/i, "") || "dokumen";
  const safe = (s) => s.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
  const nf = (n) => new Intl.NumberFormat("id-ID").format(n);

  function toast(msg, kind = "", ms = 3200) {
    const el = document.createElement("div");
    el.className = "toast " + kind;
    el.textContent = msg;
    $("#toasts").appendChild(el);
    setTimeout(() => {
      el.style.transition = "opacity .25s, transform .25s";
      el.style.opacity = "0";
      el.style.transform = "translateY(6px)";
      setTimeout(() => el.remove(), 260);
    }, ms);
  }

  function showOverlay(text = "Memproses…") {
    overlayText.textContent = text;
    progressBar.style.width = "0%";
    overlay.hidden = false;
  }
  function setProgress(pct) {
    progressBar.style.width = Math.max(0, Math.min(100, pct)) + "%";
  }
  function hideOverlay() {
    overlay.hidden = true;
  }

  const tick = () => new Promise((r) => setTimeout(r, 0));

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    try {
      a.click();
    } catch (e) {
      toast("Unduhan diblokir oleh pratinjau. Buka file HTML di tab browser biasa.", "err", 6000);
    }
    setTimeout(() => {
      a.remove();
      // beri waktu browser mengambil blob
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }, 500);
  }

  /* ============================================================
     Membaca file PDF
     ============================================================ */
  async function addFiles(fileList) {
    const files = Array.from(fileList).filter(
      (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name)
    );
    if (!files.length) {
      toast("Hanya file PDF yang didukung.", "err");
      return;
    }
    showOverlay("Membaca PDF…");
    let added = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      overlayText.textContent = `Membaca ${f.name}…`;
      setProgress(((i + 0.4) / files.length) * 100);
      try {
        await addOne(f);
        added++;
      } catch (err) {
        /* kondisi yang sudah ditangani (berkas rusak) -> warning, bukan error */
        console.warn(`Gagal membaca "${f.name}":`, pesanReader(err));
        toast(`Gagal membaca "${f.name}". ${pesanReader(err)}`.trim(), "err", 5000);
      }
      await tick();
    }
    hideOverlay();
    if (added) {
      render();
      toast(`${added} file PDF siap diproses.`, "ok");
      setTimeout(() => workspace.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
    }
  }

  async function addOne(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!bytes.length) throw new Error("File kosong.");
    if (!looksLikePdf(bytes)) throw new Error("Berkas ini bukan PDF yang valid.");

    let doc = null;
    try {
      doc = await PDFDocument.load(bytes, { updateMetadata: false });
    } catch (err) {
      if (isEncryptedError(err)) {
        const password = await askPassword(file.name);
        if (password === null) throw new Error("Dibatalkan karena PDF terkunci.");
        const opened = await decryptWithPdfjs(bytes, password);
        return addDecrypted(file, opened);
      }
      // struktur xref rusak/aneh: coba muat dengan toleransi
      try {
        doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
      } catch (err2) {
        // pdf-lib melempar error teknis (mis. TypeError "reading 'Pages'")
        // untuk PDF rusak total — ganti dengan kalimat yang dipahami pengguna.
        throw new Error(pesanReader(err2));
      }
    }
    if (!doc) throw new Error("Tidak dapat membaca struktur PDF.");

    const pageCount = doc.getPageCount();
    if (!pageCount) throw new Error("PDF tidak memiliki halaman.");

    const id = "f" + ++state.seq;
    const entry = {
      id,
      name: file.name,
      size: file.size,
      bytes,
      pageCount,
      doc,
      thumbs: new Array(pageCount).fill(false),
      bookmarks: null,
    };
    state.files.push(entry);
    for (let p = 0; p < pageCount; p++) state.selected.add(key(id, p));

    // bookmark / daftar isi (diam-diam, untuk mode pisah per penanda)
    entry.bookmarks = await readOutline(bytes).catch(() => []);
    return entry;
  }

  /* Pesan error teknis (mis. TypeError dari pdf-lib saat menghitung
     halaman PDF rusak) tidak boleh tampil mentah ke pengguna. */
  function pesanReader(err) {
    const m = String((err && err.message) || err || "").trim();
    const teknis = /cannot read|of undefined|typeerror|referenceerror|is not a function|unexpected token|invalid or unexpected|cannot access/i;
    if (!m) return "Berkas tidak bisa dibaca.";
    if (teknis.test(m)) return "Berkas rusak atau tidak bisa dibaca. Coba PDF lain.";
    return m;
  }

  function isEncryptedError(err) {
    return /encrypt|password|decrypt/i.test(String(err?.message || err));
  }

  /* cek magic bytes "%PDF-" ( tolerate junk di depan header ) */
  function looksLikePdf(bytes) {
    if (!bytes || bytes.length < 5) return false;
    const n = Math.min(bytes.length, 1024);
    for (let i = 0; i + 4 < n; i++) {
      if (
        bytes[i] === 0x25 && // %
        bytes[i + 1] === 0x50 && // P
        bytes[i + 2] === 0x44 && // D
        bytes[i + 3] === 0x46 && // F
        bytes[i + 4] === 0x2d // -
      )
        return true;
    }
    return false;
  }

  function askPassword(name) {
    return new Promise((resolve) => {
      const pw = window.prompt(`PDF "${name}" terkunci password.\nMasukkan password PDF:`, "");
      resolve(pw && pw.length ? pw : null);
    });
  }

  async function decryptWithPdfjs(bytes, password) {
    const task = pdfjsLib.getDocument({
      data: bytes.slice(0),
      password,
      isEvalSupported: false,
    });
    const doc = await task.promise;

    // Cara terbaik: pdf.js mengembalikan berkas asli yang sudah didekripsi,
    // sehingga teks, font, dan vektor tetap utuh (tidak dirasterisasi).
    try {
      if (typeof doc.saveDocument === "function") {
        const raw = await doc.saveDocument();
        if (raw && raw.length) {
          try { await doc.destroy(); } catch (_) {}
          toast("PDF terkunci berhasil dibuka (teks & vektor tetap utuh).", "ok", 4000);
          return new Uint8Array(raw);
        }
      }
    } catch (err) {
      console.warn("saveDocument gagal, memakai rasterisasi:", err);
    }

    // Cadangan: rasterisasi halaman (teks tidak lagi bisa dicari).
    const out = await PDFDocument.create();
    for (let i = 1; i <= doc.numPages; i++) {
      overlayText.textContent = `Membuka halaman ${i} dari ${doc.numPages}…`;
      setProgress((i / doc.numPages) * 100);
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.92));
      const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      const p = out.addPage([vp.width / 2, vp.height / 2]);
      p.drawImage(img, { x: 0, y: 0, width: vp.width / 2, height: vp.height / 2 });
      canvas.width = canvas.height = 0;
      await tick();
    }
    try { await doc.destroy(); } catch (_) {}
    const opened = await out.save({ useObjectStreams: false });
    toast("PDF berhasil dibuka (teks tidak lagi bisa dicari karena hasil dekripsi dirasterisasi).", "", 5000);
    return opened;
  }

  async function addDecrypted(file, openedBytes) {
    const doc = await PDFDocument.load(openedBytes, { updateMetadata: false });
    const id = "f" + ++state.seq;
    const entry = {
      id,
      name: file.name.replace(/\.pdf$/i, "") + " (terbuka).pdf",
      size: openedBytes.length,
      bytes: openedBytes,
      pageCount: doc.getPageCount(),
      doc,
      thumbs: new Array(doc.getPageCount()).fill(false),
      bookmarks: [],
    };
    state.files.push(entry);
    for (let p = 0; p < doc.getPageCount(); p++) state.selected.add(key(id, p));
    return entry;
  }

  async function readOutline(bytes) {
    const doc = await pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
    const outline = await doc.getOutline();
    if (!outline || !outline.length) return [];
    const flat = [];
    const walk = (items, depth) => {
      for (const it of items) {
        flat.push({ title: it.title || "Bagian", dest: it.dest, depth });
        if (it.items && it.items.length) walk(it.items, depth + 1);
      }
    };
    walk(outline, 0);

    const out = [];
    for (const item of flat) {
      let pageIdx = null;
      try {
        let dest = item.dest;
        if (typeof dest === "string") dest = await doc.getDestination(dest);
        if (Array.isArray(dest) && dest[0]) {
          const ref = dest[0];
          if (typeof ref === "number") pageIdx = ref;
          else pageIdx = await doc.getPageIndex(ref);
        }
      } catch (_) {
        /* abaikan */
      }
      if (pageIdx !== null && pageIdx >= 0) out.push({ title: item.title, page: pageIdx, depth: item.depth });
    }
    await doc.destroy();
    return out;
  }

  /* Strip tab bisa tergulir di layar sempit. Tab aktif harus
     selalu terlihat — offsetLeft diukur relatif terhadap
     offsetParent, jadi harus dikurangi posisi strip-nya. */
  function syncTabStrip() {
    const bar = document.querySelector(".tabs");
    const active = bar && bar.querySelector(".tab.active");
    if (!bar || !active) return;
    if (bar.scrollWidth <= bar.clientWidth + 1) { bar.scrollLeft = 0; return; }
    const rel = active.offsetLeft - bar.offsetLeft;
    bar.scrollLeft = Math.max(0, Math.min(rel - 8, bar.scrollWidth - bar.clientWidth));
  }

  /* ============================================================
     Render UI
     ============================================================ */
  function render() {
    const has = state.files.length > 0;
    workspace.hidden = !has || activeTab !== "split";
    dropzone.style.display = has || activeTab !== "split" ? "none" : "";
    const quick = $("#quickTools");
    if (quick) quick.hidden = has || activeTab !== "split";
    releaseThumbs(filesEl);
    filesEl.innerHTML = "";
    state.files.forEach((f) => filesEl.appendChild(fileBlock(f)));
    updateSelectionUI();
    updateRunState();
    zipAllBtn.hidden = state.results.length < 2;
  }

  /* lepaskan thumbnail lama (observer + object URL) supaya tidak bocor */
  function releaseThumbs(root) {
    if (!root) return;
    root.querySelectorAll("img[data-object-url]").forEach((img) => {
      try {
        URL.revokeObjectURL(img.src);
      } catch (_) {
        /* abaikan */
      }
    });
    root.querySelectorAll(".thumb").forEach((t) => {
      try {
        thumbObserver.unobserve(t);
      } catch (_) {
        /* abaikan */
      }
    });
  }

  function fileBlock(f) {
    const wrap = document.createElement("div");
    wrap.className = "fileblock";
    wrap.dataset.fid = f.id;

    const head = document.createElement("div");
    head.className = "fb-head";
    head.innerHTML = `
      <div class="fb-badge">PDF</div>
      <div class="fb-meta">
        <div class="fb-name" title="${escapeAttr(f.name)}"></div>
        <div class="fb-sub">${nf(f.pageCount)} halaman · ${fmtSize(f.size)}</div>
      </div>
      <div class="fb-actions">
        <button class="iconbtn" data-act="up" title="Naikkan urutan" aria-label="Naikkan urutan">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 6-6 6 6"/></svg>
        </button>
        <button class="iconbtn" data-act="down" title="Turunkan urutan" aria-label="Turunkan urutan">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 10 6 6 6-6"/></svg>
        </button>
        <button class="iconbtn danger" data-act="remove" title="Hapus file" aria-label="Hapus file">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14"/><path d="M9.5 7V5.4A1.4 1.4 0 0 1 10.9 4h2.2a1.4 1.4 0 0 1 1.4 1.4V7"/><path d="M7 7l.8 11.2A1.6 1.6 0 0 0 9.4 19.8h5.2a1.6 1.6 0 0 0 1.6-1.6L17 7"/></svg>
        </button>
      </div>`;
    head.querySelector(".fb-name").textContent = f.name;

    const pages = document.createElement("div");
    pages.className = "fb-pages";

    for (let p = 0; p < f.pageCount; p++) {
      /* <div role=button> (bukan <button>) supaya tombol X di dalam
         thumbnail tetap markup yang valid (tidak ada button bersarang). */
      const btn = document.createElement("div");
      btn.className = "thumb";
      btn.dataset.fid = f.id;
      btn.dataset.page = p;
      btn.setAttribute("role", "button");
      btn.setAttribute("tabindex", "0");
      btn.setAttribute("aria-pressed", "false");
      btn.setAttribute("aria-label", `Halaman ${p + 1} dari ${f.name}`);

      const num = document.createElement("span");
      num.className = "tnum";
      num.textContent = p + 1;

      const chk = document.createElement("span");
      chk.className = "tcheck";
      chk.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4.5 4.5L19 7"/></svg>`;

      /* tombol X: tandai halaman ini untuk dihapus (mode Hapus Halaman) */
      const close = document.createElement("button");
      close.type = "button";
      close.className = "tclose";
      close.dataset.fid = f.id;
      close.dataset.page = p;
      close.setAttribute("aria-label", `Tandai halaman ${p + 1} untuk dihapus`);
      close.title = "Tandai halaman ini untuk dihapus";
      close.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>`;

      const ph = document.createElement("div");
      ph.className = "ph";

      btn.append(num, chk, close, ph);
      pages.appendChild(btn);
      observeThumb(btn, f, p);
    }

    wrap.append(head, pages);

    head.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (!act) return;
      if (act === "remove") removeFile(f.id);
      if (act === "up") moveFile(f.id, -1);
      if (act === "down") moveFile(f.id, 1);
    });

    return wrap;
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function removeFile(fid) {
    const i = state.files.findIndex((f) => f.id === fid);
    if (i < 0) return;
    const [removed] = state.files.splice(i, 1);
    for (let p = 0; p < removed.pageCount; p++) {
      state.selected.delete(key(fid, p));
      state.deleted.delete(key(fid, p));
    }
    dropPdfjsDoc(fid);
    if (!state.files.length) clearWorkspace();
    else render();
  }

  function moveFile(fid, dir) {
    const i = state.files.findIndex((f) => f.id === fid);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= state.files.length) return;
    [state.files[i], state.files[j]] = [state.files[j], state.files[i]];
    render();
  }

  function clearWorkspace() {
    releaseThumbs(filesEl);
    state.files.forEach((f) => dropPdfjsDoc(f.id));
    revokeResults(state.results);
    state.files = [];
    state.selected.clear();
    state.results = [];
    lastClicked = null;
    filesEl.innerHTML = "";
    workspace.hidden = true;
    dropzone.style.display = activeTab === "split" ? "" : "none";
    const quick = $("#quickTools");
    if (quick) quick.hidden = activeTab !== "split";
    resultCard.hidden = true;
    resultsEl.innerHTML = "";
  }

  function revokeResults(list) {
    (list || []).forEach((r) => {
      if (r && r.url) {
        try {
          URL.revokeObjectURL(r.url);
        } catch (_) {
          /* abaikan */
        }
      }
    });
  }

  /* ---------- thumbnail lazy render ---------- */
  const thumbQueue = [];
  let thumbRunning = false;
  const thumbObserver = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const btn = en.target;
        thumbObserver.unobserve(btn);
        thumbQueue.push(btn);
        pumpThumbs();
      }
    },
    { rootMargin: "320px" }
  );

  function observeThumb(btn, f, p) {
    btn._f = f;
    btn._p = p;
    thumbObserver.observe(btn);
  }

  async function pumpThumbs() {
    if (thumbRunning) return;
    thumbRunning = true;
    while (thumbQueue.length) {
      const btn = thumbQueue.shift();
      try {
        await renderThumb(btn);
      } catch (err) {
        console.warn("Thumbnail halaman gagal dirender:", err);
      }
      await tick();
    }
    thumbRunning = false;
  }

  const pdfCache = new Map();
  async function getPdfjsDoc(f) {
    if (pdfCache.has(f.id)) return pdfCache.get(f.id);
    const p = pdfjsLib.getDocument({ data: f.bytes.slice(0), isEvalSupported: false }).promise;
    pdfCache.set(f.id, p);
    return p;
  }

  async function dropPdfjsDoc(fid) {
    const entry = pdfCache.get(fid);
    pdfCache.delete(fid);
    if (!entry) return;
    try {
      const doc = await entry;
      if (doc && typeof doc.destroy === "function") await doc.destroy();
    } catch (_) {
      /* abaikan */
    }
  }

  async function renderThumb(btn) {
    const f = btn._f;
    const p = btn._p;
    if (!f || !window.pdfjsLib) return;
    const pdf = await getPdfjsDoc(f);
    const page = await pdf.getPage(p + 1);
    const base = page.getViewport({ scale: 1 });
    const targetW = 190;
    const scale = Math.min(3, Math.max(0.2, targetW / base.width));
    const vp = page.getViewport({ scale: scale * (window.devicePixelRatio > 1 ? 1.6 : 1) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    if (!btn.isConnected) {
      canvas.width = canvas.height = 0;
      return;
    }
    const ph = btn.querySelector(".ph");
    if (!ph) {
      canvas.width = canvas.height = 0;
      return;
    }
    // blob URL lebih hemat memori daripada data-URL base64
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.72));
    canvas.width = canvas.height = 0;
    if (!blob || !btn.isConnected) return;
    const img = document.createElement("img");
    img.src = URL.createObjectURL(blob);
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.dataset.objectUrl = "1";
    ph.replaceWith(img);
  }

  /* ============================================================
     Seleksi
     ============================================================ */
  filesEl.addEventListener("click", (e) => {
    /* tombol X (tandai untuk dihapus) — tidak ikut ke logika pilih halaman */
    const xBtn = e.target.closest(".tclose");
    if (xBtn) {
      e.stopPropagation();
      e.preventDefault();
      toggleDeleted(xBtn.dataset.fid, Number(xBtn.dataset.page));
      return;
    }
    const btn = e.target.closest(".thumb");
    if (!btn) return;
    const fid = btn.dataset.fid;
    const p = Number(btn.dataset.page);
    const f = state.files.find((x) => x.id === fid);
    if (!f) return;

    if (e.shiftKey && lastClicked && lastClicked.fileId === fid) {
      const a = Math.min(lastClicked.pageIndex, p);
      const b = Math.max(lastClicked.pageIndex, p);
      for (let i = a; i <= b; i++) state.selected.add(key(fid, i));
    } else {
      const k = key(fid, p);
      if (state.selected.has(k)) state.selected.delete(k);
      else state.selected.add(k);
    }
    lastClicked = { fileId: fid, pageIndex: p };
    paintSelection();
    updateRunState();
  });

  /* Tandai/batalkan halaman untuk dihapus (ikon X). */
  function toggleDeleted(fid, p) {
    const k = key(fid, p);
    if (state.deleted.has(k)) state.deleted.delete(k);
    else state.deleted.add(k);
    paintSelection();
    updateRunState();
    const s = window.PDFShared;
    if (s && s.toast) {
      s.toast(state.deleted.has(k)
        ? `Halaman ${p + 1} ditandai untuk dihapus.`
        : `Tanda hapus halaman ${p + 1} dibatalkan.`);
    }
  }

  /* Halaman yang berlaku untuk alur saat ini. */
  function activeMarks() {
    return currentMode() === "remove" ? state.deleted : state.selected;
  }

  /* Thumbnail kini <div role=button>, jadi butuh pintasan keyboard. */
  filesEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
    const btn = e.target.closest(".thumb");
    if (!btn || e.target.closest(".tclose")) return;
    e.preventDefault();
    btn.click();
  });

  function paintSelection() {
    const rm = currentMode() === "remove";
    filesEl.querySelectorAll(".thumb").forEach((btn) => {
      const k = key(btn.dataset.fid, Number(btn.dataset.page));
      const on = rm ? state.deleted.has(k) : state.selected.has(k);
      btn.classList.toggle("sel", !rm && on);
      btn.classList.toggle("todelete", rm && on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    updateSelInfo();
  }

  function updateSelInfo() {
    const total = state.files.reduce((s, f) => s + f.pageCount, 0);
    if (currentMode() === "remove") {
      const n = state.deleted.size;
      selInfo.textContent = `${nf(n)} dari ${nf(total)} halaman ditandai untuk dihapus`;
      selInfo.classList.toggle("active", n > 0);
      return;
    }
    const n = state.selected.size;
    selInfo.textContent = `${nf(n)} dari ${nf(total)} halaman dipilih`;
    selInfo.classList.toggle("active", n > 0);
  }

  function updateSelectionUI() {
    paintSelection();
    updateSelInfo();
  }

  document.querySelector(".selbar").addEventListener("click", (e) => {
    const sel = e.target.closest("[data-sel]")?.dataset.sel;
    if (!sel) return;
    /* Di mode "Hapus halaman" tombol ini bekerja pada tanda hapus (ikon X),
       di mode lain pada halaman terpilih. */
    const target = activeMarks();
    if (sel === "all") {
      state.files.forEach((f) => {
        for (let p = 0; p < f.pageCount; p++) target.add(key(f.id, p));
      });
    } else if (sel === "none") {
      target.clear();
    } else if (sel === "invert") {
      state.files.forEach((f) => {
        for (let p = 0; p < f.pageCount; p++) {
          const k = key(f.id, p);
          if (target.has(k)) target.delete(k);
          else target.add(k);
        }
      });
    } else if (sel === "odd" || sel === "even") {
      target.clear();
      let g = 1;
      state.files.forEach((f) => {
        for (let p = 0; p < f.pageCount; p++, g++) {
          if ((sel === "odd" && g % 2 === 1) || (sel === "even" && g % 2 === 0)) {
            target.add(key(f.id, p));
          }
        }
      });
    }
    paintSelection();
    updateRunState();
  });

  /* ---------- daftar halaman terpilih (urut) ---------- */
  function selectedPages() {
    const out = [];
    for (const f of state.files) {
      for (let p = 0; p < f.pageCount; p++) {
        if (state.selected.has(key(f.id, p))) out.push({ file: f, page: p });
      }
    }
    return out;
  }

  function allPages() {
    const out = [];
    for (const f of state.files) for (let p = 0; p < f.pageCount; p++) out.push({ file: f, page: p });
    return out;
  }

  /* ============================================================
     Mode & status tombol
     ============================================================ */
  function currentMode() {
    return document.querySelector('input[name="mode"]:checked').value;
  }

  document.querySelectorAll('input[name="mode"]').forEach((r) => {
    r.addEventListener("change", () => {
      const m = currentMode();
      /* Tanda hapus (ikon X) hanya berlaku di mode "Hapus halaman". */
      if (m !== "remove") state.deleted.clear();
      chunkOpt.hidden = m !== "chunk";
      rangeOpt.hidden = m !== "range";
      eachOpt.hidden = m !== "each";
      if (m === "range" && !$("#rangeInput").value.trim()) {
        $("#rangeInput").value = suggestRanges();
      }
      paintSelection();
      updateRunState();
    });
  });

  $("#chunkSize").addEventListener("input", updateRunState);
  $("#chunkUseSel").addEventListener("change", updateRunState);
  $("#eachUseSel").addEventListener("change", updateRunState);
  $("#rangeInput").addEventListener("input", updateRunState);

  function suggestRanges() {
    const total = state.files.reduce((s, f) => s + f.pageCount, 0);
    if (!total) return "1-3, 4-6, 7-9";
    const cuts = [];
    let start = 1;
    while (start <= total) {
      const end = Math.min(total, start + 2);
      cuts.push(start === end ? `${start}` : `${start}-${end}`);
      start = end + 1;
    }
    return cuts.join(", ");
  }

  const SEL_LABELS = {
    all: ["Semua", "Tandai semua"],
    none: ["Kosong", "Bersihkan"],
    invert: ["Balik", "Balik tanda"],
    odd: ["Ganjil", "Ganjil"],
    even: ["Genap", "Genap"],
  };

  function updateRunState() {
    const mode = currentMode();
    /* CSS memakai atribut ini untuk menampilkan ikon X hanya di mode hapus. */
    filesEl.dataset.mode = mode;
    for (const b of filesEl.parentElement ? document.querySelectorAll(".selbar [data-sel]") : []) {
      const pair = SEL_LABELS[b.dataset.sel];
      if (!pair) continue;
      const label = mode === "remove" ? pair[1] : pair[0];
      if (b.textContent !== label) b.textContent = label;
    }
    const nSel = state.selected.size;
    const total = state.files.reduce((s, f) => s + f.pageCount, 0);
    let label = "Proses";
    let hint = "";
    let enabled = state.files.length > 0 && !state.busy;

    if (mode === "extract") {
      label = "Ekstrak jadi 1 PDF";
      enabled = enabled && nSel > 0;
      hint = nSel ? `${nf(nSel)} halaman akan digabung.` : "Pilih minimal 1 halaman.";
    } else if (mode === "remove") {
      const nDel = state.deleted.size;
      const left = total - nDel;
      label = "Hapus halaman bertanda X";
      enabled = enabled && nDel > 0 && left > 0;
      if (!nDel) hint = "Tekan ikon X pada halaman yang mau dibuang.";
      else if (left <= 0) hint = "Semua halaman ditandai — tidak ada yang tersisa.";
      else hint = `${nf(nDel)} halaman dibuang, ${nf(left)} halaman tersisa.`;
    } else if (mode === "each") {
      const useSel = $("#eachUseSel").checked;
      const eff = useSel ? nSel : total;
      label = "Pisah tiap halaman";
      hint = useSel
        ? nSel
          ? `${nf(eff)} file PDF (halaman terpilih) dalam satu ZIP.`
          : "Pilih minimal 1 halaman."
        : `${nf(eff)} file PDF dalam satu ZIP.`;
      enabled = enabled && eff > 0;
    } else if (mode === "chunk") {
      const N = Math.max(1, parseInt($("#chunkSize").value, 10) || 1);
      const eff = $("#chunkUseSel").checked ? nSel : total;
      const files = Math.ceil(eff / N);
      label = "Pisah per " + N + " halaman";
      hint = eff ? `${nf(files)} file PDF (${nf(eff)} halaman ÷ ${N}).` : "Tidak ada halaman.";
      enabled = enabled && eff > 0;
    } else if (mode === "range") {
      const spec = $("#rangeInput").value.trim();
      const parsed = parseRanges(spec, total);
      label = "Pisah per rentang";
      if (parsed.error) {
        hint = parsed.error;
        enabled = false;
      } else {
        hint = `${nf(parsed.ranges.length)} file PDF akan dibuat.`;
        enabled = enabled && parsed.ranges.length > 0;
      }
    } else if (mode === "bookmark") {
      const hasBm = state.files.some((f) => f.bookmarks && f.bookmarks.length);
      label = "Pisah per penanda";
      hint = hasBm ? "Setiap penanda buku jadi file sendiri." : "PDF ini tidak punya penanda buku / daftar isi.";
      enabled = enabled && hasBm;
    }

    runLabel.textContent = label;
    runHint.textContent = hint;
    runBtn.disabled = !enabled;
  }

  /* ============================================================
     Parse rentang
     ============================================================ */
  function parseRanges(spec, max) {
    const ranges = [];
    if (!spec) return { ranges, error: "Isi rentang, misal 1-3, 4-8, 9." };
    const parts = spec.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      const m = part.match(/^(\d+)\s*(?:[-–—]\s*(\d+))?$/);
      if (!m) return { ranges: [], error: `Rentang "${part}" tidak valid.` };
      let a = parseInt(m[1], 10);
      let b = m[2] ? parseInt(m[2], 10) : a;
      if (a > b) [a, b] = [b, a];
      if (a < 1) a = 1;
      if (b > max) b = max;
      if (a > max) return { ranges: [], error: `Halaman ${a} melebihi jumlah halaman (${max}).` };
      ranges.push({ from: a - 1, to: b - 1, label: a === b ? `${a}` : `${a}-${b}` });
    }
    if (!ranges.length) return { ranges, error: "Tidak ada rentang yang bisa dipakai." };
    return { ranges, error: null };
  }

  /* ============================================================
     Inti: menulis PDF
     ============================================================ */
  async function buildPdf(pages) {
    if (!pages.length) throw new Error("Tidak ada halaman untuk ditulis.");
    const out = await PDFDocument.create();
    out.setProducer(PRODUCER);
    out.setCreator(PRODUCER + " (pdf-lib)");
    out.setCreationDate(new Date());

    // Kelompokkan per file agar copyPages efisien, tetapi urutan
    // halaman akhir tetap persis seperti urutan yang diminta.
    const groups = new Map();
    for (const p of pages) {
      if (!groups.has(p.file.id)) groups.set(p.file.id, { file: p.file, idx: [] });
      groups.get(p.file.id).idx.push(p.page);
    }
    const copied = new Map(); // "fileId:pageIndex" -> PDFPage
    for (const { file, idx } of groups.values()) {
      const list = await out.copyPages(file.doc, idx);
      list.forEach((cp, i) => copied.set(key(file.id, idx[i]), cp));
    }
    for (const p of pages) {
      const cp = copied.get(key(p.file.id, p.page));
      if (cp) out.addPage(cp);
    }
    const bytes = await out.save({ useObjectStreams: true, addDefaultPage: false });
    return new Blob([bytes], { type: "application/pdf" });
  }

  /* ============================================================
     Jalankan proses
     ============================================================ */
  runBtn.addEventListener("click", async () => {
    if (state.busy) return;
    if (!runBtn.disabled) await run();
  });

  async function run() {
    const mode = currentMode();
    state.busy = true;
    runBtn.disabled = true;
    showOverlay("Menyiapkan…");
    await tick();

    try {
      const made = [];

      if (mode === "extract") {
        const sel = selectedPages();
        overlayText.textContent = `Menggabungkan ${sel.length} halaman…`;
        setProgress(20);
        const blob = await buildPdf(sel);
        setProgress(90);
        const name = resultNameForExtract(sel);
        made.push({ name, blob, url: URL.createObjectURL(blob), size: blob.size });
      } else if (mode === "remove") {
        const drop = new Set(state.deleted);
        const sel = allPages().filter((it) => drop.has(key(it.file.id, it.page)));
        const keep = allPages().filter((it) => !drop.has(key(it.file.id, it.page)));
        if (!sel.length) throw new Error("Belum ada halaman yang ditandai — tekan ikon X pada halaman yang mau dibuang.");
        if (!keep.length) throw new Error("Semua halaman dibuang — tidak ada yang tersisa.");
        overlayText.textContent = `Membuang ${sel.length} halaman…`;
        setProgress(25);
        const blob = await buildPdf(keep);
        setProgress(90);
        const first = state.files[0];
        const name = `${safe(baseName(first ? first.name : "dokumen"))}-hapus-halaman.pdf`;
        made.push({ name, blob, url: URL.createObjectURL(blob), size: blob.size });
      } else if (mode === "each") {
        const list = $("#eachUseSel").checked ? selectedPages() : allPages();
        const zip = new JSZip();
        const pad = String(list.length).length;
        for (let i = 0; i < list.length; i++) {
          const it = list[i];
          overlayText.textContent = `Halaman ${i + 1} dari ${list.length}…`;
          setProgress(((i + 1) / list.length) * 85);
          const blob = await buildPdf([it]);
          const nm = `${safe(baseName(it.file.name))}-hal-${String(it.page + 1).padStart(pad, "0")}.pdf`;
          zip.file(nm, blob);
          made.push({ name: nm, blob, url: URL.createObjectURL(blob), size: blob.size });
          await tick();
        }
        overlayText.textContent = "Membuat ZIP…";
        setProgress(92);
        const zipBlob = await zip.generateAsync({ type: "blob", compression: "STORE" }, (m) =>
          setProgress(92 + m.percent * 0.08)
        );
        made.unshift({
          name: (list.length === 1 ? safe(baseName(list[0].file.name)) : "hasil-pisah") + ".zip",
          blob: zipBlob,
          url: URL.createObjectURL(zipBlob),
          size: zipBlob.size,
          isZip: true,
        });
      } else if (mode === "chunk") {
        const N = Math.max(1, parseInt($("#chunkSize").value, 10) || 1);
        const list = $("#chunkUseSel").checked ? selectedPages() : allPages();
        const groups = [];
        for (let i = 0; i < list.length; i += N) groups.push(list.slice(i, i + N));
        const zip = new JSZip();
        for (let g = 0; g < groups.length; g++) {
          overlayText.textContent = `Bagian ${g + 1} dari ${groups.length}…`;
          setProgress(((g + 1) / groups.length) * 85);
          const blob = await buildPdf(groups[g]);
          const firstFile = groups[g][0].file;
          const from = groups[g][0].page + 1;
          const to = groups[g][groups[g].length - 1].page + 1;
          const nm = `${safe(baseName(firstFile.name))}-hal-${from}-${to}.pdf`;
          zip.file(nm, blob);
          made.push({ name: nm, blob, url: URL.createObjectURL(blob), size: blob.size });
          await tick();
        }
        const zipBlob = await zip.generateAsync({ type: "blob", compression: "STORE" }, (m) =>
          setProgress(85 + m.percent * 0.15)
        );
        made.unshift({
          name: "hasil-pisah.zip",
          blob: zipBlob,
          url: URL.createObjectURL(zipBlob),
          size: zipBlob.size,
          isZip: true,
        });
      } else if (mode === "range") {
        const total = state.files.reduce((s, f) => s + f.pageCount, 0);
        const parsed = parseRanges($("#rangeInput").value.trim(), total);
        if (parsed.error) throw new Error(parsed.error);
        const flat = allPages();
        const zip = new JSZip();
        for (let i = 0; i < parsed.ranges.length; i++) {
          const r = parsed.ranges[i];
          overlayText.textContent = `Rentang ${r.label} (${i + 1}/${parsed.ranges.length})…`;
          setProgress(((i + 1) / parsed.ranges.length) * 85);
          const blob = await buildPdf(flat.slice(r.from, r.to + 1));
          const nm = `hasil-hal-${r.label}.pdf`;
          zip.file(nm, blob);
          made.push({ name: nm, blob, url: URL.createObjectURL(blob), size: blob.size });
          await tick();
        }
        const zipBlob = await zip.generateAsync({ type: "blob", compression: "STORE" }, (m) =>
          setProgress(85 + m.percent * 0.15)
        );
        made.unshift({
          name: "hasil-rentang.zip",
          blob: zipBlob,
          url: URL.createObjectURL(zipBlob),
          size: zipBlob.size,
          isZip: true,
        });
      } else if (mode === "bookmark") {
        const jobs = [];
        for (const f of state.files) {
          const bms = (f.bookmarks || []).slice().sort((a, b) => a.page - b.page);
          if (!bms.length) continue;
          const uniq = [];
          for (const b of bms) {
            if (!uniq.length || uniq[uniq.length - 1].page !== b.page) uniq.push(b);
          }
          uniq.forEach((b, i) => {
            const nextPage = i + 1 < uniq.length ? uniq[i + 1].page - 1 : f.pageCount - 1;
            jobs.push({ file: f, from: b.page, to: Math.max(b.page, nextPage), title: b.title, idx: i + 1 });
          });
        }
        if (!jobs.length) throw new Error("Tidak ada penanda buku yang bisa dipakai.");
        const zip = new JSZip();
        const pad = String(jobs.length).length;
        for (let i = 0; i < jobs.length; i++) {
          const j = jobs[i];
          overlayText.textContent = `Bagian "${j.title.slice(0, 40)}"…`;
          setProgress(((i + 1) / jobs.length) * 85);
          const pages = [];
          for (let p = j.from; p <= j.to; p++) pages.push({ file: j.file, page: p });
          const blob = await buildPdf(pages);
          const nm = `${String(j.idx).padStart(pad, "0")}-${safe(j.title).slice(0, 60) || "bagian"}.pdf`;
          zip.file(nm, blob);
          made.push({ name: nm, blob, url: URL.createObjectURL(blob), size: blob.size });
          await tick();
        }
        const zipBlob = await zip.generateAsync({ type: "blob", compression: "STORE" }, (m) =>
          setProgress(85 + m.percent * 0.15)
        );
        made.unshift({
          name: "hasil-per-bab.zip",
          blob: zipBlob,
          url: URL.createObjectURL(zipBlob),
          size: zipBlob.size,
          isZip: true,
        });
      }

      setProgress(100);
      revokeResults(state.results);
      state.results = made;
      showResults(made);

      if ($("#autoDownload").checked && made.length) {
        downloadBlob(made[0].blob, made[0].name);
      }
      toast(
        made.length > 1
          ? `Selesai — ${made.length - 1} file dibuat${made[0].isZip ? " (dibungkus ZIP)" : ""}.`
          : "Selesai — file siap diunduh.",
        "ok"
      );
    } catch (err) {
      console.error(err);
      toast("Gagal memproses: " + (err?.message || err), "err", 6000);
    } finally {
      state.busy = false;
      hideOverlay();
      updateRunState();
    }
  }

  function resultNameForExtract(pages) {
    if (!pages.length) return "hasil-ekstrak.pdf";
    const firstFile = pages[0].file;
    const onlyOne = pages.every((p) => p.file.id === firstFile.id);
    if (onlyOne) {
      if (pages.length === firstFile.pageCount) return safe(baseName(firstFile.name)) + "-salinan.pdf";
      const from = pages[0].page + 1;
      const to = pages[pages.length - 1].page + 1;
      return `${safe(baseName(firstFile.name))}-hal-${from}-${to}.pdf`;
    }
    return "hasil-gabungan.pdf";
  }

  function showResults(made) {
    resultCard.hidden = false;
    resultsEl.innerHTML = "";
    made.forEach((r) => {
      const row = document.createElement("div");
      row.className = "result";
      const nm = document.createElement("div");
      nm.className = "rname";
      nm.textContent = r.name;
      nm.title = r.name;
      const sz = document.createElement("span");
      sz.className = "rsize";
      sz.textContent = fmtSize(r.size);
      const a = document.createElement("a");
      a.className = "rl";
      a.textContent = "Unduh";
      a.href = r.url;
      a.download = r.name;
      row.append(nm, sz, a);
      resultsEl.appendChild(row);
    });
    zipAllBtn.hidden = made.length < 2;
  }

  zipAllBtn.addEventListener("click", async () => {
    if (!state.results.length) return;
    try {
      showOverlay("Membuat ZIP…");
      const zip = new JSZip();
      // jangan masukkan ZIP ke dalam ZIP (lebih hemat dan rapi)
      for (const r of state.results) {
        if (!r.isZip) zip.file(r.name, r.blob);
      }
      const blob = await zip.generateAsync({ type: "blob", compression: "STORE" }, (m) =>
        setProgress(m.percent)
      );
      hideOverlay();
      downloadBlob(blob, "semua-hasil.zip");
    } catch (e) {
      hideOverlay();
      toast("Gagal membuat ZIP.", "err");
    }
  });

  /* ============================================================
     Input file / drop / demo
     ============================================================ */
  const openPicker = () => fileInput.click();
  $("#browseBtn").addEventListener("click", openPicker);
  $("#pickBtn").addEventListener("click", openPicker);
  $("#addMoreBtn").addEventListener("click", openPicker);
  $("#clearBtn").addEventListener("click", () => {
    if (!state.files.length) return;
    if (confirm("Kosongkan semua file yang sudah dimuat?")) {
      clearWorkspace();
      toast("Workspace dikosongkan.");
    }
  });

  fileInput.addEventListener("change", (e) => {
    const fl = e.target.files;
    if (fl && fl.length) addFiles(fl);
    fileInput.value = "";
  });

  dropzone.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    openPicker();
  });
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPicker();
    }
  });

  let dragDepth = 0;
  const onDragEnter = (e) => {
    if (activeTab !== "split") return;
    if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
    e.preventDefault();
    dragDepth++;
    dropzone.classList.add("drag");
    if (state.files.length) workspace.classList.add("drag-over");
  };
  const onDragOver = (e) => {
    if (activeTab !== "split") return;
    if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = (e) => {
    if (activeTab !== "split") return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropzone.classList.remove("drag");
  };
  const onDrop = (e) => {
    if (activeTab !== "split") return;
    if (!e.dataTransfer) return;
    e.preventDefault();
    dragDepth = 0;
    dropzone.classList.remove("drag");
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };
  ["dragenter", "dragover", "dragleave", "drop"].forEach((ev) => {
    window.addEventListener(ev, (e) => {
      if (ev === "dragenter") onDragEnter(e);
      if (ev === "dragover") onDragOver(e);
      if (ev === "dragleave") onDragLeave(e);
      if (ev === "drop") onDrop(e);
    });
  });

  /* ---------- contoh PDF ---------- */
  $("#demoBtn").addEventListener("click", async () => {
    try {
      showOverlay("Membuat contoh PDF…");
      const blob = await makeDemoPdf();
      const file = new File([blob], "contoh-dokumen.pdf", { type: "application/pdf" });
      hideOverlay();
      await addFiles([file]);
    } catch (e) {
      hideOverlay();
      toast("Gagal membuat contoh.", "err");
    }
  });

  async function makeDemoPdf() {
    const { StandardFonts, rgb } = PDFLib;
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const fontR = await doc.embedFont(StandardFonts.Helvetica);
    const palette = [
      [0.23, 0.36, 0.99],
      [0.06, 0.62, 0.46],
      [0.77, 0.48, 0.06],
      [0.85, 0.31, 0.25],
      [0.44, 0.32, 0.85],
    ];
    const sections = ["Pendahuluan", "Ringkasan", "Metode", "Hasil", "Lampiran"];
    const total = 12;
    for (let i = 0; i < total; i++) {
      const page = doc.addPage([595.28, 841.89]);
      const c = palette[i % palette.length];
      page.drawRectangle({ x: 0, y: 761.89, width: 595.28, height: 80, color: rgb(...c) });
      page.drawText("CONTOH DOKUMEN", {
        x: 48, y: 806, size: 11, font, color: rgb(1, 1, 1), opacity: 0.85,
      });
      page.drawText(`Halaman ${i + 1}`, { x: 48, y: 778, size: 26, font, color: rgb(1, 1, 1) });
      page.drawText(`Bagian: ${sections[i % sections.length]}`, {
        x: 48, y: 700, size: 16, font, color: rgb(...c),
      });
      for (let l = 0; l < 14; l++) {
        const w = 320 + ((i * 37 + l * 61) % 180);
        page.drawRectangle({
          x: 48, y: 660 - l * 20, width: w, height: 7,
          color: rgb(0.87, 0.89, 0.93),
        });
      }
      page.drawText(`Dibuat otomatis untuk mencoba fitur pemisah PDF — halaman ${i + 1} dari ${total}.`, {
        x: 48, y: 92, size: 10, font: fontR, color: rgb(0.45, 0.48, 0.56),
      });
      page.drawText(String(i + 1), {
        x: 290, y: 46, size: 10, font: fontR, color: rgb(0.55, 0.58, 0.66),
      });
    }
    return doc.save();
  }


  /* ============================================================
     TAB: Pemisah halaman / Gabung PDF
     ============================================================ */
  let activeTab = "split";

  function setTab(tab) {
    activeTab = tab;
    /* Siapkan pool encoder JPEG lebih awal: worker baru butuh
       "pemasanan" sekali, dan biayanya cukup besar kalau muncul
       di tengah kompresi. */
    if (tab === "compress" && window.PDFCompressor && typeof window.PDFCompressor.warmEncoder === "function") {
      try { window.PDFCompressor.warmEncoder(); } catch (_) {}
    }
    document.querySelectorAll(".tab").forEach((t) => {
      const on = t.dataset.tab === tab;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    syncTabStrip();
    const isSplit = tab === "split";
    const isMerge = tab === "merge";
    const isCompress = tab === "compress";
    const isTools = tab === "tools";

    $("#mergeView").hidden = !isMerge;
    $("#compressView").hidden = !isCompress;
    $("#toolsView").hidden = !isTools;
    $("#toolView").hidden = true;
    if (isTools && window.PDFToolsUI) window.PDFToolsUI.renderLauncher();
    workspace.hidden = !isSplit || !state.files.length;
    dropzone.style.display = isSplit && !state.files.length ? "" : "none";
    const quick = $("#quickTools");
    if (quick) quick.hidden = !isSplit || !!state.files.length;
    syncTabStrip();

    if (isMerge) {
      $("#mergeDrop").hidden = merge.files.length > 0;
      mergeRender();
    }
    if (isCompress) {
      $("#compressDrop").hidden = compress.files.length > 0;
      compressRender();
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const tabButtons = Array.from(document.querySelectorAll(".tab"));
  document.querySelector(".tabs").addEventListener("click", (e) => {
    const t = e.target.closest(".tab");
    if (t) setTab(t.dataset.tab);
  });

  /* navigasi keyboard antar tab (standar WAI-ARIA) */
  document.querySelector(".tabs").addEventListener("keydown", (e) => {
    const idx = tabButtons.indexOf(document.activeElement);
    if (idx < 0) return;
    let next = -1;
    if (e.key === "ArrowRight") next = (idx + 1) % tabButtons.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + tabButtons.length) % tabButtons.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabButtons.length - 1;
    if (next >= 0) {
      e.preventDefault();
      tabButtons[next].focus();
      setTab(tabButtons[next].dataset.tab);
    }
  });

  /* ---------- state gabung ---------- */
  const merge = {
    files: [],      // {uid, name, bytes, doc, pageCount, uniqPages, allPages, thumbs:Set|null, size}
    results: [],
    busy: false,
    /* Urutan HALAMAN di hasil gabung. Tiap entri = {uid, page} dengan
       page 0-based di berkas asalnya. */
    order: [],
    /* asis = sesuai urutan file, balik = seluruh halaman dibalik,
       kustom = susunan manual pengguna. */
    orderMode: "asis",
  };
  let mergeUid = 0;
  let dragUid = null;

  /* ---------- state perkiraan ukuran hasil gabung ---------- */
  const MERGE_EST_MAX_BYTES = 150 * 1024 * 1024; // batas aman agar memori tidak meledak

  const mergeEst = {
    key: null,      // uid+jumlah halaman+ukuran tiap file, sesuai urutan saat ini
    size: 0,        // ukuran file gabungan dalam byte
    state: "idle",  // idle | loading | ok | error | skipped
    running: false,
    pending: false,
    timer: null,
  };

  function setMergeDropVisible() {
    $("#mergeDrop").hidden = merge.files.length > 0;
  }

  /* ============================================================
     Pratinjau urutan halaman
     ------------------------------------------------------------
     Menampilkan setiap halaman yang akan masuk hasil gabung
     sebagai kartu ber-thumbnail, lalu membiarkan pengguna
     mengubah urutannya: "Sesuai file", "Dibalik", atau "Kustom"
     (seret / tombol panah).
     ============================================================ */
  const mergePreview = {
    observer: null,
    dragIndex: -1,
  };

  /* Urutan dasar: file berurutan, halaman berurutan di dalamnya. */
  function mergeBaseOrder() {
    const out = [];
    for (const f of merge.files) {
      for (let p = 0; p < f.pageCount; p++) out.push({ uid: f.uid, page: p });
    }
    return out;
  }

  /* Selaraskan urutan halaman dengan daftar file yang sekarang.
     - mode "asis"/"balik": dibangun ulang dari daftar file.
     - mode "kustom": susunan pengguna dipertahankan; halaman baru
       (dari file yang ditambahkan) ditambahkan di akhir. */
  function mergeSyncOrder() {
    if (merge.orderMode !== "kustom") {
      const base = mergeBaseOrder();
      merge.order = merge.orderMode === "balik" ? base.reverse() : base;
      return;
    }
    const known = new Set(merge.files.map((f) => f.uid));
    const seen = new Set();
    const next = [];
    for (const o of merge.order) {
      if (!known.has(o.uid)) continue;
      const key = o.uid + ":" + o.page;
      if (seen.has(key)) continue;
      seen.add(key);
      next.push(o);
    }
    for (const b of mergeBaseOrder()) {
      const key = b.uid + ":" + b.page;
      if (seen.has(key)) continue;
      seen.add(key);
      next.push(b);
    }
    merge.order = next;
  }

  function mergeFileByUid(uid) {
    return merge.files.find((f) => f.uid === uid) || null;
  }

  /* Pindah satu halaman dalam urutan hasil gabung. */
  function mergeMovePage(index, delta) {
    const to = index + delta;
    if (index < 0 || index >= merge.order.length) return;
    if (to < 0 || to >= merge.order.length) return;
    const [item] = merge.order.splice(index, 1);
    merge.order.splice(to, 0, item);
    merge.orderMode = "kustom";
    mergeRenderPreview();
    mergeEstimateSchedule(150);
  }

  /* Pindahkan halaman ke posisi baru ( hasil seret ). */
  function mergeMovePageTo(from, to) {
    if (from === to) return;
    if (from < 0 || from >= merge.order.length) return;
    if (to < 0 || to >= merge.order.length) return;
    const [item] = merge.order.splice(from, 1);
    merge.order.splice(to, 0, item);
    merge.orderMode = "kustom";
    mergeRenderPreview();
    mergeEstimateSchedule(150);
  }

  function mergeSetOrderMode(mode) {
    const m = mode === "balik" || mode === "kustom" ? mode : "asis";
    if (m === "kustom") {
      /* susunan saat ini jadi titik awal mode kustom */
      merge.orderMode = "kustom";
    } else {
      merge.orderMode = m;
      mergeSyncOrder();
    }
    mergeRenderPreview();
    mergeEstimateSchedule(150);
  }

  /* Thumbnail satu halaman (dimuat saat kartu benar-benar terlihat).
     Gambar ~2x ukuran tampilan supaya tetap tajam di layar DPI tinggi. */
  async function mergePageThumb(el, f, pageNo) {
    if (!el || el.dataset.done === "1") return;
    el.dataset.done = "1";
    try {
      const pdf = await getThumbDoc(f);
      const page = await pdf.getPage(pageNo + 1);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(2.6, 210 / base.height) * 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      if (!el.isConnected) { canvas.width = canvas.height = 0; return; }
      const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.72));
      canvas.width = canvas.height = 0;
      if (!blob) return;
      const img = document.createElement("img");
      img.src = URL.createObjectURL(blob);
      img.alt = "";
      img.dataset.objectUrl = "1";
      img.className = "mp-thumb-img";
      /* gambar replaces isi kotak, bukan kotaknya sendiri, supaya
         ukurannya tetap mengikuti kotak aspect-ratio 3/4 */
      el.replaceChildren(img);
    } catch (err) {
      /* halaman tidak bisa dirender -> biarkan kotak kosong */
    }
  }

  function mergeRenderPreview() {
    const card = $("#mergePreviewCard");
    const grid = $("#mergePreviewGrid");
    const info = $("#mergePreviewInfo");
    if (!card || !grid) return;

    mergeSyncOrder();

    const nFile = merge.files.length;
    const nHal = merge.order.length;
    if (!nFile) {
      card.hidden = true;
      grid.innerHTML = "";
      return;
    }
    card.hidden = false;

    /* lepaskan thumbnail lama */
    releaseThumbs(grid);
    grid.innerHTML = "";

    /* chip mode */
    for (const chip of grid.parentElement.querySelectorAll(".mchip[data-order]")) {
      const on = chip.dataset.order === merge.orderMode;
      chip.classList.toggle("is-on", on);
      chip.setAttribute("aria-pressed", String(on));
    }

    /* ringkasan */
    const label = {
      asis: "sesuai urutan file",
      balik: "dibalik (dari halaman terakhir)",
      kustom: "kustom (susunan manual)",
    }[merge.orderMode] || "kustom";
    if (info) {
      info.textContent = nHal
        ? `${nf(nHal)} halaman · urutan ${label}`
        : "Belum ada halaman untuk disusun.";
    }

    /* kartu halaman */
    merge.order.forEach((o, idx) => {
      const f = mergeFileByUid(o.uid);
      const cell = document.createElement("div");
      cell.className = "mp-cell";
      cell.setAttribute("role", "listitem");
      cell.draggable = true;
      cell.dataset.index = String(idx);
      cell.dataset.uid = o.uid;
      cell.dataset.page = String(o.page);

      const thumbWrap = document.createElement("div");
      thumbWrap.className = "mp-thumb";
      const ph = document.createElement("span");
      ph.className = "mp-thumb-empty";
      ph.textContent = "…";
      thumbWrap.appendChild(ph);
      cell.appendChild(thumbWrap);

      const pos = document.createElement("span");
      pos.className = "mp-pos";
      pos.textContent = String(idx + 1);
      cell.appendChild(pos);

      const meta = document.createElement("div");
      meta.className = "mp-meta";
      const src = document.createElement("span");
      src.className = "mp-src";
      src.textContent = f ? `${f.name} · hal. ${o.page + 1}` : `hal. ${o.page + 1}`;
      src.title = src.textContent;
      meta.appendChild(src);
      cell.appendChild(meta);

      const acts = document.createElement("div");
      acts.className = "mp-acts";
      const mk = (label2, title, disabled, fn) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "mp-btn";
        b.textContent = label2;
        b.title = title;
        b.setAttribute("aria-label", title);
        if (disabled) b.disabled = true;
        b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
        return b;
      };
      acts.appendChild(mk("←", "Geser halaman ini ke depan", idx === 0, () => mergeMovePage(idx, -1)));
      acts.appendChild(mk("→", "Geser halaman ini ke belakang", idx === nHal - 1, () => mergeMovePage(idx, 1)));
      cell.appendChild(acts);

      /* seret untuk mengubah urutan */
      cell.addEventListener("dragstart", (e) => {
        mergePreview.dragIndex = idx;
        cell.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", String(idx)); } catch (_) {}
      });
      cell.addEventListener("dragend", () => {
        mergePreview.dragIndex = -1;
        cell.classList.remove("dragging");
        grid.querySelectorAll(".mp-cell.drop-target").forEach((c) => c.classList.remove("drop-target"));
      });
      cell.addEventListener("dragover", (e) => {
        if (mergePreview.dragIndex < 0) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        cell.classList.add("drop-target");
      });
      cell.addEventListener("dragleave", () => cell.classList.remove("drop-target"));
      cell.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const from = mergePreview.dragIndex;
        mergePreview.dragIndex = -1;
        cell.classList.remove("drop-target");
        if (from < 0) return;
        mergeMovePageTo(from, idx);
      });

      grid.appendChild(cell);

      /* thumbnail dimuat saat kartu terlihat (hemat memori) */
      if (f) {
        const load = () => mergePageThumb(thumbWrap, f, o.page);
        if (window.IntersectionObserver) {
          if (!mergePreview.observer) {
            mergePreview.observer = new IntersectionObserver((entries) => {
              for (const en of entries) {
                if (!en.isIntersecting) continue;
                const target = en.target;
                mergePreview.observer.unobserve(target);
                const uid = target.dataset.uid;
                const page = Number(target.dataset.page);
                const ff = mergeFileByUid(uid);
                if (!ff) continue;
                const slot = target.querySelector(".mp-thumb");
                if (slot) mergePageThumb(slot, ff, page);
              }
            }, { root: grid.closest(".merge-view") || null, rootMargin: "200px" });
          }
          mergePreview.observer.observe(cell);
        } else {
          void load();
        }
      }
    });
  }

  function mergeRender() {
    const listEl = $("#mlist");
    releaseThumbs(listEl);
    listEl.innerHTML = "";
    merge.files.forEach((f, i) => listEl.appendChild(mergeRow(f, i)));
    setMergeDropVisible();

    const n = merge.files.length;
    const pages = merge.files.reduce((s, f) => s + f.pageCount, 0);
    $("#mergeInfo").textContent = n ? `${nf(n)} file` : "Belum ada file";
    $("#mergePagesInfo").textContent = n ? `${nf(pages)} halaman akan digabung` : "Tarik file PDF untuk mulai";
    $("#mergeRunBtn").disabled = n < 2 || pages === 0;
    $("#mergeInfo").classList.toggle("active", n > 0);

    // pratinjau urutan halaman ikut diperbarui
    mergeRenderPreview();

    // begitu daftar/urutan berubah, angka lama langsung ditandai kedaluwarsa
    // supaya yang tampil bukan angka basi.
    if (n >= 2 && mergeEstKey() !== mergeEst.key) mergeEst.state = "loading";

    mergeEstRender();
    mergeEstimateSchedule();

  }

  function mergeRow(f, i) {
    const row = document.createElement("div");
    row.className = "mrow";
    row.draggable = true;
    row.dataset.uid = f.uid;

    row.innerHTML = `
      <span class="mhandle" title="Tarik untuk mengubah urutan" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="7" r="1.4"/><circle cx="15" cy="7" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="17" r="1.4"/><circle cx="15" cy="17" r="1.4"/></svg>
      </span>
      <span class="morder">${i + 1}</span>
      <span class="mthumb"></span>
      <span class="mmeta">
        <span class="mname"></span>
        <span class="msub">${nf(f.pageCount)} halaman · ${fmtSize(f.size)}</span>
      </span>
      <span class="mrow-actions">
        <button class="iconbtn" data-act="up" title="Naikkan" aria-label="Naikkan urutan">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 6-6 6 6"/></svg>
        </button>
        <button class="iconbtn" data-act="down" title="Turunkan" aria-label="Turunkan urutan">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 10 6 6 6-6"/></svg>
        </button>
        <button class="iconbtn danger" data-act="remove" title="Hapus file" aria-label="Hapus file">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14"/><path d="M9.5 7V5.4A1.4 1.4 0 0 1 10.9 4h2.2a1.4 1.4 0 0 1 1.4 1.4V7"/><path d="M7 7l.8 11.2A1.6 1.6 0 0 0 9.4 19.8h5.2a1.6 1.6 0 0 0 1.6-1.6L17 7"/></svg>
        </button>
      </span>`;

    row.querySelector(".mname").textContent = f.name;
    // thumbnail halaman pertama
    const th = row.querySelector(".mthumb");
    th.innerHTML = '<span class="mthumb-empty">PDF</span>';
    renderMergeThumb(th, f);

    row.querySelector(".mrow-actions").addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (!act) return;
      if (act === "remove") {
        merge.files = merge.files.filter((x) => x.uid !== f.uid);
        dropThumbDoc(f.uid);
        mergeRender();
      } else {
        const idx = merge.files.findIndex((x) => x.uid === f.uid);
        const to = idx + (act === "up" ? -1 : 1);
        if (to < 0 || to >= merge.files.length) return;
        [merge.files[idx], merge.files[to]] = [merge.files[to], merge.files[idx]];
        mergeRender();
      }
    });

    // drag & drop urutan
    row.addEventListener("dragstart", (e) => {
      dragUid = f.uid;
      row.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", f.uid); } catch (_) {}
    });
    row.addEventListener("dragend", () => {
      dragUid = null;
      row.classList.remove("dragging");
      listElClearMarks();
    });
    row.addEventListener("dragover", (e) => {
      if (!dragUid || dragUid === f.uid) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      row.classList.add("drop-target");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
    row.addEventListener("drop", (e) => {
      if (!dragUid || dragUid === f.uid) return;
      e.preventDefault();
      e.stopPropagation();
      const from = merge.files.findIndex((x) => x.uid === dragUid);
      const to = merge.files.findIndex((x) => x.uid === f.uid);
      if (from < 0 || to < 0) return;
      const [moved] = merge.files.splice(from, 1);
      merge.files.splice(to, 0, moved);
      dragUid = null;
      mergeRender();
    });

    return row;
  }

  function listElClearMarks() {
    $("#mlist").querySelectorAll(".mrow").forEach((r) => r.classList.remove("drop-target", "dragging"));
  }

  /* cache dokumen pdf.js untuk thumbnail (dibuka satu kali per file) */
  const thumbCache = new Map();
  function getThumbDoc(f) {
    if (thumbCache.has(f.uid)) return thumbCache.get(f.uid);
    const p = pdfjsLib.getDocument({ data: f.bytes.slice(0), isEvalSupported: false }).promise;
    thumbCache.set(f.uid, p);
    return p;
  }
  async function dropThumbDoc(uid) {
    const p = thumbCache.get(uid);
    thumbCache.delete(uid);
    if (!p) return;
    try {
      const d = await p;
      if (d && typeof d.destroy === "function") await d.destroy();
    } catch (_) {
      /* abaikan */
    }
  }

  async function renderMergeThumb(el, f) {
    try {
      const pdf = await getThumbDoc(f);
      const page = await pdf.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(1.4, 52 / base.height) * 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      if (!el.isConnected) {
        canvas.width = canvas.height = 0;
        return;
      }
      const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.7));
      canvas.width = canvas.height = 0;
      if (!blob) return;
      const img = document.createElement("img");
      img.src = URL.createObjectURL(blob);
      img.alt = "";
      img.className = "mthumb";
      img.dataset.objectUrl = "1";
      el.replaceWith(img);
    } catch (err) {
      console.error("Thumbnail gagal:", err);
    }
  }

  /* ---------- tambah file ke daftar gabung ---------- */
  async function mergeAddFiles(fileList) {
    const files = Array.from(fileList).filter(
      (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name)
    );
    if (!files.length) { toast("Hanya file PDF yang didukung.", "err"); return; }

    showOverlay("Menambahkan ke daftar gabung…");
    let added = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      overlayText.textContent = `Membaca ${file.name}…`;
      setProgress(((i + 0.5) / files.length) * 100);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!looksLikePdf(bytes)) throw new Error("Berkas ini bukan PDF yang valid.");
        let doc;
        try {
          doc = await PDFDocument.load(bytes, { updateMetadata: false });
        } catch (err) {
          if (isEncryptedError(err)) {
            const pw = await askPassword(file.name);
            if (pw === null) throw new Error("Dibatalkan karena PDF terkunci.");
            const opened = await decryptWithPdfjs(bytes, pw);
            doc = await PDFDocument.load(opened, { updateMetadata: false });
            merge.files.push({
              uid: "m" + ++mergeUid,
              name: file.name.replace(/\.pdf$/i, "") + " (terbuka).pdf",
              bytes: opened, doc,
              pageCount: doc.getPageCount(),
              size: opened.length,
            });
            added++;
            continue;
          }
          doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
        }
        const n = doc.getPageCount();
        if (!n) throw new Error("PDF tidak memiliki halaman.");
        merge.files.push({
          uid: "m" + ++mergeUid,
          name: file.name,
          bytes, doc,
          pageCount: n,
          size: file.size,
        });
        added++;
      } catch (err) {
        console.warn(`Gagal membaca "${file.name}":`, pesanReader(err));
        toast(`Gagal membaca "${file.name}". ${pesanReader(err)}`.trim(), "err", 5000);
      }
      await tick();
    }
    hideOverlay();
    if (added) {
      mergeRender();
      toast(`${added} file ditambahkan ke daftar gabung.`, "ok");
    }
  }

  /* ---------- aksi panel ---------- */
  $("#mergeBrowseBtn").addEventListener("click", () => $("#mergeInput").click());
  $("#mergeInput").addEventListener("change", (e) => {
    if (e.target.files?.length) mergeAddFiles(e.target.files);
    e.target.value = "";
  });
  $("#mergeDrop").addEventListener("click", (e) => {
    if (!e.target.closest("button")) $("#mergeInput").click();
  });
  $("#mergeDrop").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("#mergeInput").click(); }
  });

  $("#mergeReverseBtn").addEventListener("click", () => {
    if (!merge.files.length) return;
    merge.files.reverse();
    mergeRender();
  });

  /* Chip mode urutan halaman: "Sesuai file", "Dibalik", "Kustom". */
  for (const chip of document.querySelectorAll(".mchip[data-order]")) {
    chip.addEventListener("click", () => {
      if (!merge.files.length) return;
      mergeSetOrderMode(chip.dataset.order);
    });
  }
  $("#mergeClearBtn").addEventListener("click", () => {
    if (!merge.files.length) return;
    if (!confirm("Kosongkan daftar file yang akan digabung?")) return;
    merge.files.forEach((f) => dropThumbDoc(f.uid));
    revokeResults(merge.results);
    merge.files = [];
    merge.results = [];
    merge.order = [];
    merge.orderMode = "asis";
    $("#mergeResultCard").hidden = true;
    $("#mergeResults").innerHTML = "";
    mergeRender();
    toast("Daftar gabung dikosongkan.");
  });

  /* ---------- proses gabung ---------- */
  /* Bangun PDF gabungan.
     Fungsi ini dipakai oleh proses gabung sungguhan DAN oleh
     perkiraan ukuran hasil, sehingga angka yang ditampilkan dijamin
     sama persis dengan berkas yang benar-benar dihasilkan. */
  async function mergeBuildBytes(files, order, hooks = {}) {
    const out = await PDFDocument.create();
    out.setProducer(PRODUCER);
    out.setCreator(PRODUCER + " (pdf-lib)");
    out.setCreationDate(new Date());

    /* Urutan halaman menentukan urutan di hasil gabung. Tiap entri
       order = {uid, page}. Halaman yang sama boleh muncul lebih dari
       satu kali (tiap kemunculan disalin terpisah). */
    const urutan = Array.isArray(order) && order.length
      ? order
      : files.flatMap((f) => Array.from({ length: f.pageCount }, (_, p) => ({ uid: f.uid, page: p })));

    const totalPages = urutan.length || 1;
    let done = 0;

    /* Salin halaman per berkas sekali saja (bisa beberapa halaman
       sekaligus), lalu tambahkan sesuai urutan akhir. */
    const salinan = new Map();
    for (const f of files) {
      const needed = urutan.filter((o) => o.uid === f.uid).map((o) => o.page);
      if (!needed.length) continue;
      if (hooks.onFile) await hooks.onFile(f, done, totalPages);
      try {
        const copied = await out.copyPages(f.doc, needed);
        salinan.set(f.uid, { copied, dipakai: 0 });
      } catch (err) {
        /* satu berkas gagal disalin -> lewati, berkas lain tetap jalan */
        salinan.set(f.uid, { copied: [], dipakai: 0 });
      }
      await tick();
    }

    for (const o of urutan) {
      const st = salinan.get(o.uid);
      if (!st) continue;
      const pg = st.copied[st.dipakai++];
      if (!pg) continue;
      out.addPage(pg);
      done++;
      if (hooks.onProgress) hooks.onProgress((done / totalPages) * 100);
      await tick();
    }

    if (!out.getPageCount()) throw new Error("Tidak ada halaman yang bisa digabung.");

    const bytes = await out.save({ useObjectStreams: true, addDefaultPage: false });
    return { bytes, pageCount: out.getPageCount() };
  }

  $("#mergeRunBtn").addEventListener("click", async () => {
    if (merge.busy || merge.files.length < 2) return;
    merge.busy = true;
    $("#mergeRunBtn").disabled = true;
    showOverlay("Menggabungkan PDF…");
    try {
      mergeSyncOrder();
      const res = await mergeBuildBytes(merge.files, merge.order, {
        onFile: (f, done, totalPages) => {
          overlayText.textContent = `Menggabungkan ${f.name}…`;
          setProgress((done / totalPages) * 100);
        },
        onProgress: (pct) => setProgress(pct),
      });

      const blob = new Blob([res.bytes], { type: "application/pdf" });
      const name = mergeFileName();
      const item = { name, blob, url: URL.createObjectURL(blob), size: blob.size };
      revokeResults(merge.results);
      merge.results = [item];

      const card = $("#mergeResultCard");
      const box = $("#mergeResults");
      card.hidden = false;
      box.innerHTML = "";
      const row = document.createElement("div");
      row.className = "result";
      const nm = document.createElement("div");
      nm.className = "rname";
      nm.textContent = name;
      nm.title = name;
      const sz = document.createElement("span");
      sz.className = "rsize";
      sz.textContent = fmtSize(blob.size);
      const a = document.createElement("a");
      a.className = "rl";
      a.textContent = "Unduh";
      a.href = item.url;
      a.download = name;
      row.append(nm, sz, a);
      box.appendChild(row);

      setProgress(100);
      if ($("#mergeAutoDl").checked) downloadBlob(blob, name);
      toast(`Selesai — ${nf(res.pageCount)} halaman digabung.`, "ok");
    } catch (err) {
      console.error(err);
      toast("Gagal menggabungkan: " + (err?.message || err), "err", 6000);
    } finally {
      merge.busy = false;
      hideOverlay();
      mergeRender();
    }
  });

  function mergeFileName() {
    const names = merge.files.map((f) => baseName(f.name));
    if (names.length === 1) return safe(names[0]) + "-gabungan.pdf";
    const first = safe(names[0]).slice(0, 40);
    return `${first}-dan-${names.length - 1}-lainnya-gabungan.pdf`;
  }

  /* ============================================================
     Perkiraan ukuran hasil gabung
     ------------------------------------------------------------
     Angka dihitung dengan build PDF yang PERSIS sama dengan proses
     gabung sungguhan (copyPages + save), jadi ini bukan tebakan
     melainkan ukuran berkas yang akan benar-benar dihasilkan.
     Dihitung di latar belakang agar antarmuka tetap responsif, dan
     otomatis dihitung ulang begitu daftar file atau urutannya berubah.
     ============================================================ */
  function mergeEstKey() {
    const files = merge.files.map((f) => `${f.uid}:${f.pageCount}:${f.size}`).join("|");
    const order = merge.order.map((o) => `${o.uid}#${o.page}`).join(",");
    return `${files}||${merge.orderMode}||${order}`;
  }

  function mergeEstTotal() {
    return merge.files.reduce((s, f) => s + f.size, 0);
  }

  function mergeEstimateSchedule(delay = 450) {
    clearTimeout(mergeEst.timer);
    mergeEst.timer = setTimeout(() => {
      mergeEst.timer = null;
      mergeEstimateRun();
    }, delay);
  }

  /* Hanya satu perhitungan berjalan pada satu waktu; permintaan
     berikutnya menunggu dan menggantikan hasil yang lama. */
  async function mergeEstimateRun() {
    if (mergeEst.running) {
      mergeEst.pending = true;
      return;
    }
    mergeEst.running = true;
    try {
      do {
        mergeEst.pending = false;
        await mergeEstimateOnce();
      } while (mergeEst.pending);
    } finally {
      mergeEst.running = false;
    }
  }

  async function mergeEstimateOnce() {
    // jangan jalan bersamaan dengan proses lain yang sedang berjalan
    if (merge.busy || !overlay.hidden) return;

    const files = merge.files.slice();
    if (files.length < 2) {
      mergeEst.key = null;
      mergeEst.size = 0;
      mergeEst.state = "idle";
      mergeEstRender();
      return;
    }

    const key = mergeEstKey();
    // daftar tidak berubah → pakai hasil yang sudah dihitung
    if (mergeEst.key === key && (mergeEst.state === "ok" || mergeEst.state === "skipped")) return;

    const total = mergeEstTotal();
    if (total > MERGE_EST_MAX_BYTES) {
      mergeEst.key = key;
      mergeEst.size = 0;
      mergeEst.state = "skipped";
      mergeEstRender();
      return;
    }

    mergeEst.key = key;
    mergeEst.state = "loading";
    mergeEstRender();
    await tick();

    try {
      const res = await mergeBuildBytes(files, merge.order);
      if (mergeEstKey() !== key) {
        mergeEst.pending = true; // daftar berubah saat dihitung → hitung ulang
        return;
      }
      mergeEst.size = res.bytes.length;
      mergeEst.state = "ok";
    } catch (err) {
      console.error(err);
      if (mergeEstKey() !== key) {
        mergeEst.pending = true;
        return;
      }
      mergeEst.size = 0;
      mergeEst.state = "error";
    }
    mergeEstRender();
  }

  function mergeEstRender() {
    const chip = $("#mergeSizeEst");
    if (!chip) return;
    const n = merge.files.length;
    const cls = (extra) => "chip merge-est" + (extra ? " " + extra : "");
    chip.dataset.state = mergeEst.state;
    chip.dataset.key = mergeEst.key || "";
    chip.dataset.bytes = String(mergeEst.size || 0);

    if (!n) {
      chip.hidden = true;
      chip.className = cls("");
      chip.textContent = "";
      chip.removeAttribute("title");
      return;
    }
    chip.hidden = false;

    if (n < 2) {
      chip.className = cls("muted");
      chip.innerHTML = "<span>Tambah 1 file lagi untuk menghitung hasil</span>";
      chip.removeAttribute("title");
      return;
    }
    if (mergeEst.state === "loading") {
      chip.className = cls("loading");
      chip.innerHTML = '<span class="est-spin" aria-hidden="true"></span><span>Menghitung hasil…</span>';
      chip.removeAttribute("title");
      return;
    }
    if (mergeEst.state === "error") {
      chip.className = cls("warn");
      chip.innerHTML = "<span>Ukuran hasil belum bisa dihitung</span>";
      chip.removeAttribute("title");
      return;
    }
    if (mergeEst.state === "skipped") {
      chip.className = cls("muted");
      chip.innerHTML = `<span>Total ${fmtSize(mergeEstTotal())} — perkiraan dilewati agar hemat memori</span>`;
      chip.removeAttribute("title");
      return;
    }
    if (mergeEst.state === "ok") {
      const size = mergeEst.size;
      const total = mergeEstTotal();
      const pct = total ? Math.round((1 - size / total) * 100) : 0;
      chip.className = cls("ok");
      chip.innerHTML =
        `<span class="est-size">${fmtSize(size)}</span>` +
        `<span class="est-note">dari ${fmtSize(total)}</span>` +
        `<span class="est-tag">pasti</span>`;
      chip.title =
        `Ukuran file gabungan: ${nf(size)} byte dari ${nf(total)} byte ` +
        `(${pct >= 0 ? "hemat" : "lebih besar"} ${Math.abs(pct)}%)`;
      return;
    }
    chip.className = cls("muted");
    chip.innerHTML = "<span>Menyiapkan perkiraan…</span>";
    chip.removeAttribute("title");
  }

  /* ---------- drag & drop global di tab gabung ---------- */
  window.addEventListener("dragover", (e) => {
    if (activeTab !== "merge") return;
    if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
    e.preventDefault();
    $("#mergeDrop").classList.add("drag");
  });
  window.addEventListener("dragleave", (e) => {
    if (activeTab !== "merge") return;
    if (e.relatedTarget) return;
    $("#mergeDrop").classList.remove("drag");
  });
  window.addEventListener("drop", (e) => {
    if (activeTab !== "merge") return;
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    e.stopPropagation();
    $("#mergeDrop").classList.remove("drag");
    if (dragUid) return; // sedang reorder, bukan menambah file
    mergeAddFiles(e.dataTransfer.files);
  });

  mergeRender();


  /* ============================================================
     TAB: Kompres PDF
     ============================================================ */
  const compress = {
    files: [],   // {uid, name, bytes, pageCount, size}
    results: [],
    busy: false,
  };
  let compressUid = 0;

  const PRESETS = {
    lossless: { mode: "lossless", label: "Ringan", dpi: 0, quality: 0 },
    optimal: { mode: "optimal", label: "Optimal", dpi: 200, quality: 0.82 },
    balanced: { mode: "raster", label: "Seimbang", dpi: 150, quality: 0.78 },
    strong: { mode: "raster", label: "Kuat", dpi: 110, quality: 0.62 },
  };

  /* Opsi panel Kustom — satu sumber kebenaran.
     Dipakai oleh compressSettings() dan compressEstOptions() agar
     angka kompresi dan perkiraan ukuran tidak pernah melenceng. */
  function compressCustomOptions() {
    const strategy = $("#cStrategy").value;
    const dpi = Math.max(72, Math.min(400, parseInt($("#dpiRange").value, 10) || 200));
    const quality = Math.max(30, Math.min(98, parseInt($("#qRange").value, 10) || 82)) / 100;
    const mode = strategy === "raster" ? "raster" : strategy === "lossless" ? "lossless" : "optimal";
    return { strategy, mode, dpi, quality };
  }

  function compressSettings() {
    const level = document.querySelector('input[name="clevel"]:checked').value;
    const gray = $("#grayChk").checked;
    const cleanMeta = $("#cleanMetaChk").checked;
    const neverBigger = $("#neverBiggerChk").checked;

    if (level === "custom") {
      const c = compressCustomOptions();
      return { mode: c.mode, dpi: c.dpi, quality: c.quality, gray, cleanMeta, neverBigger, label: "Kustom" };
    }
    const p = PRESETS[level] || PRESETS.optimal;
    return { ...p, gray, cleanMeta, neverBigger };
  }

  document.querySelectorAll('input[name="clevel"]').forEach((r) => {
    r.addEventListener("change", () => {
      const lvl = document.querySelector('input[name="clevel"]:checked').value;
      $("#customOpts").hidden = lvl !== "custom";
      compressSyncSliders();
      compressUpdateNote();
      compressEstimateSchedule();
    });
  });
  $("#cStrategy").addEventListener("change", () => {
    compressUpdateNote();
    compressSyncSliders();
    compressEstimateSchedule();
  });
  $("#dpiRange").addEventListener("input", () => {
    $("#dpiVal").textContent = $("#dpiRange").value + " DPI";
    compressUpdateNote();
    compressEstimateSchedule();
  });
  $("#qRange").addEventListener("input", () => {
    $("#qVal").textContent = $("#qRange").value + "%";
    compressUpdateNote();
    compressEstimateSchedule();
  });
  $("#grayChk").addEventListener("change", () => {
    compressUpdateNote();
    compressEstimateSchedule();
  });
  $("#cleanMetaChk").addEventListener("change", () => {
    compressUpdateNote();
    compressEstimateSchedule();
  });
  $("#neverBiggerChk").addEventListener("change", () => {
    compressUpdateNote();
    compressEstimateSchedule();
  });

  /* Slider hanya relevan untuk strategi yang benar-benar memakainya:
       • Ringan (lossless) → DPI & kualitas TIDAK dipakai sama sekali
       • Optimal            → DPI = ambang downsampling gambar raster,
                             kualitas = mutu JPEG hasil downsampling
       • Raster             → DPI = resolusi render halaman,
                             kualitas = mutu JPEG hasil render
     Karena itu status slider dihitung dari strategi, bukan dari
     riwayat pemakaian sebelumnya. */
  function compressSyncSliders() {
    const c = compressCustomOptions();
    const usesImage = c.mode !== "lossless";

    $("#dpiRange").disabled = !usesImage;
    $("#dpiRangeRow").classList.toggle("disabled", !usesImage);
    $("#qRange").disabled = !usesImage;
    $("#qRangeRow").classList.toggle("disabled", !usesImage);

    $("#dpiVal").textContent = c.dpi + " DPI";
    $("#qVal").textContent = Math.round(c.quality * 100) + "%";

    const hint = $("#customHint");
    if (!hint) return;
    if (!usesImage) {
      hint.textContent =
        "Strategi Ringan hanya merapikan struktur file — teks, font, dan gambar tidak diolah ulang, sehingga resolusi dan kualitas dinonaktifkan.";
    } else if (c.mode === "optimal") {
      hint.textContent =
        `Gambar raster yang melebihi ${c.dpi} DPI diperkecil ke ${c.dpi} DPI dengan kualitas ${Math.round(c.quality * 100)}%. Teks & font tetap vektor (tajam dan bisa dicari).`;
    } else {
      hint.textContent =
        `Setiap halaman dirender pada ${c.dpi} DPI dengan kualitas ${Math.round(c.quality * 100)}%. Teks menjadi gambar (tidak bisa dicari atau disalin).`;
    }
  }

  /* ============================================================
     Perkiraan ukuran hasil kompresi
     ------------------------------------------------------------
     Setiap tingkat kompresi dihitung dengan mesin kompresi yang
     sama (sampel halaman), lalu dikalibrasi ke seluruh dokumen.
     Angka dihitung di latar belakang — UI tetap responsif.
     ============================================================ */
  const EST_TARGETS = ["lossless", "optimal", "balanced", "strong", "custom"];

  /* Preset yang sedang dipilih dihitung lebih dulu agar angkanya
     langsung terlihat tanpa menunggu preset lain. */
  function compressEstOrder() {
    const sel = document.querySelector('input[name="clevel"]:checked')?.value;
    if (!sel || !EST_TARGETS.includes(sel)) return EST_TARGETS;
    return [sel, ...EST_TARGETS.filter((t) => t !== sel)];
  }

  const compressEst = {
    cache: new Map(),   // kunci -> { size, ratio, exact, sampled, pages }
    values: new Map(),  // target -> { state: "loading"|"ok"|"error", size, total, exact }
    startedAt: 0,      // waktu mulai hitung terakhir (untuk penjaga macet)
    failed: new Set(),  // target yang perkiraannya gagal
    running: false,
    token: 0,
    timer: null,
  };

  /* Opsi kompresi untuk sebuah target preset. */
  function compressEstOptions(target) {
    const gray = $("#grayChk").checked;
    const cleanMeta = $("#cleanMetaChk").checked;
    const neverBigger = $("#neverBiggerChk").checked;
    if (target === "custom") {
      const c = compressCustomOptions();
      return { mode: c.mode, dpi: c.dpi, quality: c.quality, gray, cleanMeta, neverBigger };
    }
    const p = PRESETS[target] || PRESETS.optimal;
    return { mode: p.mode, dpi: p.dpi || 200, quality: p.quality || 0.82, gray, cleanMeta, neverBigger };
  }

  /* Kunci perkiraan.
     "Jangan pernah memperbesar" SENGAJA tidak ikut: hasil perkiraan
     dijepit setelah seluruh berkas dijumlahkan, jadi mengubah sakelar
     itu tidak boleh memicu perhitungan ulang yang tidak perlu. */
  function compressEstKey(uid, o) {
    return [
      uid,
      o.mode,
      o.dpi,
      o.quality,
      o.gray ? 1 : 0,
      o.cleanMeta ? 1 : 0,
    ].join("|");
  }

  function compressEstTotal() {
    return compress.files.reduce((s, f) => s + f.size, 0);
  }

  /* Jadwalkan penghitungan ulang (debounce agar tidak terlalu sering).
     Nilai lama langsung ditandai "sedang dihitung" supaya yang tampil
     bukan angka basi. */
  function compressEstimateSchedule(delay = 350) {
    clearTimeout(compressEst.timer);
    if (compress.files.length) {
      compressEst.startedAt = Date.now();
      for (const target of EST_TARGETS) {
        const v = compressEst.values.get(target);
        if (v && v.state === "ok") compressEst.values.set(target, { state: "loading" });
      }
      compressEstRender();
    }
    compressEst.timer = setTimeout(() => {
      compressEst.timer = null;
      compressEstimateRun();
    }, delay);
  }

  /* Buang cache untuk file yang sudah dihapus. */
  function compressEstPrune() {
    const alive = new Set(compress.files.map((f) => f.uid));
    for (const k of [...compressEst.cache.keys()]) {
      if (!alive.has(k.split("|")[0])) compressEst.cache.delete(k);
    }
  }

  /* Jumlahkan perkiraan tiap berkas menjadi satu angka per target. */
  function compressEstAggregate() {
    const total = compressEstTotal();
    for (const target of EST_TARGETS) {
      if (compressEst.failed.has(target)) {
        compressEst.values.set(target, { state: "error" });
        continue;
      }
      const opts = compressEstOptions(target);
      let sum = 0;
      let ok = true;
      let exact = true;
      let sampled = 0;
      let pages = 0;
      for (const f of compress.files) {
        const r = compressEst.cache.get(compressEstKey(f.uid, opts));
        if (!r) { ok = false; break; }
        sum += r.size;
        exact = exact && r.exact;
        sampled = Math.max(sampled, r.sampled || 0);
        pages = Math.max(pages, r.pages || 0);
      }
      if (!ok) {
        // belum ada angka untuk semua berkas -> belum bisa dijumlahkan
        const cur = compressEst.values.get(target);
        if (!cur || cur.state !== "error") compressEst.values.set(target, { state: "loading" });
        continue;
      }
      let size = sum;
      if (opts.neverBigger) size = Math.min(size, total);
      compressEst.values.set(target, { state: "ok", size, total, exact, sampled, pages });
    }
  }

  /* Kembalikan target yang masih "loading" menjadi "error" supaya
     spinner tidak berputar tanpa akhir. */
  function compressEstAbortLoading() {
    for (const target of EST_TARGETS) {
      const v = compressEst.values.get(target);
      if (v && v.state === "loading") {
        compressEst.failed.add(target);
        compressEst.values.set(target, { state: "error" });
      }
    }
    compressEstRender();
  }

  async function compressEstimateRun() {
    const engine = window.PDFCompressor;
    if (!engine || typeof engine.estimate !== "function") {
      compressEstAbortLoading();
      return;
    }

    if (!compress.files.length) {
      compressEst.token++;
      compressEst.cache.clear();
      compressEst.values.clear();
      compressEst.failed.clear();
      compressEstRender();
      return;
    }

    // jangan jalan bersamaan dengan kompresi manual
    if (compress.busy) {
      compressEstAbortLoading();
      return;
    }

    // tunggu bila ada estimasi sebelumnya yang masih berjalan
    while (compressEst.running) {
      await new Promise((r) => setTimeout(r, 60));
      if (compress.busy) {
        compressEstAbortLoading();
        return;
      }
    }

    const token = ++compressEst.token;
    compressEst.running = true;
    compressEst.failed.clear();
    compressEstPrune();

    try {
      /* Analisis tiap berkas (bobot gambar, halaman sampel) dihitung
         SATU KALI lalu dipakai semua preset — dokumen tidak diurai
         berulang kali. Preset yang sedang dipilih dihitung lebih dulu
         supaya angkanya langsung terlihat. */
      const order = compressEstOrder();
      const rounds = [order.slice(0, 1), order.slice(1)];

      for (const group of rounds) {
        for (const f of compress.files) {
          if (token !== compressEst.token) return;
          if (compress.busy) { compressEstAbortLoading(); return; }

          const pending = [];
          for (const target of group) {
            const opts = compressEstOptions(target);
            const key = compressEstKey(f.uid, opts);
            if (compressEst.cache.has(key)) continue;
            pending.push({ target, opts, key });
          }
          if (!pending.length) continue;

          // neverBigger diterapkan pada hasil akhir, bukan per berkas,
          // agar rasio tidak bias oleh fallback berkas asli.
          const wanted = pending.map((p) => Object.assign({}, p.opts, { neverBigger: false }));

          let fresh = [];
          if (typeof engine.estimateMany === "function") {
            try {
              fresh = await engine.estimateMany(f.bytes, wanted, { analysisKey: f.uid });
            } catch (_) {
              fresh = [];
            }
          }
          if (!fresh.length) {
            // mesin tanpa EstimateMany: hitung satu per satu
            for (const o of wanted) {
              try {
                fresh.push(await engine.estimate(f.bytes, o));
              } catch (_) {
                fresh.push(null);
              }
            }
          }

          pending.forEach((p, i) => {
            const r = fresh[i];
            if (r) compressEst.cache.set(p.key, r);
            else compressEst.failed.add(p.target);
          });

          compressEstAggregate();
          compressEstRender();
          await tick();
        }
      }

      /* Semua target sudah ada di cache (mis. hanya preset yang
         diganti) — kembalikan statusnya ke "ok" supaya ringkasan
         "paling hemat" muncul lagi. */
      compressEstAggregate();
      compressEstRender();
    } finally {
      compressEst.running = false;
    }
  }

  /* Tampilkan hasil perkiraan ke setiap kartu preset. */
  function compressEstRender() {
    const has = compress.files.length > 0;
    const total = compressEstTotal();

    document.querySelectorAll(".preset-est").forEach((el) => {
      const key = el.dataset.est;
      const v = compressEst.values.get(key);
      el.className = "preset-est";
      el.dataset.state = v ? v.state : "idle";
      if (!has) { el.textContent = ""; el.classList.remove("show"); el.title = ""; return; }
      el.classList.add("show");

      if (!v || v.state === "loading") {
        const lama = Date.now() - (compressEst.startedAt || 0);
        if (!v || lama < 20000) {
          el.innerHTML = '<span class="est-spin" aria-hidden="true"></span><span>Menghitung perkiraan…</span>';
          el.title = "";
          return;
        }
        // terlalu lama -> berhenti berputar dan beri tahu pengguna
        el.innerHTML = "<span>Perkiraan belum selesai — tekan Kompres untuk melihat hasil</span>";
        el.title = "";
        return;
      }
      if (v.state === "error") {
        el.innerHTML = "<span>Perkiraan tidak tersedia untuk berkas ini</span>";
        el.title = "";
        return;
      }

      const pct = v.total ? Math.round((1 - v.size / v.total) * 100) : 0;
      const cls = pct > 0 ? "down" : pct < 0 ? "up" : "same";
      const sign = pct > 0 ? "−" : pct < 0 ? "+" : "";
      const tag = v.exact
        ? '<span class="est-tag">pasti</span>'
        : `<span class="est-tag approx">≈ dari ${nf(v.sampled || 0)} halaman</span>`;

      el.innerHTML =
        `<span class="est-size">${fmtSize(v.size)}</span>` +
        `<span class="est-delta ${cls}">${sign}${Math.abs(pct)}%</span>` +
        `<span class="est-note">dari ${fmtSize(v.total)}</span>` +
        tag;
      el.title =
        `Perkiraan ${nf(v.size)} byte dari ${nf(v.total)} byte` +
        (v.exact ? "" : ` (dihitung dari ${nf(v.sampled || 0)} halaman)`);
    });

    /* Ringkasan: preset mana yang paling hemat. */
    const summary = $("#compressEstSummary");
    if (!summary) return;
    const done = EST_TARGETS.filter((t) => {
      const v = compressEst.values.get(t);
      return v && v.state === "ok";
    });
    if (!done.length) {
      summary.hidden = true;
      summary.textContent = "";
      return;
    }
    let best = null;
    for (const t of done) {
      const v = compressEst.values.get(t);
      if (!best || v.size < best.size) best = { ...v, target: t };
    }
    const labels = { lossless: "Ringan", optimal: "Optimal", balanced: "Seimbang", strong: "Kuat", custom: "Kustom" };
    const pct = best.total ? Math.round((1 - best.size / best.total) * 100) : 0;
    summary.hidden = false;
    summary.innerHTML =
      `<span class="est-best">Paling hemat · ${labels[best.target] || best.target}</span>` +
      `<span>≈ <b>${fmtSize(best.size)}</b> (${pct > 0 ? "−" : pct < 0 ? "+" : ""}${Math.abs(pct)}% dari ${fmtSize(best.total)})</span>`;
  }

  function compressUpdateNote() {
    const st = compressSettings();
    const note = $("#compressNote");
    const meta = st.cleanMeta ? " Metadata (judul, penulis, XMP) ikut dibersihkan." : "";
    if (st.mode === "lossless") {
      note.textContent =
        "Struktur file dioptimalkan: objek yatim dibuang. " +
        "Teks, font, dan gambar sama sekali tidak berubah (100% aman, bukan rasterisasi)." + meta;
    } else if (st.mode === "optimal") {
      note.textContent =
        `Teks & font tetap vektor (tetap tajam dan bisa dicari). Hanya gambar raster yang melebihi ${st.dpi} DPI diperkecil ke ${st.dpi} DPI — hasil tidak pernah lebih buram dari aslinya.${meta}`;
    } else {
      note.textContent =
        `Halaman dirender ke ${st.dpi} DPI dengan kualitas ${Math.round(st.quality * 100)}%${st.gray ? ", hitam-putih" : ""}. ` +
        `Halaman hasil pindai otomatis tidak di-upsample. Teks menjadi gambar (tidak bisa dicari/disalin).${meta}`;
    }
  }

  function compressRender() {
    const listEl = $("#clist");
    releaseThumbs(listEl);
    listEl.innerHTML = "";
    compress.files.forEach((f, i) => listEl.appendChild(compressRow(f, i)));
    const has = compress.files.length > 0;
    $("#compressDrop").hidden = has;
    $("#compressOpts").hidden = !has;
    $("#compressFoot").hidden = !has;
    if (!has) $("#compressResultCard").hidden = true;

    const pages = compress.files.reduce((n, f) => n + f.pageCount, 0);
    const total = compress.files.reduce((n, f) => n + f.size, 0);
    $("#compressInfo").textContent = has ? `${nf(compress.files.length)} file` : "Belum ada file";
    $("#compressPagesInfo").textContent = has
      ? `${nf(pages)} halaman · ${fmtSize(total)} total`
      : "Tarik file PDF untuk mulai";
    $("#compressRunBtn").disabled = !has || compress.busy;
    $("#compressInfo").classList.toggle("active", has);
    compressUpdateNote();
    compressEstRender();
    compressShowResults();
  }

  function compressRow(f, i) {
    const row = document.createElement("div");
    row.className = "mrow compress-row";
    row.dataset.uid = f.uid;
    row.innerHTML = `
      <span class="morder">${i + 1}</span>
      <span class="mthumb"><span class="mthumb-empty">PDF</span></span>
      <span class="mmeta">
        <span class="mname"></span>
        <span class="msub">${nf(f.pageCount)} halaman · ${fmtSize(f.size)}</span>
      </span>
      <span class="crow-badge" hidden></span>
      <span class="crow-link" hidden></span>
      <span class="mrow-actions">
        <button class="iconbtn" data-act="up" title="Naikkan" aria-label="Naikkan urutan">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 6-6 6 6"/></svg>
        </button>
        <button class="iconbtn" data-act="down" title="Turunkan" aria-label="Turunkan urutan">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 10 6 6 6-6"/></svg>
        </button>
        <button class="iconbtn danger" data-act="remove" title="Hapus file" aria-label="Hapus file">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14"/><path d="M9.5 7V5.4A1.4 1.4 0 0 1 10.9 4h2.2a1.4 1.4 0 0 1 1.4 1.4V7"/><path d="M7 7l.8 11.2A1.6 1.6 0 0 0 9.4 19.8h5.2a1.6 1.6 0 0 0 1.6-1.6L17 7"/></svg>
        </button>
      </span>`;
    row.querySelector(".mname").textContent = f.name;
    renderMergeThumb(row.querySelector(".mthumb"), f);

    row.querySelector(".mrow-actions").addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (!act) return;
      if (act === "remove") {
        compress.files = compress.files.filter((x) => x.uid !== f.uid);
        compress.results = compress.results.filter((r) => r.uid !== f.uid);
        dropThumbDoc(f.uid);
        // buang analisis berkas ini supaya cache tidak menumpuk
        if (window.PDFCompressor && typeof window.PDFCompressor.releaseAnalysis === "function") {
          try { window.PDFCompressor.releaseAnalysis(f.uid); } catch (_) {}
        }
        compressShowResults();
        compressRender();
        compressEstimateSchedule(120);
      } else {
        const idx = compress.files.findIndex((x) => x.uid === f.uid);
        const to = idx + (act === "up" ? -1 : 1);
        if (to < 0 || to >= compress.files.length) return;
        [compress.files[idx], compress.files[to]] = [compress.files[to], compress.files[idx]];
        compressRender();
      }
    });
    return row;
  }

  /* ---------- tambah file ---------- */
  async function compressAddFiles(fileList) {
    const files = Array.from(fileList).filter(
      (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name)
    );
    if (!files.length) { toast("Hanya file PDF yang didukung.", "err"); return; }
    showOverlay("Membaca PDF…");
    let added = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      overlayText.textContent = `Membaca ${file.name}…`;
      setProgress(((i + 0.5) / files.length) * 100);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!looksLikePdf(bytes)) throw new Error("Berkas ini bukan PDF yang valid.");
        let doc;
        try {
          doc = await PDFDocument.load(bytes, { updateMetadata: false });
        } catch (err) {
          if (isEncryptedError(err)) {
            const pw = await askPassword(file.name);
            if (pw === null) throw new Error("Dibatalkan karena PDF terkunci.");
            const opened = await decryptWithPdfjs(bytes, pw);
            doc = await PDFDocument.load(opened, { updateMetadata: false });
            compress.files.push({
              uid: "c" + ++compressUid,
              name: file.name.replace(/\.pdf$/i, "") + " (terbuka).pdf",
              bytes: opened, pageCount: doc.getPageCount(), size: opened.length,
            });
            added++;
            continue;
          }
          doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
        }
        const n = doc.getPageCount();
        if (!n) throw new Error("PDF tidak memiliki halaman.");
        // Dokumen pdf-lib tidak dipakai lagi setelah jumlah halaman
        // diketahui; melepaskanya menghemat banyak memori untuk
        // berkas besar (dokumen ini tidak dipakai saat kompresi).
        doc = null;
        compress.files.push({
          uid: "c" + ++compressUid,
          name: file.name, bytes, pageCount: n, size: file.size,
        });
        added++;
      } catch (err) {
        console.error(err);
        toast(`Gagal membaca "${file.name}". ${err?.message || ""}`.trim(), "err", 5000);
      }
      await tick();
    }
    hideOverlay();
    if (added) {
      compressRender();
      compressEstimateSchedule(120);
      toast(`${added} file siap dikompres.`, "ok");
    }
  }

  $("#compressBrowseBtn").addEventListener("click", () => $("#compressInput").click());
  $("#compressInput").addEventListener("change", (e) => {
    if (e.target.files?.length) compressAddFiles(e.target.files);
    e.target.value = "";
  });
  $("#compressDrop").addEventListener("click", (e) => {
    if (!e.target.closest("button")) $("#compressInput").click();
  });
  $("#compressDrop").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("#compressInput").click(); }
  });
  $("#compressClearBtn").addEventListener("click", () => {
    if (!compress.files.length) return;
    if (!confirm("Kosongkan daftar file?")) return;
    compress.files.forEach((f) => dropThumbDoc(f.uid));
    revokeResults(compress.results);
    compress.files = [];
    compress.results = [];
    compressEst.token++;
    compressEst.cache.clear();
    compressEst.values.clear();
    // analisis berkas tidak dipakai lagi
    if (window.PDFCompressor && typeof window.PDFCompressor.releaseAnalyses === "function") {
      try { window.PDFCompressor.releaseAnalyses(); } catch (_) {}
    }
    compressShowResults();
    compressRender();
    toast("Daftar dikosongkan.");
  });

  /* ---------- mesin kompres ----------
     Logika kompresi berada di compressor.js (window.PDFCompressor)
     Supaya hasil kompresi tetap tajam: teks & font tidak pernah
     dirasterisasi pada mode "Optimal", dan hasil tidak pernah
     lebih besar daripada berkas asli.
     ------------------------------------------------ */
  function compressEngine() {
    return window.PDFCompressor || null;
  }

  function compressFileName(f, label, used) {
    const stem = `${safe(baseName(f.name))}-kompres-${safe(label.toLowerCase().replace(/\s+/g, "")).slice(0, 20)}`;
    let name = stem + ".pdf";
    let n = 2;
    while (used && used.has(name.toLowerCase())) name = `${stem}-${n++}.pdf`;
    if (used) used.add(name.toLowerCase());
    return name;
  }

  /* ---------- jalankan ---------- */
  $("#compressRunBtn").addEventListener("click", compressRun);

  async function compressRun() {
    if (compress.busy || !compress.files.length) return;
    const engine = compressEngine();
    if (!engine) {
      toast("Mesin kompresi tidak termuat (compressor.js).", "err", 6000);
      return;
    }
    const st = compressSettings();
    compress.busy = true;
    $("#compressRunBtn").disabled = true;
    showOverlay("Mengompres…");
    const results = [];
    const usedNames = new Set();
    try {
      const list = compress.files.slice();
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        overlayText.textContent = `Mengompres ${f.name} (${f.pageCount} halaman)…`;
        setProgress((i / list.length) * 100);
        let res;
        try {
          res = await engine.compress(
            f.bytes,
            {
              mode: st.mode,
              dpi: st.dpi,
              quality: st.quality,
              gray: st.gray,
              cleanMeta: st.cleanMeta,
              neverBigger: st.neverBigger,
            },
            (text, ratio) => {
              const per = 100 / list.length;
              const r = Math.max(0, Math.min(1, ratio || 0));
              setProgress(i * per + r * per);
              if (text) overlayText.textContent = `${f.name} — ${text}`;
            }
          );
        } catch (err) {
          console.error(err);
          toast(`Gagal mengompres "${f.name}". ${err?.message || err}`.trim(), "err", 6000);
          continue;
        }
        const name = compressFileName(f, st.label, usedNames);
        const blob = new Blob([res.bytes], { type: "application/pdf" });
        const item = {
          uid: f.uid,
          name,
          blob,
          url: URL.createObjectURL(blob),
          size: blob.size,
          original: f.size,
          pageCount: res.pageCount,
          label: st.label,
          unchanged: !!res.unchanged,
          stats: res.stats || null,
        };
        results.push(item);
      }
      if (!results.length) throw new Error("Tidak ada file yang berhasil dikompres.");
      revokeResults(compress.results);
      compress.results = results;
      setProgress(100);
      compressShowResults();

      const totalIn = results.reduce((s, r) => s + r.original, 0);
      const totalOut = results.reduce((s, r) => s + r.size, 0);
      const pct = totalIn ? Math.round((1 - totalOut / totalIn) * 100) : 0;
      if ($("#compressAutoDl").checked) {
        if (results.length === 1) downloadBlob(results[0].blob, results[0].name);
        else {
          const zip = new JSZip();
          results.forEach((r) => zip.file(r.name, r.blob));
          const zb = await zip.generateAsync({ type: "blob", compression: "STORE" });
          downloadBlob(zb, "pdf-terkompres.zip");
        }
      }
      toast(
        pct > 0
          ? `Selesai — total ${pct}% lebih kecil (${fmtSize(totalIn)} → ${fmtSize(totalOut)}).`
          : `Selesai. Berkas asli dipertahankan (${fmtSize(totalOut)}) agar ukuran tidak membengkak.`,
        pct > 0 ? "ok" : "",
        5200
      );
    } catch (err) {
      console.error(err);
      toast("Gagal mengompres: " + (err?.message || err), "err", 6000);
    } finally {
      compress.busy = false;
      hideOverlay();
      compressRender();
      // perkiraan disegarkan lagi setelah kompresi selesai
      compressEstimateSchedule(200);
    }
  }

  function compressShowResults() {
    const card = $("#compressResultCard");
    const box = $("#compressResults");
    const res = compress.results || [];
    if (!res.length) {
      card.hidden = true;
      box.innerHTML = "";
      $("#compressZipBtn").hidden = true;
      $("#savingBar").hidden = true;
    } else {
      card.hidden = false;
      box.innerHTML = "";
      res.forEach((r) => {
        const row = document.createElement("div");
        row.className = "result";
        const nm = document.createElement("div");
        nm.className = "rname";
        nm.textContent = r.name;
        nm.title = r.name;
        const diff = r.original - r.size;
        const pct = r.original ? Math.round((1 - r.size / r.original) * 100) : 0;
        const badge = document.createElement("span");
        badge.className = "crow-badge " + (pct > 0 ? "good" : r.unchanged ? "" : "bad");
        badge.textContent = r.unchanged
          ? "tidak berubah"
          : `${fmtSize(r.original)} → ${fmtSize(r.size)}` +
            (diff !== 0 ? ` (${pct > 0 ? "−" : "+"}${Math.abs(pct)}%)` : "");
        if (r.stats && r.stats.images) {
          const im = r.stats.images;
          row.title =
            `Gambar diperkecil: ${im.replaced} · dipertahankan: ${im.kept} · dilewati: ${im.skipped}\n` +
            `Hemat: ${fmtSize(im.savedBytes)}`;
        }
        const a = document.createElement("a");
        a.className = "rl";
        a.textContent = "Unduh";
        a.href = r.url;
        a.download = r.name;
        row.append(nm, badge, a);
        box.appendChild(row);
      });
      $("#compressZipBtn").hidden = res.length < 2;

      const totalIn = res.reduce((s, r) => s + r.original, 0);
      const totalOut = res.reduce((s, r) => s + r.size, 0);
      const pct = totalIn ? Math.max(0, Math.round((1 - totalOut / totalIn) * 100)) : 0;
      const bar = $("#savingBar");
      bar.hidden = false;
      bar.classList.toggle("worse", totalOut >= totalIn);
      $("#savingPct").textContent = pct + "%";
      $("#savingAbs").textContent = `${fmtSize(totalIn)} → ${fmtSize(totalOut)}` + (pct === 0 ? " (tidak ada penurunan)" : "");
      $("#savingFill").style.width = Math.min(100, Math.max(3, pct)) + "%";
      const mrowBadges = new Map(res.map((r) => [r.uid, r]));
      document.querySelectorAll(".compress-row").forEach((rowEl) => {
        const r = mrowBadges.get(rowEl.dataset.uid);
        const badge = rowEl.querySelector(".crow-badge");
        if (!r || !badge) return;
        const p = r.original ? Math.round((1 - r.size / r.original) * 100) : 0;
        badge.hidden = false;
        badge.className = "crow-badge " + (p > 0 ? "good" : "bad");
        badge.textContent = p > 0 ? `−${p}%` : "+0%";
        rowEl.classList.add("compressed");
      });
    }
    $("#compressZipBtn").onclick = async () => {
      if (!compress.results.length) return;
      showOverlay("Membuat ZIP…");
      const zip = new JSZip();
      compress.results.forEach((r) => zip.file(r.name, r.blob));
      const blob = await zip.generateAsync({ type: "blob", compression: "STORE" }, (m) => setProgress(m.percent));
      hideOverlay();
      downloadBlob(blob, "pdf-terkompres.zip");
    };
  }

  /* ---------- drag & drop tab kompres ---------- */
  window.addEventListener("dragover", (e) => {
    if (activeTab !== "compress") return;
    if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
    e.preventDefault();
    $("#compressDrop").classList.add("drag");
  });
  window.addEventListener("dragleave", (e) => {
    if (activeTab !== "compress") return;
    if (e.relatedTarget) return;
    $("#compressDrop").classList.remove("drag");
  });
  window.addEventListener("drop", (e) => {
    if (activeTab !== "compress") return;
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    e.stopPropagation();
    $("#compressDrop").classList.remove("drag");
    compressAddFiles(e.dataTransfer.files);
  });

  compressRender();
  compressSyncSliders();

  /* ============================================================
     Init
     ============================================================ */
  initTheme();

  /* Render pertama: baris pintasan "Paling sering dipakai" harus
     langsung terlihat di beranda, bukan tersembunyi sampai pengguna
     berpindah tab. */
  render();

  /* Penjaga cache di index.html mungkin sudah memuat ulang style.css
     yang basi (--css-build tidak cocok). Beri tahu pengguna supaya
     tidak mengira tampilan masih salah. */
  if (document.documentElement.getAttribute("data-css-refreshed") === "1") {
    setTimeout(() => toast("Stylesheet kedaluwarsa diperbarui otomatis — tampilan terbaru sudah dimuat."),
      700);
  }

  const themeBtn = $("#themeBtn");
  if (themeBtn) themeBtn.addEventListener("click", toggleTheme);

  /* ikuti perubahan tema sistem selama pengguna belum memilih manual */
  if (window.matchMedia) {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemTheme = () => {
      const saved = readStoredTheme();
      if (saved !== "dark" && saved !== "light") {
        applyTheme(mq.matches ? "dark" : "light");
      }
    };
    if (typeof mq.addEventListener === "function") mq.addEventListener("change", onSystemTheme);
    else if (typeof mq.addListener === "function") mq.addListener(onSystemTheme);
  }

  if (!window.PDFLib) {
    document.body.insertAdjacentHTML(
      "afterbegin",
      '<div style="padding:16px;background:#fdeceb;color:#a3301f;font:14px system-ui">Library gagal dimuat. Pastikan folder <b>vendor/</b> ada di samping file HTML ini.</div>'
    );
  }
  if (!window.PDFCompressor) {
    document.body.insertAdjacentHTML(
      "afterbegin",
      '<div style="padding:16px;background:#fdeceb;color:#a3301f;font:14px system-ui">Mesin kompresi gagal dimuat. Pastikan berkas <b>compressor.js</b> ada di samping file HTML ini.</div>'
    );
  }
  updateRunState();

  /* ============================================================
     Alat (toolkit)
     ============================================================
     Fitur yang sudah punya tab sendiri (Pemisah / Gabung /
     Kompres) tidak diulang sebagai alat baru — di menu "Semua
     alat" semuanya ditautkan ke tab yang sudah ada. */
  window.PDFShared = {
    toast, showOverlay, setProgress, hideOverlay, downloadBlob,
    fmtSize, baseName, safe, tick, PRODUCER,
    get overlayText() { return overlayText; },
  };
  /* Pilih mode kerja pada tab Halaman PDF (dipakai tautan launcher). */
  function setMode(mode) {
    const radio = document.querySelector(`input[name="mode"][value="${mode}"]`);
    if (!radio) return false;
    radio.checked = true;
    radio.dispatchEvent(new Event("change", { bubbles: true }));
    updateRunState();
    return true;
  }

  window.PDFApp = {
    setTab,
    setMode,
    activeTab: () => activeTab,
    /* keadaan seleksi untuk pengujian otomatis & debugging */
    state: () => ({
      selected: state.selected.size,
      deleted: state.deleted.size,
      mode: currentMode(),
      files: state.files.length,
    }),
    selectedCount: () => state.selected.size,
    deletedCount: () => state.deleted.size,
  };

  if (window.PDFToolsUI) {
    /* Tautan ke alur yang SUDAH ada di aplikasi (bukan menu baru):
       supaya tidak ada fitur yang terduplikasi. `mode` memilih alur
       yang tepat di dalam tab Halaman PDF. */
    window.PDFToolsUI.init([
      { id: "merge", cat: "organize", name: "Gabung PDF", desc: "Satukan beberapa PDF jadi satu berkas.", icon: "merge", link: "merge" },
      { id: "split", cat: "organize", name: "Pisah PDF", desc: "Pecah PDF per halaman, rentang, atau penanda buku.", icon: "split", link: "split", mode: "each" },
      { id: "remove-pages", cat: "organize", name: "Hapus halaman", desc: "Buang halaman tertentu; sisanya jadi satu PDF baru.", icon: "removePage", link: "split", mode: "remove" },
      { id: "extract-pages", cat: "organize", name: "Ekstrak halaman", desc: "Simpan hanya halaman yang dipilih jadi PDF baru.", icon: "extractPage", link: "split", mode: "extract" },
      { id: "compress-link", cat: "optimize", name: "Kompres PDF", desc: "Perkecil ukuran file, teks tetap tajam.", icon: "compress", link: "compress" },
    ]);
  }
})();
