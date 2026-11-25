/* ============================================================
   Mesin terjemahan — tiga jalur.

   1. "bawaan" : Translator API bawaan Chrome 138+ (mesin on-device).
                Dipakai kalau model bahasa sudah ada di perangkat.
   2. "offline" : mesin Bergamot (WASM) + model bahasa yang ikut
                  disertakan di folder vendor/. Sepenuhnya offline:
                  tidak ada satu pun permintaan ke internet.
   3. "online" : mesin AI daring (tool-translate-ai.js). Konfigurasi
                  mesin diambil dari manifest di server, jadi perbaikan
                  di server ikut dipakai tanpa rilis aplikasi baru.

   Semua model bahasa disimpan terkompresi (gzip) dan dibuka di
   peramban memakai DecompressionStream, jadi repo tetap ramping
   sementara unduhan model tetap kecil.

   API: window.PDFTranslate
   ============================================================ */
(function () {
  "use strict";

  const T = {};

  /* Modul AI daring (dimuat terpisah: tool-translate-ai.js). */
  const AIM = () => window.PDFTranslateAI || null;

  /* Rantai mesin cadangan: AI daring -> bawaan peramban -> offline. */
  T.NAMA_MESIN = {
    online: "AI daring",
    builtin: "bawaan peramban",
    offline: "offline",
  };

  /* ---------- model offline yang disertakan ---------- */
  /* from -> to -> lokasi berkas model (berkas .gz dibuka saat dipakai). */
  const OFFLINE_MODELS = {
    "id>en": { dir: "models/id-en" },
    "en>id": { dir: "models/en-id" },
  };

  const VENDOR = "vendor/bergamot/";
  const MODEL_FILES = ["model.bin.gz", "lex.bin.gz", "vocab.spm.gz"];

  /* Setelan mesin Bergamot (dari config.yml model). */
  const BERGAMOT_CONFIG = {
    "beam-size": 1,
    normalize: 1.0,
    "word-penalty": 0,
    "max-length-break": 128,
    "mini-batch-words": 1024,
    workspace: 128,
    "max-length-factor": 2.0,
    "skip-cost": true,
    "cpu-threads": 0,
    "gemm-precision": "int8shiftAlphaAll",
  };

  /* Penghitung — dipakai harness audit untuk memastikan tidak ada
     pekerjaan yang diulang (model dimuat sekali, kalimat di-cache). */
  const stats = {
    modelLoads: 0,
    offlineCalls: 0,
    offlineTexts: 0,
    builtinCreates: 0,
    builtinCalls: 0,
    builtinTexts: 0,
  };
  T.stats = stats;

  const pairKey = (from, to) => from + ">" + to;

  T.offlinePairs = function () {
    return Object.keys(OFFLINE_MODELS);
  };
  T.hasOffline = function (from, to) {
    return !!OFFLINE_MODELS[pairKey(from, to)];
  };
  T.hasBuiltin = function () {
    return typeof window !== "undefined" && "Translator" in window;
  };

  /* ---- mesin AI daring (tool-translate-ai.js) ---- */

  /* Daring hanya siap kalau modulnya termuat, server manifest bisa
     dihubungi (atau pengguna menunjuk endpoint sendiri), dan ada
     minimal satu mesin yang benar-benar bisa dipakai. */
  T.hasOnline = function () {
    const ai = AIM();
    return !!(ai && typeof ai.isConfigured === "function" && ai.isConfigured());
  };

  T.onlineStatus = function () {
    const ai = AIM();
    return ai ? ai.status() : null;
  };

  T.onlineEngines = function (opts) {
    const ai = AIM();
    if (!ai) return [];
    return ai.listEngines(opts || {});
  };

  /* Perbarui manifest dari server (tombol "Perbarui dari server"). */
  T.checkUpdateAI = async function () {
    const ai = AIM();
    if (!ai) throw new Error("Modul AI daring belum termuat (tool-translate-ai.js).");
    return ai.checkUpdate();
  };

  T.loadAIManifest = function (opts) {
    const ai = AIM();
    if (!ai) return Promise.resolve(null);
    return ai.loadManifest(opts || {});
  };

  /* ============================================================
     Util: buka berkas .gz jadi ArrayBuffer
     ============================================================ */
  async function gunzip(url) {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw new Error("Berkas model tidak bisa diambil (" + res.status + "): " + url);
    if (typeof window.DecompressionStream !== "function") {
      throw new Error(
        "Peramban ini belum bisa membuka berkas terkompresi (DecompressionStream). " +
        "Gunakan Chrome 80+, Firefox 113+, atau Safari 16.4+."
      );
    }
    const stream = res.body.pipeThrough(new window.DecompressionStream("gzip"));
    const reader = stream.getReader();
    const parts = [];
    let total = 0;
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      parts.push(r.value);
      total += r.value.byteLength;
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.byteLength;
    }
    return out.buffer;
  }

  /* ============================================================
     Engine offline (Bergamot)

     Satu worker = satu model bahasa. Kalau pasangan bahasa
     diganti, worker lama DIPUTUS (memori WASM-nya benar-benar
     dilepas) lalu worker baru dibuat. Menyimpan dua model
     sekaligus bisa menghabiskan memori tab.
     ============================================================ */
  let offlineWorker = null;      /* {worker, pending, serial} */
  let offlineLoaded = null;      /* kunci pasangan yang sedang hidup */

  function ensureOfflineWorker() {
    if (offlineWorker) return offlineWorker;
    let w;
    try {
      w = new Worker(VENDOR + "translator-worker.js");
    } catch (err) {
      throw new Error(
        "Mesin terjemahan offline tidak bisa dijalankan: " +
        (err && err.message ? err.message : err)
      );
    }
    const pending = new Map();
    let serial = 0;
    w.addEventListener("message", function (ev) {
      const data = (ev && ev.data) || {};
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      if (data.error) {
        const e = new Error(data.error.message || "Gagal di mesin terjemahan offline");
        e.name = data.error.name || "Error";
        p.reject(e);
      } else {
        p.resolve(data.result);
      }
    });
    w.addEventListener("error", function (ev) {
      const msg = (ev && ev.message) || "Mesin terjemahan offline berhenti";
      for (const [, p] of pending) p.reject(new Error(msg));
      pending.clear();
    });
    offlineWorker = { worker: w, pending: pending, serial: serial };
    return offlineWorker;
  }

  function offlineCall(name, args, transfer) {
    const st = ensureOfflineWorker();
    const id = ++st.serial;
    return new Promise(function (resolve, reject) {
      st.pending.set(id, { resolve, reject });
      /* Buffer model dipindah (bukan disalin) supaya salinan di thread
         utama langsung dibebaskan setelah masuk ke worker. */
      st.worker.postMessage({ id: id, name: name, args: args }, transfer || []);
    });
  }

  /* Putuskan worker offline (memori WASM dilepas sepenuhnya). */
  async function shutdownOfflineWorker() {
    if (!offlineWorker) return;
    const st = offlineWorker;
    offlineWorker = null;
    offlineLoaded = null;
    for (const [, p] of st.pending) p.reject(new Error("Mesin terjemahan offline dihentikan"));
    st.pending.clear();
    try { st.worker.terminate(); } catch (_) { /* abaikan */ }
    /* beri waktu browser melepas memori worker */
    await new Promise(function (r) { setTimeout(r, 0); });
  }

  async function loadOfflineModel(from, to) {
    const key = pairKey(from, to);
    if (offlineLoaded === key) return;
    const spec = OFFLINE_MODELS[key];
    if (!spec) {
      throw new Error(
        "Pasangan bahasa " + from.toUpperCase() + "→" + to.toUpperCase() + " belum punya model offline."
      );
    }

    /* Model lama dilepas dulu supaya hanya satu model yang hidup
       di memori WASM pada saat model baru dimuat. */
    await shutdownOfflineWorker();

    ensureOfflineWorker();
    await offlineCall("initialize", { cacheSize: 16384 });

    const base = VENDOR + spec.dir + "/";
    const buffers = await Promise.all(MODEL_FILES.map(function (f) { return gunzip(base + f); }));
    await offlineCall(
      "loadTranslationModel",
      [
        { from: from, to: to },
        {
          model: buffers[0],
          shortlist: buffers[1],
          vocabs: [buffers[2]],
          config: BERGAMOT_CONFIG,
        },
      ],
      buffers
    );
    stats.modelLoads++;
    offlineLoaded = key;
  }

  T.offlineStatus = function () {
    return { ready: !!offlineWorker, models: offlineLoaded ? [offlineLoaded] : [] };
  };

  /* Matikan mesin offline (dipakai saat halaman ditutup). */
  T.disposeOffline = function () {
    shutdownOfflineWorker();
  };

  /* ============================================================
     Engine bawaan peramban (Chrome 138+)
     ============================================================ */

  /* Peta bahasa -> tag yang dipakai mesin. */
  const TAG_ALIAS = {
    zh: "zh-Hans",
    "zh-cn": "zh-Hans",
    "zh-tw": "zh-Hant",
  };

  function builtinTag(code) {
    const c = String(code || "").toLowerCase();
    return TAG_ALIAS[c] || c;
  }

  /* Terjemahkan galat DOM bawaan peramban jadi pesan yang bisa
     ditindaklanjuti pengguna. */
  function builtinErrorMessage(err, from, to) {
    const name = (err && err.name) || "";
    const msg = (err && err.message) || String(err || "");
    const pair = from.toUpperCase() + "→" + to.toUpperCase();
    if (name === "NotAllowedError") {
      return (
        "Chrome meminta klik pengguna untuk mengunduh paket bahasa " + pair + ". " +
        "Klik \"Proses\" sekali lagi, atau pilih mesin offline bawaan aplikasi."
      );
    }
    if (name === "NotSupportedError") {
      return (
        "Mesin bawaan peramban tidak mendukung pasangan bahasa " + pair + ". " +
        "Pilih bahasa lain, atau pilih mesin offline bawaan aplikasi."
      );
    }
    if (name === "QuotaExceededError") {
      return "Teks terlalu panjang untuk mesin bawaan peramban. Terjemahkan per bagian yang lebih kecil.";
    }
    if (name === "NetworkError") {
      return (
        "Paket bahasa untuk mesin bawaan peramban gagal diunduh (butuh internet). " +
        "Pilih mesin offline bawaan aplikasi agar tetap jalan tanpa internet."
      );
    }
    if (name === "InvalidStateError") {
      return "Mesin bawaan peramban belum siap. Coba lagi sebentar lagi, atau pilih mesin offline bawaan aplikasi.";
    }
    if (name === "AbortError") return "Terjemahan dibatalkan.";
    if (msg) return "Mesin bawaan peramban gagal: " + msg;
    return "Mesin bawaan peramban gagal tanpa keterangan.";
  }

  /* Panggil Translator.create(). Sengaja dipanggil sinkron supaya
     "user gesture" Chrome masih berlaku (wajib saat model perlu
     diunduh). Hasil dinormalkan jadi {ok, translator|error}. */
  function createBuiltin(from, to, onProgress) {
    const options = {
      sourceLanguage: builtinTag(from),
      targetLanguage: builtinTag(to),
    };
    stats.builtinCreates++;
    let p;
    try {
      p = window.Translator.create(
        Object.assign({}, options, {
          monitor: function (m) {
            if (!m || typeof m.addEventListener !== "function") return;
            m.addEventListener("downloadprogress", function (ev) {
              if (onProgress) {
                onProgress("mengunduh paket bahasa " + Math.round((ev.loaded || 0) * 100) + "%");
              }
            });
          },
        })
      );
    } catch (err) {
      p = Promise.reject(err);
    }
    return Promise.resolve(p).then(
      function (t) { return { ok: true, translator: t }; },
      function (e) { return { ok: false, error: e }; }
    );
  }

  function builtinAvailability(from, to) {
    const options = {
      sourceLanguage: builtinTag(from),
      targetLanguage: builtinTag(to),
    };
    try {
      return Promise.resolve(window.Translator.availability(options)).catch(function () { return "unavailable"; });
    } catch (_) {
      return Promise.resolve("unavailable");
    }
  }

  /* ============================================================
     Perencana mesin
     ------------------------------------------------------------
     prepare() dipanggil SECARA SINKRON dari dalam handler klik.
     Chrome mewajibkan "user gesture" ketika create() perlu
     mengunduh model bahasa; karena itu create() harus dipanggil
     sebelum ada await pertama.
     ============================================================ */
  T.prepare = function (opts) {
    const o = opts || {};
    const from = String(o.from || "id");
    const to = String(o.to || "en");
    const mode = o.mode || "auto";
    const onProgress = typeof o.onProgress === "function" ? o.onProgress : null;

    const plan = {
      from: from,
      to: to,
      mode: mode,
      onProgress: onProgress,
      kind: "none",
      createPromise: null,
      availabilityPromise: null,
      vendored: T.hasOffline(from, to),
      daring: false,
      ai: {
        engineId: String((o.ai && o.ai.engineId) || ""),
        apiKey: String((o.ai && o.ai.apiKey) || ""),
        model: String((o.ai && o.ai.model) || ""),
        endpoint: String((o.ai && o.ai.endpoint) || ""),
        glossary: String((o.ai && o.ai.glossary) || ""),
      },
      catatan: [],
    };

    /* Perbarui manifest di belakang layar: perbaikan di sisi server
       (model baru, prompt lebih baik, mesin tambahan) ikut terpakai
       tanpa perlu releasing aplikasi baru. Tidak memblokir proses. */
    const aiModul = AIM();
    if (aiModul && typeof aiModul.loadManifest === "function") {
      try {
        aiModul.loadManifest({}).catch(function () { /* diamkan: bukan galat fatal */ });
      } catch (_) { /* abaikan */ }
    }

    /* Izin kirim ke server AI daring bisa dimatikan pengguna
       (dokumen tidak boleh keluar dari perangkat). */
    const aiDiperbolehkan = o.aiAllow !== false;

    if (mode === "offline") {
      if (!plan.vendored) {
        plan.error = new Error(
          "Mesin offline bawaan aplikasi belum punya model untuk " +
          from.toUpperCase() + "→" + to.toUpperCase() + ". " +
          "Pasangan yang tersedia: " + T.offlinePairs().map((p) => p.replace(">", "→")).join(", ") + "."
        );
        return plan;
      }
      plan.kind = "offline";
      return plan;
    }

    /* Mode AI daring: hanya server terjemahan yang dipakai. */
    if (mode === "online") {
      if (!aiDiperbolehkan) {
        plan.error = new Error(
          "Izin kirim teks ke server AI daring dimatikan. Aktifkan lagi di kolom " +
          "\"Izinkan kirim teks ke server AI daring\"."
        );
        return plan;
      }
      if (!aiModul || typeof aiModul.createEngine !== "function") {
        plan.error = new Error("Modul AI daring belum termuat (tool-translate-ai.js).");
        return plan;
      }
      if (!T.hasOnline() && !plan.ai.endpoint) {
        plan.error = new Error(
          "Mesin AI daring belum siap: server mesin terjemahan tidak bisa dihubungi dan endpoint belum diisi. " +
          "Isi endpoint (+ kunci API bila perlu) di panel AI daring, atau pakai mesin bawaan peramban / offline."
        );
        return plan;
      }
      plan.kind = "online";
      return plan;
    }

    if (!T.hasBuiltin()) {
      if (plan.vendored) {
        plan.kind = "offline";
        return plan;
      }
      if (aiDiperbolehkan && aiModul) {
        plan.kind = "auto";
        plan.daring = true;
        return plan;
      }
      plan.error = new Error(
        "Peramban ini belum punya mesin terjemahan bawaan (Chrome 138+ dengan model on-device). " +
        "Aplikasi ini berjalan offline, jadi terjemahan butuh kemampuan itu. " +
        "Pasangan bahasa yang tersedia secara offline: " +
        T.offlinePairs().map((p) => p.replace(">", "→")).join(", ") + "."
      );
      return plan;
    }

    if (mode === "builtin") {
      plan.kind = "builtin";
      plan.createPromise = createBuiltin(from, to, onProgress);
      plan.availabilityPromise = builtinAvailability(from, to);
      return plan;
    }

    /* Mode otomatis.
       - Model offline sudah disertakan -> jangan sentuh mesin bawaan
         (menghindari unduhan ±40 MB yang tidak perlu).
       - Tidak ada model offline -> siapkan mesin bawaan sekarang juga
         supaya gestur klik tetap berlaku saat model perlu diunduh. */
    plan.kind = "auto";
    /* availability() murah (tidak memicu unduhan model) -> selalu
       ditanyakan supaya mesin bawaan yang SUDAH ada di perangkat tetap
       bisa dipakai. */
    plan.availabilityPromise = builtinAvailability(from, to);
    if (aiDiperbolehkan && aiModul) {
      plan.daring = true;
      /* Jangan siapkan create() mesin bawaan dulu: kalau AI daring yang
         dipakai, tidak perlu memicu unduhan model +/-40 MB. */
      if (!plan.vendored) {
        plan.createPromise = createBuiltin(from, to, onProgress);
      }
      return plan;
    }
    if (!plan.vendored) {
      plan.createPromise = createBuiltin(from, to, onProgress);
    }
    return plan;
  };

  function offlineEngine(plan) {
    return {
      kind: "offline",
      from: plan.from,
      to: plan.to,
      translateBatch: function (texts) {
        return translateOffline(plan.from, plan.to, texts, plan.onProgress);
      },
      destroy: function () { /* worker dipakai bersama; biarkan hidup */ },
    };
  }

  /* Mesin AI daring. Kalau server gagal saat dipakai, otomatis
     turun ke mesin bawaan peramban / offline supaya pekerjaan tidak
     gagal total. Catatan perpindahan mesin disimpan di plan.catatan
     supaya bisa ditampilkan ke pengguna. */
  function daringEngine(plan, bolehCadangan) {
    const ai = AIM();
    const e = ai.createEngine({
      from: plan.from,
      to: plan.to,
      engineId: plan.ai.engineId,
      apiKey: plan.ai.apiKey,
      model: plan.ai.model,
      endpoint: plan.ai.endpoint,
      glossary: plan.ai.glossary,
      onProgress: plan.onProgress,
    });
    return {
      kind: "online",
      engineId: e.engineId,
      label: e.label,
      model: e.model,
      protocol: e.protocol,
      from: plan.from,
      to: plan.to,
      manifestVersion: e.manifestVersion,
      dataSent: true,
      catatan: plan.catatan,
      async translateBatch(texts, opts) {
        try {
          return await e.translateBatch(texts, opts);
        } catch (err) {
          /* Mode "online" dipanggilTUJUAN: kalau server AI gagal, error
             harus sampai ke pengguna, bukan diam-diam memakai mesin
             lain. Cadangan hanya untuk mode otomatis. */
          if (!bolehCadangan) throw err;
          const cad = await mesinCadangan(plan);
          if (!cad) throw err;
          plan.catatan.push(
            "Mesin AI daring gagal (" + ((err && err.message) || err) + ") \u2014 memakai mesin " +
            (T.NAMA_MESIN[cad.kind] || cad.kind) + "."
          );
          return cad.translateBatch(texts, opts);
        }
      },
      destroy: function () {
        try { e.destroy(); } catch (_) { /* abaikan */ }
      },
    };
  }

  /* Mesin cadangan: bawaan peramban dulu, lalu offline. */
  async function mesinCadangan(plan) {
    if (T.hasBuiltin()) {
      try {
        const res = await (plan.createPromise || createBuiltin(plan.from, plan.to, plan.onProgress));
        if (res && res.ok) return builtinEngine(plan, res.translator);
      } catch (_) { /* lanjut ke offline */ }
    }
    if (plan.vendored) return offlineEngine(plan);
    return null;
  }

  /* Jadikan rencana jadi mesin yang siap dipakai. */
  T.create = async function (plan) {
    if (!plan || plan.error) throw (plan && plan.error) || new Error("Mesin terjemahan tidak disiapkan.");
    if (plan.kind === "offline") return offlineEngine(plan);

    if (plan.kind === "online") {
      const ai = AIM();
      if (!ai) throw new Error("Modul AI daring belum termuat (tool-translate-ai.js).");
      /* Manifest dimuat dulu supaya daftar mesin dari server pasti
         dipakai (bukan manifest bawaan). */
      try { await ai.loadManifest({}); } catch (_) { /* lanjut: pesan galat di bawah */ }
      return daringEngine(plan, false);
    }

    if (plan.kind === "builtin") {
      const res = await plan.createPromise;
      if (!res || !res.ok) {
        throw new Error(builtinErrorMessage(res && res.error, plan.from, plan.to));
      }
      return builtinEngine(plan, res.translator);
    }

    /* kind === "auto" */
    /* 1. AI daring (kalau diizinkan dan siap) */
    if (plan.daring) {
      const aiMod = AIM();
      try {
        /* Manifest dimuat dulu (pakai cache kalau ada) supaya daftar
           mesin dari server pasti dipakai. */
        if (aiMod && typeof aiMod.loadManifest === "function") await aiMod.loadManifest({});
      } catch (_) { /* lanjut: mesin lain tetap bisa dipakai */ }
      if (T.hasOnline()) {
        try {
          return daringEngine(plan, true);
        } catch (err) {
          plan.catatan.push(
            "Mesin AI daring tidak bisa disiapkan (" + ((err && err.message) || err) + ") \u2014 memakai mesin lain."
          );
        }
      }
      /* Server AI tidak tersedia -> lanjut ke mesin bawaan/offline
         tanpa pesan error (memang tidak ada yang perlu dilaporkan). */
    }
    const av =
      (await (plan.availabilityPromise || builtinAvailability(plan.from, plan.to, plan.onProgress))) ||
      "unavailable";

    if (av === "available") {
      /* Model sudah ada di perangkat -> paling cepat, tanpa unduhan. */
      const res = await (plan.createPromise || createBuiltin(plan.from, plan.to, plan.onProgress));
      if (res && res.ok) return builtinEngine(plan, res.translator);
      if (!plan.vendored) {
        throw new Error(builtinErrorMessage(res && res.error, plan.from, plan.to));
      }
      return offlineEngine(plan);
    }

    if (av === "downloadable" || av === "downloading") {
      if (plan.vendored) {
        /* Ada model offline: pakai itu, jangan unduh ±40 MB. */
        if (plan.createPromise) {
          plan.createPromise.then(function (res) {
            if (res && res.ok && res.translator && typeof res.translator.destroy === "function") {
              try { res.translator.destroy(); } catch (_) { /* abaikan */ }
            }
          });
        }
        return offlineEngine(plan);
      }
      const res = await (plan.createPromise || createBuiltin(plan.from, plan.to, plan.onProgress));
      if (!res || !res.ok) {
        throw new Error(builtinErrorMessage(res && res.error, plan.from, plan.to));
      }
      return builtinEngine(plan, res.translator);
    }

    /* av === "unavailable" */
    if (plan.vendored) return offlineEngine(plan);
    throw new Error(
      "Mesin bawaan peramban tidak mendukung pasangan " +
      plan.from.toUpperCase() + "→" + plan.to.toUpperCase() + ". " +
      "Pasangan bahasa yang tersedia secara offline: " +
      T.offlinePairs().map((p) => p.replace(">", "→")).join(", ") + "."
    );
  };

  /* ============================================================
     Terjemahan lewat mesin bawaan peramban
     ============================================================ */
  function builtinEngine(plan, translator) {
    return {
      kind: "builtin",
      from: plan.from,
      to: plan.to,
      translateBatch: function (texts) {
        return translateBuiltin(translator, texts, plan.onProgress);
      },
      destroy: function () {
        if (translator && typeof translator.destroy === "function") {
          try { translator.destroy(); } catch (_) { /* abaikan */ }
        }
      },
    };
  }

  /* Terjemahkan banyak potongan sekaligus.
     Mesin bawaan peramban bekerja per-potongan, jadi beberapa
     potongan dikirim bersamaan dengan batas konkurensi. */
  async function translateBuiltin(translator, texts, onProgress) {
    const list = texts || [];
    if (!list.length) return [];
    const results = new Array(list.length);
    const LIMIT = 4;
    let cursor = 0;
    let done = 0;
    stats.builtinCalls++;
    stats.builtinTexts += list.length;
    async function worker() {
      for (;;) {
        const i = cursor++;
        if (i >= list.length) return;
        const r = await translator.translate(list[i]);
        results[i] = String(r == null ? "" : r);
        done++;
        if (onProgress) onProgress("menerjemahkan " + done + "/" + list.length);
      }
    }
    const workers = [];
    for (let i = 0; i < Math.min(LIMIT, list.length); i++) workers.push(worker());
    await Promise.all(workers);
    return results;
  }

  /* ============================================================
     Terjemahan lewat mesin offline (Bergamot)
     ============================================================ */
  async function translateOffline(from, to, texts, onProgress) {
    const list = texts || [];
    if (!list.length) return [];
    if (offlineLoaded !== pairKey(from, to)) {
      if (onProgress) onProgress("menyiapkan model bahasa");
      await loadOfflineModel(from, to);
    }
    if (onProgress) onProgress("menerjemahkan " + list.length + " baris");
    stats.offlineCalls++;
    stats.offlineTexts += list.length;
    const out = await offlineCall("translate", [
      {
        models: [{ from: from, to: to }],
        texts: list.map(function (t) { return { text: t, html: false }; }),
      },
    ]);
    return (out || []).map(function (r) {
      return r && r.target ? String(r.target.text || "") : "";
    });
  }

  /* ============================================================
     Cache kalimat (LRU) — header & footer yang sama di tiap
     halaman tidak diterjemahkan dua kali.
     ============================================================ */
  const CACHE_MAX = 4000;
  const cache = new Map();

  T.cacheGet = function (key) {
    if (!cache.has(key)) return undefined;
    const v = cache.get(key);
    cache.delete(key);
    cache.set(key, v);
    return v;
  };
  T.cacheSet = function (key, val) {
    if (cache.has(key)) cache.delete(key);
    cache.set(key, val);
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  };
  T.cacheClear = function () {
    cache.clear();
  };

  /* Kunci cache kalimat WAJIB memuat identitas mesin. Kalau tidak,
     hasil terjemahan mesin lama (mis. offline) akan dipakai ulang
     setelah pengguna berganti ke mesin AI daring — hasil yang salah
     tapi tampak "berhasil". */
  T.cachePrefix = function (engine, from, to) {
    const id = engine
      ? String(engine.kind) +
        (engine.engineId ? ":" + engine.engineId : "") +
        (engine.model ? ":" + engine.model : "")
      : "unknown";
    return id + "|" + String(from) + ">" + String(to) + "\u0000";
  };
  T.cacheKey = function (engine, from, to, text) {
    return T.cachePrefix(engine, from, to) + String(text == null ? "" : text);
  };

  /* Teks yang tidak perlu diterjemahkan (angka, kode, URL, email).
     Wajib juga untuk mesin offline: angka seperti
     "Rp 1.500.000" atau "2024" tidak boleh dirusak. */
  T.layakTerjemahkan = function (t) {
    const ai = AIM();
    if (ai && typeof ai.layakTerjemahkan === "function") return ai.layakTerjemahkan(t);
    const s = String(t == null ? "" : t).trim();
    if (!s) return false;
    if (s.length <= 1) return false;
    if (/^https?:\/\//i.test(s)) return false;
    if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(s)) return false;
    if (/^[\d\s.,:;%/()\-+#*]+$/.test(s)) return false;
    if (/^[A-Z]{2,6}[-_]?\d{1,8}$/i.test(s)) return false;
    return true;
  };
  T.cacheSize = function () {
    return cache.size;
  };

  /* Worker offline dilepas saat halaman ditutup supaya memori
     WASM tidak tetap tertahan. */
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("pagehide", function () {
      try { T.disposeOffline(); } catch (_) { /* abaikan */ }
    });
  }

  window.PDFTranslate = T;
})();
