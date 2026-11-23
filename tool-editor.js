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
        <button type="button" class="btn btn-ghost btn-sm" data-ed="reset">Batalkan semua perubahan</button>
      </div>
      <div class="ed-main">
        <div class="ed-stage"><div class="ed-stack">
          <canvas class="ed-canvas"></canvas>
          <div class="ed-layer"></div>
        </div></div>
        <aside class="ed-side"></aside>
      </div>`;
    host.appendChild(wrap);

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
        edits()[String(S.pageNo)] = [];
        S.sel = null;
        redraw();
        toast("Perubahan pada halaman ini dibatalkan.");
      }
    });

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

    async function redrawInner() {
      const { canvas: cv, ctx, viewport } = await C.renderPage(S.doc, S.pageNo, S.zoom);
      lastViewport = viewport;
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
        /* teks yang sudah ada tidak bisa digeser (font aslinya akan hilang) */
        return;
      }
      if (!op) return;
      e.preventDefault();
      e.stopPropagation();
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

    function textForm(base, isNew, orig) {
      const wrap = el("div", "ed-insp");
      wrap.appendChild(el("h4", "ed-insp-title", isNew ? "Teks baru" : "Teks di PDF"));

      const ta = document.createElement("textarea");
      ta.rows = 3;
      ta.value = base.text || "";
      ta.addEventListener("input", () => { base.text = ta.value; commit(base, isNew); });
      wrap.appendChild(labeled("Isi teks", ta));

      const selFont = document.createElement("select");
      for (const f of C.FONT_LIST) {
        const o = document.createElement("option");
        o.value = f.id;
        o.textContent = f.label;
        selFont.appendChild(o);
      }
      selFont.value = base.font || "helvetica";
      selFont.addEventListener("change", () => { base.font = selFont.value; commit(base, isNew); });
      wrap.appendChild(labeled("Font", selFont));

      const row = el("div", "ed-row");
      const size = document.createElement("input");
      size.type = "number";
      size.min = "4";
      size.max = "200";
      size.value = base.size || 12;
      size.addEventListener("input", () => { base.size = Number(size.value) || 12; commit(base, isNew); });
      row.appendChild(labeled("Ukuran (pt)", size));

      const color = document.createElement("input");
      color.type = "color";
      color.value = /^#[0-9a-f]{6}$/i.test(base.color || "") ? base.color : "#111111";
      color.addEventListener("input", () => { base.color = color.value; commit(base, isNew); });
      row.appendChild(labeled("Warna", color));
      wrap.appendChild(row);

      const row2 = el("div", "ed-row");
      const bold = document.createElement("input");
      bold.type = "checkbox";
      bold.checked = !!base.bold;
      bold.addEventListener("change", () => { base.bold = bold.checked; commit(base, isNew); });
      row2.appendChild(labeled("Tebal", bold));
      const italic = document.createElement("input");
      italic.type = "checkbox";
      italic.checked = !!base.italic;
      italic.addEventListener("change", () => { base.italic = italic.checked; commit(base, isNew); });
      row2.appendChild(labeled("Miring", italic));
      const align = document.createElement("select");
      for (const [v, l] of [["left", "Kiri"], ["center", "Tengah"], ["right", "Kanan"]]) {
        const o = document.createElement("option");
        o.value = v; o.textContent = l;
        align.appendChild(o);
      }
      align.value = base.align || "left";
      align.addEventListener("change", () => { base.align = align.value; commit(base, isNew); });
      row2.appendChild(labeled("Rata", align));
      wrap.appendChild(row2);

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
      wrap.appendChild(acts);
      side.appendChild(wrap);
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
      row.appendChild(labeled("Lebar (pt)", wIn));
      const hIn = document.createElement("input");
      hIn.type = "number";
      hIn.min = "8";
      hIn.value = Math.round(base.box.h);
      hIn.addEventListener("input", () => {
        base.box.h = Math.max(8, Number(hIn.value) || base.box.h);
        commitImage(base, isNew, orig);
      });
      row.appendChild(labeled("Tinggi (pt)", hIn));
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
      }
      wrap.appendChild(acts);
      side.appendChild(wrap);
    }


    function labeled(text, input) {
      const w = el("label", "ed-field");
      w.appendChild(el("span", "ed-label", text));
      w.appendChild(input);
      return w;
    }

    /* ---------- simpan perubahan ---------- */
    function upsert(op) {
      const ops = pageOps();
      const i = ops.findIndex((o) => o.id === op.id);
      if (i >= 0) ops[i] = op;
      else ops.push(op);
      edits()[String(S.pageNo)] = ops;
    }
    function removeOp(id) {
      const ops = pageOps().filter((o) => o.id !== id);
      edits()[String(S.pageNo)] = ops;
    }
    /* Hapus semua operasi yang berasal dari objek yang sama
       (mis. op teks lalu op hapus untuk blok teks itu). */
    function removeBySrc(srcId) {
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
      if (S.doc) { try { S.doc.destroy(); } catch (_) {} S.doc = null; }
    };
    refresh();
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
      ops: pageOps(),
    };
  }

  window.PDFToolsEditor = { render, debug };
})();
