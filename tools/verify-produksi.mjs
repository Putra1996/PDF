// Verifikasi produksi: muat situs live, cek build + elemen UI baru.
import { chromium } from "playwright-core";
import spPkg from "@sparticuz/chromium";
const sp = spPkg.default || spPkg;
import fs from "node:fs"; import zlib from "node:zlib";

const ROOT = process.env.HARNESS_DIR || (new URL("..", import.meta.url).pathname);
const perluSparticuz = !["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]
  .some((p) => fs.existsSync(p));
if (perluSparticuz && !fs.existsSync("/tmp/al2023/lib/libnss3.so")) {
  fs.writeFileSync("/tmp/al2023.tar", zlib.brotliDecompressSync(
    fs.readFileSync(ROOT + "/node_modules/@sparticuz/chromium/bin/al2023.tar.br")));
  fs.mkdirSync("/tmp/al2023", { recursive: true });
  const { execFileSync } = await import("node:child_process");
  execFileSync("tar", ["-xf", "/tmp/al2023.tar", "-C", "/tmp/al2023"]);
}

const BASE = process.argv[2] || "https://putra1996.github.io/PDF/index.html";
const FIXTURES = process.env.FIXTURES_DIR || (ROOT + "/fixtures");
/* Chromium: pakai binary sistem bila ada (runner GitHub), else
   paket @sparticuz (sandbox lokal). */
let executablePath;
let launchOpts = { headless: true };
const sistem = ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]
  .find((p) => fs.existsSync(p));
if (sistem) {
  executablePath = sistem;
  launchOpts.args = ["--no-sandbox", "--disable-dev-shm-usage"];
} else {
  executablePath = await sp.executablePath();
  launchOpts.args = sp.args;
  launchOpts.env = { ...process.env, LD_LIBRARY_PATH: "/tmp/al2023/lib", FONTCONFIG_PATH: "/tmp/fonts" };
}
const browser = await chromium.launch({ executablePath, ...launchOpts });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log("  ✓ " + name); }
  else { fail++; failures.push(name + (detail ? " — " + detail : "")); console.log("  ✗ " + name + (detail ? " — " + detail : "")); }
}

fs.mkdirSync("/tmp/prod", { recursive: true });
console.log("URL: " + BASE);
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => !!window.PDFToolsUI, null, { timeout: 30000 });
await page.waitForTimeout(1500);

const build = await page.evaluate(() => ({
  build: window.PDF_BUILD,
  cssBuild: getComputedStyle(document.documentElement).getPropertyValue("--css-build").trim(),
  sheetHref: Array.from(document.styleSheets).map((s) => s.href).find((h) => h && h.includes("style.css")) || "",
}));
console.log("  build: " + JSON.stringify(build));
check("build aset konsisten", build.build === build.cssBuild, JSON.stringify(build));

/* tab label */
const tabs = await page.$$eval(".tab", (ts) => ts.map((t) => ({
  tab: t.dataset.tab,
  vis: Array.from(t.querySelectorAll(".tab-txt,.tab-txt-short"))
    .filter((e) => getComputedStyle(e).display !== "none").map((e) => e.textContent.trim()).join(" "),
})));
check("4 tab dengan label", tabs.length === 4, JSON.stringify(tabs));

/* pencarian launcher */
await page.click('.tab[data-tab="tools"]');
await page.waitForTimeout(600);
check("kolom pencarian ada", await page.evaluate(() => !!document.querySelector("#toolSearch")));
const cards = await page.$$eval(".tool-card", (c) => c.length);
await page.fill("#toolSearch", "ocr");
await page.waitForTimeout(400);
const filtered = await page.$$eval(".tool-card", (c) => c.filter((x) => !x.hidden).length);
check("pencarian menyaring", filtered > 0 && filtered < cards, `${filtered}/${cards}`);
await page.fill("#toolSearch", "zzz");
await page.waitForTimeout(300);
check("state kosong tampil", await page.evaluate(() => !document.querySelector("#toolEmpty")?.hidden));
await page.fill("#toolSearch", "");
await page.waitForTimeout(300);

/* penanda tab */
const badges = await page.$$eval(".tool-badge", (b) => b.map((x) => x.textContent.trim()));
check("penanda tab utama muncul", badges.length >= 3, JSON.stringify(badges));

/* pintasan beranda */
await page.click('.tab[data-tab="split"]');
await page.waitForTimeout(500);
check("pintasan beranda tampil", await page.evaluate(() => {
  const q = document.querySelector("#quickTools");
  return !!q && !q.hidden && q.offsetParent !== null;
}));

/* strip tab mobile */
await page.setViewportSize({ width: 360, height: 780 });
await page.waitForTimeout(400);
for (const t of ["split", "merge", "compress", "tools"]) {
  await page.click(`.tab[data-tab="${t}"]`);
  await page.waitForTimeout(250);
  const g = await page.evaluate(() => {
    const strip = document.querySelector(".tabs");
    const act = document.querySelector(".tab.active");
    const r = act.getBoundingClientRect(), sr = strip.getBoundingClientRect();
    return { l: r.left, rr: r.right, sl: sr.left, srr: sr.right, label: act.textContent.trim() };
  });
  check(`tab "${g.label}" terlihat @360px`, g.l >= g.sl - 1 && g.rr <= g.srr + 1, JSON.stringify(g));
}
await page.setViewportSize({ width: 1280, height: 900 });
await page.waitForTimeout(400);

/* editor */
await page.click('.tab[data-tab="tools"]');
await page.waitForTimeout(400);
await page.click('.tool-card[data-tool="edit"]');
await page.waitForTimeout(700);
await page.setInputFiles("#toolInput", FIXTURES + "/dense90.pdf");
await page.waitForTimeout(7000);
const ed = await page.evaluate(() => ({
  canvas: !!document.querySelector(".ed-canvas")?.width,
  inspRail: !!document.querySelector("#toolSideExtra .ed-side"),
  stageW: Math.round(document.querySelector(".ed-stage")?.getBoundingClientRect().width || 0),
  hasMenu: !!document.querySelector('[data-menu-panel="export"]'),
}));
check("editor ter-render", ed.canvas, JSON.stringify(ed));
check("inspektor di rail kanan", ed.inspRail, JSON.stringify(ed));
check("panggung lebar (>=600px)", ed.stageW >= 600, "w=" + ed.stageW);
check("menu Ekspor ada", ed.hasMenu);
await page.screenshot({ path: "/tmp/prod/editor.png" });

/* kompres */
await page.click('.tab[data-tab="compress"]');
await page.waitForTimeout(500);
await page.setInputFiles("#compressInput", FIXTURES + "/sample.pdf");
await page.waitForTimeout(7000);
const comp = await page.evaluate(() => {
  const ests = Array.from(document.querySelectorAll(".preset-est")).map((e) => e.textContent.trim());
  return { ests, stuck: ests.filter((t) => /Menghitung/.test(t)).length };
});
check("perkiraan terisi", comp.ests.some((t) => /\d/.test(t)), JSON.stringify(comp.ests));
check("tidak ada spinner macet", comp.stuck === 0, JSON.stringify(comp.ests));

/* dark mode */
await page.click('.tab[data-tab="tools"]');
await page.waitForTimeout(500);
await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
await page.waitForTimeout(500);
await page.screenshot({ path: "/tmp/prod/alat-dark.png" });
const darkOk = await page.evaluate(() =>
  getComputedStyle(document.body).backgroundColor !== "rgb(255, 255, 255)");
check("dark mode diterapkan", darkOk);

check("tidak ada error JavaScript", errs.length === 0, JSON.stringify(errs.slice(0, 3)));

await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
await page.click('.tab[data-tab="split"]');
await page.waitForTimeout(600);
await page.screenshot({ path: "/tmp/prod/beranda.png" });
await page.setViewportSize({ width: 360, height: 780 });
await page.waitForTimeout(500);
await page.screenshot({ path: "/tmp/prod/beranda-mobile.png" });

console.log("\n=========================");
console.log("LULUS: " + pass + "  GAGAL: " + fail);
if (failures.length) { console.log("\nGAGAL:"); failures.forEach((f) => console.log(" - " + f)); }
await browser.close();
process.exit(fail ? 1 : 0);
