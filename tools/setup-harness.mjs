/**
 * Siapkan dependensi harness audit (Playwright + Chromium + pdf-lib).
 *
 * Dependensi ini tidak ikut ke repo (node_modules ada di .gitignore),
 * jadi perlu dipasang ulang setelah repo di-reset / di-clone ulang.
 *
 * Jalankan:
 *   node tools/setup-harness.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const PAKET = [
  "playwright-core@1.49.1",
  "@sparticuz/chromium@131.0.1",
  "pdf-lib@1.17.1",
];

console.log("Memasang: " + PAKET.join(", "));
execFileSync("npm", ["install", "--no-save", "--no-audit", "--no-fund", ...PAKET], {
  cwd: ROOT, stdio: "inherit",
});

for (const p of ["playwright-core", "@sparticuz/chromium", "pdf-lib"]) {
  const ok = fs.existsSync(path.join(ROOT, "node_modules", p));
  console.log((ok ? "✓ " : "✗ ") + p);
}

/* Pustaka sistem Chromium (libnss3 dll) diekstrak ke /tmp saat dibutuhkan
   oleh tools/browser.mjs — tidak perlu dipasang di sini. */
const { siapkanPustaka } = await import("./browser.mjs");
console.log("Pustaka Chromium: " + ((await siapkanPustaka()) ? "siap" : "belum (dibuat otomatis saat harness jalan)"));

/* Fixture uji juga gitignored, jadi perlu dibuat ulang setelah reset. */
const PEMBUAT = ["mkfixtures.mjs", "mkfixtures-sign.mjs", "mkfixtures-translate.mjs",
  "mkfixtures-translate-ai.mjs", "mkfixtures-pagerange.mjs", "mkfixtures-merge.mjs",
  "mkfixtures-deskew.mjs", "mkfixtures-ocr.mjs", "mkfixtures-semua.mjs",
  "mkfixtures-rapi.mjs", "mkfixture-editor-ocr.mjs"];
for (const f of PEMBUAT) {
  const p = path.join(ROOT, "tools", f);
  if (!fs.existsSync(p)) { console.log("• " + f + " (tidak ada, dilewati)"); continue; }
  try {
    execFileSync("node", [p], { cwd: ROOT, stdio: "ignore" });
    console.log("✓ fixture " + f);
  } catch (err) {
    console.log("✗ fixture " + f + " gagal");
  }
}
