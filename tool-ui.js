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
        b.innerHTML = `<span class="tool-ic">${iconSvg(l.icon)}</span><span class="tool-name">${l.name}</span><span class="tool-desc">${l.desc}</span>`;
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
     Ruang kerja alat
     ============================================================ */
  function openTool(id) {
    const tool = (C.registry || []).find((t) => t.id === id);
    if (!tool) return;
    state.tool = tool;
    state.files = [];
    state.opts = {};
    state.results = [];
    state.custom = {};
    /* nilai bawaan opsi */
    for (const f of tool.fields || []) {
      state.opts[f.id] = f.value !== undefined ? f.value : (f.type === "check" ? false : "");
    }
    $("#toolTitle").textContent = tool.name;
    $("#toolDesc").textContent = tool.desc;
    $("#toolIcon").innerHTML = iconSvg(tool.icon);
    const input = $("#toolInput");
    input.accept = tool.accept || "";
    input.multiple = tool.multiple !== false;
    $("#toolOptions").innerHTML = "";
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
    state.tool = null;
    state.files = [];
    state.results = [];
    $("#toolView").hidden = true;
    $("#toolsView").hidden = false;
    renderLauncher();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------- render opsi ---------- */
  function renderFields(fields) {
    const host = $("#toolOptions");
    host.innerHTML = "";
    for (const f of fields) {
      if (f.type === "check") {
        const l = el("label", "tool-check");
        const i = document.createElement("input");
        i.type = "checkbox";
        i.id = "f_" + f.id;
        i.checked = !!f.value;
        i.addEventListener("change", () => { state.opts[f.id] = i.checked; applyVisibility(); });
        l.appendChild(i);
        l.appendChild(el("span", "", f.label));
        host.appendChild(l);
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
        if (String(state.opts[k]) !== String(f.visibleIf[k])) { ok = false; break; }
      }
      wrap.hidden = !ok;
    }
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
      });
      row.appendChild(rm);
      host.appendChild(row);
    }
    const drop = $("#toolDrop");
    if (drop) drop.hidden = state.files.length > 0;
    updateRunState();
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
  }

  /* --- Susun PDF --- */
  async function renderOrganize(host) {
    const wrap = el("div", "organize-wrap");
    wrap.innerHTML = '<p class="muted small">Pilih satu PDF untuk menyusun ulang halamannya.</p>';
    host.appendChild(wrap);
    const refresh = async () => {
      const f = state.files[0];
      if (!f) { wrap.innerHTML = '<p class="muted small">Pilih satu PDF untuk menyusun ulang halamannya.</p>'; state.custom.organize = null; return; }
      wrap.innerHTML = '<p class="muted small">Membaca halaman…</p>';
      const data = await state.tool.open(f.bytes);
      state.custom.organize = data;
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

      function drawOrganize() {
        grid.innerHTML = "";
        data.items.forEach((it, idx) => {
          const cell = el("div", "org-cell" + (it.del ? " deleted" : ""));
          const th = data.thumbs[it.n - 1];
          const img = document.createElement("img");
          img.src = th ? th.data : "";
          img.alt = "Halaman " + it.n;
          img.style.transform = "rotate(" + it.rot + "deg)";
          cell.appendChild(img);
          const num = el("span", "org-num", String(idx + 1));
          cell.appendChild(num);
          const acts = el("div", "org-acts");
          const mk = (label, title, fn) => {
            const b = el("button", "org-btn", label);
            b.type = "button";
            b.title = title;
            b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
            return b;
          };
          acts.appendChild(mk("↺", "Putar kiri", () => { it.rot = (it.rot + 270) % 360; drawOrganize(); }));
          acts.appendChild(mk("↻", "Putar kanan", () => { it.rot = (it.rot + 90) % 360; drawOrganize(); }));
          acts.appendChild(mk("⧉", "Duplikat", () => { data.items.splice(idx + 1, 0, { n: it.n, rot: it.rot, del: false }); drawOrganize(); }));
          acts.appendChild(mk("🗑", "Hapus", () => { it.del = true; drawOrganize(); }));
          cell.appendChild(acts);
          cell.addEventListener("click", () => {
            /* klik pada thumbnail: kirim satu halaman ke depan */
            if (idx + 1 < data.items.length) {
              const tmp = data.items[idx];
              data.items[idx] = data.items[idx + 1];
              data.items[idx + 1] = tmp;
              drawOrganize();
            }
          });
          grid.appendChild(cell);
        });
      }
      drawOrganize();
    };
    state.custom.refreshOrganize = refresh;
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

  /* --- Tanda tangan --- */
  function renderSign(host) {
    const wrap = el("div", "sign-wrap");
    wrap.innerHTML = `
      <p class="muted small">Tulis tanda tangan di kotak bawah, lalu klik "Simpan tanda tangan".</p>
      <canvas id="signPad" width="640" height="220" class="sign-pad"></canvas>
      <div class="sign-actions">
        <button type="button" class="btn btn-ghost btn-sm" id="signClear">Bersihkan</button>
        <button type="button" class="btn btn-primary btn-sm" id="signSave">Simpan tanda tangan</button>
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
    const pos = (e) => {
      const r = pad.getBoundingClientRect();
      const t = e.touches ? e.touches[0] : e;
      return { x: ((t.clientX - r.left) / r.width) * pad.width, y: ((t.clientY - r.top) / r.height) * pad.height };
    };
    const start = (e) => { e.preventDefault(); drawing = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
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
    });
    $("#signSave", wrap).addEventListener("click", () => {
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
      if (sh().toast) sh().toast("Tanda tangan disimpan.", "ok");
    });
  }

  /* --- Redaksi --- */
  async function renderRedact(host) {
    const wrap = el("div", "redact-wrap");
    wrap.innerHTML = '<p class="muted small">Pilih PDF, ketik kata yang mau diredaksi di panel samping, lalu klik "Cari kata".</p>';
    host.appendChild(wrap);
    state.custom.refreshRedact = async () => {
      const f = state.files[0];
      if (!f) {
        wrap.innerHTML = '<p class="muted small">Pilih PDF, ketik kata yang mau diredaksi di panel samping, lalu klik "Cari kata".</p>';
        state.custom.opts.hits = null;
        return;
      }
    };
    state.custom.findRedact = async () => {
      const f = state.files[0];
      const term = String(state.opts.term || "").trim();
      if (!f) { if (sh().toast) sh().toast("Pilih PDF dulu.", "err"); return; }
      if (!term) { if (sh().toast) sh().toast("Isi kata yang mau diredaksi.", "err"); return; }
      wrap.innerHTML = '<p class="muted small">Mencari…</p>';
      try {
        const hits = await state.tool.search({ files: state.files, opts: state.opts });
        state.custom.opts.hits = hits;
        wrap.innerHTML = "";
        if (!hits.length) {
          wrap.appendChild(el("p", "tool-warn", `"${term}" tidak ditemukan di PDF ini.`));
          return;
        }
        wrap.appendChild(el("p", "muted small", `${hits.length} kemunculan ditemukan. Semua akan ditutup secara permanen.`));
        const list = el("div", "redact-list");
        for (const h of hits) {
          const row = el("div", "redact-row");
          row.innerHTML = `<span class="rr-page">Hal. ${h.page}</span><span class="rr-text">${escapeHtml((h.text || "").slice(0, 90))}</span>`;
          list.appendChild(row);
        }
        wrap.appendChild(list);
      } catch (err) {
        wrap.innerHTML = `<p class="tool-warn">${escapeHtml(err.message || String(err))}</p>`;
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
          state.files.push({ name: file.name, bytes, type: file.type, size: file.size });
        }
        renderFiles();
        if (state.custom.refreshOrganize) state.custom.refreshOrganize();
        if (state.custom.refreshForms) state.custom.refreshForms();
        if (state.custom.refreshHtml) state.custom.refreshHtml();
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
          state.files.push({ name: file.name, bytes, type: file.type, size: file.size });
        }
        renderFiles();
        if (state.custom.refreshOrganize) state.custom.refreshOrganize();
        if (state.custom.refreshForms) state.custom.refreshForms();
        if (state.custom.refreshHtml) state.custom.refreshHtml();
      });
    }

    const run = $("#toolRunBtn");
    if (run) run.addEventListener("click", runTool);
  }

  window.PDFToolsUI = { init, openTool, backToMenu, renderLauncher, state };
})();
