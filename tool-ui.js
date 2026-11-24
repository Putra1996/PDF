/* ============================================================
   Antarmuka alat: menu berkategori + ruang kerja generik.
   ============================================================ */
(function () {
  "use strict";

  const C = window.PDFToolsCore;

  function sh() {
    return window.PDFShared || {};
  }

  const CATS = [
    { id: "organize", name: "Susun PDF" },
    { id: "optimize", name: "Optimalkan PDF" },
    { id: "convert-to", name: "Konversi ke PDF" },
    { id: "convert-from", name: "Konversi dari PDF" },
    { id: "edit", name: "Edit PDF" },
    { id: "security", name: "Keamanan PDF" },
    { id: "ai", name: "Kecerdasan PDF" },
  ];

  const ICONS = {
    merge: '<path d="M6 3.5v5.2c0 1.6 1.3 2.9 2.9 2.9h6.2c1.6 0 2.9 1.3 2.9 2.9v6"/><path d="m14.8 17.3 3.2 3.2 3.2-3.2"/><path d="M18 11.5V6.7"/>',
    split: '<path d="M12 3.6v9.2"/><path d="m8.2 9 3.8 3.8L15.8 9"/><path d="M4 16.4v2.2A1.9 1.9 0 0 0 5.9 20.5h3.2"/><path d="M20 16.4v2.2a1.9 1.9 0 0 1-1.9 1.9h-3.2"/>',
    compress: '<path d="M9.5 4.5H5.8A1.3 1.3 0 0 0 4.5 5.8v3.7"/><path d="m4.9 4.9 4.4 4.4"/><path d="M14.5 19.5h3.7a1.3 1.3 0 0 0 1.3-1.3v-3.7"/><path d="m19.1 19.1-4.4-4.4"/><path d="M4.5 14.5v3.7a1.3 1.3 0 0 0 1.3 1.3h3.7"/><path d="m4.9 19.1 4.4-4.4"/><path d="M19.5 9.5V5.8a1.3 1.3 0 0 0-1.3-1.3h-3.7"/><path d="m19.1 4.9-4.4 4.4"/>',
    organize: '<rect x="3.5" y="4.5" width="7" height="7" rx="1.2"/><rect x="13.5" y="4.5" width="7" height="7" rx="1.2"/><rect x="3.5" y="14.5" width="7" height="5" rx="1.2"/><rect x="13.5" y="14.5" width="7" height="5" rx="1.2"/>',
    removePage: '<path d="M14 4.5H7.2A1.7 1.7 0 0 0 5.5 6.2v12.6a1.7 1.7 0 0 0 1.7 1.7h9.6a1.7 1.7 0 0 0 1.7-1.7V9.5z"/><path d="M14 4.5v5h5"/><path d="M9.5 14.5h5"/>',
    extractPage: '<path d="M13.5 4.5H7.2A1.7 1.7 0 0 0 5.5 6.2v12.6a1.7 1.7 0 0 0 1.7 1.7h5.3"/><path d="M13.5 4.5v5h5"/><path d="m15 14.5 5.5 5.5M20.5 14.5 15 20"/>',
    pdfToImage: '<path d="M3 5h5l2.5 2.5V19H3z"/><path d="M8 5v2.5h2.5"/><path d="M11.8 12h3.2"/><path d="m13.6 10.4 1.9 1.6-1.9 1.6"/><rect x="16.4" y="8.4" width="5.2" height="7.2" rx="1"/><circle cx="18" cy="10.7" r=".7"/><path d="m16.4 14.5 1.7-1.6 1.4 1.2 1.1-1 1 1"/>',
    pdfToWord: '<path d="M3 5h5l2.5 2.5V19H3z"/><path d="M8 5v2.5h2.5"/><path d="M11.8 12h3.2"/><path d="m13.6 10.4 1.9 1.6-1.9 1.6"/><rect x="16.2" y="8" width="5.6" height="8" rx="1"/><path d="m17.3 10 1 4 1.1-2.4 1.1 2.4 1-4"/>',
    pdfToXls: '<path d="M3 5h5l2.5 2.5V19H3z"/><path d="M8 5v2.5h2.5"/><path d="M11.8 12h3.2"/><path d="m13.6 10.4 1.9 1.6-1.9 1.6"/><rect x="16.2" y="8" width="5.6" height="8" rx="1"/><path d="M16.2 11h5.6M16.2 13.4h5.6M18 8v8M20 8v8"/>',
    pdfToPpt: '<path d="M3 5h5l2.5 2.5V19H3z"/><path d="M8 5v2.5h2.5"/><path d="M11.8 12h3.2"/><path d="m13.6 10.4 1.9 1.6-1.9 1.6"/><rect x="16.2" y="8" width="5.6" height="8" rx="1"/><path d="M17.9 14.4V9.8h1.5a1.3 1.3 0 0 1 0 2.6h-1.5"/>',
    scan: '<path d="M4 8V5.6A1.6 1.6 0 0 1 5.6 4H8"/><path d="M16 4h2.4A1.6 1.6 0 0 1 20 5.6V8"/><path d="M20 16v2.4a1.6 1.6 0 0 1-1.6 1.6H16"/><path d="M8 20H5.6A1.6 1.6 0 0 1 4 18.4V16"/><path d="M4 12h16"/>',
    repair: '<path d="M14.5 3.5 20.5 9.5"/><path d="M12.5 5.5 5.5 12.5a2 2 0 0 0 0 2.8l3.2 3.2a2 2 0 0 0 2.8 0l7-7"/><path d="m9 11 4 4"/>',
    ocr: '<path d="M4 8V5.6A1.6 1.6 0 0 1 5.6 4H8"/><path d="M16 4h2.4A1.6 1.6 0 0 1 20 5.6V8"/><path d="M20 16v2.4a1.6 1.6 0 0 1-1.6 1.6H16"/><path d="M8 20H5.6A1.6 1.6 0 0 1 4 18.4V16"/><path d="M7.5 9.5h9M7.5 13h6"/>',
    image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4.5 17 4.6-4.2 3.2 2.8 2.6-2.2 4.6 4"/>',
    html: '<path d="M4 5.5h16l-1.6 13L12 20l-6.4-1.5z"/><path d="M9 9.5h6M9 13h4"/>',
    word: '<path d="M5 5.5h14v13H5z"/><path d="m8.5 9 1.6 6 1.9-4.4 1.9 4.4 1.6-6"/>',
    ppt: '<path d="M5 5.5h14v13H5z"/><path d="M8.5 16V9h2.6a2 2 0 0 1 0 4H8.5"/><path d="M13.5 9v7M13.5 9h2.4"/>',
    xls: '<path d="M5 5.5h14v13H5z"/><path d="M5 9.5h14M5 14h14M10 5.5v13M14.5 5.5v13"/>',
    pdfa: '<path d="M6 3.5h7.5L18 8v12.5H6z"/><path d="M13.5 3.5V8H18"/><path d="M9 12h1.6a1.3 1.3 0 0 1 0 2.6H9V12zm0 2.6v2.6M13 12.4h2.2M13 14.2h2.2"/>',
    rotate: '<path d="M12 5.5V3L8 6l4 3V6.8A5.2 5.2 0 1 1 6.8 12"/><path d="M12 18.5V21l4-3-4-3v2.2A5.2 5.2 0 1 0 17.2 12"/>',
    numbers: '<rect x="4.5" y="4" width="15" height="16" rx="2"/><path d="M8 8.5h2M8 12h2M8 15.5h2M13 9.5h4M13 13.5h4M13 16.5h2"/>',
    watermark: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="m7 14 4-5 3 4 2-2 3 3"/>',
    crop: '<path d="M6.5 2.5v15h15"/><path d="M2.5 6.5h15v15"/>',
    edit: '<path d="m4 20 1-4.2L15.4 5.4a1.8 1.8 0 0 1 2.6 0l.6.6a1.8 1.8 0 0 1 0 2.6L8.2 19l-4.2 1z"/>',
    forms: '<rect x="4.5" y="3.5" width="15" height="17" rx="2"/><path d="M8 8h8M8 12h8M8 16h4"/>',
    unlock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.8a4 4 0 0 1 7.6-1.7"/>',
    lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/>',
    sign: '<path d="M3.5 19.5c3-.5 4-2 5-5s2-8 4-8 2 5 .5 8-2.5 4-4 3 0-3.5 2.5-4.5 6-2 9-1.5"/>',
    redact: '<path d="M4.5 5.5h15v13h-15z"/><path d="M7.5 10.5h9M7.5 14h6"/>',
    compare: '<path d="M12 4.5v15"/><path d="M6 8.5H3.5M6 12H3.5M6 15.5H3.5"/><path d="M18 8.5h2.5M18 12h2.5M18 15.5h2.5"/>',
    markdown: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M6.5 15.5v-7l3 3.5 3-3.5v7"/><path d="M16 8.5v4.5M14.2 11.2 16 13l1.8-1.8"/>',
    summary: '<path d="M5 4.5h14v15H5z"/><path d="M8 9h8M8 12h8M8 15h5"/>',
    translate: '<path d="M3.5 6h8"/><path d="M7.5 4v2c0 3-1.6 5.6-4 6.8"/><path d="M5 9.5c1.2 2.2 3 3.6 5 4.2"/><path d="m12.5 20 4-10 4 10M14 17h5"/>',
  };

  function iconSvg(name) {
    const body = ICONS[name] || ICONS.edit;
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  /* ---------- state ---------- */
  const state = {
    tool: null,
    files: [],
    opts: {},
    results: [],
    busy: false,
    custom: {},
    links: [],
    query: "",
    /* jumlah halaman terbesar di antara berkas yang dimuat — dipakai
       sebagai batas slider rentang halaman */
    pageCount: 0,
  };

  /* Widget rentang halaman yang aktif (dipakai untuk memperbarui
     batas slider ketika jumlah halaman berkas sudah diketahui). */
  let pageWidgets = [];

  /* Penomoran berkas alat — dipakai sebagai kunci dokumen pratinjau. */
  let toolFileSeq = 0;

  /* Alat yang paling sering dibuka — ditampilkan di beranda dan
     di atas daftar alat agar cepat dijangkau. */
  const POPULER = ["split", "merge", "compress", "edit", "watermark", "numbers"];

  /* Kartu launcher yang membuka tab utama diberi penanda supaya
     hierarki navigasi jelas dan alurnya tidak terasa dobel.
     Kunci = id entri launcher. */
  const TAB_BADGES = {
    merge: "Tab Gabung",
    split: "Tab Pemisah",
    "compress-link": "Tab Kompres",
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  /* ============================================================
     Menu alat
     ============================================================ */
  function renderLauncher() {
    const host = $("#toolCategories");
    if (!host) return;
    host.innerHTML = "";
    renderQuick();
    for (const cat of CATS) {
      const items = state.links.filter((l) => l.cat === cat.id);
      const tools = (C.registry || []).filter((t) => t.cat === cat.id);
      if (!items.length && !tools.length) continue;
      const sec = el("section", "tool-cat");
      sec.appendChild(el("h3", "tool-cat-title", cat.name));
      const grid = el("div", "tool-grid");
      for (const l of items) {
        const b = el("button", "tool-card");
        b.type = "button";
        b.dataset.toolLink = l.link;
        if (l.mode) b.dataset.toolMode = l.mode;
        /* Alur yang juga tersedia sebagai tab utama diberi penanda
           supaya hierarki navigasi jelas dan tidak terasa dobel. */
        const badge = TAB_BADGES[l.id]
          ? `<span class="tool-badge">${TAB_BADGES[l.id]}</span>` : "";
        b.innerHTML =
          `<span class="tool-ic">${iconSvg(l.icon)}</span>` +
          `<span class="tool-name">${l.name}${badge}</span>` +
          `<span class="tool-desc">${l.desc}</span>`;
        grid.appendChild(b);
      }
      for (const t of tools) {
        const b = el("button", "tool-card");
        b.type = "button";
        b.dataset.tool = t.id;
        b.innerHTML = `<span class="tool-ic">${iconSvg(t.icon)}</span><span class="tool-name">${t.name}</span><span class="tool-desc">${t.desc}</span>`;
        grid.appendChild(b);
      }
      sec.appendChild(grid);
      host.appendChild(sec);
    }
  }

  /* ============================================================
     Pencarian alat & pintasan
     ============================================================ */

  function popularEntries() {
    const out = [];
    for (const id of POPULER) {
      const l = state.links.find((x) => x.id === id);
      if (l) { out.push({ kind: "link", item: l }); continue; }
      const t = (C.registry || []).find((x) => x.id === id);
      if (t) out.push({ kind: "tool", item: t });
    }
    return out;
  }

  function quickButton(entry) {
    const b = el("button", "quick-btn");
    b.type = "button";
    const it = entry.item;
    if (entry.kind === "link") {
      b.dataset.toolLink = it.link;
      if (it.mode) b.dataset.toolMode = it.mode;
    } else {
      b.dataset.tool = it.id;
    }
    b.innerHTML =
      `<span class="quick-ic">${iconSvg(it.icon)}</span>` +
      `<span class="quick-txt"><span class="quick-name">${escapeHtml(it.name)}</span>` +
      `<span class="quick-desc">${escapeHtml(it.desc)}</span></span>`;
    return b;
  }

  /* Baris pintasan: di beranda (saat belum ada file) dan di atas
     daftar alat. */
  function renderQuick() {
    const entries = popularEntries();
    for (const [sel, hostSel] of [["#toolQuick", "#toolQuick"], ["#quickGrid", "#quickGrid"]]) {
      const host = $(hostSel);
      if (!host) continue;
      host.innerHTML = "";
      for (const e of entries) host.appendChild(quickButton(e));
    }
  }

  /* Filter daftar alat berdasarkan ketikan pengguna. */
  function applyFilter() {
    const host = $("#toolCategories");
    if (!host) return;
    const q = (state.query || "").trim().toLowerCase();
    let total = 0;
    for (const sec of host.querySelectorAll(".tool-cat")) {
      let tampil = 0;
      for (const card of sec.querySelectorAll(".tool-card")) {
        const nama = (card.querySelector(".tool-name")?.textContent || "").toLowerCase();
        const desc = (card.querySelector(".tool-desc")?.textContent || "").toLowerCase();
        const kunci = (card.dataset.tool || card.dataset.toolLink || "").toLowerCase();
        const cocok = !q || nama.includes(q) || desc.includes(q) || kunci.includes(q);
        card.hidden = !cocok;
        if (cocok) tampil++;
      }
      sec.hidden = tampil === 0;
      total += tampil;
    }
    const kosong = $("#toolEmpty");
    if (kosong) kosong.hidden = !(q && total === 0);
    const clear = $("#toolSearchClear");
    if (clear) clear.hidden = !q;
  }

  function wireSearch() {
    const input = $("#toolSearch");
    if (!input) return;
    input.addEventListener("input", () => {
      state.query = input.value;
      applyFilter();
    });
    const clear = $("#toolSearchClear");
    if (clear) {
      clear.addEventListener("click", () => {
        input.value = "";
        state.query = "";
        applyFilter();
        input.focus();
      });
    }
    const reset = $("#toolSearchReset");
    if (reset) {
      reset.addEventListener("click", () => {
        input.value = "";
        state.query = "";
        applyFilter();
        input.focus();
      });
    }
  }

  /* ============================================================
     Pratinjau dokumen di kolom utama
     ============================================================ */
  let previewDoc = null;

  async function renderPreview() {
    const box = $("#toolPreview");
    if (!box) return;
    const tool = state.tool;
    const f = state.files[0];
    /* alat dengan panel khusus (editor, susun, tanda tangan, ...)
       sudah punya pratinjau sendiri */
    const bisa = tool && !tool.custom && f && window.pdfjsLib &&
      /pdf/i.test(tool.accept || "application/pdf");
    if (!bisa) {
      box.hidden = true;
      if (previewDoc) { try { previewDoc.destroy(); } catch (_) { } previewDoc = null; }
      return;
    }
    const frame = box.querySelector(".tool-preview-frame");
    const cap = box.querySelector("figcaption");
    frame.innerHTML = "";
    cap.textContent = "Membuat pratinjau…";
    box.hidden = false;
    try {
      if (previewDoc) { try { previewDoc.destroy(); } catch (_) { } previewDoc = null; }
      const data = f.bytes.slice();
      previewDoc = await window.pdfjsLib.getDocument({ data }).promise;
      const page = await previewDoc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const skala = Math.min(1.4, 520 / base.width);
      const vp = page.getViewport({ scale: skala });
      const cv = document.createElement("canvas");
      cv.width = Math.round(vp.width);
      cv.height = Math.round(vp.height);
      const ctx = cv.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      frame.appendChild(cv);
      cap.textContent = `Pratinjau halaman 1 — ${f.name}` +
        (previewDoc.numPages > 1 ? ` (dari ${previewDoc.numPages} halaman)` : "");
    } catch (e) {
      box.hidden = true;
      frame.innerHTML = "";
    }
  }

  /* ============================================================
     Ruang kerja alat
     ============================================================ */
  function openTool(id) {
    const tool = (C.registry || []).find((t) => t.id === id);
    if (!tool) return;
    state.tool = tool;
    state.files = [];
    state.opts = {};
    state.results = [];
    /* lepaskan sumber daya alat sebelumnya (mis. dokumen pdf.js editor) */
    if (state.custom && typeof state.custom.disposeEditor === "function") {
      try { state.custom.disposeEditor(); } catch (_) { /* abaikan */ }
    }
    /* lepaskan sumber daya umum panel khusus (mis. pratinjau pdf.js) */
    if (state.custom && typeof state.custom.dispose === "function") {
      try { state.custom.dispose(); } catch (_) { /* abaikan */ }
    }
    state.custom = {};
    /* nilai bawaan opsi */
    for (const f of tool.fields || []) {
      if (f.type === "pagerange") {
        const v = f.value && typeof f.value === "object" ? f.value : {};
        state.opts[f.id] = {
          mode: v.mode || "all",
          dari: Math.max(1, Number(v.dari) || 1),
          sampai: Math.max(0, Number(v.sampai) || 0),
        };
        continue;
      }
      state.opts[f.id] = f.value !== undefined ? f.value : (f.type === "check" ? false : "");
    }
    $("#toolTitle").textContent = tool.name;
    $("#toolDesc").textContent = tool.desc;
    $("#toolIcon").innerHTML = iconSvg(tool.icon);
    const input = $("#toolInput");
    input.accept = tool.accept || "";
    input.multiple = tool.multiple !== false;
    $("#toolOptions").innerHTML = "";
    const rail = $("#toolSideExtra");
    if (rail) rail.innerHTML = "";
    renderFields(tool.fields || []);
    renderCustom(tool);
    renderFiles();
    renderResults();
    $("#toolRunBtn").disabled = true;
    $("#toolRunBtn").textContent = "Proses";
    $("#toolsView").hidden = true;
    $("#toolView").hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function backToMenu() {
    const rail = $("#toolSideExtra");
    if (rail) rail.innerHTML = "";
    state.tool = null;
    state.files = [];
    state.results = [];
    const pv = $("#toolPreview");
    if (pv) { pv.hidden = true; pv.querySelector(".tool-preview-frame").innerHTML = ""; }
    if (previewDoc) { try { previewDoc.destroy(); } catch (_) { } previewDoc = null; }
    $("#toolView").hidden = true;
    $("#toolsView").hidden = false;
    renderLauncher();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ============================================================
     Widget rentang halaman (slider dua-thumb)
     ------------------------------------------------------------
     Bentuk field:
       { type: "pagerange", id: "halaman", label: "Halaman",
         value: { mode: "all", dari: 1, sampai: 0 } }

     Nilai disimpan di state.opts[id] sebagai objek:
       { mode, dari, sampai }
     mode  : "all" | "odd" | "even" | "range"
     dari  : halaman awal (1-based)
     sampai: halaman akhir (1-based); 0 berarti "sampai akhir"

     Slider memakai dua input range yang ditumpuk; thumb atas
     (sampai) berada di atas thumb bawah (dari). Nilai minimum
     dan maksimum keduanya mengikuti jumlah halaman dokumen.
     ============================================================ */
  /* Jumlah halaman terbesar di antara berkas yang dimuat (0 = belum
     diketahui). Dipakai widget rentang halaman dan panel khusus. */
  function totalDiketahui() {
    return Math.max(0, Number(state.pageCount) || 0);
  }
  function totalHalamanEfektif() {
    return Math.max(1, totalDiketahui());
  }
  function batasAtas() {
    return totalHalamanEfektif();
  }

  function buatPagerange(f) {
    const wrap = el("div", "tool-pagerange");
    const awal = f.value && typeof f.value === "object" ? f.value : { mode: "all", dari: 1, sampai: 0 };
    const spec = {
      mode: awal.mode || "all",
      dari: Math.max(1, Number(awal.dari) || 1),
      sampai: Math.max(0, Number(awal.sampai) || 0),
    };

    /* --- baris mode (semua / ganjil / genap / rentang) --- */
    const baris = el("div", "tool-pr-mode");
    baris.setAttribute("role", "group");
    baris.setAttribute("aria-label", "Pemilihan halaman");
    const modeDefs = [
      ["all", "Semua"],
      ["odd", "Ganjil"],
      ["even", "Genap"],
      ["range", "Rentang"],
    ];
    const btnMode = {};
    for (const [m, lbl] of modeDefs) {
      const b = el("button", "tool-pr-chip", lbl);
      b.type = "button";
      b.dataset.mode = m;
      b.setAttribute("aria-pressed", String(spec.mode === m));
      b.addEventListener("click", () => {
        spec.mode = m;
        if (m === "range") {
          /* saat memilih rentang, isi dengan seluruh dokumen.
            .spec.sampai = 0 berarti "sampai halaman terakhir". */
          if (spec.sampai <= 0 && totalDiketahui()) spec.sampai = totalHalamanEfektif();
          if (spec.sampai > 0 && spec.dari > spec.sampai) spec.dari = spec.sampai;
        }
        perbarui();
        commit();
      });
      btnMode[m] = b;
      baris.appendChild(b);
    }
    wrap.appendChild(baris);

    /* --- slider rentang --- */
    const area = el("div", "tool-pr-area");
    const rail = el("div", "tool-pr-rail");
    const isi = el("div", "tool-pr-isi");
    rail.appendChild(isi);
    area.appendChild(rail);

    const inDari = document.createElement("input");
    inDari.type = "range";
    inDari.min = "1";
    inDari.className = "tool-pr-thumb tool-pr-thumb-bawah";
    inDari.id = "f_" + f.id + "_dari";
    inDari.setAttribute("aria-label", "Halaman awal");
    const inSampai = document.createElement("input");
    inSampai.type = "range";
    inSampai.min = "1";
    inSampai.className = "tool-pr-thumb tool-pr-thumb-atas";
    inSampai.id = "f_" + f.id + "_sampai";
    inSampai.setAttribute("aria-label", "Halaman akhir");
    area.appendChild(inDari);
    area.appendChild(inSampai);
    wrap.appendChild(area);

    /* --- kotak angka (input presisi) --- */
    const angka = el("div", "tool-pr-angka");
    const lblDari = el("label", "tool-pr-angka-item");
    lblDari.appendChild(el("span", "", "Dari"));
    const numDari = document.createElement("input");
    numDari.type = "number";
    numDari.min = 1;
    numDari.id = "f_" + f.id + "_dari_num";
    lblDari.appendChild(numDari);
    const lblSampai = el("label", "tool-pr-angka-item");
    lblSampai.appendChild(el("span", "", "Sampai"));
    const numSampai = document.createElement("input");
    numSampai.type = "number";
    numSampai.min = 1;
    numSampai.id = "f_" + f.id + "_sampai_num";
    lblSampai.appendChild(numSampai);
    angka.appendChild(lblDari);
    angka.appendChild(lblSampai);
    wrap.appendChild(angka);

    /* --- ringkasan --- */
    const info = el("div", "tool-pr-info");
    info.id = "f_" + f.id + "_info";
    wrap.appendChild(info);

    /* --- petunjuk: slider bisa langsung dipakai --- */
    const hint = el("div", "tool-pr-hint",
      "Geser slider atau isi angka di bawah untuk memilih rentang halaman.");
    wrap.appendChild(hint);

    /* --- helper --- */
    function perbarui() {
      const diketahui = totalDiketahui();
      const maks = batasAtas();
      /* min = 1 (halaman pertama). max minimal 2 supaya slider tidak
         degenerat (min == max) sebelum jumlah halaman diketahui. */
      const maksDom = Math.max(2, maks);
      inDari.max = String(maksDom);
      inSampai.max = String(maksDom);
      /* Normalkan TANPA memaksa nilai pengguna ke dalam jangkauan
         dokumen. Nilai di luar jangkauan sengaja dipertahankan supaya
         tool bisa memberi pesan yang jelas ("rentang di luar
         jangkauan") — bukan diam-diam memproses rentang lain.

         Batas bawah minimal 1 dan batas atas minimal batas bawah
         (kalau pengguna membalik urutan, keduanya ditukar supaya
         tampilan dan perhitungan core selalu sama). */
      spec.dari = Math.max(1, Math.round(Number(spec.dari) || 1));
      spec.sampai = Math.round(Number(spec.sampai) || 0);
      if (spec.sampai > 0 && spec.sampai < spec.dari) {
        const tmp = spec.dari; spec.dari = spec.sampai; spec.sampai = tmp;
      }
      const a = spec.dari;
      const b = spec.sampai > 0 ? spec.sampai : (diketahui ? maks : a);
      /* Mode bukan "rentang" (Semua/Ganjil/Genap) tetap menampilkan
         slider — dua thumb-nya dikunci di ujung dokumen. Jadi widget
         selalu terlihat dan selalu bisa dipakai, bukan cuma muncul
         setelah mode "Rentang" dipilih. */
      const rentang = spec.mode === "range";
      const tampilA = rentang ? a : 1;
      const tampilB = rentang ? b : maks;
      /* Slider hanya bisa bergerak di dalam dokumen, jadi posisinya
         dijepit secara visual; kotak angka tetap menampilkan nilai
         yang benar-benar diminta pengguna. */
      const sliderA = Math.min(Math.max(1, tampilA), maks);
      const sliderB = Math.min(Math.max(sliderA, tampilB), maks);
      inDari.value = String(sliderA);
      inSampai.value = String(sliderB);
      numDari.value = String(tampilA);
      numSampai.value = String(tampilB);
      /* nonaktifkan sampai jumlah halaman diketahui */
      const aktif = !!diketahui;
      inDari.disabled = !aktif;
      inSampai.disabled = !aktif;
      numDari.disabled = !aktif;
      numSampai.disabled = !aktif;
      /* thumbs: thumb atas selalu di atas agar tidak tertutup */
      inSampai.style.zIndex = "3";
      inDari.style.zIndex = "2";
      /* Isi rail: rail di-inset setengah lebar thumb (CSS), jadi
         persentase di bawah persis sama dengan posisi pusat thumb. */
      const lebar = 100 / Math.max(1, maks - 1 || 1);
      const kiri = (sliderA - 1) * lebar;
      const kanan = (sliderB - 1) * lebar;
      isi.style.left = Math.max(0, Math.min(100, kiri)) + "%";
      isi.style.width = Math.max(0, Math.min(100, kanan - kiri)) + "%";
      /* chip mode */
      for (const m of Object.keys(btnMode)) {
        const on = spec.mode === m;
        btnMode[m].classList.toggle("is-on", on);
        btnMode[m].setAttribute("aria-pressed", String(on));
      }
      /* Slider dan kotak angka SELALU tampil — hanya isinya yang
         menyesuaikan mode. */
      area.hidden = false;
      angka.hidden = false;
      /* ringkasan */
      let teks;
      let peringatan = false;
      if (!diketahui) {
        teks = "Jumlah halaman diketahui setelah PDF dimuat";
      } else if (rentang) {
        const n = Math.max(0, Math.min(b, diketahui) - Math.max(1, a) + 1);
        if (a > diketahui) {
          teks = `Halaman ${a}–${b} di luar jangkauan (dokumen ${diketahui} halaman)`;
          peringatan = true;
        } else {
          teks = `Halaman ${a}–${Math.min(b, diketahui)} (${n} halaman dari ${diketahui})`;
        }
      } else if (spec.mode === "odd") {
        teks = `Halaman ganjil (1, 3, 5… dari ${diketahui} halaman)`;
      } else if (spec.mode === "even") {
        teks = `Halaman genap (2, 4, 6… dari ${diketahui} halaman)`;
      } else {
        teks = `Semua halaman (${diketahui} halaman)`;
      }
      info.textContent = teks;
      info.classList.toggle("is-warn", peringatan);
      /* simpan */
      state.opts[f.id] = { mode: spec.mode, dari: spec.dari, sampai: spec.mode === "range" ? spec.sampai : 0 };
    }
    function commit() {
      perbarui();
      applyVisibility();
      if (state.custom && typeof state.custom.onOptsChange === "function") {
        try { state.custom.onOptsChange(f.id); } catch (_) { /* abaikan */ }
      }
    }

    /* Geser slider atau isi angka = pengguna memang memilih rentang.
       Jadi mode otomatis berpindah ke "Rentang" dan pilihan lama
       (yang disimpan untuk mode lain) dibuang supaya tidak membingungkan. */
    function mulaiRentang() {
      if (spec.mode === "range") return;
      spec.mode = "range";
      spec.dari = 1;
      spec.sampai = 0;
    }
    inDari.addEventListener("input", () => {
      mulaiRentang();
      spec.dari = Number(inDari.value) || 1;
      if (spec.sampai > 0 && spec.dari > spec.sampai) spec.sampai = spec.dari;
      commit();
    });
    inSampai.addEventListener("input", () => {
      mulaiRentang();
      spec.sampai = Number(inSampai.value) || 1;
      if (spec.sampai < spec.dari) spec.dari = spec.sampai;
      commit();
    });
    numDari.addEventListener("input", () => {
      const v = Number(numDari.value);
      if (!isFinite(v) || v < 1) return;
      /* Nilai TIDAK dijepit ke jumlah halaman: rentang di luar
         jangkauan harus tetap utuh supaya tool bisa memberi pesan
         yang jelas, bukan dipaksa menjadi rentang lain. */
      mulaiRentang();
      spec.dari = v;
      if (spec.sampai > 0 && spec.dari > spec.sampai) spec.sampai = spec.dari;
      commit();
    });
    numSampai.addEventListener("input", () => {
      const v = Number(numSampai.value);
      if (!isFinite(v) || v < 1) return;
      mulaiRentang();
      spec.sampai = v;
      if (spec.sampai > 0 && spec.dari > spec.sampai) spec.dari = spec.sampai;
      commit();
    });

    perbarui();
    return { wrap, perbarui, spec };
  }

  /* Perbarui semua widget rentang halaman (dipanggil ketika jumlah
     halaman dokumen sudah diketahui). */
  function perbaruiPagerange() {
    for (const w of pageWidgets) w.perbarui();
  }

  /* ---------- render opsi ---------- */
  function renderFields(fields) {
    const host = $("#toolOptions");
    host.innerHTML = "";
    pageWidgets = [];
    for (const f of fields) {
      if (f.type === "check") {
        const l = el("label", "tool-check");
        const i = document.createElement("input");
        i.type = "checkbox";
        i.id = "f_" + f.id;
        i.checked = !!f.value;
        i.addEventListener("change", () => {
          state.opts[f.id] = i.checked;
          applyVisibility();
          if (state.custom && typeof state.custom.onOptsChange === "function") {
            try { state.custom.onOptsChange(f.id); } catch (_) { /* abaikan */ }
          }
        });
        l.appendChild(i);
        l.appendChild(el("span", "", f.label));
        host.appendChild(l);
        continue;
      }
      if (f.type === "pagerange") {
        const wrap = el("div", "tool-field tool-field-pagerange");
        wrap.dataset.field = f.id;
        const lab = el("label", "tool-label");
        lab.textContent = f.label;
        wrap.appendChild(lab);
        const w = buatPagerange(f);
        wrap.appendChild(w.wrap);
        host.appendChild(wrap);
        pageWidgets.push(w);
        continue;
      }
      const wrap = el("div", "tool-field");
      wrap.dataset.field = f.id;
      const lab = el("label", "tool-label");
      lab.setAttribute("for", "f_" + f.id);
      lab.textContent = f.label;
      wrap.appendChild(lab);
      let input;
      if (f.type === "select") {
        input = document.createElement("select");
        for (const [v, lbl] of f.options || []) {
          const o = document.createElement("option");
          o.value = v; o.textContent = lbl;
          input.appendChild(o);
        }
        input.value = f.value != null ? f.value : "";
      } else if (f.type === "textarea") {
        input = document.createElement("textarea");
        input.rows = 3;
        input.value = f.value || "";
        input.placeholder = f.placeholder || "";
      } else if (f.type === "range") {
        input = document.createElement("input");
        input.type = "range";
        input.min = f.min; input.max = f.max; input.step = f.step || 1;
        input.value = f.value;
        const out = el("output", "tool-range-val", (f.value != null ? f.value : "") + (f.unit || ""));
        input.addEventListener("input", () => { out.textContent = input.value + (f.unit || ""); });
        wrap.appendChild(out);
      } else if (f.type === "color") {
        input = document.createElement("input");
        input.type = "color";
        input.value = /^#[0-9a-f]{6}$/i.test(f.value || "") ? f.value : "#000000";
      } else if (f.type === "password") {
        input = document.createElement("input");
        input.type = "password";
        input.autocomplete = "new-password";
      } else {
        input = document.createElement("input");
        input.type = f.type === "number" ? "number" : "text";
        if (f.min != null) input.min = f.min;
        if (f.max != null) input.max = f.max;
        if (f.step != null) input.step = f.step;
        if (f.placeholder) input.placeholder = f.placeholder;
      }
      input.id = "f_" + f.id;
      if (f.type !== "range") input.value = f.value != null ? f.value : "";
      const commit = () => {
        state.opts[f.id] = f.type === "number" ? (input.value === "" ? "" : Number(input.value)) : input.value;
        applyVisibility();
        /* panel khusus boleh react ke perubahan opsi (mis. pratinjau) */
        if (state.custom && typeof state.custom.onOptsChange === "function") {
          try { state.custom.onOptsChange(f.id); } catch (_) { /* abaikan */ }
        }
      };
      input.addEventListener("input", commit);
      input.addEventListener("change", commit);
      wrap.appendChild(input);
      host.appendChild(wrap);
    }
    applyVisibility();
  }

  function applyVisibility() {
    const tool = state.tool;
    if (!tool) return;
    for (const f of tool.fields || []) {
      if (!f.visibleIf) continue;
      const wrap = $(`[data-field="${f.id}"]`, $("#toolOptions"));
      if (!wrap) continue;
      let ok = true;
      for (const k of Object.keys(f.visibleIf)) {
        if (String(nilaiOpsi(k)) !== String(f.visibleIf[k])) { ok = false; break; }
      }
      wrap.hidden = !ok;
    }
  }

  /* Nilai opsi yang bisa dibandingkan sebagai teks. Untuk opsi
     rentang halaman (objek) yang dibandingkan adalah "mode"-nya. */
  function nilaiOpsi(k) {
    const v = state.opts[k];
    if (v && typeof v === "object") return v.mode != null ? v.mode : "";
    return v;
  }

  /* ---------- daftar file ---------- */
  function renderFiles() {
    const host = $("#toolFileList");
    host.innerHTML = "";
    const tool = state.tool;
    for (const f of state.files) {
      const row = el("div", "tool-file");
      row.innerHTML = `<span class="tf-name" title="${escapeAttr(f.name)}">${escapeHtml(f.name)}</span><span class="tf-size">${sh().fmtSize ? sh().fmtSize(f.bytes.length) : f.bytes.length + " B"}</span>`;
      const rm = el("button", "tf-remove", "×");
      rm.type = "button";
      rm.title = "Hapus";
      rm.addEventListener("click", () => {
        state.files = state.files.filter((x) => x !== f);
        renderFiles();
        updateRunState();
        void segarkanJumlahHalaman();
      });
      row.appendChild(rm);
      host.appendChild(row);
    }
    const drop = $("#toolDrop");
    if (drop) drop.hidden = state.files.length > 0;
    updateRunState();
    /* berkas masuk/keluar -> pratinjau (kalau ada) harus disegarkan */
    if (state.custom && typeof state.custom.onOptsChange === "function") {
      try { state.custom.onOptsChange("files"); } catch (_) { /* abaikan */ }
    }
    renderPreview();
    void segarkanJumlahHalaman();
  }

  /* Hitung jumlah halaman PDF yang dimuat supaya batas slider rentang
     halaman akurat. Untuk beberapa berkas, yang dipakai adalah jumlah
     halaman terbesar (supaya slider bisa menjangkau semua berkas). */
  let pageCountToken = 0;
  async function segarkanJumlahHalaman() {
    const token = ++pageCountToken;
    const perlu = (state.tool && (state.tool.fields || []).some((f) => f.type === "pagerange"));
    if (!perlu) {
      if (state.pageCount !== 0) { state.pageCount = 0; perbaruiPagerange(); }
      return;
    }
    if (!state.files.length) {
      if (state.pageCount !== 0) { state.pageCount = 0; perbaruiPagerange(); }
      return;
    }
    let maks = 0;
    for (const f of state.files) {
      if (token !== pageCountToken) return;
      try {
        const doc = await C.openPdfjs(f.bytes);
        if (token !== pageCountToken) { try { await doc.destroy(); } catch (_) { } return; }
        if (doc.numPages > maks) maks = doc.numPages;
        try { await doc.destroy(); } catch (_) { }
      } catch (_) {
        /* bukan PDF atau gagal dibuka -> abaikan */
      }
    }
    if (token !== pageCountToken) return;
    state.pageCount = maks;
    perbaruiPagerange();
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, "&quot;");
  }

  function updateRunState() {
    const tool = state.tool;
    if (!tool) return;
    const need = tool.multiple === false ? 1 : 1;
    const ok = state.files.length >= need && !state.busy;
    const btn = $("#toolRunBtn");
    if (btn) btn.disabled = !ok;
  }

  /* ---------- hasil ---------- */
  function renderResults() {
    const host = $("#toolResults");
    const card = $("#toolResultCard");
    host.innerHTML = "";
    card.hidden = !state.results.length;
    for (const r of state.results) {
      const row = el("div", "res-item");
      const a = document.createElement("a");
      a.href = r.url;
      a.download = r.name;
      a.textContent = r.name;
      a.className = "res-link";
      row.appendChild(a);
      const meta = el("span", "res-meta");
      meta.textContent = (r.size ? sh().fmtSize ? sh().fmtSize(r.size) : r.size + " B" : "") + (r.note ? " · " + r.note : "");
      row.appendChild(meta);
      host.appendChild(row);
    }
  }

  function revokeResults() {
    for (const r of state.results) {
      if (r.url) URL.revokeObjectURL(r.url);
    }
    state.results = [];
  }

  /* ---------- jalankan alat ---------- */
  async function runTool() {
    const tool = state.tool;
    if (!tool || state.busy) return;
    state.busy = true;
    updateRunState();
    const btn = $("#toolRunBtn");
    btn.textContent = "Memproses…";
    const s = sh();
    try {
      const ctx = {
        files: state.files.slice(),
        opts: Object.assign({}, state.opts, state.custom.opts || {}),
        progress: (pct, text) => {
          if (text && s.setProgress) s.setProgress(typeof pct === "number" ? pct : 0);
          if (text && s.showOverlay) s.overlayText && (s.overlayText.textContent = text);
        },
        toast: (m, k) => s.toast && s.toast(m, k),
      };
      if (s.showOverlay) s.showOverlay("Memproses…");
      const outs = await tool.run(ctx);
      revokeResults();
      for (const o of outs || []) {
        const blob = o.blob || new Blob([o.bytes], { type: guessType(o.name) });
        state.results.push({
          name: o.name,
          url: URL.createObjectURL(blob),
          size: blob.size,
          note: o.note || "",
        });
      }
      renderResults();
      if (s.toast) s.toast((outs || []).length ? "Selesai — " + outs.length + " berkas." : "Selesai.", "ok");
    } catch (err) {
      console.error(err);
      if (s.toast) s.toast(err && err.message ? err.message : "Gagal memproses.", "err", 6000);
    } finally {
      if (s.hideOverlay) s.hideOverlay();
      state.busy = false;
      btn.textContent = "Proses";
      updateRunState();
    }
  }

  function guessType(name) {
    const n = String(name || "").toLowerCase();
    if (n.endsWith(".pdf")) return "application/pdf";
    if (n.endsWith(".zip")) return "application/zip";
    if (n.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (n.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if (n.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    if (n.endsWith(".html")) return "text/html;charset=utf-8";
    if (n.endsWith(".md")) return "text/markdown;charset=utf-8";
    return "application/octet-stream";
  }

  /* ============================================================
     Panel khusus per alat
     ============================================================ */
  function renderCustom(tool) {
    const host = $("#toolExtra");
    host.innerHTML = "";
    state.custom = { opts: {} };
    if (!tool.custom) return;
    if (tool.custom === "organize") return void renderOrganize(host);
    if (tool.custom === "forms") return void renderForms(host);
    if (tool.custom === "sign") return void renderSign(host);
    if (tool.custom === "redact") return void renderRedact(host);
    if (tool.custom === "html") return void renderHtml(host);
    if (tool.custom === "scan") return void renderScan(host);
    if (tool.custom === "unlock") return void renderUnlock(host);
    if (tool.custom === "editor") {
      if (window.PDFToolsEditor && typeof window.PDFToolsEditor.render === "function") {
        return void window.PDFToolsEditor.render(host);
      }
      host.appendChild(el("p", "tool-warn", "Modul editor visual tidak termuat."));
      return;
    }
  }

  /* --- Susun PDF ---
     Pratinjau dimuat secara malas: kartu halaman dibuat lebih dulu,
     thumbnail-nya baru dirender saat kartu terlihat. Kartu yang sudah
     ada DIPAKAI ULANG (dipindah), jadi memutar/menghapus/menduplikasi
     halaman tidak mengulang render dan tidak berkedip. */
  async function renderOrganize(host) {
    const PV = window.PDFPreview;
    const wrap = el("div", "organize-wrap");
    wrap.innerHTML = '<p class="muted small">Pilih satu PDF untuk menyusun ulang halamannya.</p>';
    host.appendChild(wrap);

    const THUMB_W = 240;
    let lazy = null;
    let docKey = "";
    let docPrev = "";
    let seq = 0;

    const refresh = async () => {
      const f = state.files[0];
      if (!f) {
        wrap.innerHTML = '<p class="muted small">Pilih satu PDF untuk menyusun ulang halamannya.</p>';
        state.custom.organize = null;
        return;
      }
      wrap.innerHTML = '<p class="muted small">Membaca halaman…</p>';
      const data = await state.tool.open(f.bytes);
      state.custom.organize = data;
      docKey = "organize:" + (f.id || f.name);
      /* dokumen pdf.js untuk pratinjau diganti -> yang lama dilepas
         supaya worker pdf.js tidak menumpuk */
      if (docPrev && docPrev !== docKey) {
        PV.dropDoc(docPrev);
        PV.dropDocThumbs(docPrev);
      }
      docPrev = docKey;
      wrap.innerHTML = "";
      const bar = el("div", "organize-bar");
      const info = el("span", "muted small", `${data.pageCount} halaman`);
      bar.appendChild(info);
      const reset = el("button", "btn btn-ghost btn-sm", "Kembalikan urutan asli");
      reset.type = "button";
      reset.addEventListener("click", () => {
        data.items.forEach((it) => { it.rot = 0; it.del = false; });
        drawOrganize();
      });
      bar.appendChild(reset);
      wrap.appendChild(bar);
      const grid = el("div", "organize-grid");
      wrap.appendChild(grid);

      lazy = PV.lazy(grid, {
        root: null,
        rootMargin: "300px",
        onEnter: (cell, meta) => {
          mountOrgThumb(cell, meta.it);
        },
      });

      async function mountOrgThumb(cell, it) {
        if (!cell || !cell.isConnected || !it) return;
        const slot = cell.querySelector(".org-thumb");
        if (!slot || slot.querySelector("img")) return;
        try {
          const key = PV.thumbKey(docKey, it.n - 1, THUMB_W);
          const url = await PV.thumb(docKey, f.bytes, it.n - 1, THUMB_W, PV.distance(cell));
          if (!url || !slot.isConnected) return;
          const img = document.createElement("img");
          img.alt = "Halaman " + it.n;
          img.loading = "lazy";
          img.decoding = "async";
          PV.mount(img, url, key);
          slot.replaceChildren(img);
        } catch (_) {
          /* biarkan kosong */
        }
      }

      function makeCell(it) {
        const cell = el("div", "org-cell");
        const slot = el("div", "org-thumb");
        cell.appendChild(slot);
        const num = el("span", "org-num");
        cell.appendChild(num);
        const acts = el("div", "org-acts");
        /* Ikon memakai SVG (bukan emoji) supaya selalu tampil utuh,
           termasuk di sistem tanpa font emoji. */
        const mk = (svg, title, fn) => {
          const b = el("button", "org-btn");
          b.type = "button";
          b.title = title;
          b.setAttribute("aria-label", title);
          b.innerHTML = svg;
          b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
          return b;
        };
        const ICON_ROT_L = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V5a1 1 0 0 1 1-1h3"/><path d="M20 16v3a1 1 0 0 1-1 1h-3"/><path d="M20 8a8 8 0 0 0-13.7-2.3L4 8"/><path d="M4 16a8 8 0 0 0 13.7 2.3L20 16"/></svg>';
        const ICON_ROT_R = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 8V5a1 1 0 0 0-1-1h-3"/><path d="M4 16v3a1 1 0 0 0 1 1h3"/><path d="M4 8a8 8 0 0 1 13.7-2.3L20 8"/><path d="M20 16a8 8 0 0 1-13.7 2.3L4 16"/></svg>';
        const ICON_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>';
        const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14"/><path d="M9.5 7V5.4A1.4 1.4 0 0 1 10.9 4h2.2a1.4 1.4 0 0 1 1.4 1.4V7"/><path d="M7 7l.8 11.2A1.6 1.6 0 0 0 9.4 19.8h5.2a1.6 1.6 0 0 0 1.6-1.6L17 7"/></svg>';
        acts.appendChild(mk(ICON_ROT_L, "Putar kiri", () => { it.rot = (it.rot + 270) % 360; drawOrganize(); }));
        acts.appendChild(mk(ICON_ROT_R, "Putar kanan", () => { it.rot = (it.rot + 90) % 360; drawOrganize(); }));
        acts.appendChild(mk(ICON_COPY, "Duplikat", () => {
          data.items.splice(data.items.indexOf(it) + 1, 0, {
            id: "d" + (++seq), n: it.n, rot: it.rot, del: false,
          });
          drawOrganize();
        }));
        acts.appendChild(mk(ICON_TRASH, "Hapus", () => { it.del = true; drawOrganize(); }));
        cell.appendChild(acts);
        cell.addEventListener("click", () => {
          /* klik pada thumbnail: kirim satu halaman ke depan */
          const i = data.items.indexOf(it);
          if (i >= 0 && i + 1 < data.items.length) {
            const tmp = data.items[i];
            data.items[i] = data.items[i + 1];
            data.items[i + 1] = tmp;
            drawOrganize();
          }
        });
        return cell;
      }

      function drawOrganize() {
        PV.reconcile(grid, data.items, {
          keyOf: (it) => it.id || ("p" + it.n),
          onRemove: (node) => lazy.forget(node),
          create: (it) => {
            const cell = makeCell(it);
            lazy.observe(cell, { it });
            return cell;
          },
          update: (cell, it) => {
            const idx = data.items.indexOf(it);
            cell.classList.toggle("deleted", !!it.del);
            const num = cell.querySelector(".org-num");
            if (num) num.textContent = String(idx + 1);
            const img = cell.querySelector("img");
            if (img) img.style.transform = "rotate(" + (it.rot || 0) + "deg)";
            cell.setAttribute("aria-label", "Halaman " + it.n + ", posisi " + (idx + 1));
          },
        });
      }
      drawOrganize();
    };
    state.custom.refreshOrganize = refresh;
    /* lepaskan dokumen pratinjau saat alat ditutup */
    state.custom.dispose = () => {
      if (docPrev) {
        PV.dropDoc(docPrev);
        PV.dropDocThumbs(docPrev);
        docPrev = "";
      }
      docKey = "";
      state.custom.organize = null;
    };
    refresh();
  }

  /* --- Formulir --- */
  async function renderForms(host) {
    const wrap = el("div", "forms-wrap");
    wrap.innerHTML = '<p class="muted small">Pilih PDF yang punya formulir.</p>';
    host.appendChild(wrap);
    state.custom.refreshForms = async () => {
      const f = state.files[0];
      if (!f) { wrap.innerHTML = '<p class="muted small">Pilih PDF yang punya formulir.</p>'; state.custom.opts.values = {}; return; }
      wrap.innerHTML = '<p class="muted small">Membaca field formulir…</p>';
      let info;
      try {
        info = await state.tool.inspect(f);
      } catch (err) {
        wrap.innerHTML = `<p class="tool-warn">${escapeHtml(err.message || String(err))}</p>`;
        state.custom.opts.values = {};
        return;
      }
      wrap.innerHTML = "";
      if (!info.fields.length) {
        wrap.appendChild(el("p", "tool-warn", "PDF ini tidak punya field formulir (AcroForm)."));
        state.custom.opts.values = {};
        return;
      }
      wrap.appendChild(el("p", "muted small", `${info.fields.length} field ditemukan. Isi yang diperlukan, lalu klik Proses.`));
      const grid = el("div", "forms-grid");
      const values = {};
      for (const fld of info.fields) {
        const row = el("div", "form-row");
        row.appendChild(el("label", "tool-label", fld.name || "(tanpa nama)"));
        let input;
        if (fld.type === "checkbox") {
          input = document.createElement("input");
          input.type = "checkbox";
          input.checked = fld.value === "Ya";
          values[fld.name] = input.checked ? "Ya" : "";
          input.addEventListener("change", () => { values[fld.name] = input.checked ? "Ya" : ""; });
        } else if (fld.type === "dropdown" || fld.type === "radio") {
          input = document.createElement("select");
          const blank = document.createElement("option");
          blank.value = ""; blank.textContent = "—";
          input.appendChild(blank);
          for (const o of fld.options || []) {
            const op = document.createElement("option");
            op.value = o; op.textContent = o;
            input.appendChild(op);
          }
          input.value = fld.value || "";
          values[fld.name] = input.value;
          input.addEventListener("change", () => { values[fld.name] = input.value; });
        } else {
          input = document.createElement("input");
          input.type = "text";
          input.value = fld.value || "";
          values[fld.name] = input.value;
          input.addEventListener("input", () => { values[fld.name] = input.value; });
        }
        row.appendChild(input);
        grid.appendChild(row);
      }
      wrap.appendChild(grid);
      state.custom.opts.values = values;
    };
  }

  /* --- Tanda tangan ---
     Panel ini offering tiga hal:
       1. menulis tanda tangan langsung di kanvas,
       2. mengimpor tanda tangan dari foto atau QR code,
       3. pratinjau posisi tanda tangan di halaman PDF tujuan.
  */
  function renderSign(host) {
    const wrap = el("div", "sign-wrap");
    wrap.innerHTML = `
      <p class="muted small">Tulis tanda tangan di kotak bawah, atau impor dari foto / QR code. Pratinjau di bawah menunjukkan letaknya di halaman tujuan.</p>
      <canvas id="signPad" width="640" height="220" class="sign-pad"></canvas>
      <div class="sign-actions">
        <button type="button" class="btn btn-ghost btn-sm" id="signClear">Bersihkan</button>
        <button type="button" class="btn btn-primary btn-sm" id="signSave">Simpan tanda tangan</button>
      </div>
      <div class="sign-import">
        <div class="sign-actions">
          <button type="button" class="btn btn-ghost btn-sm" id="signImportPhoto">Impor foto tanda tangan</button>
          <button type="button" class="btn btn-ghost btn-sm" id="signImportQr">Impor QR code</button>
          <button type="button" class="btn btn-ghost btn-sm" id="signRemove" hidden>Hapus gambar</button>
        </div>
        <input id="signFile" type="file" accept="image/png,image/jpeg,image/webp,image/*" hidden />
        <p class="muted tiny" id="signImportNote">Foto tanda tangan: latar putih dipangkas otomatis. QR code: gambar dipakai apa adanya supaya tetap bisa dipindai.</p>
      </div>
      <div class="sign-preview" id="signPreviewBox">
        <div class="sign-preview-head">
          <span class="muted small" id="signPreviewTitle">Pratinjau</span>
          <span class="sign-preview-nav">
            <button type="button" class="btn btn-ghost btn-sm" id="signPrev" title="Halaman sebelumnya" aria-label="Halaman sebelumnya">‹</button>
            <span class="muted tiny" id="signPreviewPage">—</span>
            <button type="button" class="btn btn-ghost btn-sm" id="signNext" title="Halaman berikutnya" aria-label="Halaman berikutnya">›</button>
          </span>
        </div>
        <canvas id="signPreview" class="sign-preview-canvas" width="320" height="452"></canvas>
        <p class="muted tiny" id="signPreviewHint">Pilih satu PDF untuk melihat pratinjau.</p>
      </div>`;
    host.appendChild(wrap);
    const pad = $("#signPad", wrap);
    const ctx = pad.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, pad.width, pad.height);
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    let drawing = false;
    let hasInk = false;
    const pos = (e) => {
      const r = pad.getBoundingClientRect();
      const t = e.touches ? e.touches[0] : e;
      return { x: ((t.clientX - r.left) / r.width) * pad.width, y: ((t.clientY - r.top) / r.height) * pad.height };
    };
    const start = (e) => { e.preventDefault(); drawing = true; hasInk = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
    const move = (e) => { if (!drawing) return; e.preventDefault(); const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); };
    const end = () => { drawing = false; };
    pad.addEventListener("mousedown", start);
    pad.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    pad.addEventListener("touchstart", start, { passive: false });
    pad.addEventListener("touchmove", move, { passive: false });
    pad.addEventListener("touchend", end);
    $("#signClear", wrap).addEventListener("click", () => {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, pad.width, pad.height);
      ctx.strokeStyle = "#0f172a";
      hasInk = false;
    });

    /* ---------- pratinjau ---------- */
    const preview = $("#signPreview", wrap);
    const pctx = preview.getContext("2d");
    const hint = $("#signPreviewHint", wrap);
    const pageLbl = $("#signPreviewPage", wrap);
    const prevBtn = $("#signPrev", wrap);
    const nextBtn = $("#signNext", wrap);
    /* gambar tanda tangan yang aktif (dataURL) + lebar/tinggi piksel */
    let img = null;
    let imgW = 0, imgH = 0;
    /* dokumen pratinjau (pdf.js) */
    let pdfDoc = null;
    let pdfBytesKey = "";
    /* halaman-halaman tujuan + indeks pratinjau */
    let targets = [];
    let targetIdx = 0;
    let renderToken = 0;

    const setHint = (t) => { hint.textContent = t || ""; };

    /* Pratinjau digambar ulang saat opsi berubah — diberi jeda supaya
       mengetik angka tidak memicu render berkali-kali. */
    let refreshTimer = 0;
    const schedulePreview = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => { refreshTimer = 0; refreshPreview(); }, 160);
    };

    /* Daftarkan gambar aktif (dataURL) supaya bisa dipakai pratinjau. */
    const setImage = (dataUrl, w, h) => {
      img = dataUrl || null;
      imgW = w || 0;
      imgH = h || 0;
      const rm = $("#signRemove", wrap);
      if (rm) rm.hidden = !img;
      refreshPreview();
    };

    /* Konversi berkas gambar (foto / QR) menjadi PNG. Untuk foto tanda
       tangan, latar putih dipangkas supaya garis tanda tangan tidak
       dikotongi kotak putih. QR code dibiarkan utuh (margin tenangnya
       tetap ada agar kode masih bisa dipindai). */
    async function imporGambar(file, pangkas) {
      if (!file) return;
      if (!/^image\//.test(file.type || "")) {
        if (sh().toast) sh().toast("Berkas harus berupa gambar (PNG/JPG/WebP).", "err");
        return;
      }
      /* batas ukuran berkas: gambar besar bisa membuat peramban berat */
      const MAX_BYTES = 15 * 1024 * 1024;
      if (file.size > MAX_BYTES) {
        if (sh().toast) sh().toast("Berkas gambar terlalu besar (maksimum 15 MB).", "err");
        return;
      }
      try {
        const b64 = await new Promise((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.onerror = () => rej(new Error("Berkas gambar tidak bisa dibaca."));
          fr.readAsDataURL(file);
        });
        const elImg = await new Promise((res, rej) => {
          const im = new Image();
          im.onload = () => res(im);
          im.onerror = () => rej(new Error("Gambar tidak bisa dibuka (format tidak didukung?)."));
          im.src = b64;
        });
        let w0 = Math.max(1, elImg.naturalWidth || elImg.width);
        let h0 = Math.max(1, elImg.naturalHeight || elImg.height);
        /* batas dimensi: rasterisasi sementara dikecilkan bila terlalu besar */
        const MAX_DIM = 4000;
        if (w0 > MAX_DIM || h0 > MAX_DIM) {
          const k = Math.min(MAX_DIM / w0, MAX_DIM / h0);
          w0 = Math.max(1, Math.round(w0 * k));
          h0 = Math.max(1, Math.round(h0 * k));
        }
        const src = document.createElement("canvas");
        src.width = w0; src.height = h0;
        const sctx = src.getContext("2d");
        sctx.drawImage(elImg, 0, 0, w0, h0);

        let cx = 0, cy = 0, cw = w0, ch = h0;
        if (pangkas) {
          /* cari kotak berisi piksel yang "berisi" (bukan putih) */
          const d = sctx.getImageData(0, 0, w0, h0).data;
          let minX = w0, minY = h0, maxX = -1, maxY = -1;
          for (let y = 0; y < h0; y++) {
            for (let x = 0; x < w0; x++) {
              const i = (y * w0 + x) * 4;
              const a = d[i + 3];
              /* piksel dianggap kosong kalau putih (atau hampir putih) */
              if (a < 24) continue;
              if (d[i] > 244 && d[i + 1] > 244 && d[i + 2] > 244) continue;
              if (x < minX) minX = x;
              if (y < minY) minY = y;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
            }
          }
          if (maxX >= 0 && maxY >= 0) {
            const padPx = 2;
            minX = Math.max(0, minX - padPx); minY = Math.max(0, minY - padPx);
            maxX = Math.min(w0 - 1, maxX + padPx); maxY = Math.min(h0 - 1, maxY + padPx);
            cx = minX; cy = minY; cw = maxX - minX + 1; ch = maxY - minY + 1;
          }
        }
        const out = document.createElement("canvas");
        out.width = cw; out.height = ch;
        const octx = out.getContext("2d");
        /* salin potongan terpilih lebih dulu */
        octx.drawImage(src, cx, cy, cw, ch, 0, 0, cw, ch);
        if (pangkas) {
          /* jadikan putih transparan supaya menyatu dengan kertas */
          const d = octx.getImageData(0, 0, cw, ch);
          const px = d.data;
          for (let i = 0; i < px.length; i += 4) {
            const lum = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
            if (lum > 232) { px[i + 3] = 0; }
            else if (lum > 190) { px[i + 3] = Math.round(px[i + 3] * (1 - (lum - 190) / 42)); }
          }
          octx.putImageData(d, 0, 0);
        }
        const data = out.toDataURL("image/png");
        const bytes = Uint8Array.from(atob(data.split(",")[1]), (c) => c.charCodeAt(0));
        let hex = "";
        for (const b of bytes) hex += b.toString(16).padStart(2, "0");
        state.custom.opts.signature = hex;
        setImage(data, cw, ch);
        if (sh().toast) {
          sh().toast(pangkas
            ? "Tanda tangan dari foto diimpor (" + cw + "×" + ch + " px)."
            : "QR code diimpor (" + cw + "×" + ch + " px).", "ok");
        }
      } catch (err) {
        if (sh().toast) sh().toast("Impor gagal: " + ((err && err.message) || err), "err");
      }
    }

    /* ---------- pratinjau posisi tanda tangan ---------- */
    function kumpulkanTarget() {
      const f = state.files[0];
      if (!f) return [];
      const spec = String((state.opts && state.opts.page) || "1").trim();
      const total = state.custom.totalPages || 0;
      const out = [];
      if (spec === "semua" || spec === "all") {
        for (let i = 1; i <= total; i++) out.push(i);
      } else {
        for (const part of spec.split(",")) {
          const t = part.trim();
          if (!t) continue;
          if (t.includes("-")) {
            const seg = t.split("-").map((x) => Number(x.trim()));
            const a = seg[0], b = seg[1];
            if (!isFinite(a) || !isFinite(b)) continue;
            for (let n = Math.min(a, b); n <= Math.max(a, b); n++) {
              if (n >= 1 && (!total || n <= total)) out.push(n);
            }
          } else {
            const n = Number(t);
            if (n >= 1 && (!total || n <= total)) out.push(n);
          }
        }
      }
      return out;
    }

    async function refreshPreview() {
      const token = ++renderToken;
      const f = state.files[0];
      if (!f) {
        targets = []; targetIdx = 0;
        pctx.fillStyle = "#f1f5f9";
        pctx.fillRect(0, 0, preview.width, preview.height);
        pageLbl.textContent = "—";
        setHint("Pilih satu PDF untuk melihat pratinjau.");
        prevBtn.disabled = nextBtn.disabled = true;
        return;
      }
      /* pratinjau hanya menampilkan berkas pertama */
      const banyak = state.files.length > 1
        ? " Pratinjau menampilkan PDF pertama (" + state.files.length + " berkas dipilih)."
        : "";
      /* buka dokumen (sekali per berkas) */
      const key = f.name + ":" + f.bytes.length;
      if (!pdfDoc || pdfBytesKey !== key) {
        try {
          if (pdfDoc) { try { await pdfDoc.destroy(); } catch (_) { /* abaikan */ } }
          pdfDoc = await C.openPdfjs(f.bytes);
          pdfBytesKey = key;
        } catch (err) {
          setHint("PDF tidak bisa dibuka untuk pratinjau: " + ((err && err.message) || err));
          return;
        }
      }
      if (token !== renderToken) return;
      state.custom.totalPages = pdfDoc.numPages;
      targets = kumpulkanTarget();
      if (!targets.length) {
        pctx.fillStyle = "#f1f5f9";
        pctx.fillRect(0, 0, preview.width, preview.height);
        pageLbl.textContent = "—";
        setHint("Halaman \"" + (state.opts.page || "1") + "\" tidak ada di PDF ini.");
        prevBtn.disabled = nextBtn.disabled = true;
        return;
      }
      if (targetIdx >= targets.length) targetIdx = 0;
      const no = targets[targetIdx];
      pageLbl.textContent = no + " / " + targets.length;
      prevBtn.disabled = targetIdx <= 0;
      nextBtn.disabled = targetIdx >= targets.length - 1;

      /* render halaman lalu gambar tanda tangan di posisi yang diminta */
      const maxW = 320;
      let vp = null;
      try {
        const pg = await pdfDoc.getPage(no);
        const base = pg.getViewport({ scale: 1 });
        const scale = maxW / (base.width || 1);
        vp = pg.getViewport({ scale });
        if (token !== renderToken) return;
        preview.width = Math.max(1, Math.round(vp.width));
        preview.height = Math.max(1, Math.round(vp.height));
        pctx.fillStyle = "#ffffff";
        pctx.fillRect(0, 0, preview.width, preview.height);
        await pg.render({ canvasContext: pctx, viewport: vp }).promise;
        if (token !== renderToken) return;
      } catch (err) {
        setHint("Halaman tidak bisa dirender: " + ((err && err.message) || err));
        return;
      }
      /* overlay tanda tangan */
      const xMm = Number(state.opts.x) || 0;
      const yMm = Number(state.opts.y) || 0;
      const wMm = Number(state.opts.w) || 50;
      /* ukuran halaman dalam mm (1 pt = 25.4/72 mm) */
      const pageWmm = (vp.width / (vp.scale || 1)) * 25.4 / 72;
      const pageHmm = (vp.height / (vp.scale || 1)) * 25.4 / 72;
      const k = preview.width / pageWmm;
      const wPx = wMm * k;
      const hPx = imgW && imgH ? wPx * (imgH / imgW) : wPx;
      const hMm = hPx / k;
      const xPx = xMm * k;
      const yPx = preview.height - (yMm + hMm) * k;
      /* expose geometri pratinjau (dipakai audit & pengujian) */
      state.custom.previewInfo = {
        page: no,
        jumlah: targets.length,
        pageWmm: Math.round(pageWmm * 100) / 100,
        pageHmm: Math.round(pageHmm * 100) / 100,
        xMm: xMm, yMm: yMm, wMm: wMm, hMm: Math.round(hMm * 100) / 100,
        xPx: Math.round(xPx * 100) / 100,
        yPx: Math.round(yPx * 100) / 100,
        wPx: Math.round(wPx * 100) / 100,
        hPx: Math.round(hPx * 100) / 100,
        adaGambar: !!img,
        imgW: imgW, imgH: imgH,
      };
      if (img) {
        try {
          const im = await new Promise((res, rej) => {
            const q = new Image();
            q.onload = () => res(q);
            q.onerror = () => rej(new Error("gambar gagal dimuat"));
            q.src = img;
          });
          if (token !== renderToken) return;
          pctx.save();
          pctx.globalAlpha = 1;
          pctx.drawImage(im, xPx, yPx, wPx, hPx);
          pctx.restore();
          /* garis bantu posisi (batas kotak tanda tangan) */
          pctx.save();
          pctx.strokeStyle = "rgba(37,99,235,.85)";
          pctx.setLineDash([4, 3]);
          pctx.lineWidth = 1;
          pctx.strokeRect(xPx + 0.5, yPx + 0.5, wPx, hPx);
          pctx.restore();
          setHint("Lebar " + wMm + " mm · " + Math.round(wPx) + "×" + Math.round(hPx) + " px di layar." + banyak);
        } catch (_) {
          setHint("Gambar tanda tangan tidak bisa digambar.");
        }
      } else {
        setHint("Tanda tangan belum ada — tulis di kanvas atau impor foto/QR code." + banyak);
      }
    }

    prevBtn.addEventListener("click", () => {
      if (targetIdx > 0) { targetIdx--; refreshPreview(); }
    });
    nextBtn.addEventListener("click", () => {
      if (targetIdx < targets.length - 1) { targetIdx++; refreshPreview(); }
    });

    /* ---------- tombol ---------- */
    $("#signSave", wrap).addEventListener("click", () => {
      /* kanvas kosong tidak boleh menimpa tanda tangan yang diimpor */
      if (!hasInk && img) {
        if (sh().toast) sh().toast("Kanvas kosong — tanda tangan yang diimpor tetap dipakai.", "err");
        return;
      }
      const out = document.createElement("canvas");
      out.width = pad.width; out.height = pad.height;
      const o = out.getContext("2d");
      o.fillStyle = "#fff";
      o.fillRect(0, 0, out.width, out.height);
      o.drawImage(pad, 0, 0);
      const data = out.toDataURL("image/png");
      const bytes = Uint8Array.from(atob(data.split(",")[1]), (c) => c.charCodeAt(0));
      let hex = "";
      for (const b of bytes) hex += b.toString(16).padStart(2, "0");
      state.custom.opts.signature = hex;
      setImage(data, pad.width, pad.height);
      if (sh().toast) sh().toast("Tanda tangan disimpan.", "ok");
    });
    const fileInput = $("#signFile", wrap);
    $("#signImportPhoto", wrap).addEventListener("click", () => {
      fileInput.dataset.mode = "photo";
      fileInput.click();
    });
    $("#signImportQr", wrap).addEventListener("click", () => {
      fileInput.dataset.mode = "qr";
      fileInput.click();
    });
    fileInput.addEventListener("change", () => {
      const f = fileInput.files && fileInput.files[0];
      const mode = fileInput.dataset.mode || "photo";
      fileInput.value = "";
      imporGambar(f, mode !== "qr");
    });
    $("#signRemove", wrap).addEventListener("click", () => {
      delete state.custom.opts.signature;
      setImage(null, 0, 0);
      if (sh().toast) sh().toast("Gambar tanda tangan dihapus.", "ok");
    });

    /* pratinjau diperbarui saat opsi posisi berubah atau berkas baru masuk */
    state.custom.onOptsChange = () => { schedulePreview(); };
    state.custom.refreshPreview = refreshPreview;
    /* lepaskan dokumen pdf.js saat alat diganti */
    state.custom.dispose = () => {
      renderToken++;
      if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = 0; }
      if (pdfDoc) { try { pdfDoc.destroy(); } catch (_) { /* abaikan */ } pdfDoc = null; }
      pdfBytesKey = "";
    };
    /* gambar dari kanvas ditulis tangan ikut dipakai pratinjau */
    setHint("Pilih satu PDF untuk melihat pratinjau.");
    refreshPreview();
  }

  /* --- Redaksi --- */
  async function renderRedact(host) {
    const wrap = el("div", "redact-wrap");
    const judul = el("p", "muted small",
      'Pilih PDF, ketik kata yang mau diredaksi di panel samping, lalu klik "Cari kata".');
    const aksi = el("div", "redact-aksi");
    const btnCari = el("button", "btn btn-ghost btn-sm", "Cari kata");
    btnCari.type = "button";
    btnCari.addEventListener("click", () => { void state.custom.findRedact(); });
    aksi.appendChild(btnCari);
    const hasil = el("div", "redact-hasil");
    wrap.appendChild(judul);
    wrap.appendChild(aksi);
    wrap.appendChild(hasil);
    host.appendChild(wrap);
    state.custom.refreshRedact = async () => {
      const f = state.files[0];
      btnCari.disabled = !f;
      if (!f) {
        hasil.innerHTML = "";
        state.custom.opts.hits = null;
        return;
      }
    };
    state.custom.findRedact = async () => {
      const f = state.files[0];
      const term = String(state.opts.term || "").trim();
      if (!f) { if (sh().toast) sh().toast("Pilih PDF dulu.", "err"); return; }
      if (!term) { if (sh().toast) sh().toast("Isi kata yang mau diredaksi.", "err"); return; }
      hasil.innerHTML = '<p class="muted small">Mencari…</p>';
      try {
        const semua = await state.tool.search({ files: state.files, opts: state.opts });
        state.custom.opts.hits = semua;
        hasil.innerHTML = "";
        if (!semua.length) {
          hasil.appendChild(el("p", "tool-warn", `"${term}" tidak ditemukan di PDF ini.`));
          return;
        }
        /* Hanya kemunculan pada halaman yang DIPILIH yang akan
           ditutup — halaman di luar rentang dibiarkan utuh. */
        const core = window.PDFToolsCore;
        let hits = semua;
        let ringkasan = `${semua.length} kemunculan ditemukan. Semua akan ditutup secara permanen.`;
        if (core && core.normSpesifikasiHalaman) {
          const total = totalDiketahui();
          const spec = core.normSpesifikasiHalaman(state.opts.halaman, total);
          const pilih = new Set(core.halamanTerpilih(spec, total));
          hits = semua.filter((h) => pilih.has(h.page));
          const cakupan = core.ringkasHalaman(spec, total);
          ringkasan = hits.length === semua.length
            ? `${semua.length} kemunculan ditemukan (${cakupan}). Semua akan ditutup secara permanen.`
            : `${hits.length} dari ${semua.length} kemunculan akan ditutup (${cakupan}). ${semua.length - hits.length} kemunculan di luar rentang dibiarkan utuh.`;
        }
        if (!hits.length) {
          hasil.appendChild(el("p", "tool-warn", `"${term}" tidak ditemukan di halaman yang dipilih.`));
          return;
        }
        hasil.appendChild(el("p", "muted small", ringkasan));
        const list = el("div", "redact-list");
        for (const h of hits) {
          const row = el("div", "redact-row");
          row.innerHTML = `<span class="rr-page">Hal. ${h.page}</span><span class="rr-text">${escapeHtml((h.text || "").slice(0, 90))}</span>`;
          list.appendChild(row);
        }
        hasil.appendChild(list);
      } catch (err) {
        hasil.innerHTML = `<p class="tool-warn">${escapeHtml(err.message || String(err))}</p>`;
      }
    };
  }

  /* --- HTML --- */
  function renderHtml(host) {
    const wrap = el("div", "html-wrap");
    wrap.innerHTML = '<p class="muted small">Pilih berkas .html untuk ditampilkan di sini, lalu tekan "Buka dialog cetak".</p><div class="html-frame" id="htmlPreview"></div>';
    host.appendChild(wrap);
    state.custom.refreshHtml = async () => {
      const f = state.files[0];
      const box = $("#htmlPreview", wrap);
      if (!f) { box.innerHTML = ""; return; }
      const html = new TextDecoder("utf-8").decode(f.bytes);
      const iframe = document.createElement("iframe");
      iframe.setAttribute("sandbox", "allow-same-origin");
      iframe.style.cssText = "width:100%;height:420px;border:1px solid var(--line);border-radius:10px;background:#fff";
      iframe.srcdoc = html;
      box.innerHTML = "";
      box.appendChild(iframe);
    };
  }

  /* --- Pindai (kamera) --- */
  function renderScan(host) {
    const wrap = el("div", "scan-wrap");
    wrap.innerHTML = `
      <p class="muted small">Tambah foto hasil pindai. Kamera bisa dipakai langsung bila perangkat mendukung.</p>
      <div class="scan-actions">
        <button type="button" class="btn btn-ghost btn-sm" id="scanCam">Ambil foto dengan kamera</button>
      </div>
      <video id="scanVideo" class="scan-video" hidden playsinline></video>
      <div class="scan-actions"><button type="button" class="btn btn-primary btn-sm" id="scanShot" hidden>Ambil foto</button></div>`;
    host.appendChild(wrap);
    let stream = null;
    $("#scanCam", wrap).addEventListener("click", async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const v = $("#scanVideo", wrap);
        v.srcObject = stream;
        v.hidden = false;
        $("#scanShot", wrap).hidden = false;
        await v.play();
      } catch (err) {
        if (sh().toast) sh().toast("Kamera tidak bisa dipakai: " + (err.message || err), "err", 5000);
      }
    });
    $("#scanShot", wrap).addEventListener("click", () => {
      const v = $("#scanVideo", wrap);
      const c = document.createElement("canvas");
      c.width = v.videoWidth || 1280;
      c.height = v.videoHeight || 960;
      c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
      c.toBlob((blob) => {
        if (!blob) return;
        blob.arrayBuffer().then((ab) => {
          state.files.push({
            name: "pindai-" + Date.now() + ".jpg",
            bytes: new Uint8Array(ab),
            type: "image/jpeg",
          });
          renderFiles();
        });
      }, "image/jpeg", 0.92);
    });
  }

  /* --- Buka kunci --- */
  function renderUnlock(host) {
    const wrap = el("div", "unlock-wrap");
    wrap.innerHTML = `
      <p class="muted small">Kalau PDF-nya terkunci, you'll diminta password. Password bisa diisi lebih dulu di bawah.</p>
      <label class="tool-label" for="f_unlockpw">Password (opsional, isi di sini bila sudah tahu)</label>
      <input id="f_unlockpw" type="password" autocomplete="off" />`;
    host.appendChild(wrap);
    $("#f_unlockpw", wrap).addEventListener("input", (e) => {
      state.custom.opts.password = e.target.value;
    });
  }

  /* ============================================================
     Pemasangan
     ============================================================ */
  function init(links) {
    state.links = links || [];
    renderLauncher();

    const catHost = $("#toolCategories");
    if (catHost) {
      catHost.addEventListener("click", (e) => {
        const link = e.target.closest("[data-tool-link]");
        if (link) {
          const target = link.dataset.toolLink;
          const mode = link.dataset.toolMode;
          if (mode && window.PDFApp && window.PDFApp.setMode) window.PDFApp.setMode(mode);
          if (window.PDFApp && window.PDFApp.setTab) window.PDFApp.setTab(target);
          return;
        }
        const card = e.target.closest("[data-tool]");
        if (card) openTool(card.dataset.tool);
      });
    }

    wireSearch();

    /* handler klik untuk baris pintasan (beranda & daftar alat) */
    for (const sel of ["#toolQuick", "#quickGrid"]) {
      const host = $(sel);
      if (!host) continue;
      host.addEventListener("click", (e) => {
        const link = e.target.closest("[data-tool-link]");
        if (link) {
          const target = link.dataset.toolLink;
          const mode = link.dataset.toolMode;
          if (mode && window.PDFApp && window.PDFApp.setMode) window.PDFApp.setMode(mode);
          if (window.PDFApp && window.PDFApp.setTab) window.PDFApp.setTab(target);
          return;
        }
        const card = e.target.closest("[data-tool]");
        if (card) openTool(card.dataset.tool);
      });
    }

    const back = $("#toolBackBtn");
    if (back) back.addEventListener("click", backToMenu);

    const input = $("#toolInput");
    if (input) {
      input.addEventListener("change", async (e) => {
        const list = Array.from(e.target.files || []);
        e.target.value = "";
        const tool = state.tool;
        for (const file of list) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          state.files.push({ id: "tf" + (++toolFileSeq), name: file.name, bytes, type: file.type, size: file.size });
        }
        renderFiles();
        if (state.custom.refreshOrganize) state.custom.refreshOrganize();
        if (state.custom.refreshForms) state.custom.refreshForms();
        if (state.custom.refreshHtml) state.custom.refreshHtml();
        if (state.custom.refreshEditor) state.custom.refreshEditor();
        if (state.custom.refreshPreview) state.custom.refreshPreview();
        void tool;
      });
    }

    const pick = $("#toolPickBtn");
    if (pick) pick.addEventListener("click", () => input && input.click());

    const drop = $("#toolDrop");
    if (drop) {
      drop.addEventListener("click", (e) => {
        if (!e.target.closest("button")) input && input.click();
      });
      drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
      drop.addEventListener("dragleave", () => drop.classList.remove("over"));
      drop.addEventListener("drop", async (e) => {
        e.preventDefault();
        drop.classList.remove("over");
        const list = Array.from(e.dataTransfer.files || []);
        for (const file of list) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          state.files.push({ id: "tf" + (++toolFileSeq), name: file.name, bytes, type: file.type, size: file.size });
        }
        renderFiles();
        if (state.custom.refreshOrganize) state.custom.refreshOrganize();
        if (state.custom.refreshForms) state.custom.refreshForms();
        if (state.custom.refreshHtml) state.custom.refreshHtml();
        if (state.custom.refreshEditor) state.custom.refreshEditor();
        if (state.custom.refreshPreview) state.custom.refreshPreview();
      });
    }

    const run = $("#toolRunBtn");
    if (run) run.addEventListener("click", runTool);
  }

  window.PDFToolsUI = { init, openTool, backToMenu, renderLauncher, state };
})();
