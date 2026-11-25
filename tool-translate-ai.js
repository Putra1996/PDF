/* ============================================================
   Mesin terjemahan AI DARING + manifest server.

   Fitur ini menambah mesin ketiga (di samping mesin bawaan
   peramban dan mesin offline Bergamot):

     "online" : server terjemahan daring. Konfigurasi mesin
                (endpoint, model, protocol, prompt) diambil dari
                MANIFEST yang diunduh dari server. Karena itu
                perbaikan di sisi server (model lebih baru, prompt
                lebih baik, endpoint baru, mesin tambahan) langsung
                ikut dipakai aplikasi TANPA perlu rilis aplikasi
                baru — manifest diunduh ulang (dengan validasi
                ulang) setiap kali fitur Terjemah dipakai.

   Manifest bawaan (ai/translate-engine.json) dipakai sebagai
   cadangan kalau server tidak bisa dihubungi, jadi fitur ini
   tetap punya jalur yang bisa diuji offline.

   Protokol yang didukung:
     - openai         : POST /v1/chat/completions (OpenAI-compatible)
     - mymemory       : GET  ?q=..&langpair=..
     - libretranslate : POST /translate
     - custom         : POST {from,to,texts:[..]} -> {translations:[..]}

   Prinsip:
     - kunci API TIDAK PERNAH ikut muncul di pesan galat atau log;
     - teks dokumen hanya dikirim ke server yang memang dipilih
       pengguna (lihat panel "AI daring");
     - kalau server gagal, mesin lain (bawaan peramban / offline)
       tetap bisa dipakai sebagai cadangan.

   API: window.PDFTranslateAI
   ============================================================ */
(function () {
  "use strict";

  const AI = {};

  /* Kunci penyimpanan lokal (config + cache manifest). */
  const STORAGE_KEY = "pdf-terjemah-ai-v1";
  /* Umur cache manifest: setelah ini manifest diunduh ulang. */
  const TTL_MS = 15 * 60 * 1000;
  /* Manifest cadangan terakhir (dipakai kalau server & berkas lokal gagal). */
  const MANIFEST_BAWAAN = {
    version: "bawaan-1",
    updatedAt: "",
    engines: [
      {
        id: "llm",
        label: "AI LLM (OpenAI-compatible)",
        protocol: "openai",
        endpoint: "https://api.openai.com/v1/chat/completions",
        model: "gpt-4o-mini",
        priority: 100,
        requiresKey: true,
        maxItems: 40,
        maxChars: 6000,
        pairs: "all",
      },
      {
        id: "mymemory",
        label: "MyMemory daring (gratis, tanpa kunci)",
        protocol: "mymemory",
        endpoint: "https://api.mymemory.translated.net/get",
        priority: 60,
        requiresKey: false,
        maxItems: 8,
        maxChars: 460,
        pairs: "all",
      },
    ],
    prompt: {
      system:
        "Anda adalah penerjemah profesional dan teliti. Terjemahkan teks dari {from} ke {to} " +
        "secara natural, akurat, dan mengalir. Pertahankan nama diri, angka, dan kode. " +
        "Balas HANYA dengan larik JSON berisi satu string per baris masukan, urutan sama.",
      user:
        "Terjemahkan baris-baris berikut dari {from} ke {to}.\n\n{glossary}\n\nBaris:\n{items}\n\n" +
        "Balas hanya larik JSON berisi {n} string (satu per baris, urutan sama).",
    },
    defaults: { timeoutMs: 25000, retries: 2, concurrency: 3, temperature: 0.15 },
  };

  /* Manifest yang dipakai kalau pengguna menunjuk server sendiri. */
  const URL_MANIFEST_DEFAULT =
    "https://raw.githubusercontent.com/Putra1996/PDF/main/ai/translate-engine.json";
  const URL_MANIFEST_LOKAL = "ai/translate-engine.json";

  /* Nama bahasa (dipakai di prompt agar model lebih paham). */
  const NAMA_BAHASA = {
    id: "Bahasa Indonesia", en: "English", ja: "Japanese", de: "German", fr: "French",
    es: "Spanish", zh: "Chinese", ko: "Korean", it: "Italian", pt: "Portuguese",
    nl: "Dutch", ru: "Russian", ar: "Arabic", hi: "Hindi", th: "Thai", vi: "Vietnamese",
  };

  /* Penghitung — dipakai harness audit. */
  const stats = {
    manifestLoads: 0,
    manifestUpdates: 0,
    manifestErrors: 0,
    onlineCalls: 0,
    onlineTexts: 0,
    onlineRequests: 0,
    onlineErrors: 0,
    onlineRetries: 0,
  };
  AI.stats = stats;

  /* ============================================================
     Penyimpanan lokal (config + cache manifest)
     ============================================================ */
  function bacaSimpanan() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const o = JSON.parse(raw);
      return o && typeof o === "object" ? o : {};
    } catch (_) {
      return {};
    }
  }

  function tulisSimpanan(o) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(o));
      return true;
    } catch (_) {
      return false;
    }
  }

  /* Config yang diisi pengguna: endpoint, model, kunci, dsb. */
  function config() {
    const s = bacaSimpanan();
    const c = s.config && typeof s.config === "object" ? s.config : {};
    return {
      endpoint: String(c.endpoint || ""),
      apiKey: String(c.apiKey || ""),
      model: String(c.model || ""),
      engineId: String(c.engineId || ""),
      manifestUrl: String(c.manifestUrl || ""),
      glossary: String(c.glossary || ""),
    };
  }

  AI.config = config;

  AI.configure = function (cfg) {
    const s = bacaSimpanan();
    const c = Object.assign({}, s.config || {});
    for (const k of ["endpoint", "apiKey", "model", "engineId", "manifestUrl", "glossary"]) {
      if (cfg && Object.prototype.hasOwnProperty.call(cfg, k)) {
        c[k] = cfg[k] == null ? "" : String(cfg[k]);
      }
    }
    s.config = c;
    tulisSimpanan(s);
    return config();
  };

  AI.resetConfig = function () {
    const s = bacaSimpanan();
    delete s.config;
    tulisSimpanan(s);
    return config();
  };

  /* ============================================================
     Manifest
     ============================================================ */
  function normalisasiManifest(raw, asal) {
    const m = raw && typeof raw === "object" ? raw : {};
    const def = Object.assign({}, MANIFEST_BAWAAN.defaults, m.defaults || {});
    const mesin = Array.isArray(m.engines) ? m.engines.filter((e) => e && e.id && e.protocol) : [];
    const prompt = Object.assign({}, MANIFEST_BAWAAN.prompt, m.prompt || {});
    return {
      version: String(m.version || "0"),
      updatedAt: String(m.updatedAt || ""),
      catatan: String(m.catatan || ""),
      engines: mesin.map((e) =>
        Object.assign(
          {
            label: e.id,
            priority: 50,
            requiresKey: false,
            maxItems: 20,
            maxChars: 2000,
            pairs: "all",
            endpoint: "",
            model: "",
          },
          e
        )
      ),
      prompt: prompt,
      defaults: def,
      asal: asal,
    };
  }

  let manifestAktif = null;
  let statusAktif = {
    sumber: "belum",
    version: "",
    remoteOk: false,
    cek: 0,
    galat: "",
    berubah: false,
  };

  /* Unduh manifest dari server (atau berkas lokal sebagai cadangan).
     force = true -> selaluvalidasi ulang ke server (tombol
     "Perbarui dari server" / pemeriksaan pembaruan). */
  AI.loadManifest = async function (opts) {
    const o = opts || {};
    const cfg = config();
    const url = cfg.manifestUrl || URL_MANIFEST_DEFAULT;
    const s = bacaSimpanan();
    const cache = s.manifest && typeof s.manifest === "object" ? s.manifest : null;
    const sekarang = Date.now();

    /* Cache masih segar -> pakai (tanpa jaringan). */
    if (cache && !o.force && sekarang - (cache.fetchedAt || 0) < TTL_MS) {
      manifestAktif = normalisasiManifest(cache.body, cache.asal || "cache");
      statusAktif = {
        sumber: cache.asal || "cache",
        version: manifestAktif.version,
        remoteOk: !!cache.remoteOk,
        cek: cache.fetchedAt || 0,
        galat: "",
        berubah: false,
      };
      return manifestAktif;
    }

    /* Validasi ulang ke server. */
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), Math.max(2000, o.timeoutMs || 6000));
    try {
      const headers = {};
      if (cache && cache.etag && cache.url === url) headers["If-None-Match"] = cache.etag;
      const res = await fetch(url, {
        method: "GET",
        headers: headers,
        cache: "no-cache",
        signal: ctrl.signal,
        credentials: "omit",
      });
      if (res.status === 304 && cache) {
        const body = Object.assign({}, cache, { fetchedAt: sekarang });
        s.manifest = body;
        tulisSimpanan(s);
        manifestAktif = normalisasiManifest(body.body, body.asal || "server");
        statusAktif = {
          sumber: body.asal || "server",
          version: manifestAktif.version,
          remoteOk: true,
          cek: sekarang,
          galat: "",
          berubah: false,
        };
        return manifestAktif;
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      const body = await res.json();
      const norm = normalisasiManifest(body, "server");
      const etag = res.headers.get("etag") || "";
      const versiBaru = cache && cache.body && cache.body.version;
      const berubah = !!(versiBaru && versiBaru !== norm.version);
      if (berubah) stats.manifestUpdates++;
      s.manifest = {
        url: url,
        etag: etag,
        body: body,
        fetchedAt: sekarang,
        asal: "server",
        remoteOk: true,
      };
      tulisSimpanan(s);
      manifestAktif = norm;
      statusAktif = {
        sumber: "server",
        version: norm.version,
        remoteOk: true,
        cek: sekarang,
        galat: "",
        berubah: berubah,
      };
      stats.manifestLoads++;
      return norm;
    } catch (err) {
      stats.manifestErrors++;
      /* Gagal: pakai cache lama kalau ada. */
      if (cache && cache.body) {
        manifestAktif = normalisasiManifest(cache.body, cache.asal || "cache");
        statusAktif = {
          sumber: cache.asal || "cache",
          version: manifestAktif.version,
          remoteOk: false,
          cek: cache.fetchedAt || 0,
          galat: "Server manifest tidak bisa dihubungi (" + (err && err.message ? err.message : "galat") + ").",
          berubah: false,
        };
        return manifestAktif;
      }
      /* Cadangan: berkas lokal di repo. */
      try {
        const r2 = await fetch(URL_MANIFEST_LOKAL, { credentials: "same-origin" });
        if (r2.ok) {
          const body = await r2.json();
          const norm = normalisasiManifest(body, "lokal");
          s.manifest = { url: URL_MANIFEST_LOKAL, etag: "", body: body, fetchedAt: sekarang, asal: "lokal", remoteOk: false };
          tulisSimpanan(s);
          manifestAktif = norm;
          statusAktif = {
            sumber: "lokal",
            version: norm.version,
            remoteOk: false,
            cek: sekarang,
            galat: "Server manifest tidak bisa dihubungi; memakai manifest bawaan di berkas.",
            berubah: false,
          };
          stats.manifestLoads++;
          return norm;
        }
      } catch (_) { /* abaikan */ }
      /* Cadangan terakhir: manifest bawaan di dalam berkas JS. */
      manifestAktif = normalisasiManifest(MANIFEST_BAWAAN, "bawaan");
      statusAktif = {
        sumber: "bawaan",
        version: manifestAktif.version,
        remoteOk: false,
        cek: sekarang,
        galat: "Server manifest tidak bisa dihubungi; memakai manifest bawaan aplikasi.",
        berubah: false,
      };
      return manifestAktif;
    } finally {
      clearTimeout(t);
    }
  };

  AI.manifest = function () {
    return manifestAktif;
  };

  AI.status = function () {
    return Object.assign({}, statusAktif, {
      config: config(),
      engines: manifestAktif ? manifestAktif.engines.map((e) => e.id) : [],
    });
  };

  /* Periksa apakah server punya versi manifest yang lebih baru.
     Sengaja memakai cache last-seen supaya "diperbarui" terdeteksi. */
  AI.checkUpdate = async function () {
    const sebelum = manifestAktif ? manifestAktif.version : "";
    const m = await AI.loadManifest({ force: true });
    return {
      berubah: !!(sebelum && m.version !== sebelum),
      version: m.version,
      sebelumnya: sebelum,
      sumber: statusAktif.sumber,
      catatan: m.catatan || "",
      mesin: m.engines.map((e) => ({ id: e.id, label: e.label, protocol: e.protocol, model: e.model || "" })),
    };
  };

  /* ============================================================
     Pemilihan mesin
     ============================================================ */
  const PROTOKOL = { openai: 1, mymemory: 1, libretranslate: 1, custom: 1 };

  function pasanganBisa(e, from, to) {
    const p = e.pairs;
    if (!p || p === "all" || p === "*") return true;
    if (Array.isArray(p)) {
      return p.indexOf(from + ">" + to) >= 0 || p.indexOf("all") >= 0;
    }
    return true;
  }

  /* Daftar mesin yang bisa dipakai sekarang (dengan alasan kalau tidak). */
  AI.listEngines = function (opts) {
    const o = opts || {};
    const m = manifestAktif || normalisasiManifest(MANIFEST_BAWAAN, "bawaan");
    const cfg = config();
    const from = String(o.from || "id");
    const to = String(o.to || "en");
    return m.engines
      .slice()
      .sort((a, b) => (b.priority || 0) - (a.priority || 0))
      .map((e) => {
        const descriptor = Object.assign({}, e);
        if (cfg.endpoint) {
          descriptor.endpoint = cfg.endpoint;
          descriptor.override = true;
        }
        if (cfg.model) descriptor.model = cfg.model;
        const alasan = [];
        if (!PROTOKOL[e.protocol]) alasan.push("protokol tidak didukung");
        if (!descriptor.endpoint) alasan.push("endpoint belum diisi");
        if (e.requiresKey && !cfg.apiKey) alasan.push("butuh kunci API");
        if (!pasanganBisa(e, from, to)) alasan.push("pasangan bahasa tidak didukung");
        descriptor.siap = alasan.length === 0;
        descriptor.alasan = alasan.join("; ");
        return descriptor;
      });
  };

  AI.pickEngine = function (opts) {
    const o = opts || {};
    const daftar = AI.listEngines(o);
    if (o.engineId) {
      const e = daftar.find((x) => x.id === o.engineId);
      if (!e) throw new Error("Mesin AI \"" + o.engineId + "\" tidak ada di manifest server.");
      if (!e.siap) throw new Error("Mesin AI \"" + e.label + "\" belum bisa dipakai: " + e.alasan + ".");
      return e;
    }
    const e = daftar.find((x) => x.siap);
    if (!e) {
      const alasan = daftar.map((x) => x.label + " (" + (x.alasan || "tidak siap") + ")").join("; ");
      throw new Error(
        "Tidak ada mesin AI daring yang siap dipakai. Siapkan salah satu: " + (alasan || "—") + "."
      );
    }
    return e;
  };

  /* Daring hanya aktif kalau server manifest bisa dihubungi atau
     pengguna menunjuk endpoint sendiri. Ini menjaga Privasi:
     dokumen tidak diam-diam terkirim ke pihak ketiga. */
  AI.isConfigured = function () {
    const cfg = config();
    if (cfg.endpoint) return true;
    if (!statusAktif.remoteOk) return false;
    return AI.listEngines().some((e) => e.siap);
  };

  /* ============================================================
     Util
     ============================================================ */
  function galatAI(message, kode) {
    const e = new Error(message);
    e.name = "GalatAI";
    e.kode = kode || "ai_error";
    return e;
  }
  AI.galatAI = galatAI;

  /* Teks yang tidak perlu diterjemahkan: angka, kode, URL, email. */
  AI.layakTerjemahkan = function (t) {
    const s = String(t == null ? "" : t).trim();
    if (!s) return false;
    if (s.length <= 1) return false;
    if (/^https?:\/\//i.test(s)) return false;
    if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(s)) return false;
    if (/^[\d\s.,:;%/()\-+–—#*]+$/.test(s)) return false;
    if (/^[A-Z]{2,6}[-_]?\d{1,8}$/i.test(s)) return false;
    if (/^[·•\-–—_*#\s]+$/.test(s)) return false;
    return true;
  };

  function namaBahasa(kode) {
    return NAMA_BAHASA[String(kode || "").toLowerCase()] || String(kode || "").toUpperCase();
  }

  function jeda(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /* Ambil JSON dengan batas waktu + percobaan ulang + pesan galat
     yang jelas. Kunci API tidak pernah ikut di pesan. */
  async function ambilJSON(url, opsi) {
    const o = opsi || {};
    const tries = Math.max(1, (o.retries == null ? 2 : o.retries) + 1);
    const timeout = Math.max(2000, o.timeoutMs || 25000);
    let terakhir = null;
    for (let attempt = 0; attempt < tries; attempt++) {
      if (attempt > 0) {
        stats.onlineRetries++;
        await jeda(Math.min(4000, 400 * Math.pow(2, attempt - 1)));
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      try {
        const res = await fetch(url, o.init || { credentials: "omit" });
        clearTimeout(timer);
        if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
          terakhir = galatAI(
            "Server AI sedang sibuk (HTTP " + res.status + "). Permintaan diulang otomatis.",
            "ai_http_" + res.status
          );
          continue;
        }
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            throw galatAI(
              "Server AI menolak kunci API (HTTP " + res.status + "). Periksa kunci API atau endpoint Anda.",
              "ai_auth"
            );
          }
          if (res.status === 404) {
            throw galatAI("Endpoint server AI tidak ditemukan (HTTP 404): " + o.labelEndpoint + ".", "ai_404");
          }
          if (res.status === 400) {
            throw galatAI(
              "Server AI menolak permintaan (HTTP 400). Cek model, kunci API, dan format bahasa.",
              "ai_bad_request"
            );
          }
          throw galatAI("Server AI menjawab HTTP " + res.status + ".", "ai_http_" + res.status);
        }
        const teks = await res.text();
        try {
          return JSON.parse(teks);
        } catch (_) {
          throw galatAI("Balasan server AI bukan JSON yang valid.", "ai_bad_json");
        }
      } catch (err) {
        clearTimeout(timer);
        if (err && err.name === "GalatAI") throw err; /* galat fatal -> langsung naik */
        if (err && err.name === "AbortError") {
          terakhir = galatAI(
            "Server AI tidak menjawab dalam " + Math.round(timeout / 1000) + " detik.",
            "ai_timeout"
          );
          continue;
        }
        terakhir = galatAI(
          "Tidak bisa menghubungi server AI. Periksa koneksi internet dan alamat endpoint.",
          "ai_network"
        );
      }
    }
    throw terakhir || galatAI("Server AI tidak bisa dihubungi.", "ai_network");
  }

  /* ============================================================
     Protokol: openai (OpenAI-compatible)
     ============================================================ */
  function isiTemplat(tpl, vars) {
    return String(tpl || "").replace(/\{(\w+)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m;
    });
  }

  function glosariumTeks(glosarium) {
    const gl = String(glosarium || "").trim() || String(config().glossary || "");
    const lines = gl
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 100);
    if (!lines.length) return "";
    return "Glosarium (WAJIB dipakai persis):\n" + lines.map((l) => "- " + l).join("\n");
  }

  /* Urai balasan model menjadi larik terjemahan. */
  function uraiBalisan(content, jumlah, asli) {
    let s = String(content == null ? "" : content).trim();
    s = s.replace(/^```(?:json|JSON)?\s*/i, "").replace(/```\s*$/i, "").trim();
    let arr = null;
    const m = s.match(/\[[\s\S]*\]/);
    if (m) {
      try { arr = JSON.parse(m[0]); } catch (_) { arr = null; }
    }
    if (!arr && s.charAt(0) === "{") {
      try {
        const o = JSON.parse(s);
        if (Array.isArray(o.translations)) arr = o.translations;
        else if (Array.isArray(o.result)) arr = o.result;
        else if (Array.isArray(o.output)) arr = o.output;
      } catch (_) { arr = null; }
    }
    if (!arr) {
      /* Fallback: satu baris per item. */
      arr = s
        .split(/\r?\n/)
        .map((x) => x.replace(/^\s*(?:[-*]|\d+[.)\]])\s*/, "").trim())
        .filter((x) => x.length > 0);
    }
    if (!Array.isArray(arr)) arr = [];
    const out = [];
    for (let i = 0; i < jumlah; i++) {
      const v = arr[i];
      out.push(typeof v === "string" && v.length ? v : String(asli[i] == null ? "" : asli[i]));
    }
    return out;
  }

  async function mintaOpenAI(mesin, from, to, batch, opsi) {
    const cfg = config();
    const m = manifestAktif || normalisasiManifest(MANIFEST_BAWAAN, "bawaan");
    const p = m.prompt || MANIFEST_BAWAAN.prompt;
    const items = batch.map((t, i) => (i + 1) + ". " + t).join("\n");
    const vars = {
      from: namaBahasa(from),
      to: namaBahasa(to),
      fromCode: from,
      toCode: to,
      glossary: glosariumTeks(opsi && opsi.glosarium) || "(tidak ada)",
      items: items,
      n: batch.length,
    };
    const headers = { "Content-Type": "application/json" };
    const key = (opsi && opsi.apiKey) || cfg.apiKey;
    if (key) headers.Authorization = "Bearer " + key;
    const body = {
      model: (opsi && opsi.model) || mesin.model || "gpt-4o-mini",
      temperature: (m.defaults && m.defaults.temperature) || 0.15,
      messages: [
        { role: "system", content: isiTemplat(p.system, vars) },
        { role: "user", content: isiTemplat(p.user, vars) },
      ],
    };
    const json = await ambilJSON(mesin.endpoint, {
      init: { method: "POST", headers: headers, body: JSON.stringify(body), credentials: "omit" },
      timeoutMs: (m.defaults && m.defaults.timeoutMs) || 25000,
      retries: m.defaults && m.defaults.retries != null ? m.defaults.retries : 2,
      labelEndpoint: mesin.endpoint,
    });
    const content =
      (json && json.choices && json.choices[0] && json.choices[0].message &&
        json.choices[0].message.content) ||
      (json && json.output_text) ||
      "";
    return uraiBalisan(content, batch.length, batch);
  }

  /* ============================================================
     Protokol: mymemory
     ============================================================ */
  async function mintaMyMemory(mesin, from, to, teks, opsi) {
    const url =
      mesin.endpoint +
      (mesin.endpoint.indexOf("?") >= 0 ? "&" : "?") +
      "q=" + encodeURIComponent(teks) +
      "&langpair=" + encodeURIComponent(from + "|" + to) +
      "&mt=1";
    const json = await ambilJSON(url, {
      timeoutMs: (manifestAktif && manifestAktif.defaults && manifestAktif.defaults.timeoutMs) || 25000,
      retries: manifestAktif && manifestAktif.defaults ? manifestAktif.defaults.retries : 2,
      labelEndpoint: mesin.endpoint,
    });
    const data = json && json.responseData;
    if (!data || !data.translatedText) {
      const status = json && json.responseStatus;
      const ket = json && json.responseDetails;
      if (status && Number(status) >= 400) {
        throw galatAI(
          "Server terjemahan menolak permintaan (HTTP " + status + ")" + (ket ? ": " + ket : "."),
          "ai_http_" + status
        );
      }
      throw galatAI("Server terjemahan tidak mengembalikan hasil.", "ai_empty");
    }
    return String(data.translatedText);
  }

  /* ============================================================
     Protokol: libretranslate
     ============================================================ */
  async function mintaLibre(mesin, from, to, teks, opsi) {
    const cfg = config();
    const body = { q: teks, source: from, target: to, format: "text" };
    if (cfg.apiKey) body.api_key = cfg.apiKey;
    const headers = { "Content-Type": "application/json" };
    if (cfg.apiKey) headers.Authorization = "Key " + cfg.apiKey;
    const json = await ambilJSON(mesin.endpoint, {
      init: { method: "POST", headers: headers, body: JSON.stringify(body), credentials: "omit" },
      timeoutMs: (manifestAktif && manifestAktif.defaults && manifestAktif.defaults.timeoutMs) || 25000,
      retries: manifestAktif && manifestAktif.defaults ? manifestAktif.defaults.retries : 2,
      labelEndpoint: mesin.endpoint,
    });
    if (json && json.translatedText) return String(json.translatedText);
    throw galatAI("Server terjemahan tidak mengembalikan hasil.", "ai_empty");
  }

  /* ============================================================
     Protokol: custom
     ============================================================ */
  async function mintaCustom(mesin, from, to, batch, opsi) {
    const cfg = config();
    const headers = { "Content-Type": "application/json" };
    const key = (opsi && opsi.apiKey) || cfg.apiKey;
    if (key) headers.Authorization = "Bearer " + key;
    const body = {
      from: from,
      to: to,
      texts: batch,
      glossary: String((opsi && opsi.glosarium) || ""),
    };
    const json = await ambilJSON(mesin.endpoint, {
      init: { method: "POST", headers: headers, body: JSON.stringify(body), credentials: "omit" },
      timeoutMs: (manifestAktif && manifestAktif.defaults && manifestAktif.defaults.timeoutMs) || 25000,
      retries: manifestAktif && manifestAktif.defaults ? manifestAktif.defaults.retries : 2,
      labelEndpoint: mesin.endpoint,
    });
    const arr = (json && (json.translations || json.result)) || [];
    if (!Array.isArray(arr)) throw galatAI("Server terjemahan tidak mengembalikan larik hasil.", "ai_empty");
    const out = [];
    for (let i = 0; i < batch.length; i++) {
      const v = arr[i];
      out.push(typeof v === "string" ? v : String(batch[i]));
    }
    return out;
  }

  /* ============================================================
     Mesin daring
     ============================================================ */
  AI.createEngine = function (opts) {
    const o = opts || {};
    const from = String(o.from || "id");
    const to = String(o.to || "en");
    const onProgress = typeof o.onProgress === "function" ? o.onProgress : null;
    const mesin = AI.pickEngine({
      from: from,
      to: to,
      engineId: String(o.engineId || config().engineId || ""),
    });
    const cfg = config();
    const m = manifestAktif || normalisasiManifest(MANIFEST_BAWAAN, "bawaan");
    const maksItem = Math.max(1, mesin.maxItems || 20);
    const maksHuruf = Math.max(200, mesin.maxChars || 2000);
    const konkurensi = Math.max(1, Math.min(6, (m.defaults && m.defaults.concurrency) || 3));
    const bisaBatch = mesin.protocol === "openai" || mesin.protocol === "custom";

    /* Kelompokkan baris jadi permintaan berurutan. Untuk mesin AI
       (openai/custom) satu permintaan berisi beberapa baris BERURUTAN
       supaya model melihat konteksnya -> terjemahan jauh lebih akurat
       daripada menerjemahkan tiap baris terpisah. */
    function kelompokkan(indices, daftar) {
      const grup = [];
      let cur = [];
      let chars = 0;
      for (const i of indices) {
        const t = String((daftar[i] == null ? "" : daftar[i]));
        const c = t.length + 1;
        if (cur.length && (cur.length >= maksItem || chars + c > maksHuruf)) {
          grup.push(cur);
          cur = [];
          chars = 0;
        }
        cur.push(i);
        chars += c;
      }
      if (cur.length) grup.push(cur);
      return grup;
    }

    async function kirim(batch) {
      stats.onlineRequests++;
      if (mesin.protocol === "openai") return mintaOpenAI(mesin, from, to, batch, o);
      if (mesin.protocol === "custom") return mintaCustom(mesin, from, to, batch, o);
      if (mesin.protocol === "libretranslate") {
        const out = [];
        for (const t of batch) out.push(await mintaLibre(mesin, from, to, t, o));
        return out;
      }
      if (mesin.protocol === "mymemory") {
        const out = [];
        for (const t of batch) out.push(await mintaMyMemory(mesin, from, to, t, o));
        return out;
      }
      throw galatAI("Protokol \"" + mesin.protocol + "\" tidak didukung.", "ai_protocol");
    }

    const engine = {
      kind: "online",
      engineId: mesin.id,
      label: mesin.label,
      protocol: mesin.protocol,
      model: mesin.model || "",
      from: from,
      to: to,
      manifestVersion: m.version,
      dataSent: true,
      async translateBatch(texts, opsi2) {
        const list = (texts || []).map((t) => String(t == null ? "" : t));
        if (!list.length) return [];
        stats.onlineCalls++;
        stats.onlineTexts += list.length;
        const hasil = new Array(list.length);
        /* Yang tidak perlu diterjemahkan (angka, kode, URL) tetap
           apa adanya — tidak dikirim ke server. */
        const todo = [];
        for (let i = 0; i < list.length; i++) {
          if (AI.layakTerjemahkan(list[i])) todo.push(i);
          else hasil[i] = list[i];
        }
        if (!todo.length) return hasil;
        const grup = kelompokkan(todo, list);
        let selesai = 0;
        let gagal = null;
        async function worker() {
          for (;;) {
            const gi = grup.shift();
            if (!gi) return;
            const teks = gi.map((t) => list[t]);
            try {
              const out = await kirim(teks);
              for (let k = 0; k < gi.length; k++) hasil[gi[k]] = out[k] == null ? teks[k] : String(out[k]);
            } catch (err) {
              gagal = err;
              return;
            }
            selesai += gi.length;
            if (onProgress) {
              onProgress("menerjemahkan dengan AI daring (" + Math.min(100, Math.round((selesai / todo.length) * 100)) + "%)");
            }
          }
        }
        const workers = [];
        for (let i = 0; i < Math.min(konkurensi, grup.length); i++) workers.push(worker());
        await Promise.all(workers);
        if (gagal) {
          stats.onlineErrors++;
          throw gagal;
        }
        /* Isi yang belum terkirim (kalau ada galat sebagian) tetap
           dikembalikan apa adanya supaya tidak ada baris hilang. */
        for (let i = 0; i < hasil.length; i++) if (hasil[i] == null) hasil[i] = list[i];
        return hasil;
      },
      destroy() { /* tidak ada worker yang perlu dilepas */ },
    };
    return engine;
  };

  /* Uji cepat: apakah server AI bisa dihubungi? */
  AI.probe = async function (opts) {
    const o = opts || {};
    try {
      const e = AI.pickEngine({ from: o.from || "id", to: o.to || "en", engineId: o.engineId || "" });
      return { ok: true, engineId: e.id, label: e.label, protocol: e.protocol };
    } catch (err) {
      return { ok: false, pesan: (err && err.message) || String(err) };
    }
  };

  window.PDFTranslateAI = AI;
})();
