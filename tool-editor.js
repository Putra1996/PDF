/* ============================================================
   Editor PDF visual — "seperti Word": ubah font teks, sisipkan
   gambar, ganti gambar, dan hapus teks/gambar yang ada.

   Cara kerja:
   - Halaman dirender pdf.js ke kanvas.
   - Blok teks & kotak gambar dideteksi lalu jadi area yang bisa
     diklik (tepi putus-putus).
   - Edit disimpan sebagai daftar operasi per halaman; hasil akhir
     dirender ulang (halaman yang diedit menjadi gambar, halaman
     lain tetap vektor supaya teksnya masih bisa dicari).
   ============================================================ */
(function () {
  "use strict";

  const C = window.PDFToolsCore;
  const UI = () => window.PDFToolsUI;

  const S = {
    doc: null,
    pages: 0,
    pageNo: 1,
    zoom: 1.25,
    mode: "select",        // select | text | image
    texts: [],
    images: [],
    sel: null,             // {kind:'text'|'image', idx, opId}
    pendingImage: null,    // dataURL gambar yang siap disisipkan
    opSeq: 0,
    busy: false,
    wrap: null,            // elemen panel (untuk pintasan keyboard)
    redraw: null,          // fungsi render terakhir
    hist: { past: [], future: [], last: 0 },
  };

  /* ---------- util kecil ---------- */
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function ui() { return UI().state; }
  function edits() {
    const st = ui();
    if (!st.custom.opts) st.custom.opts = {};
    if (!st.custom.opts.edits) st.custom.opts.edits = {};
    return st.custom.opts.edits;
  }
  function pageOps(pageNo) {
    const e = edits();
    const k = String(pageNo == null ? S.pageNo : pageNo);
    if (!e[k]) e[k] = [];
    return e[k];
  }
  function toast(msg, kind) {
    const sh = window.PDFShared || {};
    if (sh.toast) sh.toast(msg, kind);
  }
  function file() {
    const st = ui();
    return (st.files && st.files[0]) || null;
  }

  /* ============================================================
     Riwayat perubahan (undo / redo)
     ============================================================ */
  function snapshot() {
    try {
      return JSON.parse(JSON.stringify(edits()));
    } catch (_) {
      return {};
    }
  }
  function applySnapshot(snap) {
    const e = edits();
    for (const k of Object.keys(e)) delete e[k];
    if (snap) Object.assign(e, snap);
  }
  /* Simpan state SEBELUM perubahan. Perubahan yang beruntun
     (mis. mengetik) digabung jadi satu langkah riwayat. */
  function pushHistory(force) {
    const now = Date.now();
    if (!force && now - S.hist.last < 700) {
      S.hist.last = now;
      return;
    }
    S.hist.past.push(snapshot());
    if (S.hist.past.length > 80) S.hist.past.shift();
    S.hist.future.length = 0;
    S.hist.last = now;
  }
  function clearHistory() {
    S.hist.past.length = 0;
    S.hist.future.length = 0;
    S.hist.last = 0;
  }
  function undo() {
    if (!S.hist.past.length) return false;
    S.hist.future.push(snapshot());
    applySnapshot(S.hist.past.pop());
    S.hist.last = 0;
    afterHistory("Perubahan dibatalkan.");
    return true;
  }
  function redo() {
    if (!S.hist.future.length) return false;
    S.hist.past.push(snapshot());
    applySnapshot(S.hist.future.pop());
    S.hist.last = 0;
    afterHistory("Perubahan diulang.");
    return true;
  }
  function afterHistory(msg) {
    S.sel = null;
    if (S.redraw) S.redraw();
    toast(msg);
  }
  function updateHistoryButtons() {
    if (!S.wrap) return;
    const u = S.wrap.querySelector("[data-ed=undo]");
    const r = S.wrap.querySelector("[data-ed=redo]");
    if (u) u.disabled = !S.hist.past.length;
    if (r) r.disabled = !S.hist.future.length;
  }

  /* Konversi koordinat kanvas <-> user space PDF. */
  function canvasToPdf(viewport, cx, cy) {
    const t = viewport.transform;
    const det = t[0] * t[3] - t[1] * t[2];
    if (!det) return [0, 0];
    const x = cx - t[4];
    const y = cy - t[5];
    return [(x * t[3] - y * t[2]) / det, (y * t[0] - x * t[1]) / det];
  }

  /* ============================================================
     Panel
     ============================================================ */
  function render(host) {
    const wrap = el("div", "ed-wrap");
    wrap.innerHTML = `
      <div class="ed-bar">
        <button type="button" class="btn btn-ghost btn-sm" data-ed="prev" title="Halaman sebelumnya" aria-label="Halaman sebelumnya"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m14.5 6-6 6 6 6"/></svg></button>
        <span class="ed-page">Halaman 1 / 1</span>
        <button type="button" class="btn btn-ghost btn-sm" data-ed="next" title="Halaman berikutnya" aria-label="Halaman berikutnya"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9.5 6 6 6-6 6"/></svg></button>
        <span class="ed-sep"></span>
        <button type="button" class="btn btn-ghost btn-sm" data-ed="zoomout" title="Perkecil">−</button>
        <span class="ed-zoom">125%</span>
        <button type="button" class="btn btn-ghost btn-sm" data-ed="zoomin" title="Perbesar">+</button>
        <span class="ed-sep"></span>
        <button type="button" class="ed-mode" data-mode="select">Pilih</button>
        <button type="button" class="ed-mode" data-mode="text">+ Teks</button>
        <button type="button" class="ed-mode" data-mode="image">+ Gambar</button>
        <button type="button" class="btn btn-ghost btn-sm" data-ed="pick">Sisipkan gambar…</button>
        <input type="file" accept="image/png,image/jpeg" hidden data-ed="file" />
        <span class="ed-sep"></span>
        <button type="button" class="btn btn-ghost btn-sm" data-ed="undo" title="Urungkan perubahan (Ctrl+Z)" aria-label="Urungkan perubahan" disabled><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg></button>
        <button type="button" class="btn btn-ghost btn-sm" data-ed="redo" title="Ulangi perubahan (Ctrl+Y)" aria-label="Ulangi perubahan" disabled><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/></svg></button>
        <span class="ed-sep"></span>
        <button type="button" class="btn btn-ghost btn-sm" data-ed="reset">Batalkan semua perubahan</button>
        <span class="ed-sep"></span>
        <button type="button" class="btn btn-ghost btn-sm" data-ed="docx" title="Unduh isi dokumen sebagai berkas .docx">Ekspor ke Word</button>
        <button type="button" class="btn btn-ghost btn-sm" data-ed="xlsx" title="Unduh isi dokumen sebagai lembar kerja .xlsx">Ekspor ke Excel</button>
        <button type="button" class="btn btn-ghost btn-sm" data-ed="pptx" title="Unduh isi dokumen sebagai presentasi .pptx">Ekspor ke PowerPoint</button>
        <span class="ed-sep"></span>
        <button type="button" class="btn btn-ghost btn-sm" data-ed="saveProject" title="Simpan semua perubahan sebagai berkas proyek .edit.json">Simpan proyek</button>
        <button type="button" class="btn btn-ghost btn-sm" data-ed="openProject" title="Buka berkas proyek .edit.json">Buka proyek</button>
        <input type="file" accept="application/json,.json" hidden data-ed="projectFile" />
      </div>
      <div class="ed-main">
        <div class="ed-stage"><div class="ed-stack">
          <canvas class="ed-canvas"></canvas>
          <div class="ed-layer"></div>
        </div></div>
        <aside class="ed-side"></aside>
      </div>`;
    host.appendChild(wrap);
    S.wrap = wrap;

    const canvas = wrap.querySelector(".ed-canvas");
    const layer = wrap.querySelector(".ed-layer");
    const side = wrap.querySelector(".ed-side");
    const bar = wrap.querySelector(".ed-bar");

    /* ---------- toolbar ---------- */
    bar.addEventListener("click", (e) => {
      const b = e.target.closest("[data-ed],[data-mode]");
      if (!b) return;
      if (b.dataset.mode) {
        setMode(b.dataset.mode);
        return;
      }
      const act = b.dataset.ed;
      if (act === "prev") gotoPage(S.pageNo - 1);
      else if (act === "next") gotoPage(S.pageNo + 1);
      else if (act === "zoomin") setZoom(S.zoom + 0.25);
      else if (act === "zoomout") setZoom(S.zoom - 0.25);
      else if (act === "pick") wrap.querySelector("[data-ed=file]").click();
      else if (act === "reset") {
        pushHistory(true);
        edits()[String(S.pageNo)] = [];
        S.sel = null;
        redraw();
        toast("Perubahan pada halaman ini dibatalkan.");
      }
      else if (act === "undo") { undo(); }
      else if (act === "redo") { redo(); }
      else if (act === "docx") { exportDocx(); }
      else if (act === "xlsx") { exportXlsx(); }
      else if (act === "pptx") { exportPptx(); }
      else if (act === "saveProject") { saveProject(); }
      else if (act === "openProject") { wrap.querySelector("[data-ed=projectFile]").click(); }
    });

    /* Buka berkas proyek (.edit.json) */
    wrap.querySelector("[data-ed=projectFile]").addEventListener("change", async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!f) return;
      try {
        const text = await f.text();
        const data = JSON.parse(text);
        if (!data || data.app !== "pemisah-pdf" || !data.edits) {
          throw new Error("Berkas ini bukan proyek editor Pemisah PDF.");
        }
        const now = file();
        if (now && data.sumber && data.sumber.nama && data.sumber.nama !== now.name) {
          toast(`Proyek dibuat dari "${data.sumber.nama}", sedangkan berkas aktif "${now.name}".`, "err");
        }
        const e2 = edits();
        for (const k of Object.keys(e2)) delete e2[k];
        Object.assign(e2, data.edits || {});
        if (data.halaman) S.pageNo = Math.min(S.pages, Math.max(1, Number(data.halaman) || 1));
        if (data.zoom) S.zoom = Number(data.zoom) || S.zoom;
        clearHistory();
        await loadPageBoxes();
        await redraw();
        toast("Proyek dimuat: " + Object.keys(e2).length + " halaman dengan perubahan.");
      } catch (err) {
        toast("Proyek gagal dibuka: " + ((err && err.message) || err), "err");
      }
    });

    /* Pintasan undo/redo (Ctrl+Z / Ctrl+Y) selama panel editor aktif. */
    const keyHandler = (e) => {
      if (!S.doc || !S.wrap || !document.body.contains(S.wrap)) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = String(e.key || "").toLowerCase();
      if (k === "z" && !e.shiftKey) {
        if (!undo()) return;
        e.preventDefault();
      } else if (k === "y" || (k === "z" && e.shiftKey)) {
        if (!redo()) return;
        e.preventDefault();
      }
    };
    document.addEventListener("keydown", keyHandler);

    wrap.querySelector("[data-ed=file]").addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        S.pendingImage = reader.result;
        setMode("image");
        toast("Gambar siap: klik posisi pada halaman untuk menaruhnya.");
      };
      reader.readAsDataURL(f);
    });

    /* ---------- posisi penempatan ---------- */
    function pointerToPdf(ev) {
      const r = canvas.getBoundingClientRect();
      const sx = canvas.width / r.width;
      const sy = canvas.height / r.height;
      const cx = (ev.clientX - r.left) * sx;
      const cy = (ev.clientY - r.top) * sy;
      return canvasToPdf(lastViewport, cx, cy);
    }

    let lastViewport = null;

    /* ---------- render ---------- */
    let redrawing = false;
    let redrawQueued = false;

    async function redraw() {
      S.redraw = redraw;
      if (!S.doc) return;
      /* jangan render dua kali concurrently: antrikan satu render lagi. */
      if (redrawing) { redrawQueued = true; return; }
      redrawing = true;
      try {
        await redrawInner();
      } catch (err) {
        /* jangan biarkan satu kesalahan mematikan panel */
        const msg = err && err.message ? err.message : String(err);
        const sideEl = wrap.querySelector(".ed-side");
        if (sideEl) {
          sideEl.innerHTML = "";
          sideEl.appendChild(el("p", "tool-warn", "Gagal memuat tampilan: " + msg));
        }
        if (window.console) console.error("editor:", err);
      } finally {
        redrawing = false;
        if (redrawQueued) {
          redrawQueued = false;
          redraw();
        }
      }
    }

    S.redraw = redraw;

    async function redrawInner() {
      const { canvas: cv, ctx, viewport } = await C.renderPage(S.doc, S.pageNo, S.zoom);
      lastViewport = viewport;
      S.viewport = viewport;
      canvas.width = cv.width;
      canvas.height = cv.height;
      canvas.style.width = cv.width + "px";
      canvas.style.height = cv.height + "px";
      const c2 = canvas.getContext("2d");
      c2.clearRect(0, 0, canvas.width, canvas.height);
      c2.drawImage(cv, 0, 0);
      await C.applyEdits(c2, viewport, pageOps());
      cv.width = cv.height = 0;

      wrap.querySelector(".ed-page").textContent = `Halaman ${S.pageNo} / ${S.pages}`;
      wrap.querySelector(".ed-zoom").textContent = Math.round(S.zoom * 100) + "%";
      for (const b of bar.querySelectorAll(".ed-mode")) {
        b.classList.toggle("on", b.dataset.mode === S.mode);
      }
      updateHistoryButtons();
      drawLayer(viewport);
      renderSide();
    }

    /* ---------- layer interaktif ---------- */
    function drawLayer(viewport) {
      layer.innerHTML = "";
      layer.style.width = canvas.style.width;
      layer.style.height = canvas.style.height;

      const ops = pageOps();
      const opBySrc = new Map();
      for (const o of ops) if (o.srcId) opBySrc.set(o.srcId, o);

      /* blok teks yang ada */
      S.texts.forEach((t, i) => {
        const r = C.pdfRectToCanvas(viewport, t);
        const d = el("div", "ed-box ed-text");
        d.style.left = r.x + "px";
        d.style.top = r.y + "px";
        d.style.width = r.w + "px";
        d.style.height = r.h + "px";
        d.title = (t.str || "").slice(0, 60);
        d.dataset.kind = "text";
        d.dataset.idx = String(i);
        if (opBySrc.has(t.id)) d.classList.add("edited");
        layer.appendChild(d);
      });

      /* kotak gambar yang ada */
      S.images.forEach((im, i) => {
        const op = opBySrc.get(im.id);
        /* kalau gambarnya sudah digeser/diubah ukuran, Kotak ikut
           posisi & ukuran baru supaya yang dilihat pengguna = hasil. */
        const rect = op && op.box ? op.box : im;
        const r = C.pdfRectToCanvas(viewport, rect);
        const d = el("div", "ed-box ed-img");
        d.style.left = r.x + "px";
        d.style.top = r.y + "px";
        d.style.width = r.w + "px";
        d.style.height = r.h + "px";
        d.title = "Gambar";
        d.dataset.kind = "image";
        d.dataset.idx = String(i);
        if (op) {
          d.classList.add("edited");
          d.dataset.opid = op.id;
          d.appendChild(el("span", "ed-handle"));
        }
        layer.appendChild(d);
      });

      /* elemen baru (teks/gambar yang disisipkan user) */
      for (const o of ops) {
        if (!o.newItem) continue;
        const r = C.pdfRectToCanvas(viewport, o.box);
        const d = el("div", "ed-box ed-new");
        d.style.left = r.x + "px";
        d.style.top = r.y + "px";
        d.style.width = r.w + "px";
        d.style.height = r.h + "px";
        d.dataset.opid = o.id;
        d.title = o.k === "text" ? (o.text || "") : "Gambar baru";
        const h = el("span", "ed-handle");
        d.appendChild(h);
        layer.appendChild(d);
      }

      /* penanda elemen yang sedang dipilih */
      for (const d of layer.querySelectorAll(".ed-box")) {
        if (isSelected(d)) d.classList.add("sel");
      }
    }

    function isSelected(d) {
      if (!S.sel) return false;
      if (d.dataset.opid) return d.dataset.opid === S.sel.opId;
      if (d.dataset.kind === "text") return S.sel.kind === "text" && Number(d.dataset.idx) === S.sel.idx;
      if (d.dataset.kind === "image") return S.sel.kind === "image" && Number(d.dataset.idx) === S.sel.idx;
      return false;
    }

    /* klik pada area kosong: taruh elemen baru atau batal pilih */
    layer.addEventListener("click", (e) => {
      const box = e.target.closest(".ed-box");
      if (!box) {
        if (S.mode === "text") {
          const p = pointerToPdf(e);
          addText(p[0], p[1]);
          return;
        }
        if (S.mode === "image") {
          if (!S.pendingImage) {
            toast("Pilih gambar dulu (tombol \"Sisipkan gambar…\").", "err");
            return;
          }
          const p = pointerToPdf(e);
          addImage(p[0], p[1]);
          return;
        }
        S.sel = null;
        redraw();
        return;
      }
      if (box.dataset.opid) {
        const op = pageOps().find((o) => o.id === box.dataset.opid);
        S.sel = { kind: op && op.k === "text" ? "text" : "image", idx: -1, opId: box.dataset.opid, newItem: true };
      } else if (box.dataset.kind === "text") {
        S.sel = { kind: "text", idx: Number(box.dataset.idx) };
      } else {
        S.sel = { kind: "image", idx: Number(box.dataset.idx) };
      }
      redraw();
    });

    /* seret untuk memindahkan / mengubah ukuran elemen baru */
    let drag = null;
    layer.addEventListener("mousedown", (e) => {
      const box = e.target.closest(".ed-box");
      if (!box) return;
      let op = null;
      if (box.dataset.opid) {
        op = pageOps().find((o) => o.id === box.dataset.opid);
      } else if (box.dataset.kind === "image") {
        /* gambar yang sudah ada di PDF: buat operasi "pindah/ubah ukuran"
           (piksel gambar disalin dari halaman aslinya). */
        const im = S.images[Number(box.dataset.idx)];
        if (!im) return;
        op = {
          id: "img" + im.id, k: "image", srcId: im.id,
          copyFrom: { x: im.x, y: im.y, w: im.w, h: im.h },
          box: { x: im.x, y: im.y, w: im.w, h: im.h },
        };
        upsert(op);
        S.sel = { kind: "image", idx: Number(box.dataset.idx), opId: op.id };
        redraw();
      } else {
        /* Teks yang sudah ada bisa digeser: teks asli ditutup (erase)
           lalu disalin sebagai objek teks baru dengan font terdekat,
           persis seperti memindahkan lapisan di Word. */
        const t = S.texts[Number(box.dataset.idx)];
        if (!t) return;
        const sudah = pageOps().find((o) => o.srcId === t.id && o.k === "text");
        if (sudah) {
          /* teks sudah punya salinan sendiri: cukup gerakkan salinan itu */
          op = sudah;
        } else {
          pushHistory(true);
          upsert({
            id: "e" + (++S.opSeq), k: "erase", srcId: t.id,
            box: { x: t.x, y: t.y, w: t.w, h: t.h },
          });
          op = {
            id: "mt" + (++S.opSeq), k: "text", srcId: t.id, moved: true,
            box: { x: t.x, y: t.y, w: t.w, h: t.h },
            by: t.by, text: t.str, size: t.size,
            font: C.approxFont(t.fontName),
            color: "#111111", bold: false, italic: false, align: "left",
            underline: false, strike: false, lineHeight: 1.2, letterSpacing: 0,
          };
          upsert(op);
        }
        S.sel = { kind: "text", idx: Number(box.dataset.idx), opId: op.id, newItem: true };
        redraw();
      }
      if (!op) return;
      e.preventDefault();
      e.stopPropagation();
      pushHistory(true);
      const r = box.getBoundingClientRect();
      const resize = !!e.target.closest(".ed-handle");
      drag = {
        op,
        resize,
        startX: e.clientX,
        startY: e.clientY,
        box0: Object.assign({}, op.box),
        pxPerPt: (lastViewport ? lastViewport.scale : 1) * (box.offsetWidth ? r.width / op.box.w : 1) / (op.box.w || 1),
      };
      drag.pxPerPt = (lastViewport ? lastViewport.scale : 1);
      S.sel = { kind: op.k === "text" ? "text" : "image", idx: -1, opId: op.id, newItem: true };
      redraw();
    });
    window.addEventListener("mousemove", (e) => {
      if (!drag) return;
      const dx = (e.clientX - drag.startX) / drag.pxPerPt;
      const dy = (e.clientY - drag.startY) / drag.pxPerPt;
      if (drag.resize) {
        drag.op.box.w = Math.max(12, drag.box0.w + dx);
        drag.op.box.h = Math.max(8, drag.box0.h - dy);
      } else {
        drag.op.box.x = drag.box0.x + dx;
        drag.op.box.y = drag.box0.y - dy;
      }
      drawLayer(lastViewport);
    });
    window.addEventListener("mouseup", () => {
      if (!drag) return;
      drag = null;
      redraw();
    });

    /* ---------- inspector ---------- */
    function renderSide() {
      side.innerHTML = "";
      const sel = S.sel;
      if (!sel) {
        side.appendChild(el("p", "muted small",
          "Klik blok teks untuk mengubah font, warna, atau ukurannya. Klik kotak gambar untuk mengganti atau menghapus gambar."));
        const info = el("p", "muted small",
          `Terdeteksi ${S.texts.length} blok teks dan ${S.images.length} gambar di halaman ini.`);
        side.appendChild(info);
        const changes = Object.keys(edits()).filter((k) => edits()[k].length);
        side.appendChild(el("p", "muted small",
          changes.length ? `Perubahan pada ${changes.length} halaman.` : "Belum ada perubahan."));
        layerPanel();
        bulkPanel();
        return;
      }

      if (sel.newItem) {
        const op = pageOps().find((o) => o.id === sel.opId);
        if (!op) { S.sel = null; return renderSide(); }
        if (op.k === "text") textForm(op, true);
        else imageForm(op, true);
        return;
      }

      if (sel.kind === "text") {
        const t = S.texts[sel.idx];
        if (!t) { S.sel = null; return renderSide(); }
        const existing = pageOps().find((o) => o.srcId === t.id && o.k === "text");
        textForm(existing ? Object.assign({}, existing, { box: existing.box }) : {
          id: t.id, srcId: t.id, k: "text", box: { x: t.x, y: t.y, w: t.w, h: t.h },
          by: t.by, text: t.str, size: t.size, font: "helvetica", color: "#111111",
          bold: false, italic: false, align: "left",
          underline: false, strike: false, lineHeight: 1.2, letterSpacing: 0,
        }, false, t);
      } else {
        const im = S.images[sel.idx];
        if (!im) { S.sel = null; return renderSide(); }
        const existing = pageOps().find((o) => o.srcId === im.id && o.k === "image");
        imageForm(existing ? Object.assign({}, existing) : {
          id: "img" + im.id, srcId: im.id, k: "image",
          copyFrom: { x: im.x, y: im.y, w: im.w, h: im.h },
          box: { x: im.x, y: im.y, w: im.w, h: im.h },
        }, false, im);
      }
    }

    /* Daftar lapisan objek yang disisipkan di halaman ini. */
    function layerPanel() {
      /* lapisan = objek yang dibuat pengguna: sisipan baru + teks
         yang digeser (salinan lapisan) */
      const layers = pageOps().filter((o) => o.newItem || o.moved);
      const box = el("div", "ed-insp");
      box.appendChild(el("h4", "ed-insp-title", "Lapisan halaman ini"));
      if (!layers.length) {
        box.appendChild(el("p", "muted small", "Belum ada objek yang disisipkan di halaman ini."));
        side.appendChild(box);
        return;
      }
      const list = el("div", "ed-layers");
      layers.forEach((o) => {
        const row = el("div", "ed-layer-row");
        row.appendChild(el("span", "ed-layer-name",
          (o.k === "text" ? "Teks: " : "Gambar") + String(o.text || "").slice(0, 18)));
        const up = el("button", "btn btn-ghost btn-sm");
        up.type = "button";
        up.title = "Ke depan";
        up.setAttribute("aria-label", "Naikkan lapisan");
        up.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 6-6 6 6"/></svg>';
        up.addEventListener("click", () => { moveLayer(o.id, 1); });
        const down = el("button", "btn btn-ghost btn-sm");
        down.type = "button";
        down.title = "Ke belakang";
        down.setAttribute("aria-label", "Turunkan lapisan");
        down.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 10 6 6 6-6"/></svg>';
        down.addEventListener("click", () => { moveLayer(o.id, -1); });
        const del = el("button", "btn btn-ghost btn-sm");
        del.type = "button";
        del.title = "Hapus lapisan";
        del.setAttribute("aria-label", "Hapus lapisan");
        del.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>';
        del.addEventListener("click", () => {
          pushHistory();
          removeOp(o.id);
          redraw();
        });
        row.appendChild(up);
        row.appendChild(down);
        row.appendChild(del);
        list.appendChild(row);
      });
      box.appendChild(list);
      side.appendChild(box);
    }

    /* Ubah gaya semua blok teks sekaligus. */
    function bulkPanel() {
      const box = el("div", "ed-insp");
      box.appendChild(el("h4", "ed-insp-title", "Ubah semua teks"));
      const props = {};

      const fontSel = document.createElement("select");
      for (const f of C.FONT_LIST) {
        const o = document.createElement("option");
        o.value = f.id;
        o.textContent = f.label;
        fontSel.appendChild(o);
      }
      fontSel.value = "helvetica";
      fontSel.addEventListener("change", () => { props.font = fontSel.value; });
      box.appendChild(labeled("Font", fontSel, "bulkFont"));

      const row = el("div", "ed-row");
      const size = document.createElement("input");
      size.type = "number";
      size.min = "4";
      size.max = "200";
      size.value = 12;
      size.addEventListener("input", () => { props.size = Number(size.value) || 12; });
      row.appendChild(labeled("Ukuran (pt)", size, "bulkSize"));
      const color = document.createElement("input");
      color.type = "color";
      color.value = "#111111";
      color.addEventListener("input", () => { props.color = color.value; });
      row.appendChild(labeled("Warna", color, "bulkColor"));
      box.appendChild(row);

      const row2 = el("div", "ed-row");
      const bold = document.createElement("input");
      bold.type = "checkbox";
      bold.addEventListener("change", () => { props.bold = bold.checked; });
      row2.appendChild(labeled("Tebal", bold, "bulkBold"));
      const italic = document.createElement("input");
      italic.type = "checkbox";
      italic.addEventListener("change", () => { props.italic = italic.checked; });
      row2.appendChild(labeled("Miring", italic, "bulkItalic"));
      const align = document.createElement("select");
      for (const [v, l] of [["left", "Kiri"], ["center", "Tengah"], ["right", "Kanan"]]) {
        const o = document.createElement("option");
        o.value = v; o.textContent = l;
        align.appendChild(o);
      }
      align.addEventListener("change", () => { props.align = align.value; });
      row2.appendChild(labeled("Rata", align, "bulkAlign"));
      box.appendChild(row2);

      const acts = el("div", "ed-actions");
      const halamanIni = el("button", "btn btn-ghost btn-sm", "Terapkan ke halaman ini");
      halamanIni.type = "button";
      halamanIni.addEventListener("click", () => bulkApply([S.pageNo], props));
      acts.appendChild(halamanIni);
      const semua = el("button", "btn btn-primary btn-sm", "Terapkan ke semua halaman");
      semua.type = "button";
      semua.addEventListener("click", () => {
        const list = [];
        for (let p = 1; p <= S.pages; p++) list.push(p);
        bulkApply(list, props);
      });
      acts.appendChild(semua);
      box.appendChild(acts);
      side.appendChild(box);
    }

    async function bulkApply(pageNos, props) {
      if (!S.doc) return;
      const keys = Object.keys(props);
      if (!keys.length) {
        toast("Atur dulu gaya yang mau diterapkan.");
        return;
      }
      pushHistory(true);
      let total = 0;
      for (const p of pageNos) {
        const texts = await C.pageTextBoxes(S.doc, p);
        const ops = edits()[String(p)] || (edits()[String(p)] = []);
        texts.forEach((t, i) => {
          const id = "t" + i;
          const idx = ops.findIndex((o) => o.srcId === id && o.k === "text");
          const op = idx >= 0 ? Object.assign({}, ops[idx]) : {
            id, srcId: id, k: "text",
            box: { x: t.x, y: t.y, w: t.w, h: t.h },
            by: t.by, text: t.str, size: t.size,
            font: C.approxFont(t.fontName),
            color: "#111111", bold: false, italic: false, align: "left",
            underline: false, strike: false, lineHeight: 1.2, letterSpacing: 0,
          };
          Object.assign(op, props);
          if (idx >= 0) ops[idx] = op;
          else ops.push(op);
          total++;
        });
      }
      if (S.pageNo && pageNos.indexOf(S.pageNo) >= 0) await loadPageBoxes();
      await redraw();
      toast(`${total} blok teks diubah (${pageNos.length} halaman).`);
    }

    function textForm(base, isNew, orig) {
      const wrap = el("div", "ed-insp");
      wrap.appendChild(el("h4", "ed-insp-title", isNew ? "Teks baru" : "Teks di PDF"));

      /* Preset gaya ala Word: satu klik mengatur semua properti. */
      const styleSel = document.createElement("select");
      const optAuto = document.createElement("option");
      optAuto.value = "";
      optAuto.textContent = "— gaya cepat —";
      styleSel.appendChild(optAuto);
      for (const st of C.TEXT_STYLES) {
        const o = document.createElement("option");
        o.value = st.id;
        o.textContent = st.label;
        styleSel.appendChild(o);
      }
      /* tandai preset yang sedang dipakai */
      const cocok = C.TEXT_STYLES.find((st) =>
        st.font === (base.font || "helvetica") &&
        st.size === (base.size || 12) &&
        !!st.bold === !!base.bold &&
        !!st.italic === !!base.italic &&
        st.align === (base.align || "left") &&
        st.color.toLowerCase() === String(base.color || "#111111").toLowerCase());
      if (cocok) styleSel.value = cocok.id;
      styleSel.addEventListener("change", () => {
        const st = C.textStyle(styleSel.value);
        if (!st) return;
        Object.assign(base, {
          font: st.font, size: st.size, bold: st.bold, italic: st.italic,
          color: st.color, align: st.align, underline: st.underline,
          strike: st.strike, lineHeight: st.lineHeight, letterSpacing: st.letterSpacing,
        });
        commit(base, isNew);
        renderSide();
      });
      wrap.appendChild(labeled("Gaya teks", styleSel, "style"));

      const ta = document.createElement("textarea");
      ta.rows = 3;
      ta.value = base.text || "";
      ta.addEventListener("input", () => { base.text = ta.value; commit(base, isNew); });
      wrap.appendChild(labeled("Isi teks", ta, "text"));

      const selFont = document.createElement("select");
      for (const f of C.FONT_LIST) {
        const o = document.createElement("option");
        o.value = f.id;
        o.textContent = f.label;
        selFont.appendChild(o);
      }
      selFont.value = base.font || "helvetica";
      selFont.addEventListener("change", () => { base.font = selFont.value; commit(base, isNew); });
      wrap.appendChild(labeled("Font", selFont, "font"));

      const row = el("div", "ed-row");
      const size = document.createElement("input");
      size.type = "number";
      size.min = "4";
      size.max = "200";
      size.value = base.size || 12;
      size.addEventListener("input", () => { base.size = Number(size.value) || 12; commit(base, isNew); });
      row.appendChild(labeled("Ukuran (pt)", size, "size"));

      const color = document.createElement("input");
      color.type = "color";
      color.value = /^#[0-9a-f]{6}$/i.test(base.color || "") ? base.color : "#111111";
      color.addEventListener("input", () => { base.color = color.value; commit(base, isNew); });
      row.appendChild(labeled("Warna", color, "color"));
      wrap.appendChild(row);

      const row2 = el("div", "ed-row");
      const bold = document.createElement("input");
      bold.type = "checkbox";
      bold.checked = !!base.bold;
      bold.addEventListener("change", () => { base.bold = bold.checked; commit(base, isNew); });
      row2.appendChild(labeled("Tebal", bold, "bold"));
      const italic = document.createElement("input");
      italic.type = "checkbox";
      italic.checked = !!base.italic;
      italic.addEventListener("change", () => { base.italic = italic.checked; commit(base, isNew); });
      row2.appendChild(labeled("Miring", italic, "italic"));
      const underline = document.createElement("input");
      underline.type = "checkbox";
      underline.checked = !!base.underline;
      underline.addEventListener("change", () => { base.underline = underline.checked; commit(base, isNew); });
      row2.appendChild(labeled("Garis bawah", underline, "underline"));
      const strike = document.createElement("input");
      strike.type = "checkbox";
      strike.checked = !!base.strike;
      strike.addEventListener("change", () => { base.strike = strike.checked; commit(base, isNew); });
      row2.appendChild(labeled("Coret", strike, "strike"));
      const align = document.createElement("select");
      for (const [v, l] of [["left", "Kiri"], ["center", "Tengah"], ["right", "Kanan"]]) {
        const o = document.createElement("option");
        o.value = v; o.textContent = l;
        align.appendChild(o);
      }
      align.value = base.align || "left";
      align.addEventListener("change", () => { base.align = align.value; commit(base, isNew); });
      row2.appendChild(labeled("Rata", align, "align"));
      wrap.appendChild(row2);

      const row3 = el("div", "ed-row");
      const lh = document.createElement("input");
      lh.type = "number";
      lh.min = "0.8";
      lh.max = "3";
      lh.step = "0.05";
      lh.value = base.lineHeight || 1.2;
      lh.addEventListener("input", () => {
        base.lineHeight = Math.min(3, Math.max(0.8, Number(lh.value) || 1.2));
        commit(base, isNew);
      });
      row3.appendChild(labeled("Spasi baris", lh, "lineHeight"));
      const ls = document.createElement("input");
      ls.type = "number";
      ls.min = "-2";
      ls.max = "8";
      ls.step = "0.1";
      ls.value = base.letterSpacing || 0;
      ls.addEventListener("input", () => {
        base.letterSpacing = Math.min(8, Math.max(-2, Number(ls.value) || 0));
        commit(base, isNew);
      });
      row3.appendChild(labeled("Spasi huruf (pt)", ls, "letterSpacing"));
      wrap.appendChild(row3);

      const acts = el("div", "ed-actions");
      if (!isNew) {
        const del = el("button", "btn btn-ghost btn-sm", "Hapus teks ini");
        del.type = "button";
        del.addEventListener("click", () => {
          const t = orig;
          removeBySrc(t.id);
          upsert({
            id: "e" + (++S.opSeq), k: "erase", srcId: t.id,
            box: { x: t.x, y: t.y, w: t.w, h: t.h },
          });
          S.sel = null;
          redraw();
        });
        acts.appendChild(del);
      }
      const rm = el("button", "btn btn-ghost btn-sm", "Hapus elemen");
      rm.type = "button";
      rm.addEventListener("click", () => {
        removeOp(base.id);
        S.sel = null;
        redraw();
      });
      acts.appendChild(rm);
      if (isNew) {
        const up = el("button", "btn btn-ghost btn-sm", "Ke depan");
        up.type = "button";
        up.addEventListener("click", () => { moveLayer(base.id, 1); });
        acts.appendChild(up);
        const down = el("button", "btn btn-ghost btn-sm", "Ke belakang");
        down.type = "button";
        down.addEventListener("click", () => { moveLayer(base.id, -1); });
        acts.appendChild(down);
      }
      wrap.appendChild(acts);
      side.appendChild(wrap);
    }

    /* Ubah urutan lapisan (urutan array = urutan gambar di atas kertas) */
    function moveLayer(id, dir) {
      const ops = pageOps().slice();
      const i = ops.findIndex((o) => o.id === id);
      if (i < 0) return;
      const j = i + dir;
      if (j < 0 || j >= ops.length) return;
      pushHistory();
      const t = ops[i];
      ops[i] = ops[j];
      ops[j] = t;
      edits()[String(S.pageNo)] = ops;
      redraw();
    }

    function imageForm(base, isNew, orig) {
      const wrap = el("div", "ed-insp");
      wrap.appendChild(el("h4", "ed-insp-title", isNew ? "Gambar baru" : "Gambar di PDF"));

      const row = el("div", "ed-row");
      const wIn = document.createElement("input");
      wIn.type = "number";
      wIn.min = "8";
      wIn.value = Math.round(base.box.w);
      wIn.addEventListener("input", () => {
        base.box.w = Math.max(8, Number(wIn.value) || base.box.w);
        commitImage(base, isNew, orig);
      });
      row.appendChild(labeled("Lebar (pt)", wIn, "width"));
      const hIn = document.createElement("input");
      hIn.type = "number";
      hIn.min = "8";
      hIn.value = Math.round(base.box.h);
      hIn.addEventListener("input", () => {
        base.box.h = Math.max(8, Number(hIn.value) || base.box.h);
        commitImage(base, isNew, orig);
      });
      row.appendChild(labeled("Tinggi (pt)", hIn, "height"));
      wrap.appendChild(row);

      const acts = el("div", "ed-actions");
      const pick = el("button", "btn btn-primary btn-sm", "Ganti gambar…");
      pick.type = "button";
      const fi = document.createElement("input");
      fi.type = "file";
      fi.accept = "image/png,image/jpeg";
      fi.hidden = true;
      fi.addEventListener("change", (e) => {
        const f = e.target.files && e.target.files[0];
        e.target.value = "";
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => {
          base.k = "image";
          base.src = reader.result;
          delete base.newItem;
          commitImage(base, isNew, orig);
        };
        reader.readAsDataURL(f);
      });
      pick.addEventListener("click", () => fi.click());
      acts.appendChild(pick);
      acts.appendChild(fi);

      if (!isNew) {
        const del = el("button", "btn btn-ghost btn-sm", "Hapus gambar ini");
        del.type = "button";
        del.addEventListener("click", () => {
          removeBySrc(base.srcId);
          upsert({
            id: "e" + (++S.opSeq), k: "erase", srcId: base.srcId,
            box: { x: base.box.x, y: base.box.y, w: base.box.w, h: base.box.h },
          });
          S.sel = null;
          redraw();
        });
        acts.appendChild(del);
      } else {
        const rm = el("button", "btn btn-ghost btn-sm", "Hapus elemen");
        rm.type = "button";
        rm.addEventListener("click", () => {
          removeOp(base.id);
          S.sel = null;
          redraw();
        });
        acts.appendChild(rm);
        const up = el("button", "btn btn-ghost btn-sm", "Ke depan");
        up.type = "button";
        up.addEventListener("click", () => { moveLayer(base.id, 1); });
        acts.appendChild(up);
        const down = el("button", "btn btn-ghost btn-sm", "Ke belakang");
        down.type = "button";
        down.addEventListener("click", () => { moveLayer(base.id, -1); });
        acts.appendChild(down);
      }
      wrap.appendChild(acts);
      side.appendChild(wrap);
    }


    function labeled(text, input, key) {
      const w = el("label", "ed-field");
      w.appendChild(el("span", "ed-label", text));
      w.appendChild(input);
      /* kunci stabil untuk pengujian otomatis */
      if (key) w.dataset.field = key;
      return w;
    }

    /* ---------- simpan perubahan ---------- */
    function upsert(op) {
      pushHistory();
      const ops = pageOps();
      const i = ops.findIndex((o) => o.id === op.id);
      if (i >= 0) ops[i] = op;
      else ops.push(op);
      edits()[String(S.pageNo)] = ops;
    }
    function removeOp(id) {
      pushHistory();
      const ops = pageOps().filter((o) => o.id !== id);
      edits()[String(S.pageNo)] = ops;
    }
    /* Hapus semua operasi yang berasal dari objek yang sama
       (mis. op teks lalu op hapus untuk blok teks itu). */
    function removeBySrc(srcId) {
      pushHistory();
      const ops = pageOps().filter((o) => o.srcId !== srcId);
      edits()[String(S.pageNo)] = ops;
    }
    /* Simpan perubahan gambar (ukuran, posisi, atau berkas baru). */
    function commitImage(base, isNew, orig) {
      if (isNew) {
        upsert(base);
        redraw();
        return;
      }
      const ops = pageOps();
      let op = ops.find((o) => o.srcId === base.srcId && o.k === "image");
      if (!op) {
        op = {
          id: "img" + base.srcId, k: "image", srcId: base.srcId,
          copyFrom: { x: base.copyFrom.x, y: base.copyFrom.y, w: base.copyFrom.w, h: base.copyFrom.h },
          box: { x: base.copyFrom.x, y: base.copyFrom.y, w: base.copyFrom.w, h: base.copyFrom.h },
        };
      }
      op.box = Object.assign({}, base.box);
      if (base.src) op.src = base.src;
      upsert(op);
      redraw();
    }

    function commit(base, isNew) {
      /* untuk teks yang sudah ada di PDF: op baru dibuat saat
         properti benar-benar diubah, supaya halaman tidak di-flop
         tanpa alasan. */
      if (!isNew && !base.srcId) return;
      const op = Object.assign({}, base);
      if (!op.id) op.id = "t" + (++S.opSeq);
      op.srcId = op.srcId || op.id;
      upsert(op);
      redraw();
    }

    /* ---------- aksi ---------- */
    function setMode(m) {
      S.mode = m;
      if (m === "image" && !S.pendingImage) {
        wrap.querySelector("[data-ed=file]").click();
      }
      redraw();
    }
    function setZoom(z) {
      S.zoom = Math.min(3, Math.max(0.4, Math.round(z * 100) / 100));
      redraw();
    }
    async function gotoPage(n) {
      if (!S.doc) return;
      const target = Math.min(S.pages, Math.max(1, n));
      if (target === S.pageNo) return;
      S.pageNo = target;
      S.sel = null;
      await loadPageBoxes();
      await redraw();
    }
    function addText(ux, uy) {
      const size = 14;
      const box = { x: ux, y: uy - size * 0.8, w: 240, h: size * 1.25 };
      const op = {
        id: "n" + (++S.opSeq), k: "text", newItem: true,
        box, by: uy, text: "Teks baru", size, font: "helvetica",
        color: "#111111", bold: false, italic: false, align: "left",
        underline: false, strike: false, lineHeight: 1.2, letterSpacing: 0,
      };
      upsert(op);
      S.sel = { kind: "text", idx: -1, opId: op.id, newItem: true };
      setMode("select");
    }
    function addImage(ux, uy) {
      const op = {
        id: "n" + (++S.opSeq), k: "image", newItem: true, src: S.pendingImage,
        box: { x: ux, y: uy - 90, w: 240, h: 180 },
      };
      upsert(op);
      S.pendingImage = null;
      S.sel = { kind: "image", idx: -1, opId: op.id, newItem: true };
      setMode("select");
    }

    /* ---------- pesan di area panggung ---------- */
    function stageMessage(text, kind) {
      const stage = wrap.querySelector(".ed-stage");
      let msg = wrap.querySelector(".ed-msg");
      if (!msg) {
        msg = el("p", "ed-msg muted small");
        stage.appendChild(msg);
      }
      msg.className = "ed-msg " + (kind === "err" ? "tool-warn" : "muted small");
      msg.textContent = text;
      msg.style.display = text ? "" : "none";
      wrap.querySelector(".ed-stack").style.display = text ? "none" : "";
    }

    /* ---------- muat file ---------- */
    async function refresh() {
      const f = file();
      if (!f) {
        S.doc = null;
        stageMessage("Pilih satu PDF untuk diedit.");
        return;
      }
      if (S.busy) return;
      S.busy = true;
      try {
        if (S.doc) { try { await S.doc.destroy(); } catch (_) {} S.doc = null; }
        S.doc = await C.openPdfjs(f.bytes);
        S.pages = S.doc.numPages;
        S.pageNo = 1;
        S.sel = null;
        edits()[String(1)] = [];
        clearHistory();
        await loadPageBoxes();
        stageMessage("");
        await redraw();
      } catch (err) {
        stageMessage(err.message || String(err), "err");
      } finally {
        S.busy = false;
      }
    }

    async function loadPageBoxes() {
      if (!S.doc) return;
      S.texts = await C.pageTextBoxes(S.doc, S.pageNo);
      S.images = await C.pageImageBoxes(S.doc, S.pageNo);
      S.texts.forEach((t, i) => { t.id = "t" + i; });
      S.images.forEach((im, i) => { im.id = "i" + i; });
    }

    ui().custom.opts.edits = edits();
    ui().custom.refreshEditor = refresh;
    ui().custom.disposeEditor = () => {
      document.removeEventListener("keydown", keyHandler);
      if (S.doc) { try { S.doc.destroy(); } catch (_) {} S.doc = null; }
      S.wrap = null;
      S.redraw = null;
      clearHistory();
    };
    refresh();
  }

  /* ============================================================
     Ekspor ke Excel (.xlsx) dan PowerPoint (.pptx)
     ------------------------------------------------------------
     Isi diambil dari state editor, sama seperti ekspor Word:
     teks yang sudah diedit, teks baru, dan gambar.
     ============================================================ */
  async function kumpulkanIsi(f) {
    const doc = await C.openPdfjs(f.bytes);
    const sheets = [];
    const slides = [];
    try {
      for (let p = 1; p <= doc.numPages; p++) {
        const isi = await kumpulkanHalaman(doc, p, edits()[String(p)] || []);
        const page = await doc.getPage(p);
        const vp = page.getViewport({ scale: 1 });
        slides.push({ wPt: vp.width, hPt: vp.height, items: isi.items });
        sheets.push({
          name: "Halaman " + p,
          rows: [["Teks", "Jenis", "Font", "Ukuran", "Tebal", "Miring", "Warna", "X (pt)", "Y (pt)", "Lebar", "Tinggi"]]
            .concat(isi.rows),
        });
      }
    } finally {
      try { await doc.destroy(); } catch (_) { /* abaikan */ }
    }
    return { sheets, slides };
  }

  function unduhBlob(blob, nama) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nama;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function exportXlsx() {
    const f = file();
    if (!f) { toast("Pilih satu PDF dulu.", "err"); return; }
    const btn = S.wrap && S.wrap.querySelector("[data-ed=xlsx]");
    if (btn) btn.disabled = true;
    toast("Menyiapkan lembar kerja Excel…");
    try {
      const { sheets } = await kumpulkanIsi(f);
      const blob = await C.buildXlsx(C.baseName(f.name), sheets);
      const nama = C.safeName(C.baseName(f.name)) + "-edit.xlsx";
      unduhBlob(blob, nama);
      toast("Berkas Excel dibuat: " + nama);
    } catch (err) {
      toast("Ekspor Excel gagal: " + ((err && err.message) || err), "err");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function exportPptx() {
    const f = file();
    if (!f) { toast("Pilih satu PDF dulu.", "err"); return; }
    const btn = S.wrap && S.wrap.querySelector("[data-ed=pptx]");
    if (btn) btn.disabled = true;
    toast("Menyiapkan presentasi PowerPoint…");
    try {
      const { slides } = await kumpulkanIsi(f);
      const blob = await C.buildPptx(C.baseName(f.name), slides);
      const nama = C.safeName(C.baseName(f.name)) + "-edit.pptx";
      unduhBlob(blob, nama);
      toast("Berkas PowerPoint dibuat: " + nama);
    } catch (err) {
      toast("Ekspor PowerPoint gagal: " + ((err && err.message) || err), "err");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* Simpan semua perubahan sebagai berkas proyek (.edit.json). */
  function saveProject() {
    const f = file();
    if (!f) { toast("Pilih satu PDF dulu.", "err"); return; }
    const data = {
      app: "pemisah-pdf",
      versi: 1,
      dibuat: new Date().toISOString(),
      sumber: { nama: f.name, ukuran: f.bytes ? f.bytes.length : 0 },
      halaman: S.pageNo,
      zoom: S.zoom,
      edits: edits(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const nama = C.safeName(C.baseName(f.name)) + ".edit.json";
    unduhBlob(blob, nama);
    toast("Proyek disimpan: " + nama);
  }

  /* ============================================================
     Kumpulkan isi satu halaman sesuai state editor.
     Dipakai bersama oleh ekspor Word, Excel, dan PowerPoint.
     Catatan: op "hapus" tidak boleh menutupi op teks/gambar —
     kalau teks digeser, salinannya tetap ikut diekspor.
     ============================================================ */
  async function kumpulkanHalaman(doc, p, ops) {
    const texts = await C.pageTextBoxes(doc, p);
    const images = await C.pageImageBoxes(doc, p);
    texts.forEach((t, i) => { t.id = "t" + i; });
    images.forEach((im, i) => { im.id = "i" + i; });
    const opText = new Map();
    const opImg = new Map();
    const dihapus = new Set();
    for (const o of ops || []) {
      if (o.k === "erase") { dihapus.add(o.srcId); continue; }
      if (o.k === "text" && o.srcId) opText.set(o.srcId, o);
      else if (o.k === "image" && o.srcId) opImg.set(o.srcId, o);
    }

    const textItems = [];
    const rows = [];
    for (const t of texts) {
      const op = opText.get(t.id);
      if (!op && dihapus.has(t.id)) continue;
      const src = op || null;
      const text = src ? (src.text != null ? src.text : t.str) : t.str;
      const size = src ? (src.size || t.size) : t.size;
      const font = src ? (src.font || "helvetica") : C.approxFont(t.fontName);
      const item = {
        type: "text", text,
        bold: src ? !!src.bold : false,
        italic: src ? !!src.italic : false,
        underline: src ? !!src.underline : false,
        strike: src ? !!src.strike : false,
        size, color: src ? src.color : "#111111",
        align: src ? src.align : "left",
        x: t.x, y: t.y, w: t.w, h: t.h,
      };
      textItems.push(item);
      rows.push([text, "Teks", font, size,
        item.bold ? "ya" : "tidak", item.italic ? "ya" : "tidak",
        item.color || "", Math.round(t.x), Math.round(t.y),
        Math.round(t.w), Math.round(t.h)]);
    }
    for (const o of ops || []) {
      if (o.k !== "text" || !o.newItem) continue;
      const item = {
        type: "text", text: o.text, bold: !!o.bold, italic: !!o.italic,
        underline: !!o.underline, strike: !!o.strike,
        size: o.size || 12, color: o.color || "#111111", align: o.align || "left",
        x: o.box.x, y: o.box.y, w: o.box.w, h: o.box.h,
      };
      textItems.push(item);
      rows.push([o.text || "", "Teks baru", o.font || "helvetica", o.size || 12,
        item.bold ? "ya" : "tidak", item.italic ? "ya" : "tidak", item.color || "",
        Math.round(o.box.x), Math.round(o.box.y), Math.round(o.box.w), Math.round(o.box.h)]);
    }

    /* gambar */
    const imgItems = [];
    for (const im of images) {
      const op = opImg.get(im.id);
      if (!op && dihapus.has(im.id)) continue;
      if (op && op.src) {
        imgItems.push({ dataUrl: op.src, src: null, box: op.box, x: op.box.x, y: op.box.y, w: op.box.w, h: op.box.h });
      } else {
        const box = op ? op.box : im;
        imgItems.push({ dataUrl: null, src: op ? op.copyFrom : im, box, x: box.x, y: box.y, w: box.w, h: box.h });
      }
    }
    for (const o of ops || []) {
      if (o.k !== "image" || !o.newItem || !o.src) continue;
      imgItems.push({ dataUrl: o.src, src: null, box: o.box, x: o.box.x, y: o.box.y, w: o.box.w, h: o.box.h });
    }
    if (imgItems.some((it) => !it.dataUrl)) {
      const scale = 2;
      const { canvas, viewport } = await C.renderPage(doc, p, scale);
      for (const it of imgItems) {
        if (it.dataUrl || !it.src) continue;
        const r = C.pdfRectToCanvas(viewport, it.src);
        const w = Math.max(1, Math.round(r.w));
        const h = Math.max(1, Math.round(r.h));
        try {
          const off = document.createElement("canvas");
          off.width = w;
          off.height = h;
          off.getContext("2d").drawImage(canvas, r.x, r.y, w, h, 0, 0, w, h);
          it.dataUrl = off.toDataURL("image/png");
        } catch (_) {
          it.dataUrl = null;
        }
      }
      canvas.width = canvas.height = 0;
    }
    const imageItems = [];
    for (const it of imgItems) {
      if (!it.dataUrl) continue;
      imageItems.push({ type: "image", dataUrl: it.dataUrl, x: it.x, y: it.y, w: it.w, h: it.h });
      rows.push(["", "Gambar", "", "", "", "", "", Math.round(it.x), Math.round(it.y), Math.round(it.w), Math.round(it.h)]);
    }

    /* urutan baca: atas ke bawah, lalu kiri ke kanan */
    const items = textItems.concat(imageItems);
    items.sort((a, b) => (b.y - a.y) || (a.x - b.x));
    return { items, rows };
  }

  /* ============================================================
     Ekspor langsung ke Word (.docx)
     ------------------------------------------------------------
     Isi dokumen dibangun dari state editor: teks yang sudah ada
     (dengan hasil edit), teks baru, dan gambar (dipotong dari
     render halaman atau diambil dari berkas yang disisipkan).
     ============================================================ */
  async function buildDocxFromState(f) {
    const doc = await C.openPdfjs(f.bytes);
    const pages = [];
    try {
      for (let p = 1; p <= doc.numPages; p++) {
        const isi = await kumpulkanHalaman(doc, p, edits()[String(p)] || []);
        pages.push({ items: isi.items, breakBefore: p > 1 });
      }
    } finally {
      try { await doc.destroy(); } catch (_) { /* abaikan */ }
    }
    return C.buildDocx(C.baseName(f.name), pages);
  }

  async function exportDocx() {
    const f = file();
    if (!f) {
      toast("Pilih satu PDF dulu.", "err");
      return;
    }
    const btn = S.wrap && S.wrap.querySelector("[data-ed=docx]");
    if (btn) btn.disabled = true;
    toast("Menyiapkan berkas Word…");
    try {
      const blob = await buildDocxFromState(f);
      const name = C.safeName(C.baseName(f.name)) + "-edit.docx";
      unduhBlob(blob, name);
      toast("Berkas Word dibuat: " + name);
    } catch (err) {
      toast("Ekspor Word gagal: " + ((err && err.message) || err), "err");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* Keadaan internal (dipakai harness audit dan debug). */
  function debug() {
    return {
      sel: S.sel,
      mode: S.mode,
      pageNo: S.pageNo,
      pages: S.pages,
      texts: S.texts.length,
      images: S.images.length,
      pendingImage: !!S.pendingImage,
      viewport: S.viewport ? {
        scale: S.viewport.scale,
        width: S.viewport.width,
        height: S.viewport.height,
        transform: S.viewport.transform,
      } : null,
      undoDepth: S.hist.past.length,
      redoDepth: S.hist.future.length,
      ops: pageOps(),
    };
  }

  window.PDFToolsEditor = {
    render, debug, undo, redo,
    exportDocx, exportXlsx, exportPptx, saveProject,
    /* batalkan seleksi (dipakai pengujian otomatis) */
    deselect: () => { S.sel = null; if (S.redraw) S.redraw(); },
  };
})();
