/* ============================================================
   Pemisah PDF — logika aplikasi (100% client-side)
   Library: pdf-lib (tulis/pecah) · pdf.js (pratinjau) · JSZip
   ============================================================ */
(() => {
  "use strict";

  const { PDFDocument, degrees } = PDFLib;

  /* ---------- pdf.js worker ---------- */
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
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

  /* ---------- state ---------- */
  const state = {
    files: [],          // {id, name, bytes, pageCount, doc, bookmarks, thumbs:true[]}
    selected: new Set(), // key = `${fileId}:${pageIndex}`
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
        console.error(err);
        toast(`Gagal membaca "${f.name}". ${err?.message || ""}`.trim(), "err", 5000);
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
      doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
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

  function isEncryptedError(err) {
    return /encrypt|password|decrypt/i.test(String(err?.message || err));
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

  /* ============================================================
     Render UI
     ============================================================ */
  function render() {
    const has = state.files.length > 0;
    workspace.hidden = !has || activeTab !== "split";
    dropzone.style.display = has || activeTab !== "split" ? "none" : "";
    filesEl.innerHTML = "";
    state.files.forEach((f) => filesEl.appendChild(fileBlock(f)));
    updateSelectionUI();
    updateRunState();
    zipAllBtn.hidden = state.results.length < 2;
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
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "thumb";
      btn.dataset.fid = f.id;
      btn.dataset.page = p;
      btn.setAttribute("aria-label", `Halaman ${p + 1} dari ${f.name}`);

      const num = document.createElement("span");
      num.className = "tnum";
      num.textContent = p + 1;

      const chk = document.createElement("span");
      chk.className = "tcheck";
      chk.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4.5 4.5L19 7"/></svg>`;

      const ph = document.createElement("div");
      ph.className = "ph";

      btn.append(num, chk, ph);
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
    for (let p = 0; p < removed.pageCount; p++) state.selected.delete(key(fid, p));
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
    state.files = [];
    state.selected.clear();
    state.results = [];
    lastClicked = null;
    filesEl.innerHTML = "";
    workspace.hidden = true;
    dropzone.style.display = activeTab === "split" ? "" : "none";
    resultCard.hidden = true;
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
      } catch (_) {
        /* biarkan placeholder */
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
    const url = canvas.toDataURL("image/jpeg", 0.72);
    const ph = btn.querySelector(".ph");
    if (!ph) return;
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    ph.replaceWith(img);
    canvas.width = canvas.height = 0;
  }

  /* ============================================================
     Seleksi
     ============================================================ */
  filesEl.addEventListener("click", (e) => {
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

  function paintSelection() {
    filesEl.querySelectorAll(".thumb").forEach((btn) => {
      const on = state.selected.has(key(btn.dataset.fid, Number(btn.dataset.page)));
      btn.classList.toggle("sel", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    updateSelInfo();
  }

  function updateSelInfo() {
    const total = state.files.reduce((s, f) => s + f.pageCount, 0);
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
    if (sel === "all") {
      state.files.forEach((f) => {
        for (let p = 0; p < f.pageCount; p++) state.selected.add(key(f.id, p));
      });
    } else if (sel === "none") {
      state.selected.clear();
    } else if (sel === "invert") {
      state.files.forEach((f) => {
        for (let p = 0; p < f.pageCount; p++) {
          const k = key(f.id, p);
          if (state.selected.has(k)) state.selected.delete(k);
          else state.selected.add(k);
        }
      });
    } else if (sel === "odd" || sel === "even") {
      state.selected.clear();
      let g = 1;
      state.files.forEach((f) => {
        for (let p = 0; p < f.pageCount; p++, g++) {
          if ((sel === "odd" && g % 2 === 1) || (sel === "even" && g % 2 === 0)) {
            state.selected.add(key(f.id, p));
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
      chunkOpt.hidden = m !== "chunk";
      rangeOpt.hidden = m !== "range";
      if (m === "range" && !$("#rangeInput").value.trim()) {
        $("#rangeInput").value = suggestRanges();
      }
      updateRunState();
    });
  });

  $("#chunkSize").addEventListener("input", updateRunState);
  $("#chunkUseSel").addEventListener("change", updateRunState);
  $("#rangeInput").addEventListener("input", updateRunState);

  function suggestRanges() {
    const first = state.files[0];
    if (!first) return "1-3, 4-6, 7-9";
    const cuts = [];
    let start = 1;
    while (start <= first.pageCount) {
      const end = Math.min(first.pageCount, start + 2);
      cuts.push(start === end ? `${start}` : `${start}-${end}`);
      start = end + 1;
    }
    return cuts.join(", ");
  }

  function updateRunState() {
    const mode = currentMode();
    const nSel = state.selected.size;
    const total = state.files.reduce((s, f) => s + f.pageCount, 0);
    let label = "Proses";
    let hint = "";
    let enabled = state.files.length > 0 && !state.busy;

    if (mode === "extract") {
      label = "Ekstrak jadi 1 PDF";
      enabled = enabled && nSel > 0;
      hint = nSel ? `${nf(nSel)} halaman akan digabung.` : "Pilih minimal 1 halaman.";
    } else if (mode === "each") {
      const eff = nSel || total;
      label = "Pisah tiap halaman";
      hint = `${nf(eff)} file PDF dalam satu ZIP.`;
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
    out.setProducer("Pemisah PDF");
    out.setCreator("Pemisah PDF (pdf-lib)");
    out.setCreationDate(new Date());

    // kelompokkan per file agar copyPages efisien
    const groups = new Map();
    for (const p of pages) {
      if (!groups.has(p.file.id)) groups.set(p.file.id, { file: p.file, idx: [] });
      groups.get(p.file.id).idx.push(p.page);
    }
    for (const { file, idx } of groups.values()) {
      const copied = await out.copyPages(file.doc, idx);
      for (const cp of copied) out.addPage(cp);
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
      } else if (mode === "each") {
        const list = state.selected.size ? selectedPages() : allPages();
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
        const list = $("#chunkUseSel").checked
          ? selectedPages()
          : state.selected.size && !$("#chunkUseSel").checked
          ? allPages()
          : allPages();
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
      for (const r of state.results) zip.file(r.name, r.blob);
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
      pdfCache.clear();
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
    document.querySelectorAll(".tab").forEach((t) => {
      const on = t.dataset.tab === tab;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    const activeEl = document.querySelector(".tab.active");
    const bar = document.querySelector(".tabs");
    if (activeEl && bar && bar.scrollWidth > bar.clientWidth) {
      bar.scrollLeft = Math.max(0, activeEl.offsetLeft - 6);
    }
    const isSplit = tab === "split";
    const isMerge = tab === "merge";
    const isCompress = tab === "compress";

    $("#mergeView").hidden = !isMerge;
    $("#compressView").hidden = !isCompress;
    workspace.hidden = !isSplit || !state.files.length;
    dropzone.style.display = isSplit && !state.files.length ? "" : "none";

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

  document.querySelector(".tabs").addEventListener("click", (e) => {
    const t = e.target.closest(".tab");
    if (t) setTab(t.dataset.tab);
  });

  /* ---------- state gabung ---------- */
  const merge = {
    files: [],      // {uid, name, bytes, doc, pageCount, uniqPages, allPages, thumbs:Set|null, size}
    results: [],
    busy: false,
  };
  let mergeUid = 0;
  let dragUid = null;

  function setMergeDropVisible() {
    $("#mergeDrop").hidden = merge.files.length > 0;
  }

  function mergeRender() {
    const listEl = $("#mlist");
    listEl.innerHTML = "";
    merge.files.forEach((f, i) => listEl.appendChild(mergeRow(f, i)));
    setMergeDropVisible();

    const n = merge.files.length;
    const pages = merge.files.reduce((s, f) => s + f.pageCount, 0);
    $("#mergeInfo").textContent = n ? `${nf(n)} file` : "Belum ada file";
    $("#mergePagesInfo").textContent = n ? `${nf(pages)} halaman akan digabung` : "Tarik file PDF untuk mulai";
    $("#mergeRunBtn").disabled = n < 2 || pages === 0;
    $("#mergeInfo").classList.toggle("active", n > 0);

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

  async function renderMergeThumb(el, f) {
    try {
      const pdf = await pdfjsLib.getDocument({ data: f.bytes.slice(0), isEvalSupported: false }).promise;
      const page = await pdf.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(1.4, 52 / base.height) * 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      const img = document.createElement("img");
      img.src = canvas.toDataURL("image/jpeg", 0.7);
      img.alt = "";
      img.className = "mthumb";
      if (el.isConnected) el.replaceWith(img);
      try { pdf.destroy(); } catch (_) {}
      canvas.width = canvas.height = 0;
    } catch (err) {
      console.error("Thumbnail gabung gagal:", err);
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
        console.error(err);
        toast(`Gagal membaca "${file.name}". ${err?.message || ""}`.trim(), "err", 5000);
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
  $("#mergeClearBtn").addEventListener("click", () => {
    if (!merge.files.length) return;
    if (!confirm("Kosongkan daftar file yang akan digabung?")) return;
    merge.files = [];
    merge.results = [];
    $("#mergeResultCard").hidden = true;
    $("#mergeResults").innerHTML = "";
    mergeRender();
    toast("Daftar gabung dikosongkan.");
  });

  /* ---------- proses gabung ---------- */
  $("#mergeRunBtn").addEventListener("click", async () => {
    if (merge.busy || merge.files.length < 2) return;
    merge.busy = true;
    $("#mergeRunBtn").disabled = true;
    showOverlay("Menggabungkan PDF…");
    try {
      const out = await PDFDocument.create();
      out.setProducer("Pemisah PDF");
      out.setCreator("Pemisah PDF (pdf-lib)");
      out.setCreationDate(new Date());

      const totalPages = merge.files.reduce((n, f) => n + f.pageCount, 0);
      let done = 0;

      for (const f of merge.files) {
        overlayText.textContent = `Menggabungkan ${f.name}…`;
        setProgress((done / totalPages) * 100);
        const pages = await out.copyPages(f.doc, f.doc.getPageIndices());
        pages.forEach((pg) => out.addPage(pg));
        done += pages.length;
        setProgress((done / totalPages) * 100);
        await tick();
      }

      if (!out.getPageCount()) throw new Error("Tidak ada halaman yang bisa digabung.");

      const bytes = await out.save({ useObjectStreams: true, addDefaultPage: false });
      const blob = new Blob([bytes], { type: "application/pdf" });
      const name = mergeFileName();
      const item = { name, blob, url: URL.createObjectURL(blob), size: blob.size };
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
      toast(`Selesai — ${nf(out.getPageCount())} halaman digabung.`, "ok");
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
    files: [],   // {uid, name, bytes, doc, pageCount, size}
    results: [],
    busy: false,
  };
  let compressUid = 0;

  const PRESETS = {
    lossless: { mode: "lossless", label: "Ringan" },
    balanced: { mode: "raster", dpi: 150, quality: 0.7, label: "Seimbang" },
    strong: { mode: "raster", dpi: 110, quality: 0.5, label: "Kuat" },
  };

  function compressSettings() {
    const level = document.querySelector('input[name="clevel"]:checked').value;
    const gray = $("#grayChk").checked;
    if (level === "custom") {
      return {
        mode: "raster",
        dpi: parseInt($("#dpiRange").value, 10) || 150,
        quality: (parseInt($("#qRange").value, 10) || 70) / 100,
        gray,
        label: "Kustom",
      };
    }
    const p = PRESETS[level];
    return { ...p, gray };
  }

  document.querySelectorAll('input[name="clevel"]').forEach((r) => {
    r.addEventListener("change", () => {
      const lvl = document.querySelector('input[name="clevel"]:checked').value;
      $("#customOpts").hidden = lvl !== "custom";
      compressUpdateNote();
    });
  });
  $("#dpiRange").addEventListener("input", () => {
    $("#dpiVal").textContent = $("#dpiRange").value + " DPI";
    compressUpdateNote();
  });
  $("#qRange").addEventListener("input", () => {
    $("#qVal").textContent = $("#qRange").value + "%";
    compressUpdateNote();
  });
  $("#grayChk").addEventListener("change", compressUpdateNote);

  function compressUpdateNote() {
    const st = compressSettings();
    const note = $("#compressNote");
    if (st.mode === "lossless") {
      note.textContent = "Mode ringan hanya membuang data tak terpakai — hasil bisa sama besar atau sedikit lebih kecil, tergantung PDF.";
    } else {
      note.textContent = `Halaman akan dirasterisasi ke ${st.dpi} DPI, kualitas ${Math.round(st.quality * 100)}%${st.gray ? ", hitam-putih" : ""}. Teks tidak lagi bisa dicari/di-copy.`;
    }
  }

  function compressRender() {
    const listEl = $("#clist");
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
        compressShowResults();
        compressRender();
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
              bytes: opened, doc, pageCount: doc.getPageCount(), size: opened.length,
            });
            added++;
            continue;
          }
          doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
        }
        const n = doc.getPageCount();
        if (!n) throw new Error("PDF tidak memiliki halaman.");
        compress.files.push({
          uid: "c" + ++compressUid,
          name: file.name, bytes, doc, pageCount: n, size: file.size,
        });
        added++;
      } catch (err) {
        console.error(err);
        toast(`Gagal membaca "${file.name}". ${err?.message || ""}`.trim(), "err", 5000);
      }
      await tick();
    }
    hideOverlay();
    if (added) { compressRender(); toast(`${added} file siap dikompres.`, "ok"); }
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
    compress.files = [];
    compress.results = [];
    compressShowResults();
    compressRender();
    toast("Daftar dikosongkan.");
  });

  /* ---------- mesin kompres ---------- */
  async function loadPdfjs(bytes) {
    return pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Gagal mengubah gambar."))), type, quality);
    });
  }

  async function rasterize(srcBytes, st, label, onPage) {
    const src = await loadPdfjs(srcBytes);
    const out = await PDFDocument.create();
    out.setProducer("Pemisah PDF");
    out.setCreator("Pemisah PDF (kompres)");
    out.setCreationDate(new Date());
    const CONCURRENCY = 3;
    let next = 0, done = 0;

    async function worker() {
      while (true) {
        const i = next++;
        if (i >= src.numPages) return;
        const page = await src.getPage(i + 1);
        const base = page.getViewport({ scale: 1 });
        const scale = st.dpi / 72;
        const vp = page.getViewport({ scale, rotation: page.rotate });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.ceil(vp.width));
        canvas.height = Math.max(1, Math.ceil(vp.height));
        const ctx = canvas.getContext("2d", { alpha: false });
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp, background: "#ffffff" }).promise;

        // grayscale via CSS filter saat menggambar ulang
        let target = canvas;
        if (st.gray) {
          target = document.createElement("canvas");
          target.width = canvas.width;
          target.height = canvas.height;
          const tctx = target.getContext("2d", { alpha: false });
          tctx.filter = "grayscale(1)";
          tctx.drawImage(canvas, 0, 0);
        }

        const blob = await canvasToBlob(target, "image/jpeg", st.quality);
        const jpg = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
        // ukuran halaman tetap dalam poin (identitas)
        const wPt = base.width;
        const hPt = base.height;
        const pg = out.addPage([wPt, hPt]);
        pg.drawImage(jpg, { x: 0, y: 0, width: wPt, height: hPt });

        canvas.width = canvas.height = 0;
        if (target !== canvas) { target.width = target.height = 0; }
        page.cleanup();
        done++;
        onPage(done, src.numPages);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, src.numPages) }, worker));
    try { src.destroy(); } catch (_) {}
    const bytes = await out.save({ useObjectStreams: true, addDefaultPage: false });
    return { blob: new Blob([bytes], { type: "application/pdf" }), pageCount: out.getPageCount(), label };
  }

  async function losslessCompress(srcBytes) {
    const doc = await PDFDocument.load(srcBytes, { updateMetadata: false });
    const count = doc.getPageCount();
    const bytes = await doc.save({ useObjectStreams: true, addDefaultPage: false });
    return { blob: new Blob([bytes], { type: "application/pdf" }), pageCount: count, label: "Ringan" };
  }

  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h;
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
        overlayText.textContent =
          st.mode === "lossless" ? `Optimasi ${f.name}…` : `Mengompres ${f.name} (${f.pageCount} halaman)…`;
        setProgress((i / list.length) * 100);
        let res;
        try {
          res =
            st.mode === "lossless"
              ? await losslessCompress(f.bytes)
              : await rasterize(f.bytes, st, st.label, (done, total) => {
                  const per = 100 / list.length;
                  setProgress(i * per + (done / total) * per);
                  overlayText.textContent = `Mengompres ${f.name} — halaman ${done}/${total}`;
                });
        } catch (err) {
          console.error(err);
          toast(`Gagal mengompres "${f.name}". ${err?.message || err}`.trim(), "err", 6000);
          continue;
        }
        const name = compressFileName(f, st.label, usedNames);
        const item = {
          uid: f.uid,
          name,
          blob: res.blob,
          url: URL.createObjectURL(res.blob),
          size: res.blob.size,
          original: f.size,
          pageCount: res.pageCount,
          label: st.label,
          hash: fnv1a(f.uid + "|" + st.label + "|" + st.dpi + "|" + st.quality + "|" + st.gray),
        };
        results.push(item);
      }
      if (!results.length) throw new Error("Tidak ada file yang berhasil dikompres.");
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
          : `Selesai. Tidak ada penurunan ukuran (${fmtSize(totalOut)}) — coba mode Seimbang/Kuat.`,
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
        badge.className = "crow-badge " + (pct > 0 ? "good" : "bad");
        badge.textContent = `${fmtSize(r.original)} → ${fmtSize(r.size)}` + (diff !== 0 ? ` (${pct > 0 ? "−" : "+"}${Math.abs(pct)}%)` : "");
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

  /* ============================================================
     Init
     ============================================================ */
  if (!window.PDFLib) {
    document.body.insertAdjacentHTML(
      "afterbegin",
      '<div style="padding:16px;background:#fdeceb;color:#a3301f;font:14px system-ui">Library gagal dimuat. Pastikan folder <b>vendor/</b> ada di samping file HTML ini.</div>'
    );
  }
  updateRunState();
})();
