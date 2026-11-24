/**
 * Helper browser untuk harness audit.
 *
 * Chromium dari @sparticuz/chromium butuh pustaka sistem tambahan (libnss3
 * dll). Di lingkungan Lambda paket itu otomatis diekstrak, di mesin
 * biasa tidak. Helper ini mengekstraknya bila perlu dan mengatur
 * LD_LIBRARY_PATH supaya Chromium bisa jalan di mana saja.
 *
 * Pemakaian:
 *   import { chromium } from "./browser.mjs";
 *   const browser = await chromium();
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium as pwChromium } from "playwright-core";
import sparticuz from "@sparticuz/chromium";

const require = createRequire(import.meta.url);

/* Lokasi paket @sparticuz/chromium (untuk cari bin/al2023.tar.br). */
function paketDir() {
  try {
    return path.dirname(require.resolve("@sparticuz/chromium/package.json"));
  } catch (_) {
    return null;
  }
}

/* Ekstrak pustaka sistem (libnss3, libnspr, ...) bila belum ada. */
export async function siapkanPustaka() {
  const dir = paketDir();
  if (!dir) return false;
  const target = "/tmp/al2023";
  if (fs.existsSync(path.join(target, "lib"))) {
    const lib = path.join(target, "lib");
    if (!process.env.LD_LIBRARY_PATH || !process.env.LD_LIBRARY_PATH.includes(lib)) {
      process.env.LD_LIBRARY_PATH = lib + (process.env.LD_LIBRARY_PATH ? ":" + process.env.LD_LIBRARY_PATH : "");
    }
    return true;
  }
  const src = path.join(dir, "bin", "al2023.tar.br");
  if (!fs.existsSync(src)) return false;
  const lambdafs = require("@sparticuz/chromium/build/lambdafs");
  const inflate = (lambdafs.inflate || (lambdafs.default && lambdafs.default.inflate)).bind(lambdafs.default || lambdafs);
  await inflate(src);
  const lib = path.join(target, "lib");
  if (fs.existsSync(lib)) {
    process.env.LD_LIBRARY_PATH = lib + (process.env.LD_LIBRARY_PATH ? ":" + process.env.LD_LIBRARY_PATH : "");
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
