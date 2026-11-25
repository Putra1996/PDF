/**
 * Helper browser untuk harness audit.
 *
 * Chromium dari @sparticuz/chromium butuh pustaka sistem tambahan (libnss3
 * dll). Di lingkungan Lambda paket itu otomatis diekstrak, di mesin
 * biasa tidak. Helper ini mengekstraknya bila perlu dan mengatur
 * LD_LIBRARY_PATH supaya Chromium bisa jalan di mana saja.
 *
 * Paket ini memakai "exports" di package.json, jadi modul internalnya
 * (build/lambdafs.js) tidak bisa di-resolve lewat require() — path-nya
 * dicari manual dari direktori paket.
 *
 * Pemakaian:
 *   import { chromium } from "./browser.mjs";
 *   const browser = await chromium();
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium as pwChromium } from "playwright-core";
import sparticuz from "@sparticuz/chromium";

const require = createRequire(import.meta.url);

/* Direktori paket @sparticuz/chromium (untuk cari bin/al2023.tar.br
   dan build/lambdafs.js). Path dicari manual karena paket ini
   mengekspor hanya entry point utama lewat "exports". */
function paketDir() {
  const candidates = [];
  try {
    candidates.push(path.dirname(require.resolve("@sparticuz/chromium")));
  } catch (_) { /* abaikan */ }
  try {
    /* jalurnya biasanya .../node_modules/@sparticuz/chromium/build */
    const build = require.resolve("@sparticuz/chromium");
    candidates.push(path.dirname(build));
  } catch (_) { /* abaikan */ }
  /* cari relatif terhadap file ini: node_modules/@sparticuz/chromium */
  const here = path.dirname(fileURLToPath(import.meta.url));
  let cur = here;
  for (let i = 0; i < 6; i++) {
    candidates.push(path.join(cur, "node_modules", "@sparticuz", "chromium"));
    const up = path.dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  for (const c of candidates) {
    if (!c) continue;
    const base = path.basename(c) === "build" ? path.dirname(c) : c;
    if (fs.existsSync(path.join(base, "bin"))) return base;
  }
  return null;
}

/* Tambahkan folder pustaka ke LD_LIBRARY_PATH (dipakai juga oleh
   lib yangsystem自带 sudah ada). */
function tambahLdLibraryPath(dir) {
  if (!dir) return;
  const cur = process.env.LD_LIBRARY_PATH || "";
  if (cur.split(":").includes(dir)) return;
  process.env.LD_LIBRARY_PATH = cur ? `${dir}:${cur}` : dir;
}

/* Ekstrak pustaka sistem (libnss3, libnspr, ...) bila belum ada. */
export async function siapkanPustaka() {
  const dir = paketDir();
  if (!dir) return false;
  const target = "/tmp/al2023";
  const lib = path.join(target, "lib");
  if (fs.existsSync(lib)) {
    tambahLdLibraryPath(lib);
    return true;
  }
  const src = path.join(dir, "bin", "al2023.tar.br");
  if (!fs.existsSync(src)) return false;
  try {
    const lambdafsPath = path.join(dir, "build", "lambdafs.js");
    const mod = await import(pathToFileURL(lambdafsPath).href);
    /* Bentuk ekspor berbeda-beda antar versi @sparticuz/chromium:
         mod.inflate                  -> fungsi langsung
         mod.default.inflate          -> dibungkus default
         mod.default.default.inflate  -> kelas LambdaFS (static method) */
    const inflate = mod.inflate
      || (mod.default && (mod.default.inflate
        || (mod.default.default && mod.default.default.inflate)));
    if (!inflate) return false;
    await inflate(src);
  } catch (err) {
    return false;
  }
  if (fs.existsSync(lib)) {
    tambahLdLibraryPath(lib);
    return true;
  }
  return false;
}

/**
 * Jalankan Chromium headless.
 * @param {object} opts - opsi tambahan untuk playwright launch
 */
export async function chromium(opts = {}) {
  await siapkanPustaka();
  const exe = await sparticuz.executablePath();
  return pwChromium.launch({
    executablePath: exe,
    args: [...sparticuz.args, "--no-sandbox", "--disable-dev-shm-usage"],
    headless: true,
    ...opts,
  });
}

export { pwChromium };
